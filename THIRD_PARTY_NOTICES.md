# Third-party notices

本项目的代码均为独立重写；下列项目/资料仅作为行为与结构的参照，未复制其源码。

1. `dsh-connect-workbuddy`（MIT，Copyright (c) 2026 LaoDing）
   - 参考了什么：设置页卡片/双 tab 外壳、插件工程骨架（package.json 的 dsh 字段、tsdown 双 target 构建、vitest 隔离 home）、只读 probe 脚本的组织形态。
   - 本项目改了什么：按通道（官方 API / 妙手）而非地区划分两个 tab；只取结构与思路，全部代码独立重写；不复用其账号池、签到、徽标等增值模块。

2. `dsh-connect-trae`（MIT，Copyright (c) 2026 LaoDing）
   - 参考了什么：协议证据分级（A/B/C/D）与"实测优先、不臆测"的取证纪律。
   - 本项目改了什么：仅借鉴文档方法，未复制实现。

3. `dsh-connect-qoder`（MIT，Copyright (c) 2026 LaoDing）
   - 参考了什么：provider 注册链路（`registerAdapter` / `registerConfigurableProviders` / `registerModelDiscovery`）、pi-ai adapter 组装、回环 shim 的安全模型、`scripts/probe-*.mjs` 只读探针形态。
   - 本项目改了什么：上游协议换成 LongCat 官方 API（通道 A）与妙手客户端（通道 B，阶段一为占位）；独立重写，未复制其 cosy 签名等协议代码。

4. `aimod-cc/Agent2API`（AGPL-3.0）
   - 参考了什么：其 "CatPaw provider" 行为的**公开描述**（复用客户端登录态转 OpenAI 兼容端点这一思路）。
   - 本项目改了什么：未复制任何源码；通道 B 的真实逻辑不在本阶段实现（阶段一为空白占位）。因 AGPL-3.0 的传染性，本项目不与它合并或链接代码。

5. `KanoNoUta/thief-neko`（MIT）、`fifasheng-tech/catpaw-bridge`（MIT）、`Juwan-Hwang/catpaw2api`（已归档）
   - 参考了什么：妙手客户端协议知识的公开整理（端点形状、请求头形状、凭据落盘形状），仅作阶段二取证时的线索登记。
   - 本项目改了什么：本阶段不实现通道 B，仅登记来源；未复制源码。

6. LongCat 官方开放平台文档（外部资料，见 `docs/longcat.md`）
   - 参考了什么：OpenAI 兼容端点、`GET /v1/models`、`GET /v1/models/{model}`、`thinking` 字段、429 错误体等接口事实。
   - 本项目改了什么：接口字段按官方文档实现，官方文档本身不属于本项目代码。

> 注意：以上第三方项目与官方文档的原名（含 "CatPaw"）按命名约定原样保留，不因产品中文名「妙手」而替换。
