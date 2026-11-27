<script lang="ts">
	/**
	 * @file CompareChart.svelte
	 * @description Small HiDPI chart comparing a target (orange) with the live S-1 (green):
	 * two cycles of the waveform, or the loudness envelope aligned at the note's onset.
	 */
	import { envelopeOnset } from '#lib/visualizer/dsp.js';

	interface Props {
		kind: 'cycle' | 'envelope';
		target: Float32Array | null;
		live: Float32Array | null;
		label: string;
	}

	let { kind, target, live, label }: Props = $props();
	let canvas = $state<HTMLCanvasElement | null>(null);
	let size = $state({ w: 0, h: 0, dpr: 1 });

	$effect(() => {
		const el = canvas;
		if (!el) return;
		const resize = () => {
			const rect = el.getBoundingClientRect();
			const dpr = Math.min(window.devicePixelRatio || 1, 3);
			size = { w: Math.round(rect.width * dpr), h: Math.round(rect.height * dpr), dpr };
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(el);
		return () => observer.disconnect();
	});

	function series(data: Float32Array, start: number, length: number, repeat: number) {
		const out: number[] = [];
		for (let r = 0; r < repeat; r++)
			for (let i = 0; i < length; i++) out.push(data[(start + i) % data.length] ?? 0);
		return out;
	}

	$effect(() => {
		const el = canvas;
		const { w, h, dpr } = size;
		if (!el || w === 0 || h === 0) return;
		el.width = w;
		el.height = h;
		const ctx = el.getContext('2d');
		if (!ctx) return;
		ctx.fillStyle = '#06080b';
		ctx.fillRect(0, 0, w, h);
		ctx.lineWidth = Math.max(1, Math.round(dpr));
		ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
		for (let i = 1; i < 8; i++) {
			const x = Math.round((i * w) / 8) + 0.5;
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, h);
			ctx.stroke();
		}
		const baseline = kind === 'cycle' ? h / 2 : h - 6 * dpr;
		ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
		ctx.beginPath();
		ctx.moveTo(0, Math.round(baseline) + 0.5);
		ctx.lineTo(w, Math.round(baseline) + 0.5);
		ctx.stroke();

		const draw = (values: number[], core: string, glow: string) => {
			if (values.length < 2) return;
			const path = new Path2D();
			values.forEach((v, i) => {
				const x = (i / (values.length - 1)) * w;
				const y =
					kind === 'cycle' ? h / 2 - v * h * 0.4 : baseline - Math.max(0, v) * (h - 14 * dpr);
				if (i === 0) path.moveTo(x, y);
				else path.lineTo(x, y);
			});
			ctx.save();
			ctx.lineJoin = 'round';
			ctx.lineCap = 'round';
			ctx.strokeStyle = glow;
			ctx.lineWidth = 6 * dpr;
			ctx.stroke(path);
			ctx.strokeStyle = core;
			ctx.lineWidth = 1.6 * dpr;
			ctx.stroke(path);
			ctx.restore();
		};

		if (kind === 'cycle') {
			if (target)
				draw(
					series(target, 0, target.length, 2),
					'rgba(253, 186, 116, 0.9)',
					'rgba(251, 146, 60, 0.22)'
				);
			if (live)
				draw(
					series(live, 0, live.length, 2),
					'rgba(209, 250, 229, 0.95)',
					'rgba(74, 222, 128, 0.25)'
				);
		} else if (target) {
			const t0 = envelopeOnset(target);
			const l0 = live ? envelopeOnset(live) : 0;
			// Show where something is audible (plus a margin) rather than seconds of silence.
			let last = 0;
			for (let i = 0; t0 + i < target.length; i++) {
				if (target[t0 + i] > 0.02 || (live && (live[l0 + i] ?? 0) > 0.02)) last = i;
			}
			const length = Math.min(target.length - t0, Math.max(50, Math.ceil(last * 1.25) + 10));
			draw(series(target, t0, length, 1), 'rgba(253, 186, 116, 0.9)', 'rgba(251, 146, 60, 0.22)');
			if (live) {
				const values: number[] = [];
				for (let i = 0; i < length; i++) values.push(live[l0 + i] ?? 0);
				draw(values, 'rgba(209, 250, 229, 0.95)', 'rgba(74, 222, 128, 0.25)');
			}
		}
	});
</script>

<div class="chart" role="img" aria-label={label}>
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
	<div class="chart__legend" aria-hidden="true">
		<span class="chart__key chart__key--target">Target</span>
		<span class="chart__key chart__key--live">{live ? 'Your S-1' : 'Your S-1 (waiting…)'}</span>
	</div>
</div>

<style>
	.chart {
		position: relative;
		border-radius: 0.5rem;
		overflow: hidden;
		box-shadow: inset 0 0 0 1px #1a2230;
	}

	canvas {
		display: block;
		inline-size: 100%;
		block-size: 140px;
	}

	.chart__legend {
		position: absolute;
		top: 0.4rem;
		left: 0.5rem;
		display: flex;
		gap: 0.7rem;
		font-size: 0.68rem;
		font-weight: 700;
	}

	.chart__key::before {
		content: '';
		display: inline-block;
		inline-size: 0.9rem;
		block-size: 3px;
		margin-inline-end: 0.3rem;
		vertical-align: middle;
		border-radius: 2px;
	}

	.chart__key--target {
		color: #fdba74;
	}

	.chart__key--target::before {
		background: #fb923c;
	}

	.chart__key--live {
		color: #86efac;
	}

	.chart__key--live::before {
		background: #4ade80;
	}
</style>
