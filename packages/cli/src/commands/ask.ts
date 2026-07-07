import { Command } from 'commander';
import chalk from 'chalk';
import { retrieve, answerQuestion } from 'repowiki-core';
import { createQaSession } from '../util/qa-session.js';

export const askCommand = new Command('ask')
    .arguments('<question> [path]')
    .description('基于已生成的 Wiki 回答一个问题（带页面来源与源码引用）')
    .option('-l, --lang <lang>', '使用哪种语言的 Wiki（zh | en，默认自动探测）')
    .option('-k, --topk <number>', '检索的页面数', (v) => parseInt(v, 10), 3)
    .action(async (question, targetPath, options) => {
        const session = await createQaSession(targetPath, options.lang);

        const pages = retrieve(session.index, question, options.topk);
        if (pages.length === 0) {
            console.error(chalk.yellow('未在 Wiki 中检索到相关页面。换个问法，或重新生成 Wiki。'));
            process.exit(1);
        }

        try {
            const answer = await answerQuestion(session.llmClient, pages, question, session.lang);
            console.log('\n' + answer.content.trim() + '\n');
            console.log(chalk.dim(`来源: ${answer.sources.join('、')}`));
        } catch (err: any) {
            console.error(chalk.red('错误: 回答失败:'), err?.message || err);
            process.exit(1);
        }
    });
