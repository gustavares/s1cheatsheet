/**
 * @file patches.ts
 * @description S-1 patch model, validation and JSON import/export (no DOM, no state).
 *
 * The S-1's MIDI implementation chart lists no System Exclusive messages, so the unit can't
 * dump its current sound. A patch is therefore the set of CC values this page has seen (sent or
 * received since connecting), and recalling it sends those CCs back to the S-1.
 */
import { CONTROL_CHANGES, type CcEntry } from '#lib/midi.js';

export interface Patch {
	id: string;
	name: string;
	/** ISO timestamp. */
	createdAt: string;
	/** CC number → value 0–127. Missing CCs were unknown when the patch was saved. */
	values: Record<string, number>;
}

export const PATCH_FILE_FORMAT = 's1cheatsheet.patches';
export const PATCH_FILE_VERSION = 1;
export const MAX_NAME_LENGTH = 60;

/**
 * Tone parameters a patch stores: every CC the S-1 receives that belongs to a panel control.
 * Left out: standard performance controllers (mod wheel, pan, expression, damper, portamento)
 * and CC 77 TRANSPOSE SW, which the S-1 receives but which isn't part of a sound.
 */
const LAYER_ORDER: Record<CcEntry['layer'], number> = {
	function: 0,
	'shift-knob': 1,
	knob: 2,
	performance: 3
};

export const PATCH_PARAMETERS: CcEntry[] = CONTROL_CHANGES.filter(
	(entry) => entry.rx && entry.layer !== 'performance' && entry.cc !== 77
).sort((a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer] || a.cc - b.cc);

const PATCH_CC_SET = new Set(PATCH_PARAMETERS.map((entry) => entry.cc));
export const KNOB_PARAMETERS = PATCH_PARAMETERS.filter((entry) => entry.layer === 'knob');

/** Keeps only valid tone-parameter CCs with integer values 0–127. */
export function cleanValues(values: Record<string | number, unknown>): Record<string, number> {
	const clean: Record<string, number> = {};
	for (const [key, raw] of Object.entries(values)) {
		const cc = Number(key);
		if (!PATCH_CC_SET.has(cc) || typeof raw !== 'number' || !Number.isFinite(raw)) continue;
		clean[String(cc)] = Math.max(0, Math.min(127, Math.round(raw)));
	}
	return clean;
}

/** How many knob and SHIFT/menu parameters a set of values covers. */
export function coverage(values: Record<string, number>) {
	const knobs = KNOB_PARAMETERS.filter((e) => String(e.cc) in values).length;
	const others = PATCH_PARAMETERS.length - KNOB_PARAMETERS.length;
	const otherKnown = PATCH_PARAMETERS.filter(
		(e) => e.layer !== 'knob' && String(e.cc) in values
	).length;
	return {
		knobs,
		knobTotal: KNOB_PARAMETERS.length,
		others: otherKnown,
		otherTotal: others
	};
}

/** [cc, value] pairs in recall order: modes and switches first, then SHIFT layers, then knobs. */
export function recallMessages(values: Record<string, number>): [number, number][] {
	return PATCH_PARAMETERS.filter((e) => String(e.cc) in values).map((e) => [
		e.cc,
		values[String(e.cc)]
	]);
}

export function newPatchId(): string {
	return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createPatch(name: string, values: Record<string | number, unknown>): Patch {
	return {
		id: newPatchId(),
		name: name.trim().slice(0, MAX_NAME_LENGTH) || 'Untitled patch',
		createdAt: new Date().toISOString(),
		values: cleanValues(values)
	};
}

export function exportPatches(patches: Patch[]): string {
	return JSON.stringify(
		{
			format: PATCH_FILE_FORMAT,
			version: PATCH_FILE_VERSION,
			device: 'Roland S-1',
			exportedAt: new Date().toISOString(),
			patches
		},
		null,
		2
	);
}

export interface ImportResult {
	patches: Patch[];
	skipped: number;
}

/** Parses an exported file; throws a readable Error if it isn't one. */
export function parsePatchFile(text: string): ImportResult {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('This file isn’t valid JSON.');
	}
	const file = data as { format?: unknown; version?: unknown; patches?: unknown };
	if (!file || file.format !== PATCH_FILE_FORMAT || !Array.isArray(file.patches)) {
		throw new Error('This isn’t an S-1 cheat sheet patch file.');
	}
	if (typeof file.version !== 'number' || file.version > PATCH_FILE_VERSION) {
		throw new Error('This patch file was made by a newer version of the cheat sheet.');
	}
	const patches: Patch[] = [];
	let skipped = 0;
	for (const raw of file.patches as unknown[]) {
		const p = raw as Partial<Patch> | null;
		if (!p || typeof p.name !== 'string' || !p.values || typeof p.values !== 'object') {
			skipped++;
			continue;
		}
		const values = cleanValues(p.values as Record<string, unknown>);
		if (Object.keys(values).length === 0) {
			skipped++;
			continue;
		}
		patches.push({
			id: typeof p.id === 'string' && p.id ? p.id : newPatchId(),
			name: p.name.trim().slice(0, MAX_NAME_LENGTH) || 'Untitled patch',
			createdAt:
				typeof p.createdAt === 'string' && !Number.isNaN(Date.parse(p.createdAt))
					? p.createdAt
					: new Date().toISOString(),
			values
		});
	}
	return { patches, skipped };
}
