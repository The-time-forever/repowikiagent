#!/usr/bin/env node

import { Command } from 'commander';
import { generateCommand } from './commands/generate.js';
import { scanCommand } from './commands/scan.js';
import { configCommand } from './commands/config.js';
import { loginCommand } from './commands/login.js';

const program = new Command();

program
    .name('repowiki')
    .description('RepoWiki: 本地化代码库 Wiki 知识库生成工具')
    .version('0.2.0');

// 注册子命令
program.addCommand(generateCommand);
program.addCommand(scanCommand);
program.addCommand(configCommand);
program.addCommand(loginCommand);

program.parse(process.argv);
