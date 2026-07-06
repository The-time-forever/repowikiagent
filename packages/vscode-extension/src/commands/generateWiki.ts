import * as vscode from 'vscode';
import { runPipeline, type WikiLang } from 'repowiki-core';

export function registerGenerateWiki(
    context: vscode.ExtensionContext,
    refreshSidebar: () => void,
    output: vscode.OutputChannel,
) {
    const disposable = vscode.commands.registerCommand('repowiki.generateWiki', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('RepoWiki: 无法运行，因为您未在 VS Code 中打开任何工作区。');
            return;
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;

        // 1. 生成模式
        const modeSelection = await vscode.window.showQuickPick(
            [
                { label: '使用大模型分析（推荐）', description: '使用配置的大模型服务进行语义分析与图表生成', skipLlm: false },
                { label: '免大模型快速构建', description: '不依赖网络，仅基于本地静态分析与模板组装', skipLlm: true },
            ],
            { placeHolder: '选择文档生成模式' },
        );
        if (!modeSelection) return;

        // 2. 文档语言
        const langSelection = await vscode.window.showQuickPick(
            [
                { label: '中文', langs: ['zh'] as WikiLang[] },
                { label: 'English', langs: ['en'] as WikiLang[] },
                { label: '中文 + English', langs: ['zh', 'en'] as WikiLang[] },
            ],
            { placeHolder: '选择文档语言' },
        );
        if (!langSelection) return;

        // 3. 增量 or 全量
        const rebuildSelection = await vscode.window.showQuickPick(
            [
                { label: '增量更新', description: '已有元数据时只重生成受源码变更影响的页面', forceRebuild: false },
                { label: '强制全量重建', description: '忽略已有元数据，重新规划并生成全部页面', forceRebuild: true },
            ],
            { placeHolder: '选择更新方式' },
        );
        if (!rebuildSelection) return;

        let warnCount = 0;
        output.appendLine(`[${new Date().toLocaleTimeString()}] 开始生成 Wiki (${langSelection.langs.join(', ')})`);

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'RepoWiki: 正在构建代码知识库...',
                cancellable: false,
            },
            async (progress) => {
                try {
                    for (const lang of langSelection.langs) {
                        let lastPercent = 0;
                        await runPipeline({
                            workspacePath,
                            skipLlm: modeSelection.skipLlm,
                            lang,
                            forceRebuild: rebuildSelection.forceRebuild,
                            onProgress: (event) => {
                                if (event.type === 'PROGRESS') {
                                    const increment = event.progress - lastPercent;
                                    lastPercent = event.progress;
                                    progress.report({
                                        increment: increment > 0 ? increment : 0,
                                        message: `[${event.stage}] ${event.message}`,
                                    });
                                    output.appendLine(`[${event.stage}] ${event.message}`);
                                } else if (event.type === 'WARN') {
                                    warnCount += 1;
                                    output.appendLine(`warn: [${event.stage}] ${event.message}`);
                                }
                            },
                        });
                    }

                    refreshSidebar();

                    if (warnCount > 0) {
                        const viewOutput = '查看输出';
                        const choice = await vscode.window.showWarningMessage(
                            `RepoWiki: Wiki 已生成，但有 ${warnCount} 条警告（部分页面可能降级或引用未通过校验）。`,
                            viewOutput,
                        );
                        if (choice === viewOutput) output.show();
                        return;
                    }

                    const previewAction = '预览 Wiki 目录';
                    const choice = await vscode.window.showInformationMessage(
                        'RepoWiki: 成功生成代码库 Wiki 知识库。',
                        previewAction,
                    );
                    if (choice === previewAction) {
                        vscode.commands.executeCommand('repowiki.openWiki');
                    }
                } catch (err: any) {
                    output.appendLine(`error: ${err?.message || err}`);
                    const viewOutput = '查看输出';
                    const choice = await vscode.window.showErrorMessage(
                        `RepoWiki 运行出错: ${err?.message || err}`,
                        viewOutput,
                    );
                    if (choice === viewOutput) output.show();
                }
            },
        );
    });

    context.subscriptions.push(disposable);
}
