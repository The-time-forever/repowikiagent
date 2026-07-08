import { describe, it, expect, vi, afterEach } from 'vitest';
import { LLMClient } from '../dist/index.js';

const CONFIG = { apiEndpoint: 'https://api.example.com/v1', modelName: 'test-model', apiKey: 'sk-test' };

function okResponse(prompt: number, completion: number): Response {
    return new Response(
        JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('LLMClient 用量累计', () => {
    it('多次 chat 成功后 totals 正确累加', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValueOnce(okResponse(100, 20)).mockResolvedValueOnce(okResponse(50, 10)),
        );
        const client = new LLMClient({ config: CONFIG });
        await client.chat([{ role: 'user', content: 'a' }]);
        await client.chat([{ role: 'user', content: 'b' }]);

        expect(client.getUsageTotals()).toEqual({
            promptTokens: 150,
            completionTokens: 30,
            totalTokens: 180,
            calls: 2,
        });
    });

    it('响应缺少 usage 字段时只累计调用次数', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            ),
        );
        const client = new LLMClient({ config: CONFIG });
        await client.chat([{ role: 'user', content: 'a' }]);
        expect(client.getUsageTotals()).toEqual({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            calls: 1,
        });
    });

    it('失败的调用不计入 calls', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })),
        );
        const client = new LLMClient({ config: CONFIG });
        await expect(client.chat([{ role: 'user', content: 'a' }])).rejects.toThrow();
        expect(client.getUsageTotals().calls).toBe(0);
    });

    it('getUsageTotals 返回副本，外部修改不影响内部累计', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(10, 5)));
        const client = new LLMClient({ config: CONFIG });
        await client.chat([{ role: 'user', content: 'a' }]);
        const totals = client.getUsageTotals();
        totals.promptTokens = 9999;
        expect(client.getUsageTotals().promptTokens).toBe(10);
    });
});
