/**
 * @module detector/entrypoint-detector
 * 入口文件探测器
 *
 * 通过启发式规则（常见入口文件名、package.json scripts、Dockerfile CMD/ENTRYPOINT）
 * 自动定位项目可能的启动入口。这些信息对后续的调用图分析至关重要。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileNode } from '../models/index.js';

// ---------------------------------------------------------------------------
// 常见入口文件路径（按优先级排列）
// ---------------------------------------------------------------------------

const COMMON_ENTRYPOINTS: string[] = [
    // Python 入口
    'main.py',
    'app/main.py',
    'apps/api/app/main.py',
    // TypeScript / JavaScript 入口
    'src/main.ts',
    'src/index.ts',
    'src/app.ts',
    // React 入口
    'src/App.tsx',
    'src/App.jsx',
    // Next.js / Pages 路由入口
    'app/page.tsx',
    'pages/index.tsx',
    'app/layout.tsx',
    // 静态站点入口
    'index.html',
];

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 安全读取文件内容，文件不存在时返回 null。
 * @param filePath 要读取的文件绝对路径
 */
async function safeReadFile(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch {
        return null;
    }
}

/**
 * 规范化路径分隔符为 POSIX 风格的正斜杠。
 * @param p 待规范化的路径
 */
function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * 检查文件节点列表中是否包含指定相对路径的文件。
 * @param files 文件节点列表
 * @param relativePath 相对路径
 */
function fileExists(files: FileNode[], relativePath: string): boolean {
    const normalized = normalizePath(relativePath);
    return files.some(
        (f) => f.nodeType === 'file' && normalizePath(f.relativePath) === normalized,
    );
}

/**
 * 从 npm script 命令字符串中提取可能的文件路径。
 *
 * 支持的模式：
 * - `node dist/main.js`
 * - `ts-node src/index.ts`
 * - `tsx src/main.ts`
 * - `python app/main.py`
 * - `uvicorn app.main:app` → `app/main.py`
 * - `next dev` → 无文件路径，跳过
 *
 * @param script 脚本命令字符串
 * @returns 提取到的文件路径列表
 */
function extractPathsFromScript(script: string): string[] {
    const paths: string[] = [];

    // 匹配显式文件路径参数：node/ts-node/tsx/python 后跟文件路径
    const explicitFilePattern = /(?:node|ts-node|tsx|python|python3)\s+([\w./-]+\.\w+)/gi;
    let match: RegExpExecArray | null;
    while ((match = explicitFilePattern.exec(script)) !== null) {
        paths.push(match[1]);
    }

    // 匹配 uvicorn 风格的模块路径：uvicorn app.main:app
    const uvicornPattern = /uvicorn\s+([\w.]+):/gi;
    while ((match = uvicornPattern.exec(script)) !== null) {
        // 将点号分隔的模块路径转换为文件路径
        const modulePath = match[1].replace(/\./g, '/') + '.py';
        paths.push(modulePath);
    }

    return paths;
}

// ---------------------------------------------------------------------------
// 检测子流程
// ---------------------------------------------------------------------------

/**
 * 检查常见入口文件名是否存在于文件列表中。
 */
function detectCommonEntrypoints(files: FileNode[]): string[] {
    const found: string[] = [];
    for (const entry of COMMON_ENTRYPOINTS) {
        if (fileExists(files, entry)) {
            found.push(entry);
        }
    }
    return found;
}

/**
 * 从 package.json 的 scripts 字段提取入口文件路径。
 * 仅解析 start、dev、serve 三个常见启动脚本。
 */
async function detectFromPackageJsonScripts(rootPath: string): Promise<string[]> {
    const content = await safeReadFile(path.join(rootPath, 'package.json'));
    if (!content) return [];

    let pkg: Record<string, unknown>;
    try {
        pkg = JSON.parse(content) as Record<string, unknown>;
    } catch {
        return [];
    }

    const scripts = pkg.scripts as Record<string, string> | undefined;
    if (!scripts || typeof scripts !== 'object') return [];

    const targetScripts = ['start', 'dev', 'serve'];
    const paths: string[] = [];

    for (const scriptName of targetScripts) {
        const scriptValue = scripts[scriptName];
        if (typeof scriptValue === 'string') {
            paths.push(...extractPathsFromScript(scriptValue));
        }
    }

    return paths;
}

/**
 * 从 Dockerfile 中提取 CMD 和 ENTRYPOINT 指定的文件路径。
 *
 * 支持的格式：
 * - `CMD ["node", "dist/main.js"]`（exec 格式）
 * - `CMD node dist/main.js`（shell 格式）
 * - `ENTRYPOINT ["python", "main.py"]`
 */
async function detectFromDockerfile(rootPath: string): Promise<string[]> {
    const content = await safeReadFile(path.join(rootPath, 'Dockerfile'));
    if (!content) return [];

    const paths: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();

        // 跳过注释行
        if (trimmed.startsWith('#')) continue;

        // 匹配 CMD 和 ENTRYPOINT 指令
        const instructionMatch = /^(?:CMD|ENTRYPOINT)\s+(.+)$/i.exec(trimmed);
        if (!instructionMatch) continue;

        const args = instructionMatch[1].trim();

        // exec 格式：CMD ["executable", "arg1", ...]
        if (args.startsWith('[')) {
            try {
                const parsed = JSON.parse(args) as string[];
                // 查找类似文件路径的参数（包含扩展名）
                for (const arg of parsed) {
                    if (/\.\w+$/.test(arg) && !arg.startsWith('-')) {
                        paths.push(arg);
                    }
                }
            } catch {
                // JSON 解析失败则忽略
            }
        } else {
            // shell 格式：CMD node dist/main.js
            const tokens = args.split(/\s+/);
            for (const token of tokens) {
                if (/\.\w+$/.test(token) && !token.startsWith('-')) {
                    paths.push(token);
                }
            }
        }
    }

    return paths;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 检测项目入口文件。
 *
 * 按照以下优先级顺序查找：
 * 1. 常见入口文件名
 * 2. package.json scripts 字段
 * 3. Dockerfile CMD/ENTRYPOINT
 *
 * 返回有序的入口文件相对路径列表（已去重）。
 *
 * @param rootPath 项目根目录的绝对路径
 * @param files    FileScanner 输出的文件节点列表
 * @returns 入口文件的相对路径列表
 *
 * @example
 * ```ts
 * const entrypoints = await detectEntrypoints('/path/to/project', files);
 * // ['src/main.ts', 'app/page.tsx']
 * ```
 */
export async function detectEntrypoints(
    rootPath: string,
    files: FileNode[],
): Promise<string[]> {
    const result: string[] = [];
    const seen = new Set<string>();

    /**
     * 向结果中添加路径，自动去重并规范化。
     */
    function addPath(p: string): void {
        const normalized = normalizePath(p);
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }

    // 1. 常见入口文件
    for (const entry of detectCommonEntrypoints(files)) {
        addPath(entry);
    }

    // 2. package.json scripts
    const scriptPaths = await detectFromPackageJsonScripts(rootPath);
    for (const p of scriptPaths) {
        addPath(p);
    }

    // 3. Dockerfile CMD/ENTRYPOINT
    const dockerPaths = await detectFromDockerfile(rootPath);
    for (const p of dockerPaths) {
        addPath(p);
    }

    return result;
}
