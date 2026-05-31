import ignore, { type Ignore } from 'ignore';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// 默认忽略规则
// ---------------------------------------------------------------------------

/**
 * 默认忽略的目录 / 文件 glob 模式。
 * 这些模式在任何项目中都应被忽略 (构建产物、依赖、缓存等)。
 */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
    '.git/',
    'node_modules/',
    'dist/',
    'build/',
    '.next/',
    'venv/',
    '.venv/',
    '__pycache__/',
    '.pytest_cache/',
    'coverage/',
    '.cache/',
    '.DS_Store',
    '*.lock',
    '*.min.js',
    '*.map',
];

/**
 * 敏感文件强制忽略模式。
 * 为避免将密钥 / 凭据意外写入 Wiki，这些文件始终被排除。
 */
export const SENSITIVE_FILE_PATTERNS: readonly string[] = [
    '.env',
    '.env.local',
    '.env.production',
    '*.pem',
    '*.key',
    'id_rsa',
    'id_ed25519',
    'secrets.yaml',
    'credentials.json',
];

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 尝试读取项目根目录下的 `.gitignore` 文件，并返回其内容行。
 * 如果文件不存在或读取失败，返回空数组。
 */
async function loadGitignoreLines(projectRoot: string): Promise<string[]> {
    try {
        const content = await readFile(
            path.join(projectRoot, '.gitignore'),
            'utf-8',
        );
        return content
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith('#'));
    } catch {
        // .gitignore 不存在或不可读 —— 静默跳过
        return [];
    }
}

// ---------------------------------------------------------------------------
// 核心 API
// ---------------------------------------------------------------------------

/**
 * 创建一个用于判断文件路径是否应被忽略的过滤函数。
 *
 * 合并以下三类规则:
 * 1. 项目根目录下的 `.gitignore`
 * 2. {@link DEFAULT_IGNORE_PATTERNS}
 * 3. {@link SENSITIVE_FILE_PATTERNS}
 *
 * @param projectRoot - 项目根目录的绝对路径
 * @returns 一个判定函数。传入**相对路径**，返回 `true` 代表该路径应被忽略。
 *
 * @example
 * ```ts
 * const shouldIgnore = await createIgnoreFilter('/path/to/project');
 * if (shouldIgnore('node_modules/foo/index.js')) {
 *     // 跳过
 * }
 * ```
 */
export async function createIgnoreFilter(
    projectRoot: string,
): Promise<(relativePath: string) => boolean> {
    const ig: Ignore = (((ignore as any).default || ignore) as any)();

    // 1. 加载 .gitignore
    const gitignoreLines = await loadGitignoreLines(projectRoot);
    if (gitignoreLines.length > 0) {
        ig.add(gitignoreLines);
    }

    // 2. 默认忽略模式
    ig.add(DEFAULT_IGNORE_PATTERNS as string[]);

    // 3. 敏感文件模式
    ig.add(SENSITIVE_FILE_PATTERNS as string[]);

    return (relativePath: string): boolean => ig.ignores(relativePath);
}
