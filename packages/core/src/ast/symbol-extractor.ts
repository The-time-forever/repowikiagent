/**
 * @module symbol-extractor
 * @description 基于 tree-sitter（@vscode/tree-sitter-wasm，纯 WASM 无原生编译）
 * 提取源文件的顶层符号（函数/类/接口等）及其行号区间。
 *
 * 设计要点：
 * - 懒加载单例：首次调用才初始化运行时与语法；任何失败都降级为返回 []，
 *   不影响主管线（无 WASM 环境照常生成，只是没有符号大纲）。
 * - 运行时定位链：REPOWIKI_TS_WASM_DIR 环境变量（打包后的 VS Code 插件用）
 *   → node_modules 内的 @vscode/tree-sitter-wasm 包。
 */

import * as path from 'node:path';
import { createRequire } from 'node:module';

/** 单个顶层符号 */
export interface SymbolInfo {
    name: string;
    /** function | class | interface | enum | type | const | struct | trait | method */
    kind: string;
    /** 1-based 起止行（与编辑器行号一致） */
    startLine: number;
    endLine: number;
    exported: boolean;
}

// ────────────────────────────────────────────────────────────────
// 语言配置
// ────────────────────────────────────────────────────────────────

interface LangConfig {
    wasm: string;
    /** 声明节点类型 → 符号 kind */
    decl: Record<string, string>;
    /** 需要"拆包"继续下探一层的包装节点（如 export_statement） */
    wrappers: string[];
    /** 判定导出/公开的启发式 */
    isExported: (nodeType: string, name: string, wrapped: boolean, headText: string) => boolean;
}

const TS_DECL: Record<string, string> = {
    function_declaration: 'function',
    class_declaration: 'class',
    abstract_class_declaration: 'class',
    interface_declaration: 'interface',
    enum_declaration: 'enum',
    type_alias_declaration: 'type',
    lexical_declaration: 'const',
    variable_declaration: 'const',
};

const tsLike = (wasm: string): LangConfig => ({
    wasm,
    decl: TS_DECL,
    wrappers: ['export_statement'],
    isExported: (_t, _n, wrapped) => wrapped,
});

/** 扫描器语言标识 → 语言配置 */
const LANG_CONFIGS: Record<string, LangConfig> = {
    typescript: tsLike('tree-sitter-typescript.wasm'),
    typescriptreact: tsLike('tree-sitter-tsx.wasm'),
    javascript: tsLike('tree-sitter-javascript.wasm'),
    javascriptreact: tsLike('tree-sitter-javascript.wasm'),
    python: {
        wasm: 'tree-sitter-python.wasm',
        decl: { function_definition: 'function', class_definition: 'class' },
        wrappers: ['decorated_definition'],
        isExported: (_t, name) => !name.startsWith('_'),
    },
    go: {
        wasm: 'tree-sitter-go.wasm',
        decl: {
            function_declaration: 'function',
            method_declaration: 'method',
            type_declaration: 'type',
        },
        wrappers: [],
        isExported: (_t, name) => /^[A-Z]/.test(name),
    },
    java: {
        wasm: 'tree-sitter-java.wasm',
        decl: {
            class_declaration: 'class',
            interface_declaration: 'interface',
            enum_declaration: 'enum',
            record_declaration: 'class',
        },
        wrappers: [],
        isExported: (_t, _n, _w, head) => head.includes('public'),
    },
    rust: {
        wasm: 'tree-sitter-rust.wasm',
        decl: {
            function_item: 'function',
            struct_item: 'struct',
            enum_item: 'enum',
            trait_item: 'trait',
            mod_item: 'module',
            type_item: 'type',
        },
        wrappers: [],
        isExported: (_t, _n, _w, head) => head.startsWith('pub'),
    },
    ruby: {
        wasm: 'tree-sitter-ruby.wasm',
        decl: { method: 'method', class: 'class', module: 'module' },
        wrappers: [],
        isExported: () => true,
    },
};

// ────────────────────────────────────────────────────────────────
// 运行时懒加载
// ────────────────────────────────────────────────────────────────

/**
 * 兼容两种宿主的 require：ESM 下用 createRequire；被 esbuild 打包为 CJS 后
 * import.meta 不可用，直接用宿主 require。任何失败返回 null（触发降级）。
 */
let cachedRequire: NodeRequire | null = null;
function getRequireFn(): NodeRequire | null {
    if (cachedRequire) return cachedRequire;
    try {
        if (typeof require === 'function') {
            cachedRequire = require;
            return cachedRequire;
        }
    } catch {
        // 继续尝试 ESM 路径
    }
    try {
        cachedRequire = createRequire(import.meta.url);
        return cachedRequire;
    } catch {
        return null;
    }
}

interface TsRuntime {
    Parser: any;
    Language: any;
    wasmDir: string;
}

let runtimePromise: Promise<TsRuntime | null> | null = null;
const languageCache = new Map<string, Promise<any | null>>();
const parserCache = new Map<string, any>();

/** 定位 wasm 目录：环境变量优先（打包后的插件），其次 node_modules 包 */
function locateWasmDir(): string | null {
    const envDir = process.env['REPOWIKI_TS_WASM_DIR'];
    if (envDir) return envDir;
    try {
        const req = getRequireFn();
        if (!req) return null;
        const pkgJson = req.resolve('@vscode/tree-sitter-wasm/package.json');
        return path.join(path.dirname(pkgJson), 'wasm');
    } catch {
        return null;
    }
}

async function getRuntime(): Promise<TsRuntime | null> {
    if (!runtimePromise) {
        runtimePromise = (async () => {
            try {
                const wasmDir = locateWasmDir();
                const req = getRequireFn();
                if (!wasmDir || !req) return null;
                // 从 wasm 目录加载运行时 JS（动态路径，避免被打包器内联）
                const mod = req(path.join(wasmDir, 'tree-sitter.js'));
                const Parser = mod.Parser ?? mod.default?.Parser;
                const Language = mod.Language ?? mod.default?.Language;
                if (!Parser || !Language) return null;
                await Parser.init({
                    locateFile: (file: string) => path.join(wasmDir, file),
                });
                return { Parser, Language, wasmDir };
            } catch {
                return null;
            }
        })();
    }
    return runtimePromise;
}

async function getLanguage(langId: string): Promise<any | null> {
    const config = LANG_CONFIGS[langId];
    if (!config) return null;

    let cached = languageCache.get(config.wasm);
    if (!cached) {
        cached = (async () => {
            const rt = await getRuntime();
            if (!rt) return null;
            try {
                return await rt.Language.load(path.join(rt.wasmDir, config.wasm));
            } catch {
                return null;
            }
        })();
        languageCache.set(config.wasm, cached);
    }
    return cached;
}

// ────────────────────────────────────────────────────────────────
// 提取
// ────────────────────────────────────────────────────────────────

/** 从声明节点解析符号名（优先 name 字段，其次向下找标识符） */
function resolveName(node: any): string | null {
    const nameNode = node.childForFieldName?.('name');
    if (nameNode) return nameNode.text;

    // lexical/variable_declaration → variable_declarator.name
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        if (child.type === 'variable_declarator' || child.type === 'type_spec') {
            const n = child.childForFieldName?.('name');
            if (n) return n.text;
        }
    }
    return null;
}

/**
 * 提取源文件顶层符号。语法不支持、运行时不可用或解析失败时返回 []。
 *
 * @param content - 源文件内容
 * @param langId  - 扫描器语言标识（如 'typescript'、'python'）
 * @param maxSymbols - 最多返回的符号数（默认 30）
 */
export async function extractSymbols(
    content: string,
    langId: string,
    maxSymbols = 30,
): Promise<SymbolInfo[]> {
    const config = LANG_CONFIGS[langId];
    if (!config) return [];

    const rt = await getRuntime();
    const language = await getLanguage(langId);
    if (!rt || !language) return [];

    try {
        let parser = parserCache.get(config.wasm);
        if (!parser) {
            parser = new rt.Parser();
            parserCache.set(config.wasm, parser);
        }
        parser.setLanguage(language);

        const tree = parser.parse(content);
        if (!tree) return [];

        const symbols: SymbolInfo[] = [];
        const visit = (node: any, wrapped: boolean) => {
            if (symbols.length >= maxSymbols) return;

            if (config.wrappers.includes(node.type)) {
                for (let i = 0; i < node.namedChildCount; i++) {
                    const child = node.namedChild(i);
                    if (child) visit(child, true);
                }
                return;
            }

            const kind = config.decl[node.type];
            if (!kind) return;
            const name = resolveName(node);
            if (!name) return;

            const headText = content
                .slice(node.startIndex, Math.min(node.startIndex + 40, node.endIndex))
                .trim();
            symbols.push({
                name,
                kind,
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                exported: config.isExported(node.type, name, wrapped, headText),
            });
        };

        const root = tree.rootNode;
        for (let i = 0; i < root.namedChildCount; i++) {
            const child = root.namedChild(i);
            if (child) visit(child, false);
        }
        tree.delete?.();

        return symbols;
    } catch {
        return [];
    }
}

/** 文件扩展名 → 受支持的语言标识（与 scanner 的语言标识一致） */
const EXT_TO_LANG: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    go: 'go',
    java: 'java',
    rs: 'rust',
    rb: 'ruby',
};

/** 由文件路径推断 AST 支持的语言标识；不支持返回 null */
export function languageIdForFile(filePath: string): string | null {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return EXT_TO_LANG[ext] ?? null;
}

/**
 * 将符号列表渲染为紧凑的单行大纲（供 grounding 头部与提示词使用）。
 * 例：`selectNodeFiles (function, L45-68) · WikiGenerator (class, L70-300)`
 */
export function renderSymbolOutline(symbols: SymbolInfo[], maxItems = 15): string {
    return symbols
        .slice(0, maxItems)
        .map((s) => `${s.name} (${s.kind}, L${s.startLine}-${s.endLine})`)
        .join(' · ');
}
