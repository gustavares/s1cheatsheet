<script lang="ts">
	/**
	 * @file Visualizer.svelte
	 * @description Live view of the S-1's USB audio: oscilloscope (trigger-locked, cycle zoom,
	 * pitch readout), log-frequency spectrum, and scrolling spectrogram. Audio comes from
	 * `audioStore` (opt-in, analysers only, never routed to the speakers). The animation loop runs
	 * only while this component is mounted.
	 */
	import { X } from '@lucide/svelte';
	import { audioStore, MAX_DECIBELS, MIN_DECIBELS } from '#lib/stores/audio.svelte.js';
	import { findTrigger, noteName, PitchDetector, type Pitch } from '#lib/visualizer/dsp.js';
	import {
		createSpectrogramState,
		createSpectrumState,
		drawScope,
		drawSpectrogram,
		drawSpectrum,
		type SpectrogramState,
		type SpectrumState,
		type Surface
	} from '#lib/visualizer/render.js';

	type View = 'scope' | 'spectrum' | 'spectrogram';
	const VIEWS: { id: View; label: string }[] = [
		{ id: 'scope', label: 'Oscilloscope' },
		{ id: 'spectrum', label: 'Spectrum' },
		{ id: 'spectrogram', label: 'Spectrogram' }
	];
	const CYCLE_OPTIONS = [1, 2, 4, 8];
	const FREE_RUN_SECONDS = 0.02;
	const QUIET_PEAK = 0.0015; // about −56 dBFS
	const QUIET_AFTER_MS = 1500;

	let view = $state<View>('scope');
	let cycles = $state(2);
	let canvas = $state<HTMLCanvasElement | null>(null);

	// Readouts, refreshed ~10× per second from the animation loop.
	let note = $state('');
	let frequency = $state('');
	let cents = $state('');
	let triggerText = $state('');
	let gainText = $state('');
	let levelText = $state('');
	let quiet = $state(false);

	const running = $derived(audioStore.status === 'running');
	const retryable = $derived(
		audioStore.status === 'denied' ||
			audioStore.status === 'no-device' ||
			audioStore.status === 'error'
	);
	const viewLabel = $derived(VIEWS.find((v) => v.id === view)?.label ?? '');
	const canvasLabel = $derived(
		`${viewLabel} of the audio input${note ? `, pitch ${note} ${frequency}` : ''}`
	);

	function formatHz(f: number): string {
		return f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${f.toFixed(1)} Hz`;
	}

	$effect(() => {
		const el = canvas;
		if (!el) return;
		const ctx = el.getContext('2d', { alpha: false });
		if (!ctx) return;

		const surface: Surface = { ctx, width: 0, height: 0, dpr: 1 };
		let spectrumState: SpectrumState | null = null;
		let spectrogramState: SpectrogramState | null = null;
		const resize = () => {
			const rect = el.getBoundingClientRect();
			const dpr = Math.min(window.devicePixelRatio || 1, 3);
			const width = Math.max(1, Math.round(rect.width * dpr));
			const height = Math.max(1, Math.round(rect.height * dpr));
			if (width === surface.width && height === surface.height && dpr === surface.dpr) return;
			el.width = width;
			el.height = height;
			surface.width = width;
			surface.height = height;
			surface.dpr = dpr;
			spectrumState = null;
			spectrogramState = null;
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(el);

		const detector = new PitchDetector(8192);
		const idle = new Float32Array(8);
		let timeData: Float32Array<ArrayBuffer> | null = null;
		let freqData: Float32Array<ArrayBuffer> | null = null;
		let pitch: Pitch | null = null;
		let frameNo = 0;
		let gain = 1;
		let quietSince = performance.now();
		let lastReadout = 0;
		let raf = 0;

		const frame = (now: number) => {
			raf = requestAnimationFrame(frame);
			const scope = audioStore.scope;
			const spectrum = audioStore.spectrum;
			if (audioStore.status !== 'running' || !scope || !spectrum) {
				drawScope(surface, { samples: idle, start: 0, span: 4, gain: 1, cycles: 0 });
				return;
			}
			const sampleRate = scope.context.sampleRate;
			if (timeData?.length !== scope.fftSize) timeData = new Float32Array(scope.fftSize);
			scope.getFloatTimeDomainData(timeData);
			if (frameNo++ % 2 === 0) pitch = detector.detect(timeData, sampleRate);

			let peak = 0;
			for (let i = timeData.length - 4096; i < timeData.length; i++) {
				const v = Math.abs(timeData[i]);
				if (v > peak) peak = v;
			}
			if (peak > QUIET_PEAK) quietSince = now;

			let shownCycles = 0;
			let spanSeconds = 0;
			let locked = false;
			if (view === 'scope') {
				const period = pitch?.period ?? null;
				let span = Math.round(sampleRate * FREE_RUN_SECONDS);
				if (period) {
					const fit = Math.max(1, Math.floor((timeData.length - 2) / period) - 1);
					shownCycles = Math.min(cycles, fit);
					span = shownCycles * period;
				}
				const trigger = findTrigger(timeData, span, period);
				locked = trigger.locked;
				spanSeconds = span / sampleRate;
				let segmentPeak = 0;
				const end = Math.min(timeData.length, Math.ceil(trigger.start + span) + 1);
				for (let i = Math.max(0, Math.floor(trigger.start)); i < end; i++) {
					const v = Math.abs(timeData[i]);
					if (v > segmentPeak) segmentPeak = v;
				}
				const target = segmentPeak > 1e-4 ? Math.min(16, Math.max(1, 0.9 / segmentPeak)) : gain;
				gain += (target - gain) * 0.12;
				drawScope(surface, {
					samples: timeData,
					start: trigger.start,
					span,
					gain,
					cycles: locked ? shownCycles : 0
				});
			} else {
				spectrum.smoothingTimeConstant = view === 'spectrum' ? 0.6 : 0.25;
				if (freqData?.length !== spectrum.frequencyBinCount) {
					freqData = new Float32Array(spectrum.frequencyBinCount);
				}
				spectrum.getFloatFrequencyData(freqData);
				const spectrumFrame = {
					db: freqData,
					binHz: sampleRate / spectrum.fftSize,
					minDb: MIN_DECIBELS,
					maxDb: MAX_DECIBELS,
					maxHz: sampleRate / 2,
					pitch: pitch?.frequency ?? null
				};
				if (view === 'spectrum') {
					spectrumState ??= createSpectrumState(surface.width, MIN_DECIBELS);
					drawSpectrum(surface, spectrumFrame, spectrumState);
				} else {
					spectrogramState ??= createSpectrogramState(
						surface.width,
						surface.height,
						Math.max(1, Math.round(surface.dpr))
					);
					if (spectrogramState) drawSpectrogram(surface, spectrumFrame, spectrogramState);
				}
			}

			if (now - lastReadout > 100) {
				lastReadout = now;
				if (pitch) {
					const n = noteName(pitch.frequency);
					note = n.name;
					frequency = formatHz(pitch.frequency);
					cents = `${n.cents >= 0 ? '+' : '−'}${Math.abs(n.cents)}¢`;
				} else {
					note = '';
					frequency = '';
					cents = '';
				}
				if (view === 'scope') {
					triggerText = locked
						? `Locked · ${shownCycles} ${shownCycles === 1 ? 'cycle' : 'cycles'} · ${(spanSeconds * 1000).toFixed(1)} ms`
						: `Free-run · ${(spanSeconds * 1000).toFixed(0)} ms`;
					gainText = gain > 1.05 ? `×${gain.toFixed(1)}` : '';
				}
				levelText =
					peak > 0
						? `${Math.max(-99, 20 * Math.log10(peak))
								.toFixed(0)
								.replace('-', '−')} dBFS peak`
						: '−∞ dBFS';
				quiet = now - quietSince > QUIET_AFTER_MS;
			}
		};
		raf = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(raf);
			observer.disconnect();
		};
	});
</script>

<section class="viz" aria-label="Audio visualizer">
	<div class="viz__bar">
		<div class="viz__views" role="group" aria-label="Visualizer view">
			{#each VIEWS as v (v.id)}
				<button
					type="button"
					class="viz__view"
					class:viz__view--active={view === v.id}
					aria-pressed={view === v.id}
					onclick={() => (view = v.id)}
				>
					{v.label}
				</button>
			{/each}
		</div>
		<div class="viz__bar-right">
			{#if audioStore.devices.length > 0}
				<label class="viz__field">
					<span>Input</span>
					<select
						value={audioStore.deviceId}
						onchange={(e) => audioStore.selectDevice(e.currentTarget.value)}
					>
						{#each audioStore.devices as device (device.deviceId)}
							<option value={device.deviceId}>{device.label}</option>
						{/each}
					</select>
				</label>
			{/if}
			<button
				type="button"
				class="viz__close"
				aria-label="Close visualizer"
				title="Close (stops the audio input)"
				onclick={() => audioStore.stop()}
			>
				<X size={15} />
			</button>
		</div>
	</div>

	<div class="viz__stage">
		<div class="viz__screen" role="img" aria-label={canvasLabel}>
			<canvas bind:this={canvas} class="viz__canvas" aria-hidden="true"></canvas>
		</div>

		{#if running}
			<div class="viz__readout viz__readout--pitch" aria-live="off">
				{#if note}
					<span class="viz__note">{note}</span>
					<span class="viz__hz">{frequency}</span>
					<span class="viz__cents">{cents}</span>
				{:else}
					<span class="viz__hz viz__muted">No stable pitch</span>
				{/if}
			</div>
			{#if view === 'scope'}
				<div class="viz__readout viz__readout--trigger">
					<span class:viz__locked={triggerText.startsWith('Locked')}>{triggerText}</span>
					{#if gainText}<span class="viz__muted" title="Auto vertical gain">{gainText}</span>{/if}
				</div>
			{/if}
			{#if quiet}
				<p class="viz__overlay viz__overlay--soft">
					No signal. Play a note or start a pattern on the S-1 and turn up its VOLUME knob (USB
					audio follows it unless USB Direct Out is set in the menu).
				</p>
			{/if}
		{:else}
			<div class="viz__overlay" role="status">
				<p>{audioStore.message || 'Starting the audio input…'}</p>
				{#if retryable}
					<button type="button" class="viz__retry" onclick={() => audioStore.start()}>
						Try again
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<div class="viz__footer">
		{#if view === 'scope'}
			<div class="viz__cycles" role="group" aria-label="Cycles shown">
				<span>Cycles</span>
				{#each CYCLE_OPTIONS as n (n)}
					<button
						type="button"
						class="viz__chip"
						class:viz__chip--active={cycles === n}
						aria-pressed={cycles === n}
						onclick={() => (cycles = n)}
					>
						{n}
					</button>
				{/each}
			</div>
			<span class="viz__hint">Trigger locks to the fundamental’s rising zero crossing.</span>
		{:else if view === 'spectrum'}
			<span class="viz__hint">Green markers: the fundamental (f₀) and its harmonics.</span>
		{:else}
			<span class="viz__hint">Newest on the right; brighter = louder (−100 to −10 dBFS).</span>
		{/if}
		{#if running && !audioStore.s1Selected}
			<span class="viz__warn">
				No input named “S-1” found; showing “{audioStore.deviceLabel || 'default input'}”. Pick the
				S-1 under Input.
			</span>
		{:else if running}
			<span class="viz__muted viz__meta">
				{audioStore.deviceLabel} · {(audioStore.sampleRate / 1000).toFixed(1)} kHz{audioStore.channelCount
					? ` · ${audioStore.channelCount} ch`
					: ''}{levelText ? ` · ${levelText}` : ''}
			</span>
		{/if}
	</div>
</section>

<style>
	.viz {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.55rem 0.6rem 0.6rem;
		background: #0b0d11;
		border: 1px solid #1d3b2a;
		border-radius: 0.6rem;
	}

	.viz__bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem 0.6rem;
	}

	.viz__views {
		display: inline-flex;
		padding: 0.15rem;
		background: #10141a;
		border: 1px solid #222a35;
		border-radius: 999px;
	}

	.viz__view {
		padding: 0.24rem 0.7rem;
		font-size: 0.7rem;
		font-weight: 700;
		color: #94a3b8;
		background: transparent;
		border: none;
		border-radius: 999px;
		cursor: pointer;
		margin: 0;
	}

	.viz__view:hover {
		color: #e2e8f0;
	}

	.viz__view--active {
		color: #dcfce7;
		background: rgba(74, 222, 128, 0.16);
		box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.45);
	}

	.viz__bar-right {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-inline-size: 0;
	}

	.viz__field {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.68rem;
		font-weight: 700;
		color: #94a3b8;
		min-inline-size: 0;
	}

	.viz__field select {
		max-inline-size: 12rem;
		padding: 0.2rem 0.35rem;
		font-size: 0.7rem;
		color: #e2e8f0;
		background: #171b22;
		border: 1px solid #334155;
		border-radius: 0.35rem;
	}

	.viz__close {
		display: inline-grid;
		place-items: center;
		inline-size: 1.7rem;
		block-size: 1.7rem;
		color: #94a3b8;
		background: #171b22;
		border: 1px solid #334155;
		border-radius: 999px;
		cursor: pointer;
		margin: 0;
	}

	.viz__close:hover {
		color: #fff;
		border-color: #64748b;
	}

	.viz__stage {
		container-type: inline-size;
		container-name: viz-stage;
		position: relative;
		border-radius: 0.5rem;
		overflow: hidden;
		box-shadow:
			inset 0 0 0 1px #1a2230,
			0 0 0 1px rgba(0, 0, 0, 0.4);
	}

	.viz__canvas {
		display: block;
		inline-size: 100%;
		block-size: clamp(160px, 22vw, 240px);
		background: #06080b;
	}

	.viz__readout {
		position: absolute;
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		padding: 0.2rem 0.45rem;
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.7rem;
		color: #cbd5e1;
		background: rgba(6, 8, 11, 0.62);
		border-radius: 0.35rem;
		pointer-events: none;
		backdrop-filter: blur(2px);
	}

	.viz__readout--pitch {
		top: 0.4rem;
		left: 0.4rem;
	}

	.viz__readout--trigger {
		top: 0.4rem;
		right: 0.4rem;
	}

	/* Narrow screens: keep the pitch readout alone at the top. */
	@container viz-stage (max-width: 540px) {
		.viz__readout--trigger {
			top: auto;
			bottom: 0.4rem;
			right: auto;
			left: 0.4rem;
		}
	}

	.viz__note {
		font-size: 1.05rem;
		font-weight: 800;
		color: #bbf7d0;
		text-shadow: 0 0 10px rgba(74, 222, 128, 0.55);
	}

	.viz__hz {
		font-weight: 700;
		color: #e2e8f0;
	}

	.viz__cents {
		color: #94a3b8;
	}

	.viz__locked {
		color: #86efac;
	}

	.viz__muted {
		color: #64748b;
	}

	.viz__overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		margin: 0;
		padding: 1rem 1.5rem;
		font-size: 0.78rem;
		line-height: 1.5;
		text-align: center;
		color: #fcd34d;
		background: rgba(6, 8, 11, 0.78);
	}

	.viz__overlay p {
		margin: 0;
		max-inline-size: 46ch;
	}

	.viz__overlay--soft {
		inset: auto 0.5rem 2.1rem 0.5rem;
		padding: 0.4rem 0.75rem;
		font-size: 0.72rem;
		color: #e2e8f0;
		background: rgba(6, 8, 11, 0.72);
		border-radius: 0.4rem;
	}

	.viz__retry {
		padding: 0.3rem 0.8rem;
		font-size: 0.72rem;
		font-weight: 700;
		color: #dcfce7;
		background: rgba(74, 222, 128, 0.14);
		border: 1px solid rgba(74, 222, 128, 0.5);
		border-radius: 999px;
		cursor: pointer;
		margin: 0;
	}

	.viz__footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.8rem;
		font-size: 0.7rem;
		color: #94a3b8;
	}

	.viz__cycles {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-weight: 700;
	}

	.viz__cycles > span {
		margin-inline-end: 0.15rem;
	}

	.viz__chip {
		min-inline-size: 1.7rem;
		padding: 0.15rem 0.45rem;
		font-size: 0.7rem;
		font-weight: 700;
		color: #94a3b8;
		background: #171b22;
		border: 1px solid #2e3543;
		border-radius: 0.35rem;
		cursor: pointer;
		margin: 0;
	}

	.viz__chip--active {
		color: #dcfce7;
		background: rgba(74, 222, 128, 0.16);
		border-color: rgba(74, 222, 128, 0.55);
	}

	.viz__hint {
		color: #64748b;
	}

	.viz__warn {
		color: #fcd34d;
	}

	.viz__meta {
		margin-inline-start: auto;
	}

	@media (pointer: coarse) {
		.viz__view,
		.viz__chip,
		.viz__close,
		.viz__field select {
			min-block-size: 2.25rem;
		}
	}
</style>
