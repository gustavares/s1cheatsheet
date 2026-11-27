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
		LayoutGrid,
		Music,
		RotateCcw,
		Square,
		Volume2,
		Wand2
	} from '@lucide/svelte';
	import {
		LESSONS,
		ccLabel,
		conditionLabel,
		conditionMet,
		goalMet,
		loadLessonProgress,
		saveLessonProgress,
		setupMessages,
		watchedCcs,
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
	let openId = $state<string | null>(null);
	let stepIndex = $state(0);
	let moves = $state(0);
	let completed = $state(false);
	let holding = $state(false);
	let message = $state('');
	let advanceTimer: ReturnType<typeof setTimeout> | undefined;
	let lastSeen: MidiEvent | null = midiStore.lastEvent;
	let skipEvent: MidiEvent | null = null;

	const lesson = $derived(LESSONS.find((l) => l.id === openId) ?? null);
	const lessonNumber = $derived(lesson ? LESSONS.indexOf(lesson) + 1 : 0);
	const step = $derived(lesson ? lesson.steps[stepIndex] : null);
	const isLast = $derived(lesson ? stepIndex === lesson.steps.length - 1 : false);
	const nextLesson = $derived(lesson ? (LESSONS[LESSONS.indexOf(lesson) + 1] ?? null) : null);
	const connected = $derived(midiStore.status === 'connected');
	const canSend = $derived(connected && midiStore.outputReady);
	const doneCount = $derived(LESSONS.filter((l) => progress[l.id]?.done).length);
	const lessonFinished = $derived(completed && isLast);

	// Light the step's controls on the drawing and show the right Visualizer view.
	$effect(() => {
		const s = lessonFinished ? null : step;
		uiStore.lessonHighlight = s ? s.controls : [];
		if (s) untrack(() => (vizStore.view = s.view));
	});

	// Count the player's moves and check the goal on every CC the knob mirror sees.
	$effect(() => {
		const event = midiStore.lastEvent;
		untrack(() => {
			if (!event || event === lastSeen) return;
			lastSeen = event;
			if (event === skipEvent || !step?.goal || completed) return;
			if (watchedCcs(step.goal).includes(event.cc)) moves += 1;
			if (goalMet(step.goal, midiStore.values, moves)) complete();
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
		const target = LESSONS.find((l) => l.id === id);
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
		completed = false;
		message = '';
		lastSeen = midiStore.lastEvent;
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
				Short steps on the real knobs. Each step lights the control on the drawing and says what to
				listen and look for. With <strong>Connect S-1</strong> on, the page sees your knob moves and
				moves on by itself; the <strong>Visualizer</strong> shows what each change does.
			</p>
		</header>
		<p class="overall">
			<span class="overall__bar" aria-hidden="true">
				<span style="inline-size: {(doneCount / LESSONS.length) * 100}%"></span>
			</span>
			{doneCount} of {LESSONS.length} lessons done
		</p>
		<ol class="cards">
			{#each LESSONS as item, i (item.id)}
				{@const saved = progress[item.id]}
				<li>
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
							<span class="card__meta">
								{#if saved?.done}
									Done · {item.steps.length} steps
								{:else if saved}
									Step {saved.step + 1} of {item.steps.length}
								{:else}
									{item.steps.length} steps
								{/if}
							</span>
						</span>
					</button>
				</li>
			{/each}
		</ol>
	{:else if step}
		<div class="lesson">
			<div class="lesson__bar">
				<button type="button" class="btn btn--small" onclick={backToPicker}>
					<LayoutGrid size={13} /> All lessons
				</button>
				<span class="lesson__kicker">Lesson {lessonNumber} of {LESSONS.length}</span>
			</div>
			<h3 id="lessons-title" class="lesson__title">{lesson.title}</h3>
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
						{nextLesson
							? `Up next: ${nextLesson.title}. ${nextLesson.blurb}`
							: 'That was the last lesson. Revisit any of them from the list.'}
					</p>
					<div class="actions">
						{#if nextLesson}
							<button
								type="button"
								class="btn btn--accent"
								onclick={() => nextLesson && open(nextLesson.id)}
							>
								Next lesson <ArrowRight size={14} />
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
					<p class="step__kicker">Step {stepIndex + 1} of {lesson.steps.length}</p>
					<h4 class="step__title">{step.title}</h4>
					<p class="step__do">{step.do}</p>
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
							{#if !step.goal.when?.length || (step.goal.moves ?? 1) > 1}
								{@const need = step.goal.moves ?? 1}
								<li class="goal" class:goal--ok={moves >= need}>
									{#if moves >= need}<Check size={12} />{/if}
									<span class="goal__name">
										Turn {watchedCcs(step.goal).slice(0, 3).map(ccLabel).join(' / ')}
									</span>
									<span class="goal__now">{Math.min(moves, need)}/{need} moves</span>
								</li>
							{/if}
						</ul>
					{/if}

					<p class="status" class:status--done={completed} role="status">
						{#if completed}
							<Check size={14} /> Nice! On to the next step…
						{:else if !step.goal}
							Do this on the S-1, then press {isLast ? 'Finish' : 'Next'}.
						{:else if !connected}
							Connect S-1 (above the drawing) and the page moves on when it sees the knob move, or
							press Skip.
						{:else}
							Waiting for your move on the S-1…
						{/if}
					</p>

					<blockquote class="cite">
						<BookOpen size={13} />
						<span>
							<span class="cite__src">Manual, p. {step.cite.page}:</span>
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
							{#if isLast}Finish{:else if step.goal && !completed}Skip{:else}Next{/if}
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
	.overall {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0 0 0.8rem;
		font-size: 0.74rem;
		font-weight: 700;
		color: #94a3b8;
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

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr));
		gap: 0.55rem;
		margin: 0;
		padding: 0;
		list-style: none;
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
