// 质量抽查：遍历 .repowiki/<lang>/content 的所有 md，校验引用行号有效性与 mermaid 语法
// + 卫生检查：占位行残留、cite 块幻觉元信息（0.6.0 起应全为 0）
// 用法: node scripts/smoke/quality-check.mjs [repoRoot=.] [lang=zh]
// 前置: pnpm -r build（依赖 packages/core/dist）
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(process.argv[2] ?? '.');
const contentDir = path.join(repoRoot, '.repowiki', process.argv[3] ?? 'zh', 'content');
const core = await import(pathToFileURL(path.join(repoRoot, 'packages/core/dist/index.js')).href);
const { parseCitations, lintMermaid } = core;

const mdFiles = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) mdFiles.push(p);
    }
})(contentDir);

const lineCountCache = new Map();
function lineCount(rel) {
    if (lineCountCache.has(rel)) return lineCountCache.get(rel);
    const abs = path.join(repoRoot, rel);
    let n = -1;
    try { n = fs.readFileSync(abs, 'utf-8').split('\n').length; } catch {}
    lineCountCache.set(rel, n);
    return n;
}

let totalCitations = 0, badCitations = [], mermaidBlocks = 0, mermaidErrors = [];
let placeholderHits = [], citeMetaHits = [];

for (const f of mdFiles) {
    const content = fs.readFileSync(f, 'utf-8');
    const relName = path.relative(contentDir, f);

    for (const c of parseCitations(content)) {
        totalCitations++;
        const n = lineCount(c.filePath);
        if (n < 0) badCitations.push(`${relName}: 不存在的文件 ${c.filePath}`);
        else if (c.startLine < 1 || (c.endLine ?? c.startLine) > n)
            badCitations.push(`${relName}: ${c.filePath}#L${c.startLine}-${c.endLine} 超界(共${n}行)`);
    }

    mermaidBlocks += (content.match(/```mermaid/g) ?? []).length;
    for (const e of lintMermaid(content)) mermaidErrors.push(`${relName}: ${e}`);

    // 卫生：占位行（含尾部标点变体）与 cite 块内元信息
    for (const line of content.split('\n')) {
        if (/^\s*\[(本节为|This section)[^\]]*\][\s。．.!！]*$/.test(line)) placeholderHits.push(`${relName}: ${line.trim()}`);
    }
    for (const m of content.matchAll(/<cite>([\s\S]*?)<\/cite>/g)) {
        if (/文档版本|最后更新|last\s*updated|document\s*version/i.test(m[1])) citeMetaHits.push(relName);
    }
}

console.log(JSON.stringify({
    pages: mdFiles.length,
    totalCitations,
    badCitations: badCitations.slice(0, 10),
    badCount: badCitations.length,
    mermaidBlocks,
    mermaidErrors: mermaidErrors.slice(0, 5),
    placeholderHits,
    citeMetaHits,
}, null, 2));
