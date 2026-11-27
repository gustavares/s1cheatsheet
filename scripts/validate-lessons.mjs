/**
 * @file validate-lessons.mjs
 * @description Schema and verbatim-citation validator for the guided lessons
 * (`src/lib/data/lessons.json`):
 * 1. Schema: a core track plus side lessons hung off a core lesson, each filed under a
 *    manual chapter. Every step has text, a Visualizer view and controls the Faceplate draws.
 * 2. MIDI sanity: `setup` / `baseSetup` only send knob-layer CCs the S-1 receives.
 *    Auto-advance goals only watch messages the chart says the S-1 transmits (CCs, Note On,
 *    Program Change, Start, Stop). Clock is rejected. The S-1 has no SysEx.
 * 3. Verbatim citations: `cite.doc` is a chapter of the corpus, `cite.page` falls in that
 *    chapter, and `cite.section` and `cite.quote` both appear on that page.
 */

import fs from 'node:fs';
import path from 'node:path';
import { VALID_BUTTON_IDS } from '../src/lib/device.js';

const LESSONS_PATH = path.resolve('src/lib/data/lessons.json');
const MIDI_PATH = path.resolve('src/lib/data/midi.json');
const SOURCES_PATH = path.resolve('docs/reference/sources.json');
const VIEWS = new Set(['scope', 'spectrum', 'spectrogram']);
const MIN_CORE = 8;
const MIN_QUOTE_LENGTH = 12;
const MAX_QUOTE_LENGTH = 240;
const DOC_PREFIX = 'docs/reference/roland-s1-v102/';

const normalize = (str) => str.replace(/\s+/g, ' ').trim();
const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

// ── Manual corpus: page number → normalized text, and chapter page ranges ─────
const { sources } = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
const pages = new Map();
const chapterByFile = new Map();
for (const source of sources) {
	const dir = path.resolve('docs/reference', source.slug);
	if (!fs.existsSync(path.join(dir, 'INDEX.md'))) {
		console.error(
			`❌ Manual corpus not found for ${source.slug}. Run \`npm run docs:sync\` to generate it.`
		);
		process.exit(1);
	}
	for (const chapter of source.chapters) {
		chapterByFile.set(chapter.file, chapter);
	}
	for (const file of fs.readdirSync(dir).filter((f) => /^\d+-.*\.md$/.test(f))) {
		const content = fs.readFileSync(path.join(dir, file), 'utf8');
		const parts = content.split(/<!-- \[Page (\d+)\] -->/);
		for (let i = 1; i < parts.length; i += 2) {
			const page = Number(parts[i]);
			pages.set(page, normalize(`${pages.get(page) ?? ''} ${parts[i + 1]}`));
		}
	}
}

// ── MIDI implementation ───────────────────────────────────────────────────────
const midi = JSON.parse(fs.readFileSync(MIDI_PATH, 'utf8'));
const CC = new Map((midi.controlChanges ?? midi).map((entry) => [entry.cc, entry]));

function transmitted(groupName, message) {
	const group = (midi.messageGroups ?? []).find((g) => g.group === groupName);
	return group?.rows?.find((row) => row.message === message)?.tx === true;
}

const isInt7 = (v) => Number.isInteger(v) && v >= 0 && v <= 127;

function checkSetup(where, setup) {
	if (typeof setup !== 'object' || setup === null || Array.isArray(setup)) {
		fail(where, 'must be an object of CC number → value');
		return;
	}
	for (const [key, value] of Object.entries(setup)) {
		const entry = CC.get(Number(key));
		if (!entry) fail(where, `CC ${key} is not in the S-1 MIDI implementation`);
		else if (entry.layer !== 'knob' || !entry.rx)
			fail(where, `CC ${key} (${entry.parameter}) is not a knob CC the S-1 receives`);
		if (!isInt7(value)) fail(where, `CC ${key} value ${value} is not 0–127`);
	}
}

function checkGoal(where, goal) {
	const when = goal.when ?? [];
	const touch = goal.touch ?? [];
	if (!Array.isArray(when) || !Array.isArray(touch)) {
		fail(where, '`when` and `touch` must be arrays');
		return;
	}
	const hasNotes = goal.notes !== undefined;
	const hasProgram = goal.program !== undefined;
	const hasRealtime = goal.realtime !== undefined;
	if (when.length === 0 && touch.length === 0 && !hasNotes && !hasProgram && !hasRealtime) {
		fail(where, 'goal needs `when`, `touch`, `notes`, `program` or `realtime`');
	}
	if (goal.moves !== undefined && !(Number.isInteger(goal.moves) && goal.moves >= 1)) {
		fail(where, '`moves` must be a positive integer');
	}
	if (hasNotes && !(Number.isInteger(goal.notes) && goal.notes >= 1)) {
		fail(where, '`notes` must be a positive integer (Note On count)');
	}
	if (hasNotes && !transmitted('Velocity', 'Note On')) {
		fail(where, 'Note On is not transmitted, so a note goal can’t be detected');
	}
	if (hasProgram && goal.program !== true) fail(where, '`program` must be true');
	if (hasProgram && !transmitted('Program Change', 'True Number')) {
		fail(where, 'Program Change is not transmitted');
	}
	if (hasRealtime && goal.realtime !== 'start' && goal.realtime !== 'stop') {
		fail(where, '`realtime` must be "start" or "stop" (clock runs on its own)');
	}
	if (goal.realtime === 'start' && !transmitted('System Real Time', 'Start')) {
		fail(where, 'MIDI Start is not transmitted');
	}
	if (goal.realtime === 'stop' && !transmitted('System Real Time', 'Stop')) {
		fail(where, 'MIDI Stop is not transmitted');
	}
	const watched = [...when.map((c) => c.cc), ...touch];
	for (const cc of watched) {
		const entry = CC.get(cc);
		if (!entry) fail(where, `CC ${cc} is not in the S-1 MIDI implementation`);
		else if (!entry.tx)
			fail(where, `CC ${cc} (${entry.parameter}) isn’t transmitted, so the step can’t be detected`);
	}
	for (const c of when) {
		if (c.min === undefined && c.max === undefined) fail(where, `CC ${c.cc} needs min or max`);
		if (c.min !== undefined && !isInt7(c.min)) fail(where, `CC ${c.cc} min is not 0–127`);
		if (c.max !== undefined && !isInt7(c.max)) fail(where, `CC ${c.cc} max is not 0–127`);
		if (c.min !== undefined && c.max !== undefined && c.min > c.max) {
			fail(where, `CC ${c.cc} min > max`);
		}
	}
}

function checkCite(where, cite) {
	if (
		!cite ||
		typeof cite.doc !== 'string' ||
		!Number.isInteger(cite.page) ||
		typeof cite.section !== 'string' ||
		typeof cite.quote !== 'string'
	) {
		fail(where, 'needs cite { doc, page, section, quote }');
		return;
	}
	if (!cite.doc.startsWith(DOC_PREFIX)) {
		fail(where, `cite.doc must be a file under ${DOC_PREFIX}`);
		return;
	}
	const file = cite.doc.slice(DOC_PREFIX.length);
	const chapter = chapterByFile.get(file);
	if (!chapter) fail(where, `cite.doc "${file}" is not a manual chapter`);
	else if (cite.page < chapter.startPage || cite.page > chapter.endPage) {
		fail(
			where,
			`page ${cite.page} is outside ${file} (pp. ${chapter.startPage}–${chapter.endPage})`
		);
	}
	const section = normalize(cite.section);
	const quote = normalize(cite.quote);
	if (section.length < 2) fail(where, 'section is missing');
	if (quote.length < MIN_QUOTE_LENGTH || quote.length > MAX_QUOTE_LENGTH) {
		fail(where, `quote must be ${MIN_QUOTE_LENGTH}–${MAX_QUOTE_LENGTH} characters`);
	}
	const text = pages.get(cite.page);
	if (!text) fail(where, `page ${cite.page} not found in the manual corpus`);
	else {
		if (section && !text.includes(section)) {
			fail(where, `section not found on page ${cite.page}: “${section}”`);
		}
		if (quote && !text.includes(quote)) {
			fail(where, `quote not found verbatim on page ${cite.page}: “${quote}”`);
		}
	}
}

// ── Lessons ───────────────────────────────────────────────────────────────────
const data = JSON.parse(fs.readFileSync(LESSONS_PATH, 'utf8'));
checkSetup('baseSetup', data.baseSetup);

if (!Array.isArray(data.chapters) || data.chapters.length === 0) {
	fail('chapters', 'needs the manual chapter list');
}
const chapterIds = new Set();
for (const chapter of data.chapters ?? []) {
	if (!chapterByFile.has(chapter.id)) fail(`chapter ${chapter.id}`, 'not a file in sources.json');
	if (typeof chapter.title !== 'string' || !chapter.title.trim()) {
		fail(`chapter ${chapter.id}`, 'missing title');
	}
	chapterIds.add(chapter.id);
}
for (const file of chapterByFile.keys()) {
	if (!chapterIds.has(file)) fail('chapters', `missing manual chapter ${file}`);
}

const lessons = data.lessons;
if (!Array.isArray(lessons)) fail('lessons', 'must be an array');

const ids = new Set();
let stepCount = 0;
let goalCount = 0;
let manualCount = 0;
for (const [li, lesson] of (lessons ?? []).entries()) {
	const where = `lesson ${lesson.id ?? li}`;
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(lesson.id ?? '')) fail(where, 'id must be kebab-case');
	if (ids.has(lesson.id)) fail(where, 'duplicate id');
	ids.add(lesson.id);
	if (lesson.track !== 'core' && lesson.track !== 'side') fail(where, 'track must be core or side');
	if (!chapterIds.has(lesson.chapter)) fail(where, `unknown chapter "${lesson.chapter}"`);
	for (const field of ['title', 'blurb']) {
		if (typeof lesson[field] !== 'string' || !lesson[field].trim()) fail(where, `missing ${field}`);
	}
	if (lesson.setup !== undefined) checkSetup(`${where} setup`, lesson.setup);
	if (!Array.isArray(lesson.steps) || lesson.steps.length < 2) {
		fail(where, 'needs at least two steps');
		continue;
	}
	for (const [si, step] of lesson.steps.entries()) {
		const at = `${where} step ${si + 1} (${step.title ?? ''})`;
		stepCount++;
		for (const field of ['title', 'do']) {
			if (typeof step[field] !== 'string' || !step[field].trim()) fail(at, `missing ${field}`);
		}
		for (const field of ['listen', 'look', 'caveat']) {
			if (step[field] !== undefined && typeof step[field] !== 'string') {
				fail(at, `${field} must be text`);
			}
		}
		if (!VIEWS.has(step.view)) fail(at, `view must be one of ${[...VIEWS].join(', ')}`);
		if (!Array.isArray(step.controls) || step.controls.length === 0) {
			fail(at, 'needs at least one control to highlight');
		} else {
			for (const id of step.controls) {
				if (!VALID_BUTTON_IDS.has(id)) fail(at, `unknown control "${id}"`);
			}
		}
		if (step.goal !== undefined) {
			goalCount++;
			checkGoal(at, step.goal);
		} else manualCount++;
		checkCite(at, step.cite);
	}
}

const byId = new Map((lessons ?? []).map((lesson) => [lesson.id, lesson]));
const core = (lessons ?? []).filter((lesson) => lesson.track === 'core');
if (core.length < MIN_CORE) fail('lessons', `expected at least ${MIN_CORE} core lessons`);
for (const lesson of lessons ?? []) {
	const where = `lesson ${lesson.id}`;
	if (lesson.track === 'core' && lesson.parent !== undefined) {
		fail(where, 'a core lesson has no parent');
	}
	if (lesson.track === 'side') {
		const parent = byId.get(lesson.parent);
		if (!parent) fail(where, `parent "${lesson.parent}" is not a lesson`);
		else if (parent.track !== 'core') fail(where, 'parent must be a core lesson');
	}
}

for (const id of ['oscillators', 'sub-and-noise', 'filter', 'envelopes', 'lfo', 'delay-reverb']) {
	if (!ids.has(id)) fail('lessons', `kept lesson "${id}" is missing (don’t drop saved progress)`);
}
if (ids.has('chords-and-arp')) {
	fail('lessons', 'chords-and-arp was split into voices and arpeggiator');
}
const kept = {
	oscillators: 'core',
	filter: 'core',
	envelopes: 'core',
	lfo: 'core',
	'sub-and-noise': 'side',
	'delay-reverb': 'side'
};
for (const [id, track] of Object.entries(kept)) {
	const lesson = byId.get(id);
	if (lesson && lesson.track !== track) fail(`lesson ${id}`, `track should stay ${track}`);
}
const sub = byId.get('sub-and-noise');
if (sub && sub.parent !== 'oscillators')
	fail('lesson sub-and-noise', 'parent should be oscillators');
const fx = byId.get('delay-reverb');
if (fx && fx.parent !== 'envelopes') fail('lesson delay-reverb', 'parent should be envelopes');

for (const file of chapterByFile.keys()) {
	if (!(lessons ?? []).some((lesson) => lesson.chapter === file)) {
		fail('chapters', `no lesson is filed under ${file}`);
	}
}

if (errors.length > 0) {
	console.error(`❌ lessons.json has ${errors.length} problem(s):`);
	for (const e of errors) console.error(`   • ${e}`);
	process.exit(1);
}
console.log(
	`✔ Validated ${core.length} core + ${(lessons?.length ?? 0) - core.length} side lessons (${stepCount} steps, ${goalCount} auto-advance, ${manualCount} manual) — every step cites the manual verbatim.`
);
