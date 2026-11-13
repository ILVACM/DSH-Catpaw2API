# 探针实测结论（最终）

> 本文件为 P3 整理后的**最终实测结论**，由阶段一/二/三的过程文档整理而来，过程文件已清理。
> 配套：[设计](design.md) · [实现记录](implementation.md) · [官方 API 参考](longcat.md)
> 所有结论均来自 2026-11-11 ~ 11-12 的本地实测；探针输出只含字段名/结构/数值，不含真实凭据。

---

## 0. 一句话

> **能复用本地妙手的免费 LongCat-2.5 通道发真实 chat；但妙手是"自带工具箱的施工队"，它的工具关不掉，工作目录必须对齐。**

---

## 1. 通道本体（可用）

| 项 | 结论 | 依据 |
| --- | --- | --- |
| 服务发现 | `GET /` 返回含 `CatPaw Agent Server` 者为本地 Agent Server | 实测 |
| 端口 | **动态**：实测出现过 6984/6985，也出现过 8553/9465/14608 | 2026-11-11 与 11-12 两次实测对比 |
| 可靠发现 | 按 `catpaw-cli` 进程 PID 过滤监听端口（本机 59 个回环端口，全扫不现实） | 实测 |
| RPC | `POST /api`，JSON-RPC 2.0 `agent.start` + `stream:true` → SSE | 实测 |
| 健康检查 | `ping` → `pong` | 实测 |
| 模型 | `LongCat-2.5`，`creditCost = 0.00000000`（**免费**） | 3/3 真实对话实测 |
| 对话 | 3/3 收到真实回复（含"介绍一下你自己"） | 实测 |
| 多轮 / 并发 / 工具调用 / 结构化错误 | 全部可用 | 实测 |
| 上下文窗口 | 实测 `contextWindowTokens = 204800`、`maxOutputTokens = 32768` | 实测 |
| 主应用真实对话 | `promptTokens = 25075`，其中 `system_prompt` 占 25.4%、`tools_and_subagents` 占 43.4% | 妙手日志实测 |

---

## 2. 配置接口（踩过坑，务必遵守）

| 项 | 结论 |
| --- | --- |
| 指定模型 | `PATCH /api/admin/config`，body **只写 `{model: 10002544}`** |
| 白名单 | 该接口只认 8 个键：`model / verbose / mode / timeout / maxTurns / enableSubagent / enableTodos / baseURL` |
| 污染风险 | 其它键虽回 `applied:true` 但**只是存着不生效**，且会污染合法键（实测误写 `mode:"1024000"` 导致 `不存在的模式` 报错） |
| 读回确认 | `GET /api/config` 在**无活跃 agent** 时返回 `404 {"error":"No active agent found for config query"}` —— **属正常**，不是配置失败 |
| 判定规则 | PATCH `ok:true` 即成功；404 视为成功；仅当读到配置且 model 不符才判失败 |

---

## 3. 请求形状限制

| 项 | 结论 |
| --- | --- |
| `content` | **只接受 `{type:'text', text:'...'}`** |
| 其它 content 类型 | `tool_result` / `function_result` / `image` 一律 `invalid_union: No matching discriminator` |
| 工作目录 | 靠请求头 `x-catpaw-directory: encodeURIComponent(<绝对路径>)`；**缺失时必须拒绝调用** |
| 不对齐的后果 | 妙手在**自己的安装目录**干活（列出 `妙手.exe`），用户看到不相干的文件 |

**工作目录对齐实测**：

| 请求 | 妙手实际目录 |
| --- | --- |
| 不带目录头 | 它自己的安装目录 ❌ |
| 带 `x-catpaw-directory` | **DSH 指定的目录**（正确列出仓库文件：LICENSE / README.md / docs） ✅ |

---

## 4. 🔴 工具能力：关不掉（决定角色边界）

| 结论 | 依据 |
| --- | --- |
| 妙手自带 **27 个工具**（`read_file` / `write` / `bash` / `grep` / `list_dir` / `delete_file` / `web_search` …），全部 `enabled=true` | `agent.getAvailableTools` 实测 |
| `agent.start` **不接受外部 `tools`**：传标准 OpenAI `tools` 或假工具 `dsh_only_fake_tool_xyz` 均被静默忽略，妙手仍用自己的 | 实测三种情况行为一致 |
| 6 种合法 `permissionMode`（`acceptEdits` / `bypassPermissions` / `unsafeBypassPermissions` / `default` / `dontAsk` / `plan`）**没有一种能阻止工具执行**（最少仍执行 2 次） | 实测 |
| `permissionMode` 管的是"要不要弹人工确认"，**不是**"允不允许执行" | 源码 + 实测 |
| 工具结果**不以外露的 `tool_calls` 形式返回**：妙手内部校验、内部执行、内部拿结果，只吐最终文本 + `tool_execution_*` 事件 | SSE 事件序列实测 |
| 铁证：让它"列出当前目录"，它执行自己的 `list_dir` 并返回 500 个文件 | `toolName: "list_dir"` 实测 |

**因此**：由 DSH 接管工具调用这条路线**走不通**。
边界只能是「妙手全权执行 + DSH 定范围与可见性」（见 [设计 §1](design.md)）。

---

## 5. 档位与深度思考：客户端本地限制

| 项 | 结论 |
| --- | --- |
| 模型列表接口 | `POST https://catpaw.meituan.com/api/agent/maas/model-types` + `{tenant:'CatDesk', scene:'CATX_APP', env:'EXTERNAL'}` 可拿到 **11 个模型**及各模型 `parameterDefinitions` |
| `LongCat-2.5` 定义 | `context` ENUM（200K/500K/1M，默认 204800）、`thinking` BOOLEAN（默认 true） |
| 主应用真实对话 | `contextWindowTokens = 1024000`（1M） |
| 外部调用 | 恒定 `204800` |
| 结论 | **1M 上下文 / 深度思考是妙手客户端本地人为限制**，不影响模型通道本身；按人工决策不做假控件 |

---

## 6. 宿主侧事实（决定 429 与图片怎么修）

| 项 | 结论 | 依据 |
| --- | --- | --- |
| 工作目录 | 宿主 `@deepseek-ai/dsh-working-directory` 把实时目录**强制写进 system prompt**（`required: true`），格式 `Current working directory: "<path>".` | 宿主源码 |
| 图片 | `dsh-llm-pi-ai` 遇到图片要求 `resolveAttachments`，否则抛 `pi-ai image input requires the durable attachment service` | 宿主源码 L1854-1857 |
| `resolveAttachments` | 是**可选**配置；官方 provider 用 `() => ctx.get('attachments')` | 宿主源码 L2575 |
| `classifyPiAiError` | 靠**错误文本**匹配 `/\b429\b|rate.?limit/i` 归类为 `RATE_LIMIT` | 宿主源码 |
| `retryProviderRequest` | `isRetryableProviderError` 认 `status===429`；退避 `min(0.5*2^n, 8)*1000`（0.5/1/2/4/8s 封顶） | `provider-retry.js` |
| `resolveRetryPolicy(undefined)` | `{mode:'normal', maxRetries:5, retryableCodes:[...RATE_LIMIT...], initialDelayMs:500, maxDelayMs:10000}` | 实跑 |
| `dsh-llm-pi-ai` 流式 | 实际写死 `maxRetries: 0`，重试交上层 `dsh-llm-retry` | 宿主源码 @78930 |

> **429 的正确修法**：shim 是 HTTP 服务，抛 error 只会被自己的 catch 变成 502，到不了宿主。
> 必须让 **HTTP 429 响应本身**带含 `429`/`rate_limit` 的错误文本 + `Retry-After` 头，
> 宿主才能归类并重试。详见 [实现记录](implementation.md)。

---

## 7. 隐私与合规

- 全程未接触 token / 账号 / 手机号；探针输出已脱敏
- 数据全部留本机；不上传、不遥测
- 本机安装路径在公开文档中统一写作 `<catpaw-install-dir>`
