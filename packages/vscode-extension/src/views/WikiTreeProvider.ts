import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { defaultWikiRoot, resolveWikiPaths, type RepowikiMetadata, type WikiLang } from 'repowiki-core';

/** 支持的语言树（与 core 的 WikiLang 对齐） */
const LANGS: WikiLang[] = ['zh', 'en'];

/** 树节点：语言分组 或 目录条目 */
interface WikiNode {
    kind: 'lang' | 'page';
    label: string;
    lang: WikiLang;
    /** kind=page 时的 catalog id */
    id?: string;
    /** kind=page 时的内容文件绝对路径 */
    filePath?: string;
    children: WikiNode[];
}

/**
 * Wiki 目录树：读取各语言 meta/repowiki-metadata.json 的 wiki_catalogs,
 * 按 parent_id 组树。单语言时不显示语言分组层。
 */
export class WikiTreeProvider implements vscode.TreeDataProvider<WikiNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<WikiNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private roots: WikiNode[] = [];

    refresh(): void {
        this.roots = this.buildRoots();
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(node: WikiNode): vscode.TreeItem {
        const collapsible =
            node.children.length > 0
                ? node.kind === 'lang'
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;

        const item = new vscode.TreeItem(node.label, collapsible);

        if (node.kind === 'lang') {
            item.iconPath = new vscode.ThemeIcon('globe');
            item.contextValue = 'repowiki.lang';
        } else {
            item.iconPath = new vscode.ThemeIcon(node.children.length > 0 ? 'folder-library' : 'markdown');
            item.contextValue = 'repowiki.page';
            if (node.filePath) {
                item.command = {
                    command: 'markdown.showPreview',
                    title: 'Open Wiki Page',
                    arguments: [vscode.Uri.file(node.filePath)],
                };
            }
        }

        return item;
    }

    getChildren(node?: WikiNode): WikiNode[] {
        if (!node) {
            if (this.roots.length === 0) {
                this.roots = this.buildRoots();
            }
            return this.roots;
        }
        return node.children;
    }

    /** 扫描各语言树的元数据文件，重建树 */
    private buildRoots(): WikiNode[] {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) return [];

        const langRoots: WikiNode[] = [];
        for (const folder of folders) {
            const wikiRoot = defaultWikiRoot(folder.uri.fsPath);
            for (const lang of LANGS) {
                const paths = resolveWikiPaths(wikiRoot, lang);
                const metadata = readMetadata(paths.metadataFile);
                if (!metadata) continue;

                const pages = buildCatalogTree(metadata, paths.contentDir, lang);
                if (pages.length === 0) continue;

                langRoots.push({
                    kind: 'lang',
                    label: lang === 'zh' ? '中文' : 'English',
                    lang,
                    children: pages,
                });
            }
        }

        // 只有一个语言树时省掉语言分组层
        if (langRoots.length === 1) {
            return langRoots[0].children;
        }
        return langRoots;
    }
}

function readMetadata(metadataFile: string): RepowikiMetadata | null {
    try {
        return JSON.parse(fs.readFileSync(metadataFile, 'utf-8')) as RepowikiMetadata;
    } catch {
        return null;
    }
}

/** 按 parent_id 把扁平 wiki_catalogs 组装为树（保持原有先序） */
function buildCatalogTree(metadata: RepowikiMetadata, contentDir: string, lang: WikiLang): WikiNode[] {
    const nodes = new Map<string, WikiNode>();
    const roots: WikiNode[] = [];

    for (const entry of metadata.wiki_catalogs) {
        nodes.set(entry.id, {
            kind: 'page',
            label: entry.name,
            lang,
            id: entry.id,
            filePath: path.join(contentDir, entry.filename),
            children: [],
        });
    }

    for (const entry of metadata.wiki_catalogs) {
        const node = nodes.get(entry.id)!;
        const parent = entry.parent_id ? nodes.get(entry.parent_id) : undefined;
        if (parent) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }

    return roots;
}
