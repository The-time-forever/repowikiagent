import { describe, it, expect } from 'vitest';
import { retrieve, tokenize } from '../dist/index.js';
import type { WikiIndexEntry } from '../dist/index.js';

function entry(partial: Partial<WikiIndexEntry> & { id: string; title: string }): WikiIndexEntry {
    return {
        summary: '',
        filename: `${partial.id}.md`,
        content: '',
        dependentFiles: [],
        ...partial,
    };
}

describe('tokenize', () => {
    it('extracts lowercase latin words', () => {
        expect(tokenize('Incremental Update in updater.ts')).toContain('incremental');
        expect(tokenize('Incremental Update in updater.ts')).toContain('updater');
    });

    it('splits CJK runs into bigrams', () => {
        const tokens = tokenize('增量更新');
        expect(tokens).toEqual(expect.arrayContaining(['增量', '量更', '更新']));
    });
});

describe('retrieve', () => {
    const index: WikiIndexEntry[] = [
        entry({
            id: 'inc',
            title: '增量更新引擎',
            summary: 'incremental-update',
            content: '增量更新通过 git diff 计算变更集，反查受影响页面并重生成。',
            dependentFiles: ['src/incremental/updater.ts'],
        }),
        entry({
            id: 'api',
            title: 'API 参考文档',
            content: '列出全部 HTTP 路由。',
            dependentFiles: ['src/analyzer/api-analyzer.ts'],
        }),
    ];

    it('ranks the page with title and body hits first', () => {
        const hits = retrieve(index, '增量更新是怎么实现的?');
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].entry.id).toBe('inc');
    });

    it('matches latin tokens against dependent file paths', () => {
        const hits = retrieve(index, 'where is the updater implemented?');
        expect(hits[0]?.entry.id).toBe('inc');
    });

    it('returns empty for an empty index or no overlap', () => {
        expect(retrieve([], '任何问题')).toEqual([]);
        expect(retrieve(index, 'zzzz9999')).toEqual([]);
    });
});
