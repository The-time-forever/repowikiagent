import { Command } from 'commander';
import { loadLLMConfig, saveGlobalConfig } from 'repowiki-core';
import chalk from 'chalk';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const loginCommand = new Command('login')
    .description('交互式配置大语言模型（LLM）API 鉴权凭证')
    .action(async () => {
        console.log(chalk.bold.cyan('\n🗝️  RepoWiki 鉴权登录向导\n'));

        const rl = readline.createInterface({ input, output });

        try {
            const currentConfig = await loadLLMConfig();

            // 1. 获取 API Endpoint
            const endpointPrompt = `请输入 API 端点地址 ${chalk.gray(`[默认: ${currentConfig.apiEndpoint || 'https://api.openai.com/v1'}]: `)}`;
            const endpointInput = await rl.question(endpointPrompt);
            const apiEndpoint = endpointInput.trim() || currentConfig.apiEndpoint || 'https://api.openai.com/v1';

            // 2. 获取 Model Name
            const modelPrompt = `请输入默认模型名称 ${chalk.gray(`[默认: ${currentConfig.modelName || 'gpt-4o'}]: `)}`;
            const modelInput = await rl.question(modelPrompt);
            const modelName = modelInput.trim() || currentConfig.modelName || 'gpt-4o';

            // 3. 获取 API Key
            const hasExistingKey = !!currentConfig.apiKey;
            const keyPromptStr = hasExistingKey
                ? `请输入 API 密钥 (API Key) ${chalk.gray(`[留空保留已有密钥: ${currentConfig.apiKey.slice(0, 6)}...${currentConfig.apiKey.slice(-4)}]: `)}`
                : '请输入 API 密钥 (API Key): ';
            const keyInput = await rl.question(keyPromptStr);
            let apiKey = keyInput.trim();

            if (!apiKey && hasExistingKey) {
                apiKey = currentConfig.apiKey;
            }

            if (!apiKey) {
                console.error(chalk.red('\n❌ 错误: API 密钥不能为空。'));
                rl.close();
                process.exit(1);
            }

            // 保存配置
            await saveGlobalConfig({
                apiEndpoint,
                modelName,
                apiKey,
            });

            console.log(chalk.green('\n✓ 凭证保存成功！配置文件路径: ~/.repowiki/config.json\n'));
        } catch (err: any) {
            console.error(chalk.red('\n❌ 配置失败:'), err?.message || err);
            process.exit(1);
        } finally {
            rl.close();
        }
    });
