/**
 * @file sequencer.svelte.ts
 * @description Playback engine and storage for the browser step sequencer.
 *
 * Internal clock: a look-ahead scheduler (ticks from a Web Worker, so a background tab keeps
 * time) queues notes and CC parameter locks a little ahead with Web MIDI timestamps, and can
 * send MIDI clock / start / stop so the S-1 follows. External clock: steps advance on incoming
 * MIDI clock (6 ticks per sixteenth) from a chosen input, started and stopped by its Start/Stop.
 */
import {
	CLOCKS_PER_STEP,
	activeLanes,
	demoPattern,
	emptyStep,
	normalizePattern,
	stepMs,
	swingOffset,
	type Lane,
	type Pattern
} from '#lib/sequencer.js';
import { midiStore, type MidiPortInfo } from '#lib/stores/midi.svelte.js';

export type ClockSource = 'internal' | 'external';

const WORKING_KEY = 's1-seq-working-v1';
const LIBRARY_KEY = 's1-patterns-v1';
const LOOKAHEAD_MS = 120;
const TICK_MS = 25;
const CLOCK_TIMEOUT_MS = 600;
const S1_NAME = /\bS-1\b/i;
const KEYSTEP_NAME = /keystep/i;

const TICKER_SOURCE = `let id = null;
onmessage = (e) => {
	clearInterval(id);
	id = e.data === 'start' ? setInterval(() => postMessage(0), ${TICK_MS}) : null;
};`;

function read<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function write(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// storage full or blocked: the pattern still works for this visit
	}
}

const clone = (p: Pattern): Pattern => JSON.parse(JSON.stringify(p)) as Pattern;
const int7 = (v: number) => Math.max(0, Math.min(127, Math.round(v)));

class SequencerStore {
	pattern = $state<Pattern>(
		(typeof localStorage === 'undefined' ? null : normalizePattern(read(WORKING_KEY, null))) ??
			demoPattern()
	);
	library = $state<Pattern[]>(
		typeof localStorage === 'undefined'
			? []
			: read<unknown[]>(LIBRARY_KEY, [])
					.map(normalizePattern)
					.filter((p): p is Pattern => p !== null)
	);
	playing = $state(false);
	/** Step being heard right now (−1 when stopped). */
	playhead = $state(-1);
	clockSource = $state<ClockSource>('internal');
	/** Internal clock: also send MIDI clock, start and stop to the S-1. */
	sendClock = $state(false);
	externalInputs = $state<MidiPortInfo[]>([]);
	externalInputId = $state('');
	/** External clock: armed, waiting for Start. */
	waiting = $state(false);
	/** External clock: ticks are arriving. */
	externalClock = $state(false);
	message = $state('');

	#ticker: Worker | null = null;
	#interval: ReturnType<typeof setInterval> | undefined;
	#gridTime = 0;
	#nextStep = 0;
	#queue: { step: number; time: number }[] = [];
	#frame = 0;
	#lastCc: Record<number, number> = {};
	#sounding: { note: number; off: number }[] = [];
	#access: MIDIAccess | null = null;
	#bound: MIDIInput | null = null;
	#ticks = 0;
	#lastTick = 0;
	#tickMs = 125 / CLOCKS_PER_STEP;
	#clockTimer: ReturnType<typeof setTimeout> | undefined;
	#saveTimer: ReturnType<typeof setTimeout> | undefined;

	// ── Editing (each edit is saved as the working pattern, debounced) ─────────

	#touch() {
		clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(
			() => write(WORKING_KEY, { ...$state.snapshot(this.pattern), updatedAt: Date.now() }),
			250
		);
	}

	toggleNote(step: number, note: number) {
		const notes = this.pattern.steps[step].notes;
		const index = notes.indexOf(note);
		if (index >= 0) notes.splice(index, 1);
		else if (notes.length < 8) notes.push(note);
		this.#touch();
	}

	removeNote(step: number, note: number) {
		const notes = this.pattern.steps[step].notes;
		const index = notes.indexOf(note);
		if (index >= 0) notes.splice(index, 1);
		this.#touch();
	}

	setVelocity(step: number, velocity: number) {
		this.pattern.steps[step].velocity = Math.max(1, int7(velocity));
		this.#touch();
	}

	setGate(step: number, gate: number) {
		this.pattern.steps[step].gate = Math.max(0.1, Math.min(1, Math.round(gate * 100) / 100));
		this.#touch();
	}

	setLock(step: number, cc: number, value: number | null) {
		const locks = this.pattern.steps[step].locks;
		if (value === null) delete locks[String(cc)];
		else locks[String(cc)] = int7(value);
		this.#touch();
	}

	/** Points a lane at another CC, moving its locks along. */
	setLaneCc(index: number, cc: number) {
		const lane = this.pattern.lanes[index];
		if (!lane || lane.cc === cc || this.pattern.lanes.some((l) => l.cc === cc)) return;
		for (const step of this.pattern.steps) {
			const value = step.locks[String(lane.cc)];
			delete step.locks[String(lane.cc)];
			if (value !== undefined) step.locks[String(cc)] = value;
		}
		lane.cc = cc;
		this.#touch();
	}

	setLaneBase(index: number, base: number) {
		const lane: Lane | undefined = this.pattern.lanes[index];
		if (!lane) return;
		lane.base = int7(base);
		this.#touch();
	}

	clearLane(index: number) {
		const lane = this.pattern.lanes[index];
		if (!lane) return;
		for (const step of this.pattern.steps) delete step.locks[String(lane.cc)];
		this.#touch();
	}

	setMeta(meta: Partial<Pick<Pattern, 'name' | 'length' | 'bpm' | 'swing'>>) {
		Object.assign(this.pattern, meta);
		this.#touch();
	}

	clearSteps() {
		for (let i = 0; i < this.pattern.steps.length; i++) this.pattern.steps[i] = emptyStep();
		this.#touch();
	}

	async play() {
		if (this.playing || this.waiting) return;
		if (midiStore.status !== 'connected' || !midiStore.outputReady) {
			this.message = 'Connect S-1 first (above the drawing) so the sequencer can play it.';
			return;
		}
		this.message = '';
		this.#lastCc = {};
		this.#nextStep = 0;
		if (this.clockSource === 'external') {
			const ok = await this.#listenExternal();
			if (!ok) return;
			this.waiting = true;
			return;
		}
		this.playing = true;
		this.#gridTime = performance.now() + 60;
		if (this.sendClock) midiStore.send([0xfa], this.#gridTime - 1);
		this.#startTicker();
		this.#schedule();
		this.#startPlayhead();
	}

	stop() {
		const wasRunning = this.playing || this.waiting;
		const internal = this.clockSource === 'internal';
		this.playing = false;
		this.waiting = false;
		this.#stopTicker();
		cancelAnimationFrame(this.#frame);
		this.#queue = [];
		this.playhead = -1;
		this.#unbindExternal();
		if (!wasRunning) return;
		if (internal && this.sendClock) midiStore.send([0xfc]);
		this.#silence();
	}

	setClockSource(source: ClockSource) {
		if (source === this.clockSource) return;
		this.stop();
		this.clockSource = source;
		if (source === 'external') {
			this.sendClock = false;
			void this.#listenExternal(false);
		}
	}

	selectExternalInput(id: string) {
		this.externalInputId = id;
		if (this.waiting || this.playing) this.#bindExternal();
	}

	// ── Library ────────────────────────────────────────────────────────────────

	save(name: string, asNew = false) {
		const trimmed = name.trim() || this.pattern.name;
		if (asNew) this.pattern.id = `pat-${Date.now().toString(36)}`;
		this.pattern.name = trimmed.slice(0, 60);
		this.pattern.updatedAt = Date.now();
		this.#touch();
		const copy = clone($state.snapshot(this.pattern) as Pattern);
		const index = this.library.findIndex((p) => p.id === copy.id);
		this.library =
			index >= 0 ? this.library.map((p, i) => (i === index ? copy : p)) : [copy, ...this.library];
		write(LIBRARY_KEY, this.library);
		return copy;
	}

	load(id: string) {
		const found = this.library.find((p) => p.id === id);
		if (!found) return;
		this.pattern = clone(found);
		this.#lastCc = {};
		this.#touch();
	}

	remove(id: string) {
		this.library = this.library.filter((p) => p.id !== id);
		write(LIBRARY_KEY, this.library);
	}

	replace(pattern: Pattern) {
		this.pattern = pattern;
		this.#lastCc = {};
		this.#touch();
	}

	// ── Internal clock ─────────────────────────────────────────────────────────

	#startTicker() {
		this.#stopTicker();
		try {
			const url = URL.createObjectURL(new Blob([TICKER_SOURCE], { type: 'text/javascript' }));
			this.#ticker = new Worker(url);
			URL.revokeObjectURL(url);
			this.#ticker.onmessage = () => this.#schedule();
			this.#ticker.postMessage('start');
		} catch {
			// No workers (or blocked): a page timer still works while the tab is visible.
			this.#interval = setInterval(() => this.#schedule(), TICK_MS);
		}
	}

	#stopTicker() {
		this.#ticker?.terminate();
		this.#ticker = null;
		clearInterval(this.#interval);
	}

	#schedule() {
		if (!this.playing || this.clockSource !== 'internal') return;
		if (!midiStore.outputReady) {
			this.stop();
			this.message = 'The S-1 disconnected, so playback stopped.';
			return;
		}
		const p = this.pattern;
		const duration = stepMs(p.bpm);
		const now = performance.now();
		// After a long stall (sleeping laptop…), pick up from now instead of catching up.
		if (this.#gridTime < now - 250) this.#gridTime = now + 20;
		const lanes = activeLanes(p);
		while (this.#gridTime < now + LOOKAHEAD_MS) {
			const step = this.#nextStep % p.length;
			const time = this.#gridTime + swingOffset(step, p.swing) * duration;
			this.#playStep(step, time, duration, lanes);
			if (this.sendClock) {
				for (let k = 0; k < CLOCKS_PER_STEP; k++) {
					midiStore.send([0xf8], this.#gridTime + (k * duration) / CLOCKS_PER_STEP);
				}
			}
			this.#gridTime += duration;
			this.#nextStep = (step + 1) % p.length;
		}
		this.#sounding = this.#sounding.filter((s) => s.off > now - 1000);
	}

	#playStep(step: number, time: number, duration: number, lanes = activeLanes(this.pattern)) {
		const s = this.pattern.steps[step];
		const ch = midiStore.channel - 1;
		for (const lane of lanes) {
			const value = s.locks[String(lane.cc)] ?? lane.base;
			if (this.#lastCc[lane.cc] === value) continue;
			this.#lastCc[lane.cc] = value;
			midiStore.send([0xb0 | ch, lane.cc, value], Math.max(0, time - 1));
		}
		for (const note of s.notes) {
			midiStore.send([0x90 | ch, note, s.velocity], time);
			const off = time + Math.max(8, s.gate * duration - (s.gate >= 1 ? 3 : 0));
			midiStore.send([0x80 | ch, note, 0], off);
			this.#sounding.push({ note, off });
		}
		this.#queue.push({ step, time });
		if (this.#queue.length > 256) this.#queue.splice(0, this.#queue.length - 256);
	}

	#startPlayhead() {
		cancelAnimationFrame(this.#frame);
		const loop = () => {
			this.#frame = requestAnimationFrame(loop);
			const now = performance.now();
			let current = -1;
			while (this.#queue.length > 0 && this.#queue[0].time <= now) {
				current = this.#queue.shift()?.step ?? current;
			}
			if (current >= 0 && current !== this.playhead) this.playhead = current;
		};
		this.#frame = requestAnimationFrame(loop);
	}

	/** Note-offs for anything still sounding or queued, then All Notes Off (the S-1 receives it). */
	#silence() {
		const ch = midiStore.channel - 1;
		const now = performance.now();
		for (const { note, off } of this.#sounding) {
			if (off < now - 50) continue;
			midiStore.send([0x80 | ch, note, 0]);
			midiStore.send([0x80 | ch, note, 0], now + LOOKAHEAD_MS + 20);
		}
		midiStore.send([0xb0 | ch, 123, 0], now + LOOKAHEAD_MS + 25);
		this.#sounding = [];
	}

	// ── External clock ─────────────────────────────────────────────────────────

	async #listenExternal(bind = true): Promise<boolean> {
		if (!this.#access) {
			if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
				this.message = 'This browser can’t receive MIDI clock. Use Chrome or Edge.';
				return false;
			}
			try {
				this.#access = await navigator.requestMIDIAccess({ sysex: false });
				this.#access.addEventListener('statechange', this.#syncInputs);
			} catch {
				this.message = 'MIDI access was blocked, so the sequencer can’t follow an external clock.';
				return false;
			}
		}
		this.#syncInputs();
		if (bind) this.#bindExternal();
		return true;
	}

	#syncInputs = () => {
		const access = this.#access;
		if (!access) return;
		this.externalInputs = [...access.inputs.values()].map((port) => ({
			id: port.id,
			name: port.name ?? port.id,
			connected: port.state === 'connected'
		}));
		if (!this.externalInputs.some((p) => p.id === this.externalInputId)) {
			this.externalInputId =
				this.externalInputs.find((p) => p.id === midiStore.inputId)?.id ??
				this.externalInputs.find((p) => S1_NAME.test(p.name))?.id ??
				this.externalInputs.find((p) => KEYSTEP_NAME.test(p.name))?.id ??
				'';
		}
		if (this.#bound && this.#bound.state !== 'connected') this.#unbindExternal();
	};

	#bindExternal() {
		this.#unbindExternal();
		const input = this.#access?.inputs.get(this.externalInputId);
		if (!input || input.state !== 'connected') {
			this.message = 'Choose the input that sends the clock (the S-1 or the KeyStep).';
			return;
		}
		input.addEventListener('midimessage', this.#onExternal);
		void input.open().catch(() => undefined);
		this.#bound = input;
	}

	#unbindExternal() {
		this.#bound?.removeEventListener('midimessage', this.#onExternal);
		this.#bound = null;
		this.externalClock = false;
	}

	#onExternal = (event: Event) => {
		const status = (event as MIDIMessageEvent).data?.[0];
		if (status === 0xfa) {
			this.#ticks = 0;
			this.#nextStep = 0;
			this.#lastCc = {};
			this.playing = true;
			this.waiting = false;
		} else if (status === 0xfb) {
			this.playing = true;
			this.waiting = false;
		} else if (status === 0xfc) {
			if (!this.playing) return;
			this.playing = false;
			this.waiting = true;
			this.playhead = -1;
			this.#silence();
		} else if (status === 0xf8) {
			const now = performance.now();
			if (this.#lastTick > 0 && now - this.#lastTick < 200) {
				this.#tickMs = this.#tickMs * 0.8 + (now - this.#lastTick) * 0.2;
			}
			this.#lastTick = now;
			this.externalClock = true;
			clearTimeout(this.#clockTimer);
			this.#clockTimer = setTimeout(() => (this.externalClock = false), CLOCK_TIMEOUT_MS);
			if (!this.playing) return;
			if (this.#ticks % CLOCKS_PER_STEP === 0) {
				const p = this.pattern;
				const step = this.#nextStep % p.length;
				this.#playStep(step, now, this.#tickMs * CLOCKS_PER_STEP);
				this.#queue = [];
				this.playhead = step;
				this.#nextStep = (step + 1) % p.length;
			}
			this.#ticks++;
		}
	};
}

export const sequencerStore = new SequencerStore();
