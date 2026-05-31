import { type ModuleInfo, type ApiRoute, type DatabaseModel } from '../models/index.js';

/**
 * Mermaid 图表生成器
 * 将分析结果转换为 Mermaid 格式的架构图、ER 图和流程图
 */

/**
 * 生成项目整体架构的 Mermaid flowchart
 */
export function generateArchitectureDiagram(
    modules: ModuleInfo[],
    dependencies: Array<Record<string, unknown>>
): string {
    const lines: string[] = ['flowchart LR'];

    // 按类别对模块分组
    const groups = groupModulesByCategory(modules);

    for (const [category, mods] of Object.entries(groups)) {
        const subgraphId = sanitizeMermaidId(category);
        lines.push(`    subgraph ${subgraphId}["${getCategoryLabel(category)}"]`);

        for (const mod of mods) {
            const nodeId = sanitizeMermaidId(mod.moduleName);
            const label = mod.moduleName;
            lines.push(`        ${nodeId}["${label}"]`);
        }

        lines.push('    end');
    }

    // 添加依赖关系边
    const addedEdges = new Set<string>();
    for (const dep of dependencies) {
        const source = dep['source'] as string | undefined;
        const target = dep['target'] as string | undefined;
        if (!source || !target) continue;

        const sourceModule = findModuleForFile(source, modules);
        const targetModule = findModuleForFile(target, modules);
        if (!sourceModule || !targetModule || sourceModule === targetModule) continue;

        const edgeKey = `${sourceModule}-->${targetModule}`;
        if (addedEdges.has(edgeKey)) continue;
        addedEdges.add(edgeKey);

        const srcId = sanitizeMermaidId(sourceModule);
        const tgtId = sanitizeMermaidId(targetModule);
        lines.push(`    ${srcId} --> ${tgtId}`);
    }

    return lines.join('\n');
}

/**
 * 生成数据库 ER 图的 Mermaid 代码
 */
export function generateERDiagram(models: DatabaseModel[]): string {
    if (models.length === 0) return '';

    const lines: string[] = ['erDiagram'];

    for (const model of models) {
        lines.push(`    ${sanitizeMermaidId(model.name)} {`);
        for (const field of model.fields) {
            const type = sanitizeMermaidType(field.type);
            const nullable = field.nullable ? 'nullable' : 'required';
            lines.push(`        ${type} ${field.name} "${nullable}"`);
        }
        lines.push('    }');
    }

    // 添加关系
    for (const model of models) {
        if (!model.relations) continue;
        for (const rel of model.relations) {
            const srcId = sanitizeMermaidId(model.name);
            const tgtId = sanitizeMermaidId(rel.relatedModel);
            const relSymbol = getERRelationSymbol(rel.relationType);
            const label = rel.fieldName || rel.relationType;
            lines.push(`    ${srcId} ${relSymbol} ${tgtId} : "${label}"`);
        }
    }


    return lines.join('\n');
}

/**
 * 生成模块依赖关系的 Mermaid flowchart
 */
export function generateDependencyDiagram(
    modules: ModuleInfo[],
    edges: Array<{ source: string; target: string; isExternal: boolean }>
): string {
    const lines: string[] = ['flowchart TD'];

    // 内部模块节点
    lines.push('    subgraph internal["内部模块"]');
    for (const mod of modules) {
        const nodeId = sanitizeMermaidId(mod.moduleName);
        lines.push(`        ${nodeId}["${mod.moduleName}"]`);
    }
    lines.push('    end');

    // 外部依赖
    const externalDeps = new Set<string>();
    for (const edge of edges) {
        if (edge.isExternal) {
            externalDeps.add(edge.target);
        }
    }

    if (externalDeps.size > 0) {
        lines.push('    subgraph external["外部依赖"]');
        for (const dep of externalDeps) {
            const nodeId = sanitizeMermaidId(`ext_${dep}`);
            lines.push(`        ${nodeId}["${dep}"]`);
        }
        lines.push('    end');
    }

    // 模块间关系
    const addedEdges = new Set<string>();
    for (const edge of edges) {
        const sourceModule = findModuleForFile(edge.source, modules);
        if (!sourceModule) continue;

        const srcId = sanitizeMermaidId(sourceModule);
        let tgtId: string;

        if (edge.isExternal) {
            tgtId = sanitizeMermaidId(`ext_${edge.target}`);
        } else {
            const targetModule = findModuleForFile(edge.target, modules);
            if (!targetModule || targetModule === sourceModule) continue;
            tgtId = sanitizeMermaidId(targetModule);
        }

        const edgeKey = `${srcId}-->${tgtId}`;
        if (addedEdges.has(edgeKey)) continue;
        addedEdges.add(edgeKey);
        lines.push(`    ${srcId} --> ${tgtId}`);
    }

    return lines.join('\n');
}

/**
 * 生成 API 路由的 Mermaid 图
 */
export function generateApiDiagram(routes: ApiRoute[]): string {
    if (routes.length === 0) return '';

    const lines: string[] = ['flowchart LR'];

    // 按路径前缀分组
    const groups = new Map<string, ApiRoute[]>();
    for (const route of routes) {
        const prefix = route.path.split('/').slice(0, 2).join('/') || '/';
        const group = groups.get(prefix) || [];
        group.push(route);
        groups.set(prefix, group);
    }

    lines.push('    Client["客户端"] --> Router["路由层"]');

    for (const [prefix, groupRoutes] of groups) {
        const groupId = sanitizeMermaidId(`api_${prefix}`);
        lines.push(`    subgraph ${groupId}["${prefix}"]`);

        for (const route of groupRoutes) {
            const routeId = sanitizeMermaidId(`route_${route.method}_${route.path}`);
            lines.push(`        ${routeId}["${route.method.toUpperCase()} ${route.path}"]`);
        }

        lines.push('    end');
        lines.push(`    Router --> ${groupId}`);
    }

    return lines.join('\n');
}

/**
 * 生成简化的技术栈总览图
 */
export function generateTechStackDiagram(
    frameworks: string[],
    databases: string[],
    services: string[]
): string {
    const lines: string[] = ['flowchart TB'];

    lines.push('    User["用户"] --> Frontend');

    if (frameworks.length > 0) {
        lines.push('    subgraph Frontend["前端"]');
        for (const fw of frameworks.filter(f =>
            ['Next.js', 'React', 'Vue.js', 'Angular', 'Svelte'].includes(f)
        )) {
            lines.push(`        ${sanitizeMermaidId(fw)}["${fw}"]`);
        }
        lines.push('    end');
    }

    const backendFrameworks = frameworks.filter(f =>
        ['FastAPI', 'Express', 'NestJS', 'Django', 'Flask', 'Fastify'].includes(f)
    );
    if (backendFrameworks.length > 0) {
        lines.push('    Frontend --> Backend');
        lines.push('    subgraph Backend["后端"]');
        for (const fw of backendFrameworks) {
            lines.push(`        ${sanitizeMermaidId(fw)}["${fw}"]`);
        }
        lines.push('    end');
    }

    if (databases.length > 0) {
        lines.push('    Backend --> Database');
        lines.push('    subgraph Database["数据存储"]');
        for (const db of databases) {
            lines.push(`        ${sanitizeMermaidId(db)}["${db}"]`);
        }
        lines.push('    end');
    }

    if (services.length > 0) {
        lines.push('    Backend --> Services');
        lines.push('    subgraph Services["外部服务"]');
        for (const svc of services) {
            lines.push(`        ${sanitizeMermaidId(svc)}["${svc}"]`);
        }
        lines.push('    end');
    }

    return lines.join('\n');
}

// ─── 辅助函数 ─────────────────────────────────────────────────

/**
 * 将字符串转换为合法的 Mermaid 节点 ID
 */
function sanitizeMermaidId(input: string): string {
    return input
        .replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, '_')
        .replace(/^(\d)/, '_$1')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || 'node';
}

/**
 * 将类型名转换为 Mermaid ER 图兼容的类型
 */
function sanitizeMermaidType(type: string): string {
    return type.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown';
}

/**
 * 获取 ER 关系符号
 */
function getERRelationSymbol(relType: string): string {
    const lower = relType.toLowerCase();
    if (lower.includes('manytomany') || lower === 'many-to-many') return '}o--o{';
    if (lower.includes('onetomany') || lower === 'one-to-many') return '||--o{';
    if (lower.includes('manytoone') || lower === 'many-to-one') return '}o--||';
    if (lower.includes('onetoone') || lower === 'one-to-one') return '||--||';
    return '||--o{'; // 默认
}

/**
 * 按类别对模块分组
 */
function groupModulesByCategory(modules: ModuleInfo[]): Record<string, ModuleInfo[]> {
    const groups: Record<string, ModuleInfo[]> = {};

    for (const mod of modules) {
        const category = inferCategory(mod);
        if (!groups[category]) groups[category] = [];
        groups[category].push(mod);
    }

    return groups;
}

/**
 * 推断模块类别
 */
function inferCategory(mod: ModuleInfo): string {
    const dir = mod.directory.toLowerCase();
    if (dir.includes('frontend') || dir.includes('web') || dir.includes('client') ||
        dir.includes('app/page') || dir.includes('components')) return 'frontend';
    if (dir.includes('api') || dir.includes('backend') || dir.includes('server')) return 'backend';
    if (dir.includes('agent')) return 'agents';
    if (dir.includes('model') || dir.includes('schema') || dir.includes('entity')) return 'data';
    if (dir.includes('test') || dir.includes('spec')) return 'tests';
    if (dir.includes('config') || dir.includes('infra') || dir.includes('deploy')) return 'infrastructure';
    if (dir.includes('lib') || dir.includes('util') || dir.includes('common') || dir.includes('shared')) return 'shared';
    return 'other';
}

/**
 * 获取类别的中文标签
 */
function getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
        frontend: '前端应用',
        backend: '后端服务',
        agents: 'Agent 系统',
        data: '数据模型',
        tests: '测试',
        infrastructure: '基础设施',
        shared: '公共模块',
        other: '其他模块'
    };
    return labels[category] || category;
}

/**
 * 根据文件路径找到所属模块
 */
function findModuleForFile(filePath: string, modules: ModuleInfo[]): string | null {
    const normalized = filePath.replace(/\\/g, '/');
    for (const mod of modules) {
        for (const f of mod.files) {
            if (normalized === f.replace(/\\/g, '/') || normalized.endsWith(f.replace(/\\/g, '/'))) {
                return mod.moduleName;
            }
        }
    }
    // 尝试通过目录匹配
    for (const mod of modules) {
        const dir = mod.directory.replace(/\\/g, '/');
        if (normalized.startsWith(dir)) {
            return mod.moduleName;
        }
    }
    return null;
}
