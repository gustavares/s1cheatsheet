/**
 * @file voice.ts
 * @description A small Web Audio voice that approximates the S-1's signal path
 * (oscillator mix → 24 dB/oct low-pass with resonance and envelope → amp envelope), driven by
 * the same CC values as the hardware. Used to play drill targets and draw their waveforms.
 *
 * Roland doesn't publish how CC values map to cutoff, envelope times, etc., so the curves below
 * are reasonable synth conventions, not measurements of the S-1. Drills compare harmonic levels
 * and loudness curves rather than knob positions, so the player matches the sound, and the
 * knob positions Reveal shows are approximate.
 */
import { PitchDetector, envelopeOf, findTrigger, resampleCycle } from '#lib/visualizer/dsp.js';

export interface VoiceParams {
	saw: number;
	square: number;
	sub: number;
	noise: number;
	/** Low-pass cutoff in Hz. */
	cutoff: number;
	/** Q of the resonant filter stage. */
	resonance: number;
	/** How many octaves the filter envelope opens the cutoff. */
	envAmount: number;
	attack: number;
	decay: number;
	sustain: number;
	release: number;
}

/** Default CC values used when a drill doesn't specify a parameter. */
export const VOICE_DEFAULTS: Record<string, number> = {
	'20': 127, // saw level
	'19': 0, // square level
	'21': 0, // sub level
	'23': 0, // noise level
	'74': 127, // FREQ
	'71': 0, // RESO
	'24': 0, // filter ENV depth
	'73': 0, // ATTACK
	'75': 64, // DECAY
	'30': 127, // SUSTAIN
	'72': 20 // RELEASE
};

function norm(values: Record<string, number>, cc: number): number {
	const key = String(cc);
	const raw = key in values ? values[key] : (VOICE_DEFAULTS[key] ?? 0);
	return Math.max(0, Math.min(127, raw)) / 127;
}

export function paramsFromValues(values: Record<string, number>): VoiceParams {
	return {
		saw: norm(values, 20),
		square: norm(values, 19),
		sub: norm(values, 21),
		noise: norm(values, 23),
		cutoff: 20 * Math.pow(1000, norm(values, 74)),
		resonance: 0.7 + 17 * Math.pow(norm(values, 71), 2),
		envAmount: 6 * norm(values, 24),
		attack: 0.001 * Math.pow(4000, norm(values, 73)),
		decay: 0.005 * Math.pow(1000, norm(values, 75)),
		sustain: norm(values, 30),
		release: 0.005 * Math.pow(1000, norm(values, 72))
	};
}

/** Schedules one note; returns the time when everything has stopped. */
export function scheduleVoice(
	ctx: BaseAudioContext,
	p: VoiceParams,
	frequency: number,
	start: number,
	gate: number,
	destination: AudioNode
): number {
	const end = start + gate + Math.min(6, p.release * 6) + 0.05;
	const mix = ctx.createGain();
	mix.gain.value = 0.45;

	const addOsc = (type: OscillatorType, freq: number, level: number) => {
		if (level <= 0) return;
		const osc = ctx.createOscillator();
		osc.type = type;
		osc.frequency.value = freq;
		const g = ctx.createGain();
		g.gain.value = level;
		osc.connect(g).connect(mix);
		osc.start(start);
		osc.stop(end);
	};
	addOsc('sawtooth', frequency, p.saw);
	addOsc('square', frequency, p.square * 0.8);
	addOsc('square', frequency / 2, p.sub * 0.8);
	if (p.noise > 0) {
		const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		let seed = 12345;
		for (let i = 0; i < data.length; i++) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			data[i] = (seed / 4294967296) * 2 - 1;
		}
		const noise = ctx.createBufferSource();
		noise.buffer = buffer;
		noise.loop = true;
		const g = ctx.createGain();
		g.gain.value = p.noise * 0.5;
		noise.connect(g).connect(mix);
		noise.start(start);
		noise.stop(end);
	}

	// Two 12 dB/oct stages ≈ 24 dB/oct; resonance on the second stage.
	const nyquist = ctx.sampleRate * 0.45;
	const base = Math.min(p.cutoff, nyquist);
	const peak = Math.min(base * Math.pow(2, p.envAmount), nyquist);
	const held = Math.min(base * Math.pow(2, p.envAmount * p.sustain), nyquist);
	const stages = [0.7071, p.resonance].map((q) => {
		const f = ctx.createBiquadFilter();
		f.type = 'lowpass';
		f.Q.value = q;
		f.frequency.setValueAtTime(base, start);
		if (p.envAmount > 0) {
			f.frequency.linearRampToValueAtTime(peak, start + p.attack);
			f.frequency.setTargetAtTime(held, start + p.attack, p.decay / 3);
			f.frequency.setTargetAtTime(base, start + Math.max(gate, p.attack), p.release / 3);
		}
		return f;
	});

	const amp = ctx.createGain();
	amp.gain.setValueAtTime(0, start);
	amp.gain.linearRampToValueAtTime(1, start + p.attack);
	amp.gain.setTargetAtTime(p.sustain, start + p.attack, p.decay / 3);
	amp.gain.setTargetAtTime(0, start + Math.max(gate, p.attack), p.release / 3);

	mix.connect(stages[0]).connect(stages[1]).connect(amp).connect(destination);
	return end;
}

export interface TargetRender {
	/** One cycle of the held note (256 points, peak-normalized), for the scope overlay. */
	cycle: Float32Array;
	/** Fundamental of that cycle in Hz (an octave below the note when the sub oscillator is up). */
	cycleHz: number;
	/** Loudness every 10 ms over the whole note, for envelope drills. */
	envelope: Float32Array;
}

/** Renders a target note offline (never audible) and extracts its cycle and envelope. */
export async function renderTarget(
	values: Record<string, number>,
	frequency: number,
	gate: number,
	seconds: number,
	sampleRate = 48000
): Promise<TargetRender> {
	const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
	const p = paramsFromValues(values);
	scheduleVoice(ctx, p, frequency, 0, gate, ctx.destination);
	const audio = (await ctx.startRendering()).getChannelData(0);

	// Take the cycle from the held part of the note (after attack and most of the decay) and
	// measure its period the way the Visualizer does, so a sub oscillator's longer cycle (an
	// octave down) is captured whole, just like the live trace.
	const size = 8192;
	const at = Math.min(gate * 0.85, p.attack + p.decay * 2 + 0.15);
	const from = Math.max(0, Math.min(audio.length - size, Math.floor(at * sampleRate) - size / 2));
	const window = audio.subarray(from, from + size);
	const period =
		new PitchDetector(size).detect(window, sampleRate)?.period ?? sampleRate / frequency;
	const { start } = findTrigger(window, Math.ceil(period) + 2, period);
	return {
		cycle: resampleCycle(window, start, period),
		cycleHz: sampleRate / period,
		envelope: envelopeOf(audio, sampleRate)
	};
}

/** Plays a target note through the speakers on `ctx`. */
export function playTarget(
	ctx: AudioContext,
	values: Record<string, number>,
	frequency: number,
	gate: number
) {
	const out = ctx.createGain();
	out.gain.value = 0.8;
	out.connect(ctx.destination);
	const end = scheduleVoice(
		ctx,
		paramsFromValues(values),
		frequency,
		ctx.currentTime + 0.03,
		gate,
		out
	);
	setTimeout(() => out.disconnect(), (end - ctx.currentTime + 0.2) * 1000);
}
