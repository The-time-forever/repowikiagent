/**
 * TUI 入口：TTY 守卫、语言探测、数据装配、备用屏生命周期。
 */

import * as path from 'node:path';
import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';
import { App } from './components/App.js';
import { loadWikiData, resolveTuiLang } from './data.js';
import type { TuiBase } from './types.js';

export interface RunTuiOptions {
    path?: string;
    lang?: string;
    topk?: number;
}

export async function runTui(options: RunTuiOptions): Promise<void> {
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
        console.error(chalk.red('repowiki tui 需要交互式终端（TTY）。'));
        console.error(chalk.gray('非交互场景请使用 repowiki generate / ask 等子命令。'));
        process.exitCode = 1;
        return;
    }

    const workspacePath = path.resolve(options.path ?? '.');
    const base: TuiBase = {
        workspacePath,
        lang: resolveTuiLang(workspacePath, options.lang),
        topK: options.topk && options.topk > 0 ? options.topk : 3,
    };

    const initialData = await loadWikiData(base.workspacePath, base.lang);

    // 备用屏：进入前保存主屏内容，退出时恢复（含 Ctrl+C / 异常路径）
    let restored = false;
    const restore = (): void => {
        if (restored) return;
        restored = true;
        process.stdout.write('\x1b[?1049l');
    };
    process.stdout.write('\x1b[?1049h\x1b[H');
    process.on('exit', restore);

    try {
        const instance = render(React.createElement(App, { base, initialData }), {
            exitOnCtrlC: true,
        });
        await instance.waitUntilExit();
    } finally {
        restore();
    }
}
