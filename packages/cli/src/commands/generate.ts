import { Command } from 'commander';
import { runPipeline, type PipelineEvent } from 'repowiki-core';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'node:path';

export const generateCommand = new Command('generate')
    .arguments('[path]')
    .description('为指定的项目目录生成 Wiki 文档')
    .option('-o, --output <dir>', 'Wiki 输出根目录（默认: <path>/.repowiki，语言树位于 <root>/<lang>）')
    .option('-m, --model <model>', '使用的大语言模型名称')
    .option('-c, --concurrency <number>', '并发大模型请求数', (val) => parseInt(val, 10), 3)
    .option('-l, --lang <lang>', '文档语言：zh | en | both', 'en')
    .option('-s, --strategy <strategy>', '目录组织策略：feature | package', 'feature')
    .option('--force-rebuild', '强制全量重建，忽略已有元数据的增量更新')
    .option('--dry-run', '只估算生成成本（页数、LLM 调用数、token 量），不调用模型也不写入文件')
    .option('--slug-filenames', '文件名使用 ASCII slug（跨平台与 URL 兼容），默认使用本地化标题')
    .option('--skip-llm', '免大模型，仅基于本地模板快速生成文档结构')
    .option('--json-stdout', '以 JSON Lines 格式流式输出执行进度（适用于集成 IDE 插件）')
    .action(async (targetPath, options) => {
        const workspacePath = path.resolve(targetPath || '.');
        const outputDir = options.output ? path.resolve(options.output) : undefined;
        const jsonStdout = !!options.jsonStdout;

        // 解析语言：both → 依次生成 zh 与 en 两套语言树
        const langOption = String(options.lang || 'en').toLowerCase();
        const languages: Array<'zh' | 'en'> =
            langOption === 'both' ? ['zh', 'en'] : langOption === 'zh' ? ['zh'] : ['en'];
        const strategy = options.strategy === 'package' ? 'package' : 'feature';

        let spinner: ReturnType<typeof ora> | null = null;
        let currentStage = '';
        let lastMessage = '';
        let warnCount = 0;
        const startedAt = Date.now();

        /** 阶段收尾：把该阶段最后一条消息固化成一行留在终端 */
        const persistStage = () => {
            if (!spinner || !currentStage) return;
            spinner.stopAndPersist({
                symbol: chalk.green('+'),
                text: chalk.dim(`[${currentStage}] `) + lastMessage,
            });
        };

        const formatElapsed = () => {
            const seconds = (Date.now() - startedAt) / 1000;
            return seconds >= 60
                ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
                : `${seconds.toFixed(1)}s`;
        };

        if (!jsonStdout) {
            console.log(chalk.bold('\nRepoWiki 文档生成\n'));
            spinner = ora('初始化环境中...').start();
        }

        const handleProgress = (event: PipelineEvent) => {
            if (jsonStdout) {
                // 流式输出 JSONL
                console.log(JSON.stringify(event));
                return;
            }

            if (!spinner) return;

            if (event.type === 'PROGRESS') {
                const text = chalk.dim(`[${event.stage}] `) + event.message;
                // 阶段切换时留痕上一阶段，终端保留完整阶段日志
                if (event.stage !== currentStage) {
                    persistStage();
                    currentStage = event.stage;
                    spinner.text = text;
                    spinner.start();
                }
                lastMessage = event.message;
                spinner.text = text;
            } else if (event.type === 'WARN') {
                warnCount += 1;
                spinner.clear();
                console.log(chalk.yellow('warn: ') + chalk.dim(`[${event.stage}] `) + event.message);
                spinner.start();
            } else if (event.type === 'DRY_RUN') {
                persistStage();
                currentStage = '';
                spinner.succeed(`成本估算完成（${event.report.mode === 'full' ? '全量' : '增量'}）`);
                const { pages, totals, notes } = event.report;
                console.log('');
                if (pages.length === 0) {
                    console.log('  没有需要生成的页面。');
                } else {
                    const titleWidth = Math.min(
                        32,
                        Math.max(8, ...pages.map((p) => p.title.length * 2)),
                    );
                    console.log(
                        `  ${'页面'.padEnd(titleWidth)}  文件数  输入tok  输出tok`,
                    );
                    for (const p of pages) {
                        // 中文字符按双宽近似对齐
                        const pad = Math.max(0, titleWidth - p.title.replace(/[^\x00-\xff]/g, 'xx').length);
                        console.log(
                            `  ${p.title}${' '.repeat(pad)}  ${String(p.files).padStart(4)}  ${String(p.estInputTokens).padStart(7)}  ${String(p.estOutputTokens).padStart(7)}`,
                        );
                    }
                }
                console.log('');
                console.log(
                    `  合计: ${totals.pages} 页 / ${totals.llmCalls} 次 LLM 调用 / ` +
                        `输入约 ${Math.round(totals.estInputTokens / 1000)}k tok / 输出约 ${Math.round(totals.estOutputTokens / 1000)}k tok`,
                );
                for (const note of notes) {
                    console.log(chalk.dim(`  注: ${note}`));
                }
                console.log('');
            } else if (event.type === 'DONE') {
                persistStage();
                currentStage = '';
                spinner.succeed('生成完成');
                console.log('');
                console.log(`  输出目录  ${chalk.cyan(event.payload.docsPath)}`);
                console.log(`  页面数    ${event.payload.pagesCount}`);
                console.log(`  耗时      ${formatElapsed()}`);
                if (warnCount > 0) {
                    console.log(`  警告      ${chalk.yellow(warnCount)} 条（见上方 warn 行）`);
                }
                console.log('');
            } else if (event.type === 'ERROR') {
                spinner.fail('生成失败');
                console.error('\n' + chalk.red('错误: ') + `[${event.code}] ` + event.message + '\n');
            }
        };

        try {
            for (const lang of languages) {
                if (!jsonStdout && languages.length > 1) {
                    if (spinner?.isSpinning) spinner.stop();
                    console.log(chalk.bold(`语言: ${lang}`));
                    currentStage = '';
                    spinner?.start();
                }
                await runPipeline({
                    workspacePath,
                    outputDir,
                    modelName: options.model,
                    concurrency: options.concurrency,
                    skipLlm: !!options.skipLlm,
                    lang,
                    strategy,
                    forceRebuild: !!options.forceRebuild,
                    dryRun: !!options.dryRun,
                    slugFilenames: !!options.slugFilenames,
                    onProgress: handleProgress,
                });
            }
        } catch (err: any) {
            // runPipeline 内部已经输出了 ERROR 事件，这里捕获只作为最终异常退出
            process.exit(1);
        }
    });
