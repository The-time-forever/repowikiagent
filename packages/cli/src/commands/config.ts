import { Command } from 'commander';
import { loadLLMConfig, saveGlobalConfig, type LLMConfig } from 'repowiki-core';
import chalk from 'chalk';

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
    .arguments('<key> <value>')
    .description('设置全局配置（例如：endpoint, model, key）')
    .action(async (key, value) => {
        const field = normalizeKey(key);
        if (!field) {
            console.error(chalk.red(`❌ 无效的配置项: "${key}"。可选：endpoint, model, key`));
            process.exit(1);
        }

        try {
            await saveGlobalConfig({ [field]: value });
            console.log(chalk.green(`✓ 成功将全局配置 [${field}] 设置为: "${value}"`));
        } catch (err: any) {
            console.error(chalk.red('❌ 保存配置失败:'), err?.message || err);
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
                    console.error(chalk.red(`❌ 无效的配置项: "${key}"。可选：endpoint, model, key`));
                    process.exit(1);
                }

                let value = config[field];
                if (field === 'apiKey' && value) {
                    // 脱敏显示
                    value = value.slice(0, 6) + '...' + value.slice(-4);
                }
                console.log(`${field}: ${value || chalk.gray('(未设置)')}`);
            } else {
                console.log(chalk.bold('\n⚙️ 全局配置预览:'));
                console.log(`  apiEndpoint: ${config.apiEndpoint}`);
                console.log(`  modelName:   ${config.modelName}`);
                const maskedKey = config.apiKey
                    ? config.apiKey.slice(0, 6) + '...' + config.apiKey.slice(-4)
                    : chalk.gray('(未设置)');
                console.log(`  apiKey:      ${maskedKey}\n`);
            }
        } catch (err: any) {
            console.error(chalk.red('❌ 获取配置失败:'), err?.message || err);
            process.exit(1);
        }
    });
