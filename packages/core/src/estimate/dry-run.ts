/**
 * @module dry-run
 * @description dry-run 成本预估：零 LLM 调用，基于真实 grounded 上下文体量
 * 估算一次生成会发出的请求数与 token 量。估算口径与 wiki-generator 的实际
 * 喂入路径一致（selectNodeFiles → collectGroundedSources）。
 */

import { collectGroundedSources } from '../grounding/source-provider.js';
import { selectNodeFiles } from '../generator/wiki-generator.js';
import type { AnalysisResult, CatalogNode } from '../models/index.js';

/** 估算参数（经验值，报告 notes 中注明为近似） */
const CHARS_PER_TOKEN = 4;
const PROMPT_OVERHEAD_TOKENS = 800;
const EST_OUTPUT_TOKENS_PER_PAGE = 4000;
/** 触发大文件摘要的块字符阈值（对齐 source-provider 的 summarizeThreshold） */
const SUMMARY_BLOCK_THRESHOLD = 12_000;
const SUMMARY_CALL_INPUT_TOKENS = 5_000;
const SUMMARY_CALL_OUTPUT_TOKENS = 500;

export interface DryRunPageEstimate {
    title: string;
    /** 该页实际喂入的 grounding 文件数（截断后） */
    files: number;
    estInputTokens: number;
    estOutputTokens: number;
}

export interface DryRunReport {
    mode: 'full' | 'incremental';
    pages: DryRunPageEstimate[];
    totals: {
        pages: number;
        llmCalls: number;
        estInputTokens: number;
        estOutputTokens: number;
    };
    /** totals 是否按上次实测用量校准（true 时逐页明细仍为结构估算，仅供体量参考） */
    calibrated: boolean;
    notes: string[];
}

/** 上一次生成的实测用量（来自元数据 usage_stats），存在时 totals 输出校准口径 */
export interface PriorUsage {
    promptTokens: number;
    completionTokens: number;
    calls: number;
    /** 上次实际生成的内容页数 */
    contentPages: number;
}

/**
 * 对一组目录节点做逐页成本估算（只读，零网络）。
 *
 * @param rootPath       - 项目根目录
 * @param nodes          - 待生成的目录节点（section 页零成本，自动跳过）
 * @param analysisResult - 分析结果（selectNodeFiles 回退与树体量用）
 * @param mode           - 报告模式标记
 * @param extraNotes     - 追加说明
 * @param priorUsage     - 上次实测用量；存在时 totals 按每页均值校准
 *                         （均值口径天然摊销了目录规划/大文件摘要/纠正重试的放大）
 */
export async function buildDryRunReport(
    rootPath: string,
    nodes: CatalogNode[],
    analysisResult: AnalysisResult,
    mode: 'full' | 'incremental',
    extraNotes: string[] = [],
    priorUsage?: PriorUsage,
): Promise<DryRunReport> {
    const treeTokens = Math.ceil(analysisResult.tree.length / CHARS_PER_TOKEN);
    const pages: DryRunPageEstimate[] = [];
    let llmCalls = 0;
    let summaryCalls = 0;

    for (const node of nodes) {
        if (node.isSection) continue; // 分区着陆页确定性生成，零 LLM 成本

        const relPaths = selectNodeFiles(node, analysisResult);
        const sources = await collectGroundedSources(rootPath, relPaths, null);

        let blockChars = 0;
        for (const s of sources) {
            blockChars += s.block.length;
            // 真实运行中超阈值的文件会走一次独立摘要调用
            if (s.block.length > SUMMARY_BLOCK_THRESHOLD) summaryCalls += 1;
        }

        const estInputTokens =
            Math.ceil(blockChars / CHARS_PER_TOKEN) + treeTokens + PROMPT_OVERHEAD_TOKENS;
        pages.push({
            title: node.title,
            files: sources.length,
            estInputTokens,
            estOutputTokens: EST_OUTPUT_TOKENS_PER_PAGE,
        });
        llmCalls += 1;
    }

    // ── 校准口径：有上次实测用量时，totals 按每页均值推算 ──
    if (priorUsage && priorUsage.contentPages > 0 && priorUsage.calls > 0) {
        // 全量重建的页数以上次实际目录的内容页数为准（LLM 规划的页数比确定性建树更细）；
        // 增量模式按本次受影响页数。
        const pageCount = mode === 'full' ? priorUsage.contentPages : pages.length;
        const perPage = (v: number) => Math.ceil((pageCount * v) / priorUsage.contentPages);
        const totals = {
            pages: pageCount,
            llmCalls: perPage(priorUsage.calls),
            estInputTokens: perPage(priorUsage.promptTokens),
            estOutputTokens: perPage(priorUsage.completionTokens),
        };
        const notes: string[] = [
            `已按上次实测用量校准（上次 ${priorUsage.contentPages} 页 / ${priorUsage.calls} 次调用的每页均值口径，已摊销规划、摘要与纠正重试）。`,
            ...extraNotes,
        ];
        return { mode, pages, totals, calibrated: true, notes };
    }

    const totals = {
        pages: pages.length,
        llmCalls: llmCalls + summaryCalls,
        estInputTokens:
            pages.reduce((s, p) => s + p.estInputTokens, 0) +
            summaryCalls * SUMMARY_CALL_INPUT_TOKENS,
        estOutputTokens:
            pages.reduce((s, p) => s + p.estOutputTokens, 0) +
            summaryCalls * SUMMARY_CALL_OUTPUT_TOKENS,
    };

    const notes: string[] = [
        '估算为近似值（按 4 字符/token 折算，输出按每页约 4000 token 计）。',
        '启用 LLM 目录规划时实际页数可能为估算的约 1.5 倍；纠正重试与大文件摘要会带来约 40% 的调用放大（0.5.0 实测）。',
        ...(summaryCalls > 0 ? [`包含 ${summaryCalls} 次大文件摘要调用。`] : []),
        ...extraNotes,
    ];

    return { mode, pages, totals, calibrated: false, notes };
}
