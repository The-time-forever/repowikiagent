import * as vscode from 'vscode';
import { loadLLMConfig, saveGlobalConfig } from 'repowiki-core';

export function registerConfigureModel(
    context: vscode.ExtensionContext,
    refreshSidebar: () => void
) {
    const disposable = vscode.commands.registerCommand('repowiki.configureModel', async () => {
        // 加载当前配置
        let currentEndpoint = 'https://api.openai.com/v1';
        let currentModel = 'gpt-4o';
        let hasExistingKey = false;

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const workspacePath = workspaceFolders && workspaceFolders.length > 0
                ? workspaceFolders[0].uri.fsPath
                : undefined;

            const config = await loadLLMConfig(workspacePath);
            currentEndpoint = config.apiEndpoint;
            currentModel = config.modelName;
            hasExistingKey = !!config.apiKey;
        } catch {
            // 忽略读取错误
        }

        // 1. 输入 API Endpoint
        const apiEndpoint = await vscode.window.showInputBox({
            title: 'RepoWiki: 配置大模型 API 端点 (Endpoint)',
            value: currentEndpoint,
            placeHolder: '如 https://api.deepseek.com/v1 或 https://api.openai.com/v1',
            validateInput: (value) => {
                if (!value.trim()) return '端点地址不能为空';
                try {
                    new URL(value.trim());
                    return null;
                } catch {
                    return '请输入合法的 URL 地址';
                }
            },
        });

        if (apiEndpoint === undefined) return; // 用户取消

        // 2. 输入 Model Name
        const modelName = await vscode.window.showInputBox({
            title: 'RepoWiki: 配置大模型名称 (Model)',
            value: currentModel,
            placeHolder: '如 deepseek-chat 或 gpt-4o',
            validateInput: (value) => {
                return value.trim() ? null : '模型名称不能为空';
            },
        });

        if (modelName === undefined) return; // 用户取消

        // 3. 输入 API Key
        const apiKey = await vscode.window.showInputBox({
            title: 'RepoWiki: 配置 API 密钥 (API Key)',
            placeHolder: hasExistingKey ? '若需修改，请输入新密钥，留空则保留原配置' : '请输入 API 密钥',
            password: true,
        });

        if (apiKey === undefined) return; // 用户取消

        try {
            const savePayload: any = {
                apiEndpoint: apiEndpoint.trim(),
                modelName: modelName.trim(),
            };

            if (apiKey.trim()) {
                savePayload.apiKey = apiKey.trim();
            }

            await saveGlobalConfig(savePayload);
            vscode.window.showInformationMessage('RepoWiki: 大模型 API 配置已成功保存！');
            refreshSidebar();
        } catch (err: any) {
            vscode.window.showErrorMessage(`RepoWiki: 无法保存配置: ${err.message}`);
        }
    });

    context.subscriptions.push(disposable);
}
