<script lang="ts">
	/**
	 * @file StepGrid.svelte
	 * @description Note grid for one page of the sequencer: 16 steps × 24 notes. A single tab stop
	 * with arrow-key navigation (roving focus); Space or Enter toggles a note.
	 */
	import { STEPS_PER_PAGE, type Step } from '#lib/sequencer.js';
	import { isBlackKey, noteLabel, pitchClass } from '#lib/music/theory.js';

	interface Props {
		steps: Step[];
		page: number;
		/** Lowest note shown (24 rows above it). */
		low: number;
		playhead: number;
		selected: number;
		length: number;
		ontoggle: (step: number, note: number) => void;
		onselect: (step: number) => void;
	}

	let { steps, page, low, playhead, selected, length, ontoggle, onselect }: Props = $props();

	const ROWS = 24;
	const notes = $derived(Array.from({ length: ROWS }, (_, i) => low + ROWS - 1 - i));
	const columns = $derived(
		Array.from({ length: STEPS_PER_PAGE }, (_, i) => page * STEPS_PER_PAGE + i).filter(
			(s) => s < length
		)
	);
	let cursor = $state({ row: 9, col: 0 });
	let grid = $state<HTMLDivElement | null>(null);

	function focusCell(row: number, col: number) {
		cursor = {
			row: Math.max(0, Math.min(ROWS - 1, row)),
			col: Math.max(0, Math.min(columns.length - 1, col))
		};
		grid
			?.querySelector<HTMLButtonElement>(`[data-row="${cursor.row}"][data-col="${cursor.col}"]`)
			?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		const { row, col } = cursor;
		const moves: Record<string, [number, number]> = {
			ArrowUp: [row - 1, col],
			ArrowDown: [row + 1, col],
			ArrowLeft: [row, col - 1],
			ArrowRight: [row, col + 1],
			Home: [row, 0],
			End: [row, columns.length - 1]
		};
		const move = moves[event.key];
		if (!move) return;
		event.preventDefault();
		focusCell(move[0], move[1]);
		onselect(columns[cursor.col]);
	}

	function velocityOpacity(step: Step) {
		return 0.45 + 0.55 * (step.velocity / 127);
	}
</script>

<div
	class="grid"
	role="grid"
	tabindex="-1"
	aria-label="Steps and notes"
	aria-rowcount={ROWS + 1}
	bind:this={grid}
	{onkeydown}
	style="--cols: {columns.length}"
>
	<div class="row row--head" role="row">
		<span class="label" role="columnheader"></span>
		{#each columns as step (step)}
			<button
				type="button"
				role="columnheader"
				class="head"
				class:head--beat={step % 4 === 0}
				class:head--selected={step === selected}
				class:head--playing={step === playhead}
				tabindex="-1"
				aria-label="Select step {step + 1}"
				onclick={() => onselect(step)}
			>
				{step + 1}
				{#if steps[step].notes.length > 0}<span class="head__dot" aria-hidden="true"></span>{/if}
			</button>
		{/each}
	</div>
	{#each notes as note, row (note)}
		<div
			class="row"
			class:row--black={isBlackKey(note)}
			class:row--c={pitchClass(note) === 0}
			role="row"
		>
			<span class="label" role="rowheader">{noteLabel(note)}</span>
			{#each columns as step, col (step)}
				{@const s = steps[step]}
				{@const on = s.notes.includes(note)}
				<button
					type="button"
					role="gridcell"
					class="cell"
					class:cell--on={on}
					class:cell--beat={step % 4 === 0}
					class:cell--playing={step === playhead}
					class:cell--selected={step === selected}
					data-row={row}
					data-col={col}
					tabindex={cursor.row === row && cursor.col === col ? 0 : -1}
					aria-label="Step {step + 1}, {noteLabel(note)}"
					aria-selected={on}
					onfocus={() => (cursor = { row, col })}
					onclick={() => {
						cursor = { row, col };
						onselect(step);
						ontoggle(step, note);
					}}
				>
					{#if on}
						<span
							class="cell__note"
							style="inline-size: {Math.round(s.gate * 100)}%; opacity: {velocityOpacity(s)}"
						></span>
					{/if}
				</button>
			{/each}
		</div>
	{/each}
</div>

<style>
	.grid {
		--label: 3.4rem;
		display: grid;
		gap: 1px;
		padding: 1px;
		background: #1a1f28;
		border-radius: 0.55rem;
		overflow: hidden;
		user-select: none;
	}

	.row {
		display: grid;
		grid-template-columns: var(--label) repeat(var(--cols), minmax(0, 1fr));
		gap: 1px;
	}

	.label {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding-inline-end: 0.35rem;
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.6rem;
		color: #64748b;
		background: #0e1116;
	}

	.row--c .label {
		color: #cbd5e1;
		font-weight: 700;
	}

	.head {
		position: relative;
		margin: 0;
		padding: 0.2rem 0;
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.62rem;
		font-weight: 700;
		color: #64748b;
		background: #0e1116;
		border: 0;
		cursor: pointer;
	}

	.head--beat {
		color: #cbd5e1;
	}

	.head--selected {
		color: #fff7ed;
		background: rgba(234, 88, 12, 0.35);
	}

	.head--playing {
		color: #ecfeff;
		background: rgba(8, 145, 178, 0.55);
	}

	.head__dot {
		position: absolute;
		top: 2px;
		right: 3px;
		inline-size: 4px;
		block-size: 4px;
		background: #fb923c;
		border-radius: 999px;
	}

	.cell {
		position: relative;
		display: flex;
		align-items: center;
		block-size: 0.95rem;
		margin: 0;
		padding: 0 1px;
		background: #11151c;
		border: 0;
		cursor: pointer;
	}

	.row--black .cell {
		background: #0c0f14;
	}

	.cell--beat {
		box-shadow: inset 1px 0 0 #2b3442;
	}

	.row--c .cell {
		box-shadow: inset 0 -1px 0 #2b3442;
	}

	.row--c .cell--beat {
		box-shadow:
			inset 1px 0 0 #2b3442,
			inset 0 -1px 0 #2b3442;
	}

	.cell:hover {
		background: #1c2330;
	}

	.cell--selected {
		background: #171c25;
	}

	.cell--playing {
		background: rgba(8, 145, 178, 0.2);
	}

	.cell:focus-visible {
		outline: 2px solid #fb923c;
		outline-offset: -2px;
		z-index: 1;
	}

	.cell__note {
		display: block;
		block-size: 70%;
		min-inline-size: 4px;
		background: linear-gradient(180deg, #fdba74, #ea580c);
		border-radius: 3px;
		box-shadow: 0 0 6px rgba(251, 146, 60, 0.45);
	}

	.cell--playing .cell__note {
		background: linear-gradient(180deg, #fff7ed, #fb923c);
		box-shadow: 0 0 10px rgba(251, 146, 60, 0.9);
	}
</style>
