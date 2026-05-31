import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AnalysisResult, WikiPage, ProjectProfile, ModuleInfo } from '../models/index.js';
import type { LLMClient } from '../llm/index.js';
import { buildWikiPlanPrompt, buildWikiPagePrompt, buildSourceSummaryPrompt } from '../llm/index.js';
import { assembleWikiPage, formatTroubleshootingTable } from './markdown-generator.js';
import {
    generateArchitectureDiagram,
    generateERDiagram,
    generateDependencyDiagram,
    generateApiDiagram,
} from './mermaid-generator.js';

export interface WikiGeneratorConfig {
    outputDir: string;
    concurrency?: number;
}

export interface PlannedPage {
    title: string;
    filename: string;
    summary: string;
    requiredModules: string[];
}

/**
 * 核心 Wiki 生成器
 */
export class WikiGenerator {
    private config: Required<WikiGeneratorConfig>;
    private llmClient: LLMClient | null;

    constructor(llmClient: LLMClient | null, config: WikiGeneratorConfig) {
        this.llmClient = llmClient;
        this.config = {
            outputDir: config.outputDir,
            concurrency: config.concurrency ?? 3,
        };
    }

    /**
     * 规划 Wiki 页面列表
     */
    public async planPages(analysisResult: AnalysisResult): Promise<PlannedPage[]> {
        if (!this.llmClient) {
            return this.getDefaultPagePlan(analysisResult);
        }

        try {
            const modulesStr = JSON.stringify(
                analysisResult.modules.map((m) => ({
                    moduleName: m.moduleName,
                    directory: m.directory,
                    summary: m.summary,
                    filesCount: m.files.length,
                })),
                null,
                2
            );

            const techStackStr = JSON.stringify(analysisResult.project, null, 2);
            const prompt = buildWikiPlanPrompt(analysisResult.tree, techStackStr, modulesStr);

            const planned = await this.llmClient.chatJSON<PlannedPage[]>(prompt);
            if (Array.isArray(planned) && planned.length > 0) {
                return planned;
            }
        } catch {
            // 回退到默认规划
        }

        return this.getDefaultPagePlan(analysisResult);
    }

    /**
     * 默认的 Wiki 页面规划（无 LLM 或 LLM 规划失败时使用）
     */
    private getDefaultPagePlan(analysisResult: AnalysisResult): PlannedPage[] {
        const plan: PlannedPage[] = [
            {
                title: '项目概述',
                filename: '项目概述/项目概述.md',
                summary: '项目概要介绍与基本结构',
                requiredModules: ['.'],
            },
        ];

        // 为每个主要逻辑模块分别规划一个文档页面
        for (const mod of analysisResult.modules) {
            if (mod.directory === '.') continue;
            plan.push({
                title: `${mod.moduleName} 模块分析`,
                filename: `核心功能模块/${mod.moduleName}.md`,
                summary: `${mod.moduleName} 模块的设计与实现细节`,
                requiredModules: [mod.directory],
            });
        }

        if (analysisResult.databaseModels.length > 0) {
            plan.push({
                title: '数据库设计',
                filename: '数据库设计/数据库设计.md',
                summary: '项目数据库结构及实体模型定义',
                requiredModules: [],
            });
        }

        if (analysisResult.apiRoutes.length > 0) {
            plan.push({
                title: 'API 参考文档',
                filename: 'API参考文档/API参考文档.md',
                summary: '项目公开的 HTTP 接口路由规范',
                requiredModules: [],
            });
        }

        return plan;
    }

    /**
     * 对文件列表进行摘要压缩（如文件太大，先使用 LLM 摘要以节省 Context 空间）
     */
    private async prepareSourceSummaries(
        rootPath: string,
        plannedPage: PlannedPage,
        analysisResult: AnalysisResult
    ): Promise<string> {
        const summaries: string[] = [];

        // 收集所有关联模块内的文件
        const relatedFiles: string[] = [];
        for (const modDir of plannedPage.requiredModules) {
            const mod = analysisResult.modules.find((m) => m.directory === modDir);
            if (mod) {
                relatedFiles.push(...mod.files);
            }
        }

        // 如果没有关联模块，则提取根目录附近的重要源文件
        if (relatedFiles.length === 0) {
            relatedFiles.push(
                ...analysisResult.modules
                    .filter((m) => m.directory !== '.')
                    .slice(0, 3)
                    .flatMap((m) => m.files.slice(0, 2))
            );
        }

        // 限制最多分析前 8 个文件，防止 Context 溢出
        const targetFiles = relatedFiles.slice(0, 8);

        for (const relPath of targetFiles) {
            try {
                const absPath = path.resolve(rootPath, relPath);
                const content = await fs.readFile(absPath, 'utf-8');

                // 超过 4KB 的文件进行 LLM 摘要，小文件直接使用首部几行
                if (content.length > 4000 && this.llmClient) {
                    const prompt = buildSourceSummaryPrompt(relPath, content.slice(0, 20000));
                    const summaryResult = await this.llmClient.chat(prompt);
                    summaries.push(`### 文件: ${relPath} (代码摘要)\n${summaryResult.content}`);
                } else {
                    const lines = content.split('\n');
                    const truncated = lines.slice(0, 100).join('\n');
                    summaries.push(`### 文件: ${relPath}\n\`\`\`\n${truncated}\n\`\`\``);
                }
            } catch {
                // 忽略单个文件读取错误
            }
        }

        return summaries.join('\n\n');
    }

    /**
     * 生成单个页面内容
     */
    public async generatePage(
        rootPath: string,
        page: PlannedPage,
        analysisResult: AnalysisResult,
        existingPagesSummary?: string
    ): Promise<WikiPage> {
        if (this.llmClient) {
            try {
                const sourceSummaries = await this.prepareSourceSummaries(rootPath, page, analysisResult);
                const prompt = buildWikiPagePrompt(
                    page.title,
                    analysisResult.tree,
                    sourceSummaries,
                    existingPagesSummary
                );

                const response = await this.llmClient.chat(prompt);
                const content = response.content;

                return {
                    title: page.title,
                    filename: page.filename,
                    summary: page.summary,
                    content,
                    sourceRefs: [], // 稍后在后置处理中补充或由 LLM 直接写在 Markdown 中
                };
            } catch {
                // LLM 生成失败时回退到模板组装
            }
        }

        // 本地模板组装（免 LLM 回退逻辑）
        return this.assembleFallbackPage(page, analysisResult);
    }

    /**
     * 无大模型回退页面生成逻辑
     */
    private assembleFallbackPage(page: PlannedPage, analysisResult: AnalysisResult): WikiPage {
        // 构建默认的图表
        let archDiagram: string | undefined;
        let erDiagram: string | undefined;
        let depDiagram: string | undefined;
        let apiDiagram: string | undefined;

        if (page.title.includes('架构') || page.title.includes('概述')) {
            archDiagram = generateArchitectureDiagram(analysisResult.modules, analysisResult.dependencies.edges || []);
        }
        if (page.title.includes('数据') || page.title.includes('DB') || page.filename.includes('database')) {
            erDiagram = generateERDiagram(analysisResult.databaseModels);
        }
        if (page.title.includes('依赖') || page.filename.includes('dependency')) {
            depDiagram = generateDependencyDiagram(analysisResult.modules, analysisResult.dependencies.edges || []);
        }
        if (page.title.includes('API') || page.filename.includes('api')) {
            apiDiagram = generateApiDiagram(analysisResult.apiRoutes);
        }

        const projectRoot = analysisResult.project.rootPath;

        const content = assembleWikiPage({
            title: page.title,
            citeRefs: [],
            projectRoot,
            introduction: `该文档是针对 "${page.title}" 模块的自动生成概要文档。\n${page.summary}`,
            projectStructure: '项目整体目录结构树状视图如下。',
            projectStructureDiagram: 'flowchart TD\n    Root["项目根目录"]', // 简易树
            coreComponents: '以下是该页面对应模块的核心类与组件列表。',
            architectureOverview: archDiagram ? '项目整体模块架构设计及数据交互图如下。' : undefined,
            architectureDiagram: archDiagram,
            detailedAnalysis: erDiagram ? '数据表关系 (ER) 设计图如下。' : undefined,
            troubleshooting: formatTroubleshootingTable([
                {
                    problem: '模块无法加载/包缺失',
                    cause: '依赖未正确安装',
                    resolution: '在根目录下运行 `pnpm install` 或对应的依赖安装指令。',
                },
            ]),
            conclusion: '文档自动构建完毕，详细系统设计请参考内部核心组件代码。',
            appendix: `技术栈详情: ${analysisResult.project.languages.join(', ')}`,
        });

        return {
            title: page.title,
            filename: page.filename,
            summary: page.summary,
            content,
            sourceRefs: [],
        };
    }

    /**
     * 保存 Wiki 页面文件到 docs/wiki 目录
     */
    public async savePage(page: WikiPage): Promise<string> {
        const destPath = path.join(this.config.outputDir, page.filename);
        const destDir = path.dirname(destPath);

        await fs.mkdir(destDir, { recursive: true });
        await fs.writeFile(destPath, page.content, 'utf-8');

        return destPath;
    }
}
