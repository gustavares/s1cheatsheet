<script lang="ts">
	/**
	 * @file TakeWave.svelte
	 * @description Waveform of a recorded take with its playback position (HiDPI canvas). Click or
	 * drag to seek; as a slider it also takes the arrow keys (±5 s), Home and End.
	 */
	interface Props {
		peaks: Float32Array;
		duration: number;
		/** 0–1 */
		progress: number;
		label: string;
		onseek: (fraction: number) => void;
	}

	let { peaks, duration, progress, label, onseek }: Props = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let size = $state({ w: 0, h: 0, dpr: 1 });
	let dragging = false;

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

	$effect(() => {
		const el = canvas;
		const { w, h, dpr } = size;
		const ctx = el?.getContext('2d');
		if (!el || !ctx || w === 0 || h === 0) return;
		el.width = w;
		el.height = h;
		ctx.fillStyle = '#06080b';
		ctx.fillRect(0, 0, w, h);
		// Second marks.
		if (duration > 0) {
			const every = duration > 120 ? 30 : duration > 40 ? 10 : duration > 12 ? 5 : 1;
			ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
			for (let t = every; t < duration; t += every) {
				ctx.fillRect(Math.round((t / duration) * w), 0, Math.max(1, dpr), h);
			}
		}
		const mid = h / 2;
		const scale = h * 0.45;
		const points = peaks.length / 2;
		const played = Math.round(progress * w);
		for (let x = 0; x < w; x++) {
			const from = Math.floor((x / w) * points);
			const to = Math.max(from + 1, Math.floor(((x + 1) / w) * points));
			let lo = 0;
			let hi = 0;
			for (let p = from; p < to && p < points; p++) {
				if (peaks[p * 2] < lo) lo = peaks[p * 2];
				if (peaks[p * 2 + 1] > hi) hi = peaks[p * 2 + 1];
			}
			ctx.fillStyle = x < played ? '#fb923c' : 'rgba(253, 186, 116, 0.42)';
			const top = mid - hi * scale;
			ctx.fillRect(x, top, 1, Math.max(dpr, mid - lo * scale - top));
		}
		if (progress > 0 && progress < 1) {
			ctx.fillStyle = '#22d3ee';
			ctx.shadowColor = 'rgba(34, 211, 238, 0.8)';
			ctx.shadowBlur = 6 * dpr;
			ctx.fillRect(played - dpr, 0, 2 * dpr, h);
			ctx.shadowBlur = 0;
		}
	});

	function seekAt(event: PointerEvent) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		onseek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
	}

	function onkeydown(event: KeyboardEvent) {
		const step = duration > 0 ? 5 / duration : 0.05;
		const keys: Record<string, number> = {
			ArrowLeft: progress - step,
			ArrowRight: progress + step,
			Home: 0,
			End: 0.999
		};
		if (!(event.key in keys)) return;
		event.preventDefault();
		onseek(Math.max(0, Math.min(1, keys[event.key])));
	}

	const seconds = $derived(Math.round(progress * duration));
</script>

<div
	class="wave"
	role="slider"
	tabindex="0"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={Math.round(duration)}
	aria-valuenow={seconds}
	aria-valuetext="{seconds} of {Math.round(duration)} seconds"
	onpointerdown={(e) => {
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		seekAt(e);
	}}
	onpointermove={(e) => dragging && seekAt(e)}
	onpointerup={() => (dragging = false)}
	onpointercancel={() => (dragging = false)}
	{onkeydown}
>
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>

<style>
	.wave {
		border-radius: 0.5rem;
		overflow: hidden;
		box-shadow: inset 0 0 0 1px #1a2230;
		cursor: pointer;
		touch-action: none;
	}

	.wave:focus-visible {
		outline: 2px solid #fb923c;
		outline-offset: 2px;
	}

	canvas {
		display: block;
		inline-size: 100%;
		block-size: 72px;
	}
</style>
