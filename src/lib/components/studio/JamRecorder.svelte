<script lang="ts">
	/**
	 * @file JamRecorder.svelte
	 * @description Record a jam from the Visualizer's input, see the waveform, play it back and
	 * download a 24-bit WAV for Ableton. Each take remembers the S-1 sound that was loaded.
	 */
	import { onMount } from 'svelte';
	import { Circle, Download, Pause, Play, RotateCcw, Square, Trash2 } from '@lucide/svelte';
	import { recallMessages } from '#lib/patches.js';
	import { audioStore } from '#lib/stores/audio.svelte.js';
	import { midiStore } from '#lib/stores/midi.svelte.js';
	import { patchStore } from '#lib/stores/patches.svelte.js';
	import {
		MAX_SECONDS,
		formatDuration,
		recorderStore as rec,
		type TakeView
	} from '#lib/stores/recorder.svelte.js';
	import LiveWave from './LiveWave.svelte';
	import TakeWave from './TakeWave.svelte';

	let playingId = $state<string | null>(null);
	let paused = $state(true);
	let progress = $state<Record<string, number>>({});
	let player: HTMLAudioElement | null = null;
	let frame = 0;
	let recallNote = $state('');

	const listening = $derived(audioStore.status === 'running');
	const levelDb = $derived(rec.level > 0 ? 20 * Math.log10(rec.level) : -Infinity);
	const meter = $derived(Math.max(0, Math.min(1, (levelDb + 48) / 48)));
	const connected = $derived(midiStore.status === 'connected' && midiStore.outputReady);
	const sound = $derived(patchStore.current);

	onMount(() => {
		void rec.load();
		return () => {
			cancelAnimationFrame(frame);
			player?.pause();
			player = null;
		};
	});

	function track() {
		cancelAnimationFrame(frame);
		const loop = () => {
			if (!player || !playingId) return;
			const take = rec.takes.find((t) => t.id === playingId);
			if (take && player.duration > 0) {
				progress = { ...progress, [take.id]: player.currentTime / player.duration };
			}
			if (!player.paused) frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
	}

	function ensurePlayer(take: TakeView): HTMLAudioElement {
		if (!player) {
			player = new Audio();
			player.preload = 'auto';
			player.addEventListener('ended', () => {
				paused = true;
				if (playingId) progress = { ...progress, [playingId]: 0 };
			});
			player.addEventListener('pause', () => (paused = true));
			player.addEventListener('play', () => {
				paused = false;
				track();
			});
		}
		if (playingId !== take.id) {
			player.pause();
			player.src = take.url;
			playingId = take.id;
		}
		return player;
	}

	async function toggle(take: TakeView) {
		const audio = ensurePlayer(take);
		if (!audio.paused && playingId === take.id) {
			audio.pause();
			return;
		}
		try {
			await audio.play();
		} catch {
			rec.message = 'The browser couldn’t play this take.';
		}
	}

	function seek(take: TakeView, fraction: number) {
		const audio = ensurePlayer(take);
		const apply = () => {
			audio.currentTime = fraction * (audio.duration || take.duration);
			progress = { ...progress, [take.id]: fraction };
		};
		if (audio.readyState >= 1) apply();
		else audio.addEventListener('loadedmetadata', apply, { once: true });
	}

	function fileName(take: TakeView): string {
		const d = new Date(take.createdAt);
		const pad = (n: number) => String(n).padStart(2, '0');
		const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
		const name = take.name
			.replace(/[\\/:*?"<>|·]+/g, '-')
			.replace(/\s+/g, ' ')
			.trim();
		return `${name} ${stamp}.wav`;
	}

	function download(take: TakeView) {
		const a = document.createElement('a');
		a.href = take.url;
		a.download = fileName(take);
		a.click();
	}

	function recall(take: TakeView) {
		const saved = take.patch && patchStore.patches.find((p) => p.id === take.patch?.id);
		const sent = saved
			? patchStore.recall(saved.id)
			: midiStore.sendControlChanges(recallMessages(take.values));
		recallNote = sent
			? `Sent the sound of “${take.name}” to the S-1 (${sent} CCs).`
			: 'Connect S-1 first (above the drawing).';
	}

	async function remove(take: TakeView) {
		if (playingId === take.id) {
			player?.pause();
			playingId = null;
		}
		await rec.remove(take.id);
	}

	const when = (t: number) =>
		new Date(t).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
</script>

<section class="tool" aria-labelledby="rec-title">
	<header class="tool__head">
		<h3 id="rec-title">Jam recorder</h3>
		<p>
			Record the S-1 straight from the Visualizer’s input (its USB audio, with browser processing
			off), then play it back or download a 24-bit WAV for Ableton. The input itself is never sent
			to your speakers.
		</p>
	</header>

	{#if !listening}
		<p class="tool__note">
			<button type="button" class="btn btn--small btn--primary" onclick={() => audioStore.start()}>
				Open the Visualizer
			</button>
			to choose the S-1 as the audio input, then press Record.
		</p>
	{/if}

	<div class="deck" class:deck--rec={rec.recording}>
		<button
			type="button"
			class="rec"
			class:rec--on={rec.recording}
			aria-pressed={rec.recording}
			disabled={(!listening && !rec.recording) || rec.busy}
			onclick={() => (rec.recording ? rec.stop() : rec.start())}
		>
			{#if rec.recording}<Square size={18} fill="currentColor" />{:else}<Circle
					size={18}
					fill="currentColor"
				/>{/if}
			<span>{rec.recording ? 'Stop' : rec.busy ? 'Saving…' : 'Record'}</span>
		</button>
		<div class="deck__info">
			<p class="deck__time" aria-live="off">
				<span class="deck__elapsed">{formatDuration(rec.elapsed)}</span>
				<span class="deck__max">of {formatDuration(MAX_SECONDS)}</span>
			</p>
			<div class="meter" aria-hidden="true">
				<span
					class="meter__fill"
					class:meter__fill--hot={levelDb > -12}
					class:meter__fill--clip={levelDb > -1}
					style="inline-size: {meter * 100}%"
				></span>
			</div>
			<p class="deck__meta">
				{#if rec.clipped}<span class="clip">Clipping: lower the S-1’s VOLUME</span>{/if}
				{#if listening}
					{audioStore.deviceLabel || 'Audio input'} · {(audioStore.sampleRate / 1000).toFixed(1)} kHz
					· {audioStore.channelCount || 2} ch
				{/if}
			</p>
		</div>
	</div>

	{#if rec.recording}
		<LiveWave />
	{/if}

	<p class="sound">
		{#if sound}
			Takes will remember the loaded sound: <strong>{sound.name}</strong>.
		{:else}
			No patch loaded: each take keeps the knob positions the page has seen. Recall or save a patch
			in
			<em>Patches</em> to name takes after it.
		{/if}
	</p>

	{#if rec.message}<p class="tool__status" role="status">{rec.message}</p>{/if}
	{#if recallNote}<p class="tool__status" role="status">{recallNote}</p>{/if}

	{#if rec.takes.length}
		<ul class="takes">
			{#each rec.takes as take (take.id)}
				<li class="take" class:take--playing={playingId === take.id && !paused}>
					<div class="take__head">
						<div>
							<p class="take__name">{take.name}</p>
							<p class="take__meta">
								{when(take.createdAt)} · {formatDuration(take.duration)} ·
								{(take.sampleRate / 1000).toFixed(1)} kHz {take.channelCount === 1
									? 'mono'
									: 'stereo'} · {(take.wav.size / 1048576).toFixed(1)} MB
							</p>
						</div>
						<button
							type="button"
							class="btn btn--small btn--danger"
							aria-label="Delete {take.name}"
							onclick={() => remove(take)}
						>
							<Trash2 size={13} />
						</button>
					</div>
					<TakeWave
						peaks={take.peaks}
						duration={take.duration}
						progress={progress[take.id] ?? 0}
						label="Playback position of {take.name}"
						onseek={(f) => seek(take, f)}
					/>
					<div class="take__actions">
						<button type="button" class="btn btn--accent" onclick={() => toggle(take)}>
							{#if playingId === take.id && !paused}<Pause size={14} /> Pause{:else}<Play
									size={14}
								/>
								Play{/if}
						</button>
						<button type="button" class="btn" onclick={() => download(take)}>
							<Download size={14} /> Download WAV
						</button>
						{#if Object.keys(take.values).length}
							<button type="button" class="btn" onclick={() => recall(take)} disabled={!connected}>
								<RotateCcw size={13} /> Recall sound
							</button>
						{/if}
						<span class="take__sound">
							Sound: {take.patch ? take.patch.name : 'unsaved knob positions'}
						</span>
					</div>
				</li>
			{/each}
		</ul>
	{:else if rec.loaded}
		<p class="tool__empty">No takes yet. Press Record and play something on the S-1.</p>
	{/if}
	<p class="tool__hint">
		{rec.persistent
			? 'Takes are kept in this browser until you delete them. Download the WAV to keep a copy.'
			: 'This browser won’t store takes, so download each one before closing the tab.'}
		Recording follows the input while you switch Studio tabs and stops at {MAX_SECONDS / 60} minutes.
	</p>
</section>

<style>
	.deck {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		margin-bottom: 0.7rem;
		padding: 0.8rem;
		background: #0b0d11;
		border: 1px solid #2a2f3a;
		border-radius: 0.75rem;
		transition: border-color 0.2s ease;
	}

	.deck--rec {
		border-color: #b91c1c;
		box-shadow: 0 0 18px rgba(239, 68, 68, 0.18);
	}

	.rec {
		display: grid;
		place-items: center;
		gap: 0.1rem;
		flex: none;
		inline-size: 4.6rem;
		block-size: 4.6rem;
		margin: 0;
		font-size: 0.72rem;
		font-weight: 800;
		color: #fecaca;
		background: radial-gradient(circle at 50% 40%, #3f1d22, #1c0d10);
		border: 2px solid #b91c1c;
		border-radius: 999px;
		cursor: pointer;
	}

	.rec:hover:not(:disabled) {
		border-color: #ef4444;
	}

	.rec :global(svg) {
		color: #ef4444;
	}

	.rec--on {
		color: #fff1f2;
		background: radial-gradient(circle at 50% 40%, #7f1d1d, #3f1d22);
		animation: rec-pulse 1.4s ease-in-out infinite;
	}

	.rec--on :global(svg) {
		color: #fff1f2;
	}

	.rec:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	@keyframes rec-pulse {
		50% {
			box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.18);
		}
	}

	.deck__info {
		display: grid;
		flex: 1 1 auto;
		gap: 0.35rem;
		min-inline-size: 0;
	}

	.deck__time {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		margin: 0;
	}

	.deck__elapsed {
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 1.5rem;
		font-weight: 800;
		color: #f8fafc;
	}

	.deck--rec .deck__elapsed {
		color: #fecaca;
	}

	.deck__max {
		font-size: 0.72rem;
		color: #64748b;
	}

	.meter {
		block-size: 8px;
		overflow: hidden;
		background: #1e2430;
		border-radius: 999px;
	}

	.meter__fill {
		display: block;
		block-size: 100%;
		background: linear-gradient(90deg, #15803d, #4ade80);
		border-radius: inherit;
		transition: inline-size 0.06s linear;
	}

	.meter__fill--hot {
		background: linear-gradient(90deg, #15803d, #4ade80 70%, #facc15);
	}

	.meter__fill--clip {
		background: linear-gradient(90deg, #15803d, #facc15 70%, #ef4444);
	}

	.deck__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0;
		font-size: 0.72rem;
		color: #64748b;
	}

	.clip {
		font-weight: 800;
		color: #fca5a5;
	}

	.sound {
		margin: 0.7rem 0;
		font-size: 0.78rem;
		color: #94a3b8;
	}

	.sound strong {
		color: #fdba74;
	}

	.takes {
		display: grid;
		gap: 0.6rem;
		margin: 0.6rem 0 0;
		padding: 0;
		list-style: none;
	}

	.take {
		display: grid;
		gap: 0.5rem;
		padding: 0.7rem;
		background: #0b0d11;
		border: 1px solid #2a2f3a;
		border-radius: 0.7rem;
	}

	.take--playing {
		border-color: #ea580c;
	}

	.take__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.take__name {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 800;
		color: #f1f5f9;
	}

	.take__meta {
		margin: 0.15rem 0 0;
		font-size: 0.7rem;
		color: #64748b;
	}

	.take__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}

	.take__sound {
		margin-inline-start: auto;
		font-size: 0.7rem;
		color: #94a3b8;
	}

	@media (prefers-reduced-motion: reduce) {
		.rec--on {
			animation: none;
		}

		.meter__fill {
			transition: none;
		}
	}
</style>
