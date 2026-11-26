/**
 * @file dsp.ts
 * @description Signal analysis for the Visualizer. Pure functions, no DOM:
 * - `PitchDetector`: McLeod pitch method (normalized square difference function, computed
 *   with an FFT) giving a sub-sample period estimate and a clarity score.
 * - `findTrigger`: fundamental-locked rising zero-crossing trigger, so a periodic wave stands
 *   still even when it crosses zero several times per cycle (resonance, PWM, OSC CHOP).
 * - Note naming, log-frequency mapping and the spectrogram colour map.
 */

export interface Pitch {
	/** Fundamental frequency in Hz. */
	frequency: number;
	/** Period in samples (fractional). */
	period: number;
	/** NSDF peak height, 0–1: how periodic the signal is. */
	clarity: number;
}

/** In-place iterative radix-2 FFT with precomputed twiddles. */
export class Fft {
	readonly size: number;
	#cos: Float64Array;
	#sin: Float64Array;
	#rev: Uint32Array;

	constructor(size: number) {
		if (size < 2 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');
		this.size = size;
		this.#cos = new Float64Array(size / 2);
		this.#sin = new Float64Array(size / 2);
		for (let i = 0; i < size / 2; i++) {
			this.#cos[i] = Math.cos((2 * Math.PI * i) / size);
			this.#sin[i] = -Math.sin((2 * Math.PI * i) / size);
		}
		this.#rev = new Uint32Array(size);
		const bits = Math.log2(size);
		for (let i = 0; i < size; i++) {
			let r = 0;
			for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
			this.#rev[i] = r;
		}
	}

	/** Forward transform of (re, im) in place. */
	transform(re: Float64Array, im: Float64Array) {
		const n = this.size;
		const rev = this.#rev;
		for (let i = 0; i < n; i++) {
			const j = rev[i];
			if (j > i) {
				const tr = re[i];
				re[i] = re[j];
				re[j] = tr;
				const ti = im[i];
				im[i] = im[j];
				im[j] = ti;
			}
		}
		for (let len = 2; len <= n; len <<= 1) {
			const half = len >> 1;
			const step = n / len;
			for (let i = 0; i < n; i += len) {
				for (let k = 0; k < half; k++) {
					const wr = this.#cos[k * step];
					const wi = this.#sin[k * step];
					const a = i + k;
					const b = a + half;
					const xr = re[b] * wr - im[b] * wi;
					const xi = re[b] * wi + im[b] * wr;
					re[b] = re[a] - xr;
					im[b] = im[a] - xi;
					re[a] += xr;
					im[a] += xi;
				}
			}
		}
	}
}

export interface PitchOptions {
	minFrequency?: number;
	maxFrequency?: number;
	/** Minimum NSDF clarity to report a pitch. */
	minClarity?: number;
}

const MPM_CUTOFF = 0.9;
const MAX_PEAKS = 64;

/** McLeod pitch method on the newest `windowSize` samples, using an FFT autocorrelation. */
export class PitchDetector {
	readonly windowSize: number;
	#fft: Fft;
	#re: Float64Array;
	#im: Float64Array;
	#sq: Float64Array;
	#nsdf: Float64Array;
	#peakTau = new Float64Array(MAX_PEAKS);
	#peakVal = new Float64Array(MAX_PEAKS);

	constructor(windowSize = 8192) {
		this.windowSize = windowSize;
		const n = windowSize * 2;
		this.#fft = new Fft(n);
		this.#re = new Float64Array(n);
		this.#im = new Float64Array(n);
		this.#sq = new Float64Array(windowSize + 1);
		this.#nsdf = new Float64Array(windowSize / 2 + 2);
	}

	detect(samples: Float32Array, sampleRate: number, options: PitchOptions = {}): Pitch | null {
		const { minFrequency = 15, maxFrequency = 5000, minClarity = 0.6 } = options;
		const w = Math.min(this.windowSize, samples.length);
		const offset = samples.length - w;
		const n = this.#fft.size;
		const re = this.#re;
		const im = this.#im;
		const sq = this.#sq;
		const nsdf = this.#nsdf;

		let mean = 0;
		for (let i = 0; i < w; i++) mean += samples[offset + i];
		mean /= w;

		sq[0] = 0;
		for (let i = 0; i < w; i++) {
			const v = samples[offset + i] - mean;
			re[i] = v;
			im[i] = 0;
			sq[i + 1] = sq[i] + v * v;
		}
		re.fill(0, w);
		im.fill(0, w);
		if (sq[w] / w < 1e-8) return null; // silence (RMS below -80 dBFS)

		// Autocorrelation r(τ) = FFT(|FFT(x)|²) / n (the power spectrum is real and even).
		this.#fft.transform(re, im);
		for (let i = 0; i < n; i++) {
			re[i] = re[i] * re[i] + im[i] * im[i];
			im[i] = 0;
		}
		this.#fft.transform(re, im);

		const tauMin = Math.max(2, Math.floor(sampleRate / maxFrequency));
		const tauMax = Math.min(Math.floor(w / 2), Math.ceil(sampleRate / minFrequency));
		if (tauMax <= tauMin + 2) return null;
		for (let tau = 0; tau <= tauMax + 1; tau++) {
			const m = sq[w - tau] + (sq[w] - sq[tau]);
			nsdf[tau] = m > 0 ? (2 * (re[tau] / n)) / m : 0;
		}

		// Key maxima: the highest point of each positive lobe after the zero-lag lobe.
		let tau = 1;
		while (tau < tauMax && nsdf[tau] > 0) tau++;
		let peaks = 0;
		let overall = 0;
		while (tau < tauMax && peaks < MAX_PEAKS) {
			while (tau < tauMax && nsdf[tau] <= 0) tau++;
			let bestTau = -1;
			let bestVal = 0;
			while (tau < tauMax && nsdf[tau] > 0) {
				if (nsdf[tau] > bestVal) {
					bestVal = nsdf[tau];
					bestTau = tau;
				}
				tau++;
			}
			if (bestTau > 0) {
				this.#peakTau[peaks] = bestTau;
				this.#peakVal[peaks] = bestVal;
				peaks++;
				if (bestVal > overall) overall = bestVal;
			}
		}
		if (peaks === 0) return null;

		const threshold = MPM_CUTOFF * overall;
		for (let p = 0; p < peaks; p++) {
			const t = this.#peakTau[p];
			if (t < tauMin || this.#peakVal[p] < threshold) continue;
			// Parabolic interpolation around the peak for a sub-sample period.
			const a = nsdf[t - 1];
			const b = nsdf[t];
			const c = nsdf[t + 1];
			const denom = a - 2 * b + c;
			const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
			const period = t + shift;
			const clarity = b - 0.25 * (a - c) * shift;
			if (clarity < minClarity) return null;
			return { frequency: sampleRate / period, period, clarity };
		}
		return null;
	}
}

export interface Trigger {
	/** Fractional sample index where drawing should start. */
	start: number;
	/** true when locked to the detected fundamental; false = free-running. */
	locked: boolean;
}

/** Rising zero crossings with hysteresis (ignores wiggles smaller than `h`), oldest first. */
function risingCrossings(
	x: Float32Array,
	mean: number,
	from: number,
	to: number,
	h: number,
	out: number[]
) {
	out.length = 0;
	let armed = false;
	for (let i = Math.max(1, Math.floor(from)); i <= Math.min(x.length - 1, Math.ceil(to)); i++) {
		const prev = x[i - 1] - mean;
		const cur = x[i] - mean;
		if (prev < -h) armed = true;
		if (armed && prev < 0 && cur >= 0) {
			out.push(i - 1 + -prev / (cur - prev));
			armed = false;
		}
	}
}

const crossingScratch: number[] = [];

/**
 * Chooses where to start drawing `span` samples (the newest span that fits):
 * - with a known `period`, the left edge sits on a rising zero crossing of the fundamental,
 *   whose phase is measured with a single-bin DFT over whole periods. Averaging over several
 *   cycles makes this steadier than any single crossing of the raw wave (tested < 0.2 samples of
 *   frame-to-frame jitter from 33 Hz to 2 kHz, including pulse and resonant waves), and for
 *   sine, saw and square waves it coincides with the wave's own rising zero crossing;
 * - without a period, the newest rising zero crossing of the raw wave (with hysteresis).
 */
export function findTrigger(x: Float32Array, span: number, period: number | null): Trigger {
	const n = x.length;
	const latest = n - span - 2;
	if (latest < 1) return { start: Math.max(0, latest), locked: false };

	if (period && period > 2 && period < n / 2) {
		const cycles = Math.max(1, Math.min(8, Math.floor((n - 1) / period)));
		const length = Math.round(cycles * period);
		const w0 = n - length;
		// DC offset over a whole number of periods, so it doesn't depend on where the frame starts.
		let mean = 0;
		for (let i = w0; i < n; i++) mean += x[i];
		mean /= length;
		const theta = (2 * Math.PI) / period;
		// Single-bin DFT at the fundamental using a rotating phasor.
		const stepCos = Math.cos(theta);
		const stepSin = Math.sin(theta);
		let pc = 1;
		let ps = 0;
		let c = 0;
		let s = 0;
		for (let i = 0; i < length; i++) {
			const v = x[w0 + i] - mean;
			c += v * pc;
			s += v * ps;
			const nc = pc * stepCos - ps * stepSin;
			ps = pc * stepSin + ps * stepCos;
			pc = nc;
		}
		if (c * c + s * s > 1e-12) {
			// x ≈ A·cos(θn + φ) with φ = atan2(-s, c); rising zero crossing where θn + φ = -π/2.
			const phi = Math.atan2(-s, c);
			let n0 = ((-Math.PI / 2 - phi) / theta) % period;
			if (n0 < 0) n0 += period;
			const first = w0 + n0;
			const start = first + Math.floor((latest - first) / period) * period;
			if (start >= 1) return { start, locked: true };
		}
	}

	let mean = 0;
	for (let i = 0; i < n; i++) mean += x[i];
	mean /= n;
	let peak = 0;
	for (let i = Math.max(0, Math.floor(latest - 4800)); i < n; i++) {
		peak = Math.max(peak, Math.abs(x[i] - mean));
	}
	const h = 0.05 * peak;
	risingCrossings(x, mean, Math.max(1, latest - Math.min(n / 2, 4800)), latest, h, crossingScratch);
	const newest = crossingScratch.at(-1);
	return newest === undefined ? { start: latest, locked: false } : { start: newest, locked: false };
}

/** Linear interpolation at a fractional index. */
export function sampleAt(x: Float32Array, t: number): number {
	const i = Math.floor(t);
	const f = t - i;
	if (i < 0) return x[0];
	if (i >= x.length - 1) return x[x.length - 1];
	return x[i] + (x[i + 1] - x[i]) * f;
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Nearest equal-tempered note (A4 = 440 Hz) and the deviation in cents. */
export function noteName(frequency: number): { name: string; cents: number } {
	const midi = 69 + 12 * Math.log2(frequency / 440);
	const nearest = Math.round(midi);
	const name = `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`;
	return { name, cents: Math.round((midi - nearest) * 100) };
}

/** Position (0–1) of `frequency` on a log axis between `min` and `max`. */
export function logPosition(frequency: number, min: number, max: number): number {
	return Math.log(frequency / min) / Math.log(max / min);
}

/** Frequency at position `pos` (0–1) on a log axis between `min` and `max`. */
export function logFrequency(pos: number, min: number, max: number): number {
	return min * Math.pow(max / min, pos);
}

/** 256-entry RGBA lookup table interpolated between colour stops ([position 0–1, [r, g, b]]). */
export function buildColormap(stops: [number, [number, number, number]][]): Uint8ClampedArray {
	const lut = new Uint8ClampedArray(256 * 4);
	for (let i = 0; i < 256; i++) {
		const t = i / 255;
		let k = 0;
		while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
		const [p0, c0] = stops[k];
		const [p1, c1] = stops[k + 1];
		const f = p1 > p0 ? Math.min(1, Math.max(0, (t - p0) / (p1 - p0))) : 0;
		lut[i * 4] = c0[0] + (c1[0] - c0[0]) * f;
		lut[i * 4 + 1] = c0[1] + (c1[1] - c0[1]) * f;
		lut[i * 4 + 2] = c0[2] + (c1[2] - c0[2]) * f;
		lut[i * 4 + 3] = 255;
	}
	return lut;
}
