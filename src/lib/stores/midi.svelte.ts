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
	/** Faceplate control IDs currently lit by MIDI activity. */
	flashing = $state<Record<string, boolean>>({});

	#access: MIDIAccess | null = null;
	#boundInput: MIDIInput | null = null;
	#flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

	get isConnected(): boolean {
		return this.status === 'connected';
	}

	get inputReady(): boolean {
		return this.inputs.some((p) => p.id === this.inputId && p.connected);
	}

	get outputReady(): boolean {
		return this.outputs.some((p) => p.id === this.outputId && p.connected);
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
		this.flashing = {};
	}

	selectInput(id: string) {
		this.inputId = id;
		this.#bindInput();
	}

	selectOutput(id: string) {
		this.outputId = id;
	}

	/** Sends a Control Change on the selected channel. Returns false (and sends nothing) unless connected. */
	sendCC(cc: number, value: number): boolean {
		if (this.status !== 'connected' || !this.#access) return false;
		const output = this.#access.outputs.get(this.outputId);
		if (!output || output.state !== 'connected') return false;
		const data = Math.max(0, Math.min(127, Math.round(value)));
		output.send([0xb0 | (this.channel - 1), cc & 0x7f, data]);
		this.#record('out', cc, data);
		return true;
	}

	#record(direction: MidiEvent['direction'], cc: number, value: number) {
		this.values[cc] = value;
		const entry = CC_BY_NUMBER.get(cc);
		this.lastEvent = {
			direction,
			cc,
			value,
			parameter: entry?.parameter ?? 'not in the S-1 CC list'
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

	#handleMessage = (event: MIDIMessageEvent) => {
		const data = event.data;
		if (!data || data.length < 3) return;
		const isControlChange = (data[0] & 0xf0) === 0xb0;
		if (!isControlChange || (data[0] & 0x0f) !== this.channel - 1) return;
		this.#record('in', data[1], data[2]);
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
