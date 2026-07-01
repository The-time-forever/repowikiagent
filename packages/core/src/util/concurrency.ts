/**
 * @module concurrency
 * @description 轻量并发工具。用一个简单信号量并发执行任务，
 * 避免引入外部依赖（如 p-limit）。用于让 `--concurrency` 真正生效。
 */

/**
 * 以受限并发映射一组输入。
 *
 * - 保持结果顺序与输入顺序一致。
 * - 任一任务抛错则整体 reject（首个错误），与 `Promise.all` 语义一致。
 *
 * @param items   - 输入数组
 * @param limit   - 最大并发数（<1 时按 1 处理）
 * @param fn      - 针对每个元素的异步处理函数，接收元素与其下标
 * @returns 与输入一一对应的结果数组
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    const effectiveLimit = Math.max(1, Math.floor(limit) || 1);

    if (items.length === 0) {
        return results;
    }

    let nextIndex = 0;

    async function worker(): Promise<void> {
        // 每个 worker 循环领取下一个待处理下标
        while (true) {
            const current = nextIndex++;
            if (current >= items.length) {
                return;
            }
            results[current] = await fn(items[current], current);
        }
    }

    const workerCount = Math.min(effectiveLimit, items.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);

    return results;
}
