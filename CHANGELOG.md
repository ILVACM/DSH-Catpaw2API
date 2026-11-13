# CHANGELOG

## 0.2.3（本次开发最终版）

- 官方通道 A：HTTP 429 归一化。shim 写回含 `429` / `rate_limit` 文本的响应并带
  `Retry-After` 头（上游给 60 也封顶 8s），让宿主 `dsh-llm-retry` 能正确归类并自动重试；
  重试期间输出可见提示。不自己写重试循环，次数与退避由宿主提供。
- 新增 9 组 429 测试与三项变异验证；全量 102 测试通过。
- 文档整理：把最终设计与实测结论合并进 `docs/design.md`、`docs/probe-findings.md`、
  `docs/implementation.md`，`docs/plan.md` 加指向；新建本 CHANGELOG。
- 清场：本地包只保留 `0.2.2`（回退基线）与 `0.2.3`（最终版）。

## 0.2.2

- 修复图片输入：把宿主 `attachments` 服务接给 pi-ai
  （原先贴图报 `pi-ai image input requires the durable attachment service`）。
- 新增附件接线回归测试；全量 93 测试通过。

## 0.2.1

- 修复 4 个运行时 bug：
  1. 端口写死 `6983..6990` → 改为按 `catpaw-cli` 进程 PID 动态定位；
  2. `GET /api/config` 的 404 被误判为配置失败 → 404 视为正常；
  3. 工作目录未接线导致 `Stream ended without finish_reason` → 从 system prompt 提取；
  4. B 通道返回非流式 JSON → 改为 SSE（`chat.completion.chunk` + `finish_reason` + `[DONE]`）。
- 全量 83 测试通过；真实链路端到端验证。

## 0.2.0

- 阶段二：接入本地妙手免费 LongCat-2.5 通道（`catpaw/LongCat-2.5`）。
- 设置页该 tab 改为「本地客户端通道复用」两行状态卡。
- 确定施工队模式边界与工作目录对齐；全量 73 测试通过。

## 0.1.7

- 阶段一：官方 LongCat 通道 + 插件骨架（双通道合并为一个模型选择器组）。
