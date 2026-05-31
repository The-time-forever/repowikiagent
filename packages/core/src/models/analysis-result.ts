import { z } from 'zod';

import { ProjectProfileSchema } from './project-profile.js';
import { WikiPageSchema } from './wiki-page.js';
import {
    ModuleInfoSchema,
    ApiRouteSchema,
    DatabaseModelSchema,
} from './analysis-types.js';

/**
 * 依赖关系边 Schema
 */
export const DependencyEdgeSchema = z.object({
    source: z.string().describe('源文件相对路径'),
    target: z.string().describe('依赖目标相对路径或包名'),
    isExternal: z.boolean().describe('是否为外部依赖'),
});

/**
 * 依赖关系图 Schema
 */
export const DependencyGraphSchema = z.object({
    edges: z.array(DependencyEdgeSchema).default([]).describe('依赖边列表'),
    internalModules: z.array(z.string()).default([]).describe('内部模块路径列表'),
    externalPackages: z.array(z.string()).default([]).describe('外部依赖包名列表'),
});

/**
 * 分析结果 Schema
 * 整合项目概要、目录树、模块、依赖、API 路由、数据模型和 Wiki 页面。
 */
export const AnalysisResultSchema = z.object({
    project: ProjectProfileSchema,
    tree: z.string().describe('纯文本树结构'),
    modules: z.array(ModuleInfoSchema),
    dependencies: DependencyGraphSchema,
    apiRoutes: z.array(ApiRouteSchema),
    databaseModels: z.array(DatabaseModelSchema),
    wikiPages: z.array(WikiPageSchema).default([]),
});

/** 分析结果类型 */
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
