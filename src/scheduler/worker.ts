import type { JobWithMetadata } from 'pg-boss';

import { assertDatabaseReady, createDatabaseConnection } from '../database/client.js';
import { defaultPlugins } from '../default-plugins.js';
import { activeDevices, loadRegisteredDevices } from '../devices/registry.js';
import { PluginRegistry } from '../registry.js';
import { executeAutomation } from './executor.js';
import { createQueue, ensureDeviceQueue, type ExecutionJob } from './queue.js';
import { SchedulerRepository } from './repository.js';
import { isEntrypoint } from '../entrypoint.js';

export interface WorkerRuntime { close(): Promise<void> }

export async function startWorker(plugins: PluginRegistry): Promise<WorkerRuntime> {
    const connection = createDatabaseConnection();
    await assertDatabaseReady(connection);
    const boss = createQueue();
    await boss.start();
    const repository = new SchedulerRepository(connection, boss, plugins);
    const workingQueues = new Set<string>();

    const registerDeviceWorkers = async (): Promise<void> => {
        for (const device of activeDevices(await loadRegisteredDevices())) {
            const queue = await ensureDeviceQueue(boss, device.udid);
            if (workingQueues.has(queue)) continue;
            await boss.work<ExecutionJob>(queue, { includeMetadata: true }, async ([job]) => {
                if (!job) return;
                const metadata = job as JobWithMetadata<ExecutionJob>;
                const attempt = metadata.retryCount + 1;
                const execution = await repository.startAttempt(job.data.executionId, attempt);
                if (!execution) return;
                const result = await executeAutomation(repository, plugins, execution, attempt, job.signal);
                await repository.finishAttempt(execution.id, attempt, result.exitCode, result.error);
                if (result.stopped) {
                    await repository.finishExecution(execution.id, 'stopped', result.exitCode, result.error);
                    return;
                }
                if (!result.error && result.exitCode === 0) {
                    await repository.finishExecution(execution.id, 'succeeded', 0);
                    return;
                }
                const message = result.error ?? 'Automation failed';
                const task = plugins.task({
                    pluginId: execution.pluginId, taskType: execution.taskType,
                    taskVersion: execution.taskVersion, payload: execution.payload,
                });
                const policy = task.retryPolicy(execution.payload);
                if (metadata.retryCount < policy.retryLimit && Date.now() < execution.deadlineAt.getTime()) {
                    await repository.resetForRetry(execution.id, message);
                    throw new Error(message);
                }
                await repository.finishExecution(execution.id, 'failed', result.exitCode, message);
            });
            workingQueues.add(queue);
            console.log(`Worker listening on ${queue} for ${device.name}`);
        }
    };

    await registerDeviceWorkers();
    await repository.reconcileQueueStates();
    await repository.materializeDue();
    const materializeTimer = setInterval(() => void repository.materializeDue().catch(console.error), 5_000);
    const deviceTimer = setInterval(() => void registerDeviceWorkers().catch(console.error), 30_000);
    const cleanupTimer = setInterval(() => {
        void repository.cleanup().catch(console.error);
        void repository.sweepOrphanedAssets().catch(console.error);
    }, 60 * 60_000);
    const reconcileTimer = setInterval(() => void repository.reconcileQueueStates().catch(console.error), 15_000);
    return {
        async close() {
            clearInterval(materializeTimer);
            clearInterval(deviceTimer);
            clearInterval(cleanupTimer);
            clearInterval(reconcileTimer);
            await boss.stop({ graceful: true, timeout: 30_000 });
            await connection.close();
        },
    };
}

async function main(): Promise<void> {
    const plugins = new PluginRegistry(await defaultPlugins());
    const runtime = await startWorker(plugins);
    const shutdown = async (signal: string) => {
        console.log(`Scheduler worker stopping after ${signal}`);
        await runtime.close();
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

if (isEntrypoint(import.meta.url)) await main();
