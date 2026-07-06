import { Command } from 'commander';
import { loadLLMConfig, saveGlobalConfig, type LLMConfig } from 'repowiki-core';
import chalk from 'chalk';
import { maskKey, promptSecret } from '../util/prompt.js';

export const configCommand = new Command('config')
    .description('管理全局 LLM API 鉴权配置');

// 配置键名映射转换
function normalizeKey(key: string): keyof LLMConfig | null {
    const k = key.toLowerCase();
    if (k === 'endpoint' || k === 'apiendpoint') return 'apiEndpoint';
    if (k === 'model' || k === 'modelname') return 'modelName';
    if (k === 'key' || k === 'apikey') return 'apiKey';
    return null;
}

configCommand
    .command('set')
    .arguments('<key> [value]')
    .description('设置全局配置（endpoint, model, key）。key 可不带值交互输入，或传 - 从 stdin 读取')
    .action(async (key, value) => {
        const field = normalizeKey(key);
        if (!field) {
            console.error(chalk.red(`错误: 无效的配置项 "${key}"。可选：endpoint, model, key`));
            process.exit(1);
        }

        let resolved: string | undefined = value;

        if (field === 'apiKey') {
            // 避免密钥经命令行参数落入 shell 历史：无值时交互掩码输入，- 表示从 stdin 读取
            if (resolved === undefined) {
                resolved = await promptSecret('请输入 API 密钥 (输入不回显): ');
            } else if (resolved === '-') {
                resolved = await promptSecret('');
            }
            if (!resolved || !resolved.trim()) {
                console.error(chalk.red('错误: API 密钥不能为空。'));
                process.exit(1);
            }
            resolved = resolved.trim();
        } else if (resolved === undefined) {
            console.error(chalk.red(`错误: 配置项 [${field}] 需要提供值。`));
            process.exit(1);
        }

        try {
            await saveGlobalConfig({ [field]: resolved });
            // 密钥仅脱敏回显，避免留在终端 scrollback
            const shown = field === 'apiKey' ? maskKey(resolved!) : `"${resolved}"`;
            console.log(chalk.green(`已将全局配置 [${field}] 设置为: ${shown}`));
        } catch (err: any) {
            console.error(chalk.red('错误: 保存配置失败:'), err?.message || err);
            process.exit(1);
        }
    });

configCommand
    .command('get')
    .arguments('[key]')
    .description('查看全局配置')
    .action(async (key) => {
        try {
            const config = await loadLLMConfig();

            if (key) {
                const field = normalizeKey(key);
                if (!field) {
                    console.error(chalk.red(`错误: 无效的配置项 "${key}"。可选：endpoint, model, key`));
                    process.exit(1);
                }

                let value = config[field];
                if (field === 'apiKey' && value) {
                    value = maskKey(value);
                }
                console.log(`${field}: ${value || chalk.gray('(未设置)')}`);
            } else {
                console.log(chalk.bold('\n全局配置预览:'));
                console.log(`  apiEndpoint: ${config.apiEndpoint}`);
                console.log(`  modelName:   ${config.modelName}`);
                const maskedKey = config.apiKey ? maskKey(config.apiKey) : chalk.gray('(未设置)');
                console.log(`  apiKey:      ${maskedKey}\n`);
            }
        } catch (err: any) {
            console.error(chalk.red('错误: 获取配置失败:'), err?.message || err);
            process.exit(1);
        }
    });
