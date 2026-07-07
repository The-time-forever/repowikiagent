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
const EST_OUTPUT_TOKENS_PER_PAGE = 2000;
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
    notes: string[];
}

/**
 * 对一组目录节点做逐页成本估算（只读，零网络）。
 *
 * @param rootPath       - 项目根目录
 * @param nodes          - 待生成的目录节点（section 页零成本，自动跳过）
 * @param analysisResult - 分析结果（selectNodeFiles 回退与树体量用）
 * @param mode           - 报告模式标记
 * @param extraNotes     - 追加说明
 */
export async function buildDryRunReport(
    rootPath: string,
    nodes: CatalogNode[],
    analysisResult: AnalysisResult,
    mode: 'full' | 'incremental',
    extraNotes: string[] = [],
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
        '估算为近似值（按 4 字符/token 折算，输出按每页约 2000 token 计）。',
        '引用/图表校验未通过时的纠正重试最坏情况下会使消耗接近翻倍。',
        ...(summaryCalls > 0 ? [`包含 ${summaryCalls} 次大文件摘要调用。`] : []),
        ...extraNotes,
    ];

    return { mode, pages, totals, notes };
}
