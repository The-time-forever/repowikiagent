import { type SourceReference } from '../models/index.js';

/**
 * Markdown 文档生成工具集
 * 提供格式化表格、源码引用链接、页面结构等工具函数
 */

/**
 * 生成 Markdown 表格
 */
export function generateTable(headers: string[], rows: string[][]): string {
    if (rows.length === 0) return '';

    const headerLine = `| ${headers.join(' | ')} |`;
    const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
    const dataLines = rows.map(row => `| ${row.join(' | ')} |`);

    return [headerLine, separatorLine, ...dataLines].join('\n');
}

/**
 * 生成源码引用链接
 * 格式: [file.py:1-50](file://project/path/to/file.py#L1-L50)
 */
export function formatSourceRef(
    ref: SourceReference,
    projectRoot: string
): string {
    const fileName = ref.filePath.split('/').pop() || ref.filePath;
    const label = `${fileName}:${ref.startLine}-${ref.endLine}`;
    const normalizedRoot = projectRoot.replace(/\\/g, '/');
    const normalizedPath = ref.filePath.replace(/\\/g, '/');
    return `[${label}](file://${normalizedRoot}/${normalizedPath}#L${ref.startLine}-L${ref.endLine})`;
}

/**
 * 生成源码引用块（章节来源）
 */
export function formatSectionSource(refs: SourceReference[], projectRoot: string): string {
    if (refs.length === 0) return '';

    const lines = [
        '',
        '> **章节来源**',
        ...refs.map(ref => `> - ${formatSourceRef(ref, projectRoot)}`),
        ''
    ];
    return lines.join('\n');
}

/**
 * 生成图表来源引用
 */
export function formatDiagramSource(refs: SourceReference[], projectRoot: string): string {
    if (refs.length === 0) return '';

    const lines = [
        '',
        '> **图表来源**',
        ...refs.map(ref => `> - ${formatSourceRef(ref, projectRoot)}`),
        ''
    ];
    return lines.join('\n');
}

/**
 * 生成 <cite> 引用块，列出所有被引用的源码文件
 */
export function formatCiteBlock(refs: SourceReference[], projectRoot: string): string {
    if (refs.length === 0) return '';

    // 去重文件路径
    const uniqueFiles = [...new Set(refs.map(r => r.filePath))];
    const normalizedRoot = projectRoot.replace(/\\/g, '/');

    const lines = [
        '<cite>',
        '**本文引用的文件**',
        ...uniqueFiles.map(fp => {
            const normalized = fp.replace(/\\/g, '/');
            return `- [${fp}](file://${normalizedRoot}/${normalized})`;
        }),
        '</cite>',
        ''
    ];
    return lines.join('\n');
}

/**
 * 生成目录（Table of Contents）
 */
export function formatToc(headings: string[]): string {
    const lines = [
        '## 目录',
        '',
        ...headings.map((h, i) => `${i + 1}. [${h}](#${headingToAnchor(h)})`)
    ];
    return lines.join('\n');
}

/**
 * 将标题转换为 Markdown 锚点
 */
function headingToAnchor(heading: string): string {
    return heading
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * 生成文件列表表格
 */
export function formatFileTable(
    files: Array<{ path: string; description: string }>
): string {
    const headers = ['文件', '作用'];
    const rows = files.map(f => [`\`${f.path}\``, f.description]);
    return generateTable(headers, rows);
}

/**
 * 包裹 Mermaid 代码块
 */
export function wrapMermaid(code: string): string {
    return `\`\`\`mermaid\n${code}\n\`\`\``;
}

/**
 * 生成故障排查表格
 */
export function formatTroubleshootingTable(
    issues: Array<{ problem: string; cause: string; resolution: string }>
): string {
    const headers = ['问题', '可能原因', '排查方式'];
    const rows = issues.map(i => [i.problem, i.cause, i.resolution]);
    return generateTable(headers, rows);
}

/**
 * 组装完整的 Wiki 页面
 * 将各部分内容按照标准模板结构拼装
 */
export function assembleWikiPage(sections: {
    title: string;
    citeRefs: SourceReference[];
    projectRoot: string;
    introduction: string;
    projectStructure?: string;
    projectStructureDiagram?: string;
    coreComponents?: string;
    architectureOverview?: string;
    architectureDiagram?: string;
    detailedAnalysis?: string;
    dependencyAnalysis?: string;
    dependencyDiagram?: string;
    troubleshooting?: string;
    conclusion?: string;
    appendix?: string;
}): string {
    const parts: string[] = [];

    // 1. 标题
    parts.push(`# ${sections.title}`);
    parts.push('');

    // 2. cite 引用块
    if (sections.citeRefs.length > 0) {
        parts.push(formatCiteBlock(sections.citeRefs, sections.projectRoot));
    }

    // 收集目录项
    const tocItems: string[] = [];
    if (sections.introduction) tocItems.push('引言');
    if (sections.projectStructure) tocItems.push('项目结构与关系');
    if (sections.coreComponents) tocItems.push('核心组件总览');
    if (sections.architectureOverview) tocItems.push('架构总览');
    if (sections.detailedAnalysis) tocItems.push('详细组件分析');
    if (sections.dependencyAnalysis) tocItems.push('依赖分析');
    if (sections.troubleshooting) tocItems.push('故障排查指南');
    if (sections.conclusion) tocItems.push('结论');
    if (sections.appendix) tocItems.push('附录');

    // 3. 目录
    if (tocItems.length > 0) {
        parts.push(formatToc(tocItems));
        parts.push('');
    }

    // 4. 引言
    if (sections.introduction) {
        parts.push('## 引言');
        parts.push('');
        parts.push(sections.introduction);
        parts.push('');
    }

    // 5. 项目结构
    if (sections.projectStructure) {
        parts.push('## 项目结构与关系');
        parts.push('');
        parts.push(sections.projectStructure);
        if (sections.projectStructureDiagram) {
            parts.push('');
            parts.push(wrapMermaid(sections.projectStructureDiagram));
        }
        parts.push('');
    }

    // 6. 核心组件
    if (sections.coreComponents) {
        parts.push('## 核心组件总览');
        parts.push('');
        parts.push(sections.coreComponents);
        parts.push('');
    }

    // 7. 架构总览
    if (sections.architectureOverview) {
        parts.push('## 架构总览');
        parts.push('');
        parts.push(sections.architectureOverview);
        if (sections.architectureDiagram) {
            parts.push('');
            parts.push(wrapMermaid(sections.architectureDiagram));
        }
        parts.push('');
    }

    // 8. 详细组件分析
    if (sections.detailedAnalysis) {
        parts.push('## 详细组件分析');
        parts.push('');
        parts.push(sections.detailedAnalysis);
        parts.push('');
    }

    // 9. 依赖分析
    if (sections.dependencyAnalysis) {
        parts.push('## 依赖分析');
        parts.push('');
        parts.push(sections.dependencyAnalysis);
        if (sections.dependencyDiagram) {
            parts.push('');
            parts.push(wrapMermaid(sections.dependencyDiagram));
        }
        parts.push('');
    }

    // 10. 故障排查
    if (sections.troubleshooting) {
        parts.push('## 故障排查指南');
        parts.push('');
        parts.push(sections.troubleshooting);
        parts.push('');
    }

    // 11. 结论
    if (sections.conclusion) {
        parts.push('## 结论');
        parts.push('');
        parts.push(sections.conclusion);
        parts.push('');
    }

    // 12. 附录
    if (sections.appendix) {
        parts.push('## 附录');
        parts.push('');
        parts.push(sections.appendix);
        parts.push('');
    }

    return parts.join('\n');
}
