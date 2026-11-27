<script lang="ts">
	/**
	 * @file KeystepPanel.svelte
	 * @description KeyStep 37 mode: what the KeyStep sends, next to the S-1 drawing. Lights the
	 * held keys, names the chord, shows clock / arp / sequencer activity, highlights a key and
	 * scale, and can forward the KeyStep to the S-1 (MIDI thru in the browser).
	 */
	import { ChevronLeft, ChevronRight, Keyboard, Plug, Unplug } from '@lucide/svelte';
	import {
		KEY_NAMES,
		SCALES,
		noteLabel,
		pcName,
		pitchClass,
		readChord,
		scaleMask,
		usesFlats
	} from '#lib/music/theory.js';
	import { keystepStore } from '#lib/stores/keystep.svelte.js';
	import { midiStore } from '#lib/stores/midi.svelte.js';
	import ActivityRoll from './ActivityRoll.svelte';
	import KeyboardView from './KeyboardView.svelte';

	const KEYS = 37;
	const SETTINGS_KEY = 's1-keystep-v1';

	interface Settings {
		key: number;
		scale: string;
	}

	function loadSettings(): Settings {
		try {
			const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
			const key = typeof raw.key === 'number' && raw.key >= 0 && raw.key < 12 ? raw.key : 0;
			const scale = SCALES.find((s) => s.id === raw.scale)?.id ?? '';
			return { key: Math.floor(key), scale };
		} catch {
			return { key: 0, scale: '' };
		}
	}

	const saved = loadSettings();
	let keyPc = $state(saved.key);
	let scaleId = $state(saved.scale);
	let low = $state(48);

	const scale = $derived(SCALES.find((s) => s.id === scaleId) ?? null);
	const mask = $derived(scale ? scaleMask(keyPc, scale) : null);
	const flats = $derived(usesFlats(keyPc, scale));
	const sounding = $derived(keystepStore.sounding);
	const chord = $derived(readChord(sounding, flats));
	const outsideNotes = $derived(
		mask ? sounding.map(pitchClass).filter((pc, i, all) => all.indexOf(pc) === i && !mask[pc]) : []
	);
	const connected = $derived(keystepStore.status === 'connected');
	const s1Ready = $derived(midiStore.status === 'connected' && midiStore.outputReady);
	const sameAsS1 = $derived(
		connected && midiStore.status === 'connected' && keystepStore.inputId === midiStore.inputId
	);
	const scaleNotes = $derived(
		scale ? scale.intervals.map((i) => pcName(keyPc + i, flats)).join(' · ') : ''
	);

	$effect(() => {
		const settings: Settings = { key: keyPc, scale: scaleId };
		try {
			localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
		} catch {
			// not remembered
		}
	});

	// Follow the KeyStep's octave: shift the drawn keyboard when notes fall outside it.
	$effect(() => {
		const notes = sounding;
		if (notes.length === 0) return;
		const lowest = notes[0];
		const highest = notes[notes.length - 1];
		if (lowest < low) low = Math.floor(lowest / 12) * 12;
		else if (highest > low + KEYS - 1) low = Math.floor(highest / 12) * 12 - 24;
	});

	function shift(octaves: number) {
		low = Math.max(0, Math.min(127 - (KEYS - 1), low + octaves * 12));
	}
</script>

<section class="tool" aria-labelledby="keystep-title">
	<header class="tool__head">
		<h3 id="keystep-title">KeyStep 37</h3>
		<p>
			Play your Arturia KeyStep (or any MIDI keyboard) and see the keys, the chord name and its
			arpeggiator or sequencer next to the S-1. Pick a key and scale to light up its notes.
		</p>
	</header>

	<div class="bar">
		{#if connected}
			<div class="field">
				<label for="ks-input">KeyStep input</label>
				<select
					id="ks-input"
					value={keystepStore.inputId}
					onchange={(e) => keystepStore.selectInput(e.currentTarget.value)}
				>
					<option value="">Choose an input…</option>
					{#each keystepStore.inputs as port (port.id)}
						<option value={port.id} disabled={!port.connected}>
							{port.name}{port.connected ? '' : ' (disconnected)'}
						</option>
					{/each}
				</select>
			</div>
			<div class="field field--narrow">
				<label for="ks-channel">Channel</label>
				<select id="ks-channel" bind:value={keystepStore.channel}>
					<option value={0}>All</option>
					{#each Array.from({ length: 16 }, (_, i) => i + 1) as ch (ch)}
						<option value={ch}>{ch}</option>
					{/each}
				</select>
			</div>
			<button type="button" class="btn btn--small" onclick={() => keystepStore.disconnect()}>
				<Unplug size={13} /> Disconnect
			</button>
		{:else}
			<button
				type="button"
				class="btn btn--primary"
				onclick={() => keystepStore.connect()}
				disabled={keystepStore.status === 'requesting'}
			>
				<Plug size={14} />
				{keystepStore.status === 'requesting' ? 'Connecting…' : 'Connect KeyStep'}
			</button>
			<span class="bar__hint">Chrome or Edge. Plug the KeyStep in over USB first.</span>
		{/if}
	</div>
	{#if keystepStore.message}
		<p class="tool__status tool__status--error" role="alert">{keystepStore.message}</p>
	{/if}
	{#if connected && !keystepStore.inputId}
		<p class="tool__note">
			No KeyStep found. Plug it in over USB (it appears by itself) or choose its input above.
		</p>
	{:else if sameAsS1}
		<p class="tool__note">
			This is the same input as the S-1. Choose the KeyStep’s own input to see what it sends.
		</p>
	{/if}

	<div class="now" aria-live="polite">
		<div class="now__chord">
			<span class="now__label">Chord</span>
			<span class="now__name" class:now__name--quiet={chord.kind === 'none'}>
				{chord.kind === 'none' ? '–' : chord.name}
			</span>
			<span class="now__detail">
				{#if chord.kind === 'none'}
					Hold some keys
				{:else}
					{chord.detail}
				{/if}
			</span>
		</div>
		<div class="now__notes">
			<span class="now__label">Notes</span>
			<span class="now__list">
				{sounding.length ? sounding.map((n) => noteLabel(n, flats)).join('  ') : 'None'}
			</span>
			<span class="badges">
				{#if keystepStore.sustain}<span class="badge badge--on">Sustain</span>{/if}
				{#if outsideNotes.length}
					<span class="badge badge--warn">
						{outsideNotes.map((pc) => pcName(pc, flats)).join(', ')} not in {KEY_NAMES[keyPc]}
						{scale?.name.toLowerCase()}
					</span>
				{/if}
			</span>
		</div>
	</div>

	<div class="keys">
		<button
			type="button"
			class="keys__shift"
			aria-label="Octave down"
			onclick={() => shift(-1)}
			disabled={low <= 0}
		>
			<ChevronLeft size={16} />
		</button>
		<KeyboardView
			{low}
			count={KEYS}
			held={keystepStore.held}
			sustained={keystepStore.sustained}
			{mask}
			root={scale ? keyPc : null}
			{flats}
		/>
		<button
			type="button"
			class="keys__shift"
			aria-label="Octave up"
			onclick={() => shift(1)}
			disabled={low + KEYS - 1 >= 127}
		>
			<ChevronRight size={16} />
		</button>
	</div>

	<div class="meters">
		<span
			class="pill"
			class:pill--play={keystepStore.playing}
			class:pill--clock={keystepStore.clockActive}
		>
			<span class="pill__led" aria-hidden="true"></span>
			{#if keystepStore.playing}Playing{:else if keystepStore.clockActive}Clock, stopped{:else}No
				clock{/if}
		</span>
		<span class="meter__bpm">
			{keystepStore.bpm !== null ? `${keystepStore.bpm.toFixed(1)} BPM` : '– BPM'}
		</span>
		<span class="beats" aria-label="Beat {(keystepStore.beat % 4) + 1} of 4">
			{#each [0, 1, 2, 3] as b (b)}
				<span
					class="beat"
					class:beat--on={keystepStore.clockActive && keystepStore.beat % 4 === b}
					aria-hidden="true"
				></span>
			{/each}
		</span>
		<span class="meter" title="Pitch bend">
			<span class="meter__name">Pitch</span>
			<span class="meter__track meter__track--center">
				<span
					class="meter__fill meter__fill--bend"
					style="left: {50 + Math.min(0, keystepStore.pitchBend) * 50}%; inline-size: {Math.abs(
						keystepStore.pitchBend
					) * 50}%"
				></span>
			</span>
		</span>
		<span class="meter" title="Mod wheel">
			<span class="meter__name">Mod</span>
			<span class="meter__track">
				<span class="meter__fill" style="inline-size: {keystepStore.modWheel * 100}%"></span>
			</span>
		</span>
	</div>

	<ActivityRoll {low} count={KEYS} />

	<div class="panel">
		<h4 class="panel__title"><Keyboard size={14} /> Scale helper</h4>
		<div class="panel__row">
			<div class="field field--narrow">
				<label for="ks-key">Key</label>
				<select id="ks-key" bind:value={keyPc}>
					{#each KEY_NAMES as name, pc (pc)}
						<option value={pc}>{name}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for="ks-scale">Scale</label>
				<select id="ks-scale" bind:value={scaleId}>
					<option value="">Off</option>
					{#each SCALES as s (s.id)}
						<option value={s.id}>{s.name}</option>
					{/each}
				</select>
			</div>
			{#if scale}
				<p class="scale__notes">
					<span class="scale__dot" aria-hidden="true"></span>
					{KEY_NAMES[keyPc]}
					{scale.name.toLowerCase()}: <strong>{scaleNotes}</strong>
				</p>
			{/if}
		</div>
		<p class="tool__hint">
			Dots mark the scale (the ringed one is the root). Held keys outside it turn red.
		</p>
	</div>

	<div class="panel">
		<h4 class="panel__title">MIDI thru to the S-1</h4>
		<label class="check">
			<input
				type="checkbox"
				checked={keystepStore.thru}
				onchange={(e) => keystepStore.setThru(e.currentTarget.checked)}
				disabled={!connected}
			/>
			Play the S-1 from the KeyStep through this page (notes, bend, mod wheel, sustain, on channel
			{midiStore.channel})
		</label>
		<label class="check">
			<input
				type="checkbox"
				bind:checked={keystepStore.thruClock}
				disabled={!connected || !keystepStore.thru}
			/>
			Send its clock, start and stop too, so the S-1’s sequencer follows the KeyStep
		</label>
		{#if keystepStore.thru && !s1Ready}
			<p class="tool__status tool__status--error">
				Connect S-1 (above the drawing) so the page can send to it.
			</p>
		{/if}
		<p class="tool__hint">
			Only for setups without a cable from the KeyStep to the S-1; with both, every note plays
			twice. Following the clock also needs the S-1’s sync source to accept MIDI (Auto or USB).
		</p>
	</div>
</section>

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.5rem;
		margin-bottom: 0.8rem;
	}

	.bar__hint {
		align-self: center;
		font-size: 0.72rem;
		color: #64748b;
	}

	.field {
		display: grid;
		gap: 0.2rem;
		min-inline-size: 0;
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #64748b;
	}

	.field select {
		max-inline-size: 15rem;
		padding: 0.35rem 0.5rem;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: normal;
		text-transform: none;
		color: #e2e8f0;
		background: #0b0d11;
		border: 1px solid #334155;
		border-radius: 0.45rem;
	}

	.field--narrow select {
		max-inline-size: 6rem;
	}

	.now {
		display: grid;
		grid-template-columns: minmax(9rem, auto) 1fr;
		gap: 0.6rem;
		margin-bottom: 0.7rem;
	}

	.now__chord,
	.now__notes {
		display: grid;
		align-content: start;
		gap: 0.15rem;
		padding: 0.6rem 0.8rem;
		background: #0b0d11;
		border: 1px solid #2a2f3a;
		border-radius: 0.65rem;
	}

	.now__label {
		font-size: 0.64rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #64748b;
	}

	.now__name {
		font-size: 1.9rem;
		font-weight: 800;
		line-height: 1.1;
		color: #fdba74;
		text-shadow: 0 0 18px rgba(251, 146, 60, 0.35);
	}

	.now__name--quiet {
		color: #334155;
		text-shadow: none;
	}

	.now__detail {
		font-size: 0.72rem;
		color: #94a3b8;
	}

	.now__list {
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.86rem;
		color: #e2e8f0;
		white-space: pre-wrap;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.2rem;
	}

	.badge {
		padding: 0.12rem 0.45rem;
		font-size: 0.66rem;
		font-weight: 800;
		border-radius: 999px;
	}

	.badge--on {
		color: #ecfeff;
		background: rgba(8, 145, 178, 0.3);
		border: 1px solid #0e7490;
	}

	.badge--warn {
		color: #ffe4e6;
		background: rgba(225, 29, 72, 0.22);
		border: 1px solid #be123c;
	}

	.keys {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.35rem;
		padding: 0.6rem 0.4rem;
		background: linear-gradient(180deg, #16191f, #0e1014);
		border: 1px solid #262b36;
		border-radius: 0.75rem;
	}

	.keys__shift {
		display: grid;
		place-items: center;
		inline-size: 1.7rem;
		block-size: 3rem;
		margin: 0;
		padding: 0;
		color: #cbd5e1;
		background: #1a1e26;
		border: 1px solid #334155;
		border-radius: 0.45rem;
		cursor: pointer;
	}

	.keys__shift:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.meters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.9rem;
		margin: 0.7rem 0 0.5rem;
		font-size: 0.74rem;
		color: #94a3b8;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.2rem 0.6rem;
		font-weight: 800;
		color: #94a3b8;
		background: #13161c;
		border: 1px solid #2e3543;
		border-radius: 999px;
	}

	.pill__led {
		inline-size: 0.5rem;
		block-size: 0.5rem;
		background: #334155;
		border-radius: 999px;
	}

	.pill--clock .pill__led {
		background: #22d3ee;
	}

	.pill--play {
		color: #bbf7d0;
		border-color: rgba(74, 222, 128, 0.5);
	}

	.pill--play .pill__led {
		background: #4ade80;
		box-shadow: 0 0 8px rgba(74, 222, 128, 0.8);
	}

	.meter__bpm {
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-weight: 700;
		color: #e2e8f0;
	}

	.beats {
		display: inline-flex;
		gap: 0.3rem;
	}

	.beat {
		inline-size: 0.55rem;
		block-size: 0.55rem;
		background: #1e2430;
		border: 1px solid #334155;
		border-radius: 999px;
	}

	.beat--on {
		background: #22d3ee;
		border-color: #a5f3fc;
		box-shadow: 0 0 8px rgba(34, 211, 238, 0.7);
	}

	.meter {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.meter__name {
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #64748b;
	}

	.meter__track {
		position: relative;
		inline-size: 4.5rem;
		block-size: 6px;
		overflow: hidden;
		background: #1e2430;
		border-radius: 999px;
	}

	.meter__track--center::after {
		content: '';
		position: absolute;
		inset-block: 0;
		left: 50%;
		inline-size: 1px;
		background: #475569;
	}

	.meter__fill {
		position: absolute;
		inset-block: 0;
		left: 0;
		background: #fb923c;
		border-radius: inherit;
	}

	.meter__fill--bend {
		background: #22d3ee;
	}

	.panel {
		margin-top: 0.8rem;
		padding: 0.7rem 0.8rem;
		background: #0b0d11;
		border: 1px solid #2a2f3a;
		border-radius: 0.7rem;
	}

	.panel__title {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0 0 0.55rem;
		font-size: 0.82rem;
		font-weight: 800;
		color: #f1f5f9;
	}

	.panel__row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.6rem;
	}

	.scale__notes {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		font-size: 0.78rem;
		color: #94a3b8;
	}

	.scale__notes strong {
		color: #a5f3fc;
	}

	.scale__dot {
		inline-size: 0.6rem;
		block-size: 0.6rem;
		background: #22d3ee;
		border-radius: 999px;
	}

	.check {
		display: flex;
		align-items: flex-start;
		gap: 0.45rem;
		margin: 0 0 0.4rem;
		font-size: 0.78rem;
		line-height: 1.45;
		color: #cbd5e1;
		cursor: pointer;
	}

	.check input {
		margin-top: 0.2rem;
		accent-color: #ea580c;
	}

	.panel :global(.tool__hint),
	.panel :global(.tool__status) {
		margin: 0.4rem 0 0;
	}

	@container studio (max-width: 520px) {
		.now {
			grid-template-columns: 1fr;
		}
	}
</style>
