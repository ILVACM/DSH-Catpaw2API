/**
 * 设置卡样式（CSS 文本 + 自注入）。
 *
 * 全部颜色用宿主主题变量 + 十六进制回退值，明暗主题自动适配。
 * 注入写法参照 temp/dsh-connect-workbuddy-main/src/client/WorkBuddyCard.tsx:295-307。
 *
 * @module dsh-connect-catpaw/client/styles
 */

export const CATPAW_CARD_CSS = `
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
`

// 模块顶层注入：document 存在性守卫让非浏览器环境（测试 / SSR）不炸。
if (typeof document !== 'undefined') {
  const cssId = 'dsh-connect-catpaw/client.css'
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${cssId}"]`)
  if (existing !== null) {
    existing.textContent = CATPAW_CARD_CSS
  } else {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-connect-catpaw'
    tag.dataset.pluginCss = cssId
    tag.textContent = CATPAW_CARD_CSS
    document.head.appendChild(tag)
  }
}
