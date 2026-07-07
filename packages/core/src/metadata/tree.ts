/**
 * @module tree
 * @description 从 metadata 的 wiki_catalogs 重建页面层级树。
 * 供 TUI / IDE 插件等消费端共享，避免各自 ad hoc 组装。
 */

import type { RepowikiMetadata, WikiCatalogEntry } from './metadata-writer.js';

/** Wiki 页面树节点（面向展示：只保留用户可见字段） */
export interface WikiTreeNode {
    id: string;
    /** 用户可见标题（= WikiCatalogEntry.name） */
    title: string;
    /** content/ 下的相对路径（含 .md） */
    filename: string;
    isSection: boolean;
    layerLevel: number;
    /** 关联源文件（已从逗号串拆分、去空白） */
    dependentFiles: string[];
    children: WikiTreeNode[];
}

/** 拆分 metadata 中逗号串形式的 dependent_files */
export function splitDependentFiles(raw: string): string[] {
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

function toNode(entry: WikiCatalogEntry): WikiTreeNode {
    return {
        id: entry.id,
        title: entry.name,
        filename: entry.filename,
        isSection: entry.is_section,
        layerLevel: entry.layer_level,
        dependentFiles: splitDependentFiles(entry.dependent_files),
        children: [],
    };
}

/**
 * 两遍组装：先建 id → 节点映射，再按 parent_id 挂接。
 * 保持 wiki_catalogs 原始顺序（生成时即先序）；parent_id 缺失或悬空的节点归根。
 */
export function buildWikiTree(metadata: RepowikiMetadata): WikiTreeNode[] {
    const nodes = new Map<string, WikiTreeNode>();
    for (const entry of metadata.wiki_catalogs) {
        nodes.set(entry.id, toNode(entry));
    }

    const roots: WikiTreeNode[] = [];
    for (const entry of metadata.wiki_catalogs) {
        const node = nodes.get(entry.id)!;
        const parent = entry.parent_id ? nodes.get(entry.parent_id) : undefined;
        if (parent && parent !== node) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }
    return roots;
}
