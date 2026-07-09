import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { retrieve, answerQuestion, type ChatMessage } from 'repowiki-core';
import { createQaSession } from '../util/qa-session.js';

/** history 中保留的最大 Q/A 轮数 */
const MAX_HISTORY_TURNS = 8;

export const chatCommand = new Command('chat')
    .arguments('[path]')
    .description('进入多轮问答模式，基于已生成的 Wiki 回答（/exit 退出）')
    .option('-l, --lang <lang>', '使用哪种语言的 Wiki（zh | en，默认自动探测）')
    .option('-k, --topk <number>', '每轮检索的页面数', (v) => parseInt(v, 10), 3)
    .action(async (targetPath, options) => {
        const session = await createQaSession(targetPath, options.lang);

        console.log(chalk.bold(`\nRepoWiki 问答（${session.lang}，${session.index.length} 页索引）`));
        console.log(chalk.dim('输入问题回车提问，/exit 退出。\n'));

        const rl = readline.createInterface({ input, output });
        const history: ChatMessage[] = [];

        try {
            while (true) {
                const question = (await rl.question(chalk.cyan('> '))).trim();
                if (!question) continue;
                if (question === '/exit' || question === '/quit') break;

                const pages = retrieve(session.index, question, options.topk);
                if (pages.length === 0) {
                    console.log(chalk.yellow('未检索到相关页面，请换个问法。\n'));
                    continue;
                }

                try {
                    // 流式逐段输出；printed 记录已展示内容，非流式回退时为空则整体打印
                    let printed = '';
                    const onToken = (delta: string) => {
                        if (!printed) process.stdout.write('\n');
                        printed += delta;
                        process.stdout.write(delta);
                    };
                    const onStreamReset = () => {
                        if (printed) {
                            printed = '';
                            process.stdout.write(chalk.dim('\n\n[连接中断，正在重试…]\n'));
                        }
                    };
                    const answer = await answerQuestion(
                        session.llmClient,
                        pages,
                        question,
                        session.lang,
                        history,
                        onToken,
                        onStreamReset,
                    );
                    if (printed) {
                        process.stdout.write('\n');
                    } else {
                        console.log('\n' + answer.content.trim());
                    }
                    console.log(chalk.dim(`\n来源: ${answer.sources.join('、')}\n`));

                    // history 只保留纯 Q/A 文本（不含大体积 context），限量滚动
                    history.push({ role: 'user', content: question });
                    history.push({ role: 'assistant', content: answer.content });
                    while (history.length > MAX_HISTORY_TURNS * 2) {
                        history.shift();
                    }
                } catch (err: any) {
                    console.error(chalk.red('错误: 回答失败:'), err?.message || err);
                }
            }
        } finally {
            rl.close();
        }
    });
