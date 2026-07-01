import { describe, it, expect } from 'vitest';
import { validateCitations } from '../dist/index.js';

const known = new Map<string, number>([
    ['src/pipeline.ts', 250],
    ['src/util/x.ts', 40],
]);

describe('validateCitations', () => {
    it('accepts a valid citation and parses it (suffix-matches absolute root)', () => {
        const md =
            'Body [pipeline.ts:10-20](file:///D:/repo/src/pipeline.ts#L10-L20)\n**Section sources**\n';
        const r = validateCitations(md, known);
        expect(r.ok).toBe(true);
        expect(r.citations).toEqual([
            { filePath: 'src/pipeline.ts', startLine: 10, endLine: 20, reason: '' },
        ]);
    });

    it('flags a citation to an unknown file', () => {
        const r = validateCitations('[x](file://src/nope.ts#L1-L5)', known);
        expect(r.ok).toBe(false);
        expect(r.errors.map((e) => e.kind)).toContain('unknown-file');
    });

    it('flags an out-of-range line span', () => {
        const md = '[p](file://src/pipeline.ts#L900-L950)\n**Section sources**';
        const r = validateCitations(md, known);
        expect(r.errors.map((e) => e.kind)).toContain('bad-range');
    });

    it('flags a page with no sources at all', () => {
        const r = validateCitations('# Title\nsome prose, no citations', known);
        expect(r.errors.map((e) => e.kind)).toContain('no-sources');
    });

    it('flags a mermaid diagram without a following diagram-source block', () => {
        const md =
            '[p](file://src/pipeline.ts#L1-L5)\n**Section sources**\n```mermaid\ngraph TD\nA-->B\n```\nno source here';
        const r = validateCitations(md, known);
        expect(r.errors.map((e) => e.kind)).toContain('diagram-without-source');
    });

    it('accepts single-line #Ln citations', () => {
        const r = validateCitations('[u](file://src/util/x.ts#L5)\n**Section sources**', known);
        expect(r.ok).toBe(true);
        expect(r.citations[0]).toMatchObject({ startLine: 5, endLine: 5 });
    });
});
