import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { defaultWikiRoot, resolveWikiPaths, type WikiLang } from 'repowiki-core';

const LANGS: WikiLang[] = ['zh', 'en'];

export function registerOpenWiki(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('repowiki.openWiki', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('RepoWiki: 无法打开 Wiki，因为您未打开任何工作区。');
            return;
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const wikiRoot = defaultWikiRoot(workspacePath);

        // 收集已生成的语言树（以 Home.md 为存在判据）
        const available: Array<{ lang: WikiLang; homePath: string }> = [];
        for (const lang of LANGS) {
            const homePath = path.join(resolveWikiPaths(wikiRoot, lang).contentDir, 'Home.md');
            if (fs.existsSync(homePath)) {
                available.push({ lang, homePath });
            }
        }

        if (available.length === 0) {
            const generateAction = '立即生成';
            const choice = await vscode.window.showWarningMessage(
                'RepoWiki: 该项目尚未生成 Wiki，是否立即生成？',
                generateAction,
            );
            if (choice === generateAction) {
                vscode.commands.executeCommand('repowiki.generateWiki');
            }
            return;
        }

        // 多语言树时让用户选择
        let homePath = available[0].homePath;
        if (available.length > 1) {
            const picked = await vscode.window.showQuickPick(
                available.map((a) => ({
                    label: a.lang === 'zh' ? '中文' : 'English',
                    description: a.homePath,
                    homePath: a.homePath,
                })),
                { placeHolder: '选择要打开的 Wiki 语言' },
            );
            if (!picked) return;
            homePath = picked.homePath;
        }

        const uri = vscode.Uri.file(homePath);
        try {
            await vscode.commands.executeCommand('markdown.showPreview', uri);
        } catch {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
        }
    });

    context.subscriptions.push(disposable);
}
