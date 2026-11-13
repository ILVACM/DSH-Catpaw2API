# DSH-Catpaw2API

将美团 catpaw（妙手）接入 DSH 使用（注意自备账号）。

把妙手客户端通道与 LongCat 官方 API 接进 DSH 的双通道插件（当前版本 **0.2.3**）：

- **通道 A `longcat/*`**：官方 API，支持对话、视觉输入、429 自动重试。
- **通道 B `catpaw/*`**：复用本地妙手客户端的免费 LongCat-2.5 通道，支持工具执行与工作目录对齐。

两条通道同属 `catpaw2dsh` 模型选择器组，靠前缀区分。设置页第二个 tab 为「本地客户端通道复用」。

**隐私声明**：所有数据只留本机，插件不上传、不遥测、不代管；本仓库不含任何真实账号、令牌或路径。

**文档**：[设计](docs/design.md) · [探针结论](docs/probe-findings.md) · [实现记录](docs/implementation.md) · [官方 API 参考](docs/longcat.md) · [变更记录](CHANGELOG.md)
