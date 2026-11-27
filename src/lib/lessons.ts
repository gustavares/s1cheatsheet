/**
 * @file lessons.ts
 * @description Guided lessons (data in `data/lessons.json`, checked by
 * `scripts/validate-lessons.mjs`) and the pure logic that decides when a step is done.
 */
import lessonData from '#lib/data/lessons.json';
import { CC_BY_NUMBER } from '#lib/midi.js';

export type LessonView = 'scope' | 'spectrum' | 'spectrogram';

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
	/** How many such messages must arrive during the step (default 1). */
	moves?: number;
}

export interface LessonStep {
	title: string;
	do: string;
	listen?: string;
	look?: string;
	/** Faceplate control IDs to light up. */
	controls: string[];
	view: LessonView;
	/** Without a goal the step has a Next button instead of advancing by itself. */
	goal?: LessonGoal;
	cite: { page: number; quote: string };
}

export interface Lesson {
	id: string;
	title: string;
	blurb: string;
	setup?: Record<string, number>;
	steps: LessonStep[];
}

export const LESSONS = lessonData.lessons as unknown as Lesson[];
export const BASE_SETUP = lessonData.baseSetup as Record<string, number>;

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

/** True once enough moves arrived during the step and every condition holds. */
export function goalMet(goal: LessonGoal, values: Record<number, number>, moves: number): boolean {
	return moves >= (goal.moves ?? 1) && (goal.when ?? []).every((c) => conditionMet(c, values));
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

export interface LessonProgress {
	/** Step the player is on (or finished at). */
	step: number;
	/** Every step completed at least once. */
	done: boolean;
}

export const LESSON_PROGRESS_KEY = 's1-lessons-v1';

export function loadLessonProgress(): Record<string, LessonProgress> {
	try {
		const raw = JSON.parse(localStorage.getItem(LESSON_PROGRESS_KEY) ?? '{}') as unknown;
		if (!raw || typeof raw !== 'object') return {};
		const out: Record<string, LessonProgress> = {};
		for (const lesson of LESSONS) {
			const p = (raw as Record<string, Partial<LessonProgress>>)[lesson.id];
			if (!p) continue;
			const step = Number.isInteger(p.step) ? Number(p.step) : 0;
			out[lesson.id] = {
				step: Math.max(0, Math.min(lesson.steps.length - 1, step)),
				done: p.done === true
			};
		}
		return out;
	} catch {
		return {};
	}
}

export function saveLessonProgress(progress: Record<string, LessonProgress>) {
	try {
		localStorage.setItem(LESSON_PROGRESS_KEY, JSON.stringify(progress));
	} catch {
		// progress just isn't remembered
	}
}
