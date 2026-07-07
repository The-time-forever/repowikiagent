import * as vscode from 'vscode';
import * as fs from 'fs';
import {
    loadLLMConfig,
    validateConfig,
    LLMClient,
    loadWikiIndex,
    retrieve,
    answerQuestion,
    defaultWikiRoot,
    resolveWikiPaths,
    type ChatMessage,
    type WikiIndexEntry,
    type WikiLang,
} from 'repowiki-core';

/** history 中保留的最大 Q/A 轮数（与 CLI chat 对齐） */
const MAX_HISTORY_TURNS = 8;

/** 与 CitationLinkProvider 相同的引用格式 */
const CITE_PATTERN = /file:\/\/([^\s)#`]+)#L(\d+)(?:-L?(\d+))?/g;

/**
 * 侧边栏问答面板：复用 core 的 qa 模块（loadWikiIndex / retrieve / answerQuestion），
 * 回答中的 file://...#L 引用可点击跳转源码行。
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'repowiki.chatView';

    private view?: vscode.WebviewView;
    private history: ChatMessage[] = [];
    private indexCache: { lang: WikiLang; entries: WikiIndexEntry[] } | null = null;

    /** 元数据变化（重新生成/增量更新）后由 extension.ts 调用 */
    public invalidateIndex(): void {
        this.indexCache = null;
    }

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
        webviewView.webview.html = this.renderHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'ask':
                    await this.handleAsk(String(msg.text ?? '').trim());
                    break;
                case 'clear':
                    this.history = [];
                    break;
                case 'openCitation':
                    vscode.commands.executeCommand('repowiki.openCitation', msg.args);
                    break;
                case 'generateWiki':
                    vscode.commands.executeCommand('repowiki.generateWiki');
                    break;
                case 'configureModel':
                    vscode.commands.executeCommand('repowiki.configureModel');
                    break;
            }
        });
    }

    // ────────────────────────────────────────────────────────────
    // 问答处理
    // ────────────────────────────────────────────────────────────

    private post(message: unknown): void {
        this.view?.webview.postMessage(message);
    }

    private async handleAsk(question: string): Promise<void> {
        if (!question) return;

        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            this.post({ type: 'error', text: '未打开工作区。' });
            return;
        }
        const workspacePath = folders[0].uri.fsPath;

        // LLM 配置
        const config = await loadLLMConfig(workspacePath);
        if (validateConfig(config).length > 0) {
            this.post({ type: 'error', text: '问答需要 LLM 配置。', action: 'configureModel' });
            return;
        }

        // Wiki 索引（缓存，元数据变化时失效）
        if (!this.indexCache) {
            const lang = detectLang(workspacePath);
            if (!lang) {
                this.post({ type: 'error', text: '该项目还没有生成 Wiki。', action: 'generateWiki' });
                return;
            }
            try {
                this.indexCache = { lang, entries: await loadWikiIndex(workspacePath, lang) };
            } catch (err: any) {
                this.post({ type: 'error', text: String(err?.message || err) });
                return;
            }
        }

        const { lang, entries } = this.indexCache;
        const pages = retrieve(entries, question, 3);
        if (pages.length === 0) {
            this.post({ type: 'error', text: '未在 Wiki 中检索到相关页面，请换个问法。' });
            return;
        }

        this.post({ type: 'thinking' });
        try {
            const llmClient = new LLMClient({ config });
            const answer = await answerQuestion(llmClient, pages, question, lang, this.history);

            this.history.push({ role: 'user', content: question });
            this.history.push({ role: 'assistant', content: answer.content });
            while (this.history.length > MAX_HISTORY_TURNS * 2) this.history.shift();

            this.post({
                type: 'answer',
                html: renderAnswerHtml(answer.content),
                sources: answer.sources,
            });
        } catch (err: any) {
            this.post({ type: 'error', text: `回答失败: ${err?.message || err}` });
        }
    }

    // ────────────────────────────────────────────────────────────
    // Webview HTML
    // ────────────────────────────────────────────────────────────

    private renderHtml(webview: vscode.Webview): string {
        const nonce = makeNonce();
        const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 8px 60px; font-size: 13px; }
    .msg { margin: 8px 0; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
    .q { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
    .a { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, transparent); }
    .a code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; }
    .a a.cite { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; }
    .sources { font-size: 11px; opacity: .7; margin-top: 6px; }
    .err { color: var(--vscode-errorForeground); }
    .thinking { opacity: .6; font-style: italic; }
    .actionbtn { margin-top: 6px; padding: 3px 10px; cursor: pointer; border: none; border-radius: 3px;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    #inputbar { position: fixed; bottom: 0; left: 0; right: 0; display: flex; gap: 6px; padding: 8px;
        background: var(--vscode-sideBar-background); border-top: 1px solid var(--vscode-widget-border, transparent); }
    #q { flex: 1; padding: 5px 8px; border-radius: 3px; border: 1px solid var(--vscode-input-border, transparent);
        background: var(--vscode-input-background); color: var(--vscode-input-foreground); outline: none; }
    #send { padding: 5px 12px; cursor: pointer; border: none; border-radius: 3px;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .hint { opacity: .6; margin-top: 12px; }
</style>
</head>
<body>
    <div id="log"><div class="hint">对已生成的 Wiki 提问，回答会给出页面来源与可点击的源码行引用。</div></div>
    <div id="inputbar">
        <input id="q" type="text" placeholder="输入问题，回车发送" />
        <button id="send">发送</button>
    </div>
<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const log = document.getElementById('log');
    const input = document.getElementById('q');
    let thinkingEl = null;

    function el(cls, text) {
        const d = document.createElement('div');
        d.className = 'msg ' + cls;
        if (text !== undefined) d.textContent = text;
        log.appendChild(d);
        d.scrollIntoView();
        return d;
    }

    function send() {
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        el('q', text);
        vscode.postMessage({ type: 'ask', text });
    }
    document.getElementById('send').addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }

        if (msg.type === 'thinking') {
            thinkingEl = el('a thinking', '思考中...');
        } else if (msg.type === 'answer') {
            const d = el('a');
            d.innerHTML = msg.html;
            if (msg.sources && msg.sources.length) {
                const s = document.createElement('div');
                s.className = 'sources';
                s.textContent = '来源: ' + msg.sources.join('、');
                d.appendChild(s);
            }
            d.querySelectorAll('a.cite').forEach((a) => {
                a.addEventListener('click', () => {
                    vscode.postMessage({ type: 'openCitation', args: JSON.parse(a.dataset.args) });
                });
            });
            d.scrollIntoView(false);
        } else if (msg.type === 'error') {
            const d = el('a err', msg.text);
            if (msg.action) {
                const btn = document.createElement('button');
                btn.className = 'actionbtn';
                btn.textContent = msg.action === 'generateWiki' ? '生成 Wiki' : '配置模型';
                btn.addEventListener('click', () => vscode.postMessage({ type: msg.action }));
                d.appendChild(document.createElement('br'));
                d.appendChild(btn);
            }
        }
    });
</script>
</body>
</html>`;
    }
}

// ────────────────────────────────────────────────────────────────
// 辅助
// ────────────────────────────────────────────────────────────────

/** 按 zh → en 顺序探测已生成的语言树；都没有返回 null */
function detectLang(workspacePath: string): WikiLang | null {
    for (const lang of ['zh', 'en'] as WikiLang[]) {
        const p = resolveWikiPaths(defaultWikiRoot(workspacePath), lang).metadataFile;
        if (fs.existsSync(p)) return lang;
    }
    return null;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 把回答文本渲染为受限 HTML：转义全部内容，仅将 file://...#L 引用替换为
 * 可点击链接（data-args 携带 openCitation 参数），行内代码围栏转 <code>。
 */
export function renderAnswerHtml(content: string): string {
    let html = escapeHtml(content);

    CITE_PATTERN.lastIndex = 0;
    html = html.replace(
        new RegExp(CITE_PATTERN.source, 'g'),
        (match, citedPath: string, start: string, end?: string) => {
            const args = {
                citedPath,
                start: parseInt(start, 10),
                end: end ? parseInt(end, 10) : parseInt(start, 10),
            };
            return `<a class="cite" data-args="${escapeHtml(JSON.stringify(args))}">${match}</a>`;
        },
    );

    // 行内代码：`code` → <code>
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    return html;
}

function makeNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}
