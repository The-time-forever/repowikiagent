/**
 * @module labels
 * @description 双语标签表。集中管理 Wiki 生成过程中所有面向文档的字符串，
 * 使生成器与语言解耦（此前中文被硬编码在各生成器中）。
 *
 * 标签集对齐 repowiki-generator 技能 `references/page-template.md` 的双语标签表。
 */

/** 支持的 Wiki 输出语言 */
export type WikiLang = 'zh' | 'en';

/** 一套完整的语言标签 */
export interface WikiLabels {
    /** 当前语言 */
    lang: WikiLang;
    /** cite 引用块头 */
    citeHeader: string;
    /** 目录标题 */
    tocHeading: string;
    /** 章节来源标签 */
    sectionSource: string;
    /** 图表来源标签 */
    diagramSource: string;
    /** 标准章节标题 */
    sections: {
        introduction: string;
        projectStructure: string;
        coreComponents: string;
        architectureOverview: string;
        detailedAnalysis: string;
        dependencyAnalysis: string;
        performance: string;
        troubleshooting: string;
        conclusion: string;
        appendix: string;
    };
    /** 通用指导占位行（无需列出章节来源） */
    genericPlaceholder: string;
    /** 总结性内容占位行 */
    summaryPlaceholder: string;
    /** 导航（侧边栏）标题 */
    navTitle: string;
    /** 未归类文档分组名 */
    otherDocs: string;
    /** 故障排查表头 */
    troubleshootingHeaders: [string, string, string];
    /** 文件列表表头 */
    fileTableHeaders: [string, string];
    /** 首页 / 概览相关文案 */
    home: {
        welcome: (name: string) => string;
        intro: string;
        summaryHeading: string;
        projectName: string;
        primaryLanguages: string;
        frameworks: string;
        databases: string;
        unknown: string;
        indexHeading: string;
    };
    /** 无 LLM 兜底页面文案 */
    fallback: {
        intro: (title: string, summary: string) => string;
        projectStructureBody: string;
        coreComponentsBody: string;
        architectureBody: string;
        erBody: string;
        troubleshooting: { problem: string; cause: string; resolution: string };
        conclusion: string;
        appendixTechStack: (langs: string) => string;
    };
    /** Mermaid 图表中的节点/分组标签 */
    diagram: {
        categories: Record<string, string>;
        internalModules: string;
        externalDeps: string;
        client: string;
        router: string;
        user: string;
        frontend: string;
        backend: string;
        database: string;
        services: string;
    };
    /** 兜底页面规划用的分类目录名与页面标题 */
    plan: {
        overviewTitle: string;
        overviewDir: string;
        modulesDir: string;
        moduleTitle: (name: string) => string;
        moduleSummary: (name: string) => string;
        databaseTitle: string;
        databaseDir: string;
        databaseSummary: string;
        apiTitle: string;
        apiDir: string;
        apiSummary: string;
        overviewSummary: string;
    };
}

const ZH: WikiLabels = {
    lang: 'zh',
    citeHeader: '本文档引用的文件',
    tocHeading: '目录',
    sectionSource: '章节来源',
    diagramSource: '图表来源',
    sections: {
        introduction: '简介',
        projectStructure: '项目结构',
        coreComponents: '核心组件',
        architectureOverview: '架构总览',
        detailedAnalysis: '详细组件分析',
        dependencyAnalysis: '依赖分析',
        performance: '性能考量',
        troubleshooting: '故障排查指南',
        conclusion: '结论',
        appendix: '附录',
    },
    genericPlaceholder: '[本节为通用指导，无需列出章节来源]',
    summaryPlaceholder: '[本节为总结性内容，无需列出章节来源]',
    navTitle: '项目文档导航',
    otherDocs: '其他文档',
    troubleshootingHeaders: ['问题', '可能原因', '排查方式'],
    fileTableHeaders: ['文件', '作用'],
    home: {
        welcome: (name) => `欢迎使用 ${name} 项目 Wiki`,
        intro: '这是一个由 RepoWiki 自动生成的本地代码库知识库。',
        summaryHeading: '项目概要',
        projectName: '项目名称',
        primaryLanguages: '主力语言',
        frameworks: '使用框架',
        databases: '数据库',
        unknown: '未知',
        indexHeading: '知识库目录索引',
    },
    fallback: {
        intro: (title, summary) =>
            `该文档是针对 "${title}" 模块的自动生成概要文档。\n${summary}`,
        projectStructureBody: '项目整体目录结构树状视图如下。',
        coreComponentsBody: '以下是该页面对应模块的核心类与组件列表。',
        architectureBody: '项目整体模块架构设计及数据交互图如下。',
        erBody: '数据表关系 (ER) 设计图如下。',
        troubleshooting: {
            problem: '模块无法加载/包缺失',
            cause: '依赖未正确安装',
            resolution: '在根目录下运行 `pnpm install` 或对应的依赖安装指令。',
        },
        conclusion: '文档自动构建完毕，详细系统设计请参考内部核心组件代码。',
        appendixTechStack: (langs) => `技术栈详情: ${langs}`,
    },
    diagram: {
        categories: {
            frontend: '前端应用',
            backend: '后端服务',
            agents: 'Agent 系统',
            data: '数据模型',
            tests: '测试',
            infrastructure: '基础设施',
            shared: '公共模块',
            other: '其他模块',
        },
        internalModules: '内部模块',
        externalDeps: '外部依赖',
        client: '客户端',
        router: '路由层',
        user: '用户',
        frontend: '前端',
        backend: '后端',
        database: '数据存储',
        services: '外部服务',
    },
    plan: {
        overviewTitle: '项目概述',
        overviewDir: '项目概述',
        modulesDir: '核心功能模块',
        moduleTitle: (name) => `${name} 模块分析`,
        moduleSummary: (name) => `${name} 模块的设计与实现细节`,
        databaseTitle: '数据库设计',
        databaseDir: '数据库设计',
        databaseSummary: '项目数据库结构及实体模型定义',
        apiTitle: 'API 参考文档',
        apiDir: 'API参考文档',
        apiSummary: '项目公开的 HTTP 接口路由规范',
        overviewSummary: '项目概要介绍与基本结构',
    },
};

const EN: WikiLabels = {
    lang: 'en',
    citeHeader: 'Referenced Files in This Document',
    tocHeading: 'Table of Contents',
    sectionSource: 'Section sources',
    diagramSource: 'Diagram sources',
    sections: {
        introduction: 'Introduction',
        projectStructure: 'Project Structure',
        coreComponents: 'Core Components',
        architectureOverview: 'Architecture Overview',
        detailedAnalysis: 'Detailed Component Analysis',
        dependencyAnalysis: 'Dependency Analysis',
        performance: 'Performance Considerations',
        troubleshooting: 'Troubleshooting Guide',
        conclusion: 'Conclusion',
        appendix: 'Appendices',
    },
    genericPlaceholder: '[This section is general guidance; no sources required]',
    summaryPlaceholder: '[This section provides a summary; no sources required]',
    navTitle: 'Project Documentation Navigation',
    otherDocs: 'Other Documents',
    troubleshootingHeaders: ['Issue', 'Possible Cause', 'Resolution'],
    fileTableHeaders: ['File', 'Purpose'],
    home: {
        welcome: (name) => `Welcome to the ${name} Wiki`,
        intro: 'A local codebase knowledge base generated automatically by RepoWiki.',
        summaryHeading: 'Project Summary',
        projectName: 'Project Name',
        primaryLanguages: 'Primary Languages',
        frameworks: 'Frameworks',
        databases: 'Databases',
        unknown: 'Unknown',
        indexHeading: 'Knowledge Base Index',
    },
    fallback: {
        intro: (title, summary) =>
            `This page is an auto-generated overview of the "${title}" module.\n${summary}`,
        projectStructureBody: 'The overall directory structure is shown below.',
        coreComponentsBody: 'The core classes and components for this page are listed below.',
        architectureBody: 'The overall module architecture and data-flow diagram is shown below.',
        erBody: 'The entity-relationship (ER) diagram is shown below.',
        troubleshooting: {
            problem: 'Module fails to load / package missing',
            cause: 'Dependencies not installed correctly',
            resolution: 'Run `pnpm install` (or the equivalent) at the repository root.',
        },
        conclusion:
            'Documentation generated automatically; refer to the core component source for detailed design.',
        appendixTechStack: (langs) => `Tech stack: ${langs}`,
    },
    diagram: {
        categories: {
            frontend: 'Frontend',
            backend: 'Backend',
            agents: 'Agents',
            data: 'Data Models',
            tests: 'Tests',
            infrastructure: 'Infrastructure',
            shared: 'Shared',
            other: 'Other',
        },
        internalModules: 'Internal Modules',
        externalDeps: 'External Dependencies',
        client: 'Client',
        router: 'Router',
        user: 'User',
        frontend: 'Frontend',
        backend: 'Backend',
        database: 'Data Store',
        services: 'External Services',
    },
    plan: {
        overviewTitle: 'Project Overview',
        overviewDir: 'Project Overview',
        modulesDir: 'Core Modules',
        moduleTitle: (name) => `${name} Module`,
        moduleSummary: (name) => `Design and implementation details of the ${name} module`,
        databaseTitle: 'Database Design',
        databaseDir: 'Database Design',
        databaseSummary: 'Database schema and entity model definitions',
        apiTitle: 'API Reference',
        apiDir: 'API Reference',
        apiSummary: 'Public HTTP route specification',
        overviewSummary: 'Project overview and high-level structure',
    },
};

const LABELS: Record<WikiLang, WikiLabels> = { zh: ZH, en: EN };

/**
 * 获取指定语言的标签集。未知语言回退到英文。
 */
export function getLabels(lang: WikiLang | string | undefined): WikiLabels {
    if (lang === 'zh' || lang === 'en') {
        return LABELS[lang];
    }
    return LABELS.en;
}

/** 规范化任意输入为受支持的语言代码 */
export function normalizeLang(lang: string | undefined): WikiLang {
    return lang === 'zh' ? 'zh' : 'en';
}
