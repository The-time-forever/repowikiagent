import { z } from 'zod';

import { SourceReferenceSchema } from './file-reference.js';

/**
 * Wiki 页面 Schema
 * 表示一篇生成的 Wiki 文档。
 */
export const WikiPageSchema = z.object({
    /** 页面标题 */
    title: z.string().describe('标题'),
    /** docs/wiki/ 下的相对文件名 */
    filename: z.string().describe('docs/wiki/ 下的相对路径'),
    /** 页面摘要 */
    summary: z.string().describe('简述'),
    /** 最终渲染的 Markdown 正文 */
    content: z.string().describe('最终 Markdown 文本'),
    /** 引用的源码片段 */
    sourceRefs: z.array(SourceReferenceSchema).default([]),
});

/** Wiki 页面类型 */
export type WikiPage = z.infer<typeof WikiPageSchema>;
