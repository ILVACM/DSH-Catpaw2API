# 实现与版本演进（最终）

> 本文件为 P3 整理后的**最终实现记录**，由阶段一/二/三的过程文档整理而来，过程文件已清理。
> 配套：[设计](design.md) · [探针结论](probe-findings.md) · [官方 API 参考](longcat.md)
> **当前版本：`0.2.3`（本次开发最终版）**

---

## 0. 版本一览

| 版本 | 内容 | 全量测试 |
| --- | --- | --- |
| `0.1.0` → `0.1.7` | 阶段一：插件骨架 + 官方 LongCat 通道（含设置页槽位、`.volatile()`、模型名前缀、GUI 排版等排障，见 §1） | 40 → 51 |
| `0.2.0` | 阶段二：接入本地妙手免费 LongCat-2.5 通道 | 73 |
| `0.2.1` | 修复 4 个运行时 bug | 83 |
| `0.2.2` | 修复图片输入（附件服务接线） | 93 |
| **`0.2.3`** | **429 归一化 + 文档整理（最终版）** | **102** |

---

## 1. 阶段一排障教训（0.1.0 → 0.1.7）

这些坑的共同特征：**全部不报错，只是"看起来没生效"**。按它们排查能省很多时间。

| 教训 | 结论 |
| --- | --- |
| `settings.plugin.item` 已废弃 | DSH 0.1.7 起宿主只有 `settings.section` / `settings.section.icon`。注册废弃槽位**静默失败**（`ctx.slots.inject()` 只等待、不抛错），表现为"插件列表里有、设置页空白" |
| **`.volatile()` 是硬门槛** | 宿主 `volatileForm()` 只投影标了 `.volatile()` 的字段；`describe()` 会**直接跳过**表单为 `undefined` 的插件 → 配置永远"无法读取"。**排查"客户端拿不到数据"时，应先确认宿主是否提供数据**（`settings.describe()` 是唯一权威） |
| volatile 约束 | schemastery 禁止 volatile 套 volatile（会抛 `volatile fields require a fixed object path...`）；`set(field, value)` 的 `field` 只接受顶层字段名 |
| 活值包装 | `.volatile()` 输出 `Volatile<T>`（带 `.get()`）；`Config` 接口保持普通类型 + `as unknown as z<Config>` 边界桥接 |
| `inject` 是硬门 | Host 侧 `export const inject = ['llm']`；Client 侧 `['slots','locale','configForms']`。漏声明 → 插件完全不工作但**不报错**（Cordis 抛错式访问保护只在运行时） |
| 前缀必须剥 | 转发前 `stripPrefix()`，否则官方 `400 Unsupported model (model=longcat/…)` |
| **tsdown 不剥离 JSDoc** | 注释里的旧字面量会原样进 `lib/client.js`，被契约测试判红 → **注释也算公开内容** |
| `Content-Length` 必填 | 回环 shim 写响应必须显式给长度，否则 chunked 编码会让 raw HTTP 客户端解析失败 |
| 四重校验顺序 | Host / Origin / Content-Type / Authorization 必须在**路由判定之前**完成 |
| 并发写入冲突 | teammate 超时未落盘时，Lead 接管前应先 `interrupt_agent`，否则旧 agent 可能回写覆盖已验证的版本（曾导致"类型骗过编译器、运行时才炸"） |
| 类型骗过编译器 | 把宿主返回的 `getSnapshot`/`set` 声明成 `read`/`write` 能让 `tsc` 过，但运行期调 `read()` 会 `TypeError` → 必须有真实形状 + 适配层 |
| 静默失败纪律 | 每条失败路径都要有可见提示；测试断言要测真实逻辑，不测常量 |

> 以上由 0.1.0 → 0.1.7 逐轮排障实测得出（设置页不显示 → 只读提示 → 模型选择器空 → 前缀 400 等）。

---

## 2. 实现结构

| 文件 | 职责 |
| --- | --- |
| `src/routing.ts` | 路径/前缀/常量（含 `CATPAW_MODEL_NAME` **唯一模型名来源**、`CATPAW_CATALOG`） |
| `src/catpaw-agent.ts` | 本地 Agent Server 客户端：端口发现、指定模型、发消息、SSE 解析 |
| `src/channel-b.ts` | B 通道编排：`chat()` + `probe()` |
| `src/shim.ts` | 回环 HTTP 服务：四重校验、前缀分流、A/B 两分支、工作目录提取、429 归一化、B 流式输出 |
| `src/adapter.ts` | pi-ai 模型目录（双通道并入 `catpaw2dsh` 组） |
| `src/web-status.ts` / `contracts.ts` | B tab 状态检测数据 |
| `src/client/SettingsCard.tsx` / `locales.ts` | 「本地客户端通道复用」两行卡片 |
| `src/longcat.ts` | 官方通道客户端（列表/详情/对话） |

**关键契约**（详见 [设计](design.md)）：
- 模型名单一来源：`CATPAW_MODEL_NAME` → 选择器 `catpaw/<X>` 与设置页同源
- 每次 `agent.start` 必带 `x-catpaw-directory`
- `PATCH /api/admin/config` 只写 `model` 一个键
- B 通道按 SSE 输出 `chat.completion.chunk` + `finish_reason` + `[DONE]`

---

## 2. 各版本改动与验证

### 0.2.0 · 双通道接入
- 新增 `catpaw-agent.ts`、`channel-b.ts` 真实实现；`shim.ts` B 分支接真实上游
- `adapter.ts` 把 `catpaw/LongCat-2.5` 并入模型选择器
- 设置页 tab 改名「本地客户端通道复用」，改为两行状态卡
- **验证**：73 测试全绿；端到端实测 3/3 真实回复、免费、目录对齐

### 0.2.1 · 修复 4 个运行时 bug
用户反馈「GUI 全对、功能全不行」。根因与修复：

| # | Bug | 修法 |
| --- | --- | --- |
| 1 | 端口写死 `6983..6990`，妙手实际在 14608 | 按 `catpaw-cli` PID 定位监听端口，静态段兜底 |
| 2 | `GET /api/config` 404 被误判失败 | 404 视为正常（无活跃会话），PATCH `ok:true` 即成功 |
| 3 | `body.workingDir` 不存在 → 对话被守卫拒 → `Stream ended without finish_reason` | 从 system prompt 正则提取 `Current working directory: "<path>".` |
| 4 | B 通道返回非流式 JSON | 改为 SSE（`chat.completion.chunk` + `finish_reason` + `[DONE]`） |

- **验证**：83 测试全绿；**先写会失败的测试再修**；变异验证（删目录头/删守卫/改模型名）均按要求变红
- 真实链路验证（不传自定义字段）：端口发现 14608、目录提取成功、`probe available=true`、对话 `ok=true` 且列出仓库文件

### 0.2.2 · 图片输入修复
- 根因：`src/index.ts` 从未把宿主 `attachments` 服务传给 `createAdapter`，遇图即抛
  `pi-ai image input requires the durable attachment service`
- 修法：`host.inject(['attachments'], ...)` + 活读取值器 `resolveAttachments: () => attachmentStore`
- `resolveImageAccess` 是可选配置且有 `?.` 兜底，本版不接
- **验证**：93 测试全绿；新增接线测试**先红后绿**；变异验证（删传参）2 个测试变红
- **人工验收**：DSH 里跑 archify / 贴图，报错消失、模型能描述图片

### 0.2.3 · 429 归一化（最终版）
- **根因**：宿主 `classifyPiAiError` 靠**错误文本**归类 `RATE_LIMIT`；shim 透传的上游 429 响应体未必含可归类字样，且缺 `Retry-After` 头，上层 `dsh-llm-retry` 无法接手
- **关键认知**：shim 是 HTTP 服务，抛 error 只会被自己的 `catch` 变成 502，到不了宿主 —— 必须让 **HTTP 429 响应本身**语义正确
- 修法（`src/shim.ts` A 分支）：
  - `isFreshRateLimit()`：`status===429 && !bodyUsed`（安全边界，只处理未吐字的 429）
  - 读上游体拿 `retry_after` → `options.logger` 输出**可见提示**
  - 写回归一化 429：body 含 `429` 与 `rate_limit`、`Retry-After` 头（上游给 60 也**封顶 8s**）
  - 非 429 正常透传；`catpaw/*` 分支一字不动
- **不自己写重试循环**：次数与退避由宿主提供（`dsh-llm-retry` 5 次、`provider-retry.js` 0.5/1/2/4/8s 封顶）；本仓不硬编码这些数字，只在测试里断言宿主策略确为 5 次且含 `RATE_LIMIT`
- **验证**：102 测试全绿；9 组 429 测试；三项变异验证（429 判断改假 / 删 `!bodyUsed` / 去掉 429 文本）均变红，恢复后 9/9 绿

---

## 3. 质量门禁（每版必跑）

| 项 | 要求 |
| --- | --- |
| `pnpm run check` | typecheck + build + PII + vitest 全绿 |
| 先红后绿 | 修 bug 前先写会失败的测试 |
| 变异验证 | 删掉关键逻辑 → 对应测试**必须红**，恢复 → 绿 |
| 端到端 | 完全模拟真实请求形状，不传自定义字段 |
| 产物 | `npm pack` 9 文件白名单；hash 与工作区一致 |
| 安装 | desktop profile；web profile 未触碰 |
| 隐私 | `check-pii` 通过；不写真实账号/token/余额/本机路径 |

---

## 4. 交付状态

| 项 | 状态 |
| --- | --- |
| 最终版本 | `0.2.3`，已装进 desktop profile |
| 本地包 | 只保留 `0.2.2`（回退基线）+ `0.2.3`（最终版） |
| 模型选择器 | `catpaw2dsh` 组下 `longcat/LongCat-2.5` + `catpaw/LongCat-2.5` |
| 官方通道 | 对话 / 图片 / 429 均可用 |
| 本地通道 | 对话 / 目录对齐 / 工具事件审计均可用 |
| 公开发布 | **人工接管**（npm / git / 公开仓库不由本阶段处理） |

---

## 5. 明确不做

视频输入、上下文档位、深度思考开关、官方余额查询、`resolveImageAccess`、502/503 重试 ——
均为实测做不到或人工已决定放弃的能力，保持现状，不做假控件。
