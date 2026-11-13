# LongCat 官方 API 参考（OpenAI 格式 · 通道 A）

> **用途**：DSH-CatPaw 插件「通道 A（官方 API）」实现与验收的权威依据。
> **来源**：从 LongCat 官方开放平台文档整理的原文（2026-11-08 由用户提供，原 `temp/temp.txt` 已在 P3 清理；其内容已完整并入本文，含 §4.1 的采样参数与范围校验）。
> **范围限定**：**只保留 OpenAI 兼容格式**。原文里 Anthropic 兼容端点、`/anthropic/...`、`/v1/messages`、`image` 块等内容**全部剔除**，不在本文出现；本项目通道 A 只用 OpenAI 端点。
> **本文性质**：整理后的参考文档，不是实现代码。与 [plan.md](plan.md) / [implementation.md](implementation.md) 中通道 A 的设计互相印证，不替代二者。
> **隐私**：本文不含任何真实 API Key（一律写作 `YOUR_API_KEY`）、账号、余额数字或本机路径。

---

## 1. 接入端点与鉴权（OpenAI 格式）

| 项 | 值 |
| --- | --- |
| Base URL | `https://api.longcat.chat/openai` |
| 对话补全 | `POST https://api.longcat.chat/openai/v1/chat/completions` |
| 模型列表 | `GET https://api.longcat.chat/openai/v1/models` |
| 模型详情 | `GET https://api.longcat.chat/openai/v1/models/{model}` |
| 鉴权 | 请求头 `Authorization: Bearer YOUR_API_KEY` |
| Content-Type | `application/json` |

> 说明：官方「快速开始」里写 `base_url = https://api.longcat.chat/openai`（不带 `/v1`），SDK 会再拼 `/v1/chat/completions`；本文按**完整请求路径**记录，二者一致。

**当前可用模型**：`LongCat-2.5`（模型列表接口返回 `data` 中目前仅此一个）。

---

## 2. 模型列表接口

`GET /openai/v1/models`

请求：

```bash
curl --location 'https://api.longcat.chat/openai/v1/models' \
  --header 'Authorization: Bearer YOUR_API_KEY' \
  --header 'Content-Type: application/json'
```

200 响应：

```json
{
  "object": "list",
  "data": [
    {
      "id": "LongCat-2.5",
      "object": "model",
      "owned_by": "LongCat"
    }
  ]
}
```

> **实现含义**：响应里**只有** `id` / `object` / `owned_by`，**没有**上下文长度、最大输出、模态等字段。因此插件在解析"有哪些模型"之后，模型的 `contextWindow` / `maxTokens` / `input` 只能来自静态值或"模型详情接口"（见 §3），不能凭空造。这与 `LONGCAT_CATALOG_FALLBACK` 的设计一致（见 [design.md](design.md) / [implementation.md](implementation.md)）。

---

## 3. 模型详情接口

`GET /openai/v1/models/{model}`，`{model}` 为模型标识符（如 `LongCat-2.5`）。

请求：

```bash
curl --location 'https://api.longcat.chat/openai/v1/models/LongCat-2.5' \
  --header 'Authorization: Bearer YOUR_API_KEY' \
  --header 'Content-Type: application/json'
```

200 响应（原文示例）：

```json
{
  "id": "LongCat-2.5",
  "name": "LongCat-2.5",
  "created": 1773331200,
  "context_length": 1048576,
  "architecture": {
    "input_modalities": ["text"],
    "output_modalities": ["text"],
    "modality": "text->text",
    "tokenizer": "Other",
    "instruct_type": null
  },
  "supported_parameters": [
    "max_tokens",
    "temperature",
    "top_p",
    "stream",
    "tools",
    "tool_choice",
    "thinking"
  ],
  "pricing": { "prompt": "2", "completion": "8", "cached_tokens": "0.04" }
}
```

**字段说明**：

| 字段 | 含义 |
| --- | --- |
| `context_length` | 上下文长度，示例为 `1048576`（1M） |
| `architecture.input_modalities` | 原文示例为 `["text"]` —— **与 §5「视觉理解」及官方 DSH 配置页"支持图片"的口径不一致**，见下方注意 |
| `supported_parameters` | 支持 `max_tokens` / `temperature` / `top_p` / `stream` / `tools` / `tool_choice` / `thinking`；**不含** `reasoning_effort` 等级 |
| `pricing` | 单价（每百万 Token）：输入 `2`、输出 `8`、缓存命中 `0.04`。**这是单价，不是余额** |

> **注意（口径差异，实现时别踩）**：模型详情响应里 `architecture` 写成 `text->text`，但 §5 视觉理解章节与官方「DeepSeek Harness 配置」页都明确 LongCat-2.5 **支持图片输入**。若用本接口的 `input_modalities` 去动态填模型的 `input`，会得出"纯文本"这一与另两处矛盾的结果。
> **整理建议（供实现参考，非强制）**：阶段一以「模型列表接口」拿"有哪些模型"、上下文/模态沿用官方 DSH 配置页盖章的静态值（`contextWindow: 1048576`、`input: ['text','image']`）；模型详情接口**只登记、不用于动态推断模态**，以免不同执行者各自解读。

---

## 4. 对话补全与思考开关

- `POST /openai/v1/chat/completions`，标准 OpenAI 兼容格式，Bearer 鉴权。
- 请求体支持 `model` / `messages` / `max_tokens` / `temperature` / `top_p` / `stream` / `tools` / `tool_choice` / `thinking`。
- **思考模式**：`thinking: {"type":"enabled"}` 开启、`{"type":"disabled"}` 关闭；**仅支持开/关，不支持 `reasoning_effort` 等级**（`low`/`medium`/`high` 无效）。
- `stream: true` 时以 SSE 返回。

> **实现含义**：通道 A 在插件里是「原样透传、不改请求形状」——DSH 发出的标准 OpenAI 请求直接转发即可，SSE 由回环 shim 处理。`longcat.ts` 的 `chat()` 设计与此一致。

### 4.1 采样与生成参数（官方默认值与约束）

上下文长度为单次请求可处理的最大 Token 总量（含输入与输出）：**1,048,576（1M）**。

| 参数 | 类型 | 默认值 | 范围 / 约束 |
| --- | --- | --- | --- |
| `temperature` | number | 开启思考 `1.0` / 关闭思考 `0.7` | **固定值**；传入其它值不报错，会被覆盖为对应状态下的默认值 |
| `top_p` | number | `0.95` | `(0, 1]` |
| `top_k` | integer | `-1`（不启用） | `[-1, 100]` |
| `repetition_penalty` | number | `1`（不惩罚） | `[1, 1.5]` |
| `max_tokens` | integer | — | 上限 `262144`；只限制输出长度，达到上限时 `finish_reason: "length"` |
| `thinking_budget` | integer | — | 上限 `262144` |

**参数说明**：
- `temperature` 控制随机性，越高越多样；其值随 `thinking` 开关联动（见上表）。
- `top_p` 为核采样概率阈值；`top_k` 把候选限制为概率最高的 K 个；`repetition_penalty` 降低重复 Token。
- `thinking` 开关：`{"type":"enabled"}` 开启、`{"type":"disabled"}` 关闭；**只支持开/关**，不支持 `reasoning_effort` 多档。

**范围校验**：`top_p` / `top_k` / `repetition_penalty` / `max_tokens` 传入越界值时返回
`400` `invalid_request_error` / `invalid_parameter`，错误信息逐条指出越界参数：

```json
{
  "error": {
    "message": "参数校验失败: \n/top_p: 2 is not less or equal to 1\n/repetition_penalty: 3 is not less or equal to 1.5\n",
    "type": "invalid_request_error",
    "code": "invalid_parameter"
  }
}
```

> 本表来自官方模型参数文档（原 `temp/temp.txt`，已并入本文；原文件在 temp/ 清理后不再保留）。

---

## 5. 视觉理解（OpenAI 兼容 `image_url` 块）

LongCat-2.5 支持在文本之外输入**图片和视频**；使用标准 OpenAI 兼容对话补全格式，即 `messages[].content` 为**块（block）数组**而非纯字符串。

### 5.1 传入图片（两种方式）

**方式一 · Base64 内联（`data:` URL）** —— 本地文件最简单的方式，Base64 数据计入请求体大小限制。

```python
import base64
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://api.longcat.chat/openai"
)

with open("image.jpg", "rb") as f:
    b64 = base64.b64encode(f.read()).decode("utf-8")

response = client.chat.completions.create(
    model="LongCat-2.5",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "这张图片里有什么？"},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                },
            ],
        }
    ],
)
print(response.choices[0].message.content)
```

等价 curl：

```bash
curl https://api.longcat.chat/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "LongCat-2.5",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "这张图片里有什么？"},
          {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,<BASE64_DATA>"}}
        ]
      }
    ]
  }'
```

**方式二 · 外部图片 URL** —— 传可公开访问的 `http(s)` 链接，模型自动下载。

```python
response = client.chat.completions.create(
    model="LongCat-2.5",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "描述一下这张图片。"},
                {
                    "type": "image_url",
                    "image_url": {"url": "https://example.com/image.jpg"},
                },
            ],
        }
    ],
)
print(response.choices[0].message.content)
```

### 5.2 传入视频（`video_url` 块，仅 URL 方式）

视频**仅支持 URL 传入**，模型自动下载并解析：

```python
response = client.chat.completions.create(
    model="LongCat-2.5",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "这个视频里发生了什么？"},
                {
                    "type": "video_url",
                    "video_url": {"url": "https://example.com/video.mp4"},
                },
            ],
        }
    ],
)
print(response.choices[0].message.content)
```

### 5.3 OpenAI 兼容接口要点（本文范围内）

- 请求路径：`POST https://api.longcat.chat/openai/v1/chat/completions`
- 模型名称：`LongCat-2.5`
- 图片内容块：`{"type":"image_url","image_url":{"url":"..."}}`，`url` 支持公网 URL 或 `data:` URL（Base64）
- 视频内容块：`{"type":"video_url","video_url":{"url":"..."}}`，`url` 仅支持公网 URL

### 5.4 图片限制

| 限制项 | 数值 |
| --- | --- |
| 支持格式 | PNG、JPG、JPEG、WebP、GIF（不支持 SVG、HEIC/HEIF 等） |
| 传入形式 | Base64 编码、URL |
| 单边宽高 | 宽、高均不超过 5120 像素 |
| 总像素 | 宽 × 高不超过 5,242,880 像素 |
| 最小面积 | 宽 × 高不小于 200 像素 |
| 原始宽高比 | 不超过 200:1 |
| 单张图片大小 | 不超过 10 MB |
| 单请求图片数量 | 不超过 100 张 |

### 5.5 视频限制

| 限制项 | 数值 |
| --- | --- |
| 单个视频大小 | 不超过 100 MB |
| 单请求视频数量 | 不超过 10 个 |
| 单个视频时长 | 小于 3600 秒 |

> **实现含义**：通道 A 不改写请求形状，`image_url` / `video_url` 块会原样透传给 LongCat；DSH 侧模型描述符的 `input` 只认 `text` / `image`（不含 `video`），故上述视频限制属"上游能力/文档信息"，插件不声明视频输入。图片尺寸限制由上游执行，前端可按需提示，阶段一不处理。

---

## 6. 限流与错误响应

达到限流时返回 HTTP 429，响应体（原文示例）：

```json
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "请求频率超限，请稍后重试",
    "type": "rate_limit_error",
    "retry_after": 60
  }
}
```

建议客户端实现指数退避重试。

> **实现含义**：阶段一 shim 对通道 A 是透传、不解析错误码；这段是**阶段三错误分类 / 换号策略**的权威依据（对应 `docs/plan.md` §9 阶段三"异常路径"与参考插件 `classifyUpstreamError` 的做法）。记录备用，不在阶段一实现。

---

## 7. 关于「余额 / 用量」：本次权威资料中确实没有

把 `temp.txt` 全文（模型列表、模型详情、视觉理解、限流、定价）通读后，**没有任何"查询账户余额 / 用量"的接口**。文档里只有：

- `pricing` 单价（输入 2 / 输出 8 / 缓存 0.04 每百万 Token）——**单价 ≠ 余额**；
- 定价页/资源包/USAGE 页面属控制台网页，不在本套 OpenAI API 里。

**结论**：插件官方 tab 的"余额/用量"栏，在"直接访问官方 API 平台"的前提下**拿不到可编程读数**。按 `docs/plan.md`「设置卡显示契约」的**读数纪律**处理：

- 如实显示「官方未提供可编程余额接口，读不到」；
- **不编造数字**，也不拿 Token 用量或 `pricing` 单价去凑一个"余额"；
- 模型列表（§2）本身是实时、准确的，照常显示。

> 这条印证了 [implementation.md](implementation.md) 中"官方无余额接口、不编造数字"的读数纪律是对的、且是必须的。

---

## 8. 与本项目文档的对应关系（快速索引）

| 本文 | 相关文档 | 实现位置 |
| --- | --- | --- |
| §1 端点 / Bearer | [plan.md](plan.md) 第六节 F3、[design.md](design.md) | `src/longcat.ts` 的 `LONGCAT_BASE_URL` / `KEY_ENV_VAR` |
| §2 模型列表 `GET /v1/models` | [implementation.md](implementation.md) | `longcat.ts` 的 `listModels()` |
| §3 模型详情 `context_length`、`pricing` | [implementation.md](implementation.md) 读数纪律 | `LONGCAT_CATALOG_FALLBACK`（1048576） |
| §4 对话补全 / thinking / 原样透传 | [design.md](design.md) | `longcat.ts` 的 `chat()`、shim 分流到 A |
| §4.1 采样参数与范围校验 | 本文 | 原样透传，参数由上游校验 |
| §5 视觉理解 / `input` | [design.md](design.md) | fallback `input:['text','image']` |
| §6 429 错误体 | [implementation.md](implementation.md) §2（0.2.3 已实现归一化） | `src/shim.ts` 的 `writeRateLimitResponse()` |
| §7 确无余额接口 | [design.md](design.md)「明确不做」 | 官方 tab 不渲染余额栏 |

---

## 9. 已剔除的内容（明确列出，避免误用）

以下原文内容因"只关注 OpenAI 格式"而**不纳入本文、也不纳入本项目通道 A 实现**：

- Anthropic 兼容端点 `https://api.longcat.chat/anthropic` 及 `/anthropic/v1/models`、`/anthropic/v1/models/{model}`、`/anthropic/v1/messages`；
- Anthropic 专用 `image` 块（`source: {type:'base64'|'url', ...}`）与 `anthropic.Anthropic(...)` SDK 示例；
- "模型列表 / 模型详情支持 OpenAI 与 Anthropic 两个端点"中涉及 Anthropic 的那半句；
- 原文注释掉的「Token 用量 / 图片 Token 计算器」段落（标注"暂未放开"）。
