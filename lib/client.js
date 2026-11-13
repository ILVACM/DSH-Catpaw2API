window.__ModuleLoader__.load({
	id: "dsh-connect-catpaw",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/routing.ts
		const PLUGIN_ID$1 = "dsh-connect-catpaw";
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
		// src/status-paths.ts
		const TABS_PATH = "/api/dsh-connect-catpaw/tabs";
		const REFRESH_PATH = "/api/dsh-connect-catpaw/refresh";
		/**
		* 本插件设置页在宿主设置导航里的分区 id，同时也是图标槽位的地址。
		*
		* 复用 PLUGIN_ID（= 'dsh-connect-catpaw'）而不是另写字面量：section 的 `id`
		* 与 `settings.section.icon` 的 `id` 必须**完全相同**才会命中（宿主按
		* `renderSlot('settings.section.icon', …, { only: row.id })` 精确匹配），
		* 复用同一个常量让这个配对是结构性的、而不是靠人记。
		*
		* 注意它**不是** Loader entry id 的拼写候选（那些见
		* {@link CATPAW_SETTINGS_NAMESPACE_CANDIDATES}）：这个 id 是我们自己拥有的，
		* 必须在任何部署形态下都稳定。
		*/
		const CATPAW_SETTINGS_SECTION_ID = PLUGIN_ID$1;
		/**
		* 宿主可能用于本插件设置表单的 Loader entry id 拼写，按优先级排列。
		*
		* `configForms.describe()` 按 **Loader entry id** 给表单命名，而 entry id 由
		* profile patch 决定 —— 所以必须**问**宿主实际服务了哪个，不能假设。
		* 观察到的拼写：裸包名、Desktop 宿主使用的 `include:` 包裹形式。
		*/
		const CATPAW_SETTINGS_NAMESPACE_CANDIDATES = [PLUGIN_ID$1, `include:${PLUGIN_ID$1}`];
		// src/client/format.ts
		/**
		* 展示层数字格式化（纯函数，无 DOM / 无 React 依赖，可直接单测）。
		*
		* @module dsh-connect-catpaw/client/format
		*/
		/** 1M = 1048576（2^20），不是 10^6。 */
		const TOKENS_PER_M = 1048576;
		/**
		* 把 token 数换算成 M 单位、保留 2 位小数。
		*
		* 用 2^20 而非 10^6：`contextWindow = 1048576` 正是 1×2^20，用 10^6 会显示成
		* `1.05M`，与官方文档写的 "1M" 对不上。
		*
		* @param n - token 数（可能来自上游，故接受 undefined / NaN）
		* @returns 形如 `1.00M` / `0.25M` 的字符串；非法或非正数返回 `—`
		*/
		function formatTokens(n) {
			if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "—";
			return `${(n / TOKENS_PER_M).toFixed(2)}M`;
		}
		// src/client/styles.ts
		/**
		* 设置卡样式（CSS 文本 + 自注入）。
		*
		* 全部颜色用宿主主题变量 + 十六进制回退值，明暗主题自动适配。
		* 注入写法参照 temp/dsh-connect-workbuddy-main/src/client/WorkBuddyCard.tsx:295-307。
		*
		* @module dsh-connect-catpaw/client/styles
		*/
		const CATPAW_CARD_CSS = `
/* ── 卡片外壳 ─────────────────────────────────────────── */
.catpaw-card {
  border: 1px solid var(--dsw-alias-border-l2, #36373b);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3, #202126);
  padding: 14px 16px;
  color: var(--dsw-alias-label-primary, #e6e6e6);
  font-size: 13px;
  line-height: 1.5;
}

/* ── 头部：标题 + tab 栏 ──────────────────────────────── */
.catpaw-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 10px;
}
.catpaw-card-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #e6e6e6);
}

/* ── tab 栏 ───────────────────────────────────────────── */
.catpaw-tabs { display: flex; gap: 4px; }
.catpaw-tabs button {
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 13px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #b3b3b3);
  cursor: pointer;
}
.catpaw-tabs button[aria-selected="true"] {
  background: var(--dsw-alias-bg-layer-1, #17181b);
  border-color: var(--dsw-alias-border-l2, #36373b);
  color: var(--dsw-alias-brand-primary, #5686fe);
  font-weight: 600;
}

/* ── 内容区 ───────────────────────────────────────────── */
.catpaw-tab-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
}

/* ── 模型列表 ─────────────────────────────────────────── */
.catpaw-model-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.catpaw-model-list > li {
  padding: 10px 0;
  border-top: 1px solid var(--dsw-alias-border-l2, #36373b);
}
.catpaw-model-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, #e6e6e6);
  overflow-wrap: anywhere;
}
.catpaw-model-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #999);
  font-variant-numeric: tabular-nums;
}

/* ── 兜底标记 ─────────────────────────────────────────── */
.catpaw-fallback {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #999);
  white-space: nowrap;
}

/* ── Key 输入行 ───────────────────────────────────────── */
.catpaw-key-row { display: flex; align-items: center; gap: 8px; }
.catpaw-key-row input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--dsw-alias-border-l2, #36373b);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 13px;
  background: var(--dsw-alias-bg-layer-2, #25262b);
  color: var(--dsw-alias-label-primary, #e6e6e6);
}

/* ── 深度思考开关行 ───────────────────────────────────── */
.catpaw-think {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary, #b3b3b3);
}
.catpaw-think button {
  border: 1px solid var(--dsw-alias-border-l2, #36373b);
  border-radius: 8px;
  padding: 3px 12px;
  font-size: 12px;
  background: var(--dsw-alias-bg-layer-2, #25262b);
  color: var(--dsw-alias-label-primary, #e6e6e6);
  cursor: pointer;
}

/* ── Credits 行（妙手 tab）────────────────────────────── */
.catpaw-credits {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary, #b3b3b3);
}

/* ── 按钮组（妙手 tab）───────────────────────────────── */
.catpaw-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ── 档位选择器行（妙手 tab）──────────────────────────── */
.catpaw-tier {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #b3b3b3);
}

/* ── 占位提示（妙手 tab）─────────────────────────────── */
.catpaw-placeholder {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #999);
}
`;
		if (typeof document !== "undefined") {
			const cssId = "dsh-connect-catpaw/client.css";
			const existing = document.querySelector(`style[data-plugin-css="${cssId}"]`);
			if (existing !== null) existing.textContent = CATPAW_CARD_CSS;
			else {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-connect-catpaw";
				tag.dataset.pluginCss = cssId;
				tag.textContent = CATPAW_CARD_CSS;
				document.head.appendChild(tag);
			}
		}
		// src/client/SettingsCard.tsx
		/**
		* 妙手 / LongCat 设置卡 —— 一张卡、两个独立 tab（§3.6 / §7-T5）。
		*
		* 结构参照（不复制源码）：temp/dsh-connect-workbuddy-main/src/client/WorkBuddyCard.tsx
		*   头部 —— 卡片外壳 / tab 栏 / 草稿态与保存流程的形态。
		* 本项目改动：
		*   1. 两个 tab 按通道分数据（longcat / catpaw），互不混显；
		*   2. 官方 tab 决策 1 后无余额 / 用量栏、决策 4b 后无档位选择器；
		*   官方 tab 每个模型只渲染两行：带前缀的模型名 + 「上下文/输入/输出」三个 x.xxM 数字
		*   （见 P1-code.md §3.4）；
		*   3. 阶段二：妙手 tab 改为「本地客户端通道复用」，只显示
		*   「当前模型」+「状态」两行 + 人工刷新按钮 + 风险提示（plan.md §2.3）；
		*   4. 官方 tab 的「深度思考」二值开关保留；妙手 tab 不再有开关 / 档位 / 额度；
		*   5. 所有读数 / 开关只在卡内，不 portal 到对话框输入区、
		*      不注册任何对话输入框 / 胶囊 / 徽标槽位。
		*
		* 用户可见文案一律「妙手」（§3.8）；技术标识（catpaw/ 等）原样保留。
		*
		* @module dsh-connect-catpaw/client/SettingsCard
		*/
		const TAB_LONGCAT = {
			id: "longcat",
			labelKey: "tab.longcat",
			showModelParams: true,
			showThinkSwitch: true
		};
		const TAB_CATPAW = {
			id: "catpaw",
			labelKey: "tab.catpaw",
			showModelParams: false,
			showThinkSwitch: false
		};
		const TABS = [TAB_LONGCAT, TAB_CATPAW];
		const STATUS_CHECKING = {
			state: "checking",
			modelName: "",
			reason: ""
		};
		function fallbackView(channel) {
			return channel === "longcat" ? {
				channel: "longcat",
				credits: null,
				models: LONGCAT_CATALOG_FALLBACK,
				modelDetailSource: "fallback",
				placeholder: false
			} : {
				channel: "catpaw",
				credits: null,
				models: [],
				placeholder: false,
				probe: {
					available: false,
					modelName: "",
					reason: "未检测"
				}
			};
		}
		function initialTabViews() {
			return [fallbackView("longcat"), fallbackView("catpaw")];
		}
		function asTabView(value) {
			if (typeof value !== "object" || value === null) return null;
			const v = value;
			if (v.channel !== "longcat" && v.channel !== "catpaw") return null;
			if (!Array.isArray(v.models)) return null;
			const view = {
				channel: v.channel,
				credits: v.credits ?? null,
				models: v.models,
				placeholder: v.placeholder === true
			};
			if (v.modelDetailSource !== void 0) view.modelDetailSource = v.modelDetailSource;
			if (v.probe !== void 0) view.probe = v.probe;
			return view;
		}
		/** /tabs 返回 TabView[]；/refresh 阶段一可能返回单个占位 TabView，两者都接受。 */
		function asTabViews(value) {
			const list = Array.isArray(value) ? value : [value];
			const out = [];
			for (const item of list) {
				const view = asTabView(item);
				if (view !== null) out.push(view);
			}
			return out.length > 0 ? out : null;
		}
		function mergeViews(prev, incoming) {
			const next = [...prev];
			for (const view of incoming) {
				const index = next.findIndex((v) => v.channel === view.channel);
				if (index >= 0) next[index] = view;
				else next.push(view);
			}
			return next;
		}
		function viewOf(views, channel) {
			return views.find((v) => v.channel === channel) ?? fallbackView(channel);
		}
		/** 从 B tab 的 probe 字段派生三态状态（不编造"可用"）。 */
		function statusOf(views) {
			const probe = viewOf(views, "catpaw").probe;
			if (probe === void 0) return {
				state: "unavailable",
				modelName: "",
				reason: "宿主未返回检测结果"
			};
			return {
				state: probe.available ? "available" : "unavailable",
				modelName: probe.modelName,
				reason: probe.reason
			};
		}
		function readBool(settingsScope, key, fallback) {
			const value = settingsScope?.read(key);
			return typeof value === "boolean" ? value : fallback;
		}
		function readString(settingsScope, key, fallback) {
			const value = settingsScope?.read(key);
			return typeof value === "string" ? value : fallback;
		}
		/** detailSource==='fallback' 或 modelDetailSource!=='live' 时标注「回落/兜底」。 */
		function isFallback(model, view) {
			return model.detailSource === "fallback" || view.modelDetailSource !== "live";
		}
		/** 决策 3：二值开关（开 / 关，无多档）。仅官方 tab 使用。 */
		function ThinkSwitch({ t, value, onToggle }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "catpaw-think",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("think.switch") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-pressed": value,
					onClick: () => onToggle(!value),
					children: value ? t("think.on") : t("think.off")
				})]
			});
		}
		/**
		* 官方 tab（showModelParams:true）。
		* 只显示模型列表 + 实时参数 + Key 入口 + 一个深度思考二值开关。
		* 决策 1：本分支不渲染任何余额 / 用量读数栏、也不放任何占位提示、
		* 不显示任何档位选择器；不要求刷新按钮。
		*/
		function OfficialTabBody({ t, view, showModelParams, showThinkSwitch, thinkValue, onThink, apiKey, onApiKey, onSaveKey }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "catpaw-tab-body catpaw-tab-longcat",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "catpaw-key-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "password",
							value: apiKey,
							placeholder: t("key.input"),
							onChange: (e) => onApiKey(e.currentTarget.value)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: onSaveKey,
							children: t("save")
						})]
					}),
					showModelParams ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "catpaw-model-list",
						children: view.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "catpaw-model-name",
							children: [model.name, isFallback(model, view) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "catpaw-fallback",
								children: [" · ", t("model.fallback.short")]
							}) : null]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "catpaw-model-meta",
							children: [
								t("model.context"),
								" ",
								formatTokens(model.contextWindow),
								" · ",
								t("model.input"),
								" ",
								formatTokens(model.contextWindow),
								" · ",
								t("model.output"),
								" ",
								formatTokens(model.maxTokens)
							]
						})] }, model.id))
					}) : null,
					showThinkSwitch ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ThinkSwitch, {
						t,
						value: thinkValue,
						onToggle: onThink
					}) : null
				]
			});
		}
		/**
		* 妙手 tab（阶段二「本地客户端通道复用」）。
		* 只有两行：「当前模型」+「状态」，外加人工刷新按钮与风险提示。
		* 不显示额度 / 档位 / 思考开关 / 登录入口 / 占位文案（plan.md §2.2）。
		*/
		function CatpawTabBody({ t, status, refreshing, onRefresh }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "catpaw-tab-body catpaw-tab-catpaw",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "catpaw-channelb-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "catpaw-channelb-label",
							children: t("channelb.model")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "catpaw-channelb-value",
							children: status.modelName || "—"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "catpaw-channelb-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "catpaw-channelb-label",
							children: t("channelb.status")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "catpaw-channelb-value",
							children: status.state === "checking" ? t("channelb.checking") : status.state === "available" ? `✅ ${t("channelb.available")}` : `❌ ${t("channelb.unavailable")}${status.reason ? ` — ${status.reason}` : ""}`
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "catpaw-actions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: onRefresh,
							disabled: refreshing,
							children: t("channelb.refresh")
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "catpaw-channelb-risk",
						children: t("channelb.risk")
					})
				]
			});
		}
		/**
		* 一张卡、两个独立 tab。数据按 channel 取，互不混显；所有读数 / 开关
		* 只在卡内渲染，不 portal 到对话框输入区。
		*
		* props 契约（DSH 0.1.7+）：宿主外壳已有自己的关闭 chrome，本卡不渲染关闭按钮，
		* 因此不解构 `close`；`settingsScope` 缺省时降级为只读并显示提示条。
		*/
		function SettingsCard({ t, settingsScope }) {
			const [active, setActive] = (0, react.useState)("longcat");
			const [tabViews, setTabViews] = (0, react.useState)(initialTabViews);
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [channelB, setChannelB] = (0, react.useState)(STATUS_CHECKING);
			const [thinkLongcat, setThinkLongcat] = (0, react.useState)(() => readBool(settingsScope, "thinkLongcat", true));
			const [apiKeyDraft, setApiKeyDraft] = (0, react.useState)(() => readString(settingsScope, "apiKey", ""));
			(0, react.useEffect)(() => {
				let cancelled = false;
				(async () => {
					try {
						const response = await fetch(TABS_PATH, { headers: { accept: "application/json" } });
						if (!response.ok) {
							if (!cancelled) setChannelB({
								state: "unavailable",
								modelName: "",
								reason: `状态接口返回 ${response.status}`
							});
							return;
						}
						const views = asTabViews(await response.json());
						if (cancelled || views === null) return;
						setTabViews((prev) => mergeViews(prev, views));
						setChannelB(statusOf(views));
					} catch (error) {
						if (!cancelled) setChannelB({
							state: "unavailable",
							modelName: "",
							reason: String(error?.message ?? "检测失败")
						});
					}
				})();
				return () => {
					cancelled = true;
				};
			}, []);
			/** 人工刷新：重新检测 B 通道状态。 */
			const onRefresh = (0, react.useCallback)(() => {
				setRefreshing(true);
				setChannelB((prev) => ({
					...prev,
					state: "checking"
				}));
				(async () => {
					try {
						const response = await fetch(REFRESH_PATH, {
							method: "POST",
							headers: { accept: "application/json" }
						});
						if (!response.ok) {
							setChannelB({
								state: "unavailable",
								modelName: "",
								reason: `状态接口返回 ${response.status}`
							});
							return;
						}
						const views = asTabViews(await response.json());
						if (views === null) {
							setChannelB({
								state: "unavailable",
								modelName: "",
								reason: "状态接口返回为空"
							});
							return;
						}
						setTabViews((prev) => mergeViews(prev, views));
						setChannelB(statusOf(views));
					} catch (error) {
						setChannelB({
							state: "unavailable",
							modelName: "",
							reason: String(error?.message ?? "检测失败")
						});
					} finally {
						setRefreshing(false);
					}
				})();
			}, []);
			const onThinkLongcat = (next) => {
				setThinkLongcat(next);
				settingsScope?.write("thinkLongcat", next);
			};
			const onSaveKey = () => {
				settingsScope?.write("apiKey", apiKeyDraft);
			};
			const tab = active === "longcat" ? TAB_LONGCAT : TAB_CATPAW;
			const view = viewOf(tabViews, tab.id);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "catpaw-card",
				children: [
					settingsScope === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						role: "status",
						style: {
							margin: "0 0 8px",
							padding: "6px 10px",
							borderRadius: 4,
							fontSize: 12,
							lineHeight: 1.5,
							color: "#8a4b00",
							background: "#fff4e5",
							border: "1px solid #f0c88a"
						},
						children: t("scope.unavailable")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "catpaw-card-header",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("card.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("nav", {
							className: "catpaw-tabs",
							role: "tablist",
							children: TABS.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "tab",
								"aria-selected": active === item.id,
								onClick: () => setActive(item.id),
								children: t(item.labelKey)
							}, item.id))
						})]
					}),
					tab.id === "longcat" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OfficialTabBody, {
						t,
						view,
						showModelParams: tab.showModelParams,
						showThinkSwitch: tab.showThinkSwitch,
						thinkValue: thinkLongcat,
						onThink: onThinkLongcat,
						apiKey: apiKeyDraft,
						onApiKey: setApiKeyDraft,
						onSaveKey
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CatpawTabBody, {
						t,
						status: channelB,
						refreshing,
						onRefresh
					})
				]
			});
		}
		// src/client/locales.ts
		const zhDict = {
			"card.title": "妙手 / LongCat 设置",
			"tab.longcat": "LongCat 官方",
			"tab.catpaw": "本地客户端通道复用",
			"refresh": "手动刷新",
			"key.input": "填 / 存 LongCat API Key",
			"think.switch": "深度思考",
			"think.on": "开",
			"think.off": "关",
			"save": "保存",
			"saved": "已保存",
			"nav.label": "妙手",
			"scope.unavailable": "无法读取插件配置（宿主未提供配置服务），当前为只读。",
			"model.context": "上下文",
			"model.input": "输入",
			"model.output": "输出",
			"model.fallback.short": "兜底",
			"channelb.model": "当前模型",
			"channelb.status": "状态",
			"channelb.available": "可用",
			"channelb.unavailable": "不可用",
			"channelb.checking": "检测中…",
			"channelb.refresh": "刷新状态",
			"channelb.risk": "该通道的模型会自行读取工作目录内文件并执行命令，其工具调用不受 DSH 控制。"
		};
		const enDict = {
			"card.title": "妙手 / LongCat Settings",
			"tab.longcat": "LongCat Official",
			"tab.catpaw": "本地客户端通道复用",
			"refresh": "Refresh",
			"key.input": "Enter / Save LongCat API Key",
			"think.switch": "Deep Thinking",
			"think.on": "On",
			"think.off": "Off",
			"save": "Save",
			"saved": "Saved",
			"nav.label": "妙手",
			"scope.unavailable": "Plugin settings are unavailable (host provides no config service); this view is read-only.",
			"model.context": "Context",
			"model.input": "Input",
			"model.output": "Output",
			"model.fallback.short": "fallback",
			"channelb.model": "Model",
			"channelb.status": "Status",
			"channelb.available": "Available",
			"channelb.unavailable": "Unavailable",
			"channelb.checking": "Checking…",
			"channelb.refresh": "Refresh",
			"channelb.risk": "This channel's model reads files and runs commands on its own; its tool calls are not controlled by DSH."
		};
		const zh = zhDict;
		const en = enDict;
		// src/client/index.tsx
		/**
		* Browser half: the 妙手 / LongCat settings page contributed as a top-level
		* section of the host's Settings panel.
		*
		* 结构参照（不复制源码）：temp/dsh-connect-workbuddy-main/src/client/index.tsx
		*   头部与注册形态 —— 浏览器插件只注入 `slots` / `locale` 两项服务、
		*   `LocaleNamespaceMap` 模块增强、`settings.section` 与 `settings.section.icon`
		*   两个槽位的注册形状、用 `ctx.get()` 软探测 `configForms` 并跟随宿主真正
		*   服务的命名空间重新注册、以及整个 apply 体包 try/catch 以便槽位 API 变更
		*   时降级为 console.error 而不触发宿主 "Failed to load plugins" 红色横幅。
		* 本项目改动：只保留设置页这一处展示位（双 tab 组件替换为本插件的
		*   SettingsCard），section id 与命名空间改为 dsh-connect-catpaw；不注册任何
		*   对话输入区 / 胶囊 / 徽标等其它展示位（展示位置唯一）。
		*
		* 槽位迁移（0.1.1 起）：宿主 0.1.7 线里设置页的槽位是 `settings.section`
		*   （list / root，注册字段 `id` + `order` + `label` + `locale`），导航图标走
		*   独立的 `settings.section.icon`（宿主按 `id` 精确匹配）。阶段一注册的旧
		*   plugin-item 槽位已随宿主删除：`ctx.slots.inject()` 对不存在的槽位只等待、
		*   不报错，所以界面表现是"什么都没出现"，没有任何告警 —— 这正是本次修复的
		*   根因，因此旧槽位名不得以任何形式（含注释）再出现。
		*
		* @module dsh-connect-catpaw/client
		*/
		/** cordis.patch.yml 的 id / settings 命名空间 / 路由前缀，永不改名。 */
		const PLUGIN_ID = "dsh-connect-catpaw";
		/** Stable browser-plugin name. */
		const name = "dsh-connect-catpaw-client";
		/**
		* Cordis 依赖门。
		*
		* **`configForms` 必须在这里声明。** 它是 `@deepseek-ai/dsh-client-ui-settings`
		* 提供的一个**真实服务**（`super(ctx, 'configForms')`），宿主内置的每一个
		* client 插件都把它写进自己的 `inject`（实测 app.asar 里 19 处）。
		*
		* 之前只写了 `['slots','locale']`、改用 `ctx.get('configForms')` 软探测 ——
		* 结果拿到的是 `undefined`，卡片一路走到"降级只读"分支，永远显示
		* 「无法读取插件配置」。软探测**不能**用来访问一个需要声明才能拿到的服务：
		* 它只会安静地返回 undefined，而不是告诉你"你忘了声明"。
		*
		* 保留 `ctx.get()` 读法作为纵深防御：万一某个宿主行真的不提供该服务，
		* 卡片仍会显示（只是只读），而不是整页消失。
		*/
		const inject = [
			"slots",
			"locale",
			"configForms"
		];
		/**
		* 导航行图标：纯内联 CSS 方块。
		*
		* 刻意不引任何图标包 —— `dsh-client-ui-primitives` 的图标族名在宿主版本间
		* 改过，把图标绑定到它的导出上等于把"设置页能不能显示"押在一个会变的名字上。
		* 一个 `currentColor` 方块不依赖任何外部资源，且自动跟随主题前景色。
		*
		* 宿主渲染该槽位时传 `{ size, active }`（按 section 的 `id` 精确匹配）。
		*/
		function CatpawSectionIcon(props) {
			const edge = typeof props?.size === "number" ? props.size : 16;
			const style = {
				display: "inline-block",
				width: edge,
				height: edge,
				borderRadius: 4,
				background: "currentColor",
				opacity: props?.active === true ? 1 : .65
			};
			return (0, react.createElement)("span", {
				"aria-hidden": "true",
				style
			});
		}
		/**
		* 注册设置页文案，把 SettingsCard 挂到 `settings.section`，并把导航图标挂到
		* `settings.section.icon`；同时把配置读写接到宿主的 `configForms` 服务。
		*
		* 整段包 try/catch：槽位 API 变更 / 宿主缺失服务时降级为 console.error，
		* 不抛异常（否则宿主弹 "Failed to load plugins" 红色横幅），宿主侧 provider
		* 仍正常服务模型。
		*/
		function apply(ctx) {
			try {
				const namespace = "settings.catpaw";
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-connect-catpaw: settings copy");
				const t = ctx.locale.bind(namespace);
				/**
				* 软探测宿主服务。
				*
				* 属性访问会抛：`ctx.configForms` 在未 inject 时抛 "cannot get property X
				* without inject"，`?.` 挡不住（它不是 null，是抛异常的 getter）。
				* `ctx.get(name)` 在服务不存在时返回 `undefined` —— 这是唯一安全的读法。
				*/
				const softGet = (name) => ctx.get(name);
				/** 当前绑定的配置 scope；宿主未提供 configForms 时保持 undefined（卡片降级只读）。 */
				let settingsScope;
				/** 当前这套注册的 disposers；换绑时先全部 dispose 再整体替换。 */
				let liveDisposers = [];
				/**
				* `configForms` 是 0.1.7 线的客户端设置服务（旧 `settingsScope` 服务已随
				* 0.1.5 线删除，因此没有可回落的第二来源）。
				*
				* `describe()` 按 Loader entry id 给表单命名，而 entry id 由 profile patch
				* 决定，所以命名空间必须**问**宿主，不能假设；候选拼写见
				* `CATPAW_SETTINGS_NAMESPACE_CANDIDATES`。
				*/
				/**
				* 宿主 `configForms.get(ns)` 返回的 scope —— **宿主真实形状**是
				* `getSnapshot()` / `set()`，不是卡片用的 `read()` / `write()`。
				*
				* 这里必须按宿主形状声明（而不是直接标成 `CatpawSettingsScope`）：否则
				* TypeScript 会"通过"，但运行期卡片调 `settingsScope.read(...)` 会抛
				* `TypeError: ... is not a function` —— 类型骗过编译器、运行时才炸。
				*/
				const adaptScope = (scope) => ({
					read(key) {
						const value = scope.getSnapshot().value;
						if (typeof value !== "object" || value === null) return void 0;
						return value[key];
					},
					write(key, value) {
						return Promise.resolve(scope.set(key, value)).then(() => void 0);
					}
				});
				/**
				* `configForms` 现在是**已注入的服务**（见模块级 `inject`），所以直接取
				* `ctx.configForms` 即可；`ctx.get()` 只作为"某宿主行没提供它"时的兜底
				* （那时卡片显示只读，而不是整页消失）。
				*/
				const forms = ctx.configForms ?? softGet("configForms");
				/**
				* 注册设置页与它的导航图标，返回全部 disposers。
				*
				* section 与 icon 各自独立 try/catch：页面是功能本体，图标是装饰 ——
				* 声明了 section 却没有声明图标槽位的宿主，仍必须拿到页面。
				*/
				const registerAllSlots = () => {
					const disposers = [];
					try {
						const disposer = ctx.slots.inject("settings.section", () => {
							return ctx.slots.register({
								name: "settings.section",
								id: CATPAW_SETTINGS_SECTION_ID,
								order: 35,
								label: () => t("nav.label"),
								locale: namespace,
								inject: () => {
									const props = { t };
									if (settingsScope !== void 0) props.settingsScope = settingsScope;
									return props;
								}
							}, SettingsCard);
						});
						if (typeof disposer === "function") disposers.push(disposer);
					} catch (error) {
						console.error("[dsh-connect-catpaw] settings.section failed to register:", error);
					}
					try {
						const disposer = ctx.slots.inject("settings.section.icon", () => {
							return ctx.slots.register({
								name: "settings.section.icon",
								id: CATPAW_SETTINGS_SECTION_ID,
								locale: namespace
							}, CatpawSectionIcon);
						});
						if (typeof disposer === "function") disposers.push(disposer);
					} catch (error) {
						console.error("[dsh-connect-catpaw] settings.section.icon failed (page still renders):", error);
					}
					return disposers;
				};
				/**
				* 把 `settingsScope` 绑到宿主**真正服务**的命名空间，并在答案变化时
				* 重新注册全部槽位。
				*
				* 为什么不能只在启动时读一次：镜像由异步 `remote.settings.describe()`
				* 填充，`apply` 执行时 `view` 通常还是 undefined。凭"读不到"就认定自己
				* 猜的命名空间正确，会让表单永远停在 unavailable 状态。
				*
				* `whileServed` 是宿主自己的写法：只在 unserved→served 的**边沿**触发，
				* 并交出宿主实际服务的命名空间集合；宿主停止服务时还会撤销绑定。
				*
				* 边沿触发时必须**先 dispose 旧注册、再重新注册**：渲染器按 entry 身份
				* 缓存 `inject()` 结果（`if (!props) props = runInject(...)`），陈旧注册会
				* 一直服务陈旧 props，追加注册则会撞上"同 id 同优先级"的重复注册。
				*/
				const bindSettingsScope = () => {
					if (forms === void 0 || typeof forms.whileServed !== "function") {
						const fallback = forms?.get(CATPAW_SETTINGS_SECTION_ID);
						settingsScope = fallback === void 0 ? void 0 : adaptScope(fallback);
						liveDisposers = registerAllSlots();
						return;
					}
					ctx.effect(() => forms.whileServed(CATPAW_SETTINGS_NAMESPACE_CANDIDATES, (served) => {
						const ns = CATPAW_SETTINGS_NAMESPACE_CANDIDATES.find((candidate) => served.has(candidate));
						settingsScope = ns === void 0 ? void 0 : adaptScope(forms.get(ns));
						for (const dispose of liveDisposers) try {
							dispose();
						} catch {}
						liveDisposers = registerAllSlots();
						return () => {
							for (const dispose of liveDisposers) try {
								dispose();
							} catch {}
							liveDisposers = [];
						};
					}), "dsh-connect-catpaw: settings namespace binding");
					for (const dispose of liveDisposers) try {
						dispose();
					} catch {}
					liveDisposers = registerAllSlots();
				};
				bindSettingsScope();
			} catch (error) {
				console.error("[dsh-connect-catpaw] client card failed to load (host provider unaffected):", error);
			}
		}
		exports.PLUGIN_ID = PLUGIN_ID;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
