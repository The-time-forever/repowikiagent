import { describe, it, expect } from 'vitest';
import { sanitizeWikiPage } from '../dist/index.js';

describe('sanitizeWikiPage', () => {
    it('删除中文占位行', () => {
        const input = ['## 结论', '', '本项目结构清晰。', '', '[本节为通用指导，无需列出章节来源]', ''].join('\n');
        const out = sanitizeWikiPage(input);
        expect(out).not.toContain('[本节为通用指导');
        expect(out).toContain('本项目结构清晰。');
    });

    it('删除英文占位行与总结占位行（含缩进）', () => {
        const input = [
            '## Conclusion',
            'Done.',
            '  [This section is general guidance; no sources required]',
            '[This section provides a summary; no sources required]',
            '[本节为总结性内容，无需列出章节来源]',
        ].join('\n');
        const out = sanitizeWikiPage(input);
        expect(out).not.toContain('no sources required');
        expect(out).not.toContain('无需列出章节来源');
        expect(out).toContain('Done.');
    });

    it('剥除 cite 块内的幻觉元信息，保留文件列表', () => {
        const input = [
            '# 标题',
            '<cite>',
            '本文档引用的文件：',
            '- [src/a.ts](file://src/a.ts)',
            '**文档版本**: v1.2',
            '**最后更新**: 2024-06-01',
            '| 版本 | 更新日期 |',
            'Last Updated: 2024-06-01',
            '</cite>',
        ].join('\n');
        const out = sanitizeWikiPage(input);
        expect(out).toContain('- [src/a.ts](file://src/a.ts)');
        expect(out).not.toContain('文档版本');
        expect(out).not.toContain('最后更新');
        expect(out).not.toContain('Last Updated');
    });

    it('正文中的日期与"版本"字样不受影响', () => {
        const input = [
            '<cite>',
            '- [a.ts](file://a.ts)',
            '</cite>',
            '',
            '该配置于 2024-06-01 引入，`version` 字段表示协议版本号，最后更新时间戳存于数据库。',
        ].join('\n');
        const out = sanitizeWikiPage(input);
        expect(out).toContain('2024-06-01 引入');
        expect(out).toContain('最后更新时间戳存于数据库');
    });

    it('占位行带尾部标点（实测遇到句号变体）也会删除', () => {
        const input = ['正文', '[本节为通用指导，无需列出章节来源]。', '[This section is general guidance; no sources required].'].join('\n');
        const out = sanitizeWikiPage(input);
        expect(out).not.toContain('无需列出章节来源');
        expect(out).not.toContain('no sources required');
        expect(out).toContain('正文');
    });

    it('折叠清洗产生的连续空行', () => {
        const input = ['A', '', '[本节为通用指导，无需列出章节来源]', '', 'B'].join('\n');
        const out = sanitizeWikiPage(input);
        expect(out).toBe('A\n\nB');
    });

    it('幂等：清洗后的内容再次清洗不变', () => {
        const input = ['<cite>', '- [a.ts](file://a.ts)', '**最后更新**: 2024-01-01', '</cite>', '', '', '', '正文'].join('\n');
        const once = sanitizeWikiPage(input);
        expect(sanitizeWikiPage(once)).toBe(once);
    });
});
