import { z } from 'zod';

/**
 * 页面需要绘制的图表类型（显式声明，取代按标题子串猜测）
 */
export const DiagramKindSchema = z.enum(['architecture', 'er', 'dependency', 'api']);
export type DiagramKind = z.infer<typeof DiagramKindSchema>;

/** Wiki 目录组织策略（feature/概念中心 vs package/模块中心） */
export type CatalogStrategy = 'feature' | 'package';

/**
 * Catalog 节点 Schema
 *
 * 分层 Wiki 目录树的一个节点 = 一个文档页面。
 * `dependentFiles` 既是 grounding 引用边界，也是增量更新的依赖图。
 */
export const CatalogNodeSchema = z.object({
    /** 稳定 id（由 slug 确定性派生，保证可复现） */
    id: z.string(),
    /** 显示标题（用作 .md 文件名） */
    title: z.string(),
    /** kebab-case 英文别名（用于路径/元数据） */
    slug: z.string(),
    /** 页面摘要 */
    summary: z.string().default(''),
    /** 生成简报：范围、深度、受众 */
    prompt: z.string().default(''),
    /** 显式依赖的源码文件（相对路径，comma 展开后的数组） */
    dependentFiles: z.array(z.string()).default([]),
    /** 父节点 id（根节点省略） */
    parentId: z.string().optional(),
    /** 层级深度（0 = 顶层） */
    layerLevel: z.number().default(0),
    /** 分类标签 */
    category: z.string().default(''),
    /** 该页需要绘制的图表 */
    diagrams: z.array(DiagramKindSchema).default([]),
    /** 是否为分区着陆页（有子节点、内容为子页索引） */
    isSection: z.boolean().default(false),
    /** content 目录下的相对文件路径（含 .md） */
    filename: z.string(),
});

export type CatalogNode = z.infer<typeof CatalogNodeSchema>;
