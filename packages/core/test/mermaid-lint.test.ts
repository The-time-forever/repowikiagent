import { describe, it, expect } from 'vitest';
import { lintMermaid, lintMermaidBlock } from '../dist/index.js';

const wrap = (body: string) => '```mermaid\n' + body + '\n```\n';

describe('lintMermaidBlock', () => {
    it('accepts a valid flowchart', () => {
        expect(lintMermaidBlock('flowchart TD\n    A["start"] --> B{decision}\n    B --> C[end]')).toEqual([]);
    });

    it('accepts a valid erDiagram', () => {
        expect(lintMermaidBlock('erDiagram\n    USER ||--o{ ORDER : places')).toEqual([]);
    });

    it('rejects an unknown header', () => {
        const errors = lintMermaidBlock('flowchat TD\n    A --> B');
        expect(errors.some((e) => e.includes('未知的 Mermaid 图类型'))).toBe(true);
    });

    it('rejects unbalanced brackets', () => {
        const errors = lintMermaidBlock('flowchart TD\n    A[broken --> B[ok]');
        expect(errors.some((e) => e.includes('不配平'))).toBe(true);
    });

    it('ignores brackets inside quoted labels', () => {
        expect(lintMermaidBlock('flowchart TD\n    A["label with ["] --> B["]"]')).toEqual([]);
    });

    it('rejects unclosed subgraph', () => {
        const errors = lintMermaidBlock('flowchart TD\n    subgraph G\n    A --> B');
        expect(errors.some((e) => e.includes('subgraph'))).toBe(true);
    });

    it('rejects an empty diagram', () => {
        expect(lintMermaidBlock('   \n')).toEqual(['Mermaid 图为空。']);
    });
});

describe('lintMermaid', () => {
    it('locates errors per fenced block and passes clean content', () => {
        const good = wrap('flowchart TD\n    A --> B');
        expect(lintMermaid(`# Doc\n${good}`)).toEqual([]);

        const bad = wrap('notadiagram\n    x');
        const errors = lintMermaid(`${good}\nsome text\n${bad}`);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('第 2 个 Mermaid 图');
    });
});
