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
import { getLabels, normalizeLang, type WikiLang } from './i18n/labels.js';
import { defaultWikiRoot, resolveWikiPaths } from './output/layout.js';
import { mapWithConcurrency } from './util/concurrency.js';
import { computeSourceIndex, buildMetadata, writeMetadata, readMetadata } from './metadata/index.js';
import { runIncrementalUpdate, computeChangeSets, findStale, assignAddedFiles, entryToCatalogNode } from './incremental/index.js';
import { buildDryRunReport, type DryRunReport } from './estimate/dry-run.js';
import { buildDefaultCatalog } from './generator/catalog-builder.js';
import { getGitCommit } from './util/git.js';
import type { AnalysisResult, ProjectProfile, WikiPage, CatalogNode, CatalogStrategy } from './models/index.js';

export interface PipelineOptions {
    workspacePath: string;
    /** 输出根目录（默认 <workspace>/.repowiki）。语言树位于 <root>/<lang> */
    outputDir?: string;
    modelName?: string;
    concurrency?: number;
    skipLlm?: boolean;
    /** 文档语言（默认 en）。'both' 由 CLI 逐语言多次调用实现 */
    lang?: WikiLang;
    /** 目录组织策略 */
    strategy?: CatalogStrategy;
    /** 强制全量重建（忽略已有元数据的增量分支） */
    forceRebuild?: boolean;
    /** 只估算成本不生成：发出 DRY_RUN 事件后返回，零 LLM 调用、零写入 */
    dryRun?: boolean;
    /** 文件名使用 ASCII slug（跨平台/URL 兼容），默认使用本地化标题 */
    slugFilenames?: boolean;
    onProgress?: (event: PipelineEvent) => void;
}

export type PipelineEvent =
    | { type: 'PROGRESS'; stage: string; progress: number; message: string }
    | { type: 'WARN'; stage: string; message: string }
    | { type: 'DRY_RUN'; report: DryRunReport }
    | { type: 'DONE'; payload: { docsPath: string; pagesCount: number } }
    | { type: 'ERROR'; code: number; message: string };

/**
 * 运行核心 Wiki 生成 Pipeline
 */
export async function runPipeline(options: PipelineOptions): Promise<AnalysisResult> {
    const {
        workspacePath,
        outputDir,
        modelName,
        concurrency = 3,
        skipLlm = false,
        lang = 'en',
        strategy = 'feature',
        forceRebuild = false,
        dryRun = false,
        slugFilenames = false,
        onProgress,
    } = options;

    // 解析语言与输出布局：<root>/<lang>/{content,meta}
    const wikiLang = normalizeLang(lang);
    const labels = getLabels(wikiLang);
    const root = outputDir ?? defaultWikiRoot(workspacePath);
    const paths = resolveWikiPaths(root, wikiLang);
    const contentDir = paths.contentDir;

    const emitProgress = (stage: string, progress: number, message: string) => {
        if (onProgress) {
            onProgress({ type: 'PROGRESS', stage, progress, message });
        } else {
            // CLI 后台或未提供回调时输出规范的 JSONL 格式进程通知
            console.log(JSON.stringify({ type: 'PROGRESS', stage, progress, message }));
        }
    };

    const emitWarn = (stage: string, message: string) => {
        if (onProgress) {
            onProgress({ type: 'WARN', stage, message });
        } else {
            console.log(JSON.stringify({ type: 'WARN', stage, message }));
        }
    };

    try {
        // ====================================================================
        // 1. Pre-flight 阶段
        // ====================================================================
        emitProgress('Pre-flight', 5, '初始化环境与认证配置...');

        let llmClient: LLMClient | null = null;

        // dry-run 只估算不生成，保证零网络调用
        if (!skipLlm && !dryRun) {
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
        await fs.mkdir(contentDir, { recursive: true });

        // 提前读取已有元数据：决定是否走增量分支（增量时可跳过昂贵的 LLM 模块分析）
        const existingMetadata = forceRebuild ? null : await readMetadata(paths.metadataFile);
        const incrementalMode = existingMetadata !== null;

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
        // 增量模式下跳过 LLM 模块摘要（页面重生成直接基于 dependent_files）
        const modules = await analyzeModules(
            workspacePath,
            files,
            incrementalMode ? null : llmClient,
            concurrency,
        );

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

        // 相对路径 → 行数 映射，供引用校验使用行号上界（两条路径共用）
        const fileMeta = new Map<string, number>();
        for (const f of files) {
            if (f.nodeType === 'file') {
                fileMeta.set(f.relativePath.replace(/\\/g, '/'), f.lineCount ?? 0);
            }
        }

        // ====================================================================
        // 3.4 dry-run 分支：只估算成本，发出 DRY_RUN 事件后返回（零 LLM、零写入）
        // ====================================================================
        if (dryRun) {
            emitProgress('DryRun', 70, '估算生成成本（不调用 LLM、不写入文件）...');

            let report: DryRunReport;
            if (incrementalMode && existingMetadata) {
                const changes = await computeChangeSets(workspacePath, existingMetadata);
                const catalogNodes = existingMetadata.wiki_catalogs.map(entryToCatalogNode);
                const { stale, orphaned } = findStale(catalogNodes, changes);

                const addedInScan = [...changes.added].filter((f) =>
                    fileMeta.has(f.replace(/\\/g, '/')),
                );
                const { assignedByNode, unassigned } = assignAddedFiles(catalogNodes, addedInScan);

                // 归页的新增文件会把对应页拉入重生成集
                const staleIds = new Set(stale.map((n) => n.id));
                for (const id of assignedByNode.keys()) {
                    if (staleIds.has(id)) continue;
                    const n = catalogNodes.find((x) => x.id === id);
                    if (n) {
                        stale.push(n);
                        staleIds.add(id);
                    }
                }

                report = await buildDryRunReport(workspacePath, stale, analysisResult, 'incremental', [
                    `变更文件 ${changes.changed.size + changes.deleted.size + changes.added.size}，受影响 ${stale.length} 页，将删除 ${orphaned.length} 页。`,
                    ...(unassigned.length > 0
                        ? [`${unassigned.length} 个新增文件暂无归属页面。`]
                        : []),
                ]);
            } else {
                const catalogNodes = buildDefaultCatalog(analysisResult, labels, strategy, slugFilenames);
                report = await buildDryRunReport(workspacePath, catalogNodes, analysisResult, 'full', [
                    '目录按确定性建树估算；启用 LLM 规划时实际目录可能不同，且另有 1 次规划调用。',
                ]);
            }

            if (onProgress) onProgress({ type: 'DRY_RUN', report });
            else console.log(JSON.stringify({ type: 'DRY_RUN', report }));
            return analysisResult;
        }

        // ====================================================================
        // 3.5 增量更新分支（Phase 0）：已有元数据且未强制重建时，只重生成受影响页
        // ====================================================================
        if (incrementalMode && existingMetadata) {
            {
                emitProgress('Incremental', 72, '检测到已有元数据，计算变更集...');
                const result = await runIncrementalUpdate({
                    workspacePath,
                    contentDir,
                    metadataFile: paths.metadataFile,
                    metadata: existingMetadata,
                    analysisResult,
                    llmClient,
                    labels,
                    fileMeta,
                    concurrency,
                    onWarn: (message) => emitWarn('Incremental', message),
                });

                if (result.addedUnassigned.length > 0) {
                    emitWarn(
                        'Incremental',
                        `${result.addedUnassigned.length} 个新增散置文件未被任何页面覆盖（如 ${result.addedUnassigned
                            .slice(0, 3)
                            .join(', ')}）。同目录文件达到 2 个会自动成页，或使用 --force-rebuild 重新规划目录。`,
                    );
                }

                const assignedNote =
                    result.addedAssigned > 0 ? `，${result.addedAssigned} 个新增文件已归入相关页` : '';
                const createdNote =
                    result.createdPages.length > 0
                        ? `，新建 ${result.createdPages.length} 页（${result.createdPages.slice(0, 3).join('、')}）`
                        : '';
                const msg = result.upToDate
                    ? `Wiki (${wikiLang}) 已是最新：${result.untouched} 页无源码变更（${result.method}）。未做改动。`
                    : `增量更新完成（${result.method}）：变更文件 ${result.changedFiles}，重生成 ${result.regenerated.length} 页，删除 ${result.orphaned.length} 页，保留 ${result.untouched} 页${assignedNote}${createdNote}。`;
                emitProgress('Incremental', 100, msg);

                const doneEvent = {
                    type: 'DONE' as const,
                    payload: {
                        docsPath: path.resolve(paths.langRoot),
                        pagesCount: result.regenerated.length,
                    },
                };
                if (onProgress) onProgress(doneEvent);
                else console.log(JSON.stringify(doneEvent));

                return analysisResult;
            }
        }

        // ====================================================================
        // 4. Planning Phase 阶段
        // ====================================================================
        emitProgress('Planning', 70, '制定 Wiki 页面规划方案...');
        const generator = new WikiGenerator(llmClient, {
            outputDir: contentDir,
            concurrency,
            labels,
            fileMeta,
            onWarn: (message) => emitWarn('LLM Inference', message),
            slugFilenames,
        });
        const catalog: CatalogNode[] = await generator.planCatalog(analysisResult, strategy);

        emitProgress('Planning', 75, `规划完成，共需要生成 ${catalog.length} 个 Wiki 页面。`);

        // ====================================================================
        // 5. Render Phase 阶段
        // ====================================================================
        // 交叉引用索引：并发生成时以完整目录树为准
        const plannedSummary = catalog
            .map((n) => `- ${n.title} (${n.filename})`)
            .join('\n');

        let completed = 0;
        const progressBase = 75;
        const progressSpan = 95 - progressBase;

        // 按层级 parent-first 生成，层内受 concurrency 限制并发
        const generatedPages: WikiPage[] = [];
        const maxLayer = catalog.reduce((mx, n) => Math.max(mx, n.layerLevel), 0);
        for (let layer = 0; layer <= maxLayer; layer++) {
            const levelNodes = catalog.filter((n) => n.layerLevel === layer);
            if (levelNodes.length === 0) continue;

            const pages = await mapWithConcurrency(levelNodes, concurrency, async (node) => {
                const wikiPage = await generator.generateNode(
                    workspacePath,
                    node,
                    analysisResult,
                    catalog,
                    plannedSummary,
                );
                await generator.savePage(wikiPage);

                completed += 1;
                emitProgress(
                    'LLM Inference',
                    Math.round(progressBase + (progressSpan * completed) / Math.max(catalog.length, 1)),
                    `已生成 (${completed}/${catalog.length}): ${node.title}`,
                );
                return wikiPage;
            });
            generatedPages.push(...pages);
        }

        // ====================================================================
        // 6. Post-flight 阶段
        // ====================================================================
        emitProgress('Post-flight', 96, '生成 Wiki 导航与侧边栏 _Sidebar.md...');

        const sidebarContent = generateSidebar(generatedPages, labels);
        const homeContent = generateHome(generatedPages, projectProfile, labels);

        await fs.writeFile(path.join(contentDir, '_Sidebar.md'), sidebarContent, 'utf-8');
        await fs.writeFile(path.join(contentDir, 'Home.md'), homeContent, 'utf-8');

        // 生成机器可读元数据（source_index 指纹 + 目录树），驱动后续增量更新
        emitProgress('Post-flight', 98, '生成元数据 repowiki-metadata.json...');
        const sourceIndex = await computeSourceIndex(workspacePath, catalog);
        const gitCommit = await getGitCommit(workspacePath);
        const metadata = buildMetadata({
            projectProfile,
            tree: treeStr,
            lang: wikiLang,
            catalog,
            pages: generatedPages,
            sourceIndex,
            gitCommit,
            timestamp: new Date().toISOString(),
            readmeContent: homeContent,
        });
        await writeMetadata(paths.metadataFile, metadata);

        // 将新页追加到分析结果中
        analysisResult.wikiPages = generatedPages;

        emitProgress('Post-flight', 100, '所有 Wiki 文档生成完成！');

        const doneEvent = {
            type: 'DONE' as const,
            payload: {
                docsPath: path.resolve(paths.langRoot),
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
