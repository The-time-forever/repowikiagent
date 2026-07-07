/**
 * tui 命令：终端交互界面（浏览 Wiki 树 / 页面 / 对话问答 / 引用跳转）。
 */

import { Command } from 'commander';

export const tuiCommand = new Command('tui')
    .description('进入终端交互界面：浏览 Wiki、对话问答、打开源码引用')
    .argument('[path]', '项目路径', '.')
    .option('-l, --lang <lang>', '文档语言: zh | en（默认自动探测已生成语言）')
    .option('-k, --topk <number>', '整库问答检索页数', (v: string) => parseInt(v, 10), 3)
    .action(async (targetPath: string, options: { lang?: string; topk?: number }) => {
        const { runTui } = await import('../tui/run.js');
        await runTui({ path: targetPath, lang: options.lang, topk: options.topk });
    });
