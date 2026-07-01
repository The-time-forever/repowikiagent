/**
 * @module source-provider
 * @description 为页面生成提供"带行号锚定"的源码上下文（grounding 的输入侧）。
 *
 * 取代旧的"截断前 100 行 / 直接摘要"做法：读取每个依赖文件的真实内容，给每行加
 * `L{n}: ` 前缀喂给 LLM，使模型能给出并核对精确行号引用。超大文件在有 LLM 时
 * 生成摘要，并显式标注"无精确行号，引用需回到原文件"。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { LLMClient } from '../llm/index.js';
import { buildSourceSummaryPrompt } from '../llm/index.js';
import type { WikiLang } from '../i18n/labels.js';

/** 单个文件的 grounded 上下文块 */
export interface GroundedSource {
    /** 相对路径 */
    filePath: string;
    /** 供 LLM 阅读的内容块（带行号或摘要） */
    block: string;
    /** 文件真实行数（截断前） */
    lineCount: number;
    /** 是否为摘要（摘要块的行号不可直接引用） */
    summarized: boolean;
    /** 是否发生了截断 */
    truncated: boolean;
}

export interface SourceProviderOptions {
    /** 每个文件最多喂入的行数（超出截断），默认 400 */
    maxLinesPerFile?: number;
    /** 最多处理的文件数，默认 12 */
    maxFiles?: number;
    /** 触发 LLM 摘要的字符阈值（需有 llmClient），默认 12000 */
    summarizeThreshold?: number;
    /** 输出语言（影响摘要提示词），默认 en */
    lang?: WikiLang;
}

const DEFAULTS = {
    maxLinesPerFile: 400,
    maxFiles: 12,
    summarizeThreshold: 12000,
};

/**
 * 给源码内容加行号前缀（L1:、L2: ...）。
 */
function numberLines(content: string, maxLines: number): { text: string; truncated: boolean; total: number } {
    const lines = content.split('\n');
    const total = lines.length;
    const slice = lines.slice(0, maxLines);
    const text = slice.map((line, i) => `L${i + 1}: ${line}`).join('\n');
    return { text, truncated: total > maxLines, total };
}

/**
 * 读取一组依赖文件并生成带行号的 grounded 上下文块。
 *
 * @param rootPath  - 项目根目录绝对路径
 * @param relPaths  - 需要 grounding 的相对文件路径（去重、按需截断在调用方处理）
 * @param llmClient - 可选 LLM 客户端（用于大文件摘要）
 * @param options   - 配置项
 */
export async function collectGroundedSources(
    rootPath: string,
    relPaths: string[],
    llmClient: LLMClient | null,
    options: SourceProviderOptions = {},
): Promise<GroundedSource[]> {
    const maxLinesPerFile = options.maxLinesPerFile ?? DEFAULTS.maxLinesPerFile;
    const maxFiles = options.maxFiles ?? DEFAULTS.maxFiles;
    const summarizeThreshold = options.summarizeThreshold ?? DEFAULTS.summarizeThreshold;
    const lang = options.lang ?? 'en';

    // 去重并限量
    const unique = [...new Set(relPaths)].slice(0, maxFiles);
    const sources: GroundedSource[] = [];

    for (const relPath of unique) {
        try {
            const absPath = path.resolve(rootPath, relPath);
            const content = await fs.readFile(absPath, 'utf-8');
            const total = content.split('\n').length;

            // 大文件且有 LLM：摘要（标注无精确行号）
            if (content.length > summarizeThreshold && llmClient) {
                const prompt = buildSourceSummaryPrompt(relPath, content.slice(0, 20000));
                const summary = await llmClient.chat(prompt);
                const notice =
                    lang === 'zh'
                        ? '（以下为代码摘要，不含精确行号；如需引用请回到原文件核对行号）'
                        : '(Summary below — no precise line numbers; return to the file to cite exact lines)';
                sources.push({
                    filePath: relPath,
                    block: `### ${relPath} ${notice}\n${summary.content}`,
                    lineCount: total,
                    summarized: true,
                    truncated: true,
                });
                continue;
            }

            // 常规：带行号喂入
            const { text, truncated } = numberLines(content, maxLinesPerFile);
            const header =
                lang === 'zh'
                    ? `### 文件: ${relPath}（共 ${total} 行${truncated ? `，仅显示前 ${maxLinesPerFile} 行` : ''}）`
                    : `### File: ${relPath} (${total} lines${truncated ? `, showing first ${maxLinesPerFile}` : ''})`;
            sources.push({
                filePath: relPath,
                block: `${header}\n\`\`\`\n${text}\n\`\`\``,
                lineCount: total,
                summarized: false,
                truncated,
            });
        } catch {
            // 单个文件读取失败则跳过
        }
    }

    return sources;
}

/**
 * 将 grounded 源码块拼接为可放入提示词的文本。
 */
export function renderGroundedSources(sources: GroundedSource[]): string {
    return sources.map((s) => s.block).join('\n\n');
}
