import { describe, it, expect } from 'vitest';
import { analyzeModules } from '../dist/index.js';
import type { FileNode } from '../dist/index.js';

function file(relativePath: string): FileNode {
    return {
        path: '/repo/' + relativePath,
        relativePath,
        nodeType: 'file',
        sizeBytes: 100,
    };
}

describe('analyzeModules (no-LLM fallback)', () => {
    it('groups files by their top-two directory segments and infers category', async () => {
        const files = [
            file('src/api/routes.ts'),
            file('src/api/handlers.ts'),
            file('src/components/Button.tsx'),
        ];
        const modules = await analyzeModules('/repo', files, null, 1);

        const dirs = modules.map((m) => m.directory).sort();
        expect(dirs).toEqual(['src/api', 'src/components']);

        const api = modules.find((m) => m.directory === 'src/api')!;
        expect(api.moduleName).toBe('api');
        expect(api.category).toBe('api');
        expect(api.files).toHaveLength(2);
        expect(api.summary).not.toBe(''); // basic summary populated

        const comp = modules.find((m) => m.directory === 'src/components')!;
        expect(comp.category).toBe('components');
    });
});
