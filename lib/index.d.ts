import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
type ChannelId = 'longcat' | 'catpaw';
type ContextTier = '200K' | '500K' | '1M';
interface CatalogEntry {
  id: string;
  provider: ChannelId;
  name: string;
  contextWindow: number;
  maxTokens: number;
  input: Array<'text' | 'image'>;
  reasoningEfforts?: Record<string, string | null>;
  supportedParameters?: string[];
  pricing?: {
    prompt: string;
    completion: string;
    cached_tokens: string;
  };
  detailSource?: 'live' | 'fallback';
  contextTiers?: ContextTier[];
  contextTier?: ContextTier;
  contextTierSource?: 'live' | 'placeholder';
}
/**
 * 宿主侧看到的配置值（**已解包**的普通值）。
 *
 * `.volatile()` 会让 schema 的输出类型变成 `Volatile<T>`（一个带 `.get()`
 * 的活值包装）。但 `apply(ctx, config)` 拿到的 config 里，schemastery 已经
 * 把 volatile 包装解析成当前值（见 cosmokit `plainConfig`：遇到 volatile
 * 就 `.get()`），所以**宿主侧读到的就是普通值**。
 *
 * 因此这里保持普通类型，宿主侧代码零改动；schema 侧用下面的 `ConfigSchema`
 * 承载 volatile 标记。
 */
interface Config {
  apiKey: string;
  apiKeyEnv: string;
  lastCatalog: CatalogEntry[];
  thinkLongcat: boolean;
  thinkCatpaw: boolean;
  channelB: {
    enabled: boolean;
    catalog: CatalogEntry[];
    credits: number | null;
    contextTiers: Record<string, '200K' | '500K' | '1M'>;
  };
}
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
declare const Config: z<Config>;
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
declare const inject: string[];
/**
 * settings 命名空间探测（BLUEPRINT §2(d)）：`ctx.fiber.entry?.options.id` 是
 * Loader 条目 id，不是插件自选名；探测失败（无 Loader，如测试直接 ctx.plugin()）
 * 时回落到 `PLUGIN_ID`。宿主精确匹配查表，猜错会让 provider 被判「未配置」。
 */
declare function settingsNamespaceOf(ctx: unknown): string;
/**
 * 插件入口。宿主按 `apply(ctx, config)` 同步调用；其中 `await shim.ready` 起的
 * 注册链放在一个异步 IIFE 里（与 BLUEPRINT §2 的 `Promise.all(shims.ready).then`
 * 等价），这样 apply 仍是 `void` 签名，但装配严格按 ①→⑨ 顺序。
 */
declare function apply(ctx: Context, config: Config): void;
export { Config, type Config as ConfigShape, apply, inject, settingsNamespaceOf };