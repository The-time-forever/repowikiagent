// 冒烟：验证 repowiki ask 的 stdout 为流式分段到达（而非一次性打印）
// 用法: node scripts/smoke/ask-stream-smoke.mjs <cli入口js> <目标项目目录> [问题]
//   例: node scripts/smoke/ask-stream-smoke.mjs packages/cli/dist/index.js . "增量更新是怎么实现的"
// 前置: pnpm -r build；目标项目已生成 wiki 且已配置真实 key（repowiki login 或 .env）
// 判定: streaming=true（分段 ≥5 且首末分段间隔 >1s）、hasSources=true、exitCode=0
import { spawn } from 'node:child_process';

const cli = process.argv[2];
const cwd = process.argv[3];
const question = process.argv[4] ?? '增量更新是怎么实现的';

const t0 = Date.now();
const chunks = []; // {t, bytes}
let total = '';

const child = spawn(process.execPath, [cli, 'ask', question, '.'], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (buf) => {
    chunks.push({ t: Date.now() - t0, bytes: buf.length });
    total += buf.toString('utf-8');
});
let stderr = '';
child.stderr.on('data', (b) => (stderr += b.toString('utf-8')));

child.on('close', (code) => {
    const textChunks = chunks.filter((c) => c.bytes > 0);
    const firstT = textChunks[0]?.t ?? -1;
    const lastT = textChunks[textChunks.length - 1]?.t ?? -1;
    const spreadMs = lastT - firstT;
    console.log(JSON.stringify({
        exitCode: code,
        chunkCount: textChunks.length,
        firstChunkMs: firstT,
        lastChunkMs: lastT,
        spreadMs,
        streaming: textChunks.length >= 5 && spreadMs > 1000,
        hasSources: /来源:/.test(total),
        answerChars: total.length,
        tail: total.slice(-300),
        stderr: stderr.slice(0, 500),
    }, null, 2));
});
