import { describe, it, expect } from 'vitest';
import { findStale, entryToCatalogNode } from '../dist/index.js';
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
