<script lang="ts">
	/**
	 * @file PatchMini.svelte
	 * @description Miniature S-1 knob section showing a patch's knob positions (same layout and
	 * ring colours as the main drawing). Knobs whose value wasn't captured are drawn dashed.
	 */
	import { KNOB_CC, knobAngle } from '#lib/midi.js';
	import { PANEL_CONTROLS } from '#lib/types.js';

	interface Props {
		values: Record<string, number>;
		label?: string;
		/** Optional second set drawn as faint "ghost" pointers (e.g. a drill target). */
		ghost?: Record<string, number> | null;
	}

	let { values, label = 'Knob positions', ghost = null }: Props = $props();

	const RING = { white: '#f1f1ee', green: '#4fb58f', orange: '#e0823d', dark: '#64748b' };
	const knobs = PANEL_CONTROLS.filter((c) => c.kind === 'knob' && KNOB_CC.has(c.id)).map((c) => ({
		...c,
		cc: String(KNOB_CC.get(c.id)?.cc),
		r: c.size === 'small' ? 24 : 30
	}));
</script>

<svg class="mini" viewBox="368 188 1064 356" role="img" aria-label={label}>
	<rect class="mini__bg" x="368" y="188" width="1064" height="356" rx="28" />
	{#each knobs as k (k.id)}
		{@const v = values[k.cc]}
		{@const g = ghost?.[k.cc]}
		<g transform="translate({k.x} {k.y})" class:mini__unknown={v === undefined}>
			<title>{k.label}: {v === undefined ? 'not captured' : v}</title>
			<circle class="mini__ring" r={k.r + 8} style:stroke={RING[k.ring ?? 'dark']} />
			<circle class="mini__body" r={k.r} />
			{#if g !== undefined}
				<line
					class="mini__ghost"
					x1="0"
					y1={-k.r - 4}
					x2="0"
					y2={-k.r * 0.2}
					transform="rotate({knobAngle(g)})"
				/>
			{/if}
			{#if v !== undefined}
				<line
					class="mini__pointer"
					x1="0"
					y1={-k.r + 5}
					x2="0"
					y2={-k.r * 0.25}
					transform="rotate({knobAngle(v)})"
				/>
			{/if}
		</g>
	{/each}
</svg>

<style>
	.mini {
		display: block;
		inline-size: 100%;
		block-size: auto;
	}

	.mini__bg {
		fill: #1f2023;
		stroke: #34363b;
		stroke-width: 4;
	}

	.mini__ring {
		fill: none;
		stroke-width: 9;
	}

	.mini__body {
		fill: #121214;
		stroke: #0a0a0b;
		stroke-width: 3;
	}

	.mini__pointer {
		stroke: #f8fafc;
		stroke-width: 8;
		stroke-linecap: round;
	}

	.mini__ghost {
		stroke: #fb923c;
		stroke-width: 9;
		stroke-linecap: round;
		opacity: 0.85;
	}

	.mini__unknown .mini__ring {
		opacity: 0.25;
		stroke-dasharray: 10 9;
	}

	.mini__unknown .mini__body {
		fill: none;
		stroke: #4b5563;
		stroke-dasharray: 8 8;
	}
</style>
