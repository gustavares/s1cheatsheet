/**
 * @file sequencer.ts
 * @description Browser-side step sequencer model (pure): patterns, timing, parameter-lock lanes
 * and Standard MIDI File export.
 *
 * The S-1 can't hand its own patterns over MIDI: its implementation chart lists no System
 * Exclusive, Song Position or Song Select (Program Change only selects patterns), so patterns
 * live in the browser and play the S-1 as notes plus CC parameter locks.
 */
import { CC_BY_NUMBER } from '#lib/midi.js';

export const STEPS_PER_PAGE = 16;
export const LENGTHS = [16, 32, 48, 64] as const;
export const MAX_STEPS = 64;
/** 24 MIDI clocks per quarter note → 6 per sixteenth-note step. */
export const CLOCKS_PER_STEP = 6;

export interface Step {
	/** Notes played on this step (empty = rest). */
	notes: number[];
	velocity: number;
	/** Note length as a fraction of the step (0.1–1). */
	gate: number;
	/** Parameter locks: CC number → value on this step only. */
	locks: Record<string, number>;
}

export interface Lane {
	cc: number;
	/** Value sent on steps without a lock (only when the lane has at least one lock). */
	base: number;
}

export interface Pattern {
	id: string;
	name: string;
	length: number;
	bpm: number;
	/** 0–1: delays every second sixteenth by up to half a step. */
	swing: number;
	steps: Step[];
	lanes: Lane[];
	updatedAt: number;
}

export const EXPORT_FORMAT = 's1cheatsheet.patterns';

/** Knob CCs offered as lock lanes (they're what the S-1 drawing labels them). */
export const LOCKABLE_CCS = [74, 71, 24, 25, 75, 72, 73, 30, 13, 19, 20, 21, 23, 92, 91, 3];

export function newPatternId(): string {
	return `pat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyStep(): Step {
	return { notes: [], velocity: 100, gate: 0.5, locks: {} };
}

/** A short A-minor bassline with a filter lock, so Play does something straight away. */
export function demoPattern(): Pattern {
	const steps = Array.from({ length: MAX_STEPS }, emptyStep);
	const line: [number, number, number, number][] = [
		// step, note, velocity, gate
		[0, 45, 120, 0.45],
		[3, 45, 90, 0.3],
		[6, 57, 105, 0.45],
		[8, 45, 120, 0.45],
		[10, 48, 95, 0.3],
		[11, 52, 100, 0.3],
		[13, 55, 110, 0.6],
		[14, 52, 90, 0.3]
	];
	for (const [i, note, velocity, gate] of line) {
		steps[i] = { notes: [note], velocity, gate, locks: {} };
	}
	steps[0].locks['74'] = 96;
	steps[8].locks['74'] = 44;
	steps[13].locks['74'] = 118;
	return {
		id: newPatternId(),
		name: 'Demo bassline',
		length: 16,
		bpm: 120,
		swing: 0,
		steps,
		lanes: [
			{ cc: 74, base: 70 },
			{ cc: 71, base: 40 }
		],
		updatedAt: Date.now()
	};
}

export function blankPattern(name = 'New pattern'): Pattern {
	return {
		...demoPattern(),
		id: newPatternId(),
		name,
		steps: Array.from({ length: MAX_STEPS }, emptyStep)
	};
}

/** Milliseconds per sixteenth-note step. */
export function stepMs(bpm: number): number {
	return 60000 / bpm / 4;
}

/** Swing delay of a step as a fraction of a step (every second step is late). */
export function swingOffset(step: number, swing: number): number {
	return step % 2 === 1 ? Math.max(0, Math.min(1, swing)) * 0.5 : 0;
}

/** Lanes that have at least one lock within the pattern length (only these send CCs). */
export function activeLanes(p: Pattern): Lane[] {
	return p.lanes.filter((lane) =>
		p.steps.slice(0, p.length).some((s) => String(lane.cc) in s.locks)
	);
}

export function laneLabel(cc: number): string {
	const entry = CC_BY_NUMBER.get(cc);
	if (!entry) return `CC ${cc}`;
	return entry.layer === 'knob' && entry.controls[0] ? entry.controls[0] : entry.parameter;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const int7 = (v: unknown, fallback: number) =>
	typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), 0, 127) : fallback;

/** Makes a stored or imported pattern safe to use (fills gaps, clamps ranges). */
export function normalizePattern(raw: unknown): Pattern | null {
	if (!raw || typeof raw !== 'object') return null;
	const p = raw as Partial<Pattern>;
	if (!Array.isArray(p.steps)) return null;
	const steps = Array.from({ length: MAX_STEPS }, (_, i) => {
		const s = (p.steps?.[i] ?? {}) as Partial<Step>;
		const notes = Array.isArray(s.notes)
			? [...new Set(s.notes.filter((n) => Number.isInteger(n) && n >= 0 && n <= 127))]
			: [];
		const locks: Record<string, number> = {};
		for (const [cc, v] of Object.entries(s.locks ?? {})) {
			if (CC_BY_NUMBER.has(Number(cc))) locks[String(Number(cc))] = int7(v, 64);
		}
		return {
			notes: notes.slice(0, 8),
			velocity: clamp(int7(s.velocity, 100), 1, 127),
			gate: typeof s.gate === 'number' ? clamp(s.gate, 0.1, 1) : 0.5,
			locks
		};
	});
	const lanes = (Array.isArray(p.lanes) ? p.lanes : [])
		.filter((l) => l && CC_BY_NUMBER.has(Number(l.cc)))
		.slice(0, 4)
		.map((l) => ({ cc: Number(l.cc), base: int7(l.base, 64) }));
	return {
		id: typeof p.id === 'string' && p.id ? p.id : newPatternId(),
		name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 60) : 'Pattern',
		length: (LENGTHS as readonly number[]).includes(Number(p.length)) ? Number(p.length) : 16,
		bpm: typeof p.bpm === 'number' ? clamp(Math.round(p.bpm * 10) / 10, 40, 240) : 120,
		swing: typeof p.swing === 'number' ? clamp(p.swing, 0, 1) : 0,
		steps,
		lanes,
		updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now()
	};
}

// ── Standard MIDI File export ──────────────────────────────────────────────────

const PPQ = 96;
const TICKS_PER_STEP = PPQ / 4;

function vlq(value: number): number[] {
	const bytes = [value & 0x7f];
	let v = value >> 7;
	while (v > 0) {
		bytes.unshift((v & 0x7f) | 0x80);
		v >>= 7;
	}
	return bytes;
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0) & 0x7f);
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/**
 * The pattern as a type-0 Standard MIDI File (96 PPQ, one bar per 16 steps): tempo, 4/4,
 * notes with their velocity and gate, swing, and the parameter-lock CCs, all on `channel`
 * (1–16). Ready to drop into Ableton or any DAW.
 */
export function patternToMidiFile(p: Pattern, channel = 1): Uint8Array<ArrayBuffer> {
	const ch = clamp(channel, 1, 16) - 1;
	const events: { tick: number; order: number; bytes: number[] }[] = [];
	const name = ascii(p.name.replace(/[^\x20-\x7e]/g, '?'));
	events.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(name.length), ...name] });
	const tempo = Math.round(60000000 / p.bpm);
	events.push({
		tick: 0,
		order: 0,
		bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff]
	});
	events.push({ tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] });

	const lanes = activeLanes(p);
	const last: Record<number, number> = {};
	for (let i = 0; i < p.length; i++) {
		const step = p.steps[i];
		const tick = Math.round((i + swingOffset(i, p.swing)) * TICKS_PER_STEP);
		for (const lane of lanes) {
			const value = step.locks[String(lane.cc)] ?? lane.base;
			if (last[lane.cc] === value) continue;
			last[lane.cc] = value;
			events.push({ tick, order: 1, bytes: [0xb0 | ch, lane.cc, value] });
		}
		const length = Math.max(1, Math.round(step.gate * TICKS_PER_STEP));
		for (const note of step.notes) {
			events.push({ tick, order: 2, bytes: [0x90 | ch, note, step.velocity] });
			events.push({ tick: tick + length, order: 0, bytes: [0x80 | ch, note, 0] });
		}
	}
	const end = p.length * TICKS_PER_STEP;
	events.push({
		tick: Math.max(end, ...events.map((e) => e.tick)),
		order: 9,
		bytes: [0xff, 0x2f, 0x00]
	});
	events.sort((a, b) => a.tick - b.tick || a.order - b.order);

	const track: number[] = [];
	let now = 0;
	for (const event of events) {
		track.push(...vlq(event.tick - now), ...event.bytes);
		now = event.tick;
	}
	return new Uint8Array([
		...ascii('MThd'),
		...u32(6),
		0x00,
		0x00,
		0x00,
		0x01,
		(PPQ >> 8) & 0xff,
		PPQ & 0xff,
		...ascii('MTrk'),
		...u32(track.length),
		...track
	]);
}
