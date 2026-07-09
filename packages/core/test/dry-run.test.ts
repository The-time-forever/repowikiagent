import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildDryRunReport } from '../dist/index.js';

let tmpDir: string;

function makeNode(id: string, files: string[], isSection = false) {
    return {
        id,
        title: `页面 ${id}`,
        slug: id,
        filename: `${id}.md`,
        summary: '',
        prompt: '',
        parentId: undefined,
        layerLevel: 0,
        dependentFiles: files,
        diagrams: [],
        category: 'other',
        isSection,
    };
}

const analysisResult = {
    tree: 'root\n  src\n    a.ts\n',
    modules: [],
    dependencies: { edges: [] },
};

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repowiki-dryrun-'));
    await fs.writeFile(path.join(tmpDir, 'a.ts'), 'export const a = 1;\n'.repeat(20), 'utf-8');
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('buildDryRunReport', () => {
    it('无 priorUsage：结构估算口径，calibrated=false', async () => {
        const report = await buildDryRunReport(
            tmpDir,
            [makeNode('p1', ['a.ts']), makeNode('sec', [], true)],
            analysisResult,
            'full',
        );
        expect(report.calibrated).toBe(false);
        expect(report.totals.pages).toBe(1); // section 页零成本跳过
        expect(report.totals.llmCalls).toBe(1);
        expect(report.pages[0].estOutputTokens).toBe(4000); // 0.5.0 实测修正后的常量
        expect(report.notes.some((n) => n.includes('近似值'))).toBe(true);
    });

    it('有 priorUsage（full）：页数与用量按上次实测校准', async () => {
        const prior = { promptTokens: 300_000, completionTokens: 108_000, calls: 30, contentPages: 12 };
        const report = await buildDryRunReport(
            tmpDir,
            [makeNode('p1', ['a.ts'])],
            analysisResult,
            'full',
            ['extra note'],
            prior,
        );
        expect(report.calibrated).toBe(true);
        // 全量重建页数取上次实际内容页数
        expect(report.totals.pages).toBe(12);
        expect(report.totals.llmCalls).toBe(30);
        expect(report.totals.estInputTokens).toBe(300_000);
        expect(report.totals.estOutputTokens).toBe(108_000);
        expect(report.notes.some((n) => n.includes('已按上次实测用量校准'))).toBe(true);
        expect(report.notes).toContain('extra note');
    });

    it('有 priorUsage（incremental）：按本次受影响页数缩放每页均值', async () => {
        const prior = { promptTokens: 120_000, completionTokens: 48_000, calls: 24, contentPages: 12 };
        const report = await buildDryRunReport(
            tmpDir,
            [makeNode('p1', ['a.ts']), makeNode('p2', ['a.ts']), makeNode('p3', ['a.ts'])],
            analysisResult,
            'incremental',
            [],
            prior,
        );
        expect(report.calibrated).toBe(true);
        expect(report.totals.pages).toBe(3);
        // 每页均值: 10k 输入 / 4k 输出 / 2 次调用 → ×3 页
        expect(report.totals.estInputTokens).toBe(30_000);
        expect(report.totals.estOutputTokens).toBe(12_000);
        expect(report.totals.llmCalls).toBe(6);
    });

    it('priorUsage 数据不完整（contentPages=0）时回退结构估算', async () => {
        const report = await buildDryRunReport(
            tmpDir,
            [makeNode('p1', ['a.ts'])],
            analysisResult,
            'full',
            [],
            { promptTokens: 100, completionTokens: 100, calls: 0, contentPages: 0 },
        );
        expect(report.calibrated).toBe(false);
    });
});
