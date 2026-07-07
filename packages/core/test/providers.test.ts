import { describe, it, expect } from 'vitest';
import { PROVIDER_PRESETS, findProviderByEndpoint } from '../dist/index.js';

describe('PROVIDER_PRESETS', () => {
    it('id 唯一且非空', () => {
        const ids = PROVIDER_PRESETS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.every((id) => id.length > 0)).toBe(true);
    });

    it('endpoint 均为可解析的 https URL 且不含 /chat/completions', () => {
        for (const p of PROVIDER_PRESETS) {
            const url = new URL(p.endpoint);
            expect(url.protocol).toBe('https:');
            expect(p.endpoint).not.toMatch(/chat\/completions/);
            expect(p.endpoint).not.toMatch(/\/$/);
        }
    });

    it('defaultModel 与 name 非空', () => {
        for (const p of PROVIDER_PRESETS) {
            expect(p.defaultModel.length).toBeGreaterThan(0);
            expect(p.name.length).toBeGreaterThan(0);
        }
    });
});

describe('findProviderByEndpoint', () => {
    it('精确命中', () => {
        expect(findProviderByEndpoint('https://api.deepseek.com/v1')?.id).toBe('deepseek');
    });

    it('忽略尾部斜杠与大小写', () => {
        expect(findProviderByEndpoint('https://API.deepseek.com/v1/')?.id).toBe('deepseek');
    });

    it('未命中返回 null', () => {
        expect(findProviderByEndpoint('https://example.com/v1')).toBeNull();
        expect(findProviderByEndpoint('')).toBeNull();
    });
});
