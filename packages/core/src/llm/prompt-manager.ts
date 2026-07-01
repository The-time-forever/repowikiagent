/**
 * @module prompt-manager
 * @description 提示词模板管理器，使用 Handlebars 构建 LLM 提示词。
 *
 * 提供以下五类提示词构建函数：
 * 1. buildModuleAnalysisPrompt  - 模块分析
 * 2. buildMermaidPrompt         - Mermaid 架构图生成
 * 3. buildWikiPagePrompt        - Wiki 页面生成
 * 4. buildWikiPlanPrompt        - Wiki 规划
 * 5. buildSourceSummaryPrompt   - 源码摘要
 */

import Handlebars from 'handlebars';
import type { ChatMessage } from './llm-client.js';
import type { WikiLang } from '../i18n/labels.js';

// ============================================================================
// Handlebars 模板定义
// ============================================================================

// --- 模块分析 ---

const MODULE_ANALYSIS_SYSTEM = `你是一个资深软件架构师。你的目标是理解给定的模块作用，并用专业的语言描述它。

严格要求:
- 严禁使用任何 Emoji 表情符号
- 使用准确、专业的中文描述
- 基于提供的文件列表和 AST 摘要进行分析，不要编造不存在的内容`;

const MODULE_ANALYSIS_USER_TEMPLATE = Handlebars.compile(`请分析以下模块:

## 模块路径
{{modulePath}}

## 文件列表
{{fileList}}

## AST 摘要
{{astSummaries}}

## 输出格式
请以如下 JSON 格式输出（不要包含其他任何内容）:

\`\`\`json
{
  "summary": "模块的功能概述",
  "core_components": [
    {
      "name": "组件名称",
      "description": "组件的职责描述"
    }
  ]
}
\`\`\``, { noEscape: true });

// --- Mermaid 架构图 ---

const MERMAID_SYSTEM = `你是一个架构制图专家。你的任务是根据提供的模块和依赖关系，生成清晰的 Mermaid 流程图。

严格要求:
- 严禁使用任何 Emoji 表情符号
- 生成合法的 Mermaid flowchart LR 语法
- 使用 subgraph 对相关模块进行逻辑分组
- 节点标签使用简洁的中文或英文名称
- 箭头标注使用简短的依赖描述
- 只输出 \`\`\`mermaid 代码块，不要输出任何其他内容`;

const MERMAID_USER_TEMPLATE = Handlebars.compile(`请根据以下信息生成 Mermaid 架构流程图:

## 模块列表
{{modules}}

## 依赖关系
{{dependencies}}

请生成一个 Mermaid flowchart LR 图，使用 subgraph 对模块进行合理分组。
只输出 \`\`\`mermaid 代码块。`, { noEscape: true });

// --- Wiki 页面 ---

const WIKI_PAGE_SYSTEM_ZH = `你是一个资深技术文档工程师。你的任务是根据提供的项目信息和"带行号的源码"，生成高质量的技术文档 Wiki 页面。

Grounding 纪律（最重要）:
- 只能基于下方"源码上下文"中出现的文件与代码作出论断；严禁编造不存在的文件、函数、配置或行号。
- 每个涉及代码的章节末尾必须附 章节来源 块；每个 Mermaid 图后必须附 图表来源 块。
- 引用格式严格为: [相对路径:起-止](file://相对路径#Lstart-Lend)，其中行号必须来自源码上下文中真实的 L 行号。
- 通用/结论类章节若无对应代码，用占位行: [本节为通用指导，无需列出章节来源]。
- 使用清晰的中文，严禁使用任何 Emoji。

页面结构（按需裁剪，但至少含 简介 与一个带来源的正文章节）:
H1 标题 → <cite> 块 → 目录 → 简介 → 项目结构(可含 Mermaid) → 核心组件 → 架构总览(可含 Mermaid) → 详细组件分析 → 依赖分析 → 性能考量 → 故障排查指南 → 结论 → 附录`;

const WIKI_PAGE_SYSTEM_EN = `You are a senior technical writer. Produce a high-quality documentation wiki page from the provided project info and line-numbered source code.

Grounding discipline (most important):
- Only make claims about files and code that appear in the "Source context" below. Never invent files, functions, config keys, or line numbers.
- Every code-grounded section must end with a "Section sources" block; every Mermaid diagram must be followed by a "Diagram sources" block.
- Citation format MUST be: [relative/path:start-end](file://relative/path#Lstart-Lend), where the line numbers come from the real L-numbers shown in the source context.
- For generic/summary sections with no specific code, use the placeholder line: [This section is general guidance; no sources required].
- Write in clear English. Do not use emojis.

Page structure (trim as appropriate, but always include Introduction and at least one source-cited body section):
H1 title → <cite> block → Table of Contents → Introduction → Project Structure (may include Mermaid) → Core Components → Architecture Overview (may include Mermaid) → Detailed Component Analysis → Dependency Analysis → Performance Considerations → Troubleshooting Guide → Conclusion → Appendices`;

const WIKI_PAGE_USER_TEMPLATE_ZH = Handlebars.compile(`请为以下内容生成技术文档 Wiki 页面:

## 页面标题
{{pageTitle}}

## 项目结构
{{projectTree}}

## 源码上下文（带 L 行号，引用时使用这些行号）
{{sourceSummaries}}

{{#if existingPages}}
## 已有 Wiki 页面
以下是其他 Wiki 页面，请在文档中合理交叉引用:
{{existingPages}}
{{/if}}

请输出完整的 Markdown 文档，严守上文 Grounding 纪律。`, { noEscape: true });

const WIKI_PAGE_USER_TEMPLATE_EN = Handlebars.compile(`Generate a documentation wiki page for:

## Page title
{{pageTitle}}

## Project structure
{{projectTree}}

## Source context (with L line numbers — cite using these numbers)
{{sourceSummaries}}

{{#if existingPages}}
## Existing wiki pages
Cross-reference these other pages where relevant:
{{existingPages}}
{{/if}}

Output the complete Markdown document, strictly following the grounding discipline above.`, { noEscape: true });

// --- Wiki 规划 ---

const WIKI_PLAN_SYSTEM_ZH = `你是一个技术文档规划专家。根据项目信息规划一棵分层的 Wiki 目录树。

严格要求:
- 严禁使用任何 Emoji；仅输出 JSON（一个数组），不要任何额外文字或代码围栏。
- 输出一棵树：顶层为分区，子页放入 children。父分区节点也是一个页面。
- 每个节点的 dependent_files 必须来自下方"模块列表"中真实存在的文件路径；宁缺毋滥、尽量精准（它同时是增量更新的依赖图）。
- 覆盖项目核心方面：概览、核心模块（每个重要模块一页）、数据库、API、部署/开发指南（若适用）。`;

const WIKI_PLAN_SYSTEM_EN = `You are a documentation planner. Design a hierarchical wiki catalog tree from the project info.

Strict requirements:
- No emojis. Output ONLY JSON (a single array) — no extra prose, no code fences.
- Output a tree: top-level entries are sections; nest sub-pages under "children". A parent/section node is also a page.
- Every node's dependent_files MUST be real file paths from the "Modules" list below; keep them tight and precise (this doubles as the incremental-update dependency graph).
- Cover the core aspects: overview, core modules (one page per significant module), database, API, deployment/dev guide where applicable.`;

const WIKI_PLAN_STRATEGY_ZH: Record<string, string> = {
    feature: '按"功能/概念"组织：顶层为能力（项目概览、核心功能、架构设计、数据与API 等）。',
    package: '按"包/模块"组织：顶层镜像仓库布局（各包/模块一节，再细分子系统）。',
};
const WIKI_PLAN_STRATEGY_EN: Record<string, string> = {
    feature: 'Organize feature/concept-centric: top sections are capabilities (Overview, Core Features, Architecture, Data & API).',
    package: 'Organize package/module-centric: top sections mirror the repo layout (one section per package/module, then subsystems).',
};

const WIKI_PLAN_USER_TEMPLATE_ZH = Handlebars.compile(`请规划 Wiki 目录树:

## 组织策略
{{strategy}}

## 项目结构
{{projectTree}}

## 技术栈
{{techStack}}

## 模块列表（含真实文件路径，dependent_files 只能取自这里）
{{modules}}

只输出如下形状的 JSON 数组（不要代码围栏、不要其他文字）:
[
  {
    "title": "分区或页面标题",
    "slug": "kebab-case-english",
    "summary": "一句话概述",
    "prompt": "该页要讲清什么（范围/深度/受众）",
    "dependent_files": ["真实/相对/路径.ts"],
    "diagrams": ["architecture"],
    "children": [ { "title": "...", "slug": "...", "dependent_files": ["..."] } ]
  }
]`, { noEscape: true });

const WIKI_PLAN_USER_TEMPLATE_EN = Handlebars.compile(`Plan the wiki catalog tree:

## Strategy
{{strategy}}

## Project structure
{{projectTree}}

## Tech stack
{{techStack}}

## Modules (with real file paths — dependent_files must come from here)
{{modules}}

Output ONLY a JSON array of this shape (no code fences, no prose):
[
  {
    "title": "Section or page title",
    "slug": "kebab-case-english",
    "summary": "one-line summary",
    "prompt": "what this page must explain (scope/depth/audience)",
    "dependent_files": ["real/relative/path.ts"],
    "diagrams": ["architecture"],
    "children": [ { "title": "...", "slug": "...", "dependent_files": ["..."] } ]
  }
]`, { noEscape: true });

// --- 源码摘要 ---

const SOURCE_SUMMARY_SYSTEM = `你是一个代码分析专家。你的任务是对给定的源代码文件生成精练的摘要。

摘要应保留以下关键信息:
- 所有导出的符号 (export)
- 类和函数的签名 (参数类型、返回类型)
- 关键的类型定义和接口
- 重要的注释和文档说明
- 核心的业务逻辑描述

严格要求:
- 严禁使用任何 Emoji 表情符号
- 输出纯文本摘要，不要使用 JSON 格式
- 摘要控制在约 200 行以内
- 使用中文描述，代码签名保留原文`;

const SOURCE_SUMMARY_USER_TEMPLATE = Handlebars.compile(`请为以下源代码文件生成精练摘要:

## 文件路径
{{filePath}}

## 文件内容
\`\`\`
{{fileContent}}
\`\`\`

请输出纯文本摘要（不要使用 JSON），控制在约 200 行以内。
保留所有导出符号、类/函数签名、关键类型定义和重要注释。`, { noEscape: true });

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 构建模块分析提示词。
 *
 * 用于分析指定模块的功能和核心组件，输出结构化 JSON。
 *
 * @param modulePath   - 模块路径
 * @param fileList     - 模块包含的文件列表
 * @param astSummaries - AST 分析摘要
 * @returns 准备好的 ChatMessage 数组
 */
export function buildModuleAnalysisPrompt(
    modulePath: string,
    fileList: string,
    astSummaries: string,
): ChatMessage[] {
    return [
        { role: 'system', content: MODULE_ANALYSIS_SYSTEM },
        {
            role: 'user',
            content: MODULE_ANALYSIS_USER_TEMPLATE({ modulePath, fileList, astSummaries }),
        },
    ];
}

/**
 * 构建 Mermaid 架构图提示词。
 *
 * 用于根据模块和依赖信息生成 Mermaid flowchart LR 图。
 *
 * @param modules      - 模块列表描述
 * @param dependencies - 依赖关系描述
 * @returns 准备好的 ChatMessage 数组
 */
export function buildMermaidPrompt(
    modules: string,
    dependencies: string,
): ChatMessage[] {
    return [
        { role: 'system', content: MERMAID_SYSTEM },
        {
            role: 'user',
            content: MERMAID_USER_TEMPLATE({ modules, dependencies }),
        },
    ];
}

/**
 * 构建 Wiki 页面生成提示词。
 *
 * 用于根据项目结构和源码摘要生成标准 12 节结构的技术文档页面。
 *
 * @param pageTitle       - 页面标题
 * @param projectTree     - 项目目录结构
 * @param sourceSummaries - 源码摘要集合
 * @param existingPages   - 已有的 Wiki 页面列表（可选，用于交叉引用）
 * @returns 准备好的 ChatMessage 数组
 */
export function buildWikiPagePrompt(
    pageTitle: string,
    projectTree: string,
    sourceSummaries: string,
    existingPages?: string,
    lang: WikiLang = 'zh',
): ChatMessage[] {
    const system = lang === 'en' ? WIKI_PAGE_SYSTEM_EN : WIKI_PAGE_SYSTEM_ZH;
    const template = lang === 'en' ? WIKI_PAGE_USER_TEMPLATE_EN : WIKI_PAGE_USER_TEMPLATE_ZH;
    return [
        { role: 'system', content: system },
        {
            role: 'user',
            content: template({ pageTitle, projectTree, sourceSummaries, existingPages }),
        },
    ];
}

/**
 * 构建 Wiki 规划提示词。
 *
 * 用于根据项目信息规划 Wiki 文档页面结构，输出结构化 JSON。
 *
 * @param projectTree - 项目目录结构
 * @param techStack   - 技术栈描述
 * @param modules     - 模块列表描述
 * @returns 准备好的 ChatMessage 数组
 */
export function buildWikiPlanPrompt(
    projectTree: string,
    techStack: string,
    modules: string,
    lang: WikiLang = 'zh',
    strategy: 'feature' | 'package' = 'feature',
): ChatMessage[] {
    const en = lang === 'en';
    const system = en ? WIKI_PLAN_SYSTEM_EN : WIKI_PLAN_SYSTEM_ZH;
    const template = en ? WIKI_PLAN_USER_TEMPLATE_EN : WIKI_PLAN_USER_TEMPLATE_ZH;
    const strategyText = (en ? WIKI_PLAN_STRATEGY_EN : WIKI_PLAN_STRATEGY_ZH)[strategy];
    return [
        { role: 'system', content: system },
        {
            role: 'user',
            content: template({ projectTree, techStack, modules, strategy: strategyText }),
        },
    ];
}

/**
 * 构建源码摘要提示词。
 *
 * 用于对单个源文件生成精练摘要，保留关键代码签名和类型信息。
 *
 * @param filePath    - 文件路径
 * @param fileContent - 文件内容
 * @returns 准备好的 ChatMessage 数组
 */
export function buildSourceSummaryPrompt(
    filePath: string,
    fileContent: string,
): ChatMessage[] {
    return [
        { role: 'system', content: SOURCE_SUMMARY_SYSTEM },
        {
            role: 'user',
            content: SOURCE_SUMMARY_USER_TEMPLATE({ filePath, fileContent }),
        },
    ];
}
