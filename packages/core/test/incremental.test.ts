import { describe, it, expect } from 'vitest';
import { findStale, assignAddedFiles, clusterNewModules, buildClusterNodes, entryToCatalogNode, getLabels } from '../dist/index.js';
import type { CatalogNode, ChangeSets } from '../dist/index.js';

function node(id: string, deps: string[], extra: Partial<CatalogNode> = {}): CatalogNode {
    return {
        id,
        title: id,
        slug: id,
        summary: '',
        prompt: '',
        dependentFiles: deps,
        layerLevel: 0,
        category: '',
        diagrams: [],
        isSection: false,
        filename: `${id}.md`,
        ...extra,
    };
}

function changes(changed: string[], deleted: string[] = []): ChangeSets {
    return { changed: new Set(changed), added: new Set(), deleted: new Set(deleted), method: 'hash' };
}

describe('findStale', () => {
    it('marks a page stale iff one of its dependent files changed', () => {
        const catalog = [node('overview', ['a.ts']), node('mod', ['b.ts', 'c.ts'])];
        const { stale, orphaned } = findStale(catalog, changes(['b.ts']));
        expect(stale.map((n) => n.id)).toEqual(['mod']);
        expect(orphaned).toHaveLength(0);
    });

    it('reports no stale pages when nothing relevant changed', () => {
        const catalog = [node('mod', ['b.ts'])];
        expect(findStale(catalog, changes(['unrelated.ts'])).stale).toHaveLength(0);
    });

    it('marks a page orphaned when all its dependent files were deleted', () => {
        const catalog = [node('mod', ['b.ts', 'c.ts'])];
        const { stale, orphaned } = findStale(catalog, changes([], ['b.ts', 'c.ts']));
        expect(orphaned.map((n) => n.id)).toEqual(['mod']);
        expect(stale).toHaveLength(0); // orphaned excluded from stale
    });
});

describe('assignAddedFiles', () => {
    it('assigns an added file to the page whose dependent files share its directory', () => {
        const catalog = [node('scanner', ['src/scanner/a.ts']), node('llm', ['src/llm/client.ts'])];
        const { assignedByNode, unassigned } = assignAddedFiles(catalog, ['src/scanner/new.ts']);
        expect(assignedByNode.get('scanner')).toEqual(['src/scanner/new.ts']);
        expect(assignedByNode.has('llm')).toBe(false);
        expect(unassigned).toHaveLength(0);
    });

    it('reports files in directories no page depends on as unassigned', () => {
        const catalog = [node('scanner', ['src/scanner/a.ts'])];
        const { assignedByNode, unassigned } = assignAddedFiles(catalog, ['src/brand-new-module/x.ts']);
        expect(assignedByNode.size).toBe(0);
        expect(unassigned).toEqual(['src/brand-new-module/x.ts']);
    });

    it('assigns to every matching page but skips sections and pages without dependencies', () => {
        const catalog = [
            node('a', ['src/core/a.ts']),
            node('b', ['src/core/b.ts']),
            node('sec', ['src/core/c.ts'], { isSection: true }),
            node('empty', []),
        ];
        const { assignedByNode, unassigned } = assignAddedFiles(catalog, ['src/core/new.ts']);
        expect([...assignedByNode.keys()].sort()).toEqual(['a', 'b']);
        expect(unassigned).toHaveLength(0);
    });

    it('normalizes backslash paths before matching', () => {
        const catalog = [node('scanner', ['src\\scanner\\a.ts'])];
        const { assignedByNode } = assignAddedFiles(catalog, ['src\\scanner\\new.ts']);
        expect(assignedByNode.get('scanner')).toEqual(['src/scanner/new.ts']);
    });
});

describe('clusterNewModules', () => {
    it('clusters files sharing a directory when the cluster has 2+ files', () => {
        const clusters = clusterNewModules(['src/newmod/a.ts', 'src/newmod/b.ts', 'src/other/x.ts']);
        expect(clusters.get('src/newmod')).toEqual(['src/newmod/a.ts', 'src/newmod/b.ts']);
        expect(clusters.has('src/other')).toBe(false); // 单文件不成簇
    });

    it('skips root-level stray files', () => {
        const clusters = clusterNewModules(['a.ts', 'b.ts']);
        expect(clusters.size).toBe(0);
    });
});

describe('buildClusterNodes', () => {
    const labels = getLabels('zh');

    it('attaches new nodes under the existing modules section', () => {
        const section = node('sec', ['x'], {
            isSection: true,
            filename: `${labels.plan.modulesDir}/${labels.plan.modulesDir}.md`,
        });
        const clusters = new Map([['src/newmod', ['src/newmod/a.ts', 'src/newmod/b.ts']]]);
        const created = buildClusterNodes(clusters, [section], labels);
        expect(created).toHaveLength(1);
        expect(created[0].parentId).toBe('sec');
        expect(created[0].layerLevel).toBe(1);
        expect(created[0].dependentFiles).toEqual(['src/newmod/a.ts', 'src/newmod/b.ts']);
    });

    it('falls back to top-level and dedupes filename collisions', () => {
        const existing = node('old', ['x'], {
            filename: `${labels.plan.modulesDir}/${labels.plan.moduleTitle('newmod')}.md`,
        });
        const clusters = new Map([['src/newmod', ['src/newmod/a.ts', 'src/newmod/b.ts']]]);
        const created = buildClusterNodes(clusters, [existing], labels);
        expect(created[0].parentId).toBeUndefined();
        expect(created[0].layerLevel).toBe(0);
        expect(created[0].filename).toContain('-2.md');
    });
});

describe('entryToCatalogNode', () => {
    it('round-trips the lossless catalog fields', () => {
        const n = entryToCatalogNode({
            id: 'x1',
            repo_id: 'r',
            name: 'My Page',
            description: 'my-page',
            prompt: 'explain X',
            parent_id: 'p1',
            layer_level: 1,
            progress_status: 'completed',
            dependent_files: 'a.ts,b.ts',
            gmt_create: 't',
            gmt_modified: 't',
            filename: 'Sec/My Page.md',
            diagrams: ['er'],
            category: 'data',
            is_section: false,
        });
        expect(n).toMatchObject({
            id: 'x1',
            title: 'My Page',
            slug: 'my-page',
            parentId: 'p1',
            layerLevel: 1,
            dependentFiles: ['a.ts', 'b.ts'],
            filename: 'Sec/My Page.md',
            diagrams: ['er'],
            category: 'data',
            isSection: false,
        });
    });
});
