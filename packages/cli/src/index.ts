#!/usr/bin/env node

import { Command } from 'commander';
import { createRequire } from 'node:module';
import { generateCommand } from './commands/generate.js';
import { scanCommand } from './commands/scan.js';
import { configCommand } from './commands/config.js';
import { loginCommand } from './commands/login.js';
import { askCommand } from './commands/ask.js';
import { chatCommand } from './commands/chat.js';

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

program.parse(process.argv);
