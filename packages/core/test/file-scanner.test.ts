import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanDirectory, validateCitations } from '../dist/index.js';

let tmpDir: string;

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repowiki-scan-'));
    // 10 physical lines with blank lines interleaved (only 5 non-empty)
    const content = ['const a = 1;', '', 'const b = 2;', '', 'const c = 3;', '', 'const d = 4;', '', '', 'const e = 5;'].join('\n');
    await fs.writeFile(path.join(tmpDir, 'sample.ts'), content, 'utf-8');
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('scanDirectory line counting', () => {
    it('counts physical lines (including blank lines), matching editor line numbers', async () => {
        const files = await scanDirectory(tmpDir);
        const sample = files.find((f) => f.relativePath.endsWith('sample.ts'));
        expect(sample?.lineCount).toBe(10);
    });

    it('regression: a citation near the end of a file with blank lines validates', async () => {
        const files = await scanDirectory(tmpDir);
        const known = new Map<string, number>();
        for (const f of files) {
            if (f.nodeType === 'file') {
                known.set(f.relativePath.replace(/\\/g, '/'), f.lineCount ?? 0);
            }
        }
        // L10 是物理末行；按旧的"非空行数"语义（5 行）会被误判 bad-range
        const md = '[s](file://sample.ts#L10)\n**Section sources**';
        const r = validateCitations(md, known);
        expect(r.ok).toBe(true);
    });
});
