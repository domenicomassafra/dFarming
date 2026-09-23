import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type CommandRunner = (
    executable: string,
    args: string[],
    options: { timeout: number; maxBuffer: number },
) => Promise<unknown>;

export async function captureIosSimulatorScreenshot(
    udid: string,
    options: { run?: CommandRunner; temporaryRoot?: string } = {},
): Promise<Buffer> {
    if (!udid.trim()) throw new Error('iOS Simulator UDID is required');
    const run = options.run ?? (execFileAsync as CommandRunner);
    const directory = await mkdtemp(path.join(options.temporaryRoot ?? os.tmpdir(), 'dfarming-simctl-shot-'));
    const output = path.join(directory, 'screenshot.png');
    try {
        await run('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', output], {
            timeout: 10_000,
            maxBuffer: 512 * 1024,
        });
        const image = await readFile(output);
        if (image.length < 8 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
            throw new Error('simctl returned an invalid PNG screenshot');
        }
        return image;
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
