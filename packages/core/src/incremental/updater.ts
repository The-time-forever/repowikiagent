/**
 * @module updater
 * @description 增量更新引擎（技能 `references/incremental-update.md` 的实现）。
 *
 * 有元数据时：计算变更文件集 → 反查受影响页 → 无变更则原样停手；
 * 否则只重生成受影响页并就地刷新其指纹与 gmt_modified，其余页/指纹保持不变。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AnalysisResult, CatalogNode, WikiPage } from '../models/index.js';
import type { LLMClient } from '../llm/index.js';
import type { WikiLabels } from '../i18n/labels.js';
import { WikiGenerator, generateSidebar, generateHome } from '../generator/index.js';
import { hashId, slugify } from '../generator/catalog-builder.js';
import { mapWithConcurrency } from '../util/concurrency.js';
import { fingerprintFile } from '../metadata/fingerprint.js';
import type { RepowikiMetadata, WikiCatalogEntry } from '../metadata/metadata-writer.js';
import { writeMetadata } from '../metadata/metadata-writer.js';
import { gitDiffNameStatus, gitStatusPorcelain, getGitCommit } from '../util/git.js';

/** 变更文件集合 */
export interface ChangeSets {
    changed: Set<string>;
    added: Set<string>;
    deleted: Set<string>;
    /** 检测方式（用于报告） */
    method: 'git' | 'hash';
}

/** 增量更新结果 */
export interface IncrementalResult {
    upToDate: boolean;
    regenerated: string[];
    orphaned: string[];
    changedFiles: number;
    untouched: number;
    method: 'git' | 'hash';
    /** 目录亲和归入已有页面的新增文件数 */
    addedAssigned: number;
    /** 未能归入任何页面且未聚类成新页的新增文件（相对路径） */
    addedUnassigned: string[];
    /** 由新目录簇创建的新页面标题 */
    createdPages: string[];
}

export interface IncrementalDeps {
    workspacePath: string;
    contentDir: string;
    metadataFile: string;
    metadata: RepowikiMetadata;
    analysisResult: AnalysisResult;
    llmClient: LLMClient | null;
    labels: WikiLabels;
    fileMeta: Map<string, number>;
    concurrency: number;
    /** 本次扫描到的全部非忽略文件（posix 相对路径）；无 git 项目靠它检测新增 */
    scannedFiles?: string[];
    /** 非致命问题上报通道（缺省静默） */
    onWarn?: (message: string) => void;
}

const norm = (p: string) => p.replace(/\\/g, '/');

/** 将元数据 catalog 条目重建为 CatalogNode（依赖无损往返字段） */
export function entryToCatalogNode(e: WikiCatalogEntry): CatalogNode {
    return {
        id: e.id,
        title: e.name,
        slug: e.description,
        summary: '',
        prompt: e.prompt,
        dependentFiles: e.dependent_files ? e.dependent_files.split(',').filter(Boolean) : [],
        parentId: e.parent_id,
        layerLevel: e.layer_level,
        category: e.category ?? '',
        diagrams: e.diagrams ?? [],
        isSection: e.is_section ?? false,
        filename: e.filename,
    };
}

/**
 * 计算变更文件集。优先 git（有 generated_at_commit），否则按 source_index 指纹比对。
 */
export async function computeChangeSets(
    rootPath: string,
    metadata: RepowikiMetadata,
    /** 本次扫描到的全部文件（posix 相对路径）；提供且元数据记录过 scanned_files 时，hash 模式才能检测新增 */
    currentFiles?: string[],
): Promise<ChangeSets> {
    const changed = new Set<string>();
    const added = new Set<string>();
    const deleted = new Set<string>();

    const commit = metadata.generated_at_commit;
    if (commit) {
        const diff = await gitDiffNameStatus(rootPath, commit);
        const status = await gitStatusPorcelain(rootPath);
        if (diff !== null && status !== null) {
            for (const c of [...diff, ...status]) {
                const p = norm(c.path);
                if (c.status === 'D') deleted.add(p);
                else if (c.status === 'A') added.add(p);
                else if (c.status === 'R') {
                    if (c.oldPath) deleted.add(norm(c.oldPath));
                    added.add(p);
                } else changed.add(p);
            }
            return { changed, added, deleted, method: 'git' };
        }
    }

    // 哈希回退：对 source_index 中的文件逐个重算指纹
    for (const [rel, oldFp] of Object.entries(metadata.source_index)) {
        const fp = await fingerprintFile(rootPath, rel);
        if (fp === null) deleted.add(rel);
        else if (fp !== oldFp) changed.add(rel);
    }
    // 新增检测：与生成时记录的全量扫描清单比对（旧元数据无 scanned_files 时跳过）
    if (currentFiles && metadata.scanned_files && metadata.scanned_files.length > 0) {
        const baseline = new Set(metadata.scanned_files.map(norm));
        for (const f of currentFiles) {
            const p = norm(f);
            if (!baseline.has(p)) added.add(p);
        }
    }
    return { changed, added, deleted, method: 'hash' };
}

/**
 * 反查受影响页：dependent_files 与"变更∪删除"相交即 stale；
 * 全部依赖被删则为 orphaned（应删页）。
 */
export function findStale(
    catalog: CatalogNode[],
    changes: ChangeSets,
): { stale: CatalogNode[]; orphaned: CatalogNode[] } {
    const changedOrDeleted = new Set<string>([...changes.changed, ...changes.deleted]);

    const orphaned = catalog.filter(
        (n) => n.dependentFiles.length > 0 && n.dependentFiles.every((f) => changes.deleted.has(norm(f))),
    );
    const orphanedIds = new Set(orphaned.map((n) => n.id));

    const stale = catalog.filter(
        (n) =>
            !orphanedIds.has(n.id) &&
            n.dependentFiles.some((f) => changedOrDeleted.has(norm(f))),
    );

    return { stale, orphaned };
}

/** 目录簇成页的最小文件数：低于此数的散文件只提示不建页 */
const MIN_CLUSTER_SIZE = 2;

/**
 * 把无归属的新增文件按目录聚类成"新模块"候选。
 * 跳过根目录散文件；仅保留 ≥ MIN_CLUSTER_SIZE 个文件的目录簇。
 *
 * @returns 目录 → 文件列表（均为 posix 规范化相对路径）
 */
export function clusterNewModules(unassigned: Iterable<string>): Map<string, string[]> {
    const byDir = new Map<string, string[]>();
    for (const raw of unassigned) {
        const file = norm(raw);
        const dir = path.posix.dirname(file);
        if (dir === '.') continue; // 根目录散文件不成页
        const list = byDir.get(dir) ?? [];
        list.push(file);
        byDir.set(dir, list);
    }
    for (const [dir, files] of byDir) {
        if (files.length < MIN_CLUSTER_SIZE) byDir.delete(dir);
    }
    return byDir;
}

/**
 * 把目录簇构造成新的 CatalogNode：挂到既有的模块分区（isSection 且位于
 * modulesDir 下）之下；分区不存在则作为顶层页。filename 冲突时追加序号。
 */
export function buildClusterNodes(
    clusters: Map<string, string[]>,
    catalog: CatalogNode[],
    labels: WikiLabels,
): CatalogNode[] {
    if (clusters.size === 0) return [];

    const P = labels.plan;
    const existingFilenames = new Set(catalog.map((n) => norm(n.filename)));
    const section = catalog.find(
        (n) => n.isSection && norm(n.filename).startsWith(`${P.modulesDir}/`),
    );

    const created: CatalogNode[] = [];
    for (const [dir, files] of clusters) {
        const base = path.posix.basename(dir);
        const title = P.moduleTitle(base);
        let filename = `${P.modulesDir}/${title}.md`;
        let suffix = 2;
        while (existingFilenames.has(norm(filename))) {
            filename = `${P.modulesDir}/${title}-${suffix++}.md`;
        }
        existingFilenames.add(norm(filename));

        created.push({
            id: hashId(filename),
            title,
            slug: slugify(base),
            summary: P.moduleSummary(base),
            prompt: '',
            dependentFiles: files,
            parentId: section?.id,
            layerLevel: section ? 1 : 0,
            category: '',
            diagrams: [],
            isSection: false,
            filename,
        });
    }
    return created;
}

/** 新增文件归页结果 */
export interface AddedAssignment {
    /** 页 id → 追加进该页 dependentFiles 的新增文件 */
    assignedByNode: Map<string, string[]>;
    /** 未命中任何页面的新增文件 */
    unassigned: string[];
}

/**
 * 目录亲和归页：新增文件的目录精确命中某页 dependentFiles 的目录集时，
 * 归入该页（命中多页则都归入）。分区页（isSection）与无依赖页不参与。
 *
 * @param catalog    - 元数据重建的目录树
 * @param addedFiles - 过滤后的新增文件（应先与本次扫描文件集取交集）
 */
export function assignAddedFiles(catalog: CatalogNode[], addedFiles: Iterable<string>): AddedAssignment {
    // 页 id → 依赖目录集
    const dirsByNode = new Map<string, Set<string>>();
    for (const n of catalog) {
        if (n.isSection || n.dependentFiles.length === 0) continue;
        dirsByNode.set(
            n.id,
            new Set(n.dependentFiles.map((f) => path.posix.dirname(norm(f)))),
        );
    }

    const assignedByNode = new Map<string, string[]>();
    const unassigned: string[] = [];

    for (const raw of addedFiles) {
        const file = norm(raw);
        const dir = path.posix.dirname(file);
        let hit = false;
        for (const [nodeId, dirs] of dirsByNode) {
            if (dirs.has(dir)) {
                hit = true;
                const list = assignedByNode.get(nodeId) ?? [];
                list.push(file);
                assignedByNode.set(nodeId, list);
            }
        }
        if (!hit) unassigned.push(file);
    }

    return { assignedByNode, unassigned };
}

/**
 * 执行增量更新。返回结果；upToDate=true 时不做任何写入。
 */
export async function runIncrementalUpdate(deps: IncrementalDeps): Promise<IncrementalResult> {
    const { workspacePath, contentDir, metadataFile, metadata, analysisResult } = deps;

    const changes = await computeChangeSets(workspacePath, metadata, deps.scannedFiles);
    const changedFiles = changes.changed.size + changes.deleted.size + changes.added.size;

    const catalog = metadata.wiki_catalogs.map(entryToCatalogNode);
    const { stale, orphaned } = findStale(catalog, changes);

    // 新增文件目录亲和归页：仅考虑通过本次扫描（ignore 规则）的文件，
    // 排除 wiki 自身输出等无关路径
    const addedInScan = [...changes.added].filter((f) => deps.fileMeta.has(norm(f)));
    const { assignedByNode, unassigned: addedUnassigned } = assignAddedFiles(catalog, addedInScan);

    // 归页的新增文件追加进对应页的 dependentFiles，并把该页并入 stale
    const orphanedIds = new Set(orphaned.map((n) => n.id));
    const staleById = new Map(stale.map((n) => [n.id, n]));
    let addedAssigned = 0;
    for (const [nodeId, files] of assignedByNode) {
        if (orphanedIds.has(nodeId)) continue;
        const node = catalog.find((n) => n.id === nodeId);
        if (!node) continue;
        const existing = new Set(node.dependentFiles.map(norm));
        for (const f of files) {
            if (!existing.has(f)) {
                node.dependentFiles.push(f);
                existing.add(f);
                addedAssigned += 1;
            }
        }
        staleById.set(node.id, node);
    }
    const staleAll = [...staleById.values()];

    // 目录演进：无归属的新增文件按目录聚类成新页候选
    const clusters = clusterNewModules(addedUnassigned);
    const clusteredFiles = new Set([...clusters.values()].flat());
    const leftoverUnassigned = addedUnassigned.filter((f) => !clusteredFiles.has(norm(f)));

    const createdNodes = buildClusterNodes(clusters, catalog, deps.labels);

    // 无 stale、无 orphaned、无新页 → 原样停手
    if (staleAll.length === 0 && orphaned.length === 0 && createdNodes.length === 0) {
        return {
            upToDate: true,
            regenerated: [],
            orphaned: [],
            changedFiles,
            untouched: catalog.length,
            method: changes.method,
            addedAssigned: 0,
            addedUnassigned: leftoverUnassigned,
            createdPages: [],
        };
    }

    const generator = new WikiGenerator(deps.llmClient, {
        outputDir: contentDir,
        concurrency: deps.concurrency,
        labels: deps.labels,
        fileMeta: deps.fileMeta,
        onWarn: deps.onWarn,
    });

    const fullCatalog = [...catalog, ...createdNodes];
    const plannedSummary = fullCatalog.map((n) => `- ${n.title} (${n.filename})`).join('\n');
    const now = new Date().toISOString();

    // 1) 重生成 stale 页 + 生成新目录簇页
    await mapWithConcurrency([...staleAll, ...createdNodes], deps.concurrency, async (node) => {
        const page = await generator.generateNode(
            workspacePath,
            node,
            analysisResult,
            fullCatalog,
            plannedSummary,
        );
        await generator.savePage(page);
    });

    // 2) 处理 orphaned：删文件 + 摘除 catalog/relations/items
    const orphanIds = new Set(orphaned.map((n) => n.id));
    for (const node of orphaned) {
        await fs.rm(path.join(contentDir, node.filename), { force: true });
    }

    // 3) 更新元数据：stale 条目刷新 gmt_modified 与 dependent_files（含归页新增文件）；
    //    orphaned 摘除；刷新受影响文件指纹
    const staleIds = new Set(staleAll.map((n) => n.id));
    metadata.wiki_catalogs = metadata.wiki_catalogs
        .filter((c) => !orphanIds.has(c.id))
        .map((c) =>
            staleIds.has(c.id)
                ? {
                      ...c,
                      gmt_modified: now,
                      dependent_files: (staleById.get(c.id)?.dependentFiles ?? []).join(','),
                  }
                : c,
        );
    metadata.wiki_items = metadata.wiki_items.filter((it) => !orphanIds.has(it.catalog_id));
    metadata.knowledge_relations = metadata.knowledge_relations.filter(
        (r) => !orphanIds.has(r.source_id) && !orphanIds.has(r.target_id),
    );

    // 3.5) 新页写入元数据三表（结构对齐 metadata-writer 的 buildMetadata）
    let nextRelId = metadata.knowledge_relations.reduce((mx, r) => Math.max(mx, r.id), 0) + 1;
    for (const node of createdNodes) {
        metadata.wiki_catalogs.push({
            id: node.id,
            repo_id: metadata.wiki_repo.id,
            name: node.title,
            description: node.slug,
            prompt: node.prompt,
            ...(node.parentId ? { parent_id: node.parentId } : {}),
            layer_level: node.layerLevel,
            progress_status: 'completed',
            dependent_files: node.dependentFiles.join(','),
            gmt_create: now,
            gmt_modified: now,
            filename: node.filename,
            diagrams: node.diagrams,
            category: node.category,
            is_section: node.isSection,
        });
        metadata.wiki_items.push({
            catalog_id: node.id,
            id: hashId(`item:${node.id}`),
            repo_id: metadata.wiki_repo.id,
            title: node.title,
            description: node.slug,
            extend: '{}',
            progress_status: 'completed',
            reference_count: 0,
            gmt_create: now,
            gmt_modified: now,
        });
        if (node.parentId) {
            metadata.knowledge_relations.push({
                id: nextRelId++,
                source_id: node.parentId,
                target_id: node.id,
                source_type: 'WIKI_ITEM',
                target_type: 'WIKI_ITEM',
                relationship_type: 'PARENT_CHILD',
                extra: `Wiki parent-child relationship: -> ${node.title}`,
                gmt_create: now,
                gmt_modified: now,
            });
        }
    }

    // 刷新 stale 页与新页依赖文件的指纹；移除已删除文件的指纹
    const refreshFiles = new Set<string>();
    for (const node of [...staleAll, ...createdNodes]) {
        node.dependentFiles.forEach((f) => refreshFiles.add(norm(f)));
    }
    for (const rel of refreshFiles) {
        const fp = await fingerprintFile(workspacePath, rel);
        if (fp) metadata.source_index[rel] = fp;
        else delete metadata.source_index[rel];
    }
    for (const rel of changes.deleted) {
        delete metadata.source_index[norm(rel)];
    }

    // 4) 目录结构发生变化（新页/删页）或页面更新时，重建导航（修复增量后侧边栏过期）
    const pagesForNav: WikiPage[] = metadata.wiki_catalogs.map((c) => ({
        title: c.name,
        filename: c.filename,
        summary: c.description,
        content: '',
        sourceRefs: [],
    }));
    const sidebarContent = generateSidebar(pagesForNav, deps.labels);
    const homeContent = generateHome(pagesForNav, analysisResult.project, deps.labels);
    await fs.writeFile(path.join(contentDir, '_Sidebar.md'), sidebarContent, 'utf-8');
    await fs.writeFile(path.join(contentDir, 'Home.md'), homeContent, 'utf-8');
    metadata.wiki_readme.content = homeContent;

    // 更新 generated_at_commit 与扫描清单快照
    metadata.generated_at_commit = (await getGitCommit(workspacePath)) ?? metadata.generated_at_commit;
    if (deps.scannedFiles) {
        metadata.scanned_files = deps.scannedFiles.map(norm);
    }

    // 记录本轮实测 LLM 用量（驱动后续 dry-run 校准）；离线增量（无 llmClient）保留旧值
    const usage = deps.llmClient?.getUsageTotals();
    const regeneratedContentPages = [...staleAll, ...createdNodes].filter((n) => !n.isSection).length;
    if (usage && usage.calls > 0 && regeneratedContentPages > 0) {
        metadata.usage_stats = {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            calls: usage.calls,
            content_pages: regeneratedContentPages,
            gmt: now,
        };
    }

    await writeMetadata(metadataFile, metadata);

    return {
        upToDate: false,
        regenerated: staleAll.map((n) => n.title),
        orphaned: orphaned.map((n) => n.title),
        changedFiles,
        untouched: catalog.length - staleAll.length - orphaned.length,
        method: changes.method,
        addedAssigned,
        addedUnassigned: leftoverUnassigned,
        createdPages: createdNodes.map((n) => n.title),
    };
}
