import { describe, it, expect, vi, afterEach } from 'vitest';
import { LLMClient } from '../dist/index.js';

const CONFIG = { apiEndpoint: 'https://api.example.com/v1', modelName: 'test-model', apiKey: 'sk-test' };

/** 构造 SSE 流式响应；signal 触发 abort 时以 AbortError 中断流（模拟真实 fetch 行为） */
function sseResponse(events: string[], init?: { hangAfter?: boolean; signal?: AbortSignal }): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const e of events) {
                controller.enqueue(encoder.encode(e));
            }
            if (!init?.hangAfter) {
                controller.close();
            } else if (init.signal) {
                init.signal.addEventListener('abort', () => {
                    controller.error(new DOMException('This operation was aborted', 'AbortError'));
                });
            }
        },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function deltaEvent(content: string): string {
    return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function usageEvent(prompt: number, completion: number): string {
    return `data: ${JSON.stringify({
        choices: [],
        usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
    })}\n\n`;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('LLMClient 流式响应', () => {
    it('SSE 内容按序拼装，onToken 逐段回调，末 chunk usage 计入累计', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                sseResponse([
                    deltaEvent('你好'),
                    deltaEvent('，'),
                    deltaEvent('世界'),
                    usageEvent(100, 20),
                    'data: [DONE]\n\n',
                ]),
            ),
        );
        const client = new LLMClient({ config: CONFIG });
        const tokens: string[] = [];
        const res = await client.chat([{ role: 'user', content: 'hi' }], {
            onToken: (d) => tokens.push(d),
        });

        expect(res.content).toBe('你好，世界');
        expect(tokens).toEqual(['你好', '，', '世界']);
        expect(res.usage).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120 });
        expect(client.getUsageTotals()).toEqual({
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
            calls: 1,
        });
    });

    it('跨 chunk 撕裂的 SSE 行也能正确解析', async () => {
        const full = deltaEvent('abcdef');
        // 把一个完整事件劈成 3 段发送
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(sseResponse([full.slice(0, 10), full.slice(10, 25), full.slice(25)])),
        );
        const client = new LLMClient({ config: CONFIG });
        const res = await client.chat([{ role: 'user', content: 'hi' }]);
        expect(res.content).toBe('abcdef');
    });

    it('默认发送 stream: true 与 stream_options', async () => {
        const fetchMock = vi.fn().mockResolvedValue(sseResponse([deltaEvent('ok'), 'data: [DONE]\n\n']));
        vi.stubGlobal('fetch', fetchMock);
        const client = new LLMClient({ config: CONFIG });
        await client.chat([{ role: 'user', content: 'hi' }]);

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.stream).toBe(true);
        expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('streaming: false 时不发送 stream 参数', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const client = new LLMClient({ config: CONFIG, streaming: false });
        const res = await client.chat([{ role: 'user', content: 'hi' }]);

        expect(res.content).toBe('ok');
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.stream).toBeUndefined();
    });

    it('content-type 非 event-stream 时按整体 JSON 回退解析', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        choices: [{ message: { content: '整体响应' } }],
                        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            ),
        );
        const client = new LLMClient({ config: CONFIG });
        const tokens: string[] = [];
        const res = await client.chat([{ role: 'user', content: 'hi' }], {
            onToken: (d) => tokens.push(d),
        });

        expect(res.content).toBe('整体响应');
        expect(tokens).toEqual([]); // 整体回退不触发 onToken
        expect(res.usage?.totalTokens).toBe(8);
    });

    it('流式 400 → 去掉 stream_options 重试 → 仍 400 → 同一 attempt 降级非流式，后续调用直接非流式', async () => {
        const okJson = new Response(JSON.stringify({ choices: [{ message: { content: 'fallback-ok' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
        const okJson2 = new Response(JSON.stringify({ choices: [{ message: { content: 'second-ok' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('{"error":{"message":"stream not supported"}}', { status: 400 }))
            .mockResolvedValueOnce(new Response('{"error":{"message":"stream not supported"}}', { status: 400 }))
            .mockResolvedValueOnce(okJson)
            .mockResolvedValueOnce(okJson2);
        vi.stubGlobal('fetch', fetchMock);

        const client = new LLMClient({ config: CONFIG });
        const res = await client.chat([{ role: 'user', content: 'hi' }]);
        expect(res.content).toBe('fallback-ok');

        // 三次请求：带 stream_options / 不带 stream_options / 非流式
        expect(fetchMock).toHaveBeenCalledTimes(3);
        const b1 = JSON.parse(fetchMock.mock.calls[0][1].body);
        const b2 = JSON.parse(fetchMock.mock.calls[1][1].body);
        const b3 = JSON.parse(fetchMock.mock.calls[2][1].body);
        expect(b1.stream_options).toBeDefined();
        expect(b2.stream).toBe(true);
        expect(b2.stream_options).toBeUndefined();
        expect(b3.stream).toBeUndefined();

        // streamingDisabled 已置位：第二次 chat 直接非流式
        const res2 = await client.chat([{ role: 'user', content: 'again' }]);
        expect(res2.content).toBe('second-ok');
        const b4 = JSON.parse(fetchMock.mock.calls[3][1].body);
        expect(b4.stream).toBeUndefined();
    });

    it('流式空闲超时：数据停止后按 timeoutMs 中断并报空闲超时', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation((_url: string, init: RequestInit) =>
                Promise.resolve(
                    sseResponse([deltaEvent('partial')], { hangAfter: true, signal: init.signal as AbortSignal }),
                ),
            ),
        );
        const client = new LLMClient({ config: CONFIG, timeoutMs: 100, maxRetries: 0 });
        await expect(client.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/空闲超时/);
    });
});
