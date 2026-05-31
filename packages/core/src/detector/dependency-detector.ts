/**
 * @module detector/dependency-detector
 * 依赖关系探测器
 *
 * 通过正则表达式解析源文件中的 import / require 语句，
 * 构建项目内部模块间的依赖图以及外部包引用列表。
 *
 * 为避免性能问题，仅处理前 500 个源文件。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileNode } from '../models/index.js';

// ---------------------------------------------------------------------------
// 公开接口
// ---------------------------------------------------------------------------

/** 依赖边，表示一个文件对另一个模块的引用 */
export interface DependencyEdge {
    /** 源文件的相对路径 */
    source: string;
    /** 引用目标的相对路径（内部模块）或包名（外部依赖） */
    target: string;
    /** 是否为外部依赖 */
    isExternal: boolean;
}

/** 完整的依赖关系图 */
export interface DependencyGraph {
    /** 所有依赖边 */
    edges: DependencyEdge[];
    /** 参与图中的内部模块路径列表 */
    internalModules: string[];
    /** 引用到的外部包名列表 */
    externalPackages: string[];
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 源文件最大处理数量，超过后截断以保障性能 */
const MAX_SOURCE_FILES = 500;

/** 待分析的源文件扩展名集合 */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py']);

// ---------------------------------------------------------------------------
// 正则表达式
// ---------------------------------------------------------------------------

/**
 * TypeScript / JavaScript 导入语句匹配模式。
 *
 * 覆盖的语法形式：
 * - `import ... from 'module'`
 * - `import 'module'`（副作用导入）
 * - `require('module')`
 * - `import('module')`（动态导入）
 */
const TS_IMPORT_PATTERNS: RegExp[] = [
    // import ... from 'module'  或  import 'module'
    /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    // require('module')
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    // import('module')  — 动态导入
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * Python 导入语句匹配模式。
 *
 * 覆盖的语法形式：
 * - `import module`
 * - `from module import ...`
 */
const PY_IMPORT_PATTERNS: RegExp[] = [
    /^import\s+(\S+)/gm,
    /^from\s+(\S+)\s+import/gm,
];

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 安全读取文件内容，文件不存在或读取失败时返回 null。
 */
async function safeReadFile(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch {
        return null;
    }
}

/**
 * 规范化路径分隔符为 POSIX 风格。
 */
function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * 判断导入路径是否为内部模块引用。
 *
 * 内部模块的导入路径以 `.` 或 `/` 开头。
 * Python 的相对导入也以 `.` 开头。
 *
 * @param importPath 导入路径字符串
 */
function isInternalImport(importPath: string): boolean {
    return importPath.startsWith('.') || importPath.startsWith('/');
}

/**
 * 从导入路径中提取顶层外部包名。
 *
 * 例如：
 * - `@nestjs/core` → `@nestjs/core`（scoped 包保留前两级）
 * - `express/lib/router` → `express`
 * - `lodash` → `lodash`
 *
 * @param importPath 导入路径
 */
function extractPackageName(importPath: string): string {
    if (importPath.startsWith('@')) {
        // scoped package: @scope/name
        const parts = importPath.split('/');
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : importPath;
    }
    return importPath.split('/')[0];
}

/**
 * 从 Python 导入路径中提取顶层包名。
 *
 * 例如：
 * - `fastapi.middleware.cors` → `fastapi`
 * - `app.main` → `app`
 *
 * @param importPath Python 模块路径
 */
function extractPythonPackageName(importPath: string): string {
    return importPath.split('.')[0];
}

/**
 * 判断 Python 导入是否为内部模块。
 *
 * 以 `.` 开头的是显式相对导入；其余通过检查是否为项目内文件来判断。
 *
 * @param importPath Python 导入路径
 * @param internalTopDirs 项目中存在的顶层目录名集合
 */
function isPythonInternalImport(importPath: string, internalTopDirs: Set<string>): boolean {
    if (importPath.startsWith('.')) return true;
    const topLevel = extractPythonPackageName(importPath);
    return internalTopDirs.has(topLevel);
}

/**
 * 尝试将内部导入路径解析为实际文件的相对路径。
 *
 * 对于 TS/JS 模块，依次尝试：
 * 1. 直接路径
 * 2. 追加 .ts / .tsx / .js / .jsx
 * 3. 追加 /index.ts 等
 *
 * @param sourceFile 导入语句所在的源文件路径
 * @param importPath 导入路径
 * @param fileSet    项目中所有文件的相对路径集合
 */
function resolveInternalPath(
    sourceFile: string,
    importPath: string,
    fileSet: Set<string>,
): string | null {
    const sourceDir = path.posix.dirname(sourceFile);
    const resolved = path.posix.normalize(path.posix.join(sourceDir, importPath));

    // 直接匹配
    if (fileSet.has(resolved)) return resolved;

    // 尝试常见扩展名
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    for (const ext of extensions) {
        const withExt = resolved + ext;
        if (fileSet.has(withExt)) return withExt;
    }

    // 尝试 index 文件
    for (const ext of extensions) {
        const indexPath = path.posix.join(resolved, `index${ext}`);
        if (fileSet.has(indexPath)) return indexPath;
    }

    // 无法解析时返回规范化后的路径
    return resolved;
}

/**
 * 尝试将 Python 内部导入解析为文件路径。
 *
 * @param importPath Python 导入路径（点号分隔）
 * @param fileSet    项目中所有文件的相对路径集合
 */
function resolvePythonInternalPath(
    importPath: string,
    fileSet: Set<string>,
): string | null {
    // 跳过以 . 开头的相对导入（需要源文件位置才能解析，暂简化处理）
    if (importPath.startsWith('.')) return null;

    const asFilePath = importPath.replace(/\./g, '/');

    // 尝试直接 .py 文件
    const pyPath = asFilePath + '.py';
    if (fileSet.has(pyPath)) return pyPath;

    // 尝试 __init__.py
    const initPath = path.posix.join(asFilePath, '__init__.py');
    if (fileSet.has(initPath)) return initPath;

    return asFilePath + '.py';
}

// ---------------------------------------------------------------------------
// 提取器
// ---------------------------------------------------------------------------

/**
 * 从 TypeScript/JavaScript 源文件中提取所有导入路径。
 *
 * @param content 文件内容
 * @returns 导入路径列表
 */
function extractTsImports(content: string): string[] {
    const imports: string[] = [];
    for (const pattern of TS_IMPORT_PATTERNS) {
        // 重置 lastIndex，因为使用了 g 标志
        const regex = new RegExp(pattern.source, pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
            imports.push(match[1]);
        }
    }
    return imports;
}

/**
 * 从 Python 源文件中提取所有导入路径。
 *
 * @param content 文件内容
 * @returns 导入路径列表
 */
function extractPyImports(content: string): string[] {
    const imports: string[] = [];
    for (const pattern of PY_IMPORT_PATTERNS) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
            imports.push(match[1]);
        }
    }
    return imports;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 构建项目依赖关系图。
 *
 * 扫描源文件（.ts, .tsx, .js, .jsx, .py）中的 import/require 语句，
 * 将导入分类为内部模块引用和外部包引用，尝试解析内部导入的实际文件路径，
 * 并汇总为完整的依赖图。
 *
 * 为避免性能问题，最多处理前 {@link MAX_SOURCE_FILES} 个源文件。
 *
 * @param rootPath 项目根目录的绝对路径
 * @param files    FileScanner 输出的文件节点列表
 * @returns 完整的依赖关系图
 *
 * @example
 * ```ts
 * const graph = await buildDependencyGraph('/path/to/project', files);
 * console.log(graph.externalPackages); // ['react', 'express', ...]
 * console.log(graph.edges.length);      // 依赖边数量
 * ```
 */
export async function buildDependencyGraph(
    rootPath: string,
    files: FileNode[],
): Promise<DependencyGraph> {
    const edges: DependencyEdge[] = [];
    const internalModulesSet = new Set<string>();
    const externalPackagesSet = new Set<string>();

    // 构建文件路径集合用于内部模块解析
    const fileSet = new Set<string>(
        files
            .filter((f) => f.nodeType === 'file')
            .map((f) => normalizePath(f.relativePath)),
    );

    // 收集项目顶层目录名，用于 Python 内部导入判断
    const internalTopDirs = new Set<string>();
    for (const f of files) {
        const rel = normalizePath(f.relativePath);
        const topDir = rel.split('/')[0];
        if (topDir) {
            internalTopDirs.add(topDir);
        }
    }

    // 筛选源文件，限制处理数量
    const sourceFiles = files
        .filter((f) => {
            if (f.nodeType !== 'file') return false;
            const ext = path.extname(f.relativePath).toLowerCase();
            return SOURCE_EXTENSIONS.has(ext);
        })
        .slice(0, MAX_SOURCE_FILES);

    // 并行读取所有源文件内容
    const readResults = await Promise.all(
        sourceFiles.map(async (f) => {
            const absolutePath = path.join(rootPath, f.relativePath);
            const content = await safeReadFile(absolutePath);
            return { file: f, content };
        }),
    );

    // 逐文件解析导入语句
    for (const { file, content } of readResults) {
        if (!content) continue;

        const relativePath = normalizePath(file.relativePath);
        const ext = path.extname(relativePath).toLowerCase();
        const isPython = ext === '.py';

        // 提取导入路径
        const importPaths = isPython
            ? extractPyImports(content)
            : extractTsImports(content);

        for (const importPath of importPaths) {
            if (isPython) {
                // Python 导入处理
                const isInternal = isPythonInternalImport(importPath, internalTopDirs);

                if (isInternal) {
                    const resolved = resolvePythonInternalPath(importPath, fileSet);
                    const target = resolved ?? importPath.replace(/\./g, '/') + '.py';
                    edges.push({ source: relativePath, target, isExternal: false });
                    internalModulesSet.add(relativePath);
                    internalModulesSet.add(target);
                } else {
                    const pkgName = extractPythonPackageName(importPath);
                    edges.push({ source: relativePath, target: pkgName, isExternal: true });
                    externalPackagesSet.add(pkgName);
                    internalModulesSet.add(relativePath);
                }
            } else {
                // TypeScript / JavaScript 导入处理
                if (isInternalImport(importPath)) {
                    const resolved = resolveInternalPath(relativePath, importPath, fileSet);
                    const target = resolved ?? importPath;
                    edges.push({ source: relativePath, target, isExternal: false });
                    internalModulesSet.add(relativePath);
                    internalModulesSet.add(target);
                } else {
                    const pkgName = extractPackageName(importPath);
                    edges.push({ source: relativePath, target: pkgName, isExternal: true });
                    externalPackagesSet.add(pkgName);
                    internalModulesSet.add(relativePath);
                }
            }
        }
    }

    return {
        edges,
        internalModules: [...internalModulesSet].sort(),
        externalPackages: [...externalPackagesSet].sort(),
    };
}
