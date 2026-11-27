<script lang="ts">
	/**
	 * @file ActivityRoll.svelte
	 * @description Scrolling piano roll of the last few seconds of KeyStep notes (HiDPI canvas),
	 * so arpeggios and sequences show their shape. The pitch range eases to fit the notes on
	 * screen (at least an octave); beat lines follow the MIDI clock.
	 */
	import { keystepStore } from '#lib/stores/keystep.svelte.js';

	interface Props {
		low: number;
		count: number;
	}

	let { low, count }: Props = $props();

	const WINDOW_MS = 4000;
	let canvas = $state<HTMLCanvasElement | null>(null);
	let size = { w: 0, h: 0, dpr: 1 };

	$effect(() => {
		const el = canvas;
		if (!el) return;
		const resize = () => {
			const rect = el.getBoundingClientRect();
			const dpr = Math.min(window.devicePixelRatio || 1, 3);
			size = { w: Math.round(rect.width * dpr), h: Math.round(rect.height * dpr), dpr };
			el.width = size.w;
			el.height = size.h;
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(el);
		return () => observer.disconnect();
	});

	$effect(() => {
		const el = canvas;
		if (!el) return;
		const ctx = el.getContext('2d');
		if (!ctx) return;
		let frame = 0;
		// Visible pitch range (floats, eased every frame).
		let viewLo = low;
		let viewRows = count;
		const draw = () => {
			frame = requestAnimationFrame(draw);
			const { w, h, dpr } = size;
			if (w === 0 || h === 0) return;
			const now = performance.now();
			const xAt = (t: number) => w - ((now - t) / WINDOW_MS) * w;

			let minNote = Infinity;
			let maxNote = -Infinity;
			for (const span of keystepStore.history) {
				if ((span.end ?? now) < now - WINDOW_MS) continue;
				minNote = Math.min(minNote, span.note);
				maxNote = Math.max(maxNote, span.note);
			}
			const fitRows = Number.isFinite(minNote)
				? Math.min(48, Math.max(12, maxNote - minNote + 5))
				: count;
			const fitLo = Number.isFinite(minNote) ? (minNote + maxNote + 1) / 2 - fitRows / 2 : low;
			viewLo += (fitLo - viewLo) * 0.12;
			viewRows += (fitRows - viewRows) * 0.12;
			const rowH = h / viewRows;
			const yOf = (note: number) => h - (note - viewLo + 1) * rowH;

			ctx.fillStyle = '#06080b';
			ctx.fillRect(0, 0, w, h);
			// Faint rows for black keys, a line and a label at every C.
			ctx.font = `700 ${9 * dpr}px ui-monospace, Menlo, Consolas, monospace`;
			ctx.textBaseline = 'bottom';
			for (let note = Math.floor(viewLo) - 1; note <= Math.ceil(viewLo + viewRows); note++) {
				const pc = ((note % 12) + 12) % 12;
				const y = yOf(note);
				if ([1, 3, 6, 8, 10].includes(pc)) {
					ctx.fillStyle = 'rgba(148, 163, 184, 0.04)';
					ctx.fillRect(0, y, w, rowH);
				}
				if (pc === 0) {
					ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
					ctx.fillRect(0, Math.round(y + rowH) - dpr, w, dpr);
					ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
					ctx.fillText(`C${Math.floor(note / 12) - 1}`, 4 * dpr, Math.round(y + rowH) - 2 * dpr);
				}
			}
			// Beat lines from the MIDI clock.
			ctx.fillStyle = 'rgba(34, 211, 238, 0.22)';
			for (const t of keystepStore.beats) {
				const x = xAt(t);
				if (x >= 0) ctx.fillRect(Math.round(x), 0, Math.max(1, dpr), h);
			}
			// Notes: open ones glow orange, finished ones fade.
			for (const span of keystepStore.history) {
				const end = span.end ?? now;
				if (end < now - WINDOW_MS) continue;
				const x0 = Math.max(0, xAt(span.start));
				const x1 = Math.max(x0 + 2 * dpr, xAt(end));
				const y = yOf(span.note) + rowH * 0.12;
				if (y > h || y + rowH < 0) continue;
				const bh = Math.max(2 * dpr, rowH * 0.76);
				const open = span.end === null;
				const strength = 0.45 + 0.55 * (span.velocity / 127);
				ctx.save();
				ctx.globalAlpha = open ? 1 : 0.35 + 0.5 * strength;
				if (open) {
					ctx.shadowColor = 'rgba(251, 146, 60, 0.8)';
					ctx.shadowBlur = 10 * dpr;
				}
				ctx.fillStyle = open ? '#fb923c' : `rgba(253, 186, 116, ${strength})`;
				ctx.beginPath();
				ctx.roundRect(x0, y, x1 - x0, bh, Math.min(3 * dpr, bh / 2));
				ctx.fill();
				ctx.restore();
			}
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	});
</script>

<div class="roll" role="img" aria-label="Recent notes over the last four seconds">
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
	<span class="roll__label" aria-hidden="true">Last 4 s</span>
</div>

<style>
	.roll {
		position: relative;
		border-radius: 0.55rem;
		overflow: hidden;
		box-shadow: inset 0 0 0 1px #1a2230;
	}

	canvas {
		display: block;
		inline-size: 100%;
		block-size: 120px;
	}

	.roll__label {
		position: absolute;
		top: 0.35rem;
		right: 0.5rem;
		font-size: 0.64rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #475569;
	}
</style>
