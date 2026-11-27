<script lang="ts">
	/**
	 * @file MidiPanel.svelte
	 * @description Opt-in "Connect S-1" controls: permission request, port + channel pickers,
	 * status / browser notes and the last MIDI message. Nothing is requested or sent until the
	 * user presses Connect S-1.
	 */
	import { Cable, Unplug } from '@lucide/svelte';
	import { DEFAULT_MIDI_CHANNEL } from '#lib/midi.js';
	import { midiStore } from '#lib/stores/midi.svelte.js';

	const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);
	const connected = $derived(midiStore.status === 'connected');

	const portStatus = $derived.by(() => {
		if (!connected) return '';
		if (midiStore.outputs.length === 0 && midiStore.inputs.length === 0) {
			return 'No MIDI devices found. Connect the S-1 by USB and turn it on.';
		}
		if (!midiStore.outputId || !midiStore.inputId) {
			return 'Pick the S-1 ports below (no port named “S-1” was found automatically).';
		}
		if (!midiStore.outputReady || !midiStore.inputReady) {
			return 'The S-1 is disconnected. Reconnect the USB cable; it will resume automatically.';
		}
		return '';
	});
</script>

<div class="midi-panel" class:midi-panel--open={midiStore.status !== 'idle'}>
	<div class="midi-panel__row">
		{#if connected}
			<button type="button" class="midi-btn midi-btn--on" onclick={() => midiStore.disconnect()}>
				<Unplug size={14} />
				<span>Disconnect</span>
			</button>
			<span
				class="midi-dot"
				class:midi-dot--live={midiStore.outputReady && midiStore.inputReady}
				aria-hidden="true"
			></span>
			<label class="midi-field">
				<span>In</span>
				<select
					value={midiStore.inputId}
					onchange={(e) => midiStore.selectInput(e.currentTarget.value)}
				>
					<option value="">— none —</option>
					{#each midiStore.inputs as port (port.id)}
						<option value={port.id}>{port.name}{port.connected ? '' : ' (disconnected)'}</option>
					{/each}
				</select>
			</label>
			<label class="midi-field">
				<span>Out</span>
				<select
					value={midiStore.outputId}
					onchange={(e) => midiStore.selectOutput(e.currentTarget.value)}
				>
					<option value="">— none —</option>
					{#each midiStore.outputs as port (port.id)}
						<option value={port.id}>{port.name}{port.connected ? '' : ' (disconnected)'}</option>
					{/each}
				</select>
			</label>
			<label class="midi-field">
				<span>Ch</span>
				<select bind:value={midiStore.channel}>
					{#each CHANNELS as ch (ch)}
						<option value={ch}>{ch}{ch === DEFAULT_MIDI_CHANNEL ? ' (S-1 default)' : ''}</option>
					{/each}
				</select>
			</label>
		{:else}
			<button
				type="button"
				class="midi-btn"
				disabled={midiStore.status === 'requesting'}
				onclick={() => midiStore.connect()}
				title="Control a Roland S-1 over USB MIDI (Chrome or Edge on desktop)"
			>
				<Cable size={14} />
				<span>{midiStore.status === 'requesting' ? 'Connecting…' : 'Connect S-1'}</span>
			</button>
		{/if}
	</div>

	{#if midiStore.message}
		<p class="midi-msg" class:midi-msg--warn={midiStore.status !== 'requesting'} role="status">
			{midiStore.message}
		</p>
	{/if}
	{#if midiStore.note}
		<p class="midi-msg midi-msg--warn">{midiStore.note}</p>
	{/if}

	{#if connected}
		{#if portStatus}
			<p class="midi-msg midi-msg--warn" role="status">{portStatus}</p>
		{/if}
		<p class="midi-legend">
			Drag a knob up/down (or focus it and press ↑/↓) to send its CC. Knobs you turn on the S-1
			rotate and light up on the drawing. <span class="midi-legend__hatch">Hatched</span> controls are
			not controllable over MIDI (no CC in the S-1's MIDI implementation). Values stay unknown until a
			control moves.
		</p>
		<p class="midi-legend">
			<strong>Mirroring knobs from the S-1:</strong> the S-1 always sends its knob moves as CC on
			its MIDI channel. Its menu has no separate CC-transmit switch, so just make sure Ch here
			matches the S-1's channel: <kbd>SHIFT</kbd> + pad 15 (MENU) → <code>CH</code> (default 3).
		</p>
		<p class="midi-event" aria-live="polite">
			{#if midiStore.lastEvent}
				<span class="midi-event__dir">Last touched</span>
				{midiStore.lastEvent.parameter} = {midiStore.lastEvent.value} · CC {midiStore.lastEvent.cc}
				({midiStore.lastEvent.direction === 'in' ? 'from S-1' : 'from screen'})
			{:else}
				Last touched: nothing yet. Turn a knob on the S-1.
			{/if}
		</p>
	{/if}
</div>

<style>
	.midi-panel {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.midi-panel--open {
		padding: 0.5rem 0.6rem;
		background: #0b0d11;
		border: 1px solid #1f3b45;
		border-radius: 0.55rem;
	}

	.midi-panel__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem 0.6rem;
	}

	.midi-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.7rem;
		font-size: 0.72rem;
		font-weight: 700;
		color: #a5f3fc;
		background: rgba(8, 145, 178, 0.12);
		border: 1px solid #0e7490;
		border-radius: 999px;
		cursor: pointer;
		margin: 0;
	}

	.midi-btn:hover:not(:disabled) {
		color: #ecfeff;
		border-color: #22d3ee;
	}

	.midi-btn:disabled {
		opacity: 0.6;
		cursor: progress;
	}

	.midi-btn--on {
		color: #e2e8f0;
		background: #1a1e26;
		border-color: #334155;
	}

	.midi-dot {
		inline-size: 0.55rem;
		block-size: 0.55rem;
		border-radius: 50%;
		background: #64748b;
	}

	.midi-dot--live {
		background: #22d3ee;
		box-shadow: 0 0 6px #22d3ee;
	}

	.midi-field {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.7rem;
		font-weight: 700;
		color: #94a3b8;
	}

	.midi-field select {
		max-inline-size: 11rem;
		padding: 0.2rem 0.35rem;
		font-size: 0.72rem;
		color: #e2e8f0;
		background: #171b22;
		border: 1px solid #334155;
		border-radius: 0.35rem;
	}

	.midi-msg,
	.midi-legend,
	.midi-event {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.45;
		color: #94a3b8;
	}

	.midi-msg--warn {
		color: #fcd34d;
	}

	.midi-legend__hatch {
		padding: 0 0.25rem;
		color: #e2e8f0;
		background: repeating-linear-gradient(
			45deg,
			rgba(148, 163, 184, 0.35) 0 3px,
			transparent 3px 7px
		);
		border-radius: 0.2rem;
	}

	.midi-event {
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		color: #a5f3fc;
	}

	.midi-event__dir {
		font-weight: 800;
		color: #22d3ee;
	}

	.midi-legend strong {
		color: #cbd5e1;
	}

	.midi-legend kbd,
	.midi-legend code {
		padding: 0 0.25rem;
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.68rem;
		color: #e2e8f0;
		background: #171b22;
		border: 1px solid #334155;
		border-radius: 0.25rem;
	}

	@media (pointer: coarse) {
		.midi-btn,
		.midi-field select {
			min-block-size: 2.25rem;
		}
	}
</style>
