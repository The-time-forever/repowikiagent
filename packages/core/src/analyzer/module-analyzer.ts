/**
 * 模块聚类分析器
 * 将扫描到的文件按目录结构聚类为逻辑模块，并可选通过 LLM 生成模块描述。
 */

import * as path from 'node:path';
import type { FileNode, ModuleInfo, CoreComponent } from '../models/index.js';
import type { LLMClient } from '../llm/index.js';
import { buildModuleAnalysisPrompt } from '../llm/index.js';

// ============================================================================
// 目录 → 分类标签映射
// ============================================================================

/** 目录名关键词到分类标签的映射规则 */
const CATEGORY_RULES: Array<{ keywords: string[]; category: string }> = [
    { keywords: ['agent'], category: 'agents' },
    { keywords: ['model', 'entity', 'schema'], category: 'models' },
    { keywords: ['route', 'router', 'controller', 'endpoint'], category: 'api' },
    { keywords: ['test', '__tests__', 'spec'], category: 'tests' },
    { keywords: ['component', 'components'], category: 'components' },
    { keywords: ['view', 'views', 'page', 'pages'], category: 'views' },
    { keywords: ['hook', 'hooks'], category: 'hooks' },
    { keywords: ['util', 'utils', 'helper', 'helpers', 'lib'], category: 'utilities' },
    { keywords: ['service', 'services'], category: 'services' },
    { keywords: ['middleware', 'middlewares'], category: 'middleware' },
    { keywords: ['config', 'configuration'], category: 'config' },
    { keywords: ['store', 'stores', 'state'], category: 'state' },
    { keywords: ['workflow', 'workflows', 'pipeline'], category: 'workflows' },
    { keywords: ['migration', 'migrations'], category: 'migrations' },
    { keywords: ['static', 'public', 'assets'], category: 'assets' },
    { keywords: ['type', 'types', 'interface', 'interfaces'], category: 'types' },
    { keywords: ['llm', 'ai', 'prompt', 'prompts'], category: 'ai' },
    { keywords: ['auth', 'authentication', 'authorization'], category: 'auth' },
    { keywords: ['doc', 'docs', 'documentation'], category: 'docs' },
    { keywords: ['script', 'scripts', 'tool', 'tools'], category: 'tooling' },
];

/**
 * 根据目录路径推断分类标签
 * @param dirPath - 目录的相对路径
 * @returns 匹配的分类标签，无匹配时返回 'general'
 */
function inferCategory(dirPath: string): string {
    const normalizedPath = dirPath.replace(/\\/g, '/').toLowerCase();
    const segments = normalizedPath.split('/');

    for (const rule of CATEGORY_RULES) {
        for (const segment of segments) {
            if (rule.keywords.some((kw) => segment.includes(kw))) {
                return rule.category;
            }
        }
    }
    return 'general';
}

/**
 * 从目录路径推导模块名称
 * 取路径中最后一级有意义的目录名，如 'apps/api' → 'api'，'src/components' → 'components'
 *
 * @param dirPath - 目录的相对路径
 * @returns 模块名称
 */
function deriveModuleName(dirPath: string): string {
    const segments = dirPath
        .replace(/\\/g, '/')
        .split('/')
        .filter((s) => s.length > 0);

    // 跳过仅作命名空间的顶级目录（如 src）
    const skipSegments = new Set(['src', 'source', 'lib', 'app']);
    const meaningfulSegments = segments.filter((s) => !skipSegments.has(s.toLowerCase()));

    if (meaningfulSegments.length > 0) {
        return meaningfulSegments[meaningfulSegments.length - 1];
    }
    return segments[segments.length - 1] || 'root';
}

/**
 * 提取文件的分组键：取前两级目录路径
 * 例如 'apps/api/routers/user.py' → 'apps/api'
 *      'src/components/Header.tsx' → 'src/components'
 *      'main.py' → '.'
 *
 * @param relativePath - 文件相对路径
 * @returns 分组键
 */
function getGroupKey(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/');
    const parts = normalized.split('/');

    if (parts.length <= 1) {
        // 根目录下的文件
        return '.';
    }
    if (parts.length === 2) {
        // 只有一级目录
        return parts[0];
    }
    // 取前两级目录
    return `${parts[0]}/${parts[1]}`;
}

/**
 * 基于文件名和结构生成基本模块描述（无 LLM 时的回退逻辑）
 *
 * @param moduleName - 模块名称
 * @param directory - 目录路径
 * @param files - 文件列表
 * @param category - 分类标签
 * @returns 模块描述文本
 */
function generateBasicSummary(
    moduleName: string,
    directory: string,
    files: string[],
    category: string,
): string {
    const extCounts = new Map<string, number>();
    for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (ext) {
            extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
        }
    }

    const extSummary = Array.from(extCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([ext, count]) => `${ext}(${count})`)
        .join(', ');

    const categoryDescriptions: Record<string, string> = {
        agents: 'Agent 智能体相关逻辑',
        models: '数据模型定义',
        api: 'API 路由与控制器',
        tests: '测试代码',
        components: 'UI 组件',
        views: '视图/页面',
        hooks: 'React Hooks',
        utilities: '工具函数与辅助库',
        services: '业务服务层',
        middleware: '中间件',
        config: '配置管理',
        state: '状态管理',
        workflows: '工作流/流水线编排',
        migrations: '数据库迁移脚本',
        assets: '静态资源',
        types: '类型定义',
        ai: 'AI/LLM 集成',
        auth: '认证与授权',
        docs: '文档',
        tooling: '脚本与工具',
        general: '通用模块',
    };

    const categoryDesc = categoryDescriptions[category] || '通用模块';
    return `${moduleName} 模块位于 ${directory}，包含 ${files.length} 个文件（${extSummary}），主要负责${categoryDesc}。`;
}

/**
 * 基于文件列表推断核心组件（无 LLM 时的回退逻辑）
 *
 * @param files - 文件列表
 * @returns 推断的核心组件列表
 */
function inferCoreComponents(files: string[]): CoreComponent[] {
    const components: CoreComponent[] = [];
    const seen = new Set<string>();

    for (const filePath of files) {
        const basename = path.basename(filePath, path.extname(filePath));

        // 跳过 index 文件和常见工具文件
        if (['index', 'types', 'constants', 'utils'].includes(basename.toLowerCase())) {
            continue;
        }

        // 跳过测试文件
        if (/\.(test|spec|e2e)$/i.test(basename)) {
            continue;
        }

        if (seen.has(basename)) continue;
        seen.add(basename);

        components.push({
            name: basename,
            description: `定义于 ${filePath}`,
        });

        // 最多保留 10 个核心组件
        if (components.length >= 10) break;
    }

    return components;
}

/**
 * LLM 模块分析响应类型
 */
interface ModuleAnalysisResponse {
    summary: string;
    core_components: Array<{ name: string; description: string }>;
}

/**
 * 将文件聚类为逻辑模块并生成描述
 *
 * 将扫描到的全部文件按顶级和次级目录分组，每个分组视为一个逻辑模块。
 * 若提供 LLM 客户端，则通过 LLM 为每个模块生成专业描述；
 * 否则基于文件结构启发式推断。
 *
 * @param rootPath - 项目根目录的绝对路径
 * @param files - 扫描到的 FileNode 列表
 * @param llmClient - 可选的 LLM 客户端实例
 * @returns 分析得到的 ModuleInfo 数组
 */
export async function analyzeModules(
    rootPath: string,
    files: FileNode[],
    llmClient?: LLMClient | null,
): Promise<ModuleInfo[]> {
    // ------------------------------------------------------------------
    // 第一步：按目录分组
    // ------------------------------------------------------------------
    const groups = new Map<string, string[]>();

    for (const file of files) {
        if (file.nodeType !== 'file') continue;

        const key = getGroupKey(file.relativePath);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(file.relativePath);
    }

    // ------------------------------------------------------------------
    // 第二步：为每个分组构建 ModuleInfo
    // ------------------------------------------------------------------
    const modules: ModuleInfo[] = [];

    for (const [directory, moduleFiles] of groups) {
        const moduleName = deriveModuleName(directory);
        const category = inferCategory(directory);

        const moduleInfo: ModuleInfo = {
            moduleName,
            directory,
            files: moduleFiles.sort(),
            summary: '',
            category,
            coreComponents: [],
        };

        modules.push(moduleInfo);
    }

    // ------------------------------------------------------------------
    // 第三步：生成描述（LLM 或回退）
    // ------------------------------------------------------------------
    if (llmClient) {
        // 使用 LLM 逐模块生成描述，串行调用以避免速率限制
        for (const mod of modules) {
            try {
                const prompt = buildModuleAnalysisPrompt(mod.directory, mod.files.join('\n'), '');
                const result = await llmClient.chatJSON<ModuleAnalysisResponse>(prompt);

                if (result && typeof result.summary === 'string') {
                    mod.summary = result.summary;
                }
                if (result && Array.isArray(result.core_components)) {
                    mod.coreComponents = result.core_components.map((c) => ({
                        name: String(c.name || ''),
                        description: String(c.description || ''),
                    }));
                }
            } catch {
                // LLM 调用失败时使用回退逻辑
                mod.summary = generateBasicSummary(
                    mod.moduleName,
                    mod.directory,
                    mod.files,
                    mod.category,
                );
                mod.coreComponents = inferCoreComponents(mod.files);
            }
        }
    } else {
        // 无 LLM，使用基于结构的启发式描述
        for (const mod of modules) {
            mod.summary = generateBasicSummary(
                mod.moduleName,
                mod.directory,
                mod.files,
                mod.category,
            );
            mod.coreComponents = inferCoreComponents(mod.files);
        }
    }

    // 按目录路径排序输出
    modules.sort((a, b) => a.directory.localeCompare(b.directory));

    return modules;
}
