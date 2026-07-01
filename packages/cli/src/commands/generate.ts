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

        if (!jsonStdout) {
            console.log(chalk.bold.cyan('\n🚀 开始运行 RepoWiki 文档生成引擎...\n'));
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
                spinner.text = chalk.dim(`[${event.stage}] `) + event.message;
                // 根据阶段定制颜色或特定显示
                if (event.stage === 'Scanning') {
                    spinner.color = 'blue';
                } else if (event.stage === 'Analysis') {
                    spinner.color = 'magenta';
                } else if (event.stage === 'LLM Inference') {
                    spinner.color = 'yellow';
                } else {
                    spinner.color = 'cyan';
                }
            } else if (event.type === 'DONE') {
                spinner.succeed(chalk.green('文档生成完成！'));
                console.log('\n' + chalk.bold.green('✨ 生成结果详情:'));
                console.log(chalk.gray('  - 输出目录: ') + chalk.underline.cyan(event.payload.docsPath));
                console.log(chalk.gray('  - 生成文件数: ') + chalk.bold(event.payload.pagesCount) + ' 个\n');
            } else if (event.type === 'ERROR') {
                spinner.fail(chalk.red('文档生成失败！'));
                console.error('\n' + chalk.red(`❌ [错误码 ${event.code}] `) + event.message + '\n');
            }
        };

        try {
            for (const lang of languages) {
                await runPipeline({
                    workspacePath,
                    outputDir,
                    modelName: options.model,
                    concurrency: options.concurrency,
                    skipLlm: !!options.skipLlm,
                    lang,
                    strategy,
                    forceRebuild: !!options.forceRebuild,
                    onProgress: handleProgress,
                });
            }
        } catch (err: any) {
            if (jsonStdout) {
                // runPipeline 内部已经输出了 ERROR 事件，这里捕获只作为最终异常退出
                process.exit(1);
            }
            process.exit(1);
        }
    });
