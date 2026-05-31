/**
 * API 路由分析器
 * 通过正则表达式从源码中提取 HTTP 路由定义，支持 FastAPI、Express、NestJS 等框架。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileNode, ApiRoute } from '../models/index.js';

// ============================================================================
// 路由文件过滤
// ============================================================================

/** 路径中包含这些关键词的文件可能定义路由 */
const ROUTE_PATH_KEYWORDS = [
    'route',
    'router',
    'controller',
    'api',
    'endpoint',
    'views',
    'handlers',
];

/**
 * 判断文件是否可能包含路由定义
 * @param relativePath - 文件相对路径
 * @returns 是否为候选路由文件
 */
function isRouteCandidateFile(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
    return ROUTE_PATH_KEYWORDS.some((kw) => normalized.includes(kw));
}

// ============================================================================
// 正则模式定义
// ============================================================================

/**
 * FastAPI / Python 装饰器路由
 * 匹配 @app.get("/path") 或 @router.post("/path") 等形式
 */
const FASTAPI_ROUTE_PATTERN =
    /@(app|router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/gi;

/**
 * FastAPI 处理函数名
 * 匹配 async def function_name 或 def function_name
 */
const PYTHON_FUNC_PATTERN = /(?:async\s+)?def\s+(\w+)/;

/**
 * Express / Node.js 路由
 * 匹配 app.get("/path", ...) 或 router.post("/path", ...) 等形式
 */
const EXPRESS_ROUTE_PATTERN =
    /(?:app|router)\.(get|post|put|delete|patch|all)\(\s*['"]([^'"]+)['"]/gi;

/**
 * Express 处理函数引用
 * 匹配 , handlerName 或 , async (req 等形式
 */
const EXPRESS_HANDLER_PATTERN = /,\s*(\w+)/;

/**
 * NestJS 方法装饰器
 * 匹配 @Get(), @Post("/path"), @Put('path') 等形式
 */
const NESTJS_METHOD_PATTERN = /@(Get|Post|Put|Delete|Patch)\(\s*['"]?([^'")]*?)['"]?\s*\)/gi;

/**
 * NestJS Controller 装饰器
 * 匹配 @Controller("prefix") 等形式
 */
const NESTJS_CONTROLLER_PATTERN = /@Controller\(\s*['"]([^'"]+)['"]\s*\)/i;

/**
 * NestJS 方法名
 * 匹配装饰器下方的 async methodName( 或 methodName( 形式
 */
const NESTJS_METHOD_NAME_PATTERN = /(?:async\s+)?(\w+)\s*\(/;

// ============================================================================
// 路由提取逻辑
// ============================================================================

/**
 * 提取 FastAPI 路由
 * @param content - 文件内容
 * @param filePath - 文件相对路径
 * @returns 提取到的路由数组
 */
function extractFastAPIRoutes(content: string, filePath: string): ApiRoute[] {
    const routes: ApiRoute[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 重置正则 lastIndex
        FASTAPI_ROUTE_PATTERN.lastIndex = 0;
        const match = FASTAPI_ROUTE_PATTERN.exec(line);

        if (match) {
            const method = match[2].toUpperCase();
            const routePath = match[3];

            // 在后续行中查找处理函数名
            let handler = '';
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                const funcMatch = PYTHON_FUNC_PATTERN.exec(lines[j]);
                if (funcMatch) {
                    handler = funcMatch[1];
                    break;
                }
            }

            routes.push({
                method,
                path: routePath,
                handler,
                filePath,
                lineNumber: i + 1,
                framework: 'fastapi',
            });
        }
    }

    return routes;
}

/**
 * 提取 Express 路由
 * @param content - 文件内容
 * @param filePath - 文件相对路径
 * @returns 提取到的路由数组
 */
function extractExpressRoutes(content: string, filePath: string): ApiRoute[] {
    const routes: ApiRoute[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        EXPRESS_ROUTE_PATTERN.lastIndex = 0;
        const match = EXPRESS_ROUTE_PATTERN.exec(line);

        if (match) {
            const method = match[1].toUpperCase();
            const routePath = match[2];

            // 尝试从同一行或下一行提取 handler 名
            let handler = '';
            const handlerMatch = EXPRESS_HANDLER_PATTERN.exec(
                line.slice(match.index + match[0].length),
            );
            if (handlerMatch && handlerMatch[1] !== 'async' && handlerMatch[1] !== 'function') {
                handler = handlerMatch[1];
            } else if (i + 1 < lines.length) {
                const nextLineMatch = EXPRESS_HANDLER_PATTERN.exec(lines[i + 1]);
                if (
                    nextLineMatch &&
                    nextLineMatch[1] !== 'async' &&
                    nextLineMatch[1] !== 'function'
                ) {
                    handler = nextLineMatch[1];
                }
            }

            routes.push({
                method,
                path: routePath,
                handler,
                filePath,
                lineNumber: i + 1,
                framework: 'express',
            });
        }
    }

    return routes;
}

/**
 * 提取 NestJS 路由
 * @param content - 文件内容
 * @param filePath - 文件相对路径
 * @returns 提取到的路由数组
 */
function extractNestJSRoutes(content: string, filePath: string): ApiRoute[] {
    const routes: ApiRoute[] = [];
    const lines = content.split('\n');

    // 首先提取 Controller 前缀
    let controllerPrefix = '';
    const controllerMatch = NESTJS_CONTROLLER_PATTERN.exec(content);
    if (controllerMatch) {
        controllerPrefix = controllerMatch[1];
        // 确保前缀以 / 开头
        if (!controllerPrefix.startsWith('/')) {
            controllerPrefix = '/' + controllerPrefix;
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        NESTJS_METHOD_PATTERN.lastIndex = 0;
        const match = NESTJS_METHOD_PATTERN.exec(line);

        if (match) {
            const method = match[1].toUpperCase();
            let methodPath = match[2] || '';

            // 组合 controller 前缀与方法路径
            if (methodPath && !methodPath.startsWith('/')) {
                methodPath = '/' + methodPath;
            }
            const fullPath = controllerPrefix + methodPath || controllerPrefix || '/';

            // 查找方法名
            let handler = '';
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                const methodNameMatch = NESTJS_METHOD_NAME_PATTERN.exec(lines[j]);
                if (methodNameMatch) {
                    handler = methodNameMatch[1];
                    break;
                }
            }

            routes.push({
                method,
                path: fullPath,
                handler,
                filePath,
                lineNumber: i + 1,
                framework: 'nestjs',
            });
        }
    }

    return routes;
}

/**
 * 检测文件中使用的框架并提取路由
 * @param content - 文件内容
 * @param filePath - 文件相对路径
 * @returns 提取到的路由数组
 */
function extractRoutesFromContent(content: string, filePath: string): ApiRoute[] {
    const routes: ApiRoute[] = [];

    // 根据内容特征检测框架类型
    const hasFastAPIDecorator = /@(app|router)\.(get|post|put|delete|patch)\(/i.test(content);
    const hasExpressCall = /(?:app|router)\.(get|post|put|delete|patch)\(\s*['"]/i.test(content);
    const hasNestJSDecorator = /@(Get|Post|Put|Delete|Patch)\(/i.test(content);
    const hasControllerDecorator = /@Controller\(/i.test(content);

    // NestJS 优先级最高（因为它同时可能含有类似 Express 的模式）
    if (hasNestJSDecorator || hasControllerDecorator) {
        routes.push(...extractNestJSRoutes(content, filePath));
    }

    // 检查 FastAPI（Python 装饰器风格）
    if (hasFastAPIDecorator) {
        // 确认是 Python 文件（通过 def 关键词辅助判断）
        if (/\bdef\s+\w+/.test(content)) {
            routes.push(...extractFastAPIRoutes(content, filePath));
        }
    }

    // 检查 Express（排除已被 NestJS 检测的情况）
    if (hasExpressCall && !hasNestJSDecorator && !hasControllerDecorator) {
        routes.push(...extractExpressRoutes(content, filePath));
    }

    return routes;
}

/**
 * 分析项目中的 API 路由定义
 *
 * 从扫描到的文件列表中筛选可能包含路由定义的文件，
 * 读取其内容并应用多框架正则模式提取路由信息。
 *
 * 支持的框架：
 * - FastAPI / Python（装饰器 @app.get / @router.post 等）
 * - Express / Node.js（app.get / router.post 等）
 * - NestJS / TypeScript（@Controller + @Get/@Post 装饰器等）
 *
 * @param rootPath - 项目根目录的绝对路径
 * @param files - 扫描到的 FileNode 列表
 * @returns 排序后的 ApiRoute 数组
 */
export async function analyzeApiRoutes(
    rootPath: string,
    files: FileNode[],
): Promise<ApiRoute[]> {
    const allRoutes: ApiRoute[] = [];

    // 筛选候选文件
    const candidates = files.filter(
        (f) => f.nodeType === 'file' && isRouteCandidateFile(f.relativePath),
    );

    for (const candidate of candidates) {
        try {
            const absolutePath = path.resolve(rootPath, candidate.relativePath);
            const content = await fs.readFile(absolutePath, 'utf-8');
            const routes = extractRoutesFromContent(content, candidate.relativePath);
            allRoutes.push(...routes);
        } catch {
            // 无法读取的文件直接跳过
            continue;
        }
    }

    // 按文件路径和行号排序
    allRoutes.sort((a, b) => {
        const fileCmp = a.filePath.localeCompare(b.filePath);
        if (fileCmp !== 0) return fileCmp;
        return a.lineNumber - b.lineNumber;
    });

    return allRoutes;
}
