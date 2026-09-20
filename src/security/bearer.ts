import crypto from 'node:crypto';

export function bearerToken(value: string | undefined): string | undefined {
    if (!value?.startsWith('Bearer ')) return;
    const token = value.slice('Bearer '.length).trim();
    return token || undefined;
}

export function constantTimeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function bearerMatches(value: string | undefined, expected: string | undefined): boolean {
    if (!expected) return false;
    const supplied = bearerToken(value);
    return supplied !== undefined && constantTimeEqual(supplied, expected);
}
