import { Command } from 'commander';
import {
    findProviderByEndpoint,
    loadLLMConfig,
    PROVIDER_PRESETS,
    saveGlobalConfig,
} from 'repowiki-core';
import chalk from 'chalk';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { maskKey, promptSecret } from '../util/prompt.js';

export const loginCommand = new Command('login')
    .description('交互式配置大语言模型（LLM）API 鉴权凭证')
    .action(async () => {
        console.log(chalk.bold.cyan('\nRepoWiki 鉴权登录向导\n'));

        const rl = readline.createInterface({ input, output });

        try {
            const currentConfig = await loadLLMConfig();
            const currentPreset = currentConfig.apiEndpoint
                ? findProviderByEndpoint(currentConfig.apiEndpoint)
                : null;

            // 1. 选择 API 提供商（预设自动填 endpoint/模型；末项自定义）
            const customIndex = PROVIDER_PRESETS.length + 1;
            console.log(chalk.bold('选择 API 提供商:'));
            PROVIDER_PRESETS.forEach((p, i) => {
                const currentMark = currentPreset?.id === p.id ? chalk.green(' (当前)') : '';
                console.log(
                    `  ${String(i + 1).padStart(2)}. ${p.name}${currentMark}  ${chalk.gray(p.endpoint)}`,
                );
            });
            const customMark = currentConfig.apiEndpoint && !currentPreset ? chalk.green(' (当前)') : '';
            console.log(
                `  ${String(customIndex).padStart(2)}. 自定义${customMark}  ${chalk.gray('手动输入 OpenAI 兼容端点')}`,
            );

            // 回车默认：当前配置命中的预设 > 自定义（已有自定义端点时）> OpenAI
            const defaultIndex = currentPreset
                ? PROVIDER_PRESETS.indexOf(currentPreset) + 1
                : currentConfig.apiEndpoint
                  ? customIndex
                  : 1;
            const choiceInput = await rl.question(
                `请输入序号 ${chalk.gray(`[1-${customIndex}, 默认 ${defaultIndex}]: `)}`,
            );
            const choice = parseInt(choiceInput.trim(), 10);
            const index = Number.isInteger(choice) && choice >= 1 && choice <= customIndex ? choice : defaultIndex;
            const preset = index === customIndex ? null : PROVIDER_PRESETS[index - 1];

            // 2. API Endpoint：预设直接采用；自定义手动输入
            let apiEndpoint: string;
            if (preset) {
                apiEndpoint = preset.endpoint;
                console.log(`API 端点: ${chalk.cyan(apiEndpoint)}`);
            } else {
                const endpointDefault = currentConfig.apiEndpoint || 'https://api.openai.com/v1';
                const endpointInput = await rl.question(
                    `请输入 API 端点地址 ${chalk.gray(`[默认: ${endpointDefault}]: `)}`,
                );
                apiEndpoint = endpointInput.trim() || endpointDefault;
            }

            // 3. 模型名：同提供商时沿用当前模型，否则用预设默认
            const modelDefault =
                (preset && currentPreset?.id === preset.id && currentConfig.modelName) ||
                preset?.defaultModel ||
                currentConfig.modelName ||
                'gpt-4o';
            const modelInput = await rl.question(
                `请输入默认模型名称 ${chalk.gray(`[默认: ${modelDefault}]: `)}`,
            );
            const modelName = modelInput.trim() || modelDefault;

            // 4. API Key（掩码输入，不回显明文）
            // readline 会与 promptSecret 的 raw mode 抢占 stdin，先关闭
            rl.close();

            if (preset?.keyUrl) {
                console.log(chalk.gray(`获取密钥: ${preset.keyUrl}`));
            }
            const hasExistingKey = !!currentConfig.apiKey;
            const keyPromptStr = hasExistingKey
                ? `请输入 API 密钥 (API Key) ${chalk.gray(`[留空保留已有密钥: ${maskKey(currentConfig.apiKey)}]: `)}`
                : '请输入 API 密钥 (API Key): ';
            const keyInput = await promptSecret(keyPromptStr);
            let apiKey = keyInput.trim();

            if (!apiKey && hasExistingKey) {
                apiKey = currentConfig.apiKey;
            }

            if (!apiKey) {
                console.error(chalk.red('\n错误: API 密钥不能为空。'));
                process.exit(1);
            }

            // 保存配置
            await saveGlobalConfig({
                apiEndpoint,
                modelName,
                apiKey,
            });

            console.log(chalk.green('\n凭证保存成功。配置文件路径: ~/.repowiki/config.json\n'));
        } catch (err: any) {
            console.error(chalk.red('\n错误: 配置失败:'), err?.message || err);
            rl.close();
            process.exit(1);
        }
    });
