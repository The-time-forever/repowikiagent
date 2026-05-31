import { z } from 'zod';

/**
 * 项目概要 Schema
 * 描述被分析项目的基本元信息，包括技术栈、入口点和配置文件等。
 */
export const ProjectProfileSchema = z.object({
    /** 项目名称 */
    name: z.string().describe('项目名称'),
    /** 项目根目录的绝对路径 */
    rootPath: z.string().describe('绝对路径'),
    /** 使用的主力编程语言 */
    languages: z.array(z.string()).default([]).describe('使用的主力语言'),
    /** 推断出的框架信息 */
    frameworks: z.array(z.string()).default([]).describe('框架推断结果'),
    /** 检测到的包管理器 */
    packageManagers: z.array(z.string()).default([]).describe('包管理器'),
    /** 使用的数据库 */
    databases: z.array(z.string()).default([]).describe('数据库'),
    /** 接入的外部服务 */
    services: z.array(z.string()).default([]).describe('外部服务'),
    /** 入口文件列表 */
    entrypoints: z.array(z.string()).default([]).describe('入口点'),
    /** 配置文件列表 */
    configFiles: z.array(z.string()).default([]).describe('配置文件'),
});

/** 项目概要类型 */
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;
