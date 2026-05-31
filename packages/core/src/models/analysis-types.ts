import { z } from 'zod';

// ============================================================================
// ModuleInfo — 模块聚类分析结果
// ============================================================================

/**
 * 核心组件 Schema
 * 描述某模块中的关键类、函数或子系统。
 */
export const CoreComponentSchema = z.object({
    /** 组件名称（类名、函数名或子系统名） */
    name: z.string().describe('核心组件名称'),
    /** 组件的作用描述 */
    description: z.string().describe('用途和调用逻辑'),
});

/** 核心组件类型 */
export type CoreComponent = z.infer<typeof CoreComponentSchema>;

/**
 * 模块信息 Schema
 * 描述由 ModuleAnalyzer 聚类生成的逻辑模块。
 */
export const ModuleInfoSchema = z.object({
    /** 模块名称（如 api, web, components） */
    moduleName: z.string().describe('模块名称'),
    /** 模块所在的目录相对路径 */
    directory: z.string().describe('目录相对路径'),
    /** 模块内包含的文件相对路径列表 */
    files: z.array(z.string()).default([]).describe('文件相对路径列表'),
    /** 模块职责描述 */
    summary: z.string().default('').describe('模块职责描述'),
    /** 模块分类标签 */
    category: z.string().default('').describe('分类标签'),
    /** 核心组件列表 */
    coreComponents: z.array(CoreComponentSchema).default([]).describe('核心组件'),
});

/** 模块信息类型 */
export type ModuleInfo = z.infer<typeof ModuleInfoSchema>;

// ============================================================================
// ApiRoute — API 路由分析结果
// ============================================================================

/**
 * API 路由 Schema
 * 描述从源码中提取的单个 HTTP 路由定义。
 */
export const ApiRouteSchema = z.object({
    /** HTTP 方法（GET, POST, PUT, DELETE, PATCH） */
    method: z.string().describe('HTTP 方法'),
    /** 路由路径 */
    path: z.string().describe('路由路径'),
    /** 处理函数名称 */
    handler: z.string().default('').describe('处理函数名称'),
    /** 所在文件的相对路径 */
    filePath: z.string().describe('文件相对路径'),
    /** 路由定义所在的行号 */
    lineNumber: z.number().default(0).describe('行号'),
    /** 检测到的框架类型 */
    framework: z.string().default('').describe('框架类型'),
});

/** API 路由类型 */
export type ApiRoute = z.infer<typeof ApiRouteSchema>;

// ============================================================================
// DatabaseModel — 数据库模型分析结果
// ============================================================================

/**
 * 数据库字段 Schema
 */
export const DatabaseFieldSchema = z.object({
    /** 字段名称 */
    name: z.string().describe('字段名称'),
    /** 字段类型 */
    type: z.string().describe('字段类型'),
    /** 是否可空 */
    nullable: z.boolean().default(false).describe('是否可空'),
});

/** 数据库字段类型 */
export type DatabaseField = z.infer<typeof DatabaseFieldSchema>;

/**
 * 数据库关系 Schema
 */
export const DatabaseRelationSchema = z.object({
    /** 关系字段名 */
    fieldName: z.string().describe('关系字段名'),
    /** 关联的模型名 */
    relatedModel: z.string().describe('关联模型'),
    /** 关系类型（OneToMany, ManyToOne 等） */
    relationType: z.string().default('').describe('关系类型'),
});

/** 数据库关系类型 */
export type DatabaseRelation = z.infer<typeof DatabaseRelationSchema>;

/**
 * 数据库模型 Schema
 * 描述从 ORM 定义中提取的数据模型。
 */
export const DatabaseModelSchema = z.object({
    /** 模型名称 */
    name: z.string().describe('模型名称'),
    /** 所在文件相对路径 */
    filePath: z.string().describe('文件相对路径'),
    /** 检测到的 ORM 类型 */
    orm: z.string().default('').describe('ORM 类型'),
    /** 字段列表 */
    fields: z.array(DatabaseFieldSchema).default([]).describe('字段列表'),
    /** 关系列表 */
    relations: z.array(DatabaseRelationSchema).default([]).describe('关系列表'),
});

/** 数据库模型类型 */
export type DatabaseModel = z.infer<typeof DatabaseModelSchema>;
