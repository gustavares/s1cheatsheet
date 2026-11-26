/**
 * @file midi.ts
 * @description Typed access to the verified S-1 MIDI implementation (data/midi.json).
 */
import midiData from '#lib/data/midi.json';
import type { TipCitation } from '#lib/types.js';

/**
 * knob: the knob's normal operation (sent when you turn it on screen);
 * shift-knob: SHIFT + knob (also reachable from a pad/menu);
 * function: SHIFT + key/pad or a menu setting; performance: standard controller, no panel control.
 */
export type CcLayer = 'knob' | 'shift-knob' | 'function' | 'performance';

export interface CcEntry {
	cc: number;
	parameter: string;
	layer: CcLayer;
	controls: string[];
	tx: boolean;
	rx: boolean;
	note?: string;
	citation: TipCitation;
}

export const CONTROL_CHANGES = midiData.controlChanges as CcEntry[];

/** The S-1's default MIDI channel for the synth (manual: "3 (Synth), 16 (Program Change)"). */
export const DEFAULT_MIDI_CHANNEL: number = midiData.channels.synth;

export const CC_BY_NUMBER = new Map(CONTROL_CHANGES.map((entry) => [entry.cc, entry]));

/** The CC each knob sends in its normal operation, keyed by faceplate control ID. */
export const KNOB_CC = new Map(
	CONTROL_CHANGES.filter((entry) => entry.layer === 'knob').map((entry) => [
		entry.controls[0],
		entry
	])
);

/** All CCs that involve a faceplate control (any layer), keyed by control ID. */
export const CCS_BY_CONTROL: ReadonlyMap<string, CcEntry[]> = new Map(
	[...new Set(CONTROL_CHANGES.flatMap((entry) => entry.controls))].map((id) => [
		id,
		CONTROL_CHANGES.filter((entry) => entry.controls.includes(id))
	])
);

/** Every faceplate control that has at least one CC (in any layer). */
export const MIDI_MAPPED_CONTROLS = new Set(CONTROL_CHANGES.flatMap((entry) => entry.controls));

/** Knob pointer angle in degrees for a 0–127 value (−135° … +135°); 0 when unknown. */
export function knobAngle(value: number | undefined): number {
	return value === undefined ? 0 : -135 + (value / 127) * 270;
}
