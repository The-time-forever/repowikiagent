import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/** 与 core 的 citation-validator 相同的引用格式：file://<path>#Lstart(-Lend) */
const CITE_PATTERN = /file:\/\/([^\s)#]+)#L(\d+)(?:-L?(\d+))?/g;

export interface CitationArgs {
    citedPath: string;
    start: number;
    end: number;
}

/**
 * 把 .repowiki 下 Wiki 页面中的 grounded citation 变为可点击链接，
 * 点击后打开源文件并选中被引用的行区间。
 */
export class CitationLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
        // 仅处理 wiki 输出目录内的 Markdown
        const fsPath = document.uri.fsPath.replace(/\\/g, '/');
        if (!fsPath.includes('/.repowiki/')) return [];

        const links: vscode.DocumentLink[] = [];
        const text = document.getText();

        CITE_PATTERN.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CITE_PATTERN.exec(text)) !== null) {
            const start = parseInt(m[2], 10);
            const end = m[3] ? parseInt(m[3], 10) : start;
            const args: CitationArgs = { citedPath: m[1], start, end };

            const range = new vscode.Range(
                document.positionAt(m.index),
                document.positionAt(m.index + m[0].length),
            );
            const target = vscode.Uri.parse(
                `command:repowiki.openCitation?${encodeURIComponent(JSON.stringify(args))}`,
            );
            const link = new vscode.DocumentLink(range, target);
            link.tooltip = `跳转到源码 L${start}-L${end}`;
            links.push(link);
        }

        return links;
    }
}

/**
 * openCitation 命令：解析被引路径 → 打开文档并选中行区间。
 */
export async function openCitation(args: CitationArgs): Promise<void> {
    const uri = resolveCitedPath(args.citedPath);
    if (!uri) {
        vscode.window.showWarningMessage(`RepoWiki: 找不到被引用的文件: ${args.citedPath}`);
        return;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: true });

    const startLine = Math.max(0, args.start - 1);
    const endLine = Math.min(doc.lineCount - 1, Math.max(startLine, args.end - 1));
    const selection = new vscode.Selection(startLine, 0, endLine, doc.lineAt(endLine).text.length);
    editor.selection = selection;
    editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
}

/**
 * 解析被引路径为工作区内真实文件。
 * 引用可能是绝对路径（含项目根前缀）或相对路径；
 * 复用 core citation-validator 的思路：逐级剥离前导段做后缀匹配。
 */
function resolveCitedPath(citedPath: string): vscode.Uri | null {
    const cited = decodeURIComponent(citedPath).replace(/\\/g, '/');
    const folders = vscode.workspace.workspaceFolders ?? [];

    for (const folder of folders) {
        const root = folder.uri.fsPath;

        const candidates: string[] = [];
        // 绝对路径直接命中（含盘符或以工作区为前缀）
        if (path.isAbsolute(cited) || /^[A-Za-z]:\//.test(cited)) {
            candidates.push(cited);
        }
        // 相对路径与逐级剥离前导段的后缀
        const segments = cited.split('/').filter(Boolean);
        for (let i = 0; i < segments.length; i++) {
            candidates.push(path.join(root, ...segments.slice(i)));
        }

        for (const candidate of candidates) {
            try {
                if (fs.statSync(candidate).isFile()) {
                    return vscode.Uri.file(candidate);
                }
            } catch {
                // 不存在则尝试下一个候选
            }
        }
    }

    return null;
}
