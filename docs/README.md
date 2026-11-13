# 文档索引

> DSH-CatPaw 双通道插件的文档入口。所有文档互相链接，**不依赖 `temp/`**（已清理）。
> 当前版本：**`0.2.3`**（本次开发最终版）

---

## 阅读顺序

| # | 文档 | 内容 |
| --- | --- | --- |
| 1 | [design.md](design.md) | **最终设计**：施工队模式、DSH/妙手边界、工作目录对齐、设置页 GUI、模型选择器契约 |
| 2 | [probe-findings.md](probe-findings.md) | **实测结论**：免费通道、端口动态、config 404、27 个工具关不掉、档位是本地限制 |
| 3 | [implementation.md](implementation.md) | **实现记录**：阶段一排障教训、0.2.0–0.2.3 每版改动与验证、质量门禁 |
| 4 | [longcat.md](longcat.md) | **官方 API 权威参考**：端点、模型列表/详情、对话、思考开关、采样参数与范围校验、视觉输入限制 |
| 5 | [plan.md](plan.md) | 阶段一/二**早期总体方案**（含已放弃目标，历史文档；最新设计以 `design.md` 为准） |
| 6 | [CATPAW-调研报告.md](CATPAW-调研报告.md) | 立项期**调研报告**：技术路线选型与参考插件分析（含对 `temp/` 参考插件的引用，属历史记录） |

---

## 快速定位

| 我想知道… | 看这里 |
| --- | --- |
| 为什么要采用「施工队模式」 | [design.md §1](design.md) · [probe-findings.md §4](probe-findings.md) |
| 工作目录为什么必须对齐 | [design.md §2](design.md) · [probe-findings.md §3](probe-findings.md) |
| 设置页那个 tab 为什么只有两行 | [design.md §4](design.md) |
| 模型选择器为什么显示带前缀的名字 | [design.md §5.1](design.md) |
| 429 到底是谁在重试 | [implementation.md §2](implementation.md) · [probe-findings.md §6](probe-findings.md) |
| 图片输入报错怎么修的 | [implementation.md §2](implementation.md) |
| 官方 API 的参数默认值与范围 | [longcat.md §4.1](longcat.md) |
| 阶段一踩过哪些坑 | [implementation.md §1](implementation.md) |

---

## 本地验证命令

本仓的 `pnpm` 不在系统 PATH，`scripts/pnpm.cmd` 是包装垫片。跑验证前：

```powershell
$env:PATH = 'D:\DSH-Catpaw2API\scripts;C:\nodejs\aliases\default;' + $env:PATH
$env:CI = 'true'
pnpm run check        # typecheck + build + PII + vitest
```

单独跑测试：`pnpm run test`；只跑 PII：`pnpm run check:pii`。

> 该垫片只服务本机开发环境，**不进 npm 包**（`package.json` 的 `files` 白名单不含 `scripts/`）。

---

## 相关文件

- 仓库根：[README.md](../README.md)（一句话简介）· [CHANGELOG.md](../CHANGELOG.md)（版本变更）· [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)（许可证登记）
- 源码 `src/`、测试 `tests/`、脚本 `scripts/`
