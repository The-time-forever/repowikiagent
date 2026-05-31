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

const WIKI_PAGE_SYSTEM = `你是一个资深技术文档工程师。你的任务是根据提供的项目信息和源码摘要，生成高质量的技术文档 Wiki 页面。

严格要求:
- 使用清晰的中文，严禁使用任何 Emoji
- 不能编造不在上下文中出现的文件或服务
- 每个章节必须注明 章节来源 (引用对应的源文件)
- 每个图表必须注明 图表来源 (引用生成图表所依据的源文件)
- 来源引用格式: [file:line-line](file://project/path#Lstart-Lend)

你必须严格遵循以下 12 节模板结构:

1. H1 标题
2. <cite> 块 - 列出所有相关源文件
3. 目录 (ToC) - 使用 Markdown 链接的目录
4. 引言 - 模块/功能的简介
5. 项目结构 - 含 Mermaid 目录树图
6. 核心组件 - 主要组件列表与简述
7. 架构总览 - 含 Mermaid 架构图
8. 详细组件分析 - 每个组件含 Mermaid 类图或流程图
9. 依赖分析 - 含 Mermaid 依赖关系图
10. 故障排查指南 - 常见问题与排查步骤
11. 结论 - 总结性评述
12. 附录 - 补充信息、配置参考等`;

const WIKI_PAGE_USER_TEMPLATE = Handlebars.compile(`请为以下内容生成技术文档 Wiki 页面:

## 页面标题
{{pageTitle}}

## 项目结构
{{projectTree}}

## 源码摘要
{{sourceSummaries}}

{{#if existingPages}}
## 已有 Wiki 页面
以下是已生成的其他 Wiki 页面，请在文档中合理交叉引用:
{{existingPages}}
{{/if}}

请严格按照 12 节模板结构输出完整的 Markdown 文档。
每个章节需注明 章节来源，每个图表需注明 图表来源。
来源格式: [file:line-line](file://project/path#Lstart-Lend)`, { noEscape: true });

// --- Wiki 规划 ---

const WIKI_PLAN_SYSTEM = `你是一个技术文档规划专家。你的任务是根据项目信息规划一组结构化的 Wiki 页面。

严格要求:
- 严禁使用任何 Emoji 表情符号
- 页面规划应覆盖项目的所有核心方面
- 遵循标准文档层级结构
- 以 JSON 数组格式输出，不要包含其他内容

标准文档层级参考:
- 项目概述/
- 架构设计/
- 前端应用架构/
- 后端服务架构/
- 核心功能模块/
- 数据库设计/
- API参考文档/
- 部署运维/
- 开发指南/`;

const WIKI_PLAN_USER_TEMPLATE = Handlebars.compile(`请根据以下项目信息，规划 Wiki 文档页面:

## 项目结构
{{projectTree}}

## 技术栈
{{techStack}}

## 模块列表
{{modules}}

请以如下 JSON 数组格式输出（不要包含其他任何内容）:

\`\`\`json
[
  {
    "title": "页面标题",
    "filename": "文件名.md",
    "summary": "页面内容概述",
    "requiredModules": ["模块路径1", "模块路径2"]
  }
]
\`\`\`

注意:
- filename 使用英文命名，使用连字符分隔
- 页面应按照标准文档层级结构进行组织
- requiredModules 关联生成该页面所需的源码模块路径`, { noEscape: true });

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
): ChatMessage[] {
    return [
        { role: 'system', content: WIKI_PAGE_SYSTEM },
        {
            role: 'user',
            content: WIKI_PAGE_USER_TEMPLATE({ pageTitle, projectTree, sourceSummaries, existingPages }),
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
): ChatMessage[] {
    return [
        { role: 'system', content: WIKI_PLAN_SYSTEM },
        {
            role: 'user',
            content: WIKI_PLAN_USER_TEMPLATE({ projectTree, techStack, modules }),
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
