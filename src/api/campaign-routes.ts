import type { FastifyInstance } from 'fastify';

import { planCampaign, type CreateCampaignInput } from '../campaigns.js';
import { loadRegisteredDevices } from '../devices/registry.js';
import type { PluginRegistry } from '../registry.js';
import type { SchedulerRepository } from '../scheduler/repository.js';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function registerCampaignRoutes(
    app: FastifyInstance,
    scheduler: SchedulerRepository,
    plugins: PluginRegistry,
): void {
    app.get('/api/campaigns', async () => ({ campaigns: await scheduler.listCampaigns(200) }));

    app.post<{ Body: CreateCampaignInput }>('/api/campaigns', async (request, reply) => {
        const devices = await loadRegisteredDevices();
        const pluginDataByDevice = new Map(devices.map((device) => [
            device.udid, device.pluginData[request.body.task.pluginId] ?? {},
        ]));
        const plan = planCampaign(plugins, request.body, pluginDataByDevice);
        if (plan.targets.some((target) => devices.find(({ udid }) => udid === target.deviceUdid)?.disabled)) {
            return reply.code(409).send({ error: 'Campaign targets include a disabled device' });
        }
        const campaign = await scheduler.createCampaign(plan);
        return reply.code(201).send({
            campaign,
            plan: {
                targetCount: plan.targets.length,
                requiresFanOutConfirmation: plan.requiresFanOutConfirmation,
                requiresPublicActionConfirmation: plan.requiresPublicActionConfirmation,
            },
        });
    });

    app.post<{
        Params: { id: string };
        Body: { confirmFanOut?: boolean; confirmPublicActions?: boolean };
    }>('/api/campaigns/:id/launch', async (request, reply) => {
        const campaign = await scheduler.campaign(request.params.id);
        if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });
        const devices = await loadRegisteredDevices();
        const pluginDataByDevice = new Map(devices.map((device) => [
            device.udid, device.pluginData[campaign.task.pluginId] ?? {},
        ]));
        const plan = planCampaign(plugins, {
            name: campaign.name,
            task: campaign.task,
            timing: campaign.timing,
            runWindowMinutes: campaign.runWindowMinutes,
            targets: campaign.targets,
        }, pluginDataByDevice);
        if (plan.targets.some((target) => devices.find(({ udid }) => udid === target.deviceUdid)?.disabled)) {
            return reply.code(409).send({ error: 'Campaign targets include a disabled device' });
        }
        try {
            return await scheduler.launchCampaign(request.params.id, plan, {
                fanOut: request.body.confirmFanOut,
                publicActions: request.body.confirmPublicActions,
            });
        } catch (error) {
            return reply.code(409).send({ error: errorMessage(error) });
        }
    });

    app.post<{ Params: { id: string } }>('/api/campaigns/:id/cancel', async (request, reply) => {
        const campaign = await scheduler.cancelCampaign(request.params.id);
        return campaign ?? reply.code(404).send({ error: 'Campaign not found' });
    });
}
