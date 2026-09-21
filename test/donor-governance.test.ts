import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface DonorLock {
    schemaVersion: number;
    donors: Array<{ id: string; upstream: string; fork: string; sha: string; license: string; runtimeImage?: string }>;
}
interface AdapterRegistry {
    schemaVersion: number;
    adapters: Array<{ id: string; status: string; implementation?: string; failureMode: string }>;
}

test('every approved donor is immutable, licensed, and has an explicit adoption decision', async () => {
    const lock = JSON.parse(await readFile(path.join(root, 'donors.lock.json'), 'utf8')) as DonorLock;
    const registry = JSON.parse(await readFile(path.join(root, 'donor-adapters.json'), 'utf8')) as AdapterRegistry;
    assert.equal(lock.schemaVersion, 1);
    assert.equal(registry.schemaVersion, 1);
    assert.equal(new Set(lock.donors.map(({ id }) => id)).size, lock.donors.length);
    assert.equal(new Set(registry.adapters.map(({ id }) => id)).size, registry.adapters.length);
    assert.deepEqual(registry.adapters.map(({ id }) => id).sort(), lock.donors.map(({ id }) => id).sort());
    for (const donor of lock.donors) {
        assert.match(donor.sha, /^[0-9a-f]{40}$/);
        assert.match(donor.upstream, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
        assert.match(donor.fork, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
        assert.ok(['Apache-2.0', 'MIT', 'GPL-3.0'].includes(donor.license));
        if (donor.runtimeImage) {
            assert.match(donor.runtimeImage, /@sha256:[0-9a-f]{64}$/);
            assert.doesNotMatch(donor.runtimeImage, /:latest(?:@|$)/);
        }
    }
    for (const adapter of registry.adapters) {
        assert.ok(adapter.failureMode.length >= 20, `${adapter.id} needs an explicit failure mode`);
        if (adapter.status === 'promoted') {
            assert.ok(adapter.implementation, `${adapter.id} promoted without implementation`);
            await access(path.join(root, adapter.implementation!));
        }
    }
});

test('promoted Google emulator packaging uses the exact donor-locked image digest', async () => {
    const lock = JSON.parse(await readFile(path.join(root, 'donors.lock.json'), 'utf8')) as DonorLock;
    const donor = lock.donors.find(({ id }) => id === 'android-emulator-containers');
    assert.ok(donor?.runtimeImage);
    const installer = await readFile(path.join(root, 'deploy', 'setup-google-android-emulator.sh'), 'utf8');
    assert.ok(installer.includes(donor.runtimeImage));
});

test('GPL pymobiledevice3 remains outside the linked runtime dependency graph', async () => {
    const packageJson = await readFile(path.join(root, 'package.json'), 'utf8');
    assert.equal(packageJson.includes('pymobiledevice3'), false);
    const registry = JSON.parse(await readFile(path.join(root, 'donor-adapters.json'), 'utf8')) as AdapterRegistry;
    assert.equal(registry.adapters.find(({ id }) => id === 'pymobiledevice3')?.status, 'held-external-only');
});
