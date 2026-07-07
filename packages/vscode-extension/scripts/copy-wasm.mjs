/**
 * 构建步骤：把 @vscode/tree-sitter-wasm 的运行时与语法文件拷贝到 dist/ts-wasm，
 * 使打包后的插件（vsce --no-dependencies 不带 node_modules）也能做 AST 符号提取。
 * 仅拷贝 repowiki 支持的语言，控制 .vsix 体积。
 */

import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const destDir = path.join(here, '..', 'dist', 'ts-wasm');

const WANTED = [
    'tree-sitter.js',
    'tree-sitter.wasm',
    'tree-sitter-typescript.wasm',
    'tree-sitter-tsx.wasm',
    'tree-sitter-javascript.wasm',
    'tree-sitter-python.wasm',
    'tree-sitter-go.wasm',
    'tree-sitter-java.wasm',
    'tree-sitter-rust.wasm',
    'tree-sitter-ruby.wasm',
];

let srcDir;
try {
    srcDir = path.join(path.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')), 'wasm');
} catch {
    console.warn('[copy-wasm] @vscode/tree-sitter-wasm not found; extension will run without AST symbols.');
    process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
let copied = 0;
for (const file of WANTED) {
    const src = path.join(srcDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(destDir, file));
        copied += 1;
    }
}
console.log(`[copy-wasm] copied ${copied}/${WANTED.length} files to dist/ts-wasm`);
