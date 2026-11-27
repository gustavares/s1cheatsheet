/**
 * @file audio.svelte.ts
 * @description Opt-in audio input for the Visualizer (the S-1 is a USB audio interface).
 *
 * Nothing is requested until `start()` runs from a click. The input only feeds two
 * AnalyserNodes and, while something records, capture taps (`startCapture`); it is never
 * connected to the speakers (no monitoring, no feedback).
 * Browser processing (echo cancellation, noise suppression, auto gain) is switched off so the
 * analysers see the S-1's real waveform.
 */
import { createCapture, type AudioCapture, type CaptureOptions } from '#lib/audio/capture.js';

export type AudioStatus =
	| 'idle'
	| 'requesting'
	| 'running'
	| 'denied'
	| 'no-device'
	| 'disconnected'
	| 'unsupported'
	| 'error';

export interface AudioDeviceInfo {
	deviceId: string;
	label: string;
}

const S1_DEVICE_LABEL = /\bS-1\b/i;
/** Time-domain buffer for the oscilloscope and pitch detection (~0.34 s at 48 kHz). */
export const SCOPE_FFT_SIZE = 16384;
/** Frequency analysis for the spectrum and spectrogram (~2.9–5.9 Hz bins). */
export const SPECTRUM_FFT_SIZE = 8192;
export const MIN_DECIBELS = -100;
export const MAX_DECIBELS = -10;

class AudioInputStore {
	open = $state(false);
	status = $state<AudioStatus>('idle');
	message = $state('');
	devices = $state<AudioDeviceInfo[]>([]);
	deviceId = $state('');
	deviceLabel = $state('');
	sampleRate = $state(0);
	channelCount = $state(0);

	/** Read by the canvas renderer every frame (deliberately not reactive). */
	scope: AnalyserNode | null = null;
	spectrum: AnalyserNode | null = null;

	#ctx: AudioContext | null = null;
	#stream: MediaStream | null = null;
	#source: MediaStreamAudioSourceNode | null = null;
	#generation = 0;
	/** Capture taps currently recording; reconnected when the input changes. */
	#taps: AudioWorkletNode[] = [];

	get isRunning(): boolean {
		return this.status === 'running';
	}

	get s1Selected(): boolean {
		return S1_DEVICE_LABEL.test(this.deviceLabel);
	}

	/**
	 * Opens the Visualizer and asks for the audio input. Call it straight from a click handler:
	 * the AudioContext is created before the first `await`, while the click still counts as a
	 * user gesture, so it starts running.
	 */
	async start() {
		if (this.status === 'requesting' || this.status === 'running') return;
		this.open = true;
		const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
		if (
			!media?.getUserMedia ||
			typeof AudioContext === 'undefined' ||
			typeof window === 'undefined' ||
			!window.isSecureContext
		) {
			this.status = 'unsupported';
			this.message =
				'This browser can’t capture audio input here. Use a current Chrome, Edge, Firefox or Safari on a desktop computer over HTTPS.';
			return;
		}

		this.#ctx ??= new AudioContext({ latencyHint: 'interactive' });
		this.status = 'requesting';
		this.message = 'Waiting for permission to use the audio input…';
		media.addEventListener('devicechange', this.#onDeviceChange);

		try {
			// Device names are hidden until permission is granted. If they're already visible,
			// open the S-1 straight away; otherwise open the default input first, then switch.
			const known = await this.#listInputs();
			const s1 = known.find((d) => S1_DEVICE_LABEL.test(d.label));
			await this.#openStream(s1?.deviceId);
			if (!s1 && this.open) {
				const listed = await this.#refreshDevices();
				const found = listed.find((d) => S1_DEVICE_LABEL.test(d.label));
				if (found && found.deviceId !== this.deviceId) await this.#openStream(found.deviceId);
			}
		} catch (err) {
			this.#fail(err);
		}
	}

	/** Switches to another input chosen in the picker. */
	async selectDevice(deviceId: string) {
		if (!this.open || !deviceId) return;
		try {
			await this.#openStream(deviceId);
		} catch (err) {
			this.#fail(err);
		}
	}

	/**
	 * Starts recording the raw input: every channel, no processing, never routed to the speakers.
	 * Resolves to null when the input isn't running. Recording follows the input if the device
	 * changes, and ends (keeping what was captured) when the Visualizer closes.
	 */
	async startCapture(options: CaptureOptions = {}): Promise<AudioCapture | null> {
		const ctx = this.#ctx;
		if (!ctx || this.status !== 'running' || !this.#source) return null;
		try {
			return await createCapture(
				ctx,
				(node) => {
					this.#taps = [...this.#taps, node];
					if (this.#ctx === ctx) this.#source?.connect(node);
				},
				(node) => {
					this.#taps = this.#taps.filter((tap) => tap !== node);
				},
				options
			);
		} catch {
			return null;
		}
	}

	/** Closes the Visualizer: stops the tracks, disconnects the analysers, closes the AudioContext. */
	stop() {
		this.#generation++;
		this.#taps = [];
		this.#teardownStream();
		if (typeof navigator !== 'undefined') {
			navigator.mediaDevices?.removeEventListener('devicechange', this.#onDeviceChange);
		}
		this.scope?.disconnect();
		this.spectrum?.disconnect();
		this.scope = null;
		this.spectrum = null;
		if (this.#ctx && this.#ctx.state !== 'closed') void this.#ctx.close();
		this.#ctx = null;
		this.open = false;
		this.status = 'idle';
		this.message = '';
		this.devices = [];
		this.deviceId = '';
		this.deviceLabel = '';
		this.sampleRate = 0;
		this.channelCount = 0;
	}

	async #openStream(deviceId?: string) {
		const generation = ++this.#generation;
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
				channelCount: { ideal: 2 },
				...(deviceId ? { deviceId: { exact: deviceId } } : {})
			}
		});
		const ctx = this.#ctx;
		if (generation !== this.#generation || !this.open || !ctx) {
			for (const track of stream.getTracks()) track.stop();
			return;
		}

		this.#teardownStream();
		const track = stream.getAudioTracks()[0];
		track?.addEventListener('ended', this.#onTrackEnded);
		this.#stream = stream;
		this.#source = ctx.createMediaStreamSource(stream);

		if (!this.scope) {
			this.scope = ctx.createAnalyser();
			this.scope.fftSize = SCOPE_FFT_SIZE;
			this.scope.smoothingTimeConstant = 0;
		}
		if (!this.spectrum) {
			this.spectrum = ctx.createAnalyser();
			this.spectrum.fftSize = SPECTRUM_FFT_SIZE;
			this.spectrum.minDecibels = MIN_DECIBELS;
			this.spectrum.maxDecibels = MAX_DECIBELS;
			this.spectrum.smoothingTimeConstant = 0.6;
		}
		// Analysers only: never connected to ctx.destination, so nothing reaches the speakers.
		this.#source.connect(this.scope);
		this.#source.connect(this.spectrum);
		for (const tap of this.#taps) this.#source.connect(tap);
		if (ctx.state === 'suspended') await ctx.resume();

		const settings = track?.getSettings() ?? {};
		this.deviceId = settings.deviceId ?? deviceId ?? '';
		this.deviceLabel = track?.label ?? '';
		this.sampleRate = ctx.sampleRate;
		this.channelCount = settings.channelCount ?? 0;
		this.status = 'running';
		this.message = '';
		await this.#refreshDevices();
	}

	#teardownStream() {
		this.#source?.disconnect();
		this.#source = null;
		if (this.#stream) {
			for (const track of this.#stream.getTracks()) {
				track.removeEventListener('ended', this.#onTrackEnded);
				track.stop();
			}
			this.#stream = null;
		}
	}

	async #listInputs(): Promise<AudioDeviceInfo[]> {
		const all = await navigator.mediaDevices.enumerateDevices();
		return all
			.filter(
				(d) =>
					d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'
			)
			.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Audio input ${i + 1}` }));
	}

	async #refreshDevices(): Promise<AudioDeviceInfo[]> {
		const list = await this.#listInputs();
		if (this.open) this.devices = list;
		return list;
	}

	#onDeviceChange = async () => {
		if (!this.open) return;
		try {
			const list = await this.#refreshDevices();
			// Resume automatically when the input that was unplugged comes back.
			if (this.status === 'disconnected' && list.some((d) => d.deviceId === this.deviceId)) {
				await this.#openStream(this.deviceId);
			}
		} catch (err) {
			this.#fail(err);
		}
	};

	#onTrackEnded = () => {
		if (!this.open) return;
		this.#teardownStream();
		this.status = 'disconnected';
		this.message =
			'The audio input disconnected. Reconnect the S-1’s USB cable and the Visualizer resumes, or pick another input.';
	};

	#fail(err: unknown) {
		this.#teardownStream();
		const name = err instanceof Error ? err.name : '';
		if (name === 'NotAllowedError' || name === 'SecurityError') {
			this.status = 'denied';
			this.message =
				'Audio input access was blocked. Allow the microphone (audio input) for this site in your browser’s site settings — the icon left of the address bar — then press Try again.';
		} else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
			this.status = 'no-device';
			this.message =
				'No audio input found. Connect the S-1 with a USB cable, turn it on, then press Try again.';
		} else if (name === 'NotReadableError' || name === 'AbortError') {
			this.status = 'error';
			this.message =
				'The audio input couldn’t be opened; another app may be using it. Close that app and press Try again.';
		} else {
			this.status = 'error';
			this.message = `Couldn’t start the audio input: ${err instanceof Error ? err.message : String(err)}`;
		}
	}
}

export const audioStore = new AudioInputStore();
