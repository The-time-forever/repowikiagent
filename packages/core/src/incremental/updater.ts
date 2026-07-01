/**
 * @module updater
 * @description 增量更新引擎（技能 `references/incremental-update.md` 的实现）。
 *
 * 有元数据时：计算变更文件集 → 反查受影响页 → 无变更则原样停手；
 * 否则只重生成受影响页并就地刷新其指纹与 gmt_modified，其余页/指纹保持不变。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AnalysisResult, CatalogNode } from '../models/index.js';
import type { LLMClient } from '../llm/index.js';
import type { WikiLabels } from '../i18n/labels.js';
import { WikiGenerator } from '../generator/index.js';
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

/**
 * 执行增量更新。返回结果；upToDate=true 时不做任何写入。
 */
export async function runIncrementalUpdate(deps: IncrementalDeps): Promise<IncrementalResult> {
    const { workspacePath, contentDir, metadataFile, metadata, analysisResult } = deps;

    const changes = await computeChangeSets(workspacePath, metadata);
    const changedFiles = changes.changed.size + changes.deleted.size + changes.added.size;

    const catalog = metadata.wiki_catalogs.map(entryToCatalogNode);
    const { stale, orphaned } = findStale(catalog, changes);

    // 无 stale、无 orphaned → 原样停手
    if (stale.length === 0 && orphaned.length === 0) {
        return {
            upToDate: true,
            regenerated: [],
            orphaned: [],
            changedFiles,
            untouched: catalog.length,
            method: changes.method,
        };
    }

    const generator = new WikiGenerator(deps.llmClient, {
        outputDir: contentDir,
        concurrency: deps.concurrency,
        labels: deps.labels,
        fileMeta: deps.fileMeta,
    });

    const plannedSummary = catalog.map((n) => `- ${n.title} (${n.filename})`).join('\n');
    const now = new Date().toISOString();

    // 1) 重生成 stale 页
    await mapWithConcurrency(stale, deps.concurrency, async (node) => {
        const page = await generator.generateNode(
            workspacePath,
            node,
            analysisResult,
            catalog,
            plannedSummary,
        );
        await generator.savePage(page);
    });

    // 2) 处理 orphaned：删文件 + 摘除 catalog/relations/items
    const orphanIds = new Set(orphaned.map((n) => n.id));
    for (const node of orphaned) {
        await fs.rm(path.join(contentDir, node.filename), { force: true });
    }

    // 3) 更新元数据：stale 条目刷新 gmt_modified；orphaned 摘除；刷新受影响文件指纹
    const staleIds = new Set(stale.map((n) => n.id));
    metadata.wiki_catalogs = metadata.wiki_catalogs
        .filter((c) => !orphanIds.has(c.id))
        .map((c) => (staleIds.has(c.id) ? { ...c, gmt_modified: now } : c));
    metadata.wiki_items = metadata.wiki_items.filter((it) => !orphanIds.has(it.catalog_id));
    metadata.knowledge_relations = metadata.knowledge_relations.filter(
        (r) => !orphanIds.has(r.source_id) && !orphanIds.has(r.target_id),
    );

    // 刷新 stale 页依赖文件的指纹；移除已删除文件的指纹
    const refreshFiles = new Set<string>();
    for (const node of stale) node.dependentFiles.forEach((f) => refreshFiles.add(norm(f)));
    for (const rel of refreshFiles) {
        const fp = await fingerprintFile(workspacePath, rel);
        if (fp) metadata.source_index[rel] = fp;
        else delete metadata.source_index[rel];
    }
    for (const rel of changes.deleted) {
        delete metadata.source_index[norm(rel)];
    }

    // 更新 generated_at_commit
    metadata.generated_at_commit = (await getGitCommit(workspacePath)) ?? metadata.generated_at_commit;

    await writeMetadata(metadataFile, metadata);

    return {
        upToDate: false,
        regenerated: stale.map((n) => n.title),
        orphaned: orphaned.map((n) => n.title),
        changedFiles,
        untouched: catalog.length - stale.length - orphaned.length,
        method: changes.method,
    };
}
