// @ts-check
/**
 * @file device.js
 * @description Single source of truth for the Roland S-1 hardware model.
 *
 * Shared by the app (via `types.ts`) and by `scripts/validate-tips.mjs`, so the categories,
 * hardware IDs, combo-token grammar and the drawn faceplate can never drift apart:
 * - `CATEGORIES`: workflow sections used by tips.json.
 * - `PANEL_CONTROLS`: every physical control drawn by Faceplate.svelte, with its position in
 *   the 1500×850 faceplate viewBox (measured from the panel diagram on page 4 of the manual).
 * - `GENERIC_CONTROLS`: "any pad" / "any knob" pseudo-controls.
 * - `comboTokenToButtons()`: parses a human-readable combo token (e.g. "Hold SHIFT",
 *   "PAD 16 (WRITE)", "Turn TEMPO/VALUE") into canonical hardware IDs.
 *
 * Porting to another device: replace these exports, then update tips.json and aliases.json.
 */

export const DEVICE = {
	brand: 'Roland',
	model: 'S-1',
	name: 'Roland S-1',
	tagline: 'AIRA Compact Tweak Synth',
	firmware: '1.02',
	manualTitle: "S-1 Owner's Manual (Version 1.02)",
	manualUrl: 'https://www.roland.com/global/support/by_product/s-1/owners_manuals/'
};

export const CATEGORIES = /** @type {const} */ ([
	'Play & Patterns',
	'Sequencer',
	'Step Edit',
	'Motion',
	'Poly, Chord & Arp',
	'Sound Design',
	'FX & D-MOTION',
	'Save & Load',
	'Sync, MIDI & System'
]);

/** @typedef {'knob' | 'button' | 'key' | 'pad' | 'switch' | 'generic'} ControlKind */
/** @typedef {'white' | 'green' | 'orange' | 'dark'} KnobRing */

/**
 * @typedef {object} PanelControl
 * @property {string} id Canonical hardware ID used in tips.json `buttons`.
 * @property {string} label Silkscreen label (or a short name for icon-only controls).
 * @property {ControlKind} kind
 * @property {string} [sub] Secondary/SHIFT function printed under the control.
 * @property {number} x Centre X in the faceplate viewBox.
 * @property {number} y Centre Y in the faceplate viewBox.
 * @property {KnobRing} [ring] Knob ring colour.
 * @property {'small' | 'medium' | 'large'} [size] Knob size.
 * @property {'square' | 'saw'} [icon] Waveform icon used instead of a text label.
 * @property {string} [section] Panel section the control belongs to.
 */

/** @param {number} n */
const whitePadX = (n) => 116 + 84 * (n - 1);

/** @type {PanelControl[]} */
const KNOBS = [
	{ id: 'VOLUME', label: 'VOLUME', kind: 'knob', x: 1352, y: 97, ring: 'dark', size: 'small' },
	{
		id: 'TEMPO/VALUE',
		label: 'TEMPO/VALUE',
		kind: 'knob',
		x: 215,
		y: 386,
		ring: 'dark',
		size: 'large'
	},
	{ id: 'RATE', label: 'RATE', kind: 'knob', section: 'LFO', x: 432, y: 240, ring: 'white' },
	{
		id: 'WAVE FORM',
		label: 'WAVE FORM',
		kind: 'knob',
		section: 'LFO',
		x: 432,
		y: 364,
		ring: 'dark',
		size: 'small'
	},
	{
		id: 'RANGE',
		label: 'RANGE',
		kind: 'knob',
		section: 'OSCILLATOR',
		x: 592,
		y: 240,
		ring: 'dark',
		size: 'small'
	},
	{
		id: 'OSC LFO',
		label: 'LFO',
		kind: 'knob',
		section: 'OSCILLATOR',
		x: 592,
		y: 368,
		ring: 'white'
	},
	{
		id: 'SQUARE',
		label: 'Square level',
		kind: 'knob',
		section: 'OSCILLATOR',
		x: 750,
		y: 240,
		ring: 'green',
		icon: 'square'
	},
	{
		id: 'SAW',
		label: 'Sawtooth level',
		kind: 'knob',
		section: 'OSCILLATOR',
		x: 905,
		y: 240,
		ring: 'green',
		icon: 'saw'
	},
	{ id: 'SUB', label: 'SUB', kind: 'knob', section: 'OSCILLATOR', x: 750, y: 368, ring: 'green' },
	{
		id: 'NOISE',
		label: 'NOISE',
		kind: 'knob',
		section: 'OSCILLATOR',
		x: 905,
		y: 368,
		ring: 'green'
	},
	{ id: 'FREQ', label: 'FREQ', kind: 'knob', section: 'FILTER', x: 1075, y: 240, ring: 'orange' },
	{ id: 'RESO', label: 'RESO', kind: 'knob', section: 'FILTER', x: 1232, y: 240, ring: 'orange' },
	{
		id: 'FILTER LFO',
		label: 'LFO',
		kind: 'knob',
		section: 'FILTER',
		x: 1075,
		y: 368,
		ring: 'white'
	},
	{
		id: 'FILTER ENV',
		label: 'ENV',
		kind: 'knob',
		section: 'FILTER',
		x: 1232,
		y: 368,
		ring: 'orange'
	},
	{ id: 'DELAY', label: 'DELAY', kind: 'knob', section: 'EFX', x: 1378, y: 240, ring: 'dark' },
	{ id: 'REVERB', label: 'REVERB', kind: 'knob', section: 'EFX', x: 1378, y: 368, ring: 'dark' },
	{ id: 'ATTACK', label: 'ATTACK', kind: 'knob', section: 'ENV', x: 750, y: 492, ring: 'dark' },
	{ id: 'DECAY', label: 'DECAY', kind: 'knob', section: 'ENV', x: 906, y: 492, ring: 'dark' },
	{ id: 'SUSTAIN', label: 'SUSTAIN', kind: 'knob', section: 'ENV', x: 1075, y: 492, ring: 'dark' },
	{ id: 'RELEASE', label: 'RELEASE', kind: 'knob', section: 'ENV', x: 1232, y: 492, ring: 'dark' }
];

/** @type {PanelControl[]} */
const BUTTONS = [
	{ id: 'PLAY', label: 'PLAY', kind: 'button', x: 143, y: 492 },
	{ id: 'REC', label: 'REC', kind: 'button', x: 286, y: 492 },
	{ id: 'PATTERN', label: 'PATTERN', sub: 'STEP LOOP', kind: 'button', x: 432, y: 492 },
	{ id: 'STEP', label: 'STEP', sub: 'KEY TRANSPOSE', kind: 'button', x: 592, y: 492 },
	{ id: 'D-MOTION', label: 'D-MOTION', sub: 'DESTINATION', kind: 'button', x: 1380, y: 492 },
	{ id: 'SHIFT', label: 'SHIFT', kind: 'button', x: 143, y: 608 },
	{ id: 'HOLD', label: 'HOLD', sub: 'MANUAL', kind: 'button', x: 1380, y: 608 },
	{ id: 'POWER', label: 'POWER', sub: 'rear panel', kind: 'switch', x: 487, y: 14 }
];

// Black keyboard pads: SHIFT functions are printed on the keys (pad [2] is the lowest C).
/** @type {PanelControl[]} */
const BLACK_KEYS = [
	{ id: 'OCT-', label: 'OCT-', kind: 'key', x: 242, y: 610 },
	{ id: 'OCT+', label: 'OCT+', kind: 'key', x: 326, y: 610 },
	{ id: 'PWM DEPTH', label: 'PWM DEPTH', kind: 'key', x: 494, y: 610 },
	{ id: 'PWM SRC', label: 'PWM SRC', kind: 'key', x: 578, y: 610 },
	{ id: 'SUB OCT', label: 'SUB OCT', kind: 'key', x: 662, y: 610 },
	{ id: 'ENV TRG', label: 'ENV TRG', kind: 'key', x: 831, y: 610 },
	{ id: 'AMP', label: 'AMP', kind: 'key', x: 915, y: 610 },
	{ id: 'POLY', label: 'POLY', kind: 'key', x: 1083, y: 610 },
	{ id: 'PORTA ON', label: 'PORTA ON', sub: '◄', kind: 'key', x: 1167, y: 610 },
	{ id: 'PORTA TIME', label: 'PORTA TIME', sub: '►', kind: 'key', x: 1251, y: 610 }
];

// White keyboard pads double as step pads [1]–[16]; SHIFT functions are printed below them.
const WHITE_PAD_FUNCTIONS = [
	'EXIT',
	'ENTER',
	'SHUFFLE',
	'LAST',
	'OSC DRAW',
	'OSC CHOP',
	'FILTER KYBD',
	'ARPEGGIO ON',
	'ARPEGGIO TYPE',
	'ARPEGGIO RATE',
	'CLEAR NOTE',
	'CLEAR MOTION',
	'DELAY',
	'REVERB',
	'MENU',
	'WRITE'
];

/** @type {PanelControl[]} */
const WHITE_PADS = WHITE_PAD_FUNCTIONS.map((fn, i) => ({
	id: `PAD ${i + 1}`,
	label: String(i + 1),
	sub: fn,
	kind: /** @type {ControlKind} */ ('pad'),
	x: whitePadX(i + 1),
	y: 708
}));

/** @type {PanelControl[]} */
export const PANEL_CONTROLS = [...KNOBS, ...BUTTONS, ...BLACK_KEYS, ...WHITE_PADS];

/** @type {PanelControl[]} */
export const GENERIC_CONTROLS = [
	{ id: 'PAD', label: 'Any pad', kind: 'generic', x: 0, y: 0 },
	{ id: 'KNOB', label: 'Any knob', kind: 'generic', x: 0, y: 0 }
];

/** @type {Map<string, PanelControl>} */
const CONTROL_BY_ID = new Map([...PANEL_CONTROLS, ...GENERIC_CONTROLS].map((c) => [c.id, c]));

export const VALID_BUTTON_IDS = new Set(CONTROL_BY_ID.keys());

/** @param {string} id */
export function getControl(id) {
	return CONTROL_BY_ID.get(id);
}

/** @param {string} id */
export function isPadId(id) {
	return CONTROL_BY_ID.get(id)?.kind === 'pad';
}

/** @param {string} id */
export function isKnobId(id) {
	return CONTROL_BY_ID.get(id)?.kind === 'knob';
}

// Tokens that describe an action with no panel control (they map to no hardware ID).
const VIRTUAL_TOKENS = new Set(['tilt the unit', 'external midi note', 'usb drive']);

/** @type {Map<string, string>} */
const GENERIC_ALIASES = new Map([
	['any pad', 'PAD'],
	['step pad', 'PAD'],
	['keyboard pad', 'PAD'],
	['any knob', 'KNOB'],
	['power on', 'POWER'],
	['power off/on', 'POWER']
]);

// Case-sensitive on purpose: verbs are written "Hold"/"Turn", controls in capitals ("HOLD").
const VERB_PREFIX = /^(?:Hold|Press|Turn|Tap|Release|Then)\s+/;
const TRAILING_PAREN = /\s*\([^()]*\)$/;
const TRAILING_QUALIFIER = /\s+(?:repeatedly|again|together)$/i;

/**
 * Parses one combo token into canonical hardware IDs.
 *
 * Grammar: `[verb ]CONTROL[ (function label)][ qualifier]`, where alternatives are separated
 * by " / " and white-pad ranges are written "PAD 1–4" ("PAD 1–16" means any pad).
 * Examples: "Hold SHIFT" → SHIFT, "PAD 16 (WRITE)" → PAD 16, "Turn any KNOB" → KNOB,
 * "OCT- / OCT+" → OCT-, OCT+, "PAD 1–4" → PAD 1…PAD 4, "Tilt the unit" → (none).
 *
 * @param {string} token
 * @returns {string[]}
 */
export function comboTokenToButtons(token) {
	let t = token.trim();
	if (VIRTUAL_TOKENS.has(t.toLowerCase())) return [];

	t = t.replace(VERB_PREFIX, '');
	let prev;
	do {
		prev = t;
		t = t.replace(TRAILING_PAREN, '').replace(TRAILING_QUALIFIER, '').trim();
	} while (t !== prev);

	if (t.includes(' / ')) {
		return t.split(' / ').flatMap((part) => comboTokenToButtons(part));
	}

	const generic = GENERIC_ALIASES.get(t.toLowerCase());
	if (generic) return [generic];

	const range = /^PAD (\d{1,2})[–-](\d{1,2})$/.exec(t);
	if (range) {
		const from = Number(range[1]);
		const to = Number(range[2]);
		if (from === 1 && to === 16) return ['PAD'];
		return Array.from({ length: to - from + 1 }, (_, i) => `PAD ${from + i}`);
	}

	return [t];
}

/**
 * Ordered, de-duplicated hardware IDs for a whole combo.
 * @param {readonly string[]} combo
 * @returns {string[]}
 */
export function comboToButtons(combo) {
	return [...new Set(combo.flatMap((token) => comboTokenToButtons(token)))];
}
