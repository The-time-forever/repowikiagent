import { describe, it, expect } from 'vitest';
import { parseCitations } from '../dist/index.js';

describe('parseCitations', () => {
    it('解析行区间引用 file://path#L10-L20', () => {
        const [c] = parseCitations('见 file://src/pipeline.ts#L10-L20 的实现');
        expect(c).toEqual({
            filePath: 'src/pipeline.ts',
            startLine: 10,
            endLine: 20,
            raw: 'file://src/pipeline.ts#L10-L20',
        });
    });

    it('支持 #L10-20（第二个 L 可省略）与单行引用', () => {
        const cs = parseCitations('file://a.ts#L10-20 和 file://b.ts#L5');
        expect(cs[0].startLine).toBe(10);
        expect(cs[0].endLine).toBe(20);
        expect(cs[1]).toMatchObject({ filePath: 'b.ts', startLine: 5, endLine: 5 });
    });

    it('按出现顺序返回多条引用', () => {
        const text = '- file://src/x.ts#L1-L2\n- file://src/y.ts#L3-L4';
        expect(parseCitations(text).map((c) => c.filePath)).toEqual(['src/x.ts', 'src/y.ts']);
    });

    it('不带 #L 行号的 file:// 不匹配；普通文本无匹配', () => {
        expect(parseCitations('file://src/x.ts 没有行号')).toEqual([]);
        expect(parseCitations('普通文本')).toEqual([]);
    });

    it('路径在 ) 与反引号处截断', () => {
        const [c] = parseCitations('(file://src/x.ts#L7)');
        expect(c.filePath).toBe('src/x.ts');
        expect(c.startLine).toBe(7);
    });
});
