import { z } from 'zod';

/**
 * 文件节点 Schema
 * 表示扫描到的单个文件或目录。
 */
export const FileNodeSchema = z.object({
    /** 文件的绝对路径 */
    path: z.string().describe('文件的绝对路径'),
    /** 相对于项目根目录的路径 */
    relativePath: z.string().describe('相对于项目根目录的路径'),
    /** 节点类型 */
    nodeType: z.enum(['file', 'directory']).describe('节点类型'),
    /** 文件大小 (字节) */
    sizeBytes: z.number().describe('文件大小'),
    /** 检测到的编程语言 */
    language: z.string().optional().describe('语言类型'),
    /** 物理行数（含空行，与编辑器行号一致） */
    lineCount: z.number().optional().describe('物理行数'),
});

/** 文件节点类型 */
export type FileNode = z.infer<typeof FileNodeSchema>;

/**
 * 源码引用 Schema
 * 指向特定代码片段的行范围，用于 Wiki 页面追溯。
 */
export const SourceReferenceSchema = z.object({
    /** 相对文件路径 */
    filePath: z.string().describe('相对文件路径'),
    /** 开始行号 */
    startLine: z.number().describe('开始行'),
    /** 结束行号 */
    endLine: z.number().describe('结束行'),
    /** 引用说明 */
    reason: z.string().describe('引用说明'),
});

/** 源码引用类型 */
export type SourceReference = z.infer<typeof SourceReferenceSchema>;
