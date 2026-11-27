/**
 * @file lessons.ts
 * @description Guided lessons (data in `data/lessons.json`, checked by
 * `scripts/validate-lessons.mjs`) and the pure logic that decides when a step is done.
 *
 * The core track is a short path taken in order. Side lessons hang off one core lesson
 * and never block it. Progress for the two tracks is stored separately; the older
 * combined key is still read so a player who finished lessons before the split keeps
 * those checkmarks.
 */
import lessonData from '#lib/data/lessons.json';
import { CC_BY_NUMBER } from '#lib/midi.js';

export type LessonView = 'scope' | 'spectrum' | 'spectrogram';
export type LessonTrack = 'core' | 'side';

export interface GoalCondition {
	cc: number;
	min?: number;
	max?: number;
}

export interface LessonGoal {
	/** Every condition must hold on the latest known CC values. */
	when?: GoalCondition[];
	/** CCs whose messages count as the player acting (default: the `when` CCs). */
	touch?: number[];
	/** How many such messages must arrive during the step (default 1 when CCs are watched). */
	moves?: number;
	/**
	 * Incoming Note On messages that must arrive during the step.
	 * The chart transmits Note On and does not transmit Note Off.
	 */
	notes?: number;
	/**
	 * A Program Change arrived (chart: true number 0–63, transmitted).
	 * The menu item txPc decides whether a pattern change actually sends one.
	 */
	program?: boolean;
	/** System real-time the chart says the S-1 transmits. Clock is continuous, so it is not a goal. */
	realtime?: 'start' | 'stop';
}

export interface LessonCite {
	/** Chapter file under docs/reference, the same shape tips use. */
	doc: string;
	page: number;
	/** Heading or label printed on that page. */
	section: string;
	quote: string;
}

export interface LessonStep {
	title: string;
	do: string;
	listen?: string;
	look?: string;
	/**
	 * What this step cannot claim: a thin spot in the manual, or a message the chart
	 * does not transmit. Shown under the instruction.
	 */
	caveat?: string;
	/** Faceplate control IDs to light up. */
	controls: string[];
	view: LessonView;
	/** Without a goal the step is manual: a Done button, not an auto-advance. */
	goal?: LessonGoal;
	cite: LessonCite;
}

export interface Lesson {
	id: string;
	track: LessonTrack;
	/** Core lesson this side lesson hangs off. Side lessons only. */
	parent?: string;
	/** Chapter file name, matching docs/reference/sources.json. */
	chapter: string;
	title: string;
	blurb: string;
	setup?: Record<string, number>;
	steps: LessonStep[];
}

export interface LessonChapter {
	id: string;
	title: string;
}

export const LESSONS = lessonData.lessons as unknown as Lesson[];
export const CHAPTERS = lessonData.chapters as LessonChapter[];
export const BASE_SETUP = lessonData.baseSetup as Record<string, number>;

export const CORE_LESSONS = LESSONS.filter((lesson) => lesson.track === 'core');
export const SIDE_LESSONS = LESSONS.filter((lesson) => lesson.track === 'side');

/** Side lessons that branch off one core lesson, in file order. */
export function sidesOf(parentId: string): Lesson[] {
	return SIDE_LESSONS.filter((lesson) => lesson.parent === parentId);
}

/** Lessons filed under one manual chapter: core first, then side. */
export function lessonsInChapter(chapterId: string): Lesson[] {
	const found = LESSONS.filter((lesson) => lesson.chapter === chapterId);
	return [
		...found.filter((lesson) => lesson.track === 'core'),
		...found.filter((lesson) => lesson.track === 'side')
	];
}

export function chapterTitle(id: string): string {
	return CHAPTERS.find((chapter) => chapter.id === id)?.title ?? id;
}

/** Knob CCs "Set up the lesson" sends: the plain base sound plus the lesson's own values. */
export function setupMessages(lesson: Lesson): [number, number][] {
	return Object.entries({ ...BASE_SETUP, ...lesson.setup }).map(([cc, v]) => [Number(cc), v]);
}

/** CCs whose messages count as the player acting on this goal. */
export function watchedCcs(goal: LessonGoal): number[] {
	return goal.touch ?? (goal.when ?? []).map((c) => c.cc);
}

export function conditionMet(c: GoalCondition, values: Record<number, number>): boolean {
	const v = values[c.cc];
	if (v === undefined) return false;
	return (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max);
}

export interface GoalObservation {
	notes: number;
	program: boolean;
	realtime: boolean;
}

const NO_OBSERVATION: GoalObservation = { notes: 0, program: false, realtime: false };

/** True once enough moves arrived during the step and every condition holds. */
export function goalMet(
	goal: LessonGoal,
	values: Record<number, number>,
	moves: number,
	observed: GoalObservation = NO_OBSERVATION
): boolean {
	const watched = watchedCcs(goal);
	const needMoves = goal.moves ?? (watched.length > 0 ? 1 : 0);
	const movesOk = watched.length === 0 || moves >= needMoves;
	const notesOk = goal.notes === undefined || observed.notes >= goal.notes;
	const programOk = !goal.program || observed.program;
	const realtimeOk = !goal.realtime || observed.realtime;
	const whenOk = (goal.when ?? []).every((c) => conditionMet(c, values));
	return movesOk && notesOk && programOk && realtimeOk && whenOk;
}

/** Short name for a CC as printed on the S-1: the knob for knob CCs, else the parameter. */
export function ccLabel(cc: number): string {
	const entry = CC_BY_NUMBER.get(cc);
	if (!entry) return `CC ${cc}`;
	if (entry.layer === 'knob' && entry.controls.length > 0) return entry.controls[0];
	return entry.parameter;
}

/** "FREQ ≤ 55", "RESO ≥ 90", "SAW 40–80". */
export function conditionLabel(c: GoalCondition): string {
	const name = ccLabel(c.cc);
	if (c.min !== undefined && c.max !== undefined) return `${name} ${c.min}–${c.max}`;
	if (c.min !== undefined) return `${name} ≥ ${c.min}`;
	return `${name} ≤ ${c.max}`;
}

export function citeDocLabel(doc: string): string {
	return doc.includes('roland-s1-v102') ? 'Owner’s Manual v1.02' : doc;
}

export interface LessonProgress {
	/** Step the player is on (or finished at). */
	step: number;
	/** Every step completed at least once. */
	done: boolean;
}

/** Combined store from before core and side were split. Still read, never required. */
export const LESSON_PROGRESS_KEY = 's1-lessons-v1';
export const CORE_PROGRESS_KEY = 's1-lessons-core-v1';
export const SIDE_PROGRESS_KEY = 's1-lessons-side-v1';

/**
 * The old "Chords and arpeggios" lesson. Its first two steps became `voices`
 * and its last two became `arpeggiator`.
 */
const LEGACY_CHORDS_ID = 'chords-and-arp';

function readStore(key: string): Record<string, Partial<LessonProgress>> {
	try {
		const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
		if (!raw || typeof raw !== 'object') return {};
		return raw as Record<string, Partial<LessonProgress>>;
	} catch {
		return {};
	}
}

function coerce(lesson: Lesson, saved: Partial<LessonProgress> | undefined): LessonProgress | null {
	if (!saved) return null;
	const step = Number.isInteger(saved.step) ? Number(saved.step) : 0;
	return {
		step: Math.max(0, Math.min(lesson.steps.length - 1, step)),
		done: saved.done === true
	};
}

function applyLegacyChords(
	out: Record<string, LessonProgress>,
	saved: Partial<LessonProgress> | undefined
) {
	if (!saved) return;
	const step = Number.isInteger(saved.step) ? Number(saved.step) : 0;
	const done = saved.done === true;
	const voices = LESSONS.find((lesson) => lesson.id === 'voices');
	const arp = LESSONS.find((lesson) => lesson.id === 'arpeggiator');
	// A track-specific save wins. Legacy only fills a lesson the player hasn't touched since.
	if (voices && !out.voices) {
		if (done || step >= 2) out.voices = { step: voices.steps.length - 1, done: true };
		else out.voices = { step: Math.min(step, voices.steps.length - 1), done: false };
	}
	if (arp && !out.arpeggiator) {
		if (done) out.arpeggiator = { step: arp.steps.length - 1, done: true };
		else if (step >= 2) {
			out.arpeggiator = { step: Math.min(step - 2, arp.steps.length - 1), done: false };
		}
	}
}

export function loadLessonProgress(): Record<string, LessonProgress> {
	const legacy = readStore(LESSON_PROGRESS_KEY);
	const core = readStore(CORE_PROGRESS_KEY);
	const side = readStore(SIDE_PROGRESS_KEY);
	const out: Record<string, LessonProgress> = {};
	for (const lesson of LESSONS) {
		const bucket = lesson.track === 'core' ? core : side;
		const saved = coerce(lesson, bucket[lesson.id] ?? legacy[lesson.id]);
		if (saved) out[lesson.id] = saved;
	}
	applyLegacyChords(out, legacy[LEGACY_CHORDS_ID]);
	return out;
}

export function saveLessonProgress(progress: Record<string, LessonProgress>) {
	const core: Record<string, LessonProgress> = {};
	const side: Record<string, LessonProgress> = {};
	for (const lesson of LESSONS) {
		const entry = progress[lesson.id];
		if (!entry) continue;
		(lesson.track === 'core' ? core : side)[lesson.id] = entry;
	}
	try {
		localStorage.setItem(CORE_PROGRESS_KEY, JSON.stringify(core));
		localStorage.setItem(SIDE_PROGRESS_KEY, JSON.stringify(side));
	} catch {
		// progress just isn't remembered
	}
}
