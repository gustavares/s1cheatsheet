/**
 * @file recorder.svelte.ts
 * @description Jam recorder: records the Visualizer's input (the S-1 over USB, browser processing
 * off) through the audio store's capture tap, which is never routed to the speakers. Takes are
 * encoded as 24-bit WAV and kept in IndexedDB with the sound that was loaded at the time.
 * Recording keeps going while you switch Studio tabs.
 */
import { cleanValues } from '#lib/patches.js';
import type { AudioCapture } from '#lib/audio/capture.js';
import { computePeaks, encodeWav } from '#lib/recorder/wav.js';
import { deleteTake, listTakes, saveTake, type Take } from '#lib/recorder/takes.js';
import { audioStore } from '#lib/stores/audio.svelte.js';
import { midiStore } from '#lib/stores/midi.svelte.js';
import { patchStore } from '#lib/stores/patches.svelte.js';

/** Longest take (memory: ~23 MB of float samples per stereo minute at 48 kHz). */
export const MAX_SECONDS = 300;
/** Samples per point of the live waveform. */
const LIVE_BUCKET = 256;
/** Points kept for the live waveform (about 10 s at 48 kHz). */
const LIVE_POINTS = 1900;
const PEAK_POINTS = 1200;

export interface TakeView extends Take {
	/** Object URL of the WAV, for playback and download. */
	url: string;
}

class RecorderStore {
	recording = $state(false);
	/** Finishing a take (encoding and saving). */
	busy = $state(false);
	elapsed = $state(0);
	/** Peak of the latest block, 0–1. */
	level = $state(0);
	clipped = $state(false);
	message = $state('');
	takes = $state.raw<TakeView[]>([]);
	/** false when IndexedDB isn't available: takes last until the tab closes. */
	persistent = $state(true);
	loaded = $state(false);

	/** Live waveform: min/max pairs of the newest audio (read by the canvas, not reactive). */
	live: number[] = [];

	#capture: AudioCapture | null = null;
	#frames = 0;
	#bucketMin = 0;
	#bucketMax = 0;
	#bucketFill = 0;
	#watch: ReturnType<typeof setInterval> | undefined;
	#startedAt = 0;
	#patch: Take['patch'] = null;
	#values: Record<string, number> = {};

	async load() {
		if (this.loaded) return;
		this.loaded = true;
		patchStore.load();
		try {
			const stored = await listTakes();
			this.takes = stored.map((t) => ({ ...t, url: URL.createObjectURL(t.wav) }));
		} catch {
			this.persistent = false;
		}
	}

	async start() {
		if (this.recording || this.busy) return;
		this.message = '';
		if (audioStore.status !== 'running') {
			this.message = 'Open the Visualizer first: the recorder uses its audio input.';
			return;
		}
		const capture = await audioStore.startCapture({ onBlock: (block) => this.#onBlock(block) });
		if (!capture) {
			this.message = 'Couldn’t start recording the audio input. Close and reopen the Visualizer.';
			return;
		}
		this.#capture = capture;
		this.#frames = 0;
		this.#bucketFill = 0;
		this.live = [];
		this.elapsed = 0;
		this.level = 0;
		this.clipped = false;
		this.#startedAt = Date.now();
		const patch = patchStore.current;
		this.#patch = patch ? { id: patch.id, name: patch.name } : null;
		this.#values = cleanValues(midiStore.values);
		this.recording = true;
		// Stop cleanly if the input goes away (Visualizer closed, cable pulled).
		this.#watch = setInterval(() => {
			if (this.recording && audioStore.status !== 'running') {
				void this.stop('The audio input stopped, so the take was saved up to that point.');
			}
		}, 250);
	}

	async stop(note = '') {
		const capture = this.#capture;
		if (!this.recording || !capture) return;
		this.recording = false;
		this.#capture = null;
		clearInterval(this.#watch);
		this.busy = true;
		try {
			const audio = await capture.stop();
			const frames = audio.channels[0]?.length ?? 0;
			if (frames < audio.sampleRate * 0.2) {
				this.message = 'That take was too short to keep.';
				return;
			}
			const bytes = encodeWav(audio.channels, audio.sampleRate);
			const wav = new Blob([bytes], { type: 'audio/wav' });
			const number = this.takes.length + 1;
			const take: Take = {
				id: `take-${this.#startedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
				name: this.#patch ? `Jam ${number} · ${this.#patch.name}` : `Jam ${number}`,
				createdAt: this.#startedAt,
				duration: frames / audio.sampleRate,
				sampleRate: audio.sampleRate,
				channelCount: audio.channels.length,
				peaks: computePeaks(audio.channels, PEAK_POINTS),
				patch: this.#patch,
				values: this.#values,
				wav
			};
			if (this.persistent) {
				try {
					await saveTake(take);
				} catch {
					this.persistent = false;
					note ||=
						'The browser wouldn’t store this take (storage full?), so download it before closing the tab.';
				}
			}
			this.takes = [{ ...take, url: URL.createObjectURL(wav) }, ...this.takes];
			this.message =
				note ||
				`Saved “${take.name}” (${formatDuration(take.duration)}, ${(wav.size / 1048576).toFixed(1)} MB).`;
		} finally {
			this.busy = false;
		}
	}

	async remove(id: string) {
		const take = this.takes.find((t) => t.id === id);
		if (!take) return;
		this.takes = this.takes.filter((t) => t.id !== id);
		URL.revokeObjectURL(take.url);
		if (this.persistent) await deleteTake(id).catch(() => undefined);
	}

	#onBlock(block: Float32Array[]) {
		if (!this.recording) return;
		const frames = block[0]?.length ?? 0;
		let peak = 0;
		for (let i = 0; i < frames; i++) {
			let lo = 0;
			let hi = 0;
			for (const channel of block) {
				const v = channel[i];
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
			if (this.#bucketFill === 0) {
				this.#bucketMin = lo;
				this.#bucketMax = hi;
			} else {
				if (lo < this.#bucketMin) this.#bucketMin = lo;
				if (hi > this.#bucketMax) this.#bucketMax = hi;
			}
			if (++this.#bucketFill === LIVE_BUCKET) {
				this.live.push(this.#bucketMin, this.#bucketMax);
				this.#bucketFill = 0;
			}
			const abs = Math.max(-lo, hi);
			if (abs > peak) peak = abs;
		}
		if (this.live.length > LIVE_POINTS * 2) this.live.splice(0, this.live.length - LIVE_POINTS * 2);
		this.#frames += frames;
		const sampleRate = this.#capture?.sampleRate ?? 48000;
		this.elapsed = this.#frames / sampleRate;
		this.level = peak;
		if (peak >= 0.999) this.clipped = true;
		if (this.elapsed >= MAX_SECONDS) {
			void this.stop(`Stopped at the ${MAX_SECONDS / 60}-minute limit; the take was saved.`);
		}
	}
}

export function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds - m * 60;
	return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export const recorderStore = new RecorderStore();
