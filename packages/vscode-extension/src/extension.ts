import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { WikiTreeProvider } from './views/WikiTreeProvider.js';
import { ChatViewProvider } from './views/ChatViewProvider.js';
import { CitationLinkProvider, openCitation } from './providers/CitationLinkProvider.js';
import { registerGenerateWiki } from './commands/generateWiki.js';
import { registerOpenWiki } from './commands/openWiki.js';
import { registerConfigureModel } from './commands/configureModel.js';

export function activate(context: vscode.ExtensionContext) {
    // tree-sitter WASM 目录（构建时拷贝进 dist/ts-wasm）；缺失时 core 自动降级为无符号大纲
    const wasmDir = path.join(context.extensionPath, 'dist', 'ts-wasm');
    if (fs.existsSync(wasmDir)) {
        process.env['REPOWIKI_TS_WASM_DIR'] = wasmDir;
    }

    const output = vscode.window.createOutputChannel('RepoWiki');
    context.subscriptions.push(output);

    // 侧边栏：Wiki 目录树
    const treeProvider = new WikiTreeProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('repowiki.wikiTree', treeProvider),
    );

    // 侧边栏：问答面板
    const chatProvider = new ChatViewProvider();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider),
    );

    const refreshSidebar = () => {
        treeProvider.refresh();
        chatProvider.invalidateIndex();
    };

    // 命令
    registerGenerateWiki(context, refreshSidebar, output);
    registerOpenWiki(context);
    registerConfigureModel(context, refreshSidebar);
    context.subscriptions.push(
        vscode.commands.registerCommand('repowiki.refreshSidebar', refreshSidebar),
        vscode.commands.registerCommand('repowiki.openCitation', openCitation),
    );

    // grounded citation 链接：wiki 页面内 file://...#L 引用可点击跳转源码行
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider(
            { language: 'markdown', scheme: 'file' },
            new CitationLinkProvider(),
        ),
    );

    // 元数据变化（生成/增量更新）时自动刷新目录树
    const watcher = vscode.workspace.createFileSystemWatcher('**/.repowiki/*/meta/repowiki-metadata.json');
    watcher.onDidCreate(refreshSidebar);
    watcher.onDidChange(refreshSidebar);
    watcher.onDidDelete(refreshSidebar);
    context.subscriptions.push(watcher);

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(refreshSidebar),
    );

    // 首次启动的数据说明（如实描述：会上传被引用的源码片段）
    const hasPrompted = context.globalState.get('repowiki.hasPromptedPrivacy');
    if (!hasPrompted) {
        vscode.window.showInformationMessage(
            'RepoWiki 数据说明: 扫描与静态分析全部在本地执行；使用大模型生成时，会向所配置的 API 端点上传项目结构、模块摘要及被引用的源码片段。可用免大模型模式完全离线生成。',
            '知道了',
        ).then(() => {
            context.globalState.update('repowiki.hasPromptedPrivacy', true);
        });
    }
}

export function deactivate() {}
