// TUI 流式冒烟：伪 TTY 内嵌运行 TUI，问一轮，验证草稿条目跨帧递增（流式）且最终带来源。
// 用法: node scripts/smoke/tui-stream-smoke.mjs [repoRoot=.] [问题]
// 前置: pnpm -r build；目标仓库已生成 wiki 且已配置真实 key
// 判定: ok=true（answered 且草稿长度递增出现 ≥3 个不同值）
//
// 伪 TTY 要点（踩坑记录）:
// 1. 必须用 PassThrough 整体替换 process.stdin（Object.defineProperty）——
//    对原生 stdin 手动 emit('data') 不会进入 ink 的按键管道。
// 2. PassThrough 需补 isTTY/setRawMode/ref/unref 桩，否则 ink 启动报错。
// 3. 若仓库自上次生成后有变更，TUI 首帧会弹"更新 Wiki"选择框，先发 Esc 关闭再操作。
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(process.argv[2] ?? '.');
const QUESTION = process.argv[3] ?? '流式响应是怎么实现的';
const DEADLINE_MS = 150_000;

// ── 伪 TTY：整体替换 stdin 为 PassThrough，键入走真实流管道 ──
import { PassThrough } from 'node:stream';
const fakeStdin = new PassThrough();
fakeStdin.isTTY = true;
fakeStdin.setRawMode = () => fakeStdin;
fakeStdin.ref = () => fakeStdin;
fakeStdin.unref = () => fakeStdin;
Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
process.stdout.columns = 110;
process.stdout.rows = 32;

const frames = [];
const origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk) => {
    frames.push(String(chunk));
    return true;
};

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (s) => fakeStdin.write(Buffer.from(s, 'utf-8'));

const report = (obj) => {
    process.stdout.write = origWrite;
    console.log(JSON.stringify(obj, null, 2));
};

const { runTui } = await import(pathToFileURL(path.join(repoRoot, 'packages/cli/dist/tui/run.js')).href);

const tuiDone = runTui({ path: repoRoot, lang: 'zh' }).catch((err) => {
    report({ ok: false, stage: 'runTui', error: String(err) });
    process.exit(1);
});

await sleep(3000); // 等待数据装配与首帧
key('\x1b'); // 若有"检测到变更"弹窗，Esc 跳过
await sleep(500);
key('A'); // 问全库模式并聚焦聊天
await sleep(500);
key(QUESTION);
await sleep(500);
key('\r');

// 轮询帧：收集含流式光标 ▌ 的草稿长度；直到出现 来源: 或超时
const draftLens = [];
let answered = false;
const t0 = Date.now();
let scanned = 0;
while (Date.now() - t0 < DEADLINE_MS) {
    await sleep(1000);
    for (; scanned < frames.length; scanned++) {
        const text = stripAnsi(frames[scanned]);
        if (text.includes('▌')) draftLens.push(text.length);
        if (/来源:/.test(text) && /条源码引用|来源: \S/.test(text)) answered = true;
    }
    if (answered) break;
}

// 退出：Ctrl+C
key('\x03');
await Promise.race([tuiDone, sleep(3000)]);

const distinct = new Set(draftLens);
report({
    ok: answered && distinct.size >= 3,
    answered,
    draftFrames: draftLens.length,
    distinctDraftLengths: distinct.size,
    draftLenSamples: draftLens.filter((_, i) => i % Math.max(1, Math.floor(draftLens.length / 8)) === 0),
    totalFrames: frames.length,
    elapsedMs: Date.now() - t0,
});
process.exit(0);
