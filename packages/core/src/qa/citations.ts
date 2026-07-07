/**
 * @module citations
 * @description 从文本（wiki 页面 / 问答回答）中解析 grounded citation
 * （`file://<path>#L<start>[-L<end>]`），供消费端做"打开源码到行"跳转。
 * 正则与 VS Code 扩展的 CitationLinkProvider 保持一致。
 */

/** 单条源码引用 */
export interface SourceCitation {
    /** 去掉 file:// 前缀后的路径（可能是相对仓库根的路径） */
    filePath: string;
    startLine?: number;
    endLine?: number;
    /** 原始匹配文本 */
    raw: string;
}

const CITE_PATTERN = /file:\/\/([^\s)#`]+)#L(\d+)(?:-L?(\d+))?/g;

/** 解析文本中的全部引用，按出现顺序返回 */
export function parseCitations(text: string): SourceCitation[] {
    const citations: SourceCitation[] = [];
    CITE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CITE_PATTERN.exec(text)) !== null) {
        const start = parseInt(match[2], 10);
        const end = match[3] ? parseInt(match[3], 10) : start;
        citations.push({
            filePath: match[1],
            startLine: start,
            endLine: end,
            raw: match[0],
        });
    }
    return citations;
}
