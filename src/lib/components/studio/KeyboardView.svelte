<script lang="ts">
	/**
	 * @file KeyboardView.svelte
	 * @description On-screen keyboard (SVG): lights held and sustained keys, marks the notes of the
	 * chosen scale (root ringed) and flags held notes that fall outside it.
	 */
	import { isBlackKey, noteLabel, pcName, pitchClass } from '#lib/music/theory.js';

	interface Props {
		/** Lowest key (a C). */
		low: number;
		count: number;
		held: Record<number, number>;
		sustained: Record<number, number>;
		/** Scale membership per pitch class, or null for no scale. */
		mask: boolean[] | null;
		root: number | null;
		flats: boolean;
	}

	let { low, count, held, sustained, mask, root, flats }: Props = $props();

	const WHITE_W = 28;
	const WHITE_H = 132;
	const BLACK_W = 17;
	const BLACK_H = 84;
	// Where each black key sits relative to the boundary on its right (fraction of BLACK_W).
	const BLACK_SHIFT: Record<number, number> = { 1: 0.62, 3: 0.38, 6: 0.64, 8: 0.5, 10: 0.36 };

	interface Key {
		note: number;
		x: number;
		black: boolean;
	}

	const keys = $derived.by(() => {
		const out: Key[] = [];
		let whiteIndex = 0;
		for (let note = low; note < low + count; note++) {
			if (isBlackKey(note)) {
				const boundary = whiteIndex * WHITE_W;
				out.push({ note, x: boundary - BLACK_W * BLACK_SHIFT[pitchClass(note)], black: true });
			} else {
				out.push({ note, x: whiteIndex * WHITE_W, black: false });
				whiteIndex++;
			}
		}
		return out;
	});
	const whites = $derived(keys.filter((k) => !k.black));
	const blacks = $derived(keys.filter((k) => k.black));
	const width = $derived(whites.length * WHITE_W);

	function state(note: number): 'held' | 'sustained' | 'off' {
		if (note in held) return 'held';
		if (note in sustained) return 'sustained';
		return 'off';
	}

	const outside = (note: number) => mask !== null && !mask[pitchClass(note)];
	const inScale = (note: number) => mask !== null && mask[pitchClass(note)];
	const isRoot = (note: number) => root !== null && mask !== null && pitchClass(note) === root;

	const sounding = $derived(
		Object.keys({ ...sustained, ...held })
			.map(Number)
			.sort((a, b) => a - b)
	);
	const ariaLabel = $derived(
		`Keyboard ${noteLabel(low, flats)} to ${noteLabel(low + count - 1, flats)}. ` +
			(sounding.length
				? `Playing ${sounding.map((n) => noteLabel(n, flats)).join(', ')}.`
				: 'No keys held.')
	);
</script>

<svg
	class="kbd"
	viewBox="-2 -2 {width + 4} {WHITE_H + 4}"
	role="img"
	aria-label={ariaLabel}
	preserveAspectRatio="xMidYMid meet"
>
	<defs>
		<linearGradient id="kbdHeld" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#fdba74" />
			<stop offset="1" stop-color="#ea580c" />
		</linearGradient>
		<linearGradient id="kbdOutside" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#fda4af" />
			<stop offset="1" stop-color="#e11d48" />
		</linearGradient>
		<linearGradient id="kbdWhite" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#e7e5df" />
			<stop offset="1" stop-color="#fbfaf7" />
		</linearGradient>
		<filter id="kbdGlow" x="-50%" y="-20%" width="200%" height="140%">
			<feGaussianBlur stdDeviation="3" result="blur" />
			<feMerge>
				<feMergeNode in="blur" />
				<feMergeNode in="SourceGraphic" />
			</feMerge>
		</filter>
	</defs>

	{#each whites as key (key.note)}
		{@const s = state(key.note)}
		<g class="key key--white key--{s}" class:key--outside={s !== 'off' && outside(key.note)}>
			<rect
				x={key.x + 1}
				y="0"
				width={WHITE_W - 2}
				height={WHITE_H}
				rx="4"
				filter={s === 'held' ? 'url(#kbdGlow)' : undefined}
			/>
			{#if inScale(key.note)}
				<circle
					class="dot"
					class:dot--root={isRoot(key.note)}
					cx={key.x + WHITE_W / 2}
					cy={WHITE_H - 30}
					r={isRoot(key.note) ? 5.5 : 4}
				/>
			{/if}
			{#if s !== 'off'}
				<text class="key__name" x={key.x + WHITE_W / 2} y={WHITE_H - 46}
					>{pcName(key.note, flats)}</text
				>
			{/if}
			{#if pitchClass(key.note) === 0}
				<text class="key__octave" x={key.x + WHITE_W / 2} y={WHITE_H - 10}
					>{noteLabel(key.note)}</text
				>
			{/if}
		</g>
	{/each}
	{#each blacks as key (key.note)}
		{@const s = state(key.note)}
		<g class="key key--black key--{s}" class:key--outside={s !== 'off' && outside(key.note)}>
			<rect
				x={key.x}
				y="0"
				width={BLACK_W}
				height={BLACK_H}
				rx="3"
				filter={s === 'held' ? 'url(#kbdGlow)' : undefined}
			/>
			{#if inScale(key.note)}
				<circle
					class="dot"
					class:dot--root={isRoot(key.note)}
					cx={key.x + BLACK_W / 2}
					cy={BLACK_H - 14}
					r={isRoot(key.note) ? 4.5 : 3.2}
				/>
			{/if}
		</g>
	{/each}
</svg>

<style>
	.kbd {
		display: block;
		inline-size: 100%;
		block-size: auto;
	}

	.key rect {
		transition:
			fill 0.08s ease,
			opacity 0.2s ease;
	}

	.key--white rect {
		fill: url(#kbdWhite);
		stroke: #1a1d22;
		stroke-width: 1.2;
	}

	.key--black rect {
		fill: #22262d;
		stroke: #0b0d10;
		stroke-width: 1.2;
	}

	.key--held rect {
		fill: url(#kbdHeld);
	}

	.key--sustained rect {
		fill: url(#kbdHeld);
		opacity: 0.55;
	}

	.key--outside rect {
		fill: url(#kbdOutside);
	}

	.dot {
		fill: #0891b2;
		pointer-events: none;
	}

	.key--black .dot {
		fill: #22d3ee;
	}

	.dot--root {
		fill: #22d3ee;
		stroke: #ecfeff;
		stroke-width: 1.6;
	}

	.key--white .dot--root {
		stroke: #0e7490;
	}

	.key__name {
		font-size: 10px;
		font-weight: 800;
		text-anchor: middle;
		fill: #fff7ed;
		pointer-events: none;
	}

	.key__octave {
		font-size: 8.5px;
		font-weight: 700;
		text-anchor: middle;
		fill: #6b7280;
		pointer-events: none;
	}

	.key--held .key__octave,
	.key--sustained .key__octave {
		fill: #fff7ed;
	}
</style>
