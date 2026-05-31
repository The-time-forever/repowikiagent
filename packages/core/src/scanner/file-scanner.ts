import fg from 'fast-glob';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { FileNode } from '../models/file-reference.js';
import { createIgnoreFilter } from './ignore-rules.js';

// ---------------------------------------------------------------------------
// 语言映射表
// ---------------------------------------------------------------------------

/**
 * 文件扩展名 → 语言标识的映射。
 * 键为小写扩展名 (不含前导点)。
 */
const LANGUAGE_MAP: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    rb: 'ruby',
    css: 'css',
    html: 'html',
    md: 'markdown',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    prisma: 'prisma',
    vue: 'vue',
    svelte: 'svelte',
};

/**
 * 根据文件扩展名推断编程语言。
 *
 * @param filePath - 文件路径 (仅使用扩展名部分)
 * @returns 语言标识字符串，无法识别时返回 `undefined`
 */
function detectLanguage(filePath: string): string | undefined {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return LANGUAGE_MAP[ext];
}

// ---------------------------------------------------------------------------
// 行数统计
// ---------------------------------------------------------------------------

/**
 * 统计文件中非空行数。
 * 对大于 2 MB 的文件跳过行数统计以避免内存压力。
 */
async function countNonEmptyLines(
    filePath: string,
    sizeBytes: number,
): Promise<number | undefined> {
    // 跳过过大的文件
    const MAX_SIZE_FOR_LINE_COUNT = 2 * 1024 * 1024; // 2 MB
    if (sizeBytes > MAX_SIZE_FOR_LINE_COUNT) {
        return undefined;
    }

    try {
        const content = await readFile(filePath, 'utf-8');
        return content.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
    } catch {
        // 二进制文件或无法读取 —— 静默跳过
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Scanner 配置
// ---------------------------------------------------------------------------

/**
 * 文件扫描器配置项。
 */
export interface ScannerConfig {
    /** 最大递归深度 (默认 5) */
    maxDepth: number;
    /** 额外忽略模式 (glob) */
    ignorePatterns: string[];
    /** 仅包含指定扩展名 (不含前导点)。为空时包含所有文件 */
    includeExtensions: string[];
}

/** 默认配置 */
const DEFAULT_CONFIG: ScannerConfig = {
    maxDepth: 5,
    ignorePatterns: [],
    includeExtensions: [],
};

// ---------------------------------------------------------------------------
// 核心扫描函数
// ---------------------------------------------------------------------------

/**
 * 递归扫描项目目录，返回扁平的 {@link FileNode} 列表。
 *
 * @param rootPath  - 项目根目录的绝对路径
 * @param config    - 可选配置，覆盖默认值
 * @returns 排序后的 FileNode 列表 (按相对路径字母序)
 *
 * @example
 * ```ts
 * const files = await scanDirectory('/path/to/project');
 * console.log(files.length);
 * ```
 */
export async function scanDirectory(
    rootPath: string,
    config?: Partial<ScannerConfig>,
): Promise<FileNode[]> {
    const cfg: ScannerConfig = { ...DEFAULT_CONFIG, ...config };

    // 将 rootPath 规范化为 posix 风格以兼容 fast-glob
    const normalizedRoot = rootPath.replace(/\\/g, '/');

    // 构建忽略过滤器
    const shouldIgnore = await createIgnoreFilter(rootPath);

    // 构建 glob 模式
    const pattern = `${normalizedRoot}/**/*`;

    // fast-glob 选项
    const entries = await fg(pattern, {
        dot: false,
        onlyFiles: true,
        deep: cfg.maxDepth,
        ignore: cfg.ignorePatterns,
        absolute: true,
        stats: false,
    });

    const nodes: FileNode[] = [];

    for (const absPath of entries) {
        // 计算相对路径 (posix 风格)
        const relativePath = path
            .relative(rootPath, absPath)
            .replace(/\\/g, '/');

        // 应用 ignore 过滤器
        if (shouldIgnore(relativePath)) {
            continue;
        }

        // 扩展名过滤
        if (cfg.includeExtensions.length > 0) {
            const ext = path.extname(absPath).slice(1).toLowerCase();
            if (!cfg.includeExtensions.includes(ext)) {
                continue;
            }
        }

        // 获取文件信息
        let fileStat;
        try {
            fileStat = await stat(absPath);
        } catch {
            // 文件在扫描期间被删除等异常情况 —— 静默跳过
            continue;
        }

        const sizeBytes = fileStat.size;
        const language = detectLanguage(absPath);
        const lineCount = language
            ? await countNonEmptyLines(absPath, sizeBytes)
            : undefined;

        nodes.push({
            path: absPath,
            relativePath,
            nodeType: 'file',
            sizeBytes,
            language,
            lineCount,
        });
    }

    // 按相对路径排序
    nodes.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    return nodes;
}
