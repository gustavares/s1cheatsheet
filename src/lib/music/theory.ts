/**
 * @file theory.ts
 * @description Note names, scales and chord naming for the KeyStep view. Pure functions.
 * MIDI note 60 is C4 (the S-1 manual: "middle C (MIDI note number: 60)").
 */

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Key names offered in the key picker (the most common spelling of each pitch class). */
export const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export const pitchClass = (note: number) => ((note % 12) + 12) % 12;

export function pcName(pc: number, flats = false): string {
	return (flats ? FLAT_NAMES : SHARP_NAMES)[pitchClass(pc)];
}

/** "C4", "F♯2"… */
export function noteLabel(note: number, flats = false): string {
	return `${pcName(note, flats)}${Math.floor(note / 12) - 1}`;
}

export const isBlackKey = (note: number) => [1, 3, 6, 8, 10].includes(pitchClass(note));

export interface Scale {
	id: string;
	name: string;
	intervals: number[];
	/** Semitones from the tonic to the major key that shares its notes (for spelling). */
	parent: number;
}

export const SCALES: Scale[] = [
	{ id: 'major', name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11], parent: 0 },
	{ id: 'minor', name: 'Natural minor', intervals: [0, 2, 3, 5, 7, 8, 10], parent: 3 },
	{ id: 'harmonic-minor', name: 'Harmonic minor', intervals: [0, 2, 3, 5, 7, 8, 11], parent: 3 },
	{ id: 'melodic-minor', name: 'Melodic minor', intervals: [0, 2, 3, 5, 7, 9, 11], parent: 3 },
	{ id: 'dorian', name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10], parent: 10 },
	{ id: 'phrygian', name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10], parent: 8 },
	{ id: 'lydian', name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11], parent: 7 },
	{ id: 'mixolydian', name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10], parent: 5 },
	{ id: 'locrian', name: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10], parent: 1 },
	{ id: 'major-pentatonic', name: 'Major pentatonic', intervals: [0, 2, 4, 7, 9], parent: 0 },
	{ id: 'minor-pentatonic', name: 'Minor pentatonic', intervals: [0, 3, 5, 7, 10], parent: 3 },
	{ id: 'blues', name: 'Blues', intervals: [0, 3, 5, 6, 7, 10], parent: 3 }
];

// Major keys written with flats: F, B♭, E♭, A♭, D♭.
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1]);

/** Whether notes in this key and scale are spelled with flats. */
export function usesFlats(keyPc: number, scale: Scale | null): boolean {
	return FLAT_MAJOR_KEYS.has(pitchClass(keyPc + (scale?.parent ?? 0)));
}

/** The 12 pitch classes, true where they belong to the scale. */
export function scaleMask(keyPc: number, scale: Scale): boolean[] {
	const mask = new Array<boolean>(12).fill(false);
	for (const i of scale.intervals) mask[pitchClass(keyPc + i)] = true;
	return mask;
}

interface ChordShape {
	suffix: string;
	intervals: number[];
	/** Lower is simpler; breaks ties between names for the same notes. */
	rank: number;
}

const CHORDS: ChordShape[] = [
	{ suffix: '', intervals: [0, 4, 7], rank: 0 },
	{ suffix: 'm', intervals: [0, 3, 7], rank: 0 },
	{ suffix: 'dim', intervals: [0, 3, 6], rank: 1 },
	{ suffix: 'aug', intervals: [0, 4, 8], rank: 1 },
	{ suffix: 'sus4', intervals: [0, 5, 7], rank: 1 },
	{ suffix: 'sus2', intervals: [0, 2, 7], rank: 2 },
	{ suffix: '7', intervals: [0, 4, 7, 10], rank: 2 },
	{ suffix: 'maj7', intervals: [0, 4, 7, 11], rank: 2 },
	{ suffix: 'm7', intervals: [0, 3, 7, 10], rank: 2 },
	{ suffix: 'm7♭5', intervals: [0, 3, 6, 10], rank: 3 },
	{ suffix: 'dim7', intervals: [0, 3, 6, 9], rank: 3 },
	{ suffix: 'm(maj7)', intervals: [0, 3, 7, 11], rank: 4 },
	{ suffix: '7sus4', intervals: [0, 5, 7, 10], rank: 3 },
	{ suffix: 'aug7', intervals: [0, 4, 8, 10], rank: 4 },
	{ suffix: '6', intervals: [0, 4, 7, 9], rank: 3 },
	{ suffix: 'm6', intervals: [0, 3, 7, 9], rank: 3 },
	{ suffix: 'add9', intervals: [0, 2, 4, 7], rank: 3 },
	{ suffix: 'm(add9)', intervals: [0, 2, 3, 7], rank: 4 },
	{ suffix: '9', intervals: [0, 2, 4, 7, 10], rank: 4 },
	{ suffix: 'maj9', intervals: [0, 2, 4, 7, 11], rank: 4 },
	{ suffix: 'm9', intervals: [0, 2, 3, 7, 10], rank: 4 },
	{ suffix: '6/9', intervals: [0, 2, 4, 7, 9], rank: 5 },
	{ suffix: '7♭9', intervals: [0, 1, 4, 7, 10], rank: 5 },
	{ suffix: '7♯9', intervals: [0, 3, 4, 7, 10], rank: 5 },
	{ suffix: '11', intervals: [0, 2, 4, 5, 7, 10], rank: 6 },
	{ suffix: '13', intervals: [0, 2, 4, 7, 9, 10], rank: 6 },
	// Common voicings without the fifth.
	{ suffix: '7', intervals: [0, 4, 10], rank: 6 },
	{ suffix: 'maj7', intervals: [0, 4, 11], rank: 6 },
	{ suffix: 'm7', intervals: [0, 3, 10], rank: 6 }
];

const INTERVAL_NAMES = [
	'unison',
	'minor 2nd',
	'major 2nd',
	'minor 3rd',
	'major 3rd',
	'perfect 4th',
	'tritone',
	'perfect 5th',
	'minor 6th',
	'major 6th',
	'minor 7th',
	'major 7th'
];

export interface ChordReading {
	/** "Cmaj7/E", "C5", "C" or "C–E♭" for an interval; empty when nothing is held. */
	name: string;
	/** What kind of reading it is, plus a description ("minor 3rd", "first inversion"…). */
	kind: 'none' | 'note' | 'interval' | 'chord' | 'unknown';
	detail: string;
}

const sameSet = (a: number[], b: number[]) =>
	a.length === b.length && a.every((v, i) => v === b[i]);

/** Names the chord formed by the held notes (any octaves, any inversion). */
export function readChord(notes: number[], flats = false): ChordReading {
	if (notes.length === 0) return { name: '', kind: 'none', detail: '' };
	const sorted = [...notes].sort((a, b) => a - b);
	const bass = pitchClass(sorted[0]);
	const pcs = [...new Set(sorted.map(pitchClass))];
	const name = (pc: number) => pcName(pc, flats);

	if (pcs.length === 1)
		return { name: name(bass), kind: 'note', detail: noteLabel(sorted[0], flats) };
	if (pcs.length === 2) {
		const other = pcs.find((pc) => pc !== bass) ?? bass;
		const up = pitchClass(other - bass);
		if (up === 7) return { name: `${name(bass)}5`, kind: 'chord', detail: 'power chord' };
		if (up === 5) {
			return {
				name: `${name(other)}5/${name(bass)}`,
				kind: 'chord',
				detail: 'power chord, inverted'
			};
		}
		return {
			name: `${name(bass)}–${name(other)}`,
			kind: 'interval',
			detail: INTERVAL_NAMES[up]
		};
	}

	let best: { root: number; shape: ChordShape; score: number } | null = null;
	for (const root of pcs) {
		const rel = pcs.map((pc) => pitchClass(pc - root)).sort((a, b) => a - b);
		for (const shape of CHORDS) {
			if (!sameSet(rel, shape.intervals)) continue;
			// A root in the bass outweighs a slightly simpler name over another bass note.
			const score = shape.rank + (root === bass ? 0 : 2);
			if (!best || score < best.score) best = { root, shape, score };
		}
	}
	if (!best) {
		return { name: pcs.map(name).join(' '), kind: 'unknown', detail: 'no common chord name' };
	}
	const slash = best.root === bass ? '' : `/${name(bass)}`;
	const third = pitchClass(bass - best.root);
	const inversion =
		best.root === bass
			? 'root position'
			: [3, 4].includes(third)
				? 'first inversion'
				: third === 7 || third === 6 || third === 8
					? 'second inversion'
					: 'over another bass note';
	return {
		name: `${name(best.root)}${best.shape.suffix}${slash}`,
		kind: 'chord',
		detail: inversion
	};
}
