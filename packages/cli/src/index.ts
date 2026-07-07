#!/usr/bin/env node

import { Command } from 'commander';
import { createRequire } from 'node:module';
import { generateCommand } from './commands/generate.js';
import { scanCommand } from './commands/scan.js';
import { configCommand } from './commands/config.js';
import { loginCommand } from './commands/login.js';
import { askCommand } from './commands/ask.js';
import { chatCommand } from './commands/chat.js';
import { tuiCommand } from './commands/tui.js';

// 运行时读取包版本，避免硬编码与 package.json 脱节
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

const program = new Command();

program
    .name('repowiki')
    .description('RepoWiki: 本地化代码库 Wiki 知识库生成工具')
    .version(pkg.version);

// 注册子命令
program.addCommand(generateCommand);
program.addCommand(scanCommand);
program.addCommand(configCommand);
program.addCommand(loginCommand);
program.addCommand(askCommand);
program.addCommand(chatCommand);
program.addCommand(tuiCommand);

// 裸 repowiki（零参数 + 交互式终端）直接进 TUI；其余全部走 commander，
// --help/-V 与既有子命令行为不变，管道/CI 场景保持输出帮助。
const userArgs = process.argv.slice(2);
if (userArgs.length === 0) {
    if (process.stdout.isTTY && process.stdin.isTTY) {
        const { runTui } = await import('./tui/run.js');
        await runTui({});
    } else {
        program.outputHelp();
    }
} else {
    program.parse(process.argv);
}
