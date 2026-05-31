/**
 * @module detector/tech-stack-detector
 * 技术栈探测器
 *
 * 通过分析项目中的配置文件（package.json、requirements.txt、docker-compose.yml 等）
 * 以及文件扩展名分布，自动识别项目使用的编程语言、框架、包管理器、数据库和服务。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileNode } from '../models/index.js';

// ---------------------------------------------------------------------------
// 公开接口
// ---------------------------------------------------------------------------

/** 技术栈检测结果 */
export interface TechStackResult {
    /** 检测到的编程语言列表 */
    languages: string[];
    /** 检测到的框架列表 */
    frameworks: string[];
    /** 检测到的包管理器列表 */
    packageManagers: string[];
    /** 检测到的数据库列表 */
    databases: string[];
    /** 检测到的服务/中间件列表 */
    services: string[];
    /** 参与检测的配置文件列表 */
    configFiles: string[];
}

// ---------------------------------------------------------------------------
// 匹配规则
// ---------------------------------------------------------------------------

/** Node.js 依赖名 → 框架显示名 */
const NODE_FRAMEWORK_MAP: Record<string, string> = {
    next: 'Next.js',
    react: 'React',
    vue: 'Vue.js',
    '@angular/core': 'Angular',
    vite: 'Vite',
    express: 'Express',
    '@nestjs/core': 'NestJS',
    fastify: 'Fastify',
};

/** Python 包名关键字 → 框架显示名 */
const PYTHON_FRAMEWORK_MAP: Record<string, string> = {
    fastapi: 'FastAPI',
    django: 'Django',
    flask: 'Flask',
    langchain: 'LangChain',
    langgraph: 'LangGraph',
};

/** docker-compose 服务镜像/名称关键字 → 数据库/服务显示名 */
const DOCKER_SERVICE_MAP: Record<string, { name: string; kind: 'database' | 'service' }> = {
    postgres: { name: 'PostgreSQL', kind: 'database' },
    mysql: { name: 'MySQL', kind: 'database' },
    redis: { name: 'Redis', kind: 'database' },
    mongo: { name: 'MongoDB', kind: 'database' },
    minio: { name: 'MinIO', kind: 'service' },
    rabbitmq: { name: 'RabbitMQ', kind: 'service' },
    elasticsearch: { name: 'Elasticsearch', kind: 'service' },
};

/** 锁文件 → 包管理器名称 */
const LOCKFILE_MAP: Record<string, string> = {
    'package-lock.json': 'npm',
    'yarn.lock': 'yarn',
    'pnpm-lock.yaml': 'pnpm',
};

/** 文件扩展名 → 语言名称（用于统计文件数量） */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.py': 'Python',
    '.rs': 'Rust',
    '.go': 'Go',
    '.java': 'Java',
    '.kt': 'Kotlin',
    '.swift': 'Swift',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.cs': 'C#',
    '.cpp': 'C++',
    '.c': 'C',
    '.dart': 'Dart',
    '.scala': 'Scala',
    '.lua': 'Lua',
    '.zig': 'Zig',
};

/** 需要达到的最低文件数量阈值，才会报告该语言 */
const LANGUAGE_FILE_THRESHOLD = 5;

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
 * 在文件节点列表中查找指定相对路径的文件是否存在。
 * @param files 文件节点列表
 * @param relativePath 待查找的相对路径
 */
function hasFile(files: FileNode[], relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    return files.some(
        (f) => f.nodeType === 'file' && f.relativePath.replace(/\\/g, '/') === normalized,
    );
}

/**
 * 在文件节点列表中查找指定相对路径前缀的目录是否存在。
 * @param files 文件节点列表
 * @param dirPrefix 待查找的目录前缀（如 "agents/"）
 */
function hasDirectory(files: FileNode[], dirPrefix: string): boolean {
    const normalized = dirPrefix.replace(/\\/g, '/');
    return files.some((f) => {
        const rel = f.relativePath.replace(/\\/g, '/');
        return rel === normalized.replace(/\/$/, '') || rel.startsWith(normalized);
    });
}

/**
 * 对结果数组进行去重。
 */
function unique(arr: string[]): string[] {
    return [...new Set(arr)];
}

// ---------------------------------------------------------------------------
// 检测子流程
// ---------------------------------------------------------------------------

/**
 * 从 package.json 中检测 Node.js 框架和包管理器。
 */
async function detectFromPackageJson(
    rootPath: string,
    files: FileNode[],
    result: TechStackResult,
): Promise<void> {
    const content = await safeReadFile(path.join(rootPath, 'package.json'));
    if (!content) return;

    result.configFiles.push('package.json');

    let pkg: Record<string, unknown>;
    try {
        pkg = JSON.parse(content) as Record<string, unknown>;
    } catch {
        return;
    }

    // 合并 dependencies 和 devDependencies
    const deps: Record<string, unknown> = {
        ...((pkg.dependencies as Record<string, unknown>) ?? {}),
        ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
    };

    for (const [depName, frameworkName] of Object.entries(NODE_FRAMEWORK_MAP)) {
        if (depName in deps) {
            result.frameworks.push(frameworkName);
        }
    }

    // 检测包管理器（通过锁文件）
    for (const [lockFile, managerName] of Object.entries(LOCKFILE_MAP)) {
        if (hasFile(files, lockFile)) {
            result.packageManagers.push(managerName);
        }
    }
}

/**
 * 从 requirements.txt 中检测 Python 框架。
 */
async function detectFromRequirementsTxt(
    rootPath: string,
    result: TechStackResult,
): Promise<void> {
    const content = await safeReadFile(path.join(rootPath, 'requirements.txt'));
    if (!content) return;

    result.configFiles.push('requirements.txt');
    const lower = content.toLowerCase();

    for (const [keyword, frameworkName] of Object.entries(PYTHON_FRAMEWORK_MAP)) {
        if (lower.includes(keyword)) {
            result.frameworks.push(frameworkName);
        }
    }
}

/**
 * 从 pyproject.toml 中检测 Python 框架。
 */
async function detectFromPyprojectToml(
    rootPath: string,
    result: TechStackResult,
): Promise<void> {
    const content = await safeReadFile(path.join(rootPath, 'pyproject.toml'));
    if (!content) return;

    result.configFiles.push('pyproject.toml');
    const lower = content.toLowerCase();

    for (const [keyword, frameworkName] of Object.entries(PYTHON_FRAMEWORK_MAP)) {
        if (lower.includes(keyword)) {
            result.frameworks.push(frameworkName);
        }
    }
}

/**
 * 从 docker-compose 配置中检测数据库和服务。
 * 同时检测 docker-compose.yml 和 docker-compose.yaml 两种命名。
 */
async function detectFromDockerCompose(
    rootPath: string,
    result: TechStackResult,
): Promise<void> {
    const candidates = ['docker-compose.yml', 'docker-compose.yaml'];

    for (const fileName of candidates) {
        const content = await safeReadFile(path.join(rootPath, fileName));
        if (!content) continue;

        result.configFiles.push(fileName);
        const lower = content.toLowerCase();

        for (const [keyword, info] of Object.entries(DOCKER_SERVICE_MAP)) {
            if (lower.includes(keyword)) {
                if (info.kind === 'database') {
                    result.databases.push(info.name);
                } else {
                    result.services.push(info.name);
                }
            }
        }
    }
}

/**
 * 通过 Cargo.toml / go.mod 检测 Rust / Go 语言。
 */
async function detectFromLanguageManifests(
    rootPath: string,
    result: TechStackResult,
): Promise<void> {
    const cargoContent = await safeReadFile(path.join(rootPath, 'Cargo.toml'));
    if (cargoContent) {
        result.languages.push('Rust');
        result.configFiles.push('Cargo.toml');
    }

    const goModContent = await safeReadFile(path.join(rootPath, 'go.mod'));
    if (goModContent) {
        result.languages.push('Go');
        result.configFiles.push('go.mod');
    }
}

/**
 * 根据文件扩展名分布统计语言，仅报告文件数超过阈值的语言。
 */
function detectLanguagesFromExtensions(files: FileNode[], result: TechStackResult): void {
    const counts = new Map<string, number>();

    for (const file of files) {
        if (file.nodeType !== 'file') continue;
        const ext = path.extname(file.relativePath).toLowerCase();
        const lang = EXTENSION_LANGUAGE_MAP[ext];
        if (lang) {
            counts.set(lang, (counts.get(lang) ?? 0) + 1);
        }
    }

    for (const [lang, count] of counts) {
        if (count >= LANGUAGE_FILE_THRESHOLD) {
            result.languages.push(lang);
        }
    }
}

/**
 * 根据目录结构模式检测架构特征（Agent 架构、Workflow 编排等）。
 */
function detectDirectoryPatterns(files: FileNode[], result: TechStackResult): void {
    // Agent 架构：app/agents 或 agents/
    if (hasDirectory(files, 'app/agents/') || hasDirectory(files, 'agents/')) {
        result.frameworks.push('Agent Architecture');
    }

    // Workflow 编排：workflows/
    if (hasDirectory(files, 'workflows/')) {
        result.frameworks.push('Workflow Orchestration');
    }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 检测项目技术栈。
 *
 * 通过读取配置文件内容和分析文件扩展名分布，自动识别项目使用的
 * 编程语言、框架、包管理器、数据库和服务。
 *
 * @param rootPath 项目根目录的绝对路径
 * @param files    FileScanner 输出的文件节点列表
 * @returns 技术栈检测结果
 *
 * @example
 * ```ts
 * const result = await detectTechStack('/path/to/project', files);
 * console.log(result.frameworks); // ['Next.js', 'FastAPI']
 * ```
 */
export async function detectTechStack(
    rootPath: string,
    files: FileNode[],
): Promise<TechStackResult> {
    const result: TechStackResult = {
        languages: [],
        frameworks: [],
        packageManagers: [],
        databases: [],
        services: [],
        configFiles: [],
    };

    // 并行执行所有检测子流程
    await Promise.all([
        detectFromPackageJson(rootPath, files, result),
        detectFromRequirementsTxt(rootPath, result),
        detectFromPyprojectToml(rootPath, result),
        detectFromDockerCompose(rootPath, result),
        detectFromLanguageManifests(rootPath, result),
    ]);

    // 基于文件扩展名统计语言（同步操作）
    detectLanguagesFromExtensions(files, result);

    // 目录模式检测（同步操作）
    detectDirectoryPatterns(files, result);

    // 去重
    result.languages = unique(result.languages);
    result.frameworks = unique(result.frameworks);
    result.packageManagers = unique(result.packageManagers);
    result.databases = unique(result.databases);
    result.services = unique(result.services);
    result.configFiles = unique(result.configFiles);

    return result;
}
