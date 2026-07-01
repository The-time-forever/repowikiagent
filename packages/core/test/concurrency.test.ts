import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../dist/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapWithConcurrency', () => {
    it('preserves input order in results', async () => {
        const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
            await sleep(n % 2 === 0 ? 5 : 15);
            return n * 10;
        });
        expect(out).toEqual([10, 20, 30, 40, 50]);
    });

    it('never exceeds the concurrency limit', async () => {
        let active = 0;
        let peak = 0;
        await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
            active += 1;
            peak = Math.max(peak, active);
            await sleep(5);
            active -= 1;
        });
        expect(peak).toBeLessThanOrEqual(4);
        expect(peak).toBeGreaterThan(1);
    });

    it('propagates the first error', async () => {
        await expect(
            mapWithConcurrency([1, 2, 3], 2, async (n) => {
                if (n === 2) throw new Error('boom');
                return n;
            }),
        ).rejects.toThrow('boom');
    });

    it('handles an empty input', async () => {
        expect(await mapWithConcurrency([], 3, async (x) => x)).toEqual([]);
    });
});
