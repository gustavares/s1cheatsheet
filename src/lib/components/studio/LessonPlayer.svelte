<script lang="ts">
	/**
	 * @file LessonPlayer.svelte
	 * @description Guided lessons on the real knobs. Each step lights its controls on the drawing,
	 * switches the Visualizer to the right view and, with Connect S-1 on, advances by itself once
	 * the knob mirror reports the move. Progress is kept in localStorage.
	 */
	import { untrack } from 'svelte';
	import {
		ArrowLeft,
		ArrowRight,
		BookOpen,
		Check,
		Eye,
		GitBranch,
		LayoutGrid,
		Music,
		RotateCcw,
		Square,
		Volume2,
		Wand2
	} from '@lucide/svelte';
	import {
		CHAPTERS,
		CORE_LESSONS,
		SIDE_LESSONS,
		ccLabel,
		chapterTitle,
		citeDocLabel,
		conditionLabel,
		conditionMet,
		goalMet,
		lessonsInChapter,
		loadLessonProgress,
		saveLessonProgress,
		setupMessages,
		sidesOf,
		watchedCcs,
		type Lesson,
		type LessonProgress
	} from '#lib/lessons.js';
	import { audioStore } from '#lib/stores/audio.svelte.js';
	import { midiStore, type MidiEvent } from '#lib/stores/midi.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { vizStore } from '#lib/stores/viz.svelte.js';

	const NOTE = 45;
	const NOTE_NAME = 'A2';
	const ADVANCE_MS = 1400;
	const VIEW_LABEL = { scope: 'Oscilloscope', spectrum: 'Spectrum', spectrogram: 'Spectrogram' };

	let progress = $state<Record<string, LessonProgress>>(loadLessonProgress());
	let browser = $state<'core' | 'chapter'>('core');
	let openId = $state<string | null>(null);
	let stepIndex = $state(0);
	let moves = $state(0);
	let notesSeen = $state(0);
	let sawProgram = $state(false);
	let sawRealtime = $state(false);
	let completed = $state(false);
	let holding = $state(false);
	let message = $state('');
	let advanceTimer: ReturnType<typeof setTimeout> | undefined;
	let lastSeen: MidiEvent | null = midiStore.lastEvent;
	let lastInput = midiStore.inputNotice;
	let skipEvent: MidiEvent | null = null;

	const lesson = $derived(
		CORE_LESSONS.find((l) => l.id === openId) ?? SIDE_LESSONS.find((l) => l.id === openId) ?? null
	);
	const step = $derived(lesson ? lesson.steps[stepIndex] : null);
	const isLast = $derived(lesson ? stepIndex === lesson.steps.length - 1 : false);
	const coreIndex = $derived(
		lesson?.track === 'core' ? CORE_LESSONS.findIndex((l) => l.id === lesson.id) : -1
	);
	const nextCore = $derived(coreIndex >= 0 ? (CORE_LESSONS[coreIndex + 1] ?? null) : null);
	const parentLesson = $derived(
		lesson?.parent ? (CORE_LESSONS.find((l) => l.id === lesson.parent) ?? null) : null
	);
	const branches = $derived(lesson?.track === 'core' ? sidesOf(lesson.id) : []);
	const connected = $derived(midiStore.status === 'connected');
	const canSend = $derived(connected && midiStore.outputReady);
	const coreDone = $derived(CORE_LESSONS.filter((l) => progress[l.id]?.done).length);
	const sideDone = $derived(SIDE_LESSONS.filter((l) => progress[l.id]?.done).length);
	const lessonFinished = $derived(completed && isLast);

	// Light the step's controls on the drawing and show the right Visualizer view.
	$effect(() => {
		const s = lessonFinished ? null : step;
		uiStore.lessonHighlight = s ? s.controls : [];
		if (s) untrack(() => (vizStore.view = s.view));
	});

	// CCs from the knob mirror, plus notes, program change, and start/stop.
	$effect(() => {
		const event = midiStore.lastEvent;
		const notice = midiStore.inputNotice;
		const goal = step?.goal;
		untrack(() => {
			if (!goal || completed) return;
			let changed = false;
			if (event && event !== lastSeen) {
				lastSeen = event;
				if (event !== skipEvent) {
					if (watchedCcs(goal).includes(event.cc)) moves += 1;
					changed = true;
				}
			}
			if (notice && notice !== lastInput) {
				lastInput = notice;
				if (notice.kind === 'note' && goal.notes) notesSeen += 1;
				if (notice.kind === 'program' && goal.program) sawProgram = true;
				if (goal.realtime && notice.kind === goal.realtime) sawRealtime = true;
				changed = true;
			}
			if (
				changed &&
				goalMet(goal, midiStore.values, moves, {
					notes: notesSeen,
					program: sawProgram,
					realtime: sawRealtime
				})
			) {
				complete();
			}
		});
	});

	// Leaving the lessons: drop the highlight, stop timers, release a held note.
	$effect(() => () => {
		uiStore.lessonHighlight = [];
		clearTimeout(advanceTimer);
		if (untrack(() => holding)) noteOff();
	});

	function remember(id: string, index: number, done: boolean) {
		const previous = progress[id];
		progress = { ...progress, [id]: { step: index, done: done || previous?.done === true } };
		saveLessonProgress(progress);
	}

	function open(id: string) {
		const target = CORE_LESSONS.find((l) => l.id === id) ?? SIDE_LESSONS.find((l) => l.id === id);
		if (!target) return;
		const saved = progress[id];
		openId = id;
		goTo(saved && !saved.done ? saved.step : 0);
	}

	function goTo(index: number) {
		if (!lesson) return;
		clearTimeout(advanceTimer);
		stepIndex = Math.max(0, Math.min(lesson.steps.length - 1, index));
		moves = 0;
		notesSeen = 0;
		sawProgram = false;
		sawRealtime = false;
		completed = false;
		message = '';
		lastSeen = midiStore.lastEvent;
		lastInput = midiStore.inputNotice;
		remember(lesson.id, stepIndex, false);
	}

	function complete() {
		if (!lesson) return;
		completed = true;
		const index = stepIndex;
		const last = index === lesson.steps.length - 1;
		remember(lesson.id, index, last);
		clearTimeout(advanceTimer);
		if (!last) advanceTimer = setTimeout(() => goTo(index + 1), ADVANCE_MS);
	}

	function next() {
		if (!lesson) return;
		if (isLast) complete();
		else goTo(stepIndex + 1);
	}

	function backToPicker() {
		clearTimeout(advanceTimer);
		openId = null;
		message = '';
	}

	function setUp() {
		if (!lesson) return;
		const sent = midiStore.sendControlChanges(setupMessages(lesson));
		skipEvent = midiStore.lastEvent;
		message = sent
			? `Sent a plain starting sound for this lesson (${sent} knob CCs).`
			: 'Connect S-1 first (above the drawing).';
	}

	function noteOff() {
		midiStore.send([0x80 | (midiStore.channel - 1), NOTE, 0]);
	}

	function toggleHold() {
		if (holding) {
			noteOff();
			holding = false;
		} else if (midiStore.send([0x90 | (midiStore.channel - 1), NOTE, 100])) {
			holding = true;
		} else {
			message = 'Connect S-1 first, or hold a pad on the S-1 yourself.';
		}
	}

	function lessonMeta(item: Lesson, saved: LessonProgress | undefined): string {
		if (saved?.done) return `Done · ${item.steps.length} steps`;
		if (saved) return `Step ${saved.step + 1} of ${item.steps.length}`;
		return `${item.steps.length} steps`;
	}

	function valueText(cc: number): string {
		const v = midiStore.values[cc];
		return v === undefined ? 'not seen yet' : `now ${v}`;
	}
</script>

<section class="tool" aria-labelledby="lessons-title">
	{#if !lesson}
		<header class="tool__head">
			<h3 id="lessons-title">Guided lessons</h3>
			<p>
				The core path is the short way through the instrument. Side lessons hang off a core lesson
				and can wait. Each step lights a control on the drawing. With <strong>Connect S-1</strong>
				on, a step moves on by itself when the S-1 sends a note, a control change, a program change, or
				start/stop — only messages the MIDI chart says it transmits. Anything else has a
				<strong>Done</strong> button. Roland publishes this as one Owner’s Manual (v1.02); the parameter
				lists live in that book, not in a separate guide.
			</p>
		</header>
		<div class="overalls">
			<p class="overall">
				<span class="overall__label">Core</span>
				<span class="overall__bar" aria-hidden="true">
					<span style="inline-size: {(coreDone / CORE_LESSONS.length) * 100}%"></span>
				</span>
				{coreDone} of {CORE_LESSONS.length}
			</p>
			<p class="overall">
				<span class="overall__label">Side</span>
				<span class="overall__bar overall__bar--side" aria-hidden="true">
					<span style="inline-size: {(sideDone / SIDE_LESSONS.length) * 100}%"></span>
				</span>
				{sideDone} of {SIDE_LESSONS.length}
			</p>
		</div>
		<div class="switch" role="tablist" aria-label="How to browse lessons">
			<button
				type="button"
				role="tab"
				class="switch__btn"
				aria-selected={browser === 'core'}
				onclick={() => (browser = 'core')}
			>
				Core path
			</button>
			<button
				type="button"
				role="tab"
				class="switch__btn"
				aria-selected={browser === 'chapter'}
				onclick={() => (browser = 'chapter')}
			>
				By chapter
			</button>
		</div>
		{#if browser === 'core'}
			<ol class="path">
				{#each CORE_LESSONS as item, i (item.id)}
					{@const saved = progress[item.id]}
					{@const sides = sidesOf(item.id)}
					<li class="path__item">
						<button
							type="button"
							class="card"
							class:card--done={saved?.done}
							onclick={() => open(item.id)}
						>
							<span class="card__number" aria-hidden="true">
								{#if saved?.done}<Check size={15} />{:else}{i + 1}{/if}
							</span>
							<span class="card__body">
								<span class="card__title">{item.title}</span>
								<span class="card__blurb">{item.blurb}</span>
								<span class="card__meta">{lessonMeta(item, saved)}</span>
							</span>
						</button>
						{#if sides.length}
							<ul class="branches">
								{#each sides as side (side.id)}
									{@const sideSaved = progress[side.id]}
									<li>
										<button
											type="button"
											class="branch"
											class:branch--done={sideSaved?.done}
											onclick={() => open(side.id)}
										>
											<GitBranch size={13} />
											<span class="branch__title">{side.title}</span>
											<span class="branch__meta">{lessonMeta(side, sideSaved)}</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ol>
		{:else}
			<div class="chapters">
				{#each CHAPTERS as chapter (chapter.id)}
					{@const items = lessonsInChapter(chapter.id)}
					<section class="chapter" aria-labelledby="ch-{chapter.id}">
						<h4 id="ch-{chapter.id}">{chapter.title}</h4>
						<ul class="chapter__list">
							{#each items as item (item.id)}
								{@const saved = progress[item.id]}
								<li>
									<button
										type="button"
										class="branch"
										class:branch--core={item.track === 'core'}
										class:branch--done={saved?.done}
										onclick={() => open(item.id)}
									>
										<span class="branch__kind">{item.track === 'core' ? 'Core' : 'Side'}</span>
										<span class="branch__title">{item.title}</span>
										<span class="branch__meta">{lessonMeta(item, saved)}</span>
									</button>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>
		{/if}
	{:else if step}
		<div class="lesson">
			<div class="lesson__bar">
				<button type="button" class="btn btn--small" onclick={backToPicker}>
					<LayoutGrid size={13} /> All lessons
				</button>
				<span class="lesson__kicker">
					{#if lesson.track === 'core'}
						Core {coreIndex + 1} of {CORE_LESSONS.length}
					{:else}
						Side · {parentLesson?.title}
					{/if}
				</span>
			</div>
			<h3 id="lessons-title" class="lesson__title">{lesson.title}</h3>
			<p class="lesson__where">{chapterTitle(lesson.chapter)}</p>
			{#if lesson.track === 'side' && parentLesson}
				<p class="lesson__back">
					<button
						type="button"
						class="btn btn--small"
						onclick={() => parentLesson && open(parentLesson.id)}
					>
						<ArrowLeft size={13} />
						{parentLesson.title}
					</button>
				</p>
			{:else if branches.length}
				<ul class="branches branches--inline">
					{#each branches as side (side.id)}
						<li>
							<button type="button" class="branch" onclick={() => open(side.id)}>
								<GitBranch size={13} />
								<span class="branch__title">{side.title}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="dots" role="group" aria-label="Steps">
				{#each lesson.steps as s, i (i)}
					<button
						type="button"
						class="dot"
						class:dot--current={i === stepIndex}
						class:dot--past={i < stepIndex || (i === stepIndex && completed)}
						aria-label="Step {i + 1}: {s.title}"
						aria-current={i === stepIndex ? 'step' : undefined}
						onclick={() => goTo(i)}
					>
						{#if i < stepIndex || (i === stepIndex && completed)}<Check size={11} />{:else}{i +
								1}{/if}
					</button>
				{/each}
			</div>

			{#if lessonFinished}
				<div class="finish" role="status">
					<p class="finish__title"><Check size={18} /> Lesson complete</p>
					<p class="finish__text">
						{#if lesson.track === 'core' && nextCore}
							Up next on the core path: {nextCore.title}. {nextCore.blurb} Side lessons never block that.
						{:else if lesson.track === 'core'}
							That was the last core lesson. The side lessons are still there whenever you want
							them.
						{:else}
							Optional lesson done. The core path is unchanged.
						{/if}
					</p>
					<div class="actions">
						{#if lesson.track === 'core' && nextCore}
							<button
								type="button"
								class="btn btn--accent"
								onclick={() => nextCore && open(nextCore.id)}
							>
								Next core lesson <ArrowRight size={14} />
							</button>
						{:else if parentLesson}
							<button
								type="button"
								class="btn btn--accent"
								onclick={() => parentLesson && open(parentLesson.id)}
							>
								<ArrowLeft size={14} />
								{parentLesson.title}
							</button>
						{/if}
						<button type="button" class="btn" onclick={() => goTo(0)}>
							<RotateCcw size={13} /> Restart this lesson
						</button>
						<button type="button" class="btn" onclick={backToPicker}>
							<LayoutGrid size={13} /> All lessons
						</button>
					</div>
				</div>
			{:else}
				<article class="step" aria-live="polite">
					<p class="step__kicker">
						Step {stepIndex + 1} of {lesson.steps.length}
						{#if !step.goal}<span class="manual">Manual</span>{/if}
					</p>
					<h4 class="step__title">{step.title}</h4>
					<p class="step__do">{step.do}</p>
					{#if step.caveat}<p class="caveat">{step.caveat}</p>{/if}
					<ul class="step__hints">
						{#if step.listen}
							<li><Volume2 size={13} /> <span><strong>Listen:</strong> {step.listen}</span></li>
						{/if}
						{#if step.look}
							<li>
								<Eye size={13} />
								<span><strong>Look</strong> ({VIEW_LABEL[step.view]}): {step.look}</span>
							</li>
						{/if}
					</ul>

					{#if step.goal}
						<ul class="goals" aria-label="What the page is waiting for">
							{#each step.goal.when ?? [] as condition (condition.cc)}
								{@const ok = conditionMet(condition, midiStore.values)}
								<li class="goal" class:goal--ok={ok}>
									{#if ok}<Check size={12} />{/if}
									<span class="goal__name">{conditionLabel(condition)}</span>
									<span class="goal__now">{valueText(condition.cc)}</span>
								</li>
							{/each}
							{#if watchedCcs(step.goal).length && (!step.goal.when?.length || (step.goal.moves ?? 1) > 1)}
								{@const need = step.goal.moves ?? 1}
								<li class="goal" class:goal--ok={moves >= need}>
									{#if moves >= need}<Check size={12} />{/if}
									<span class="goal__name">
										Turn {watchedCcs(step.goal).slice(0, 3).map(ccLabel).join(' / ')}
									</span>
									<span class="goal__now">{Math.min(moves, need)}/{need} moves</span>
								</li>
							{/if}
							{#if step.goal.notes}
								<li class="goal" class:goal--ok={notesSeen >= step.goal.notes}>
									{#if notesSeen >= step.goal.notes}<Check size={12} />{/if}
									<span class="goal__name">Note On</span>
									<span class="goal__now"
										>{Math.min(notesSeen, step.goal.notes)}/{step.goal.notes}</span
									>
								</li>
							{/if}
							{#if step.goal.program}
								<li class="goal" class:goal--ok={sawProgram}>
									{#if sawProgram}<Check size={12} />{/if}
									<span class="goal__name">Program change</span>
								</li>
							{/if}
							{#if step.goal.realtime}
								<li class="goal" class:goal--ok={sawRealtime}>
									{#if sawRealtime}<Check size={12} />{/if}
									<span class="goal__name"
										>MIDI {step.goal.realtime === 'start' ? 'Start' : 'Stop'}</span
									>
								</li>
							{/if}
						</ul>
					{/if}

					<p class="status" class:status--done={completed} role="status">
						{#if completed}
							<Check size={14} /> Nice! On to the next step…
						{:else if !step.goal}
							The S-1 doesn’t send this, so the page can’t see it. Do it on the instrument, then
							press
							{isLast ? 'Finish' : 'Done'}.
						{:else if !connected}
							Connect S-1 (above the drawing) and the page moves on when the S-1 sends what this
							step is waiting for, or press Skip.
						{:else}
							Waiting for your move on the S-1…
						{/if}
					</p>

					<blockquote class="cite">
						<BookOpen size={13} />
						<span>
							<span class="cite__src">
								{citeDocLabel(step.cite.doc)} · {step.cite.section} · p. {step.cite.page}:
							</span>
							“{step.cite.quote}”
						</span>
					</blockquote>

					<div class="actions">
						<button
							type="button"
							class="btn"
							onclick={() => goTo(stepIndex - 1)}
							disabled={stepIndex === 0}
						>
							<ArrowLeft size={14} /> Back
						</button>
						<button
							type="button"
							class="btn"
							class:btn--accent={!step.goal || completed}
							onclick={next}
						>
							{#if isLast}Finish{:else if !step.goal}Done{:else if completed}Next{:else}Skip{/if}
							<ArrowRight size={14} />
						</button>
						<span class="actions__gap" aria-hidden="true"></span>
						<button type="button" class="btn" onclick={setUp} disabled={!canSend}>
							<Wand2 size={14} /> Set up the lesson
						</button>
						<button
							type="button"
							class="btn btn--primary"
							aria-pressed={holding}
							onclick={toggleHold}
							disabled={!canSend}
						>
							{#if holding}<Square size={13} /> Release {NOTE_NAME}{:else}<Music size={14} /> Hold
								{NOTE_NAME}{/if}
						</button>
					</div>

					{#if !audioStore.open}
						<p class="tool__note">
							<button
								type="button"
								class="btn btn--small btn--primary"
								onclick={() => audioStore.start()}
							>
								Open the Visualizer
							</button>
							to see each change ({VIEW_LABEL[step.view]} for this step).
						</p>
					{/if}
					{#if message}<p class="tool__status" role="status">{message}</p>{/if}
				</article>
			{/if}
		</div>
	{/if}
</section>

<style>
	.overalls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem 1.4rem;
		margin: 0 0 0.7rem;
	}

	.overall {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0;
		font-size: 0.74rem;
		font-weight: 700;
		color: #94a3b8;
	}

	.overall__label {
		flex: none;
		inline-size: 2.4rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.overall__bar {
		flex: 0 0 8rem;
		block-size: 6px;
		overflow: hidden;
		background: #1e2430;
		border-radius: 999px;
	}

	.overall__bar span {
		display: block;
		block-size: 100%;
		background: linear-gradient(90deg, #16a34a, #4ade80);
		border-radius: inherit;
		transition: inline-size 0.3s ease;
	}

	.overall__bar--side span {
		background: linear-gradient(90deg, #c2410c, #fdba74);
	}

	.switch {
		display: flex;
		gap: 0.35rem;
		margin: 0 0 0.8rem;
	}

	.switch__btn {
		margin: 0;
		padding: 0.28rem 0.7rem;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #94a3b8;
		background: #11141a;
		border: 1px solid #2e3543;
		border-radius: 999px;
		cursor: pointer;
	}

	.switch__btn[aria-selected='true'] {
		color: #fff7ed;
		background: rgba(234, 88, 12, 0.18);
		border-color: #ea580c;
	}

	.path,
	.chapter__list,
	.branches {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.path {
		display: grid;
		gap: 0.85rem;
	}

	.branches {
		display: grid;
		gap: 0.35rem;
		margin: 0.4rem 0 0 1.15rem;
		padding-inline-start: 0.75rem;
		border-inline-start: 2px solid #2a2f3a;
	}

	.branches--inline {
		margin: 0 0 0.7rem;
	}

	.branch {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.35rem 0.55rem;
		inline-size: 100%;
		margin: 0;
		padding: 0.4rem 0.55rem;
		text-align: left;
		color: #cbd5e1;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 0.45rem;
		cursor: pointer;
	}

	.branch:hover {
		background: #11141a;
		border-color: #2a2f3a;
	}

	.branch__title {
		font-size: 0.8rem;
		font-weight: 700;
	}

	.branch__meta,
	.branch__kind {
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #64748b;
	}

	.branch--core .branch__kind {
		color: #fdba74;
	}

	.branch--done .branch__title {
		color: #bbf7d0;
	}

	.chapters {
		display: grid;
		gap: 1rem;
	}

	.chapter h4 {
		margin: 0 0 0.4rem;
		font-size: 0.78rem;
		font-weight: 800;
		color: #e2e8f0;
	}

	.lesson__where {
		margin: -0.2rem 0 0.55rem;
		font-size: 0.72rem;
		color: #64748b;
	}

	.lesson__back {
		margin: 0 0 0.55rem;
	}

	.manual {
		margin-inline-start: 0.45rem;
		padding: 0.05rem 0.4rem;
		font-size: 0.62rem;
		letter-spacing: 0.06em;
		color: #fde68a;
		background: rgba(234, 179, 8, 0.12);
		border: 1px solid rgba(234, 179, 8, 0.45);
		border-radius: 999px;
	}

	.caveat {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.45;
		color: #fcd34d;
	}

	.card {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		inline-size: 100%;
		block-size: 100%;
		margin: 0;
		padding: 0.75rem 0.8rem;
		text-align: left;
		background: #0b0d11;
		border: 1px solid #2a2f3a;
		border-radius: 0.7rem;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background 0.15s ease;
	}

	.card:hover {
		border-color: #ea580c;
		background: #11141a;
	}

	.card__number {
		display: grid;
		place-items: center;
		flex: none;
		inline-size: 1.7rem;
		block-size: 1.7rem;
		font-size: 0.78rem;
		font-weight: 800;
		color: #fdba74;
		background: rgba(234, 88, 12, 0.14);
		border: 1px solid rgba(234, 88, 12, 0.55);
		border-radius: 999px;
	}

	.card--done .card__number {
		color: #bbf7d0;
		background: rgba(22, 163, 74, 0.16);
		border-color: rgba(74, 222, 128, 0.55);
	}

	.card__body {
		display: grid;
		gap: 0.2rem;
	}

	.card__title {
		font-size: 0.86rem;
		font-weight: 800;
		color: #f1f5f9;
	}

	.card__blurb {
		font-size: 0.75rem;
		line-height: 1.45;
		color: #94a3b8;
	}

	.card__meta {
		margin-top: 0.15rem;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #64748b;
	}

	.card--done .card__meta {
		color: #86efac;
	}

	.lesson__bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.lesson__kicker,
	.step__kicker {
		margin: 0;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #fb923c;
	}

	.lesson__title {
		margin: 0.6rem 0 0.5rem;
		font-size: 1.1rem;
		font-weight: 800;
		color: #f8fafc;
	}

	.dots {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: 0.8rem;
	}

	.dot {
		display: grid;
		place-items: center;
		inline-size: 1.65rem;
		block-size: 1.65rem;
		margin: 0;
		padding: 0;
		font-size: 0.72rem;
		font-weight: 800;
		color: #94a3b8;
		background: #11141a;
		border: 1px solid #2e3543;
		border-radius: 999px;
		cursor: pointer;
	}

	.dot--past {
		color: #bbf7d0;
		background: rgba(22, 163, 74, 0.18);
		border-color: rgba(74, 222, 128, 0.5);
	}

	.dot--current {
		color: #fff7ed;
		border-color: #ea580c;
		box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.28);
	}

	.step,
	.finish {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.9rem;
		background: #0b0d11;
		border: 1px solid #2a2f3a;
		border-radius: 0.75rem;
	}

	.step :global(.tool__note),
	.step :global(.tool__status) {
		margin: 0;
	}

	.step__title {
		margin: -0.35rem 0 0;
		font-size: 1rem;
		color: #f8fafc;
	}

	.step__do {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
		color: #e2e8f0;
	}

	.step__hints {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.76rem;
		color: #94a3b8;
	}

	.step__hints li {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
	}

	.step__hints strong {
		color: #cbd5e1;
	}

	.goals {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.goal {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.28rem 0.6rem;
		font-size: 0.72rem;
		color: #cbd5e1;
		background: #13161c;
		border: 1px dashed #3b4454;
		border-radius: 999px;
	}

	.goal--ok {
		color: #bbf7d0;
		background: rgba(22, 163, 74, 0.14);
		border: 1px solid rgba(74, 222, 128, 0.5);
	}

	.goal__name {
		font-weight: 800;
	}

	.goal__now {
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.68rem;
		color: #94a3b8;
	}

	.goal--ok .goal__now {
		color: #86efac;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		font-size: 0.78rem;
		color: #a5f3fc;
	}

	.status--done {
		font-weight: 800;
		color: #86efac;
	}

	.cite {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		margin: 0;
		padding: 0.5rem 0.7rem;
		font-size: 0.74rem;
		font-style: italic;
		line-height: 1.5;
		color: #94a3b8;
		background: #10131a;
		border-inline-start: 3px solid #475569;
		border-radius: 0.4rem;
	}

	.cite__src {
		font-style: normal;
		font-weight: 800;
		color: #cbd5e1;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}

	.actions__gap {
		flex: 1 1 0;
	}

	.finish__title {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0;
		font-size: 1.05rem;
		font-weight: 800;
		color: #86efac;
	}

	.finish__text {
		margin: 0;
		font-size: 0.84rem;
		color: #cbd5e1;
	}

	@media (prefers-reduced-motion: reduce) {
		.overall__bar span {
			transition: none;
		}
	}
</style>
