<script lang="ts">
	/**
	 * @file LiveWave.svelte
	 * @description Scrolling waveform of the last ~10 s while the recorder runs (HiDPI canvas).
	 */
	import { recorderStore } from '#lib/stores/recorder.svelte.js';

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
		const ctx = el?.getContext('2d');
		if (!el || !ctx) return;
		let frame = 0;
		const draw = () => {
			frame = requestAnimationFrame(draw);
			const { w, h, dpr } = size;
			if (w === 0) return;
			ctx.fillStyle = '#06080b';
			ctx.fillRect(0, 0, w, h);
			ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
			ctx.fillRect(0, Math.round(h / 2), w, Math.max(1, dpr));
			const live = recorderStore.live;
			const points = live.length / 2;
			if (points < 2) return;
			// Newest audio at the right edge; one point per (fractional) pixel column.
			const perPx = Math.max(1, points / w);
			const mid = h / 2;
			const scale = h * 0.46;
			ctx.save();
			ctx.shadowColor = 'rgba(248, 113, 113, 0.55)';
			ctx.shadowBlur = 8 * dpr;
			ctx.fillStyle = '#f87171';
			ctx.beginPath();
			const columns = Math.min(w, Math.floor(points / perPx));
			for (let x = 0; x < columns; x++) {
				const from = Math.floor(points - (x + 1) * perPx);
				const to = Math.floor(points - x * perPx);
				let lo = 0;
				let hi = 0;
				for (let p = Math.max(0, from); p < to; p++) {
					if (live[p * 2] < lo) lo = live[p * 2];
					if (live[p * 2 + 1] > hi) hi = live[p * 2 + 1];
				}
				const px = w - x - 1;
				const top = mid - hi * scale;
				const bottom = mid - lo * scale;
				ctx.rect(px, top, 1, Math.max(dpr, bottom - top));
			}
			ctx.fill();
			ctx.restore();
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	});
</script>

<div class="live" role="img" aria-label="Live waveform of the recording">
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>

<style>
	.live {
		border-radius: 0.55rem;
		overflow: hidden;
		box-shadow: inset 0 0 0 1px #3f1d22;
	}

	canvas {
		display: block;
		inline-size: 100%;
		block-size: 96px;
	}
</style>
