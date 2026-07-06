import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
    AnalysisResult,
    WikiPage,
    CatalogNode,
    CatalogStrategy,
    DiagramKind,
} from '../models/index.js';
import type { LLMClient } from '../llm/index.js';
import { buildWikiPlanPrompt, buildWikiPagePrompt, LLMAuthError } from '../llm/index.js';
import { getLabels, type WikiLabels } from '../i18n/labels.js';
import { collectGroundedSources, renderGroundedSources } from '../grounding/source-provider.js';
import { validateCitations, formatCitationErrors } from '../grounding/citation-validator.js';
import {
    buildDefaultCatalog,
    flattenPlannedCatalog,
    validateCatalog,
    type PlannedCatalogNode,
} from './catalog-builder.js';
import { assembleWikiPage, formatTroubleshootingTable, wrapMermaid } from './markdown-generator.js';
import {
    generateArchitectureDiagram,
    generateERDiagram,
    generateDependencyDiagram,
    generateApiDiagram,
} from './mermaid-generator.js';

export interface WikiGeneratorConfig {
    outputDir: string;
    concurrency?: number;
    /** 文档语言标签集（默认中文） */
    labels?: WikiLabels;
    /** 扫描得到的 相对路径→行数 映射，用于引用校验（缺省则不做行号上界检查） */
    fileMeta?: Map<string, number>;
    /** LLM 降级/引用校验未通过等非致命问题的上报通道（缺省静默） */
    onWarn?: (message: string) => void;
}

/**
 * 核心 Wiki 生成器（catalog 树驱动）
 */
export class WikiGenerator {
    private config: Required<Omit<WikiGeneratorConfig, 'onWarn'>>;
    private llmClient: LLMClient | null;
    private labels: WikiLabels;
    private fileMeta: Map<string, number>;
    private onWarn: (message: string) => void;

    constructor(llmClient: LLMClient | null, config: WikiGeneratorConfig) {
        this.llmClient = llmClient;
        this.labels = config.labels ?? getLabels('zh');
        this.fileMeta = config.fileMeta ?? new Map();
        this.onWarn = config.onWarn ?? (() => {});
        this.config = {
            outputDir: config.outputDir,
            concurrency: config.concurrency ?? 3,
            labels: this.labels,
            fileMeta: this.fileMeta,
        };
    }

    // ────────────────────────────────────────────────────────────
    // 目录规划
    // ────────────────────────────────────────────────────────────

    /**
     * 规划分层目录树（父在前的先序列表）。
     * 优先 LLM 规划（校验 + dependent_files 过滤后使用），失败回退确定性建树。
     */
    public async planCatalog(
        analysisResult: AnalysisResult,
        strategy: CatalogStrategy,
    ): Promise<CatalogNode[]> {
        const fallback = () => buildDefaultCatalog(analysisResult, this.labels, strategy);

        if (!this.llmClient) {
            return fallback();
        }

        try {
            const modulesStr = JSON.stringify(
                analysisResult.modules.map((m) => ({
                    moduleName: m.moduleName,
                    directory: m.directory,
                    summary: m.summary,
                    files: m.files.slice(0, 20),
                })),
                null,
                2,
            );
            const techStackStr = JSON.stringify(analysisResult.project, null, 2);
            const prompt = buildWikiPlanPrompt(
                analysisResult.tree,
                techStackStr,
                modulesStr,
                this.labels.lang,
                strategy,
            );

            const planned = await this.llmClient.chatJSON<PlannedCatalogNode[]>(prompt);
            if (Array.isArray(planned) && planned.length > 0) {
                const known = new Set(this.fileMeta.keys());
                const flat = flattenPlannedCatalog(planned, known);
                if (flat.length > 0 && validateCatalog(flat).ok) {
                    return flat;
                }
            }
            this.onWarn('LLM 目录规划结果无效，已回退确定性建树。');
        } catch (err) {
            // 认证错误没有重试价值，直接上抛终止整次生成（避免坏 key 产出整套降级页）
            if (err instanceof LLMAuthError) {
                throw err;
            }
            this.onWarn(
                `LLM 目录规划失败，已回退确定性建树: ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        return fallback();
    }

    // ────────────────────────────────────────────────────────────
    // 页面生成
    // ────────────────────────────────────────────────────────────

    /**
     * 生成单个目录节点对应的页面。
     * 分区着陆页生成子页索引；内容页在 grounding 校验下由 LLM 生成，失败回退模板。
     */
    public async generateNode(
        rootPath: string,
        node: CatalogNode,
        analysisResult: AnalysisResult,
        catalog: CatalogNode[],
        existingPagesSummary?: string,
    ): Promise<WikiPage> {
        if (node.isSection) {
            return this.assembleSectionPage(node, catalog);
        }

        if (this.llmClient) {
            try {
                const relPaths = this.selectNodeFiles(node, analysisResult);
                const sources = await collectGroundedSources(rootPath, relPaths, this.llmClient, {
                    lang: this.labels.lang,
                });

                const brief = node.prompt ? `${node.title}\n${node.prompt}` : node.title;
                const prompt = buildWikiPagePrompt(
                    brief,
                    analysisResult.tree,
                    renderGroundedSources(sources),
                    existingPagesSummary,
                    this.labels.lang,
                );

                const { content, value: citations, ok } = await this.llmClient.chatWithValidation(
                    prompt,
                    (c) => {
                        const r = validateCitations(c, this.fileMeta);
                        return { ok: r.ok, value: r.citations, error: formatCitationErrors(r.errors) };
                    },
                );

                if (!ok) {
                    this.onWarn(`页面「${node.title}」引用校验未完全通过，已保留尽力结果。`);
                }

                return {
                    title: node.title,
                    filename: node.filename,
                    summary: node.summary,
                    content,
                    sourceRefs: citations,
                };
            } catch (err) {
                if (err instanceof LLMAuthError) {
                    throw err;
                }
                this.onWarn(
                    `页面「${node.title}」LLM 生成失败，已回退模板: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }

        return this.assembleFallbackPage(node, analysisResult);
    }

    /**
     * 选出该节点需要 grounding 的源码文件。
     * 优先 dependentFiles；为空时回退到若干重要模块的头部文件（避免空 grounding）。
     */
    private selectNodeFiles(node: CatalogNode, analysisResult: AnalysisResult): string[] {
        if (node.dependentFiles.length > 0) {
            return node.dependentFiles;
        }
        return analysisResult.modules
            .filter((m) => m.directory !== '.')
            .slice(0, 3)
            .flatMap((m) => m.files.slice(0, 2));
    }

    /**
     * 分区着陆页：简介 + 子页索引（确定性生成，不消耗 LLM）。
     */
    private assembleSectionPage(node: CatalogNode, catalog: CatalogNode[]): WikiPage {
        const children = catalog.filter((n) => n.parentId === node.id);
        const sectionDir = path.dirname(node.filename);

        const lines: string[] = [`# ${node.title}`, ''];
        if (node.summary) {
            lines.push(node.summary, '');
        }
        lines.push(`## ${this.labels.home.indexHeading}`, '');
        for (const child of children) {
            const rel = path
                .relative(sectionDir, child.filename)
                .replace(/\\/g, '/');
            // 保留 .md 扩展名，便于本地 Markdown 查看器解析相对链接
            lines.push(`- [${child.title}](${encodeURI(rel)})`);
        }
        lines.push('');

        return {
            title: node.title,
            filename: node.filename,
            summary: node.summary,
            content: lines.join('\n'),
            sourceRefs: [],
        };
    }

    /**
     * 无大模型回退页面生成逻辑
     */
    private assembleFallbackPage(node: CatalogNode, analysisResult: AnalysisResult): WikiPage {
        const labels = this.labels;
        const F = labels.fallback;

        const wanted = new Set<DiagramKind>(node.diagrams ?? []);
        const edges = analysisResult.dependencies.edges || [];

        const archDiagram = wanted.has('architecture')
            ? generateArchitectureDiagram(analysisResult.modules, edges, labels)
            : undefined;
        const erDiagram = wanted.has('er')
            ? generateERDiagram(analysisResult.databaseModels)
            : undefined;
        const depDiagram = wanted.has('dependency')
            ? generateDependencyDiagram(analysisResult.modules, edges, labels)
            : undefined;
        const apiDiagram = wanted.has('api')
            ? generateApiDiagram(analysisResult.apiRoutes, labels)
            : undefined;

        const projectRoot = analysisResult.project.rootPath;

        // ER / API 图无专用槽位，作为带围栏的 mermaid 块拼入"详细组件分析"
        const detailedParts: string[] = [];
        if (erDiagram) {
            detailedParts.push(F.erBody, '', wrapMermaid(erDiagram));
        }
        if (apiDiagram) {
            detailedParts.push(wrapMermaid(apiDiagram));
        }
        const detailedAnalysis = detailedParts.length > 0 ? detailedParts.join('\n') : undefined;

        const content = assembleWikiPage({
            title: node.title,
            citeRefs: [],
            projectRoot,
            labels,
            introduction: F.intro(node.title, node.summary),
            projectStructure: F.projectStructureBody,
            projectStructureDiagram: 'flowchart TD\n    Root["root"]',
            coreComponents: F.coreComponentsBody,
            architectureOverview: archDiagram ? F.architectureBody : undefined,
            architectureDiagram: archDiagram,
            detailedAnalysis,
            dependencyAnalysis: depDiagram ? labels.sections.dependencyAnalysis : undefined,
            dependencyDiagram: depDiagram,
            appendix: F.appendixTechStack(analysisResult.project.languages.join(', ')),
            troubleshooting: formatTroubleshootingTable(
                [
                    {
                        problem: F.troubleshooting.problem,
                        cause: F.troubleshooting.cause,
                        resolution: F.troubleshooting.resolution,
                    },
                ],
                labels,
            ),
            conclusion: F.conclusion,
        });

        return {
            title: node.title,
            filename: node.filename,
            summary: node.summary,
            content,
            sourceRefs: [],
        };
    }

    /**
     * 保存 Wiki 页面文件到 content 目录
     */
    public async savePage(page: WikiPage): Promise<string> {
        const destPath = path.join(this.config.outputDir, page.filename);
        const destDir = path.dirname(destPath);

        await fs.mkdir(destDir, { recursive: true });
        await fs.writeFile(destPath, page.content, 'utf-8');

        return destPath;
    }
}
