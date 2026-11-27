<script lang="ts">
	/**
	 * @file ValueLane.svelte
	 * @description One row of per-step values (velocity, gate or a CC parameter lock) for a page of
	 * the sequencer. Drag across it to draw values; for lock lanes, Alt-click or double-click a step
	 * clears its lock (it then sends the lane's base value). The step editor offers the same edits
	 * with sliders for keyboard users.
	 */
	import { STEPS_PER_PAGE } from '#lib/sequencer.js';

	interface Props {
		label: string;
		page: number;
		length: number;
		/** Value of a step (0–max), or null when it has none (no lock). */
		value: (step: number) => number | null;
		max: number;
		/** Dashed line for the value sent on steps without a lock. */
		base?: number | null;
		playhead: number;
		selected: number;
		tone?: 'orange' | 'cyan' | 'violet';
		onset: (step: number, value: number) => void;
		onclear?: (step: number) => void;
	}

	let {
		label,
		page,
		length,
		value,
		max,
		base = null,
		playhead,
		selected,
		tone = 'orange',
		onset,
		onclear
	}: Props = $props();

	const columns = $derived(
		Array.from({ length: STEPS_PER_PAGE }, (_, i) => page * STEPS_PER_PAGE + i).filter(
			(s) => s < length
		)
	);
	let area = $state<HTMLDivElement | null>(null);
	let drawing = false;

	function apply(event: PointerEvent) {
		const el = area;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const col = Math.floor(((event.clientX - rect.left) / rect.width) * columns.length);
		const step = columns[Math.max(0, Math.min(columns.length - 1, col))];
		if (step === undefined) return;
		if (event.altKey && onclear) {
			onclear(step);
			return;
		}
		const fraction = 1 - (event.clientY - rect.top) / rect.height;
		onset(step, Math.max(0, Math.min(1, fraction)) * max);
	}

	function down(event: PointerEvent) {
		if (event.button !== 0) return;
		drawing = true;
		area?.setPointerCapture(event.pointerId);
		apply(event);
	}

	function move(event: PointerEvent) {
		if (drawing) apply(event);
	}

	function up(event: PointerEvent) {
		drawing = false;
		area?.releasePointerCapture(event.pointerId);
	}

	function dblclick(event: MouseEvent) {
		if (!onclear || !area) return;
		const rect = area.getBoundingClientRect();
		const col = Math.floor(((event.clientX - rect.left) / rect.width) * columns.length);
		const step = columns[col];
		if (step !== undefined) onclear(step);
	}

	const display = (v: number) => (max === 1 ? `${Math.round(v * 100)}%` : `${Math.round(v)}`);
</script>

<div class="lane lane--{tone}" style="--cols: {columns.length}">
	<span class="lane__label">{label}</span>
	<div
		class="lane__area"
		bind:this={area}
		role="presentation"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		ondblclick={dblclick}
	>
		{#if base !== null}
			<span class="lane__base" style="bottom: {(base / max) * 100}%" aria-hidden="true"></span>
		{/if}
		{#each columns as step (step)}
			{@const v = value(step)}
			<span
				class="bar"
				class:bar--beat={step % 4 === 0}
				class:bar--playing={step === playhead}
				class:bar--selected={step === selected}
				title={v === null ? `Step ${step + 1}: no lock` : `Step ${step + 1}: ${display(v)}`}
			>
				{#if v !== null}
					<span class="bar__fill" style="block-size: {Math.max(4, (v / max) * 100)}%"></span>
				{/if}
			</span>
		{/each}
	</div>
</div>

<style>
	.lane {
		display: grid;
		grid-template-columns: 3.4rem 1fr;
		gap: 1px;
		margin-top: 0.4rem;
	}

	.lane__label {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding-inline-end: 0.35rem;
		font-size: 0.58rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-align: right;
		text-transform: uppercase;
		color: #94a3b8;
		overflow-wrap: normal;
	}

	.lane__area {
		position: relative;
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		gap: 1px;
		block-size: 3.2rem;
		padding: 1px;
		background: #1a1f28;
		border-radius: 0.45rem;
		touch-action: none;
		cursor: crosshair;
	}

	.lane__base {
		position: absolute;
		inset-inline: 0;
		border-top: 1px dashed rgba(148, 163, 184, 0.55);
		pointer-events: none;
		z-index: 1;
	}

	.bar {
		position: relative;
		display: flex;
		align-items: flex-end;
		background: #0e1116;
	}

	.bar--beat {
		box-shadow: inset 1px 0 0 #2b3442;
	}

	.bar--selected {
		background: #171c25;
	}

	.bar--playing {
		background: rgba(8, 145, 178, 0.2);
	}

	.bar__fill {
		display: block;
		inline-size: 100%;
		border-radius: 2px 2px 0 0;
	}

	.lane--orange .bar__fill {
		background: linear-gradient(180deg, #fdba74, #c2410c);
	}

	.lane--cyan .bar__fill {
		background: linear-gradient(180deg, #a5f3fc, #0e7490);
	}

	.lane--violet .bar__fill {
		background: linear-gradient(180deg, #ddd6fe, #6d28d9);
	}
</style>
