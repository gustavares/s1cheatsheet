/**
 * @file render.ts
 * @description Canvas 2D drawing for the Visualizer views. Everything is drawn in device pixels
 * (canvas size = CSS size × devicePixelRatio) so lines and text stay crisp on HiDPI screens.
 */
import { buildColormap, logFrequency, logPosition, sampleAt } from './dsp.js';

export interface Surface {
	ctx: CanvasRenderingContext2D;
	width: number;
	height: number;
	dpr: number;
}

const BG = '#06080b';
const GRID_MINOR = 'rgba(148, 163, 184, 0.07)';
const GRID_MAJOR = 'rgba(148, 163, 184, 0.15)';
const AXIS = 'rgba(148, 163, 184, 0.3)';
const TRACE_GLOW = 'rgba(74, 222, 128, 0.09)';
const TRACE_HALO = 'rgba(74, 222, 128, 0.24)';
const TRACE_CORE = 'rgba(209, 250, 229, 0.96)';
const HARMONIC = 'rgba(74, 222, 128, 0.85)';

export const SPECTRUM_MIN_HZ = 20;
export const SPECTRUM_MAX_HZ = 20000;

/** Spectrogram colour map: night → violet → S-1 LED red → orange → amber → warm white. */
export const SPECTROGRAM_LUT = buildColormap([
	[0, [6, 8, 11]],
	[0.18, [33, 17, 66]],
	[0.38, [96, 32, 112]],
	[0.56, [196, 45, 62]],
	[0.72, [234, 88, 12]],
	[0.87, [251, 191, 36]],
	[1, [255, 247, 237]]
]);

const font = (dpr: number, size = 10.5) =>
	`${Math.round(size * dpr)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

function line(s: Surface, x1: number, y1: number, x2: number, y2: number, style: string) {
	const { ctx } = s;
	ctx.strokeStyle = style;
	ctx.beginPath();
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();
}

/** Strokes a path three times (wide glow, halo, bright core) for a phosphor look. */
function glowStroke(s: Surface, path: Path2D, glow: string, halo: string, core: string) {
	const { ctx, dpr } = s;
	ctx.save();
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.globalCompositeOperation = 'lighter';
	ctx.strokeStyle = glow;
	ctx.lineWidth = 9 * dpr;
	ctx.stroke(path);
	ctx.strokeStyle = halo;
	ctx.lineWidth = 3.6 * dpr;
	ctx.stroke(path);
	ctx.globalCompositeOperation = 'source-over';
	ctx.strokeStyle = core;
	ctx.lineWidth = 1.4 * dpr;
	ctx.stroke(path);
	ctx.restore();
}

export interface ScopeFrame {
	samples: Float32Array;
	/** Fractional start index (from the trigger). */
	start: number;
	/** Number of samples across the screen. */
	span: number;
	/** Vertical gain applied to the samples (auto-scale). */
	gain: number;
	/** Number of whole cycles shown when locked (draws cycle boundaries), else 0. */
	cycles: number;
	/** Optional target cycle (peak-normalized), drawn under the live trace in each locked cycle. */
	overlay?: Float32Array | null;
}

export function drawScope(s: Surface, frame: ScopeFrame) {
	const { ctx, width: w, height: h, dpr } = s;
	ctx.fillStyle = BG;
	ctx.fillRect(0, 0, w, h);
	ctx.lineWidth = Math.max(1, Math.round(dpr));

	// 10 × 8 divisions with a brighter zero line, like a bench oscilloscope.
	for (let i = 1; i < 10; i++) {
		const x = Math.round((i * w) / 10) + 0.5;
		line(s, x, 0, x, h, GRID_MINOR);
	}
	for (let j = 1; j < 8; j++) {
		const y = Math.round((j * h) / 8) + 0.5;
		line(s, 0, y, w, y, j === 4 ? AXIS : GRID_MINOR);
	}
	for (let i = 0; i <= 50; i++) {
		const x = Math.round((i * w) / 50) + 0.5;
		line(s, x, h / 2 - 3 * dpr, x, h / 2 + 3 * dpr, GRID_MAJOR);
	}

	// Cycle boundaries help count periods while learning.
	if (frame.cycles > 1) {
		ctx.save();
		ctx.setLineDash([4 * dpr, 5 * dpr]);
		for (let k = 1; k < frame.cycles; k++) {
			const x = Math.round((k * w) / frame.cycles) + 0.5;
			line(s, x, 0, x, h, 'rgba(74, 222, 128, 0.22)');
		}
		ctx.restore();
	}

	const { samples, start, span, gain } = frame;
	const mid = h / 2;
	const amp = h * 0.42 * gain;
	const clampY = (v: number) => Math.max(dpr, Math.min(h - dpr, mid - v * amp));

	// Target overlay: same height as the auto-scaled live trace (peak ≈ 0.9 of the half-height).
	if (frame.overlay && frame.cycles > 0) {
		const target = frame.overlay;
		const cycleWidth = w / frame.cycles;
		const overlayPath = new Path2D();
		for (let k = 0; k < frame.cycles; k++) {
			for (let i = 0; i <= target.length; i++) {
				const x = k * cycleWidth + (i / target.length) * cycleWidth;
				const y = mid - 0.9 * target[i % target.length] * h * 0.42;
				if (k === 0 && i === 0) overlayPath.moveTo(x, y);
				else overlayPath.lineTo(x, y);
			}
		}
		glowStroke(
			s,
			overlayPath,
			'rgba(251, 146, 60, 0.08)',
			'rgba(251, 146, 60, 0.22)',
			'rgba(253, 186, 116, 0.75)'
		);
	}
	const path = new Path2D();
	const perPixel = span / w;
	if (perPixel <= 1.5) {
		for (let x = 0; x <= w; x++) {
			const y = clampY(sampleAt(samples, start + x * perPixel));
			if (x === 0) path.moveTo(x, y);
			else path.lineTo(x, y);
		}
	} else {
		// Dense spans: draw each column's min/max envelope so nothing aliases away.
		for (let x = 0; x < w; x++) {
			const i0 = Math.floor(start + x * perPixel);
			const i1 = Math.min(samples.length - 1, Math.floor(start + (x + 1) * perPixel));
			let lo = Infinity;
			let hi = -Infinity;
			for (let i = i0; i <= i1; i++) {
				const v = samples[i];
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
			if (x === 0) path.moveTo(x, clampY(hi));
			else path.lineTo(x, clampY(hi));
			path.lineTo(x + 0.5, clampY(lo));
		}
	}
	glowStroke(s, path, TRACE_GLOW, TRACE_HALO, TRACE_CORE);
}

/** Per-column state kept between frames for the spectrum's smoothing and peak hold. */
export interface SpectrumState {
	smoothed: Float32Array;
	peaks: Float32Array;
}

export function createSpectrumState(width: number, floor: number): SpectrumState {
	return {
		smoothed: new Float32Array(width).fill(floor),
		peaks: new Float32Array(width).fill(floor)
	};
}

/** dB value for the band [fa, fb]: interpolated when narrower than a bin, else the band's maximum. */
function bandLevel(db: Float32Array, binHz: number, fa: number, fb: number): number {
	const ba = fa / binHz;
	const bb = fb / binHz;
	if (bb - ba < 1) {
		const c = (ba + bb) / 2;
		const i = Math.min(db.length - 2, Math.floor(c));
		return db[i] + (db[i + 1] - db[i]) * (c - i);
	}
	let v = -Infinity;
	const end = Math.min(db.length, Math.ceil(bb));
	for (let i = Math.floor(ba); i < end; i++) if (db[i] > v) v = db[i];
	return v;
}

function frequencyLabel(f: number): string {
	return f >= 1000 ? `${f / 1000}k` : String(f);
}

const MINOR_FREQS: number[] = [];
for (const decade of [10, 100, 1000, 10000]) {
	for (let m = 1; m < 10; m++) MINOR_FREQS.push(decade * m);
}
const LABEL_FREQS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const MINUS = '\u2212';

/** Text with a translucent dark chip behind it, so labels stay readable over bright data. */
function chipText(s: Surface, text: string, x: number, y: number, align: 'left' | 'center') {
	const { ctx, dpr } = s;
	const tw = ctx.measureText(text).width;
	const left = align === 'center' ? x - tw / 2 : x;
	ctx.fillStyle = 'rgba(6, 8, 11, 0.6)';
	ctx.fillRect(left - 3 * dpr, y - 7 * dpr, tw + 6 * dpr, 14 * dpr);
	ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
	ctx.fillText(text, left, y);
}

export interface SpectrumFrame {
	db: Float32Array;
	binHz: number;
	minDb: number;
	maxDb: number;
	maxHz: number;
	/** Detected fundamental, to mark it and its harmonics. */
	pitch: number | null;
}

export function drawSpectrum(s: Surface, frame: SpectrumFrame, state: SpectrumState) {
	const { ctx, width: w, height: h, dpr } = s;
	const { db, binHz, minDb, maxDb, maxHz, pitch } = frame;
	const fMax = Math.min(SPECTRUM_MAX_HZ, maxHz);
	ctx.fillStyle = BG;
	ctx.fillRect(0, 0, w, h);
	ctx.lineWidth = Math.max(1, Math.round(dpr));

	const xOf = (f: number) => logPosition(f, SPECTRUM_MIN_HZ, fMax) * w;
	const yOf = (v: number) =>
		h - ((Math.max(minDb, Math.min(maxDb, v)) - minDb) / (maxDb - minDb)) * h;

	for (const f of MINOR_FREQS) {
		if (f < SPECTRUM_MIN_HZ || f > fMax) continue;
		const x = Math.round(xOf(f)) + 0.5;
		const major = f === 100 || f === 1000 || f === 10000;
		line(s, x, 0, x, h, major ? GRID_MAJOR : GRID_MINOR);
	}
	for (let v = Math.ceil(minDb / 10) * 10; v <= maxDb; v += 10) {
		const y = Math.round(yOf(v)) + 0.5;
		line(s, 0, y, w, y, v % 20 === 0 ? GRID_MAJOR : GRID_MINOR);
	}

	// Per-column level: fast attack, gentle release, plus a slowly falling peak hold.
	const { smoothed, peaks } = state;
	for (let x = 0; x < w; x++) {
		const fa = logFrequency(x / w, SPECTRUM_MIN_HZ, fMax);
		const fb = logFrequency((x + 1) / w, SPECTRUM_MIN_HZ, fMax);
		const v = bandLevel(db, binHz, fa, fb);
		const prev = smoothed[x];
		smoothed[x] = v > prev ? v : prev + (v - prev) * 0.22;
		peaks[x] = Math.max(peaks[x] - 0.45, smoothed[x]);
	}

	const outline = new Path2D();
	const area = new Path2D();
	area.moveTo(0, h);
	for (let x = 0; x < w; x++) {
		const y = yOf(smoothed[x]);
		if (x === 0) outline.moveTo(x, y);
		else outline.lineTo(x, y);
		area.lineTo(x, y);
	}
	area.lineTo(w, h);
	area.closePath();
	const fill = ctx.createLinearGradient(0, 0, 0, h);
	fill.addColorStop(0, 'rgba(251, 146, 60, 0.55)');
	fill.addColorStop(0.55, 'rgba(234, 88, 12, 0.22)');
	fill.addColorStop(1, 'rgba(234, 88, 12, 0.03)');
	ctx.fillStyle = fill;
	ctx.fill(area);

	const peakPath = new Path2D();
	for (let x = 0; x < w; x++) {
		const y = yOf(peaks[x]);
		if (x === 0) peakPath.moveTo(x, y);
		else peakPath.lineTo(x, y);
	}
	ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
	ctx.lineWidth = dpr;
	ctx.stroke(peakPath);
	glowStroke(
		s,
		outline,
		'rgba(249, 115, 22, 0.1)',
		'rgba(249, 115, 22, 0.28)',
		'rgba(254, 215, 170, 0.95)'
	);

	// Fundamental and harmonics: the learning view of "why a saw sounds brighter than a square".
	if (pitch) {
		ctx.font = font(dpr, 10);
		ctx.textAlign = 'center';
		for (let k = 1; k <= 16; k++) {
			const f = pitch * k;
			if (f > fMax) break;
			const x = Math.round(xOf(f)) + 0.5;
			ctx.fillStyle = HARMONIC;
			ctx.beginPath();
			ctx.moveTo(x - 4 * dpr, 0);
			ctx.lineTo(x + 4 * dpr, 0);
			ctx.lineTo(x, 6 * dpr);
			ctx.closePath();
			ctx.fill();
			if (k === 1) {
				ctx.save();
				ctx.setLineDash([3 * dpr, 4 * dpr]);
				line(s, x, 6 * dpr, x, h, 'rgba(74, 222, 128, 0.35)');
				ctx.restore();
			}
			if (k <= 8) ctx.fillText(k === 1 ? 'f₀' : String(k), x, 18 * dpr);
		}
	}

	ctx.font = font(dpr);
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	for (const f of LABEL_FREQS) {
		if (f > fMax) continue;
		chipText(s, frequencyLabel(f), xOf(f), h - 10 * dpr, 'center');
	}
	for (let v = Math.ceil(minDb / 20) * 20; v < maxDb; v += 20) {
		if (v <= minDb) continue;
		chipText(s, `${String(v).replace('-', MINUS)} dB`, 8 * dpr, yOf(v) - 9 * dpr, 'left');
	}
	ctx.textBaseline = 'alphabetic';
}

/** Off-screen history canvas that scrolls left as new columns arrive. */
export interface SpectrogramState {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	column: ImageData;
}

export function createSpectrogramState(
	width: number,
	height: number,
	shift: number
): SpectrogramState | null {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.fillStyle = BG;
	ctx.fillRect(0, 0, width, height);
	return { canvas, ctx, column: ctx.createImageData(shift, height) };
}

export function drawSpectrogram(s: Surface, frame: SpectrumFrame, state: SpectrogramState) {
	const { ctx, width: w, height: h, dpr } = s;
	const { db, binHz, minDb, maxDb, maxHz } = frame;
	const fMax = Math.min(SPECTRUM_MAX_HZ, maxHz);
	const hist = state.ctx;
	const shift = state.column.width;

	// Scroll the history left, then paint the newest column(s) at the right edge.
	hist.globalCompositeOperation = 'copy';
	hist.drawImage(state.canvas, -shift, 0);
	hist.globalCompositeOperation = 'source-over';
	const data = state.column.data;
	const rows = state.column.height;
	for (let y = 0; y < rows; y++) {
		const fa = logFrequency(1 - (y + 1) / rows, SPECTRUM_MIN_HZ, fMax);
		const fb = logFrequency(1 - y / rows, SPECTRUM_MIN_HZ, fMax);
		const t = (bandLevel(db, binHz, fa, fb) - minDb) / (maxDb - minDb);
		const idx = Math.round(Math.max(0, Math.min(1, t)) * 255) * 4;
		for (let sx = 0; sx < shift; sx++) {
			const o = (y * shift + sx) * 4;
			data[o] = SPECTROGRAM_LUT[idx];
			data[o + 1] = SPECTROGRAM_LUT[idx + 1];
			data[o + 2] = SPECTROGRAM_LUT[idx + 2];
			data[o + 3] = 255;
		}
	}
	hist.putImageData(state.column, state.canvas.width - shift, 0);

	ctx.drawImage(state.canvas, 0, 0, w, h);
	ctx.lineWidth = Math.max(1, Math.round(dpr));
	ctx.font = font(dpr);
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	// 10k is left out: the pitch readout sits in that corner.
	for (const f of [50, 100, 200, 500, 1000, 2000, 5000]) {
		if (f > fMax) continue;
		const y = Math.round(h - logPosition(f, SPECTRUM_MIN_HZ, fMax) * h) + 0.5;
		line(s, 0, y, 10 * dpr, y, 'rgba(226, 232, 240, 0.55)');
		chipText(s, frequencyLabel(f), 16 * dpr, y, 'left');
	}
	ctx.textBaseline = 'alphabetic';
}
