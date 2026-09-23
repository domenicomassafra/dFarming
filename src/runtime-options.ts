import { dfarmingEnv } from './env.js';

export function physicalIosLaneEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return dfarmingEnv('ENABLE_PHYSICAL_IOS', env) !== 'false';
}
