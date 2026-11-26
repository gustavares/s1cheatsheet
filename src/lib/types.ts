/**
 * @file types.ts
 * @description Central Data Contract & Hardware Mapping Schema
 *
 * This file defines the core interfaces that connect:
 * 1. The official documentation citations (doc, page, quote).
 * 2. The cheat sheet tip entries (tips.json).
 * 3. The colloquial search aliases (aliases.json).
 * 4. The interactive hardware faceplate SVG (Faceplate.svelte).
 *
 * The device-specific data (categories, panel controls, combo-token grammar) lives in
 * `device.js` so that `scripts/validate-tips.mjs` can import exactly the same definitions.
 * If you are adapting this engine for another instrument, start there.
 */
import { CATEGORIES, comboTokenToButtons, isKnobId, isPadId } from './device.js';

export {
	CATEGORIES,
	DEVICE,
	GENERIC_CONTROLS,
	PANEL_CONTROLS,
	comboTokenToButtons,
	getControl,
	isKnobId,
	isPadId
} from './device.js';
export type { PanelControl } from './device.js';

export type Category = (typeof CATEGORIES)[number];

export type TipTier = 'essential' | 'deep-dive';

export interface TipCitation {
	doc: string;
	page: number;
	quote: string;
}

export interface Tip {
	id: string;
	category: Category;
	tier: TipTier;
	combo: string[];
	buttons: string[];
	action: string;
	/** Short tag, e.g. "Ver. 1.02" for functions added in firmware 1.02. */
	context?: string;
	goal: string;
	caveat?: string;
	steps?: string[];
	/** What the 4-character LED display shows for this function, quoted from the manual. */
	display?: string;
	citation: TipCitation;
}

export type TipAliasesMap = Record<string, string[]>;

/**
 * Whether a generic "any pad" / "any knob" entry in a tip should also match a selected
 * physical control (selecting the FREQ knob also finds "hold a step pad and turn a knob").
 */
function genericCovers(genericId: string, selectedBtn: string): boolean {
	return (
		(genericId === 'PAD' && isPadId(selectedBtn)) || (genericId === 'KNOB' && isKnobId(selectedBtn))
	);
}

/**
 * Checks whether a tip's `buttons` list matches a selected hardware button ID.
 * Exact matches always count; a specific pad or knob also matches tips that use
 * the generic `PAD` / `KNOB` pseudo-control.
 */
export function matchesTipButton(tipButtons: string[], selectedBtn: string): boolean {
	return (
		tipButtons.includes(selectedBtn) || tipButtons.some((btn) => genericCovers(btn, selectedBtn))
	);
}

/** True when every selected button is literally part of the tip (no generic matches). */
export function matchesTipExactly(tipButtons: string[], selectedButtons: string[]): boolean {
	return selectedButtons.every((btn) => tipButtons.includes(btn));
}

/**
 * Whether a visible `<Keycap>` combo token should be highlighted for the selected buttons.
 * Tokens are parsed with the same grammar as the validator, so "PAD 1" never lights up
 * "PAD 16 (WRITE)" and the DELAY knob never lights up "PAD 13 (DELAY)".
 */
export function isComboTokenActive(comboPart: string, activeButtons: string[]): boolean {
	if (activeButtons.length === 0) return false;
	const tokenButtons = comboTokenToButtons(comboPart);
	return tokenButtons.some(
		(btn) =>
			activeButtons.includes(btn) || activeButtons.some((active) => genericCovers(btn, active))
	);
}
