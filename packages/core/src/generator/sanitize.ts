/**
 * @module sanitize
 * @description LLM 生成页面的输出清洗，在引用/mermaid 校验**之后**、写盘之前执行：
 *
 * 1. 删除占位行（"[本节为通用指导，无需列出章节来源]" 等）——它们是校验器约定的
 *    一部分（标记"本节确实无来源"），但读者不应看到；
 * 2. 剥除 `<cite>` 块内模型幻觉出的元信息行（"文档版本"、"最后更新"等，源码中
 *    并不存在这些信息）——保守起见只动 cite 块内部，正文中的日期不受影响；
 * 3. 折叠清洗产生的连续空行。
 */

import { getLabels } from '../i18n/labels.js';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 占位行匹配：zh/en 两套一并剥除（页面语言与占位行语言可能不一致）。
 * 容忍模型追加的尾部标点（如 "……章节来源]。"）。
 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = (['zh', 'en'] as const).flatMap((lang) => {
    const labels = getLabels(lang);
    return [labels.genericPlaceholder, labels.summaryPlaceholder].map(
        (p) => new RegExp(`^\\s*${escapeRegExp(p)}[\\s。．.!！]*$`),
    );
});

/** cite 块内的幻觉元信息行（文档版本/最后更新/生成日期等，含加粗与表格行变体） */
const CITE_META_PATTERN =
    /文档版本|最后更新|更新日期|更新时间|生成日期|生成时间|document\s*version|last\s*updated|generated\s*(?:on|at|date)/i;

function stripCiteMeta(inner: string): string {
    return inner
        .split('\n')
        .filter((line) => !CITE_META_PATTERN.test(line))
        .join('\n');
}

/**
 * 清洗单个 wiki 页面内容。幂等；对无需清洗的内容原样返回。
 */
export function sanitizeWikiPage(content: string): string {
    // 1. 全文删除占位行（整行仅为占位文本 + 可选尾部标点时移除）
    let result = content
        .split('\n')
        .filter((line) => !PLACEHOLDER_PATTERNS.some((p) => p.test(line)))
        .join('\n');

    // 2. cite 块内剥除幻觉元信息
    result = result.replace(
        /<cite>([\s\S]*?)<\/cite>/g,
        (_m, inner: string) => `<cite>${stripCiteMeta(inner)}</cite>`,
    );

    // 3. 折叠 3 个以上连续换行为一个空行
    return result.replace(/\n{3,}/g, '\n\n');
}
