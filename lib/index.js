import z from "@deepseek-ai/schemastery";
import { createServer } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
// src/routing.ts
const PLUGIN_ID = "dsh-connect-catpaw";
const PROVIDER_ROUTE = "dsh-connect-catpaw";
const PREFIX_CATPAW = "catpaw/";
const LONGCAT_MODELS_URL = "https://api.longcat.chat/openai/v1/models";
const LONGCAT_MODEL_DETAIL_URL = "https://api.longcat.chat/openai/v1/models/";
const KEY_ENV_VAR = "LONGCAT_API_KEY";
function channelOf(modelId) {
	if (modelId.startsWith("longcat/")) return "longcat";
	if (modelId.startsWith("catpaw/")) return "catpaw";
	return null;
}
function stripPrefix(modelId) {
	if (modelId.startsWith("longcat/")) return modelId.slice(8);
	if (modelId.startsWith("catpaw/")) return modelId.slice(7);
	return modelId;
}
function isChannelBEnabled() {
	return true;
}
const LONGCAT_CATALOG_FALLBACK = [{
	id: "longcat/LongCat-2.5",
	provider: "longcat",
	name: "LongCat-2.5",
	contextWindow: 1048576,
	maxTokens: 262144,
	input: ["text", "image"],
	supportedParameters: [
		"max_tokens",
		"temperature",
		"top_p",
		"stream",
		"tools",
		"tool_choice",
		"thinking"
	],
	pricing: {
		prompt: "2",
		completion: "8",
		cached_tokens: "0.04"
	},
	detailSource: "fallback"
}];
/** 妙手免费的默认模型在本地 Agent Server 里的数字 ID（云端 model-types 的 modelTypeId）。 */
const CATPAW_FREE_MODEL_ID = 10002544;
/**
* B 通道模型名的**唯一来源**（plan.md §3.4 单一数据源约束）。
* 选择器显示 `catpaw/<此值>`；设置页显示 `<此值>`（不带前缀）。
* 禁止在其它文件再写一份 'LongCat-2.5' 字面量。
*/
const CATPAW_MODEL_NAME = "LongCat-2.5";
/** B 通道单一模型条目（替换原占位清单）。 */
const CATPAW_CATALOG = [{
	id: `${PREFIX_CATPAW}${CATPAW_MODEL_NAME}`,
	provider: "catpaw",
	name: CATPAW_MODEL_NAME,
	contextWindow: 204800,
	maxTokens: 32768,
	input: ["text"]
}];
// src/config.ts
const catalogEntry = z.any();
const nullableNumber = z.union([z.number(), z.const(null)]);
const contextTier = z.union([
	z.const("200K"),
	z.const("500K"),
	z.const("1M")
]);
/**
* 插件配置 schema。
*
* ## 为什么每个可编辑字段都要 `.volatile()`
*
* 宿主的设置系统只把「标了 volatile 的字段」投影成设置页表单
* （`packages/settings/settings/src/schema.ts` 的 `volatileForm()`）：
* 一个 volatile 字段都没有的插件，会被 `describe()` **直接跳过**，
* 它的命名空间根本不会出现在 Host 服务的列表里 —— 客户端于是永远拿不到
* 配置，设置卡只能降级为只读。
*
* 这正是 0.1.0~0.1.2 设置卡一直显示「无法读取插件配置」的根因：
* 早期版本一个 `.volatile()` 都没有，宿主当作本插件不存在。
*
* 参照宿主官方写法（`packages/client/ui-chat/src/index.ts`）：
* `z.object({ transcriptView: ...volatile(), ... })`。
*
* ## 嵌套对象只在外层标一次
*
* schemastery 禁止 volatile 套 volatile（`validateVolatileSchema` 会抛
* "volatile fields require a fixed object path without an enclosing volatile
* field"）。`channelB` 整体标 volatile 后，其子字段**不得**再标。
*
* 另外 `ConfigFormController.set(field, value)` 的 `field` 只接受**顶层**
* 字段名（内部固定 `path: [field]`），所以 `channelB` 只能整对象读写。
*/
const Config = z.object({
	apiKey: z.string().default("").description("LongCat API Key (stored locally only)").volatile(),
	apiKeyEnv: z.string().default(KEY_ENV_VAR).description("Env var NAME only, never the value"),
	lastCatalog: z.array(catalogEntry).default([]),
	thinkLongcat: z.boolean().default(true).volatile(),
	thinkCatpaw: z.boolean().default(true).volatile(),
	channelB: z.object({
		enabled: z.boolean().default(false),
		catalog: z.array(catalogEntry).default([]),
		credits: nullableNumber.default(null),
		contextTiers: z.dict(contextTier).default({})
	}).default({
		enabled: false,
		catalog: [],
		credits: null,
		contextTiers: {}
	}).volatile()
});
// src/longcat.ts
/**
* Channel A — LongCat official OpenAI-compatible API.
*
* Upstream shapes: docs/longcat.md §2 (model list) / §3 (model detail) /
* §4 (chat completions + the binary thinking switch). This module reads only
* the public model list and the public per-model detail endpoints.
*
* Privacy: the key is placed solely in the Authorization header of an outbound
* request. It is never logged, never returned, and any error text is scrubbed
* with [redacted] before it can leave this module (decision 1).
*/
/** The whole documented static catalog, each row honestly marked as fallback. */
function fallbackCatalog() {
	return LONGCAT_CATALOG_FALLBACK.map((entry) => ({
		...entry,
		detailSource: "fallback"
	}));
}
/**
* Per-model fallback (decision 2 allows partial results). If the static catalog
* has no row for this id, return the whole documented catalog instead of
* inventing parameters for an unknown model.
*/
function fallbackForId(id) {
	const prefixed = `longcat/${id}`;
	const match = LONGCAT_CATALOG_FALLBACK.find((entry) => entry.id === prefixed);
	return match ? [{
		...match,
		detailSource: "fallback"
	}] : fallbackCatalog();
}
function createLongcatClient({ apiKey = "", fetchFn = fetch } = {}) {
	const authHeaders = () => ({
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json"
	});
	/** Step 2 alone: GET /v1/models/{model}; 401/404/network failure → null, never throws. */
	async function getModelDetail(id) {
		try {
			const res = await fetchFn(LONGCAT_MODEL_DETAIL_URL + encodeURIComponent(id), {
				method: "GET",
				headers: authHeaders()
			});
			if (res.status === 401 || res.status === 404 || !res.ok) return null;
			const payload = await res.json();
			return payload && typeof payload === "object" ? payload : null;
		} catch {
			return null;
		}
	}
	/**
	* Two-step catalog composition (decision 2):
	*   1. GET /v1/models → id list (that response carries no parameter fields).
	*   2. For every id: getModelDetail(id) → context / params / pricing.
	* Any failure falls back to the static catalog, never masquerading as live.
	*/
	async function listModels() {
		let ids;
		try {
			const res = await fetchFn(LONGCAT_MODELS_URL, {
				method: "GET",
				headers: authHeaders()
			});
			if (res.status === 401 || !res.ok) return fallbackCatalog();
			const payload = await res.json();
			ids = (payload && Array.isArray(payload.data) ? payload.data : []).map((row) => typeof row?.id === "string" ? row.id : "").filter((id) => id.length > 0);
		} catch {
			return fallbackCatalog();
		}
		if (ids.length === 0) return fallbackCatalog();
		const entries = [];
		for (const id of ids) {
			let detail;
			try {
				detail = await getModelDetail(id);
			} catch {
				detail = null;
			}
			if (!detail || typeof detail.context_length !== "number") {
				entries.push(...fallbackForId(id));
				continue;
			}
			const prefixed = `longcat/${id}`;
			const staticRow = LONGCAT_CATALOG_FALLBACK.find((entry) => entry.id === prefixed);
			const entry = {
				id: prefixed,
				provider: "longcat",
				name: detail.name || id,
				contextWindow: detail.context_length,
				maxTokens: staticRow ? staticRow.maxTokens : 0,
				input: ["text", "image"],
				detailSource: "live"
			};
			if (Array.isArray(detail.supported_parameters)) entry.supportedParameters = detail.supported_parameters;
			if (detail.pricing) entry.pricing = detail.pricing;
			entries.push(entry);
		}
		return entries;
	}
	/**
	* POST /chat/completions. Injects the binary thinking switch (decision 3/F9);
	* every other field (including stream) is forwarded untouched (F3).
	*/
	async function chat(body, signal, thinkEnabled = true) {
		const payload = {
			...body,
			thinking: { type: thinkEnabled ? "enabled" : "disabled" }
		};
		const init = {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify(payload)
		};
		if (signal) init.signal = signal;
		try {
			return await fetchFn("https://api.longcat.chat/openai/v1/chat/completions", init);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			if (apiKey && message.includes(apiKey)) throw new Error(message.split(apiKey).join("[redacted]"));
			throw error;
		}
	}
	return {
		listModels,
		getModelDetail,
		chat
	};
}
// src/catpaw-agent.ts
/**
* 妙手本地 Agent Server 客户端（发现 / 配置 / 对话 / SSE 解析）。
*
* 职责边界：本文件只负责「和本地妙手 Agent Server 说话」——
*   - `discoverAgentServer()`：扫本机回环端口，找出妙手客户端的 Agent Server；
*   - `configureFreeModel()`：把服务端配置指向免费的 LongCat-2.5；
*   - `startChat()`：发一轮 `agent.start` 并把 SSE 事件收敛成结构化结果。
*
* 上层编排（发现 → 配置 → 对话 的顺序、失败文案、状态探测）在 `channel-b.ts`；
* 本文件**不** import 任何项目内模块（除 `routing.ts` 的两个常量），避免循环依赖。
*
* 三条硬约束（都来自实测，见 temp/P2/probe-report.md）：
*   1. `PATCH /api/admin/config` 只认 8 个键，本插件**只写 `model` 一个**——
*      多写会污染妙手的合法配置，且 `PATCH` 没有删键语义，写坏了只能逐一改回。
*   2. 工作目录靠请求头 `x-catpaw-directory: encodeURIComponent(<绝对路径>)` 传递；
*      **缺失时必须直接拒绝**，绝不能"退回不传目录"——那样妙手会在自己的安装
*      目录里干活，用户看到的是完全不相干的文件。
*   3. 妙手自带的 27 个工具无法禁用，因此工具调用事件必须收进 `toolEvents`
*      供上层审计。
*
* 所有导出函数**都不抛异常**：失败一律通过返回值（`null` / `false` / `ok:false`）表达。
*
* @module dsh-connect-catpaw/catpaw-agent
*/
/** 回环地址：只和本机的妙手客户端说话。 */
const LOOPBACK_HOST = "127.0.0.1";
/** 端口扫描范围（含两端）：妙手每次启动端口动态，实测出现过 6984 / 6985。 */
const PORT_RANGE_FIRST = 6983;
const PORT_RANGE_LAST = 6990;
/** 单端口探测超时：端口没监听时 TCP 会立刻失败，超时只防"连上了但不回话"。 */
const DISCOVERY_TIMEOUT_MS = 1e3;
/** 进程/端口查询超时：PowerShell 启动通常 200~800ms，给足余量但不拖死首屏。 */
const PROCESS_QUERY_TIMEOUT_MS = 5e3;
/** 妙手 Agent Server 的首页横幅，用来确认这个端口确实是它（而不是别的本地服务）。 */
const SERVER_BANNER = "CatPaw Agent Server";
/** 缺失工作目录的拒绝文案：明确说"需要工作目录"，不是泛泛的失败。 */
const WORKDIR_REQUIRED_ERROR = "通道 B 需要工作目录（会话工作区缺失），已拒绝调用";
/** 取出可调用对象：`fetchFn` 缺省时用全局 fetch（Node 18+ 自带）。 */
function resolveFetch(fetchFn) {
	return fetchFn ?? fetch;
}
/** 把任意值收窄成「非 null 对象」，用于解析上游 JSON（上游形状不可信）。 */
function asRecord(value) {
	if (typeof value !== "object" || value === null) return void 0;
	return value;
}
/**
* 发现本地 Agent Server：扫 127.0.0.1 的 [6983..6990]，
* `GET /` 返回含 'CatPaw Agent Server' 者胜出。
*
* 顺序扫描而非并发：端口通常第一个或第二个就命中，并发只会把「妙手没开」这一
* 常见情况的 8 个连接同时打出去，得不偿失。
*
* @param fetchFn - 可注入的 fetch（测试替身）；缺省用全局 fetch。
* @returns 命中则返回句柄，否则 `null`（不抛错）。
*/
function discoverAgentServer(fetchFn) {
	return discoverAgentServerImpl(fetchFn).catch(() => null);
}
/** {@link discoverAgentServer} 的实现体。 */
async function discoverAgentServerImpl(fetchFn) {
	const doFetch = resolveFetch(fetchFn);
	const candidates = await collectCandidatePorts();
	for (const port of candidates) {
		const controller = new AbortController();
		const timer = setTimeout(() => {
			controller.abort();
		}, DISCOVERY_TIMEOUT_MS);
		try {
			if ((await (await doFetch(`http://${LOOPBACK_HOST}:${port}/`, { signal: controller.signal })).text()).includes(SERVER_BANNER)) return { baseUrl: `http://${LOOPBACK_HOST}:${port}` };
		} catch {} finally {
			clearTimeout(timer);
		}
	}
	return null;
}
/**
* 汇总候选端口：**先按进程精确定位**，再补静态兜底段。
*
* 本机通常有几十个回环监听端口（实测 59 个），逐个探横幅太慢且会误触别的本地服务；
* 按 `catpaw-cli` 的 PID 过滤能把候选收敛到 1~3 个。进程查询失败（非 Windows、
* 权限不足、命令不可用）时退回静态段，保证仍有机会命中。
*/
async function collectCandidatePorts() {
	const discovered = await queryPortsOfCatpawProcess();
	const ordered = [];
	const seen = /* @__PURE__ */ new Set();
	for (const port of discovered) if (!seen.has(port)) {
		seen.add(port);
		ordered.push(port);
	}
	for (let port = PORT_RANGE_FIRST; port <= PORT_RANGE_LAST; port += 1) if (!seen.has(port)) {
		seen.add(port);
		ordered.push(port);
	}
	return ordered;
}
/**
* 通过进程名找到妙手 Agent Server 的监听端口（Windows 专用）。
*
* 用 PowerShell 一次性完成"找 PID → 查监听端口"，避免多次进程启动开销。
* 任何失败都返回空数组（由 {@link collectCandidatePorts} 回落静态段）。
*/
async function queryPortsOfCatpawProcess() {
	if (process.platform !== "win32") return [];
	const script = [
		"$pids = @(Get-Process -Name catpaw-cli -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)",
		"if ($pids.Count -eq 0) { exit 0 }",
		"Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |",
		"  Where-Object { $pids -contains $_.OwningProcess } |",
		"  Select-Object -ExpandProperty LocalPort -Unique"
	].join("\n");
	try {
		const { execFile } = await import("node:child_process");
		const stdout = await new Promise((resolve, reject) => {
			execFile("powershell.exe", [
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				script
			], {
				timeout: PROCESS_QUERY_TIMEOUT_MS,
				windowsHide: true
			}, (error, out) => {
				if (error !== null) {
					reject(error);
					return;
				}
				resolve(out);
			});
		});
		const ports = [];
		for (const line of stdout.split(/\r?\n/)) {
			const value = Number.parseInt(line.trim(), 10);
			if (Number.isInteger(value) && value > 0 && value <= 65535) ports.push(value);
		}
		return ports;
	} catch {
		return [];
	}
}
/**
* 指定免费模型（唯一允许写 `model` 一个键）。
*
* **为什么 404 算成功**：妙手只在「有活跃 agent」时才允许 `GET /api/config`；
* 设置页做状态检测时根本没有会话，所以必然返回
* `404 {"error":"No active agent found for config query"}`。
* 这是妙手的正常行为，不是配置失败 —— 0.2.0 把它当失败，导致设置页永远显示"未就绪"。
*
* 判定规则：
* - PATCH 非 2xx → 失败；
* - `GET /api/config` 返回 **404 → 成功**（无活跃会话，PATCH 已接受）；
* - `GET /api/config` 返回 200 且 `model` 与期望不符 → 失败；
* - `GET /api/config` 网络异常 → 只要 PATCH 成功就判成功（读回是加分项，不是必需）。
*
* @param server - 已发现的 Agent Server。
* @param fetchFn - 可注入的 fetch（测试替身）；缺省用全局 fetch。
* @returns `true` = 已应用且读回确认；`false` = 失败（不抛错）。
*/
function configureFreeModel(server, fetchFn) {
	return configureFreeModelImpl(server, fetchFn).catch(() => false);
}
/** {@link configureFreeModel} 的实现体。 */
async function configureFreeModelImpl(server, fetchFn) {
	const doFetch = resolveFetch(fetchFn);
	try {
		if (!(await doFetch(`${server.baseUrl}/api/admin/config`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: 10002544 })
		})).ok) return false;
		let current;
		try {
			current = await doFetch(`${server.baseUrl}/api/config`);
		} catch {
			return true;
		}
		if (current.status === 404) return true;
		if (!current.ok) return true;
		const document = asRecord(await current.json().catch(() => void 0));
		if (document === void 0 || !("model" in document)) return true;
		return document.model === CATPAW_FREE_MODEL_ID;
	} catch {
		return false;
	}
}
/**
* 发一轮对话。
*
* 目录守卫在最前面：`workingDir` 缺失时**零网络请求**直接返回错误。这条不是
* 防御性编程，而是行为契约——不带目录的请求会让妙手在它自己的安装目录里执行
* 工具，用户会看到完全不相关的文件列表，却以为"通道坏了"。
*
* @param options - 见 {@link startChat} 的字段说明。
* @returns 统一形状的结果；不抛错。
*/
function startChat(options) {
	return startChatImpl(options).catch((error) => ({
		ok: false,
		text: "",
		modelName: "",
		creditCost: "",
		toolEvents: [],
		error: error instanceof Error ? error.message : "通道 B 调用失败"
	}));
}
/** {@link startChat} 的实现体。 */
async function startChatImpl(options) {
	const { server, workingDir, text } = options;
	if (!workingDir || workingDir.trim() === "") return {
		ok: false,
		text: "",
		modelName: "",
		creditCost: "",
		toolEvents: [],
		error: WORKDIR_REQUIRED_ERROR
	};
	const doFetch = resolveFetch(options.fetchFn);
	const conversationId = options.conversationId ?? randomUUID();
	const result = {
		ok: true,
		text: "",
		modelName: "",
		creditCost: "",
		toolEvents: []
	};
	try {
		const init = {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "text/event-stream",
				"x-catpaw-directory": encodeURIComponent(workingDir)
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				method: "agent.start",
				stream: true,
				params: {
					content: [{
						type: "text",
						text
					}],
					conversationId
				},
				id: randomUUID()
			})
		};
		if (options.signal !== void 0) init.signal = options.signal;
		const response = await doFetch(`${server.baseUrl}/api`, init);
		if (!response.ok) {
			result.ok = false;
			result.error = `本地 Agent Server 返回 HTTP ${response.status}`;
			return result;
		}
		if (response.body === null) handleSseText(await response.text(), result);
		else await consumeSseStream(response.body, result);
	} catch (error) {
		result.ok = false;
		const message = error instanceof Error ? error.message : "";
		result.error = message === "" ? "通道 B 调用失败" : message;
		return result;
	}
	if (result.ok && result.modelName === "") result.modelName = CATPAW_MODEL_NAME;
	return result;
}
/** 逐行消费 SSE 流（`data: ` 前缀 + JSON-RPC 信封）。 */
async function consumeSseStream(stream, result) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		buffer = drainLines(buffer, result);
	}
	buffer += decoder.decode();
	handleSseLine(buffer.replace(/\r$/, ""), result);
}
/** 把整段文本按行喂给同一个行处理器（无流式 body 时的退化路径）。 */
function handleSseText(text, result) {
	let buffer = text;
	buffer = drainLines(buffer, result);
	if (buffer !== "") handleSseLine(buffer.replace(/\r$/, ""), result);
}
/**
* 从缓冲区里切出所有完整行并处理，返回剩下的不完整尾巴。
*
* SSE 的一行可能被 TCP 切成两段，所以必须按 `\n` 缓冲，不能按 chunk 直接 parse。
*/
function drainLines(buffer, result) {
	let rest = buffer;
	let index = rest.indexOf("\n");
	while (index >= 0) {
		const line = rest.slice(0, index).replace(/\r$/, "");
		rest = rest.slice(index + 1);
		handleSseLine(line, result);
		index = rest.indexOf("\n");
	}
	return rest;
}
/**
* 处理一行 SSE。
*
* 信封形状（实测）：`data: {"jsonrpc":"2.0","id":"<uuid>","event":{...}}`。
* `event` 里的业务字段有两种历史形态——直接在 `event` 上，或包在 `event.data` 里；
* 这里统一取「有 data 用 data、没有就用 event 本身」，两种都能解析。
*/
function handleSseLine(line, result) {
	if (!line.startsWith("data: ")) return;
	const payload = line.slice(6);
	if (payload === "" || payload === "[DONE]") return;
	let parsed;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return;
	}
	const event = asRecord(asRecord(parsed)?.event);
	if (event === void 0) return;
	const type = typeof event.type === "string" ? event.type : "";
	const data = asRecord(event.data) ?? event;
	switch (type) {
		case "model_chunk":
			if (data.finished === false && typeof data.content === "string") result.text += data.content;
			return;
		case "model_end": {
			const message = asRecord(data.message);
			if (typeof message?.modelDisplayName === "string") result.modelName = message.modelDisplayName;
			return;
		}
		case "agent_end": {
			const roundInfo = asRecord(data.roundInfo);
			if (typeof roundInfo?.creditCost === "string") result.creditCost = roundInfo.creditCost;
			if (data.reason !== "completed") {
				result.ok = false;
				if (result.error === void 0) result.error = `妙手 Agent 未正常结束（reason: ${String(data.reason ?? "unknown")}）`;
			}
			return;
		}
		case "tool_execution_start":
		case "tool_execution_result": {
			const toolEvent = {
				type,
				toolName: typeof data.toolName === "string" ? data.toolName : ""
			};
			if (data.args !== void 0) toolEvent.args = data.args;
			if (data.output !== void 0) toolEvent.output = data.output;
			result.toolEvents.push(toolEvent);
			return;
		}
		case "agent_error": {
			result.ok = false;
			const errorRecord = asRecord(data.error);
			if (typeof data.error === "string") result.error = data.error;
			else if (typeof errorRecord?.message === "string") result.error = errorRecord.message;
			else result.error = "妙手 Agent 报错";
			return;
		}
		default: return;
	}
}
// src/channel-b.ts
/**
* 妙手（B 通道）上游 —— 本地 Agent Server 客户端封装。
*
* 职责：把 DSH 的 OpenAI 聊天请求翻译成妙手本地 Agent Server 的 `agent.start`
* 调用，并把结果收敛成 `ChannelBChatResult`（不抛错，统一用 `ok` / `error` 表达）。
*
* 阶段二起本文件为真实实现（阶段一的占位导出已整体删除）：
* - `chat()`：发现服务 → 指定免费模型 → 发一轮对话；
* - `probe()`：只做可用性探测，供设置页状态展示，**永不抛错**。
*
* 网络 / SSE / 目录头等协议细节全部在 `catpaw-agent.ts`，本文件只做编排。
*
* 用户可见文案一律「妙手」；技术标识（`catpaw/` 等）原样保留。
*
* @module dsh-connect-catpaw/channel-b
*/
/** 未发现本地 Agent Server（妙手客户端没开）。 */
const NO_SERVER_ERROR = "妙手客户端未运行（未发现本地 Agent Server）";
/** 发现了服务但无法指定免费模型（多半是版本不匹配 / 配置接口被拒）。 */
const CONFIG_FAILED_ERROR = "妙手客户端未就绪（免费模型配置失败）";
/** 缺失工作目录：**直接拒绝**，绝不"退回不传目录"。 */
const NO_WORKDIR_ERROR = "通道 B 需要工作目录（会话工作区缺失），已拒绝调用";
/** 构造一个失败结果（字段齐全，`text` / `modelName` 等留空）。 */
function failure(error) {
	return {
		ok: false,
		text: "",
		modelName: "",
		creditCost: "",
		toolEvents: [],
		error
	};
}
/**
* 创建 B 通道 upstream。
*
* @param options.fetchFn 可注入 fetch（测试替身）；缺省用全局 fetch。
*/
function createChannelBUpstream(options = {}) {
	const fetchFn = options.fetchFn;
	return {
		async chat(request) {
			if (request.workingDir === void 0 || request.workingDir.trim() === "") return failure(NO_WORKDIR_ERROR);
			let server = null;
			try {
				server = await discoverAgentServer(fetchFn);
			} catch {
				server = null;
			}
			if (server === null) return failure(NO_SERVER_ERROR);
			let configured = false;
			try {
				configured = await configureFreeModel(server, fetchFn);
			} catch {
				configured = false;
			}
			if (!configured) return failure(CONFIG_FAILED_ERROR);
			const chatOptions = {
				server,
				workingDir: request.workingDir,
				text: request.text
			};
			if (request.conversationId !== void 0) chatOptions.conversationId = request.conversationId;
			if (request.signal !== void 0) chatOptions.signal = request.signal;
			if (fetchFn !== void 0) chatOptions.fetchFn = fetchFn;
			let result;
			try {
				result = await startChat(chatOptions);
			} catch (error) {
				return failure(String(error?.message ?? "通道 B 调用失败"));
			}
			const mapped = {
				ok: result.ok,
				text: result.text,
				modelName: result.modelName === "" ? CATPAW_MODEL_NAME : result.modelName,
				creditCost: result.creditCost,
				toolEvents: result.toolEvents
			};
			if (result.error !== void 0) mapped.error = result.error;
			return mapped;
		},
		async probe() {
			try {
				const server = await discoverAgentServer(fetchFn);
				if (server === null) return {
					available: false,
					modelName: CATPAW_MODEL_NAME,
					reason: NO_SERVER_ERROR
				};
				if (!await configureFreeModel(server, fetchFn)) return {
					available: false,
					modelName: CATPAW_MODEL_NAME,
					reason: CONFIG_FAILED_ERROR
				};
				return {
					available: true,
					modelName: CATPAW_MODEL_NAME,
					reason: `本地 Agent Server 已就绪（${server.baseUrl}）`
				};
			} catch (error) {
				return {
					available: false,
					modelName: CATPAW_MODEL_NAME,
					reason: String(error?.message ?? "状态检测失败")
				};
			}
		}
	};
}
// src/shim.ts
/**
* 回环 shim：进程内 HTTP 服务（127.0.0.1 随机端口）。
*
* 安全模型以 qoder `src/shim.ts` 为**结构参照**独立重写（未复制其源码）：
* - `server.listen(0, '127.0.0.1')`：端口由内核分配，仅绑定回环；
* - 进程内 `randomBytes(32)` 生成 secret（base64url），只存在内存里，
*   pi-ai 仅拿到这个 secret 当 apiKey，真实 LongCat 凭据绝不交给 pi-ai；
* - 入站**三重校验**：Host / Origin / Content-Type，且 `Authorization`
*   用 `timingSafeEqual` 常量时间比对（先比长度）；四个校验都在路由判定之前；
* - 请求体有上限（默认 64 MiB），超限回 413 并 drain，不拆 socket；
* - 客户端断连的取消监听 `res.on('close')`（不是 `req.on('close')`）。
*
* 职责（阶段二）：按 `channelOf(modelId)` 把 OpenAI 聊天请求分流：
* - `longcat` → 调 `createLongcatClient().chat(body, signal, thinkLongcat)` 转发，
*   并把 `Config.thinkLongcat` 传入（F9 官方侧「深度思考」开关真正生效）；
* - `catpaw` → 调 `createChannelBUpstream().chat()` 走本地 Agent Server
*   （施工队模式）。工作目录由请求体 `workingDir` 带给妙手。
*   失败时**仍返回 HTTP 200** + 结构化错误体
*   `{ error: { code: 'CHANNEL_B_UNAVAILABLE', message } }`：
*   用 200 而非 5xx 是刻意的，避免宿主把它当成网络故障原地重试。
*
* 本文件不读本机凭据文件、不拼私有请求头、不改写上游路径、不解 SSE
* （SSE 解析在 `catpaw-agent.ts`）。
*
* 用户可见文案一律「妙手」；技术标识（`catpaw/` 前缀等）原样保留。
*
* @module dsh-connect-catpaw/shim
*/
/** 请求体字节上限（默认 64 MiB，对齐 qoder 同款安全模型）。测试可注入小值。 */
const REQUEST_BODY_LIMIT = 67108864;
/** 入站 Content-Type 必须是 application/json（挡 simple-request CSRF）。 */
const CONTENT_TYPE_JSON = "application/json";
/** 官方通道限流：HTTP 429。只认这个状态码，其它一律不特殊处理。 */
const RATE_LIMIT_STATUS = 429;
/**
* 429 归一化后的错误文本：必须同时含 `429` 与 `rate_limit`。
*
* 为什么：宿主 `dsh-llm-pi-ai` 的 `classifyPiAiError(text)` 靠文本匹配
* `/\b429\b|rate.?limit/i` 归类为 `RATE_LIMIT`，上层 `dsh-llm-retry` 才会按
* 5 次 / 指数退避重新发起请求。若上游 429 响应体没有这两个字样，宿主会把限流
* 当成普通错误，用户就得手动重试。
*/
const RATE_LIMIT_BODY = JSON.stringify({ error: {
	code: "rate_limit_exceeded",
	message: "longcat upstream answered 429 (rate_limit_exceeded)",
	type: "rate_limit_error"
} });
/** Host 必须严格指向回环（防 DNS rebinding）。 */
function checkHost(req) {
	const host = req.headers.host ?? "";
	return /^127\.0\.0\.1:\d+$/.test(host);
}
/**
* Origin 若存在必须指向回环。非浏览器客户端（pi-ai / 插件自己）不发 Origin，
* 直接放行；DNS-rebinding 页面可伪造 Host，但 Origin 会暴露真实域名。
*/
function originIsLoopback(origin) {
	if (origin === void 0 || origin === "") return true;
	try {
		const url = new URL(origin);
		return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
	} catch {
		return false;
	}
}
/** Authorization: Bearer <secret> —— 常量时间比对（长度不同直接拒绝）。 */
function checkAuthorization(req, expected) {
	const header = req.headers.authorization;
	if (typeof header !== "string") return false;
	const match = /^Bearer (.+)$/.exec(header);
	if (!match) return false;
	const actual = Buffer.from(match[1] ?? "");
	if (actual.length !== expected.length) return false;
	return timingSafeEqual(actual, expected);
}
/** GET 免检 Content-Type；其它方法必须 application/json。 */
function checkContentType(req) {
	if (req.method === "GET") return true;
	const ct = req.headers["content-type"] ?? "";
	return String(ct).startsWith(CONTENT_TYPE_JSON);
}
/** 读取请求体，超过 limit 抛 'request body too large'（并 drain 而不是 destroy）。 */
function readBody(req, limit) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		let over = false;
		req.on("data", (chunk) => {
			if (over) return;
			size += chunk.length;
			if (size > limit) {
				over = true;
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.resume();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (!over) resolve(Buffer.concat(chunks).toString("utf8"));
		});
		req.on("error", reject);
	});
}
/** OpenAI 形状 JSON 错误体；`res` 已结束/销毁时静默跳过。 */
function writeJson$1(res, status, body) {
	if (res.writableEnded || res.destroyed) return;
	const text = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(text)
	});
	res.end(text);
}
/**
* 从 OpenAI 请求体里取最后一条 user 文本（content 可能是字符串或数组）。
*
* 兼容两种 content 形状：
* - `"content": "纯文本"`；
* - `"content": [{ type: 'text', text: '...' }, ...]`（多段，只拼 text 段）。
* 取**最后一条** user 消息：多轮历史里最新那条才是本轮输入。
*/
function extractUserText(body) {
	const messages = body.messages;
	if (!Array.isArray(messages)) return "";
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message === null || message === void 0) continue;
		if (message.role !== "user") continue;
		const content = message.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const parts = [];
			for (const part of content) {
				if (typeof part !== "object" || part === null) continue;
				const piece = part;
				if (typeof piece.text === "string") parts.push(piece.text);
			}
			return parts.join("");
		}
		return "";
	}
	return "";
}
/**
* 宿主注入的工作目录行（`@deepseek-ai/dsh-working-directory` 的 system prompt 上下文）。
*
* 宿主的实现是：
*   `Current working directory: ${JSON.stringify(directory)}.`
* 且该上下文标记 `required: true`，所以**每个请求都会带**。
* 这是 0.2.1 的关键修复：0.2.0 只读 `body.workingDir`，而标准 OpenAI 请求里没有这个字段。
*/
const WORKDIR_PATTERN = /Current working directory:\s*("(?:[^"\\]|\\.)*")/;
/**
* 从请求体里取会话工作目录。
*
* 优先级：
*   1. `body.workingDir`（显式传参，兼容旧行为与测试注入）；
*   2. `messages` 里宿主注入的 `Current working directory: "…".`
*
* 都拿不到时返回 `undefined` —— **绝不回落到 `process.cwd()`**：
* 那会让妙手在错误的目录里执行工具，用户看到不相干的文件却以为"通道坏了"。
*
* @param body - 已解析的 OpenAI 请求体。
* @returns 绝对路径，或 `undefined`（表示"不知道"）。
*/
function extractWorkingDir(body) {
	const explicit = body.workingDir;
	if (typeof explicit === "string" && explicit.trim() !== "") return explicit;
	const messages = body.messages;
	if (!Array.isArray(messages)) return void 0;
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message === null || message === void 0) continue;
		const found = matchWorkingDirIn(message.content);
		if (found !== void 0) return found;
	}
}
/** 在单条消息的 content（字符串或多段数组）里找工作目录行。 */
function matchWorkingDirIn(content) {
	if (typeof content === "string") return parseWorkingDirText(content);
	if (!Array.isArray(content)) return void 0;
	for (let i = content.length - 1; i >= 0; i -= 1) {
		const part = content[i];
		if (typeof part !== "object" || part === null) continue;
		const text = part.text;
		if (typeof text !== "string") continue;
		const found = parseWorkingDirText(text);
		if (found !== void 0) return found;
	}
}
/** 用正则取出 JSON 字符串字面量并还原成路径。 */
function parseWorkingDirText(text) {
	const match = WORKDIR_PATTERN.exec(text);
	if (match === null) return void 0;
	try {
		const value = JSON.parse(match[1]);
		if (typeof value === "string" && value.trim() !== "") return value;
	} catch {}
}
/**
* 判断一个上游 Response 是否为「尚未吐字」的 429。
*
* `!bodyUsed` 是安全边界：只处理一个字都还没开始流的 429；
* 已经开始流式后绝不改写，否则会破坏已输出的流（用户会看到两段重复的话）。
*/
function isFreshRateLimit(response) {
	return response.status === RATE_LIMIT_STATUS && !response.bodyUsed;
}
/** 从 429 响应体里读 retry_after（秒）；读不到返回 undefined。 */
function parseRetryAfter(raw) {
	try {
		const value = JSON.parse(raw).error?.retry_after;
		return typeof value === "number" && Number.isFinite(value) ? value : void 0;
	} catch {
		return;
	}
}
/**
* 写回一个「宿主可正确归类」的 429 响应。
*
* 不抛 error：shim 是 HTTP 服务，throw 只会被本文件的 catch 变成 502，到不了宿主。
* 关键是让 **HTTP 429 响应本身**带含 `429`/`rate_limit` 的错误文本 + `Retry-After` 头，
* 由宿主 `dsh-llm-retry` 按 5 次 / 指数退避接手重试。
*
* `Retry-After` 封顶 8s：上游可能给 60，直接透传会让宿主死等；取 1–8s。
*/
function writeRateLimitResponse(res, raw) {
	if (res.writableEnded || res.destroyed) return;
	const hint = parseRetryAfter(raw);
	const retryAfter = hint === void 0 ? 1 : Math.min(Math.max(hint, 1), 8);
	res.writeHead(RATE_LIMIT_STATUS, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": String(Buffer.byteLength(RATE_LIMIT_BODY, "utf8")),
		"Retry-After": String(retryAfter)
	});
	res.end(RATE_LIMIT_BODY);
}
/**
* 创建回环 shim。`server.listen(0, '127.0.0.1')` 在返回前就发出，
* `ready` 在端口确定后 resolve；`baseUrl()` 逐次读 `server.address()`，
* 所以 adapter 每次构建模型描述符时都能拿到最终端口。
*/
function createShim(options) {
	const secret = randomBytes(32).toString("base64url");
	const secretBuf = Buffer.from(secret);
	const log = options.logger ?? (() => {});
	const bodyLimit = options.requestBodyLimit ?? REQUEST_BODY_LIMIT;
	const makeLongcat = options.createLongcat ?? createLongcatClient;
	const makeChannelB = options.createChannelB ?? createChannelBUpstream;
	let baseUrlValue = "";
	let closeFn = async () => {};
	const ready = new Promise((resolveReady, rejectReady) => {
		const server = createServer((req, res) => {
			const controller = new AbortController();
			res.on("close", () => {
				if (!res.writableEnded) controller.abort();
			});
			handleRequest(req, res, controller.signal).catch((error) => {
				writeJson$1(res, 500, { error: {
					message: String(error?.message ?? "internal error"),
					code: "internal_error",
					type: "shim_error"
				} });
			});
		});
		server.on("error", rejectReady);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			baseUrlValue = `http://127.0.0.1:${addr.port}`;
			addr.port;
			resolveReady();
		});
		closeFn = () => new Promise((resolve, reject) => {
			server.close((error) => error ? reject(error) : resolve());
		});
	});
	/** 官方通道客户端惰性构造（apiKey 只在这里取，不写日志、不回显）。 */
	function longcat() {
		const key = options.apiKey();
		if (key === void 0 || key === "") throw new Error("未配置 LongCat API Key：请在插件设置里填写，或设置环境变量");
		const init = { apiKey: key };
		if (options.fetchFn !== void 0) init.fetchFn = options.fetchFn;
		return makeLongcat(init);
	}
	/** B 通道 upstream 惰性构造（测试可经 `createChannelB` 注入替身）。 */
	function channelB() {
		const init = {};
		if (options.fetchFn !== void 0) init.fetchFn = options.fetchFn;
		return makeChannelB(init);
	}
	async function handleRequest(req, res, signal) {
		if (!checkHost(req)) {
			writeJson$1(res, 403, { error: {
				message: "bad host",
				code: "host_not_allowed"
			} });
			return;
		}
		if (!originIsLoopback(req.headers.origin)) {
			writeJson$1(res, 403, { error: {
				message: "Origin must be a loopback origin",
				code: "origin_not_allowed"
			} });
			return;
		}
		if (!checkAuthorization(req, secretBuf)) {
			writeJson$1(res, 401, { error: {
				message: "invalid api key",
				code: "invalid_api_key"
			} });
			return;
		}
		if (!checkContentType(req)) {
			writeJson$1(res, 415, { error: {
				message: "unsupported media type",
				code: "invalid_request_error"
			} });
			return;
		}
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/healthz/")) {
			writeJson$1(res, 200, { ok: true });
			return;
		}
		if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
			await handleChat(req, res, signal);
			return;
		}
		writeJson$1(res, 404, { error: {
			message: "not found",
			code: "invalid_request_error"
		} });
	}
	async function handleChat(req, res, signal) {
		let raw;
		try {
			raw = await readBody(req, bodyLimit);
		} catch (error) {
			if (error.message === "request body too large") {
				writeJson$1(res, 413, { error: {
					message: "request body too large",
					code: "invalid_request_error"
				} });
				return;
			}
			throw error;
		}
		let body;
		try {
			body = JSON.parse(raw);
		} catch {
			writeJson$1(res, 400, { error: {
				message: "invalid JSON body",
				code: "invalid_request_error"
			} });
			return;
		}
		const modelId = typeof body.model === "string" ? body.model : "";
		const channel = channelOf(modelId);
		if (channel === "catpaw") {
			const upstream = channelB();
			const chatRequest = {
				workingDir: extractWorkingDir(body),
				text: extractUserText(body),
				signal
			};
			if (typeof body.conversationId === "string") chatRequest.conversationId = body.conversationId;
			streamChannelBResult(res, await upstream.chat(chatRequest), wantsStream(body));
			return;
		}
		if (channel !== "longcat") {
			writeJson$1(res, 404, { error: {
				message: "unknown model channel",
				code: "invalid_request_error"
			} });
			return;
		}
		try {
			const thinkLongcat = options.thinkLongcat();
			const upstreamBody = {
				...body,
				model: stripPrefix(modelId)
			};
			const upstream = await longcat().chat(upstreamBody, signal, thinkLongcat);
			if (isFreshRateLimit(upstream)) {
				const raw = await upstream.clone().text().catch(() => "");
				log(`catpaw longcat rate limited (429): retry_after=${parseRetryAfter(raw) ?? "none"}`);
				await upstream.text().catch(() => {});
				writeRateLimitResponse(res, raw);
				return;
			}
			forwardUpstream(res, upstream);
		} catch (error) {
			const message = String(error?.message ?? "upstream error");
			log(`longcat upstream error: ${message.replace(/pt-[A-Za-z0-9]+/g, "[redacted]")}`);
			writeJson$1(res, 502, { error: {
				message: "upstream error",
				code: "upstream_error",
				type: "shim_error"
			} });
		}
	}
	/**
	* 把 B 通道结果按 OpenAI **流式**形状写给宿主。
	*
	* 为什么必须流式：DSH 用 `stream:true` 请求并按 SSE 解析，收到裸 JSON 时会报
	* `Stream ended without finish_reason`。失败也走同一形状（带 `error` 帧），
	* 否则宿主同样解析不到 `finish_reason`。
	*/
	function streamChannelBResult(res, result, streaming) {
		if (res.writableEnded || res.destroyed) return;
		const created = Math.floor(Date.now() / 1e3);
		const id = `chatcmpl-${Date.now()}`;
		if (!streaming) {
			if (!result.ok) {
				log(`catpaw channel unavailable: ${result.error ?? "unknown"}`);
				writeJson$1(res, 200, { error: {
					code: "CHANNEL_B_UNAVAILABLE",
					message: result.error ?? "通道 B 不可用"
				} });
				return;
			}
			writeJson$1(res, 200, {
				id,
				object: "chat.completion",
				created,
				model: result.modelName || "LongCat-2.5",
				choices: [{
					index: 0,
					message: {
						role: "assistant",
						content: result.text
					},
					finish_reason: "stop"
				}],
				usage: {
					prompt_tokens: 0,
					completion_tokens: 0,
					total_tokens: 0
				}
			});
			return;
		}
		res.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no"
		});
		const send = (payload) => {
			if (res.writableEnded || res.destroyed) return;
			res.write(`data: ${JSON.stringify(payload)}\n\n`);
		};
		const finish = () => {
			if (res.writableEnded || res.destroyed) return;
			res.write("data: [DONE]\n\n");
			res.end();
		};
		if (!result.ok) {
			log(`catpaw channel unavailable: ${result.error ?? "unknown"}`);
			send({ error: {
				code: "CHANNEL_B_UNAVAILABLE",
				message: result.error ?? "通道 B 不可用"
			} });
			finish();
			return;
		}
		const model = result.modelName || "LongCat-2.5";
		if (result.text !== "") send({
			id,
			object: "chat.completion.chunk",
			created,
			model,
			choices: [{
				index: 0,
				delta: { content: result.text },
				finish_reason: null
			}]
		});
		send({
			id,
			object: "chat.completion.chunk",
			created,
			model,
			choices: [{
				index: 0,
				delta: {},
				finish_reason: "stop"
			}],
			usage: {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0
			}
		});
		finish();
	}
	/** 请求体是否要求流式（缺省按 true：DSH 一律流式）。 */
	function wantsStream(body) {
		return body.stream !== false;
	}
	/** 把官方客户端的响应（含 SSE 流）转回 OpenAI 客户端。 */
	function forwardUpstream(res, upstream) {
		if (res.writableEnded || res.destroyed) return;
		const headers = {};
		upstream.headers.forEach((value, key) => {
			headers[key] = value;
		});
		res.writeHead(upstream.status, headers);
		if (upstream.body === null || upstream.bodyUsed) {
			res.end();
			return;
		}
		const reader = upstream.body.getReader();
		const pump = () => {
			reader.read().then(({ done, value }) => {
				if (done) {
					if (!res.writableEnded) res.end();
					return;
				}
				if (res.destroyed) {
					reader.cancel();
					return;
				}
				if (!res.write(value)) res.once("drain", pump);
				else pump();
			}).catch(() => {
				if (!res.writableEnded) res.end();
			});
		};
		pump();
	}
	return {
		ready,
		baseUrl: () => baseUrlValue,
		token: () => secret,
		close: async () => {
			await closeFn();
		}
	};
}
// src/adapter.ts
/**
* pi-ai provider 组装：把回环 shim 包成一个 DSH 可注册的 `PiAiAdapter`。
*
* 以 qoder `src/adapter.ts` 为**结构参照**独立重写（未复制其源码）：
* - `createProvider({ id: PROVIDER_ROUTE, api: openAICompletionsApi(),
*   models: buildModels(), ... })`：模型描述符的 `baseUrl` 逐次读
*   `shim.baseUrl()`，所以随机端口在第一次快照时就生效；
* - `getModels` 委托给「活读」，目录刷新立刻生效；
* - `new PiAiAdapter({ resolveApiKey: () => shim.token(), auth: INERT_AUTH, ... })`：
*   pi-ai 全程走 inert 凭据生命周期，只拿 shim 的进程内 secret 当 apiKey；
* - `piAiRuntimeInfo()` 世代门控：阶段一固定 `'modern'`。
*
* 阶段一边界（硬）：
* - `buildModels()` 只取官方前缀（`longcat/`）模型，目录 = `LONGCAT_CATALOG_FALLBACK`
*   与运行时 `listModels()` 结果合并去重；
* - **不含 catpaw 模型、不含档位/思考字段**（不写 `reasoning` / `thinkingLevelMap`
*   / `contextTiers`，不注册任何档位到聊天界面槽位）；
* - 不臆测宿主 pi-ai 世代，阶段三按宿主实测再校准。
*
* @module dsh-connect-catpaw/adapter
*/
/**
* Provider route 与显示名（DSH 模型选择器）。
*
* `CATPAW_PROVIDER_DISPLAY_NAME` 是选择器里那一组的**分组标题**
* （`registerConfigurableProviders` 的 `displayName` → 宿主 `group.name`）。
* 模型行本身显示的是 `model.name`（= 带前缀的 `info.id`），两者不是一个东西。
*
* `CATPAW_PROVIDER` 是路由键，**永不改名** —— 改了 provider 就注册不上，
* 已存的模型选择也会全部失效。
*/
const CATPAW_PROVIDER = PROVIDER_ROUTE;
const CATPAW_PROVIDER_DISPLAY_NAME = "catpaw2dsh";
/** 流空闲上限，对齐 qoder/workbuddy 同款 300s。 */
const CATPAW_STREAM_IDLE_TIMEOUT_MS = 3e5;
/** 订阅额度无从定价：cost 全 0。 */
const NO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0
};
/**
* 图像请求预算（dsh-llm-pi-ai 默认值）。本插件手工组装 profile，不经过宿主的
* `resolveProfile`，故这些「必填」字段必须显式给出，否则整条 route 缺省计数边界。
* 数值对齐宿主 0.2.2-rc.1 的默认值。
*/
const REQUEST_IMAGE_BUDGETS = {
	maxRequestImageBytes: 20971520,
	requestImagePixelBudget: 4194304,
	requestImageMaxBytes: 1048576,
	maxRequestImages: 50,
	imageOffloadCountQuantum: 10
};
/**
* Inert pi-ai auth plane：本 route 只通过 shim secret 认证，pi-ai 自己的凭据
* 发现/持久化机制一律不参与（否则 secret 会被写进环境凭据存储，传播边界就散了）。
*/
const INERT_AUTH = {
	credentials: {
		async read() {},
		async list() {
			return [];
		},
		async modify() {}
	},
	authContext: {}
};
/**
* pi-ai 世代门控。
*
* 阶段一**固定** `'modern'`：qoder 的 `piAiRuntimeInfo()` 用 `import.meta.resolve`
* 探测实际解析到的 pi-ai manifest 版本，legacy(0.85) 才需要把归一化的 transcript
* 折回扁平形态。本阶段不臆测宿主实际版本，也不做版本探测——
* **阶段三按宿主实测再校准**（若宿主实测为 legacy，再补 `withLegacyContext` 的
* 0.85 折叠分支）。modern 分支即直通，不引入任何上下文改写。
*/
function piAiRuntimeInfo() {
	return { generation: "modern" };
}
/**
* 世代门控的 api 包装。阶段一 modern = 原样返回（`openAICompletionsApi()`），
* 不改写 transcript；legacy 折叠留到阶段三按实测补上。
*/
function withLegacyContext(api, generation) {
	if (generation === "legacy") return api;
	return api;
}
/**
* 官方目录合成：静态 fallback 与运行时 `listModels()` 合并，按 id 去重。
* 只保留官方前缀（`provider === 'longcat'`），**绝不**让 catpaw 占位模型进入
* DSH 的模型选择器；档位字段在此被彻底丢弃（F10 只针对通道 B）。
*/
function officialCatalog(liveModels) {
	const merged = /* @__PURE__ */ new Map();
	for (const entry of LONGCAT_CATALOG_FALLBACK) merged.set(entry.id, entry);
	for (const entry of liveModels()) {
		if (entry.provider !== "longcat") continue;
		merged.set(entry.id, entry);
	}
	return [...merged.values()];
}
/** 把一个官方 CatalogEntry 映射成 pi-ai 模型描述符（不含任何档位/思考字段）。 */
function toPiModel(info, baseUrl, providerId) {
	return {
		id: info.id,
		name: info.id,
		api: "openai-completions",
		provider: providerId,
		baseUrl,
		input: info.input,
		cost: NO_COST,
		contextWindow: info.contextWindow,
		maxTokens: info.maxTokens,
		reasoning: false,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsMidConvoSystemMessages: false
		}
	};
}
/**
* 组装适配器。`getModels` 委托活读，使目录刷新立刻生效；baseUrl 逐次重新
* 解析，保证 shim 的临时端口在第一个快照时就正确。
*/
function createAdapter(options) {
	const { shim } = options;
	const providerId = options.provider ?? CATPAW_PROVIDER;
	const providerName = options.displayName ?? "catpaw2dsh";
	const liveModels = options.liveModels ?? (() => []);
	const generation = piAiRuntimeInfo().generation;
	const api = withLegacyContext(openAICompletionsApi(), generation);
	const buildModels = () => {
		const baseUrl = `${shim.baseUrl()}/v1`;
		const official = officialCatalog(liveModels).map((info) => toPiModel(info, baseUrl, providerId));
		const channelB = isChannelBEnabled() ? CATPAW_CATALOG.map((info) => toPiModel(info, baseUrl, providerId)) : [];
		return [...official, ...channelB];
	};
	const provider = {
		...createProvider({
			id: providerId,
			name: providerName,
			auth: { apiKey: {
				name: "Catpaw shim token",
				async resolve({ credential }) {
					const apiKey = credential?.key;
					return {
						auth: apiKey === void 0 || apiKey.length === 0 ? {} : { apiKey },
						source: "Catpaw shim token"
					};
				}
			} },
			models: buildModels(),
			api
		}),
		getModels: () => buildModels()
	};
	const profile = {
		provider: providerId,
		displayName: providerName,
		streamIdleTimeoutMs: CATPAW_STREAM_IDLE_TIMEOUT_MS,
		retryPolicy: resolveRetryPolicy(void 0, "dsh-connect-catpaw retryPolicy"),
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		modelErrors: /* @__PURE__ */ new Map(),
		...REQUEST_IMAGE_BUDGETS,
		piProvider: provider
	};
	let profiles = /* @__PURE__ */ new Map([[providerId, profile]]);
	return {
		adapter: new PiAiAdapter({
			profiles: () => profiles,
			auth: INERT_AUTH,
			resolveApiKey: async () => shim.token(),
			...options.resolveAttachments === void 0 ? {} : { resolveAttachments: options.resolveAttachments }
		}),
		invalidate: () => {
			profiles = /* @__PURE__ */ new Map([[providerId, profile]]);
		},
		piAiGeneration: generation
	};
}
// src/status-paths.ts
const STATUS_PATH = "/api/dsh-connect-catpaw/status";
const TABS_PATH = "/api/dsh-connect-catpaw/tabs";
const REFRESH_PATH = "/api/dsh-connect-catpaw/refresh";
// src/web-status.ts
/**
* `modelDetailSource` 聚合规则（决策 2）：
* - 全部 `detailSource === 'live'` → 'live'
* - 全部 `detailSource === 'fallback'` → 'fallback'
* - 混合 / 部分失败 → 'partial'
* - 空目录 → 'fallback'（保守：无实时证据）
*/
function aggregateDetailSource(models) {
	if (models.length === 0) return "fallback";
	let live = 0;
	let fallback = 0;
	for (const model of models) if (model.detailSource === "live") live += 1;
	else fallback += 1;
	if (live === models.length) return "live";
	if (fallback === models.length) return "fallback";
	return "partial";
}
/** 官方 tab：credits 恒 null（决策 1）、models 来自 listModels()、placeholder:false。 */
async function buildOfficialTab(deps) {
	let models = [];
	try {
		models = await deps.longcat().listModels();
	} catch {
		models = deps.liveModels().filter((model) => model.provider === "longcat");
	}
	return {
		channel: "longcat",
		credits: null,
		models,
		modelDetailSource: aggregateDetailSource(models),
		placeholder: false
	};
}
/** B tab：模型名 + 可用状态（plan.md §2.3）。 */
async function buildCatpawTab() {
	const upstream = createChannelBUpstream();
	let probe = {
		available: false,
		modelName: CATPAW_MODEL_NAME,
		reason: "未检测"
	};
	try {
		probe = await upstream.probe();
	} catch (error) {
		probe = {
			available: false,
			modelName: CATPAW_MODEL_NAME,
			reason: String(error?.message ?? "检测失败")
		};
	}
	return {
		channel: "catpaw",
		credits: null,
		models: probe.available ? CATPAW_CATALOG : [],
		placeholder: false,
		probe
	};
}
/** GET 三路由共用的 TabView[] 文档。 */
async function buildTabs(deps) {
	const [official, catpaw] = await Promise.all([buildOfficialTab(deps), buildCatpawTab()]);
	return [official, catpaw];
}
function writeJson(res, status, body) {
	if (res.writableEnded || res.destroyed) return;
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
/**
* 挂载 /status、/tabs、/refresh 三条同源精确路由。
* 返回统一 disposer；index.ts 把它挂进 ⑨ 的集中释放。
*/
function registerCatpawWebRoutes(ctx, deps) {
	const web = ctx.webServer;
	const disposers = [];
	const mount = (path, handler) => {
		try {
			const dispose = web.register({
				kind: "exact",
				path,
				handler
			});
			if (typeof dispose === "function") disposers.push(dispose);
		} catch {}
	};
	mount(STATUS_PATH, async (req, res) => {
		if (req.method !== "GET") return writeJson(res, 405, { error: "method not allowed" });
		return writeJson(res, 200, await buildTabs(deps));
	});
	mount(TABS_PATH, async (req, res) => {
		if (req.method !== "GET") return writeJson(res, 405, { error: "method not allowed" });
		return writeJson(res, 200, await buildTabs(deps));
	});
	mount(REFRESH_PATH, async (req, res) => {
		if (req.method !== "POST") return writeJson(res, 405, { error: "method not allowed" });
		try {
			await deps.refreshOfficial();
		} catch {}
		const [official, catpaw] = await Promise.all([buildOfficialTab(deps), buildCatpawTab()]);
		return writeJson(res, 200, [official, catpaw]);
	});
	return () => {
		for (const dispose of disposers) try {
			dispose();
		} catch {}
	};
}
// src/index.ts
/**
* Cordis 依赖门（Host 半侧）。
*
* **`llm` 必须声明。** 本插件在 `apply` 里直接访问 `ctx.llm.registerAdapter` /
* `registerConfigurableProviders` / `registerModelDiscovery`；Cordis 对未声明
* 的服务做**抛错式**访问保护（`cannot get property "llm" without inject`），
* 于是 `apply` 一进来就失败 —— provider 从未注册，模型选择器里自然没有本插件
* 的模型，而且界面上只表现为"没有选项"，不会红屏。
*
* 官方 `llm-pi-ai` 同样写 `export const inject = ['llm']`（宿主源码
* `packages/llm/llm-pi-ai/src/index.ts:95`），这是这条 seam 的既定写法。
*
* `settings` / `webServer` **不**写进来：它们是可选的（`ctx.inject([...])`
* 软探测），缺席时插件仍应工作（只是设置页/路由降级）。
*/
const inject = ["llm"];
/** 官方 tab 显示名（与 provider 显示名一致；用户可见文案「妙手」）。 */
const DISPLAY_NAME = CATPAW_PROVIDER_DISPLAY_NAME;
/**
* settings 命名空间探测（BLUEPRINT §2(d)）：`ctx.fiber.entry?.options.id` 是
* Loader 条目 id，不是插件自选名；探测失败（无 Loader，如测试直接 ctx.plugin()）
* 时回落到 `PLUGIN_ID`。宿主精确匹配查表，猜错会让 provider 被判「未配置」。
*/
function settingsNamespaceOf(ctx) {
	const id = ctx?.fiber?.entry?.options?.id;
	return typeof id === "string" && id !== "" ? id : PLUGIN_ID;
}
/**
* 读取一个配置字段的当前值。
*
* 标了 `.volatile()` 的字段（设置页可编辑的那些）在运行期是 `Volatile<T>`
* 包装对象（带 `.get()`），**不是**解包后的值 —— 直接 `config.apiKey` 会拿到
* 一个对象，`typeof` 判断、`=== true` 比较全部失效。
*
* 这里统一解包：有 `.get()` 就调用，否则原样返回。宿主自己也是这么读的
* （`settings` 服务里用 `plainConfig` 递归 `.get()`）。
*/
function readConfig(value) {
	if (value !== null && typeof value === "object" && typeof value.get === "function") return value.get();
	return value;
}
/** 官方 API Key：设置卡优先，环境变量兜底；永不写日志、永不回显。 */
function resolveApiKey(config) {
	const fromSettings = readConfig(config.apiKey);
	if (typeof fromSettings === "string" && fromSettings.length > 0) return fromSettings;
	const fromEnv = typeof process !== "undefined" ? process.env[KEY_ENV_VAR] : void 0;
	return typeof fromEnv === "string" ? fromEnv : "";
}
/**
* 插件入口。宿主按 `apply(ctx, config)` 同步调用；其中 `await shim.ready` 起的
* 注册链放在一个异步 IIFE 里（与 BLUEPRINT §2 的 `Promise.all(shims.ready).then`
* 等价），这样 apply 仍是 `void` 签名，但装配严格按 ①→⑨ 顺序。
*/
function apply(ctx, config) {
	const host = ctx;
	const settingsNs = settingsNamespaceOf(ctx);
	const log = (message) => host.logger.warn(`dsh-connect-catpaw: ${message}`);
	/** 运行时目录（活读）：⑧ 异步刷新后写这里，adapter / modelDiscovery 都读它。 */
	let liveModels = [];
	/** 目录刷新后的失效回调（③ 产物）。 */
	let invalidate;
	/** 所有注册句柄的 dispose 集中在这里，由 ⑨ 的单一 ctx.effect 统一释放。 */
	const disposers = [];
	let disposed = false;
	const release = () => {
		if (disposed) return;
		disposed = true;
		for (const dispose of disposers) try {
			dispose();
		} catch {}
		shim.close();
	};
	const shim = createShim({
		thinkLongcat: () => readConfig(config.thinkLongcat) === true,
		apiKey: () => resolveApiKey(config)
	});
	host.effect(() => () => release());
	host.inject(["settings"], (sctx) => {
		const settings = sctx.settings;
		if (settings === void 0) return;
		host.effect(() => settings.configure({ auto: true }, ctx.fiber));
	});
	host.inject(["webServer"], (ctxWithWeb) => {
		const dispose = registerCatpawWebRoutes(ctxWithWeb, {
			longcat: () => createLongcatClient({ apiKey: resolveApiKey(config) }),
			liveModels: () => officialModels(),
			refreshOfficial: async () => {
				await refreshCatalog();
				return officialModels();
			}
		});
		if (typeof dispose === "function") disposers.push(dispose);
	});
	/** 官方模型集合（fallback ∪ 运行时 listModels），按 id 去重，仅 longcat 前缀。 */
	function officialModels() {
		const merged = /* @__PURE__ */ new Map();
		for (const entry of LONGCAT_CATALOG_FALLBACK) merged.set(entry.id, entry);
		for (const entry of liveModels) {
			if (entry.provider !== "longcat") continue;
			merged.set(entry.id, entry);
		}
		return [...merged.values()];
	}
	/** ⑧ 异步 listModels() 刷新目录；失败回落空活读（fallback 仍在）。 */
	async function refreshCatalog() {
		try {
			liveModels = await createLongcatClient({ apiKey: resolveApiKey(config) }).listModels();
			invalidate?.();
		} catch (error) {
			log(`catalog refresh failed: ${String(error?.message ?? "unknown")}`);
			liveModels = [];
		}
	}
	(async () => {
		await shim.ready;
		if (disposed) return;
		let attachmentStore;
		host.inject(["attachments"], (attachCtx) => {
			const service = attachCtx.attachments;
			if (service !== void 0) attachmentStore = service;
		});
		host.logger.info(`dsh-connect-catpaw: registering provider "${PROVIDER_ROUTE}" (settingsNs="${settingsNs}", shim=${shim.baseUrl()}, apiKeyPresent=${resolveApiKey(config).length > 0})`);
		const built = createAdapter({
			shim,
			liveModels: () => officialModels(),
			resolveAttachments: () => attachmentStore
		});
		invalidate = built.invalidate;
		const releaseAdapter = host.llm.registerAdapter([PROVIDER_ROUTE], built.adapter);
		disposers.push(releaseAdapter);
		host.logger.info(`dsh-connect-catpaw: adapter registered for "${PROVIDER_ROUTE}"`);
		const releaseDirectory = host.llm.registerConfigurableProviders([{
			provider: PROVIDER_ROUTE,
			displayName: DISPLAY_NAME,
			settingsNs,
			settingsPath: [],
			declared: false
		}]);
		disposers.push(releaseDirectory);
		const releaseDiscovery = host.llm.registerModelDiscovery(settingsNs, async (request) => {
			if (request.provider !== "dsh-connect-catpaw") return [];
			return officialModels().map((model) => ({
				id: model.id,
				name: model.name,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				inputModalities: model.input
			}));
		});
		disposers.push(releaseDiscovery);
		refreshCatalog();
	})().catch((error) => {
		host.logger.error("dsh-connect-catpaw: provider registration failed", error);
	});
}
export { Config, apply, inject, settingsNamespaceOf };
