/**
 * @module citation-validator
 * @description 校验 LLM 生成的 Wiki 页面中的源码引用（grounding 纪律的执行者）。
 *
 * 解析形如 `file://<...>/<relpath>#Lstart-Lend`（或单行 `#Lstart`）的引用，验证：
 *   1. 被引路径确实存在于扫描到的文件集合中；
 *   2. 行号区间合法（start<=end，且 end 不超过文件真实行数）；
 *   3. 页面至少包含一个来源块（章节来源/图表来源），且每个 mermaid 图后附有来源块。
 *
 * 校验通过解析出的 {@link SourceReference} 列表用于回填 `WikiPage.sourceRefs`。
 */

import type { SourceReference } from '../models/index.js';

/** 单条校验错误 */
export interface CitationError {
    kind: 'unknown-file' | 'bad-range' | 'no-sources' | 'diagram-without-source';
    message: string;
}

/** 校验结果 */
export interface CitationValidationResult {
    ok: boolean;
    errors: CitationError[];
    /** 解析并验证通过的引用（可用于回填 sourceRefs） */
    citations: SourceReference[];
}

/** 匹配带行号的 file:// 引用：捕获 path 与行号区间 */
const CITE_WITH_RANGE = /file:\/\/([^\s)#]+)#L(\d+)(?:-L?(\d+))?/g;

/** 匹配 mermaid 代码围栏 */
const MERMAID_FENCE = /```mermaid[\s\S]*?```/g;

/**
 * 规范化路径：统一斜杠、去除末尾。
 */
function normalize(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * 将被引路径解析为已知的相对路径。
 * 引用里的 path 通常是 `<projectRoot>/<relpath>`，故用"已知相对路径是被引路径后缀"来匹配，
 * 从而对根目录差异（绝对路径/盘符）保持健壮。
 *
 * @returns 命中的相对路径，未命中返回 null
 */
function resolveToKnown(citedPath: string, knownFiles: Map<string, number>): string | null {
    const cited = normalize(decodeURIComponent(citedPath));
    // 精确命中
    if (knownFiles.has(cited)) return cited;
    // 后缀命中（被引路径含绝对前缀）
    for (const rel of knownFiles.keys()) {
        const nrel = normalize(rel);
        if (cited === nrel || cited.endsWith('/' + nrel)) {
            return rel;
        }
    }
    return null;
}

/**
 * 校验一篇 Markdown 页面的引用。
 *
 * @param content    - 生成的 Markdown 正文
 * @param knownFiles - 相对路径 → 行数 的映射（来自扫描结果）
 * @returns 校验结果（含解析出的合法引用）
 */
export function validateCitations(
    content: string,
    knownFiles: Map<string, number>,
): CitationValidationResult {
    const errors: CitationError[] = [];
    const citations: SourceReference[] = [];
    const seen = new Set<string>();

    let m: RegExpExecArray | null;
    CITE_WITH_RANGE.lastIndex = 0;
    while ((m = CITE_WITH_RANGE.exec(content)) !== null) {
        const rawPath = m[1];
        const start = parseInt(m[2], 10);
        const end = m[3] ? parseInt(m[3], 10) : start;

        const known = resolveToKnown(rawPath, knownFiles);
        if (!known) {
            errors.push({
                kind: 'unknown-file',
                message: `引用了不存在的文件: ${rawPath}（引用的文件必须是源码上下文中出现的路径）`,
            });
            continue;
        }

        const lineCount = knownFiles.get(known) ?? 0;
        if (start < 1 || end < start || (lineCount > 0 && end > lineCount)) {
            errors.push({
                kind: 'bad-range',
                message: `${known} 的行号区间非法: L${start}-L${end}（文件共 ${lineCount} 行）`,
            });
            continue;
        }

        const key = `${known}#${start}-${end}`;
        if (!seen.has(key)) {
            seen.add(key);
            citations.push({ filePath: known, startLine: start, endLine: end, reason: '' });
        }
    }

    // 至少要有一个来源块
    const hasSourceBlock =
        /\*\*(章节来源|图表来源|Section sources|Diagram sources)\*\*/.test(content);
    if (!hasSourceBlock && citations.length === 0) {
        errors.push({
            kind: 'no-sources',
            message: '页面未包含任何来源块（章节来源/图表来源）或有效的 file:// 引用。',
        });
    }

    // 每个 mermaid 图后应有图表来源块
    MERMAID_FENCE.lastIndex = 0;
    let diagramMatch: RegExpExecArray | null;
    while ((diagramMatch = MERMAID_FENCE.exec(content)) !== null) {
        const after = content.slice(diagramMatch.index + diagramMatch[0].length, diagramMatch.index + diagramMatch[0].length + 400);
        if (!/\*\*(图表来源|Diagram sources)\*\*/.test(after)) {
            errors.push({
                kind: 'diagram-without-source',
                message: '存在未标注"图表来源"的 Mermaid 图。',
            });
            break; // 报告一次即可，避免噪声
        }
    }

    return { ok: errors.length === 0, errors, citations };
}

/**
 * 将校验错误汇总成一段可读的纠正提示（喂回给 LLM 重试）。
 */
export function formatCitationErrors(errors: CitationError[]): string {
    return errors.map((e) => `- ${e.message}`).join('\n');
}
