/**
 * @module mermaid-lint
 * @description 轻量 Mermaid 语法检查（无依赖，不求完备）：抓住 LLM 生成图的
 * 常见破坏性错误——未知图头、括号不配平、subgraph/end 不配对、空图。
 * 报错文本用于喂回 chatWithValidation 的纠正重试。
 */

/** 认可的图头（首个非空行需以其一开头） */
const KNOWN_HEADERS = [
    'flowchart',
    'graph',
    'erDiagram',
    'sequenceDiagram',
    'classDiagram',
    'stateDiagram',
    'pie',
    'gantt',
    'journey',
    'mindmap',
    'timeline',
];

const MERMAID_FENCE = /```mermaid\s*\n([\s\S]*?)```/g;

/** 去掉一行中被引号包裹的内容（避免引号内括号影响配平判断） */
function stripQuoted(line: string): string {
    return line.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
}

/**
 * 检查单个 mermaid 块，返回错误列表（空数组 = 通过）。
 */
export function lintMermaidBlock(block: string): string[] {
    const errors: string[] = [];
    const lines = block.split('\n');
    const nonEmpty = lines.map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('%%'));

    if (nonEmpty.length === 0) {
        return ['Mermaid 图为空。'];
    }

    const header = nonEmpty[0];
    if (!KNOWN_HEADERS.some((h) => header.startsWith(h))) {
        errors.push(`未知的 Mermaid 图类型声明: "${header.slice(0, 40)}"（首行应为 flowchart/erDiagram/sequenceDiagram 等）。`);
    }

    if (nonEmpty.length === 1) {
        errors.push('Mermaid 图只有类型声明而没有内容。');
    }

    // 括号配平（整块累计；忽略引号内字符）
    // erDiagram 的鸦爪基数记号（||、o{、}| 等）含花括号/竖线，需先剥离再配平
    const isEr = header.startsWith('erDiagram');
    const stripCrowFoot = (s: string) =>
        isEr ? s.replace(/(\}o|\}\||o\{|\|\{|\|\||\|o|o\|)(?=--|\s|$)|(?<=--)(\}o|\}\||o\{|\|\{|\|\||\|o|o\|)/g, '') : s;

    const pairs: Array<[string, string, string]> = [
        ['[', ']', '方括号'],
        ['(', ')', '圆括号'],
        ['{', '}', '花括号'],
    ];
    for (const [open, close, name] of pairs) {
        let balance = 0;
        for (const line of lines) {
            const s = stripCrowFoot(stripQuoted(line));
            for (const ch of s) {
                if (ch === open) balance += 1;
                else if (ch === close) balance -= 1;
            }
        }
        if (balance !== 0) {
            errors.push(`Mermaid 图中${name}不配平（${balance > 0 ? '缺少闭合' : '多余闭合'} ${Math.abs(balance)} 处）。`);
        }
    }

    // subgraph / end 配对（仅 flowchart/graph 语义下有意义，宽松检查）
    const subgraphs = nonEmpty.filter((l) => l.startsWith('subgraph')).length;
    const ends = nonEmpty.filter((l) => l === 'end').length;
    if (subgraphs !== ends) {
        errors.push(`subgraph 与 end 数量不匹配（subgraph ${subgraphs} 个，end ${ends} 个）。`);
    }

    return errors;
}

/**
 * 检查 Markdown 内容中所有 mermaid 围栏块。
 *
 * @returns 错误消息列表（含第几个图的定位信息），空数组 = 全部通过
 */
export function lintMermaid(content: string): string[] {
    const errors: string[] = [];
    let m: RegExpExecArray | null;
    let idx = 0;

    MERMAID_FENCE.lastIndex = 0;
    while ((m = MERMAID_FENCE.exec(content)) !== null) {
        idx += 1;
        for (const err of lintMermaidBlock(m[1])) {
            errors.push(`第 ${idx} 个 Mermaid 图: ${err}`);
        }
    }
    return errors;
}
