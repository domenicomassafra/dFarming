import type { ScreenSize } from '../devices/wda-remote.js';

/**
 * Token-efficient WDA accessibility snapshots.
 *
 * The ref/generation model is intentionally similar to browser automation:
 * callers act on short refs from the latest snapshot instead of guessing pixel
 * coordinates. Design research was informed by teddyoweh/iphone-mcp (MIT) and
 * Oceanswave/hermes-iphone-plugin (MIT); this implementation is kept local to
 * the farm's existing WDA lifecycle and multi-device state model.
 */

export interface SemanticRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SemanticElement {
    ref: string;
    type: string;
    label: string;
    value?: string;
    rect: SemanticRect;
    center: { x: number; y: number };
    enabled: boolean;
    scrollable: boolean;
}

export interface SemanticSnapshot {
    deviceUdid: string;
    generation: number;
    count: number;
    offscreen: number;
    keyboardUp: boolean;
    truncated: boolean;
    text: string;
    elements: SemanticElement[];
}

export interface SemanticSnapshotOptions {
    query?: string;
    maxNodes?: number;
    includeOffscreen?: boolean;
}

interface RawNode {
    type?: unknown;
    name?: unknown;
    label?: unknown;
    value?: unknown;
    rect?: unknown;
    isVisible?: unknown;
    visible?: unknown;
    isEnabled?: unknown;
    enabled?: unknown;
    children?: unknown;
}

interface DeviceSnapshotState {
    generation: number;
    refs: Map<string, SemanticElement>;
}

const INTERACTIVE = new Set([
    'Button', 'Cell', 'TextField', 'SecureTextField', 'TextView', 'SearchField', 'Switch', 'Slider',
    'Link', 'MenuItem', 'Menu', 'Tab', 'PickerWheel', 'Picker', 'SegmentedControl', 'Icon', 'Key',
    'Stepper', 'DatePicker', 'Toggle', 'CheckBox', 'RadioButton', 'PopUpButton', 'DisclosureTriangle',
]);
const TEXTUAL = new Set(['StaticText', 'Image', 'TextView']);
const LANDMARK = new Set(['NavigationBar', 'TabBar', 'Alert', 'Sheet', 'Toolbar', 'ActivityIndicator', 'StatusBar']);
const SCROLLABLE = new Set(['ScrollView', 'Table', 'CollectionView', 'WebView']);

function booleanish(value: unknown, fallback = false): boolean {
    if (value === undefined || value === null) return fallback;
    return value === true || value === 1 || value === '1' || value === 'true';
}

function clean(value: unknown, max = 120): string {
    if (typeof value !== 'string') return '';
    const compact = value.replace(/\s+/g, ' ').trim();
    return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function shortType(value: unknown): string {
    if (typeof value !== 'string' || !value) return 'Other';
    const raw = value.replace(/^XCUIElementType/, '').split('.').at(-1) ?? value;
    const aliases: Record<string, string> = {
        EditText: 'TextField', TextView: 'StaticText', ImageView: 'Image', ImageButton: 'Button',
        RecyclerView: 'CollectionView', ListView: 'Table', ViewPager: 'ScrollView',
    };
    return aliases[raw] ?? raw;
}

function rect(value: unknown): SemanticRect | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const candidate = {
        x: Number(record.x), y: Number(record.y), width: Number(record.width), height: Number(record.height),
    };
    return Object.values(candidate).every(Number.isFinite) ? candidate : undefined;
}

function children(node: RawNode): RawNode[] {
    return Array.isArray(node.children)
        ? node.children.filter((child): child is RawNode => Boolean(child) && typeof child === 'object' && !Array.isArray(child))
        : [];
}

export class SemanticSnapshotStore {
    private readonly states = new Map<string, DeviceSnapshotState>();

    build(deviceUdid: string, root: unknown, screen: ScreenSize, options: SemanticSnapshotOptions = {}): SemanticSnapshot {
        if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('WDA returned an invalid accessibility tree');
        const previous = this.states.get(deviceUdid);
        const generation = (previous?.generation ?? 0) + 1;
        const refs = new Map<string, SemanticElement>();
        this.states.set(deviceUdid, { generation, refs });

        const maxNodes = Math.max(1, Math.min(500, options.maxNodes ?? 250));
        const query = options.query?.trim().toLowerCase();
        const elements: SemanticElement[] = [];
        const lines: string[] = [];
        let offscreen = 0;
        let keyboardUp = false;
        let truncated = false;

        const onScreen = (box: SemanticRect) => box.x < screen.width && box.y < screen.height
            && box.x + box.width > 0 && box.y + box.height > 0;

        const walk = (node: RawNode, depth: number, ancestorLabels: ReadonlySet<string>): void => {
            if (truncated) return;
            const type = shortType(node.type);
            if (type === 'Keyboard') keyboardUp = true;
            const box = rect(node.rect);
            const label = clean(node.label ?? node.name);
            const rawValue = clean(node.value, 80);
            const value = rawValue && rawValue !== label ? rawValue : '';
            const visible = booleanish(node.isVisible ?? node.visible, true);
            const enabled = booleanish(node.isEnabled ?? node.enabled, true);
            const scrollable = SCROLLABLE.has(type);
            let emitted = false;

            if (box && box.width > 0 && box.height > 0) {
                if (!onScreen(box)) {
                    if ((INTERACTIVE.has(type) || TEXTUAL.has(type)) && label) offscreen++;
                    if (!options.includeOffscreen) {
                        for (const child of children(node)) walk(child, depth, ancestorLabels);
                        return;
                    }
                }
                const interesting = (INTERACTIVE.has(type) && (label || value || type === 'Cell'))
                    || (TEXTUAL.has(type) && Boolean(label))
                    || (LANDMARK.has(type) && (Boolean(label) || type === 'Alert' || type === 'Sheet'))
                    || (scrollable && box.height > 100);
                const echo = TEXTUAL.has(type) && Boolean(label) && ancestorLabels.has(label);
                const matches = !query || label.toLowerCase().includes(query)
                    || value.toLowerCase().includes(query) || type.toLowerCase().includes(query);
                if (interesting && !echo && visible && matches) {
                    if (elements.length >= maxNodes) {
                        truncated = true;
                        return;
                    }
                    const ref = `e${elements.length + 1}`;
                    const center = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
                    const element: SemanticElement = {
                        ref, type, label, ...(value ? { value } : {}), rect: box, center, enabled, scrollable,
                    };
                    elements.push(element);
                    refs.set(ref, element);
                    const parts = [`[${ref}]`, type];
                    if (label) parts.push(JSON.stringify(label));
                    if (value) parts.push(`value=${JSON.stringify(value)}`);
                    if (scrollable) parts.push('(scrollable)');
                    if (!enabled) parts.push('(disabled)');
                    lines.push(`${'  '.repeat(Math.min(depth, 8))}${parts.join(' ')} @${center.x},${center.y}`);
                    emitted = true;
                }
            }

            const nextLabels = emitted && label ? new Set([...ancestorLabels, label]) : ancestorLabels;
            for (const child of children(node)) walk(child, emitted ? depth + 1 : depth, nextLabels);
        };

        walk(root as RawNode, 0, new Set());
        const header: string[] = [];
        if (truncated) header.push(`(truncated at ${maxNodes} elements; filter with query)`);
        if (offscreen) header.push(`(${offscreen} labelled elements are offscreen)`);
        if (keyboardUp) header.push('(keyboard is up)');
        return {
            deviceUdid, generation, count: elements.length, offscreen, keyboardUp, truncated,
            text: [...header, ...lines].join('\n') || '(no actionable elements found)', elements,
        };
    }

    resolve(deviceUdid: string, generation: number, ref: string): SemanticElement {
        const state = this.states.get(deviceUdid);
        if (!state) throw new Error('No semantic snapshot exists for this device');
        if (state.generation !== generation) {
            throw new Error(`Snapshot generation ${generation} is stale; current generation is ${state.generation}`);
        }
        const element = state.refs.get(ref);
        if (!element) throw new Error(`Unknown semantic element ref ${ref}`);
        return element;
    }

    find(snapshot: SemanticSnapshot, text: string, type?: string): SemanticElement[] {
        const query = text.trim().toLowerCase();
        const wanted = type?.replace(/^XCUIElementType/, '').toLowerCase();
        return snapshot.elements
            .filter((element) => !wanted || element.type.toLowerCase() === wanted)
            .filter((element) => !query || `${element.label} ${element.value ?? ''}`.toLowerCase().includes(query))
            .sort((a, b) => {
                const score = (element: SemanticElement) => element.label.toLowerCase() === query ? 2
                    : element.label.toLowerCase().startsWith(query) ? 1 : 0;
                return score(b) - score(a);
            });
    }
}
