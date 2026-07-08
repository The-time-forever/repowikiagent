/**
 * @module metadata-writer
 * @description 产出机器可读的 `repowiki-metadata.json`，作为增量更新的依赖图。
 * 结构对齐 repowiki-generator 技能 `references/metadata-schema.md`。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CatalogNode, DiagramKind, ProjectProfile, WikiPage } from '../models/index.js';
import type { WikiLang } from '../i18n/labels.js';
import { hashId } from '../generator/catalog-builder.js';

// ────────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────────

export interface WikiCatalogEntry {
    id: string;
    repo_id: string;
    name: string;
    description: string;
    prompt: string;
    parent_id?: string;
    layer_level: number;
    progress_status: 'completed';
    dependent_files: string;
    gmt_create: string;
    gmt_modified: string;
    // ── 无损往返扩展字段（供增量更新重建 CatalogNode）──
    filename: string;
    diagrams: DiagramKind[];
    category: string;
    is_section: boolean;
}

export interface KnowledgeRelation {
    id: number;
    source_id: string;
    target_id: string;
    source_type: 'WIKI_ITEM';
    target_type: 'WIKI_ITEM';
    relationship_type: 'PARENT_CHILD';
    extra: string;
    gmt_create: string;
    gmt_modified: string;
}

export interface WikiItem {
    catalog_id: string;
    id: string;
    repo_id: string;
    title: string;
    description: string;
    extend: string;
    progress_status: 'completed';
    reference_count: number;
    gmt_create: string;
    gmt_modified: string;
}

export interface RepowikiMetadata {
    wiki_repo: {
        id: string;
        name: string;
        progress_status: 'completed';
        wiki_present_status: 'COMPLETED';
        optimized_catalog: string;
    };
    wiki_catalogs: WikiCatalogEntry[];
    knowledge_relations: KnowledgeRelation[];
    wiki_items: WikiItem[];
    wiki_overview: { id: string; repo_id: string; content: string };
    wiki_readme: { id: string; repo_id: string; content: string };
    lang: WikiLang;
    generated_at_commit: string | null;
    source_index: Record<string, string>;
    /** 生成时扫描到的全部非忽略文件（posix 相对路径）；无 git 项目靠它检测新增文件。旧元数据可能缺失 */
    scanned_files?: string[];
}

export interface BuildMetadataParams {
    projectProfile: ProjectProfile;
    tree: string;
    lang: WikiLang;
    catalog: CatalogNode[];
    pages: WikiPage[];
    sourceIndex: Record<string, string>;
    gitCommit: string | null;
    timestamp: string;
    readmeContent: string;
    /** 复用上一版元数据的 gmt_create（保持创建时间稳定）；缺省用 timestamp */
    priorCreate?: Map<string, string>;
    /** 本次扫描到的全部非忽略文件（posix 相对路径） */
    scannedFiles?: string[];
}

// ────────────────────────────────────────────────────────────────
// 构建
// ────────────────────────────────────────────────────────────────

/**
 * 组装 RepowikiMetadata 对象（不写盘）。
 */
export function buildMetadata(params: BuildMetadataParams): RepowikiMetadata {
    const { projectProfile, tree, lang, catalog, pages, sourceIndex, gitCommit, timestamp } = params;
    const repoId = hashId(`repo:${projectProfile.name}`);
    const priorCreate = params.priorCreate ?? new Map<string, string>();

    const contentByFile = new Map(pages.map((p) => [p.filename.replace(/\\/g, '/'), p.content]));

    const wiki_catalogs: WikiCatalogEntry[] = catalog.map((n) => ({
        id: n.id,
        repo_id: repoId,
        name: n.title,
        description: n.slug,
        prompt: n.prompt,
        ...(n.parentId ? { parent_id: n.parentId } : {}),
        layer_level: n.layerLevel,
        progress_status: 'completed',
        dependent_files: n.dependentFiles.join(','),
        gmt_create: priorCreate.get(n.id) ?? timestamp,
        gmt_modified: timestamp,
        filename: n.filename,
        diagrams: n.diagrams,
        category: n.category,
        is_section: n.isSection,
    }));

    const byId = new Map(catalog.map((n) => [n.id, n]));
    let relId = 1;
    const knowledge_relations: KnowledgeRelation[] = [];
    for (const n of catalog) {
        if (n.parentId && byId.has(n.parentId)) {
            const parent = byId.get(n.parentId)!;
            knowledge_relations.push({
                id: relId++,
                source_id: n.parentId,
                target_id: n.id,
                source_type: 'WIKI_ITEM',
                target_type: 'WIKI_ITEM',
                relationship_type: 'PARENT_CHILD',
                extra: `Wiki parent-child relationship: ${parent.title} -> ${n.title}`,
                gmt_create: timestamp,
                gmt_modified: timestamp,
            });
        }
    }

    const wiki_items: WikiItem[] = catalog.map((n) => ({
        catalog_id: n.id,
        id: hashId(`item:${n.id}`),
        repo_id: repoId,
        title: n.title,
        description: n.slug,
        extend: '{}',
        progress_status: 'completed',
        reference_count: 0,
        gmt_create: priorCreate.get(n.id) ?? timestamp,
        gmt_modified: timestamp,
    }));

    // overview: 优先 category==='overview'，否则第一个非分区顶层节点
    const overviewNode =
        catalog.find((n) => n.category === 'overview') ??
        catalog.find((n) => n.layerLevel === 0 && !n.isSection);
    const overviewContent = overviewNode
        ? contentByFile.get(overviewNode.filename.replace(/\\/g, '/')) ?? ''
        : '';

    return {
        wiki_repo: {
            id: repoId,
            name: projectProfile.name,
            progress_status: 'completed',
            wiki_present_status: 'COMPLETED',
            optimized_catalog: tree,
        },
        wiki_catalogs,
        knowledge_relations,
        wiki_items,
        wiki_overview: { id: hashId(`overview:${repoId}`), repo_id: repoId, content: overviewContent },
        wiki_readme: { id: hashId(`readme:${repoId}`), repo_id: repoId, content: params.readmeContent },
        lang,
        generated_at_commit: gitCommit,
        source_index: sourceIndex,
        scanned_files: params.scannedFiles ?? [],
    };
}

// ────────────────────────────────────────────────────────────────
// 读写
// ────────────────────────────────────────────────────────────────

/**
 * 写入元数据文件（自动创建 meta 目录）。
 */
export async function writeMetadata(metadataFile: string, metadata: RepowikiMetadata): Promise<void> {
    await fs.mkdir(path.dirname(metadataFile), { recursive: true });
    await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2), 'utf-8');
}

/**
 * 读取元数据文件；不存在或解析失败返回 null。
 */
export async function readMetadata(metadataFile: string): Promise<RepowikiMetadata | null> {
    try {
        const content = await fs.readFile(metadataFile, 'utf-8');
        return JSON.parse(content) as RepowikiMetadata;
    } catch {
        return null;
    }
}
