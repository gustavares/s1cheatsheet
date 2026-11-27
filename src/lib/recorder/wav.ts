/**
 * @file wav.ts
 * @description WAV encoding (PCM, 24-bit by default: what Ableton and most DAWs expect for a
 * clean recording) and waveform peaks for drawing. Pure functions.
 */

/** Interleaved little-endian PCM WAV file. Samples are clamped to −1…1. */
export function encodeWav(
	channels: Float32Array[],
	sampleRate: number,
	bitsPerSample: 16 | 24 = 24
): Uint8Array<ArrayBuffer> {
	const channelCount = Math.max(1, channels.length);
	const frames = channels[0]?.length ?? 0;
	const bytesPerSample = bitsPerSample / 8;
	const blockAlign = channelCount * bytesPerSample;
	const dataSize = frames * blockAlign;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);
	const text = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
	};
	text(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	text(8, 'WAVE');
	text(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);
	text(36, 'data');
	view.setUint32(40, dataSize, true);

	const out = new Uint8Array(buffer);
	const max = bitsPerSample === 24 ? 0x7fffff : 0x7fff;
	let offset = 44;
	for (let i = 0; i < frames; i++) {
		for (let c = 0; c < channelCount; c++) {
			const sample = channels[c]?.[i] ?? 0;
			const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample;
			const value = Math.round(clamped * max);
			out[offset] = value & 0xff;
			out[offset + 1] = (value >> 8) & 0xff;
			if (bitsPerSample === 24) out[offset + 2] = (value >> 16) & 0xff;
			offset += bytesPerSample;
		}
	}
	return out;
}

/**
 * Min/max pairs of the loudest channel over `buckets` equal slices
 * (`[min0, max0, min1, max1, …]`), for drawing a waveform.
 */
export function computePeaks(channels: Float32Array[], buckets: number): Float32Array {
	const frames = channels[0]?.length ?? 0;
	const peaks = new Float32Array(buckets * 2);
	if (frames === 0) return peaks;
	for (let b = 0; b < buckets; b++) {
		const from = Math.floor((b * frames) / buckets);
		const to = Math.max(from + 1, Math.floor(((b + 1) * frames) / buckets));
		let lo = 0;
		let hi = 0;
		for (const channel of channels) {
			for (let i = from; i < to && i < frames; i++) {
				const v = channel[i];
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
		}
		peaks[b * 2] = lo;
		peaks[b * 2 + 1] = hi;
	}
	return peaks;
}

/** Peak level in dBFS (−Infinity for silence). */
export function peakDb(channels: Float32Array[]): number {
	let peak = 0;
	for (const channel of channels) {
		for (let i = 0; i < channel.length; i++) {
			const v = Math.abs(channel[i]);
			if (v > peak) peak = v;
		}
	}
	return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}
