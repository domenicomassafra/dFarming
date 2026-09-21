import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AuthProvider } from '../plugin.js';
import { bearerMatches, bearerToken } from '../security/bearer.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfBlocked(reply: FastifyReply): FastifyReply {
    return reply.code(403).send({
        error: 'Cross-origin write blocked. Send an Authorization: Bearer token for API clients, '
            + 'or add the origin to PHONE_FARM_TRUSTED_ORIGINS.',
    });
}

export function trustedOrigins(
    publicOrigin = process.env.PUBLIC_ORIGIN,
    configured = process.env.PHONE_FARM_TRUSTED_ORIGINS,
): string[] {
    return [publicOrigin, ...(configured ?? '').split(',')]
        .map((value) => value?.trim().replace(/\/+$/, ''))
        .filter((value): value is string => Boolean(value));
}

export function sameOriginAllowed(origin: string, host: string | undefined): boolean {
    if (!host) return false;
    let originHost: string;
    try { originHost = new URL(origin).host; } catch { return false; }
    return ['http', 'https'].some((scheme) => {
        try { return new URL(`${scheme}://${host}`).host === originHost; } catch { return false; }
    });
}

export function internalWorkerAuthorized(
    request: FastifyRequest,
    expected = process.env.PHONE_FARM_INTERNAL_TOKEN,
): boolean {
    return bearerMatches(request.headers.authorization, expected);
}

export function installCsrfGuard(app: FastifyInstance): void {
    app.addHook('onRequest', async (request, reply) => {
        if (SAFE_METHODS.has(request.method)) return;
        if (bearerToken(request.headers.authorization)) return;
        const origin = request.headers.origin;
        if (!origin) return csrfBlocked(reply);

        const configured = trustedOrigins();
        if (configured.length) {
            if (!configured.includes(origin.replace(/\/+$/, ''))) return csrfBlocked(reply);
            return;
        }

        // Nothing configured: same-origin only, compared by host (ignoring
        // scheme) so TLS termination does not require x-forwarded-proto.
        if (!sameOriginAllowed(origin, request.headers.host)) return csrfBlocked(reply);
    });
}

export async function installAuthentication(
    app: FastifyInstance,
    authProvider: AuthProvider | null | undefined,
): Promise<void> {
    if (!authProvider) return;
    await authProvider.registerRoutes(app);
    app.addHook('onRequest', async (request, reply) => {
        if (request.url.startsWith('/api/internal/') && internalWorkerAuthorized(request)) return;
        if (authProvider.isPublicPath(request.url.split('?')[0] ?? request.url)) return;
        const user = await authProvider.authenticate(request, reply);
        if (!user && !reply.sent) await reply.code(401).send({ error: 'Authentication required' });
    });
}
