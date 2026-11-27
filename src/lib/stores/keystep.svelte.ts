/**
 * @file keystep.svelte.ts
 * @description Opt-in listener for an Arturia KeyStep 37 (or any MIDI keyboard) over Web MIDI:
 * held keys, sustain pedal, pitch bend and mod wheel, MIDI clock / start / stop, and an optional
 * in-browser MIDI thru to the S-1 for setups without a direct cable.
 *
 * It asks for its own MIDIAccess and listens with addEventListener, so it never takes over the
 * S-1 connection in `midiStore`, even when both use the same port. SysEx is never requested.
 */
import { midiStore, type MidiPortInfo } from '#lib/stores/midi.svelte.js';

export type KeystepStatus =
	'idle' | 'unsupported' | 'requesting' | 'denied' | 'error' | 'connected';

/** One note in the recent-activity roll (times from performance.now()). */
export interface NoteSpan {
	note: number;
	velocity: number;
	start: number;
	end: number | null;
}

const KEYSTEP_NAME = /keystep/i;
const HISTORY_MS = 8000;
const CLOCK_TIMEOUT_MS = 600;
const PPQN = 24;

function without(record: Record<number, number>, key: number): Record<number, number> {
	const copy = { ...record };
	delete copy[key];
	return copy;
}

const UNSUPPORTED_MESSAGE =
	'This browser can’t talk to MIDI devices. Open this page in Chrome or Edge on a desktop computer to use the KeyStep view.';

class KeystepStore {
	status = $state<KeystepStatus>('idle');
	message = $state('');
	inputs = $state<MidiPortInfo[]>([]);
	inputId = $state('');
	/** 0 = every channel, otherwise only this MIDI channel (1–16). */
	channel = $state(0);
	/** Keys down right now: note → velocity. */
	held = $state<Record<number, number>>({});
	/** Keys released while the sustain pedal is down: still sounding. */
	sustained = $state<Record<number, number>>({});
	sustain = $state(false);
	/** −1…1 */
	pitchBend = $state(0);
	/** 0…1 */
	modWheel = $state(0);
	/** MIDI Start received (until Stop). */
	playing = $state(false);
	/** Clock ticks arriving right now. */
	clockActive = $state(false);
	bpm = $state<number | null>(null);
	/** Quarter notes counted since Start (24 clock ticks each). */
	beat = $state(0);
	/** Forward notes, bend, mod wheel and sustain to the S-1 on its channel. */
	thru = $state(false);
	/** Also forward clock, start and stop. */
	thruClock = $state(false);
	/** Notes and messages seen since connecting. */
	messageCount = $state(0);

	/** Recent notes for the activity roll (read by the canvas each frame; not reactive). */
	history: NoteSpan[] = [];
	/** Times of recent quarter notes from the MIDI clock (for the roll's beat lines). */
	beats: number[] = [];

	#access: MIDIAccess | null = null;
	#bound: MIDIInput | null = null;
	#open: Record<number, NoteSpan> = {};
	#thruNotes: Record<number, true> = {};
	#clockTimes: number[] = [];
	#ticks = 0;
	#clockTimer: ReturnType<typeof setTimeout> | undefined;

	get inputReady(): boolean {
		return this.inputs.some((p) => p.id === this.inputId && p.connected);
	}

	/** Notes sounding now (held or sustained), low to high. */
	get sounding(): number[] {
		return Object.keys({ ...this.sustained, ...this.held })
			.map(Number)
			.sort((a, b) => a - b);
	}

	/** Call from a click: asks for Web MIDI (without SysEx) and listens to the KeyStep. */
	async connect() {
		if (this.status === 'requesting' || this.status === 'connected') return;
		if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
			this.status = 'unsupported';
			this.message = UNSUPPORTED_MESSAGE;
			return;
		}
		this.status = 'requesting';
		this.message = 'Waiting for MIDI permission…';
		try {
			const access = await navigator.requestMIDIAccess({ sysex: false });
			this.#access = access;
			access.addEventListener('statechange', this.#onStateChange);
			this.status = 'connected';
			this.message = '';
			this.#syncPorts();
		} catch (err) {
			const name = err instanceof Error ? err.name : '';
			this.status = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error';
			this.message =
				this.status === 'denied'
					? 'MIDI access was blocked. Allow MIDI devices for this site in the browser’s site settings, then try again.'
					: `Couldn’t open MIDI: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	disconnect() {
		this.#unbind();
		this.#access?.removeEventListener('statechange', this.#onStateChange);
		this.#access = null;
		this.setThru(false);
		this.#reset();
		this.status = 'idle';
		this.message = '';
		this.inputs = [];
		this.inputId = '';
	}

	selectInput(id: string) {
		this.inputId = id;
		this.#reset();
		this.#bind();
	}

	setThru(on: boolean) {
		if (!on) this.#releaseThruNotes();
		this.thru = on;
	}

	#syncPorts() {
		const access = this.#access;
		if (!access) return;
		this.inputs = [...access.inputs.values()].map((port) => ({
			id: port.id,
			name: port.name ?? port.id,
			connected: port.state === 'connected'
		}));
		if (!this.inputs.some((p) => p.id === this.inputId)) {
			this.inputId = this.inputs.find((p) => KEYSTEP_NAME.test(p.name))?.id ?? '';
		}
		this.#bind();
	}

	#bind() {
		const input = this.#access?.inputs.get(this.inputId) ?? null;
		const usable = input && input.state === 'connected' ? input : null;
		if (usable === this.#bound) return;
		this.#unbind();
		if (usable) {
			usable.addEventListener('midimessage', this.#onMessage);
			// addEventListener doesn't open a port implicitly (onmidimessage would).
			void usable.open().catch(() => undefined);
			this.#bound = usable;
		}
	}

	#unbind() {
		this.#bound?.removeEventListener('midimessage', this.#onMessage);
		this.#bound = null;
		this.#releaseThruNotes();
	}

	#onStateChange = () => {
		const before = this.#bound;
		this.#syncPorts();
		// The KeyStep went away: nothing is held any more.
		if (before && !this.#bound) this.#reset();
	};

	#reset() {
		const now = performance.now();
		for (const span of Object.values(this.#open)) span.end = now;
		this.#open = {};
		this.held = {};
		this.sustained = {};
		this.sustain = false;
		this.pitchBend = 0;
		this.modWheel = 0;
		this.playing = false;
		this.clockActive = false;
		this.bpm = null;
		this.#clockTimes = [];
		this.#ticks = 0;
	}

	#onMessage = (event: Event) => {
		const data = (event as MIDIMessageEvent).data;
		if (!data || data.length === 0) return;
		const status = data[0];
		const now = performance.now();
		this.messageCount++;
		if (status >= 0xf8) {
			this.#realtime(status, now);
			return;
		}
		const type = status & 0xf0;
		if (this.channel !== 0 && (status & 0x0f) !== this.channel - 1) return;
		if (type === 0x90 && data[2] > 0) this.#noteOn(data[1], data[2], now);
		else if (type === 0x80 || type === 0x90) this.#noteOff(data[1], now);
		else if (type === 0xb0 && data[1] === 64) this.#setSustain(data[2] >= 64);
		else if (type === 0xb0 && data[1] === 1) this.modWheel = data[2] / 127;
		else if (type === 0xe0) this.pitchBend = (((data[2] << 7) | data[1]) - 8192) / 8192;
		else return;
		this.#forward(type, data);
	};

	#noteOn(note: number, velocity: number, now: number) {
		this.held = { ...this.held, [note]: velocity };
		if (note in this.sustained) this.sustained = without(this.sustained, note);
		const previous = this.#open[note];
		if (previous) previous.end = now;
		const span: NoteSpan = { note, velocity, start: now, end: null };
		this.#open[note] = span;
		this.history.push(span);
		while (this.history.length > 0 && (this.history[0].end ?? now) < now - HISTORY_MS) {
			this.history.shift();
		}
	}

	#noteOff(note: number, now: number) {
		const velocity = this.held[note];
		if (velocity === undefined) return;
		this.held = without(this.held, note);
		if (this.sustain) this.sustained = { ...this.sustained, [note]: velocity };
		else this.#end(note, now);
	}

	#end(note: number, now: number) {
		const span = this.#open[note];
		if (span) span.end = now;
		delete this.#open[note];
	}

	#setSustain(down: boolean) {
		this.sustain = down;
		if (!down) {
			const now = performance.now();
			for (const note of Object.keys(this.sustained)) this.#end(Number(note), now);
			this.sustained = {};
		}
	}

	#realtime(status: number, now: number) {
		if (status === 0xf8) {
			this.#clockTimes.push(now);
			if (this.#clockTimes.length > PPQN + 1) this.#clockTimes.shift();
			this.#ticks++;
			if (this.#ticks % PPQN === 0) {
				this.beat++;
				this.beats.push(now);
				while (this.beats.length > 0 && this.beats[0] < now - HISTORY_MS) this.beats.shift();
				const times = this.#clockTimes;
				if (times.length > 2) {
					const perTick = (times[times.length - 1] - times[0]) / (times.length - 1);
					if (perTick > 0) this.bpm = Math.round((60000 / (perTick * PPQN)) * 10) / 10;
				}
			}
			this.clockActive = true;
			clearTimeout(this.#clockTimer);
			this.#clockTimer = setTimeout(() => {
				this.clockActive = false;
				this.bpm = null;
				this.#clockTimes = [];
			}, CLOCK_TIMEOUT_MS);
		} else if (status === 0xfa) {
			this.playing = true;
			this.#ticks = 0;
			this.beat = 0;
			this.beats.push(now);
		} else if (status === 0xfb) {
			this.playing = true;
		} else if (status === 0xfc) {
			this.playing = false;
		} else {
			return;
		}
		if (this.thru && this.thruClock && status !== 0xfb) midiStore.send([status]);
	}

	/** MIDI thru to the S-1, re-channelled to the S-1's channel. */
	#forward(type: number, data: Uint8Array) {
		if (!this.thru) return;
		const status = type | (midiStore.channel - 1);
		if (!midiStore.send([status, data[1], data[2]])) return;
		if (type === 0x90 && data[2] > 0) this.#thruNotes[data[1]] = true;
		else if (type === 0x80 || type === 0x90) delete this.#thruNotes[data[1]];
	}

	#releaseThruNotes() {
		for (const note of Object.keys(this.#thruNotes)) {
			midiStore.send([0x80 | (midiStore.channel - 1), Number(note), 0]);
		}
		this.#thruNotes = {};
	}
}

export const keystepStore = new KeystepStore();
