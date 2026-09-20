import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

async function sourceFiles(directory = sourceRoot): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(target);
        return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
    }));
    return nested.flat();
}

test('source keeps one canonical RegisteredDevice contract and no package self-imports', async () => {
    const files = await sourceFiles();
    const bodies = await Promise.all(files.map(async (file) => ({
        file,
        body: await readFile(file, 'utf8'),
    })));
    const selfImports = bodies.filter(({ body }) => body.includes("from '@domenicomassafra/dfarming-core"));
    assert.deepEqual(selfImports.map(({ file }) => path.relative(sourceRoot, file)), []);

    const declarations = bodies.flatMap(({ file, body }) => (
        /export\s+interface\s+RegisteredDevice\b/.test(body) ? [path.relative(sourceRoot, file)] : []
    ));
    assert.deepEqual(declarations, ['types.ts']);
});

test('platform subprocesses stay behind device transport adapters', async () => {
    const directTransportProcess = /(?:execFileAsync|spawn)\(\s*['"](?:adb|xcrun|emulator)['"]/;
    const findings: string[] = [];
    for (const file of await sourceFiles()) {
        const relative = path.relative(sourceRoot, file);
        const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
        lines.forEach((line, index) => {
            if (directTransportProcess.test(line) && !relative.startsWith(`devices${path.sep}`)) {
                findings.push(`${relative}:${index + 1}: ${line.trim()}`);
            }
        });
    }
    assert.deepEqual(findings, []);
});
