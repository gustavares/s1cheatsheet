/**
 * @file capture.ts
 * @description Raw recording of an audio input with an AudioWorklet "tap": every sample of every
 * channel, unprocessed, posted to the main thread in blocks. The tap has no outputs, so it is
 * never connected to the speakers. Used by the drills (exact loudness curves) and the jam
 * recorder.
 */

/** Recorded audio: one Float32Array per channel. */
export interface CapturedAudio {
	channels: Float32Array[];
	sampleRate: number;
}

export interface AudioCapture {
	readonly sampleRate: number;
	/** Frames recorded so far. */
	readonly frames: number;
	/** Stops recording and resolves with everything captured (also when the input went away). */
	stop(): Promise<CapturedAudio>;
}

export interface CaptureOptions {
	/** Called with each new block of samples (one array per channel), e.g. for a live waveform. */
	onBlock?: (channels: Float32Array[]) => void;
}

const PROCESSOR = 's1-capture-tap';
const BLOCK_FRAMES = 2048;

// Runs on the audio thread. Collects render quanta into blocks and posts copies; on 'flush' it
// posts what's left, then 'done', and stops processing.
const PROCESSOR_SOURCE = `
class CaptureTap extends AudioWorkletProcessor {
	constructor() {
		super();
		this.size = ${BLOCK_FRAMES};
		this.fill = 0;
		this.buffers = null;
		this.on = true;
		this.port.onmessage = (event) => {
			if (event.data !== 'flush') return;
			this.flush();
			this.on = false;
			this.port.postMessage('done');
		};
	}
	flush() {
		if (this.buffers && this.fill > 0) {
			this.port.postMessage(this.buffers.map((b) => b.slice(0, this.fill)));
		}
		this.fill = 0;
	}
	process(inputs) {
		if (!this.on) return false;
		const input = inputs[0];
		if (input && input.length > 0) {
			const n = input[0].length;
			if (!this.buffers || this.buffers.length !== input.length || this.fill + n > this.size) {
				this.flush();
				if (!this.buffers || this.buffers.length !== input.length) {
					this.buffers = input.map(() => new Float32Array(this.size));
				}
			}
			for (let c = 0; c < input.length; c++) this.buffers[c].set(input[c], this.fill);
			this.fill += n;
		}
		return true;
	}
}
registerProcessor('${PROCESSOR}', CaptureTap);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

function ensureProcessor(ctx: BaseAudioContext): Promise<void> {
	let ready = loaded.get(ctx);
	if (!ready) {
		const url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: 'text/javascript' }));
		ready = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
		loaded.set(ctx, ready);
	}
	return ready;
}

function join(chunks: Float32Array[][], frames: number): Float32Array[] {
	const channelCount = chunks.reduce((max, c) => Math.max(max, c.length), 0);
	const out = Array.from({ length: channelCount }, () => new Float32Array(frames));
	let at = 0;
	for (const chunk of chunks) {
		const n = chunk[0]?.length ?? 0;
		for (let c = 0; c < channelCount; c++) out[c].set(chunk[c] ?? chunk[0], at);
		at += n;
	}
	return out;
}

/** The input mixed down to one channel. */
export function mixDown(channels: Float32Array[]): Float32Array {
	if (channels.length === 1) return channels[0];
	const frames = channels[0]?.length ?? 0;
	const out = new Float32Array(frames);
	for (const channel of channels) for (let i = 0; i < frames; i++) out[i] += channel[i];
	for (let i = 0; i < frames; i++) out[i] /= channels.length;
	return out;
}

/**
 * Creates a capture tap on `ctx`. `connect` attaches it to the current input (and is called
 * again by the owner whenever the input changes); `release` is called once it has stopped.
 */
export async function createCapture(
	ctx: AudioContext,
	connect: (node: AudioWorkletNode) => void,
	release: (node: AudioWorkletNode) => void,
	options: CaptureOptions = {}
): Promise<AudioCapture> {
	await ensureProcessor(ctx);
	const node = new AudioWorkletNode(ctx, PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 0 });
	const chunks: Float32Array[][] = [];
	let frames = 0;
	let finish: (() => void) | null = null;
	node.port.onmessage = (event: MessageEvent<Float32Array[] | 'done'>) => {
		if (event.data === 'done') {
			finish?.();
			return;
		}
		chunks.push(event.data);
		frames += event.data[0]?.length ?? 0;
		options.onBlock?.(event.data);
	};
	connect(node);

	let stopped: Promise<CapturedAudio> | null = null;
	return {
		sampleRate: ctx.sampleRate,
		get frames() {
			return frames;
		},
		stop() {
			stopped ??= new Promise<CapturedAudio>((resolve) => {
				const done = () => {
					clearTimeout(timer);
					finish = null;
					node.port.onmessage = null;
					node.disconnect();
					release(node);
					resolve({ channels: join(chunks, frames), sampleRate: ctx.sampleRate });
				};
				// If the audio thread has gone (context closed), don't wait for it.
				const timer = setTimeout(done, ctx.state === 'running' ? 1000 : 0);
				finish = done;
				node.port.postMessage('flush');
			});
			return stopped;
		}
	};
}
