import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { loadLLMConfig, LLMClient, validateConfig } from './llm/index.js';
import { scanDirectory } from './scanner/index.js';
import { buildTreeString } from './scanner/tree-builder.js';
import { detectTechStack, detectEntrypoints, buildDependencyGraph } from './detector/index.js';
import {
    analyzeModules,
    analyzeApiRoutes,
    analyzeDatabaseModels,
    analyzeConfigs,
    analyzeWorkflows,
} from './analyzer/index.js';
import { WikiGenerator, generateHome, generateSidebar } from './generator/index.js';
import type { AnalysisResult, ProjectProfile, WikiPage } from './models/index.js';

export interface PipelineOptions {
    workspacePath: string;
    outputDir?: string;
    modelName?: string;
    concurrency?: number;
    skipLlm?: boolean;
    onProgress?: (event: PipelineEvent) => void;
}

export type PipelineEvent =
    | { type: 'PROGRESS'; stage: string; progress: number; message: string }
    | { type: 'DONE'; payload: { docsPath: string; pagesCount: number } }
    | { type: 'ERROR'; code: number; message: string };

/**
 * 运行核心 Wiki 生成 Pipeline
 */
export async function runPipeline(options: PipelineOptions): Promise<AnalysisResult> {
    const {
        workspacePath,
        outputDir = path.join(workspacePath, 'docs', 'wiki'),
        modelName,
        concurrency = 3,
        skipLlm = false,
        onProgress,
    } = options;

    const emitProgress = (stage: string, progress: number, message: string) => {
        if (onProgress) {
            onProgress({ type: 'PROGRESS', stage, progress, message });
        } else {
            // CLI 后台或未提供回调时输出规范的 JSONL 格式进程通知
            console.log(JSON.stringify({ type: 'PROGRESS', stage, progress, message }));
        }
    };

    try {
        // ====================================================================
        // 1. Pre-flight 阶段
        // ====================================================================
        emitProgress('Pre-flight', 5, '初始化环境与认证配置...');

        let llmClient: LLMClient | null = null;

        if (!skipLlm) {
            const llmConfig = await loadLLMConfig(workspacePath);
            if (modelName) {
                llmConfig.modelName = modelName;
            }

            const validationErrors = validateConfig(llmConfig);
            if (validationErrors.length > 0) {
                // 如果 API Key 缺失，回退到免大模型模式
                emitProgress('Pre-flight', 8, `未提供 API 凭证，切换至免大模型快速生成模式...`);
            } else {
                llmClient = new LLMClient({ config: llmConfig });
                emitProgress('Pre-flight', 10, `成功加载 LLM 接口，使用模型: ${llmConfig.modelName}`);
            }
        } else {
            emitProgress('Pre-flight', 10, '已开启免大模型（skip-llm）生成模式...');
        }

        // 确保输出目录存在
        await fs.mkdir(outputDir, { recursive: true });

        // ====================================================================
        // 2. Scan Phase 阶段
        // ====================================================================
        emitProgress('Scanning', 15, '扫描项目文件结构中...');
        const files = await scanDirectory(workspacePath);

        emitProgress('Scanning', 25, `扫描完成，发现 ${files.length} 个非忽略文件。构建目录树...`);
        const treeStr = buildTreeString(files, workspacePath);

        emitProgress('Scanning', 30, '识别项目技术栈与框架特征...');
        const techStackResult = await detectTechStack(workspacePath, files);

        const projectProfile: ProjectProfile = {
            name: path.basename(workspacePath) || 'unnamed-project',
            rootPath: workspacePath,
            languages: techStackResult.languages,
            frameworks: techStackResult.frameworks,
            packageManagers: techStackResult.packageManagers,
            databases: techStackResult.databases,
            services: techStackResult.services,
            entrypoints: [],
            configFiles: techStackResult.configFiles,
        };

        // ====================================================================
        // 3. Analysis Phase 阶段
        // ====================================================================
        emitProgress('Analysis', 40, '分析项目入口及内部模块依赖图...');
        const entrypoints = await detectEntrypoints(workspacePath, files);
        projectProfile.entrypoints = entrypoints;

        const dependencyGraph = await buildDependencyGraph(workspacePath, files);

        emitProgress('Analysis', 50, '对模块结构聚类分析...');
        const modules = await analyzeModules(workspacePath, files, llmClient);

        emitProgress('Analysis', 60, '提取 API 路由及数据库模型定义...');
        const apiRoutes = await analyzeApiRoutes(workspacePath, files);
        const databaseModels = await analyzeDatabaseModels(workspacePath, files);

        emitProgress('Analysis', 65, '分析 CI 流程、配置文件和 Agent 工作流...');
        const configInfos = await analyzeConfigs(workspacePath, files);
        const workflowInfos = await analyzeWorkflows(workspacePath, files);

        const analysisResult: AnalysisResult = {
            project: projectProfile,
            tree: treeStr,
            modules,
            dependencies: dependencyGraph,
            apiRoutes,
            databaseModels,
            wikiPages: [],
        };

        // ====================================================================
        // 4. Planning Phase 阶段
        // ====================================================================
        emitProgress('Planning', 70, '制定 Wiki 页面规划方案...');
        const generator = new WikiGenerator(llmClient, { outputDir, concurrency });
        const plannedPages = await generator.planPages(analysisResult);

        emitProgress('Planning', 75, `规划完成，共需要生成 ${plannedPages.length} 个 Wiki 页面。`);

        // ====================================================================
        // 5. Render Phase 阶段
        // ====================================================================
        const generatedPages: WikiPage[] = [];

        // 构建快速交叉引用索引
        const getExistingPagesSummary = () => {
            return generatedPages.map((p) => `- ${p.title} (${p.filename})`).join('\n');
        };

        let currentProgress = 75;
        const progressStep = (95 - 75) / Math.max(plannedPages.length, 1);

        for (let i = 0; i < plannedPages.length; i++) {
            const page = plannedPages[i];
            currentProgress += progressStep;

            emitProgress(
                'LLM Inference',
                Math.round(currentProgress),
                `正在生成 (${i + 1}/${plannedPages.length}): ${page.title}...`
            );

            const wikiPage = await generator.generatePage(
                workspacePath,
                page,
                analysisResult,
                getExistingPagesSummary()
            );

            await generator.savePage(wikiPage);
            generatedPages.push(wikiPage);
        }

        // ====================================================================
        // 6. Post-flight 阶段
        // ====================================================================
        emitProgress('Post-flight', 96, '生成 Wiki 导航与侧边栏 _Sidebar.md...');

        const sidebarContent = generateSidebar(generatedPages);
        const homeContent = generateHome(generatedPages, projectProfile);

        await fs.writeFile(path.join(outputDir, '_Sidebar.md'), sidebarContent, 'utf-8');
        await fs.writeFile(path.join(outputDir, 'Home.md'), homeContent, 'utf-8');

        // 将新页追加到分析结果中
        analysisResult.wikiPages = generatedPages;

        emitProgress('Post-flight', 100, '所有 Wiki 文档生成完成！');

        const doneEvent = {
            type: 'DONE' as const,
            payload: {
                docsPath: path.resolve(outputDir),
                pagesCount: generatedPages.length + 2, // 包含 Home.md, _Sidebar.md
            },
        };

        if (onProgress) {
            onProgress(doneEvent);
        } else {
            console.log(JSON.stringify(doneEvent));
        }

        return analysisResult;
    } catch (err: any) {
        const errorEvent = {
            type: 'ERROR' as const,
            code: 500,
            message: err?.message || String(err),
        };

        if (onProgress) {
            onProgress(errorEvent);
        } else {
            console.log(JSON.stringify(errorEvent));
        }

        throw err;
    }
}
