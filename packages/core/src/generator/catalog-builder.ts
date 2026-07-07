/**
 * @module catalog-builder
 * @description 构建分层 Wiki 目录树（CatalogNode[]，父在前的先序列表）。
 *
 * 提供：
 * - 确定性兜底建树（无 LLM 或 LLM 规划失败时）
 * - slug / id / filename 派生与树校验
 * - 将 LLM 返回的嵌套规划扁平化为 CatalogNode[]
 */

import type { AnalysisResult, CatalogNode, CatalogStrategy, DiagramKind } from '../models/index.js';
import type { WikiLabels } from '../i18n/labels.js';

// ────────────────────────────────────────────────────────────────
// 基础工具
// ────────────────────────────────────────────────────────────────

/** 生成 kebab-case 英文 slug（非字母数字折叠为连字符） */
export function slugify(input: string): string {
    const s = input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return s || 'page';
}

/** 由稳定种子（通常是 filename）确定性派生 id（djb2 hash，8 位十六进制） */
export function hashId(seed: string): string {
    let h = 5381;
    for (let i = 0; i < seed.length; i++) {
        h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

// ────────────────────────────────────────────────────────────────
// 确定性兜底建树
// ────────────────────────────────────────────────────────────────

/** 取一组文件中去重后的相对路径 */
function uniquePaths(paths: string[]): string[] {
    return [...new Set(paths.map((p) => p.replace(/\\/g, '/')))];
}

/**
 * 构建确定性目录树。
 *
 * 结构：概览 → 核心模块(分区) → 各模块子页 → 数据库设计 → API 参考。
 * feature 策略下模块页标题为"X 模块分析"，package 策略下为模块名。
 */
export function buildDefaultCatalog(
    analysisResult: AnalysisResult,
    labels: WikiLabels,
    strategy: CatalogStrategy,
    slugFilenames = false,
): CatalogNode[] {
    const P = labels.plan;
    const nodes: CatalogNode[] = [];

    // slug 模式：目录与文件名使用固定 ASCII（标题仍本地化）
    const dirs = slugFilenames
        ? { overview: 'overview', modules: 'core-modules', database: 'database', api: 'api' }
        : { overview: P.overviewDir, modules: P.modulesDir, database: P.databaseDir, api: P.apiDir };
    const fname = (title: string, slug: string) => (slugFilenames ? slug : title);

    const make = (
        title: string,
        slug: string,
        filename: string,
        opts: Partial<CatalogNode> = {},
    ): CatalogNode => {
        const node: CatalogNode = {
            id: hashId(filename),
            title,
            slug,
            summary: opts.summary ?? '',
            prompt: opts.prompt ?? '',
            dependentFiles: opts.dependentFiles ?? [],
            parentId: opts.parentId,
            layerLevel: opts.layerLevel ?? 0,
            category: opts.category ?? '',
            diagrams: opts.diagrams ?? [],
            isSection: opts.isSection ?? false,
            filename,
        };
        nodes.push(node);
        return node;
    };

    // 1) 概览页（顶层）
    const overviewSeedFiles = uniquePaths([
        ...analysisResult.project.entrypoints,
        ...analysisResult.project.configFiles.slice(0, 3),
        ...analysisResult.modules.filter((m) => m.directory !== '.').slice(0, 3).map((m) => m.files[0]).filter(Boolean),
    ]);
    make(P.overviewTitle, 'overview', `${dirs.overview}/${fname(P.overviewTitle, 'overview')}.md`, {
        summary: P.overviewSummary,
        dependentFiles: overviewSeedFiles,
        diagrams: ['architecture'],
        category: 'overview',
    });

    // 2) 核心模块分区 + 每模块子页
    const moduleMods = analysisResult.modules.filter((m) => m.directory !== '.' && m.files.length > 0);
    if (moduleMods.length > 0) {
        const section = make(P.modulesDir, 'core-modules', `${dirs.modules}/${fname(P.modulesDir, 'core-modules')}.md`, {
            summary: P.moduleSummary(P.modulesDir),
            isSection: true,
            category: 'section',
        });

        for (const mod of moduleMods) {
            const title = strategy === 'package' ? mod.moduleName : P.moduleTitle(mod.moduleName);
            make(title, slugify(mod.moduleName), `${dirs.modules}/${fname(title, slugify(mod.moduleName))}.md`, {
                summary: P.moduleSummary(mod.moduleName),
                dependentFiles: uniquePaths(mod.files),
                parentId: section.id,
                layerLevel: 1,
                category: mod.category,
                diagrams: mod.category === 'dependency' ? ['dependency'] : [],
            });
        }
    }

    // 3) 数据库设计
    if (analysisResult.databaseModels.length > 0) {
        make(P.databaseTitle, 'database-design', `${dirs.database}/${fname(P.databaseTitle, 'database-design')}.md`, {
            summary: P.databaseSummary,
            dependentFiles: uniquePaths(analysisResult.databaseModels.map((m) => m.filePath)),
            diagrams: ['er'],
            category: 'data',
        });
    }

    // 4) API 参考
    if (analysisResult.apiRoutes.length > 0) {
        make(P.apiTitle, 'api-reference', `${dirs.api}/${fname(P.apiTitle, 'api-reference')}.md`, {
            summary: P.apiSummary,
            dependentFiles: uniquePaths(analysisResult.apiRoutes.map((r) => r.filePath)),
            diagrams: ['api'],
            category: 'api',
        });
    }

    return nodes;
}

// ────────────────────────────────────────────────────────────────
// LLM 规划扁平化
// ────────────────────────────────────────────────────────────────

/** LLM 规划返回的嵌套节点形状 */
export interface PlannedCatalogNode {
    title: string;
    slug?: string;
    summary?: string;
    prompt?: string;
    dependent_files?: string[];
    diagrams?: DiagramKind[];
    children?: PlannedCatalogNode[];
}

/**
 * 将 LLM 返回的嵌套规划扁平化为 CatalogNode[]（先序）。
 * 依赖文件会被过滤到已知文件集合内；filename 由标题层级派生。
 */
export function flattenPlannedCatalog(
    planned: PlannedCatalogNode[],
    knownFiles: Set<string>,
    slugFilenames = false,
): CatalogNode[] {
    const out: CatalogNode[] = [];
    const usedSegs = new Set<string>();

    /** slug 模式下的路径段：ASCII slug + 去重后缀（中文标题无 slug 时会折叠，需防冲突） */
    const uniqueSeg = (node: PlannedCatalogNode, parentDir: string): string => {
        if (!slugFilenames) return node.title;
        const base = slugify(node.slug || node.title);
        let seg = base;
        let n = 2;
        while (usedSegs.has(`${parentDir}/${seg}`)) {
            seg = `${base}-${n++}`;
        }
        usedSegs.add(`${parentDir}/${seg}`);
        return seg;
    };

    const walk = (
        node: PlannedCatalogNode,
        parentId: string | undefined,
        parentDir: string,
        layer: number,
    ): void => {
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        const seg = uniqueSeg(node, parentDir);
        const dir = parentDir ? `${parentDir}/${seg}` : seg;
        const filename = hasChildren ? `${dir}/${seg}.md` : `${parentDir ? parentDir + '/' : ''}${seg}.md`;
        const id = hashId(filename);

        const deps = uniquePaths(node.dependent_files ?? []).filter((f) => knownFiles.has(f));

        out.push({
            id,
            title: node.title,
            slug: node.slug ? slugify(node.slug) : slugify(node.title),
            summary: node.summary ?? '',
            prompt: node.prompt ?? '',
            dependentFiles: deps,
            parentId,
            layerLevel: layer,
            category: '',
            diagrams: node.diagrams ?? [],
            isSection: hasChildren,
            filename,
        });

        if (hasChildren) {
            for (const child of node.children!) {
                walk(child, id, dir, layer + 1);
            }
        }
    };

    for (const root of planned) {
        walk(root, undefined, '', 0);
    }

    return out;
}

// ────────────────────────────────────────────────────────────────
// 校验
// ────────────────────────────────────────────────────────────────

export interface CatalogValidationResult {
    ok: boolean;
    errors: string[];
}

/**
 * 校验目录树的结构一致性：id 唯一、parent 存在、无环、filename 唯一。
 */
export function validateCatalog(nodes: CatalogNode[]): CatalogValidationResult {
    const errors: string[] = [];
    const ids = new Set<string>();
    const filenames = new Set<string>();

    for (const n of nodes) {
        if (ids.has(n.id)) errors.push(`重复的节点 id: ${n.id} (${n.title})`);
        ids.add(n.id);
        if (filenames.has(n.filename)) errors.push(`重复的文件名: ${n.filename}`);
        filenames.add(n.filename);
    }

    for (const n of nodes) {
        if (n.parentId && !ids.has(n.parentId)) {
            errors.push(`节点 ${n.title} 的父节点不存在: ${n.parentId}`);
        }
    }

    // 环检测：沿 parentId 上溯不应回到自身
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) {
        const seen = new Set<string>();
        let cur: CatalogNode | undefined = n;
        while (cur?.parentId) {
            if (seen.has(cur.parentId)) {
                errors.push(`检测到环，涉及节点: ${n.title}`);
                break;
            }
            seen.add(cur.parentId);
            cur = byId.get(cur.parentId);
        }
    }

    return { ok: errors.length === 0, errors };
}
