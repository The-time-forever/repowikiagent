import { describe, it, expect } from 'vitest';
import { extractSymbols, renderSymbolOutline, languageIdForFile } from '../dist/index.js';

describe('languageIdForFile', () => {
    it('maps supported extensions and rejects others', () => {
        expect(languageIdForFile('src/a.ts')).toBe('typescript');
        expect(languageIdForFile('src/a.tsx')).toBe('typescriptreact');
        expect(languageIdForFile('main.py')).toBe('python');
        expect(languageIdForFile('main.go')).toBe('go');
        expect(languageIdForFile('style.css')).toBeNull();
    });
});

describe('extractSymbols (WASM tree-sitter)', () => {
    it('extracts top-level TypeScript symbols with export flags and line ranges', async () => {
        const src = [
            'export function foo(a: number) {',
            '    return a;',
            '}',
            'class Bar {',
            '    method() {}',
            '}',
            'export const baz = () => 1;',
        ].join('\n');
        const symbols = await extractSymbols(src, 'typescript');
        expect(symbols.map((s) => s.name)).toEqual(['foo', 'Bar', 'baz']);
        expect(symbols[0]).toMatchObject({ kind: 'function', exported: true, startLine: 1, endLine: 3 });
        expect(symbols[1]).toMatchObject({ kind: 'class', exported: false, startLine: 4, endLine: 6 });
    });

    it('extracts Python symbols with underscore-private convention', async () => {
        const src = 'def public_fn():\n    pass\n\nclass MyClass:\n    pass\n\ndef _private():\n    pass\n';
        const symbols = await extractSymbols(src, 'python');
        expect(symbols.map((s) => `${s.name}:${s.exported}`)).toEqual([
            'public_fn:true',
            'MyClass:true',
            '_private:false',
        ]);
    });

    it('extracts Go symbols with capitalization-based export', async () => {
        const src = 'package main\n\nfunc Public() {}\n\nfunc private() {}\n\ntype Config struct{}\n';
        const symbols = await extractSymbols(src, 'go');
        const byName = Object.fromEntries(symbols.map((s) => [s.name, s]));
        expect(byName['Public'].exported).toBe(true);
        expect(byName['private'].exported).toBe(false);
        expect(byName['Config'].kind).toBe('type');
    });

    it('returns empty for unsupported languages and broken input', async () => {
        expect(await extractSymbols('body { color: red }', 'css')).toEqual([]);
        // 语法错误的输入不应抛异常
        const broken = await extractSymbols('export function {{{', 'typescript');
        expect(Array.isArray(broken)).toBe(true);
    });
});

describe('renderSymbolOutline', () => {
    it('renders a compact one-line outline', async () => {
        const symbols = await extractSymbols('export function foo() {}', 'typescript');
        expect(renderSymbolOutline(symbols)).toBe('foo (function, L1-1)');
    });
});
