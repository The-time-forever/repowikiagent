import { describe, it, expect } from 'vitest';
import { buildWikiTree, splitDependentFiles } from '../dist/index.js';
import type { RepowikiMetadata, WikiCatalogEntry } from '../dist/index.js';

function entry(partial: Partial<WikiCatalogEntry> & { id: string; name: string }): WikiCatalogEntry {
    return {
        repo_id: 'repo',
        description: 'slug',
        prompt: '',
        layer_level: 0,
        progress_status: 'completed',
        dependent_files: '',
        gmt_create: '2026-01-01T00:00:00.000Z',
        gmt_modified: '2026-01-01T00:00:00.000Z',
        filename: `${partial.id}.md`,
        diagrams: [],
        category: '',
        is_section: false,
        ...partial,
    };
}

function metadataWith(catalogs: WikiCatalogEntry[]): RepowikiMetadata {
    return { wiki_catalogs: catalogs } as unknown as RepowikiMetadata;
}

describe('buildWikiTree', () => {
    it('按 parent_id 组装层级并保持原始顺序', () => {
        const roots = buildWikiTree(metadataWith([
            entry({ id: 'a', name: '总览' }),
            entry({ id: 'b', name: '核心模块', is_section: true }),
            entry({ id: 'b1', name: '扫描器', parent_id: 'b', layer_level: 1 }),
            entry({ id: 'b2', name: '生成器', parent_id: 'b', layer_level: 1 }),
            entry({ id: 'c', name: 'API' }),
        ]));

        expect(roots.map((n) => n.id)).toEqual(['a', 'b', 'c']);
        expect(roots[1].isSection).toBe(true);
        expect(roots[1].children.map((n) => n.title)).toEqual(['扫描器', '生成器']);
        expect(roots[1].children[0].layerLevel).toBe(1);
    });

    it('parent_id 悬空的节点归根', () => {
        const roots = buildWikiTree(metadataWith([
            entry({ id: 'x', name: '孤儿页', parent_id: 'missing' }),
            entry({ id: 'y', name: '正常页' }),
        ]));
        expect(roots.map((n) => n.id)).toEqual(['x', 'y']);
    });

    it('dependent_files 逗号串拆分为数组并去空白', () => {
        const roots = buildWikiTree(metadataWith([
            entry({ id: 'a', name: 'p', dependent_files: 'src/a.ts, src/b.ts ,,src/c.ts' }),
        ]));
        expect(roots[0].dependentFiles).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
        expect(splitDependentFiles('')).toEqual([]);
    });

    it('空 catalogs 返回空树', () => {
        expect(buildWikiTree(metadataWith([]))).toEqual([]);
    });
});
