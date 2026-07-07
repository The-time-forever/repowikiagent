/**
 * @module retriever
 * @description 面向问答的轻量页面检索：分词（拉丁词 + CJK 二元组）+ 加权词频评分。
 * 纯确定性、零依赖；不做向量化，wiki 目录本身就是索引。
 */

import type { WikiIndexEntry } from './wiki-index.js';

/** 检索命中 */
export interface RetrievedPage {
    entry: WikiIndexEntry;
    score: number;
}

/**
 * 分词：拉丁字母/数字连续段小写成词；CJK 字符按二元组（bigram）切分。
 */
export function tokenize(text: string): string[] {
    const tokens: string[] = [];
    const lower = text.toLowerCase();

    // 拉丁词
    for (const m of lower.matchAll(/[a-z0-9_$-]{2,}/g)) {
        tokens.push(m[0]);
    }
    // CJK 二元组
    const cjk = lower.match(/[一-鿿぀-ヿ가-힯]+/g) ?? [];
    for (const run of cjk) {
        if (run.length === 1) {
            tokens.push(run);
            continue;
        }
        for (let i = 0; i < run.length - 1; i++) {
            tokens.push(run.slice(i, i + 2));
        }
    }
    return tokens;
}

/** 统计 tokens 中每个词的出现次数 */
function termCounts(tokens: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    return counts;
}

/**
 * 按问题检索最相关的 wiki 页面。
 *
 * 评分：标题命中 ×3 + 摘要命中 ×2 + 依赖文件路径命中 ×2 + 正文词频 ×1（按
 * log(正文长度) 归一，避免长页恒赢）。
 *
 * @param index    - loadWikiIndex 的产出
 * @param question - 用户问题
 * @param topK     - 返回条数（默认 3）
 */
export function retrieve(index: WikiIndexEntry[], question: string, topK = 3): RetrievedPage[] {
    const qTokens = [...new Set(tokenize(question))];
    if (qTokens.length === 0) return [];

    const scored: RetrievedPage[] = [];
    for (const entry of index) {
        const titleTokens = new Set(tokenize(entry.title));
        const summaryTokens = new Set(tokenize(entry.summary));
        const fileTokens = new Set(tokenize(entry.dependentFiles.join(' ')));
        const bodyCounts = termCounts(tokenize(entry.content));
        const bodyNorm = Math.max(1, Math.log(entry.content.length + 1));

        let score = 0;
        for (const t of qTokens) {
            if (titleTokens.has(t)) score += 3;
            if (summaryTokens.has(t)) score += 2;
            if (fileTokens.has(t)) score += 2;
            const bodyHits = bodyCounts.get(t) ?? 0;
            if (bodyHits > 0) score += Math.min(bodyHits, 10) / bodyNorm;
        }
        if (score > 0) scored.push({ entry, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
}
