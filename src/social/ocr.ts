import { createRequire } from 'node:module';

// node-native-ocr@0.4.18 ships a stale .d.ts declaring an `output` option,
// while the installed runtime reads `format`. Keep the compatibility shim in
// one place so every social surface uses the same OCR contract.
type RealRecognizeOptions = { lang?: string; format?: 'txt' | 'tsv' };
type Recognize = (image: Buffer, options?: RealRecognizeOptions) => Promise<string>;
const require = createRequire(import.meta.url);
let recognizeRaw: Recognize | undefined;

function recognizer(): Recognize {
    if (recognizeRaw) return recognizeRaw;
    // OCR is an execution-worker capability, not a control-plane dependency.
    // Resolve it lazily so MiniPC production images do not need the native OCR
    // package merely to load plugin metadata and pure validation helpers.
    const module = require('node-native-ocr') as { recognize: unknown };
    recognizeRaw = module.recognize as Recognize;
    return recognizeRaw;
}

export interface OcrWord {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
}

const MIN_CONFIDENCE = 40;

export function parseTsv(tsv: string): OcrWord[] {
    const words: OcrWord[] = [];
    for (const line of tsv.split('\n')) {
        if (!line.trim()) continue;
        const columns = line.split('\t');
        if (columns.length < 12 || columns[0] !== '5') continue;
        const confidence = Number(columns[10]);
        const text = columns[11].trim();
        if (!text || !Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) continue;
        words.push({
            text,
            x: Number(columns[6]),
            y: Number(columns[7]),
            width: Number(columns[8]),
            height: Number(columns[9]),
            confidence,
        });
    }
    return words;
}

export async function recognizeWords(image: Buffer): Promise<OcrWord[]> {
    const tsv = await recognizer()(image, { format: 'tsv' });
    return parseTsv(tsv);
}

function normalizeHandle(handle: string): string {
    return handle.trim().toLowerCase().replace(/^@/, '');
}

export function findHandleMatch(words: OcrWord[], targetHandle: string): OcrWord | undefined {
    const target = normalizeHandle(targetHandle);
    if (!target) return undefined;
    const exact = words.find((word) => normalizeHandle(word.text) === target);
    if (exact) return exact;
    const fuzzy = words.find((word) => {
        const normalized = normalizeHandle(word.text);
        if (normalized.length < 4 || target.length < 4) return false;
        const [shorter, longer] = normalized.length <= target.length ? [normalized, target] : [target, normalized];
        return shorter.length / longer.length >= 0.5 && longer.includes(shorter);
    });
    if (fuzzy) {
        console.log(`Account handle matched fuzzily: OCR saw "${fuzzy.text}" for target "${targetHandle}"`);
    }
    return fuzzy;
}

// Screenshots are device-pixel resolution; WDA/Appium taps use point-space.
export function pointFromWord(word: OcrWord, scale: number): { x: number; y: number } {
    return {
        x: Math.round((word.x + word.width / 2) / scale),
        y: Math.round((word.y + word.height / 2) / scale),
    };
}
