import { describe, it, expect } from 'vitest';
import {
    buildDefaultCatalog,
    flattenPlannedCatalog,
    validateCatalog,
    slugify,
    hashId,
    getLabels,
} from '../dist/index.js';
import type { AnalysisResult } from '../dist/index.js';

function fixture(): AnalysisResult {
    return {
        project: {
            name: 'demo',
            rootPath: '/repo',
            languages: ['TypeScript'],
            frameworks: [],
            packageManagers: ['npm'],
            databases: [],
            services: [],
            entrypoints: ['src/index.ts'],
            configFiles: ['package.json'],
        },
        tree: 'demo/',
        modules: [
            { moduleName: 'api', directory: 'src/api', files: ['src/api/a.ts', 'src/api/b.ts'], summary: '', category: 'api', coreComponents: [] },
            { moduleName: 'utils', directory: 'src/utils', files: ['src/utils/u.ts'], summary: '', category: 'utilities', coreComponents: [] },
        ],
        dependencies: { edges: [], internalModules: [], externalPackages: [] },
        apiRoutes: [],
        databaseModels: [],
        wikiPages: [],
    };
}

describe('buildDefaultCatalog', () => {
    it('builds an overview + section + per-module children tree that validates', () => {
        const labels = getLabels('en');
        const nodes = buildDefaultCatalog(fixture(), labels, 'feature');

        const overview = nodes.find((n) => n.category === 'overview');
        expect(overview).toBeTruthy();
        expect(overview!.diagrams).toContain('architecture');

        const section = nodes.find((n) => n.isSection);
        expect(section).toBeTruthy();

        const children = nodes.filter((n) => n.parentId === section!.id);
        expect(children).toHaveLength(2);
        expect(children.every((c) => c.layerLevel === 1)).toBe(true);
        expect(children.map((c) => c.dependentFiles).flat()).toContain('src/api/a.ts');

        expect(validateCatalog(nodes).ok).toBe(true);
    });

    it('uses module names as titles under the package strategy', () => {
        const labels = getLabels('en');
        const nodes = buildDefaultCatalog(fixture(), labels, 'package');
        const titles = nodes.map((n) => n.title);
        expect(titles).toContain('api');
        expect(titles).toContain('utils');
    });
});

describe('flattenPlannedCatalog', () => {
    it('flattens nested plan, filters unknown dependent files, and derives filenames', () => {
        const known = new Set(['src/index.ts', 'src/utils/u.ts']);
        const flat = flattenPlannedCatalog(
            [
                { title: 'Overview', slug: 'overview', dependent_files: ['src/index.ts', 'ghost.ts'] },
                { title: 'Sec', children: [{ title: 'Child', dependent_files: ['src/utils/u.ts'] }] },
            ],
            known,
        );

        const overview = flat.find((n) => n.title === 'Overview')!;
        expect(overview.dependentFiles).toEqual(['src/index.ts']); // ghost.ts filtered out
        expect(overview.filename).toBe('Overview.md');

        const sec = flat.find((n) => n.title === 'Sec')!;
        expect(sec.isSection).toBe(true);
        expect(sec.filename).toBe('Sec/Sec.md');

        const child = flat.find((n) => n.title === 'Child')!;
        expect(child.parentId).toBe(sec.id);
        expect(child.layerLevel).toBe(1);
        expect(child.filename).toBe('Sec/Child.md');
    });
});

describe('slugify / hashId', () => {
    it('slugifies to kebab-case english', () => {
        expect(slugify('Hello, World!')).toBe('hello-world');
        expect(slugify('  Multiple   Spaces  ')).toBe('multiple-spaces');
    });

    it('produces deterministic, stable ids', () => {
        expect(hashId('seed')).toBe(hashId('seed'));
        expect(hashId('a')).not.toBe(hashId('b'));
    });
});
