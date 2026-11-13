# 美团 CatPaw（妙手）接入 DSH —— 可行性调研报告

> **【历史文档】** 本报告写于立项期（2026-11-07），用于技术路线选型。
> 文中大量引用 `temp/` 下的参考插件副本；**`temp/` 已在 P3 收尾时清理**，
> 故这些链接已失效，仅作历史记录保留。
> **最终设计请看**：[design.md](design.md) · [probe-findings.md](probe-findings.md) · [implementation.md](implementation.md)
>
> 阶段：**只做调研，不写插件代码**（按本轮确认的范围）。
> 日期：2026-11-07（v2，含子代理补充调研后的修正）。
> 方法：仓库全量扫描（904 个文件）+ 参考插件源码/文档取证 + 官方 LongCat/CatPaw 文档逐页核实 + GitHub 逆向项目源码逐字核实 + 独立方法论分析。
> 信息分级：**【确认】**=有公开来源直接支撑并已复核 / **【推测】**=基于证据的推断 / **【空白】**=明确没查到。外部信息一律附来源，不编造。

---

## 0. 先说结论（给赶时间的人）

1. **仓库现状**：只有一句目标 + 三份现成的参考插件，CatPaw 相关代码/协议资料为 **0**。`temp/` 里三个插件是同一作者按同一配方做的「复刻模板库」。
2. **【确认·头号】美团官方已经把「LongCat 接进 DSH」做完了**。[LongCat 官方文档有「DeepSeek Harness 配置」专页](https://longcat.chat/platform/docs/zh/deepseek-harness)：在 DSH「设置 → 模型 → + 添加模型提供商 → 自定义模型 API」填 `Provider ID=longcat`、`API 地址=https://api.longcat.chat/openai/v1`、`协议=OpenAI Chat Completions`、`API Key`，点「获取可用模型」勾选 `LongCat-2.5` 即可。**零代码、官方、合规、可开发票**。若目标只是「在 DSH 里用 LongCat 模型」，本项目**不需要动工**。
3. **【确认】DSH 原生支持自定义 OpenAI 兼容 provider**，不止设置页，还能写 `~/.dsh/profiles/desktop/cordis.patch.yml` 的 `llm-pi-ai.providers.<路由>`（官方文档给了完整 yaml 示例与 FAQ）。[Agent2API 的 `agents/clients/dsh.rs`](https://github.com/aimod-cc/Agent2API/blob/main/desktop-tauri/src-tauri/server/src/server/core/agents/clients/dsh.rs) 也把这套配置读写逐字实现了。那三个 `temp/` 插件写成插件，是为了账号池/签到/积分读数/设置页这些**增值体验**，不是「让模型能跑」本身。
4. **【确认·关键】「接 CatPaw」和「接 LongCat」不是一回事**。CatPaw 客户端额度主用 **`glm-5.2` 等第三方模型**（逆向项目一致），按「Credits / 次对话」计量（新用户 500 次）；LongCat 开放平台是 **`LongCat-2.5` 单模型**，按 Token 计量、单独付费。两套控制台、两种计量、权益互不相通。官方那页「[接入 CatPaw](https://longcat.chat/platform/docs/zh/catpaw)」方向相反——是**教 CatPaw 用户把 LongCat 的 Key 填进 CatPaw**（入向），不是把 CatPaw 额度接出来。**所以立项前必须先拍板：要哪个？**
5. **【确认·修正 v1 的错误】CatPaw 上游协议并非「公开资料为 0」**。已找到 **4 个开源逆向项目**（`Agent2API` / `thief-neko` / `catpaw-bridge` / `catpaw2api`），其中 `thief-neko` 源码把登录接口链、鉴权头、凭据落盘位置、私有 chat 请求体、SSE chunk 转换、工具调用伪协议**全部摸清并开源**，等于一份可读的协议规格书。v1 报告里「只能靠真账号从零抓包」的判断过强：**不需要从零抓包，但仍需用真账号复核当前版本是否仍有效**（这些项目最后更新在 2026-07~09，且协议带加密与版本绑定）。
6. 因此原定的「必须自己从零逆向客户端」前提**不成立**。真正要拍板的是：目标是「用模型」（→ 官方零代码），还是「把 CatPaw 客户端赠送/订阅额度搬进 DSH 用 GLM-5.2 等模型」（→ 才需要桥接，且要承担全部协议与账号风险），还是「做一个可发布、与那三个插件一致的 DSH 原生插件」（→ 自研）。
7. **合规红线**：复用客户端登录态属「非官方客户端形态」，上游条款风险自担；`Agent2API` 是 AGPL-3.0（Gitee 旧镜像是 MIT+禁商用声明，两版不一致），直接借代码需评估传染性。CatPaw 官方用户协议是 SPA，**正文一条都抓不到**，无法给出合规结论。

---

## 1. 仓库里到底有什么（自适应扫描结果）

- 根目录 [README.md](../README.md)：两行——「将美团 catpaw（妙手）接入 DSH 使用（注意自备账号）」。[LICENSE](../LICENSE)：Apache-2.0。
- 全仓库搜 `catpaw / 妙手 / 美团 / LongCat`：**只命中 README 一行**。没有接口调研、抓包记录、草稿代码。根目录与三个子项目都**没有 `.git`**：是 GitHub 下载的源码快照，版本控制未初始化。
- `temp/` 下三个**同源、同作者（dingminhua / LaoDing）**的成熟 DSH 模型供应商插件，TypeScript + pnpm + tsdown + vitest + React 设置页：

| 项目 | 版本 | 接入的上游 | 凭据形态 |
| --- | --- | --- | --- |
| [dsh-connect-qoder-main](../temp/dsh-connect-qoder-main/package.json) | 1.19.2 | Qoder / 通义灵码 | 官方 PAT 令牌，直连内部 cosy 网关 |
| [dsh-connect-trae-main](../temp/dsh-connect-trae-main/package.json) | 4.10.1 | Trae（国内/企业/国际） | 读本机客户端登录态（AES 解密） |
| [dsh-connect-workbuddy-main](../temp/dsh-connect-workbuddy-main/package.json) | 5.20.3 | WorkBuddy / CodeBuddy | 本机登录态 + 扫码登录，功能最全 |

- [qoder 的 BLUEPRINT.md](../temp/dsh-connect-qoder-main/BLUEPRINT.md) 开门见山：「把 WorkBuddy 连接器读成『一个 DSH 模型 provider 插件的最小完整骨架』，供照着给 Qoder 做一个功能对等的插件」——证明这三个项目是**同一配方的三次复刻**，`temp/` 就是为「做第四个插件」准备的模板库。

### 1.1 这套参考代码能复用什么（按 BLUEPRINT.md §8）

- **几乎可原样照搬（纯通用件 / DSH 契约）**：`index.ts` 装配顺序（createShim → await ready 拿随机端口 → createAdapter → registerAdapter → registerConfigurableProviders → registerModelDiscovery → 异步 fetchModels；释放统一挂 `ctx.effect`）、`settingsNamespaceOf(ctx)` 探测、`shim.ts` 整个安全模型（`127.0.0.1:0` 随机端口 + 进程内 32 字节 secret + `timingSafeEqual` + Host/Origin/Content-Type 三重校验 + 64MiB 上限）、`adapter.ts`（`createProvider` + `openAICompletionsApi` + inert auth + `getModels` 活读 + `piAiRuntimeInfo()` 世代门控）、账号池纯逻辑（`rankPool`/`exclusionOf`）、`probe.ts` 方法论、`client/` 设置页骨架、`web-status.ts` 同源路由、`bin.ts` doctor CLI、tsdown 双 target 构建、`cordis.patch.yml` 的 `- insert: [{id, name}]`（**id 用无 scope 包名且永不改**，改名会 orphan 所有已装配置）。
- **一定得按上游重写（产品特有）**：`upstream.ts`（端点、base、请求头、`prepareChatBody`、`classifyUpstreamError` 码表、`fetchModels`/`parseUpstreamModel`、`fetchCredits`、`refreshToken`、区域配置表）、凭据层、`catalog.ts` 静态 fallback 与字段映射、`messages.ts` chat body 模板、协议层（若上游非 OpenAI 形状）、倍率/活动/签到/设备风控头、`status-paths.ts` 路由常量、卡片文案、provider id。
- **条件性可删**：若上游原生发 `delta.tool_calls`（如 Qoder）→ `dsml-recovery.ts` / `markup-diagnosis.ts` / `RecoveryStream` 整块可删（Qoder 比 WorkBuddy 省约 4000 行）；若凭据明文 → `at-rest.ts` 可删；若无扫码 → `oauth.ts` 可删；若单区域 → **不要删区域维度，填单值**（将来加国际版零改动回填）。BLUEPRINT §8.3 估算：保留骨架 ~3500 行、重写 ~1500 行、删除最多 ~4000 行。

### 1.2 参考插件是怎么「摸清一个陌生上游」的（可复用方法论）

五个手段叠加，且贯穿「证据分级」与「不臆测」：

1. **读客户端安装包/静态资源 + 历史真实日志（离线、零额度、最优先）**。Trae `docs/PROTOCOL_EVIDENCE.md` 把证据分四级：**A=历史真实请求日志 / B=当前安装包 bundle / C=失败参考实现 / D=本项目草案**，并规定「只记录脱敏结构、字段名、长度和行为，不得复制 token、正文、完整 body」。`ANALYSIS.md` 靠只读搜索 App 资源与本机日志确认端点、设备头、146KB 的真实 body 形状。
2. **社区逆向实现作「行为参照」但独立重写**（合规）。Qoder `docs/DESIGN.md` §八、`THIRD_PARTY_NOTICES`：cosy 协议参考 `qoder2api`（GPL-3.0）的运行行为，「**未复制其源码**，按文档与行为独立实现为 TypeScript」；WorkBuddy `DESIGN.md` §5.1 画出 `dsh-codex-connect → dsh-workbuddy-connect → 本项目` 的溯源链。
3. **只读 `scripts/probe-*.mjs` + 真实账号实测**：脚本**直接 import 生产源码 `../src/*.ts`**（不重造协议），凭据只从环境变量读、输出一律 `redact`。[probe-cosy.mjs](../temp/dsh-connect-qoder-main/scripts/probe-cosy.mjs) 依次验证「PAT→jobToken / model/list / usage（只读）/ 可选一次极小 chat（会花钱，默认不跑）」；WorkBuddy 有 `probe-auth/accounts/models/credits/checkin/region` 一整套；Trae 的 `probe-intl.mjs` 明确「never calls chat endpoints (would consume credits)」。
4. **枚举式路径猜测 + 如实记录失败**。[PAT.md](../temp/dsh-connect-qoder-main/docs/PAT.md) §五：签到「照 checkin/signin/reward 猜路径**我实测猜了 13 个全 404**，真正的词是 campaigns」。
5. **受控单次 live E2E，需用户明确批准**。Trae `PROTOCOL_EVIDENCE.md`：「经用户明确同意，执行了**一次且仅一次**短探测…返回 400 空体…**本轮不继续试错**」；证据不足时上游明确返回 **503** 而不是盲发。

**贯穿全员的纪律**：「上游声明字段不可全信，用精确 model id 键控的人工核对表 + 实测」（Qoder DESIGN §六：发一张画数字 7 的 PNG 实测推翻「纯文本」旧结论，并提醒「『测出来失败』要先排除『是我们的代码在失败』」）；所有 probe「只输出长度与形状、脱敏」（三份 [AGENTS.md](../temp/dsh-connect-workbuddy-main/AGENTS.md) 的隐私硬约束：真实账号/余额/token/本机路径一律不进仓库，截图用假数据重出图、不许马赛克，发版前跑 `check-pii` / `verify:privacy` 双检查）。

> 这个作者的调研产物 = **一个 probe 脚本 + 一份带逐字报文和实测数字的 docs + 一份「哪些还不知道」的清单 + 证据等级标注**。这也正是本报告的模板。

---

## 2. CatPaw 是什么（已确认事实）

- **【确认】** [美团技术团队发布文](https://tech.meituan.com/2026/07/28/CatPaw-LongCat.html)：CatPaw 是美团自研全场景 AI Agent 平台，搭载 LongCat 2.0（1.6T 参数、1M 上下文，2026-07 开源）；含独立移动端 App + PC 客户端 + 云端 7×24；PC 端具备文件操作、浏览器控制、终端命令；企业侧有 Managed Agents、数字员工（飞书/企微）、团队账号/分级权限/凭证托管/私有化；内部覆盖 9 万员工、3 万 Agent。
- **【确认】** [妙手文档](https://catpaw.meituan.com/docs) / [首页](https://catpaw.meituan.com/) 定位「全场景 AI Agent 平台」；[meituancatpaw.com](https://meituancatpaw.com/download) 与 [w3cschool 官方教程镜像](https://www.w3cschool.cn/catpawguides/) 显示 IDE 侧是 **VS Code fork 的独立 IDE**（Open Folder / Clone repo / 侧边栏 Ask·Agent·自定义 Agent / Inline Chat / MCP / Rules）。
- **【确认】** 操作系统（[官方 LongCat「接入 CatPaw」页](https://longcat.chat/platform/docs/zh/catpaw)）：macOS arm(M1–M4) 与 x64 均需 macOS 13+；Windows x64 需 Windows 10+；**明确不支持 Windows ARM**。未见 Linux 桌面客户端。
- **【确认】** 登录：手机号或邮箱，新用户 500 次对话免费额度；套餐口径另有「体验版 ¥0/月含 200 Credits、专业版 ¥88/月含 4000 Credits」（第三方整理，非官方目录响应）。
- **【推测】** 存在两个产品层：①「CatPaw IDE」（VS Code fork 的 AI 编程客户端，2025-11 公测，Windows/macOS）；②「妙手全场景 Agent 平台」（2026-07 上线，桌面+移动+云端+Managed Agents）。**逆向项目全部针对 ① 的 IDE 客户端登录态**，README 说的「自备账号」额度大概率指 ①。两站点官方归属关系未找到说明。
- **【确认·重要】** 「搭载 LongCat 2.0」主要指 Agent 平台侧；**IDE 客户端逆向出来的主用模型是 `glm-5.2`**，目录里有 `glm-5.2 / glm-5.1 / deepseek-v3.2 / kimi-k2.6 / kimi-k2.5 / minimax-m2.7 / longcat-2.0 / longcat-flash`（第三方整理）。所以「接 CatPaw 账号 = 接 LongCat 2.0」这个前提**不成立**。

---

## 3. 三条可选路线（本报告核心）

### 路线 A：用官方 LongCat 开放平台 API ✅ 官方文档盖章的零代码方案

- **【确认】** [DeepSeek Harness 配置专页](https://longcat.chat/platform/docs/zh/deepseek-harness) 给出确切步骤与值：Provider ID `longcat`、`API 地址 https://api.longcat.chat/openai/v1`、`协议 OpenAI Chat Completions`、API Key（`https://longcat.chat/platform/api_keys`）；「获取可用模型」拉 `/models` 勾选 `LongCat-2.5`（自动带出上下文 1048576、最大输出 262144）；进阶可用 `~/.dsh/profiles/desktop/cordis.patch.yml` 写 `llm-pi-ai.providers.longcat`（含 `api: openai-completions` / `apiKeyEnv: LONGCAT_API_KEY` / `baseURL` / `models` / 可选的 `compat.thinkingFormat: deepseek` 关思考、`supportsDeveloperRole:false`）。FAQ 覆盖 `MISSING_CREDENTIAL` / `UNKNOWN_MODEL` / 401 / 图片输入。
- **【确认】** API 本身（[快速开始](https://longcat.chat/platform/docs/zh/)、[API 概述](https://longcat.chat/platform/docs/zh/api-docs)、[Chat](https://longcat.chat/platform/docs/zh/api/chat)、[模型列表](https://longcat.chat/platform/docs/zh/api/models)、[FAQ](https://longcat.chat/platform/docs/zh/faq)、[定价](https://longcat.chat/platform/docs/zh/pricing/longcat-2.5)、[Token 资源包](https://longcat.chat/platform/docs/zh/token-pack)）：OpenAI 兼容 `/openai/v1/chat/completions` + Anthropic 兼容 `/anthropic/v1/messages`；Bearer API Key（最多同时 100 个、仅创建时可见）；当前**只有 `LongCat-2.5` 一个模型**，1M 上下文 / 256K 输出；`stream:true` SSE、`thinking:{type:enabled|disabled}`、**不支持 `reasoning_effort` 等级**；错误码 400/401/402/403/429/500 结构化；计费按量（限时 ¥2 / 缓存 ¥0.04 / 输出 ¥8 每百万 token）或 Token 资源包（30 天有效、每日 10/16/21/23 点限量）；失败请求不扣费；实名认证、充值、发票体系完整。
- **影响**：**零代码、官方、合规、稳定、可开发票**。DSH 设置页点几下即可，连 `cordis.patch.yml` 都不一定要写。
- **代价**：花官方 API 的钱，**用不到 CatPaw 客户端的赠送/订阅 Credits**，且模型只有 `LongCat-2.5`（不是客户端里那些 GLM/DeepSeek/Kimi）。

### 路线 B：复用现成的本地网关 ✅ 逆向成本≈0

已找到 **4 个把 CatPaw 登录态转 OpenAI 兼容的开源项目**，等于现成规格书：

| 项目 | 语言/许可 | 特点 |
| --- | --- | --- |
| [aimod-cc/Agent2API](https://github.com/aimod-cc/agent2api) | Rust+Tauri，[GitHub AGPL-3.0](https://github.com/aimod-cc/Agent2API/blob/main/LICENSE)（[Gitee 旧镜像](https://gitee.com/aimodcc/agent2api) 是 MIT+中文禁商用声明） | 2k stars，支持 50+ 客户端；`http://127.0.0.1:3065/v1`；多账号选路、签到、余额、报表；**内置 DSH 配置改写适配器** |
| [KanoNoUta/thief-neko](https://github.com/KanoNoUta/thief-neko) | Node 24+，MIT | **协议细节最全**；Windows 图形控制器 + Linux 无界面服务；Token 自动刷新/401 无感重试；自动申请额外额度 |
| [fifasheng-tech/catpaw-bridge](https://github.com/fifasheng-tech/catpaw-bridge) | Python，MIT（API 返回无 license 字段，README 标 MIT） | RSA-OAEP + AES-128-ECB 加解密、SSO token 读取、工具调用翻译层 |
| [Juwan-Hwang/catpaw2api](https://github.com/Juwan-Hwang/catpaw2api) | — | 1 star，2026-08-26 已归档只读 |

对外统一 `/v1/chat/completions`、`/v1/responses`、`/v1/messages`、`/v1/models`。DSH 侧**只需把 `baseURL: http://127.0.0.1:3065/v1` 填进自定义 provider**（Agent2API 甚至内置一键改写 DSH 配置）。[中文教程](https://www.aiezz.com/tutorial/tutorial-ee1bec260159cf2bf1f958da) 有完整部署步骤。

- **许可与合规**：Agent2API GitHub 是 **AGPL-3.0**，Gitee 镜像却带「MIT + 禁止商业用途/二次分发牟利/批量账号运营」附加限制（两版不一致）；其使用声明明写「以非官方客户端形态复用登录态**可能不符合上游用户协议**」，账号被限流/风控/冻结/封禁自负；凭证存 `~/.agent2api/agent2api.db`（GitHub README 称加密，Gitee 旧版称明文，措辞不一）。**若本项目要发 npm 或商用，不能照抄 AGPL 代码**，只能参考协议事实或作为外部工具对接。
- **代价**：多跑一个外部进程、许可风险、CatPaw 上游一变它也跟着失效。

### 路线 C：仿照 `temp/` 自研 DSH 原生插件（原定路线）

- 形态：`dsh-connect-catpaw`，复刻 WorkBuddy/Qoder 骨架，注册成 DSH 的 `catpaw` provider，带设置页、模型目录、积分读数、账号池、签到。
- **【确认·修正】** 前提不再是「从零抓包」：4 个开源项目已把协议摸清（见 §3.1），可作**行为参照**独立重写（与 Qoder 参考 `qoder2api` 的做法一致）。但按参考项目纪律，**仍需用真账号逐项复核当前版本**，且这些项目最后更新在 2026-07~09，协议带加密与版本绑定，随时可能失效。
- 结论：技术上可行（参考插件证明过三次、有 4 份规格书），但**纯自研的性价比需要重新论证**——除非目标明确是「要一个 DSH 原生、可发布、体验与那三个插件一致的插件」。

### 三条路线对比

| | A 官方 API | B 现成网关 | C 自研插件 |
| --- | --- | --- | --- |
| 用 CatPaw 客户端额度 | ❌ 花 API 的钱 | ✅ 复用登录态 | ✅ 复用登录态 |
| 可用模型 | 仅 `LongCat-2.5` | 客户端目录（GLM/DS/Kimi/LongCat…） | 同左 |
| 合规/账号风险 | 低（官方） | 中-高（非官方客户端 + 许可） | 中-高（非官方客户端） |
| 逆向工作量 | 0 | 0（或读其源码） | 中（有 4 份规格书，但需真账号复核） |
| DSH 接入方式 | 设置页填 `baseURL` / 官方 patch 示例 | 填 `baseURL` 指向本地网关 | 写 bundle 插件（`registerAdapter`） |
| 可发布到 npm | 可 | 受 AGPL/禁商用约束 | 可（守脱敏规则） |
| 上游变更维护 | 官方文档跟踪 | 依赖网关更新 | 自己跟 |

---

## 3.1 CatPaw 上游协议事实（来自开源项目源码，已逐字复核）

> 这些是「接新上游必须确认的事实」中**已经能从公开源码读到**的部分。来源均为第三方逆向项目，**非官方**，且可能随客户端版本变化；按参考项目的证据分级，属 **B/C 级**，需真账号升到 A 级。

**凭据与登录（[thief-neko](https://github.com/KanoNoUta/thief-neko) `src/catpawState.js` / `catpawAuthClient.js`）**
- 【确认】Windows 凭据落盘：`%APPDATA%\CatPawAI\User\globalStorage\state.vscdb`（SQLite，只读打开），表 `ItemTable`，key=`catpaw.mt-authentication`，value 是 JSON 串，其 `mt.auth` 又是 JSON 串，含 `sessions[0].accessToken`、`sessions[0].account.id`(userMis)、`account.label`、`refreshToken`。**明文 JSON 存本地 SQLite，无系统级加密**（比 Qoder/WorkBuddy 的 OSCrypt 更简单）。
- 【确认】登录接口链，base `https://catpaw.meituan.com`：`POST /api/login/sendSmsVerificationCode` {mobileNo, uuid} → `/api/login/mobile/verify` {mobileNo, verificationCode}（可能返回 `invitationCodeRequired`）→ `/api/login/mobile` {mobileNo, verificationCode, invitationCode?}；另有 `/api/login/refreshToken`、`/api/login/userInfo`；额度接口 `/api/user/limit`。返回 `accessToken` / `refreshToken` / 过期时间。
- 【确认】鉴权头形状（`catpawAuthClient.js` / `config.js`）：**`Catpaw-Auth: <裸 accessToken>`（不是 Bearer）**，外加 `client-type: CatPaw IDE`、`ide-version: 2026.2.3`、`tenant: 5282fa6645`、`platform: win32-x64`；可选 `user-mis-id` / `user-uid` / `mis-id`。响应可能带 `encrypted-key` 头，需解密后才能 JSON.parse（`catpaw-bridge` 说明为 RSA-OAEP + AES-128-ECB，密钥需从 CatPaw 插件源码取 `CATPAW_MIS_ID` / `CATPAW_TENANT` / `CATPAW_PASSPORT_KEY` / `CATPAW_SSO_KEY`）。
- 【空白】CatPaw 官方**对外颁发**的 PAT / API Key / Access Token：完全没查到。唯一官方 Key 是 LongCat 开放平台的（另一套账号体系）。macOS/Linux 的凭据落盘路径、企业 SSO 细节也没查到（所有公开证据只覆盖 Windows）。

**推理协议（[thief-neko](https://github.com/KanoNoUta/thief-neko) `config.js` / `catpawAgent.js` / README）**
- 【确认】上游端点：`https://catpaw.meituan.com/api/gpt/openai/stream`，强制 SSE 流式；默认模型 `glm-5.2`；`CATPAW_TENANT=5282fa6645`；`userModelTypeCode` 默认 2。
- 【确认】**上游不是标准 OpenAI 协议**：`buildCatpawAgentRequest` 把 OpenAI 请求改写成私有体 `{messages(去掉 system), filePath, conversationId, triggerMode:'AGENT', userModelTypeCode, promptEditorSubmitData:'{}', agentModeConfig:{type:'CUSTOM_AGENT', tools, model, systemPrompt, evaluationMode:true, const:{trigger:'AGENT'}, ...}}`；响应 chunk 由 `normalizeCatpawAgentChunk` 转换（`chunk.content`→`choices[0].delta.content`、`chunk.lastOne`→`finish_reason`、`toolCalls`/`suggestUuid`、伪工具调用 `<arg_key>/<arg_value>` 标签解析）。`catpaw-bridge` 明确「CatPaw API 不支持原生 `tools` 参数，通过 prompt 注入 + 响应解析实现」，要处理 127 个内置工具的注入过滤。
- 【确认】对外则标准 OpenAI：`/v1/chat/completions`、`/v1/responses`、`/v1/messages`、`/v1/models`、`/health`。
- 对 DSH 的直接影响：**工具调用是「prompt 注入 + 响应解析」的伪协议**，DSH 的 Agent 工具循环会有保真度损失；`shim.ts` 必须做请求/响应双向转换（类似 WorkBuddy 的 `dsml-recovery.ts`），不能退化成纯转发。这与 Qoder（原生 tool_calls）路线不同，改动量更接近 WorkBuddy。

---

## 4. 「必须确认的上游事实」清单（若走 B/C）

换一个陌生上游必须先搞清这些；括号内是三个参考项目里的对应取证模板。**v2 状态列**标注哪些已由开源项目给出、哪些仍要真账号补齐。

| # | 必须搞清的事实 | 为什么必须知道 | 参考位置 | v2 状态 |
| --- | --- | --- | --- | --- |
| 1 | 登录态存哪 / 凭据形态 / 加密 / 区域绑定 | 决定 PAT / 本机登录 / 扫码哪套骨架 | qoder `PAT.md`·`credentials.ts` / WB `auth.ts`·`at-rest.ts` / Trae `decrypt.ts`·`paths.ts` | 部分【确认】：Windows 明文 SQLite 路径与 schema 已知；macOS/Linux 空白 |
| 2 | token 刷新端点、请求头、过期单位、单飞 | 会话长期可用；chat 绝不能带 refresh token | qoder `exchangeJobToken` / WB `refreshToken` / Trae `refresh.ts` | 部分【确认】：`/api/login/refreshToken` + refreshToken body 已知 |
| 3 | chat 的 URL / 请求体 / 私有顶层字段 / session 三件套 | `prepareChatBody` 全靠它 | qoder `messages.ts` / WB `upstream.ts` / Trae `protocol.ts` | 部分【确认】：`/api/gpt/openai/stream` + `agentModeConfig` 私有体已知（B/C 级） |
| 4 | SSE 帧结构 / 增量字段 / 原生还是私有 tool_calls / usage / [DONE] | 决定要不要 RecoveryStream | qoder `parseStreamDelta` / WB `dsml-recovery.ts` / Trae `sse.ts` | 部分【确认】：chunk 字段与伪工具调用标签已知；需真账号带工具抓一次 |
| 5 | 模型目录端点 / 身份头 / 字段 / 倍率 / 推理档 / 静态 fallback | 卡片、发现、描述符；**同一端点按 UA 下发不同文档** | qoder `fetchModels` / WB `/v3/config` / Trae `catalog.ts` | 【空白】官方目录接口无；只有第三方整理的模型名清单 |
| 6 | 积分/用量端点 / 用哪族令牌 / 包字段 / 企业席位 | 卡片读数、账号池排序 | qoder `fetchUsage` / WB `billing/meter` / Trae `USAGE_API_RESEARCH.md` | 部分【确认】：`/api/user/limit` 已知；字段形状待复核 |
| 7 | 错误码 / 限流码 / 排队 / 凭据失效 / 风控 / Retry-After 来源 | 决定换号/重试/停权 | qoder `classifyFailure` / WB `classifyUpstreamError` | 【空白】需真账号触发 |
| 8 | 设备指纹 / 风控头来源、是否按区绑定、能否伪造 | 缺了不是报错而是静默降级 | qoder `device-risk.ts` / WB `device-id.ts` / Trae `identity.ts` | 部分【确认】：头名已知（`tenant`/`client-type`/`ide-version`/`platform`）；稳定性待复核 |
| 9 | 区域 / 国内国际是否双供应商、host 是否共用 | 决定要不要 `for(region)` 双栈 | qoder `QODER_REGIONS` / WB `regionOf` / Trae `INTL_SG_EVIDENCE.md` | 【空白】CatPaw 是否分区未知；按 BLUEPRINT §8.4 先建单值双栈 |
| 10 | 倍率 / 活动 / 签到 / 促销字段、幂等、开窗 | 徽标、签到、免费模型挑选 | qoder `promo.ts`·`PAT.md`§五 / WB `probe-checkin.mjs` | 【空白】CatPaw 是否支持签到未单独确认 |
| 11 | 请求头约定 / 客户端身份 / UA 通道 | 网关按头决定下发哪份目录、账单记成谁 | qoder `DEFAULT_HEADERS` / WB `chatHeaders` / Trae `PROTOCOL_EVIDENCE.md` | 部分【确认】：见 §3.1 |
| 12 | 工具调用是否原生 / 渠道校验风控 | 决定 DSML 恢复这一大块 | qoder DESIGN §二 / WB DESIGN §二（11128） | 【确认】非原生，伪协议 → 需转换层 |
| 13 | probe 真实成本 / 限流按体积还是次数 / 恢复时间来源 | 决定「测试」按钮怎么写 | qoder `probe.ts` / WB `probe.ts` | 【空白】需真账号 |
| 14 | DSH 宿主契约（注册链路 / ns / pi-ai 世代 / client 槽位） | 对外骨架能否复用 | `BLUEPRINT.md` §2 三家通用 | 【确认】已核实；且官方 DSH 配置页给出零代码方案 |

---

## 5. 风险与合规

- **【确认】官方条款正文抓不到**：CatPaw 用户协议 `https://catpaw.meituan.com/product-service` 存在（由 [官方教程镜像 FAQ](https://www.w3cschool.cn/catpawguides/catpaw-faq-security.html) 引用），但为 SPA，**禁止非官方客户端 / 自动化 / 账号共享 / 风控规则一条都没查到**，无法给出合规结论。这是「做不做」的前置条件。
- **【确认】所有逆向项目都自认风险**：Agent2API 使用声明（见 §3 B）、thief-neko「仅用于你自己的 Catpaw 账号和额度，与美团无官方关联」、catpaw-bridge「仅供学习和研究…不会用于商业用途」。三者都写明「上游接口随时可能变更，随时失效」。
- **【确认】DSH 同类插件的惯例**：`dsh-workbuddy-connect` 免责声明「依赖客户端接口（非官方开放 API），客户端更新后插件可能需要随之调整」「账号被限制、额度被清空、服务中断，由使用者自行承担」；导航站通用警告「安装即以你的权限运行第三方代码，**DSH 的工具审批不会为插件代码加沙箱**」。缓解惯例：只读凭据探测、loopback shim + 随机端口 + 进程内 secret、查询只读不消耗额度、`status/doctor/logout` 诊断命令。
- **【确认】部分自动化行为更接近风控红线**：thief-neko 的「自动签到/自动申请额外额度/多账号轮转」、Agent2API 的「多账号选路 + 429 降级 + 独立出网代理 + 自动签到」，以及第三方 hub 宣称的「稳定设备指纹防风控」。Agent2API 还接受住宅 ISP 代理赞助，与「每账号配一个出口」直接关联。
- **许可证矩阵**：`Agent2API` = AGPL-3.0（传染性，Gitee 旧镜像 MIT+禁商用，两版不一致）；`thief-neko` = MIT；`catpaw-bridge` = MIT；`catpaw2api` 已归档。参考实现按 Qoder 的做法「只取行为、独立重写、写进 `THIRD_PARTY_NOTICES`」，并履行 Apache-2.0 参考实现的 NOTICE/改动声明。
- **隐私（若将来写插件，第一天就要守）**：真实账号名/邮箱/手机号/余额/到期时间/token/本机路径/设备 id 一律不许进仓库；截图必须用假数据重出图，马赛克/模糊/半透明都不算脱敏；发版前 `check-pii.mjs` / `verify:privacy` 双跑，图片人眼验像素。详见三份 [AGENTS.md](../temp/dsh-connect-workbuddy-main/AGENTS.md)。
- **环境**：本会话 `pwsh` 被工作区根目录的 Windows 文件权限挡住（`SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\DSH-Catpaw2API)`），只读扫描工具正常。不影响调研，但会影响后续 `pnpm install/build/test`；已加载 `diagnose-windows-sandbox-acl` 修复脚本，需要时申请一次授权运行。

---

## 6. 明确没查到的空白 / 待你补齐

1. **CatPaw 官方用户协议正文**（SPA 需浏览器渲染）——禁止非官方客户端/自动化/账号共享条款一条都没查到，**这是决定「做不做」的前置条件**。
2. **官方文档站 /docs、/guides/、/changelog 正文**（SPA，只拿到标题）；w3cschool 镜像是第三方转存。
3. **CatPaw 官方对外颁发的 PAT / API Key / 出向 Access Token**：完全没查到。所有 `accessToken` 都是「从本地登录态读出来的会话 token」。
4. **macOS / Linux 上 CatPaw IDE 的凭据落盘路径**：所有公开证据只覆盖 Windows（`%APPDATA%\CatPawAI\...`、`platform: win32-x64`）。thief-neko 的 Linux 方案是「短信 API 自己登录 + 加密 session.enc」，不是复用桌面凭据。**跨平台是真实缺口**。
5. **官方的模型目录 / 额度 / 签到接口文档**：一个都没有。`/api/user/limit`、自动申请额外额度、签到等只出现在逆向项目里。
6. **「抓包记录」型图文教程**（掘金/知乎/V2EX/博客）：搜索未命中有效原文（知乎 403、V2EX 不相关）。协议细节全部来自 4 个开源项目源码，**缺少独立第二来源交叉验证**。
7. **CatPaw 客户端账号与 LongCat 开放平台 API 额度是否互通/互抵**：无任何官方说明，现有证据强烈指向**两套独立体系**。
8. **两套站点的官方归属关系**：`meituancatpaw.com`（下载营销页）与 `catpaw.meituan.com`（产品/文档主域）未找到官方说明。
9. **你当前 DSH 版本 `settings.yaml` / `cordis.patch.yml` 的实际布局**是否与官方 0.1.2-rc.1 文档一致（升级过版本可能有变）。

**最需要人工用真实账号补齐的（按优先级，多数只读、脱敏）**：
1. **先做合规**：浏览器打开用户协议读全文 —— 决定「做不做」。
2. Windows + macOS 分别装当前版本 CatPaw IDE，确认 `state.vscdb` 路径与 `catpaw.mt-authentication` / `mt.auth` 结构仍有效，补齐 macOS 路径。
3. DevTools → Network 抓一次完整对话，确认 `/api/gpt/openai/stream` 的**全套请求头**（`Catpaw-Auth` 是否仍裸 token、`tenant` 是否仍 `5282fa6645`、各版本头当前值）与 `encrypted-key` 解密密钥来源。
4. 抓一次**带工具调用**的完整 SSE 流，确认真实 chunk 字段、`delta` 转换、伪工具调用标签、`suggestUuid`/`conversationId` 语义、usage 上报。
5. 抓**模型目录接口**与 `userModelTypeCode` ↔ 模型 ID 映射、每模型额度倍率；抓**额度/签到/申请额外额度**接口真实返回。
6. 验证 `refreshToken` 有效期、401 自动刷新；记录账号被限流/风控的实际阈值。
7. 交叉验证：同一真账号分别调官方 LongCat API 与逆向通道，确认两套额度确实独立、互不抵扣。
8. 按 Trae 的纪律，**受控单次 live E2E 需你明确批准**（极短提示、max_tokens 极小、单端点、无回退、脱敏记录）。

---

## 7. 对「接下来的工作」的建议（待你拍板）

按本轮确认「先只做调研、骨架先不定、等上游资料」，下一步只做**零成本的事实确认**，不写代码：

1. **先定目标（所有分歧的根）**：
   - 「在 DSH 里用上 LongCat 模型」→ **路线 A，官方文档照抄即可，10 分钟配完，本项目可结项**；
   - 「花掉 CatPaw 客户端赠送/订阅额度、用 GLM-5.2 等模型」→ **路线 B**（填本地网关 baseURL，零开发）或 **C**（自研 DSH 原生插件）；
   - 「做一个能发 npm、和那三个插件一致的 DSH 原生插件」→ **路线 C**。
2. **你给上游资料时最有用的**（按价值排序）：一次真实对话的抓包（HAR / DevTools fetch，含 URL、头、请求体、SSE 分片）；客户端配置文件路径与字段形状（**只给字段名与形状，别给真 token**）；明确「妙手」指哪个客户端、是否有国内/国际两区；用户协议正文截图（脱敏）。
3. **我这边已顺手做完、无需真账号的**：确认 DSH 自定义 provider 与官方零代码方案；查清 4 个逆向项目的协议事实与许可证；从三个参考插件提炼出可复用方法论、事实清单、骨架决策树。**还能继续做的**：把「可复用模块 → 必须重写模块」清单细化到文件级、核实你本机 DSH 版本的配置布局、（若授权）做一次「不写真账号、只验证配置形状」的 DSH 自定义 provider 预演。

> 报告到此为止。**没有写任何插件代码、没有修改 `temp/` 下任何文件**。等你给上游资料并选定路线后，再进入「写 probe 脚本 → 出逐字取证文档 → 搭骨架」的实现阶段。

---

## 附录 A：主要来源

- 官方：[CatPaw 发布文](https://tech.meituan.com/2026/07/28/CatPaw-LongCat.html) · [妙手文档](https://catpaw.meituan.com/docs) · [CatPaw 首页](https://catpaw.meituan.com/) · [CatPaw IDE 下载页](https://meituancatpaw.com/download) · [用户协议](https://catpaw.meituan.com/product-service)（SPA 正文不可抓） · [w3cschool 官方教程镜像](https://www.w3cschool.cn/catpawguides/)
- LongCat 开放平台：[DeepSeek Harness 配置](https://longcat.chat/platform/docs/zh/deepseek-harness) · [接入 CatPaw](https://longcat.chat/platform/docs/zh/catpaw) · [快速开始](https://longcat.chat/platform/docs/zh/) · [API 概述](https://longcat.chat/platform/docs/zh/api-docs) · [Chat](https://longcat.chat/platform/docs/zh/api/chat) · [模型列表](https://longcat.chat/platform/docs/zh/api/models) · [FAQ](https://longcat.chat/platform/docs/zh/faq) · [定价](https://longcat.chat/platform/docs/zh/pricing/longcat-2.5) · [Token 资源包](https://longcat.chat/platform/docs/zh/token-pack)
- 第三方逆向项目：[Agent2API GitHub](https://github.com/aimod-cc/agent2api) · [Gitee 镜像（含中文使用声明）](https://gitee.com/aimodcc/agent2api) · [Agent2API 入门教程](https://www.aiezz.com/tutorial/tutorial-ee1bec260159cf2bf1f958da) · [Agent2API 的 DSH 适配器源码](https://github.com/aimod-cc/Agent2API/blob/main/desktop-tauri/src-tauri/server/src/server/core/agents/clients/dsh.rs) · [Agent2API 的 CatPaw 账号模块](https://github.com/aimod-cc/Agent2API/blob/main/desktop-tauri/src-tauri/server/src/server/core/account_store/catpaw_accounts.rs) · [thief-neko](https://github.com/KanoNoUta/thief-neko)（`config.js` / `catpawState.js` / `catpawAuthClient.js` / `catpawAgent.js` 已逐字复核） · [catpaw-bridge](https://github.com/fifasheng-tech/catpaw-bridge) · [catpaw2api（已归档）](https://github.com/Juwan-Hwang/catpaw2api) · [AI OPC Hub: CatPaw 是什么](https://aiopchub.cn/tools/catpaw)
- 仓库内：[README.md](../README.md) · [qoder BLUEPRINT.md](../temp/dsh-connect-qoder-main/BLUEPRINT.md) · [qoder PAT.md](../temp/dsh-connect-qoder-main/docs/PAT.md) · [qoder probe-cosy.mjs](../temp/dsh-connect-qoder-main/scripts/probe-cosy.mjs) · [workbuddy AGENTS.md](../temp/dsh-connect-workbuddy-main/AGENTS.md)

## 附录 B：v1 → v2 修正记录（如实留痕）

- v1 判断「CatPaw 上游协议公开资料为 0、GitHub 无独立逆向项目、只能靠真账号从零抓包」——**错误**。补充调研找到 4 个开源逆向项目，`thief-neko` 源码给出完整协议规格。已改为「不需要从零抓包，但需用真账号复核当前版本」。
- v1 把「DSH 自定义 provider」标为「待确认、建议查宿主实现」——**已确认**，且发现 LongCat 官方就有 DeepSeek Harness 配置专页，路线 A 从「推断可行」升级为「官方文档盖章的零代码方案」。
- v1 未区分「接 CatPaw」与「接 LongCat」——v2 明确：客户端额度主用 `glm-5.2` 等第三方模型，官方 API 只有 `LongCat-2.5` 且单独计费，**两者不是一回事**，列为立项前必须拍板的首要问题。
- v1 未纳入参考插件的证据分级（A/B/C/D）、probe 纪律、骨架决策树、条件性可删模块——v2 由第二份子代理报告补入 §1.1 / §1.2 / §4 / §7。
