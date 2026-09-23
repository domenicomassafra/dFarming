/**
 * Canonical dFarming configuration namespace.
 *
 * DFARMING_* wins when both names are present. PHONE_FARM_* is accepted only
 * as a migration alias so existing live nodes can be cut over without losing
 * tokens, worker topology or runtime settings.
 */
export function dfarmingEnv(
    suffix: string,
    env: NodeJS.ProcessEnv = process.env,
): string | undefined {
    return env[`DFARMING_${suffix}`] ?? env[`PHONE_FARM_${suffix}`];
}

export function dfarmingEnvName(suffix: string): string {
    return `DFARMING_${suffix}`;
}
