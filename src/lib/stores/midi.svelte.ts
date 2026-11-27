/**
 * @file midi.svelte.ts
 * @description Opt-in Web MIDI connection to a Roland S-1.
 *
 * Nothing touches the Web MIDI API until `connect()` runs from a user click, and nothing is
 * sent until the user is connected and an output port is selected. SysEx is never requested
 * (the S-1's MIDI implementation chart lists no System Exclusive messages).
 */
import { CC_BY_NUMBER, DEFAULT_MIDI_CHANNEL } from '#lib/midi.js';

export type MidiStatus = 'idle' | 'unsupported' | 'requesting' | 'denied' | 'error' | 'connected';

export interface MidiPortInfo {
	id: string;
	name: string;
	connected: boolean;
}

export interface MidiEvent {
	direction: 'in' | 'out';
	cc: number;
	value: number;
	parameter: string;
	/** Faceplate controls the CC belongs to (empty for standard controllers). */
	controls: string[];
	/** true for SHIFT + knob parameters (the knob's second layer). */
	shiftLayer: boolean;
}

/**
 * An incoming message that isn't a control change. Lessons use these to advance a step.
 * Note Off is not included: the chart says the S-1 does not transmit it. Clock and
 * Active Sensing are ignored because they run on their own.
 */
export interface InputNotice {
	kind: 'note' | 'program' | 'start' | 'stop';
	/** Increments on every notice so a repeated note still counts as a new event. */
	seq: number;
	note?: number;
	velocity?: number;
	/** Program number 0–127 as received. The chart's true range for the S-1 is 0–63. */
	program?: number;
}

export interface ParameterValue {
	cc: number;
	parameter: string;
	value: number;
}

const S1_PORT_NAME = /\bS-1\b/i;
const FLASH_MS = 700;

const UNSUPPORTED_MESSAGE =
	'This browser can’t talk to MIDI devices (Safari and Firefox aren’t supported). Open this page in Chrome or Edge on a desktop computer to connect your S-1.';

function browserNote(): string | null {
	if (typeof navigator === 'undefined') return null;
	if (/firefox|fxios/i.test(navigator.userAgent)) {
		return 'Firefox only allows Web MIDI through a site-permission add-on. Chrome or Edge on a desktop computer is needed for a reliable connection.';
	}
	return null;
}

class MidiStore {
	status = $state<MidiStatus>('idle');
	message = $state('');
	note = $state<string | null>(null);
	inputs = $state<MidiPortInfo[]>([]);
	outputs = $state<MidiPortInfo[]>([]);
	inputId = $state('');
	outputId = $state('');
	channel = $state(DEFAULT_MIDI_CHANNEL);
	/** Last known value per CC number (unknown until sent or received). */
	values = $state<Record<number, number>>({});
	lastEvent = $state<MidiEvent | null>(null);
	/** Latest incoming note, program change, or start/stop. Null until one arrives. */
	inputNotice = $state<InputNotice | null>(null);
	/** Faceplate control IDs currently lit by MIDI activity. */
	flashing = $state<Record<string, boolean>>({});

	#access: MIDIAccess | null = null;
	#boundInput: MIDIInput | null = null;
	#flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
	#noticeSeq = 0;

	get isConnected(): boolean {
		return this.status === 'connected';
	}

	get inputReady(): boolean {
		return this.inputs.some((p) => p.id === this.inputId && p.connected);
	}

	get outputReady(): boolean {
		return this.outputs.some((p) => p.id === this.outputId && p.connected);
	}

	/**
	 * Live parameter state: every CC value sent or received since connecting (the S-1 has no
	 * SysEx/dump, so values are only known once a control has moved).
	 */
	get parameterState(): ParameterValue[] {
		return Object.entries(this.values)
			.map(([cc, value]) => ({
				cc: Number(cc),
				parameter: CC_BY_NUMBER.get(Number(cc))?.parameter ?? `CC ${cc}`,
				value
			}))
			.sort((a, b) => a.cc - b.cc);
	}

	async connect() {
		if (this.status === 'requesting' || this.status === 'connected') return;
		this.note = browserNote();

		if (
			typeof navigator === 'undefined' ||
			!('requestMIDIAccess' in navigator) ||
			!window.isSecureContext
		) {
			this.status = 'unsupported';
			this.message = UNSUPPORTED_MESSAGE;
			return;
		}

		this.status = 'requesting';
		this.message = 'Waiting for MIDI permission…';
		try {
			const access = await navigator.requestMIDIAccess({ sysex: false });
			this.#access = access;
			access.onstatechange = () => this.#syncPorts();
			this.status = 'connected';
			this.message = '';
			this.#syncPorts();
		} catch (err) {
			const name = err instanceof DOMException ? err.name : '';
			if (name === 'NotAllowedError' || name === 'SecurityError') {
				this.status = 'denied';
				this.message =
					'MIDI access was blocked. Allow MIDI devices for this site in your browser’s site settings (the icon left of the address bar), then press Connect S-1 again.';
			} else {
				this.status = 'error';
				this.message = `Couldn’t open MIDI: ${err instanceof Error ? err.message : String(err)}`;
			}
		}
	}

	disconnect() {
		this.#unbindInput();
		if (this.#access) this.#access.onstatechange = null;
		this.#access = null;
		for (const timer of this.#flashTimers.values()) clearTimeout(timer);
		this.#flashTimers.clear();
		this.status = 'idle';
		this.message = '';
		this.note = null;
		this.inputs = [];
		this.outputs = [];
		this.inputId = '';
		this.outputId = '';
		this.values = {};
		this.lastEvent = null;
		this.inputNotice = null;
		this.flashing = {};
	}

	selectInput(id: string) {
		this.inputId = id;
		this.#bindInput();
	}

	selectOutput(id: string) {
		this.outputId = id;
	}

	#output(): MIDIOutput | null {
		if (this.status !== 'connected' || !this.#access) return null;
		const output = this.#access.outputs.get(this.outputId);
		return output && output.state === 'connected' ? output : null;
	}

	/** Sends a Control Change on the selected channel. Returns false (and sends nothing) unless connected. */
	sendCC(cc: number, value: number): boolean {
		const output = this.#output();
		if (!output) return false;
		const data = Math.max(0, Math.min(127, Math.round(value)));
		output.send([0xb0 | (this.channel - 1), cc & 0x7f, data]);
		this.#record('out', cc, data);
		return true;
	}

	/**
	 * Sends several CCs with Web MIDI timestamps `spacingMs` apart (patch recall), so the S-1's
	 * input isn't flooded. Returns how many were sent (0 unless connected).
	 */
	sendControlChanges(messages: [number, number][], spacingMs = 3): number {
		const output = this.#output();
		if (!output || messages.length === 0) return 0;
		const status = 0xb0 | (this.channel - 1);
		const start = performance.now();
		messages.forEach(([cc, value], i) => {
			const data = Math.max(0, Math.min(127, Math.round(value)));
			output.send([status, cc & 0x7f, data], start + i * spacingMs);
			this.values[cc] = data;
		});
		const [lastCc, lastValue] = messages[messages.length - 1];
		this.#record('out', lastCc, lastValue);
		return messages.length;
	}

	/**
	 * Sends raw MIDI bytes to the S-1 output (notes, clock…), optionally at a Web MIDI timestamp.
	 * Channel-voice status bytes should use `this.channel`. Returns false unless connected.
	 */
	send(bytes: number[], timestamp?: number): boolean {
		const output = this.#output();
		if (!output) return false;
		if (timestamp === undefined) output.send(bytes);
		else output.send(bytes, timestamp);
		return true;
	}

	#record(direction: MidiEvent['direction'], cc: number, value: number) {
		this.values[cc] = value;
		const entry = CC_BY_NUMBER.get(cc);
		this.lastEvent = {
			direction,
			cc,
			value,
			parameter: entry?.parameter ?? 'not in the S-1 CC list',
			controls: entry?.controls ?? [],
			shiftLayer: entry?.layer === 'shift-knob'
		};
		for (const id of entry?.controls ?? []) this.#flash(id);
	}

	#syncPorts() {
		const access = this.#access;
		if (!access) return;
		const toInfo = (port: MIDIPort): MidiPortInfo => ({
			id: port.id,
			name: port.name ?? port.id,
			connected: port.state === 'connected'
		});
		this.inputs = [...access.inputs.values()].map(toInfo);
		this.outputs = [...access.outputs.values()].map(toInfo);
		// Auto-select only a port that looks like the S-1; never pick another device on its own.
		if (!this.inputs.some((p) => p.id === this.inputId)) {
			this.inputId = this.inputs.find((p) => S1_PORT_NAME.test(p.name))?.id ?? '';
		}
		if (!this.outputs.some((p) => p.id === this.outputId)) {
			this.outputId = this.outputs.find((p) => S1_PORT_NAME.test(p.name))?.id ?? '';
		}
		this.#bindInput();
	}

	#bindInput() {
		const input = this.#access?.inputs.get(this.inputId) ?? null;
		const usable = input && input.state === 'connected' ? input : null;
		if (usable === this.#boundInput) return;
		this.#unbindInput();
		if (usable) {
			usable.onmidimessage = this.#handleMessage;
			this.#boundInput = usable;
		}
	}

	#unbindInput() {
		if (this.#boundInput) {
			this.#boundInput.onmidimessage = null;
			this.#boundInput = null;
		}
	}

	#notice(partial: Omit<InputNotice, 'seq'>) {
		this.inputNotice = { ...partial, seq: ++this.#noticeSeq };
	}

	#handleMessage = (event: MIDIMessageEvent) => {
		const data = event.data;
		if (!data || data.length < 1) return;
		const status = data[0];
		// System real-time has no channel. Continue (0xFB) is not transmitted.
		// Clock (0xF8) and Active Sensing (0xFE) run by themselves, so they aren't lessons.
		if (status === 0xfa) {
			this.#notice({ kind: 'start' });
			return;
		}
		if (status === 0xfc) {
			this.#notice({ kind: 'stop' });
			return;
		}
		if (status >= 0xf8) return;
		if (data.length < 2) return;
		const type = status & 0xf0;
		// Program change uses its own channel (menu: Pc.Ch, default 16), not the synth channel.
		if (type === 0xc0) {
			this.#notice({ kind: 'program', program: data[1] });
			return;
		}
		if ((status & 0x0f) !== this.channel - 1 || data.length < 3) return;
		// Note On with velocity 0 is a note-off. The chart doesn't transmit Note Off either way.
		if (type === 0x90 && data[2] > 0) {
			this.#notice({ kind: 'note', note: data[1], velocity: data[2] });
			return;
		}
		if (type === 0xb0) this.#record('in', data[1], data[2]);
	};

	#flash(id: string) {
		this.flashing[id] = true;
		clearTimeout(this.#flashTimers.get(id));
		this.#flashTimers.set(
			id,
			setTimeout(() => {
				delete this.flashing[id];
				this.#flashTimers.delete(id);
			}, FLASH_MS)
		);
	}
}

export const midiStore = new MidiStore();
