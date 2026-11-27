<script lang="ts">
	/**
	 * @file SequencerPanel.svelte
	 * @description Browser step sequencer for the S-1: note grid, velocity / gate / parameter-lock
	 * lanes, step editor, transport (internal or external MIDI clock), pattern library in
	 * localStorage and MIDI-file export.
	 */
	import {
		ChevronDown,
		ChevronUp,
		Download,
		FilePlus2,
		Music,
		Play,
		Save,
		Square,
		Trash2,
		X
	} from '@lucide/svelte';
	import {
		LENGTHS,
		LOCKABLE_CCS,
		STEPS_PER_PAGE,
		blankPattern,
		demoPattern,
		laneLabel,
		patternToMidiFile
	} from '#lib/sequencer.js';
	import { noteLabel } from '#lib/music/theory.js';
	import { midiStore } from '#lib/stores/midi.svelte.js';
	import { sequencerStore as seq } from '#lib/stores/sequencer.svelte.js';
	import StepGrid from './StepGrid.svelte';
	import ValueLane from './ValueLane.svelte';

	let page = $state(0);
	let low = $state(36);
	let selected = $state(0);
	let follow = $state(true);
	let nameDraft = $state(seq.pattern.name);
	let status = $state('');

	const pattern = $derived(seq.pattern);
	const pages = $derived(pattern.length / STEPS_PER_PAGE);
	const step = $derived(pattern.steps[selected]);
	const connected = $derived(midiStore.status === 'connected' && midiStore.outputReady);
	const running = $derived(seq.playing || seq.waiting);
	const LANE_TONES = ['cyan', 'violet'] as const;

	// Follow the playhead across pages.
	$effect(() => {
		const head = seq.playhead;
		if (follow && head >= 0) page = Math.floor(head / STEPS_PER_PAGE);
	});

	// Keep the page and selection inside the pattern when its length changes.
	$effect(() => {
		if (page >= pages) page = pages - 1;
		if (selected >= pattern.length) selected = pattern.length - 1;
	});

	// Stop playing when the sequencer is closed.
	$effect(() => () => seq.stop());

	function shiftOctave(octaves: number) {
		low = Math.max(0, Math.min(104, low + octaves * 12));
	}

	function preview() {
		const s = pattern.steps[selected];
		const ch = midiStore.channel - 1;
		const now = performance.now();
		const length = (60000 / pattern.bpm / 4) * s.gate;
		for (const lane of pattern.lanes) {
			const v = s.locks[String(lane.cc)];
			if (v !== undefined) midiStore.send([0xb0 | ch, lane.cc, v], now);
		}
		for (const note of s.notes) {
			midiStore.send([0x90 | ch, note, s.velocity], now + 1);
			midiStore.send([0x80 | ch, note, 0], now + 1 + length);
		}
	}

	function savePattern(asNew: boolean) {
		const saved = seq.save(nameDraft, asNew);
		nameDraft = saved.name;
		status = `Saved “${saved.name}” (${saved.length} steps).`;
	}

	function newPattern() {
		seq.replace(blankPattern());
		nameDraft = seq.pattern.name;
		status = 'Started a blank pattern.';
	}

	function loadDemo() {
		seq.replace(demoPattern());
		nameDraft = seq.pattern.name;
		status = 'Loaded the demo bassline.';
	}

	function load(id: string) {
		seq.load(id);
		nameDraft = seq.pattern.name;
		status = `Loaded “${seq.pattern.name}”.`;
	}

	function exportMidi() {
		const bytes = patternToMidiFile($state.snapshot(seq.pattern), 1);
		const blob = new Blob([bytes], { type: 'audio/midi' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${pattern.name.replace(/[^\w\- ]+/g, '').trim() || 'pattern'}.mid`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		status = `Exported “${a.download}” (${pattern.length} steps at ${pattern.bpm} BPM, MIDI channel 1).`;
	}

	const formatDate = (t: number) =>
		new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
</script>

<section class="tool" aria-labelledby="seq-title">
	<header class="tool__head">
		<h3 id="seq-title">Step sequencer</h3>
		<p>
			Program a pattern here and play it on the S-1: notes, velocity, gate and parameter locks (a
			knob value on a single step). The S-1 can’t send or receive its own patterns over MIDI (its
			MIDI chart has no SysEx, Song Position or Song Select), so this sequencer runs in the browser
			and plays the S-1 live.
		</p>
	</header>

	<div class="transport">
		<button
			type="button"
			class="btn transport__play"
			class:btn--accent={!running}
			class:btn--primary={running}
			onclick={() => (running ? seq.stop() : seq.play())}
		>
			{#if running}<Square size={14} /> Stop{:else}<Play size={14} />
				{seq.clockSource === 'external' ? 'Follow clock' : 'Play'}{/if}
		</button>
		<span class="transport__status" role="status">
			{#if seq.playing}
				Step {seq.playhead + 1} / {pattern.length}
			{:else if seq.waiting}
				{seq.externalClock ? 'Clock running: start it on the clock source' : 'Waiting for Start…'}
			{:else}
				Stopped
			{/if}
		</span>
		<label class="field field--num">
			<span>BPM</span>
			<input
				type="number"
				min="40"
				max="240"
				step="0.5"
				value={pattern.bpm}
				disabled={seq.clockSource === 'external'}
				onchange={(e) => {
					const v = Number(e.currentTarget.value);
					if (v >= 40 && v <= 240) seq.setMeta({ bpm: v });
					else e.currentTarget.value = String(pattern.bpm);
				}}
			/>
		</label>
		<label class="field field--range">
			<span>Swing {Math.round(pattern.swing * 100)}%</span>
			<input
				type="range"
				min="0"
				max="100"
				value={Math.round(pattern.swing * 100)}
				oninput={(e) => seq.setMeta({ swing: Number(e.currentTarget.value) / 100 })}
			/>
		</label>
		<label class="field">
			<span>Length</span>
			<select
				value={pattern.length}
				onchange={(e) => seq.setMeta({ length: Number(e.currentTarget.value) })}
			>
				{#each LENGTHS as n (n)}
					<option value={n}>{n} steps</option>
				{/each}
			</select>
		</label>
	</div>

	<div class="clock">
		<div class="seg" role="group" aria-label="Clock source">
			<button
				type="button"
				class="seg__btn"
				aria-pressed={seq.clockSource === 'internal'}
				onclick={() => seq.setClockSource('internal')}>Internal clock</button
			>
			<button
				type="button"
				class="seg__btn"
				aria-pressed={seq.clockSource === 'external'}
				onclick={() => seq.setClockSource('external')}>External clock</button
			>
		</div>
		{#if seq.clockSource === 'internal'}
			<label class="check">
				<input type="checkbox" bind:checked={seq.sendClock} disabled={running} />
				Send MIDI clock and start/stop to the S-1 (its delay, arp and LFO sync follow)
			</label>
		{:else}
			<label class="field">
				<span>Clock from</span>
				<select
					value={seq.externalInputId}
					onchange={(e) => seq.selectExternalInput(e.currentTarget.value)}
				>
					<option value="">Choose an input…</option>
					{#each seq.externalInputs as port (port.id)}
						<option value={port.id} disabled={!port.connected}>{port.name}</option>
					{/each}
				</select>
			</label>
			<span class="clock__led" class:clock__led--on={seq.externalClock}>
				{seq.externalClock ? 'Receiving clock' : 'No clock'}
			</span>
		{/if}
	</div>
	{#if seq.message}<p class="tool__status tool__status--error" role="alert">{seq.message}</p>{/if}
	{#if !connected}
		<p class="tool__note">Connect S-1 (above the drawing) to hear the pattern.</p>
	{/if}

	<div class="nav">
		<div class="seg" role="group" aria-label="Page">
			{#each Array.from({ length: pages }, (_, i) => i) as p (p)}
				<button
					type="button"
					class="seg__btn"
					aria-pressed={page === p}
					onclick={() => {
						page = p;
						follow = false;
					}}
				>
					{p * STEPS_PER_PAGE + 1}–{(p + 1) * STEPS_PER_PAGE}
					{#if seq.playing && Math.floor(seq.playhead / STEPS_PER_PAGE) === p}<span
							class="seg__live"
							aria-hidden="true"
						></span>{/if}
				</button>
			{/each}
		</div>
		{#if pages > 1}
			<label class="check check--inline">
				<input type="checkbox" bind:checked={follow} /> Follow playback
			</label>
		{/if}
		<span class="nav__gap"></span>
		<span class="nav__range">{noteLabel(low)}–{noteLabel(low + 23)}</span>
		<button
			type="button"
			class="btn btn--small"
			aria-label="Show notes an octave lower"
			onclick={() => shiftOctave(-1)}
		>
			<ChevronDown size={14} />
		</button>
		<button
			type="button"
			class="btn btn--small"
			aria-label="Show notes an octave higher"
			onclick={() => shiftOctave(1)}
		>
			<ChevronUp size={14} />
		</button>
	</div>

	<StepGrid
		steps={pattern.steps}
		{page}
		{low}
		playhead={seq.playhead}
		{selected}
		length={pattern.length}
		ontoggle={(s, note) => seq.toggleNote(s, note)}
		onselect={(s) => (selected = s)}
	/>

	<ValueLane
		label="Velocity"
		{page}
		length={pattern.length}
		max={127}
		value={(s) => (pattern.steps[s].notes.length ? pattern.steps[s].velocity : null)}
		playhead={seq.playhead}
		{selected}
		onset={(s, v) => seq.setVelocity(s, v)}
	/>
	<ValueLane
		label="Gate"
		{page}
		length={pattern.length}
		max={1}
		value={(s) => (pattern.steps[s].notes.length ? pattern.steps[s].gate : null)}
		playhead={seq.playhead}
		{selected}
		onset={(s, v) => seq.setGate(s, v)}
	/>
	{#each pattern.lanes as lane, i (i)}
		<ValueLane
			label="{laneLabel(lane.cc)} lock"
			{page}
			length={pattern.length}
			max={127}
			base={lane.base}
			value={(s) => pattern.steps[s].locks[String(lane.cc)] ?? null}
			playhead={seq.playhead}
			{selected}
			tone={LANE_TONES[i % LANE_TONES.length]}
			onset={(s, v) => seq.setLock(s, lane.cc, v)}
			onclear={(s) => seq.setLock(s, lane.cc, null)}
		/>
	{/each}
	<p class="tool__hint">
		Click the grid to add or remove notes (arrow keys and Space work too). Drag across a lane to
		draw; double-click or Alt-click a lock to remove it. Steps without a lock send the lane’s base
		value (dashed), and only lanes with at least one lock send anything.
	</p>

	<div class="editor">
		<div class="editor__col">
			<h4 class="editor__title">Step {selected + 1}</h4>
			<div class="chips">
				{#each step.notes as note (note)}
					<span class="chip">
						{noteLabel(note)}
						<button
							type="button"
							class="chip__x"
							aria-label="Remove {noteLabel(note)} from step {selected + 1}"
							onclick={() => seq.removeNote(selected, note)}><X size={11} /></button
						>
					</span>
				{:else}
					<span class="chip chip--rest">Rest</span>
				{/each}
			</div>
			<label class="field field--range">
				<span>Velocity {step.velocity}</span>
				<input
					type="range"
					min="1"
					max="127"
					value={step.velocity}
					oninput={(e) => seq.setVelocity(selected, Number(e.currentTarget.value))}
				/>
			</label>
			<label class="field field--range">
				<span>Gate {Math.round(step.gate * 100)}%</span>
				<input
					type="range"
					min="10"
					max="100"
					value={Math.round(step.gate * 100)}
					oninput={(e) => seq.setGate(selected, Number(e.currentTarget.value) / 100)}
				/>
			</label>
			<button
				type="button"
				class="btn btn--small"
				onclick={preview}
				disabled={!connected || step.notes.length === 0}
			>
				<Music size={13} /> Preview step
			</button>
		</div>
		<div class="editor__col">
			{#each pattern.lanes as lane, i (i)}
				{@const lock = step.locks[String(lane.cc)]}
				<div class="lock">
					<div class="lock__head">
						<label class="field">
							<span>Lane {i + 1}</span>
							<select
								value={lane.cc}
								onchange={(e) => seq.setLaneCc(i, Number(e.currentTarget.value))}
							>
								{#each LOCKABLE_CCS as cc (cc)}
									<option
										value={cc}
										disabled={cc !== lane.cc && pattern.lanes.some((l) => l.cc === cc)}
									>
										{laneLabel(cc)} (CC {cc})
									</option>
								{/each}
							</select>
						</label>
						<label class="field field--num">
							<span>Base</span>
							<input
								type="number"
								min="0"
								max="127"
								value={lane.base}
								onchange={(e) => seq.setLaneBase(i, Number(e.currentTarget.value))}
							/>
						</label>
					</div>
					{#if lock !== undefined}
						<label class="field field--range">
							<span>Step {selected + 1} lock: {lock}</span>
							<input
								type="range"
								min="0"
								max="127"
								value={lock}
								oninput={(e) => seq.setLock(selected, lane.cc, Number(e.currentTarget.value))}
							/>
						</label>
						<button
							type="button"
							class="btn btn--small"
							onclick={() => seq.setLock(selected, lane.cc, null)}>Remove lock</button
						>
					{:else}
						<button
							type="button"
							class="btn btn--small"
							onclick={() => seq.setLock(selected, lane.cc, lane.base)}
							>Lock {laneLabel(lane.cc)} on step {selected + 1}</button
						>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<div class="library">
		<div class="library__bar">
			<label class="field field--grow">
				<span>Pattern name</span>
				<input
					type="text"
					maxlength="60"
					bind:value={nameDraft}
					onchange={() => seq.setMeta({ name: nameDraft.trim() || pattern.name })}
				/>
			</label>
			<button type="button" class="btn btn--accent" onclick={() => savePattern(false)}>
				<Save size={14} /> Save
			</button>
			<button type="button" class="btn" onclick={() => savePattern(true)}>Save as new</button>
			<button type="button" class="btn" onclick={exportMidi}>
				<Download size={14} /> Export .mid
			</button>
		</div>
		<div class="library__bar">
			<button type="button" class="btn btn--small" onclick={newPattern}>
				<FilePlus2 size={13} /> New pattern
			</button>
			<button type="button" class="btn btn--small" onclick={loadDemo}>Load demo</button>
			<button type="button" class="btn btn--small btn--danger" onclick={() => seq.clearSteps()}>
				<Trash2 size={13} /> Clear steps
			</button>
		</div>
		{#if status}<p class="tool__status" role="status">{status}</p>{/if}
		{#if seq.library.length}
			<ul class="saved">
				{#each seq.library as item (item.id)}
					<li class="saved__item" class:saved__item--current={item.id === pattern.id}>
						<span class="saved__name">{item.name}</span>
						<span class="saved__meta">
							{item.length} steps · {item.bpm} BPM · {formatDate(item.updatedAt)}
						</span>
						<button type="button" class="btn btn--small" onclick={() => load(item.id)}>Load</button>
						<button
							type="button"
							class="btn btn--small btn--danger"
							aria-label="Delete {item.name}"
							onclick={() => seq.remove(item.id)}><Trash2 size={13} /></button
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="tool__empty">No saved patterns yet. The pattern you’re editing is kept anyway.</p>
		{/if}
		<p class="tool__hint">
			Patterns are stored in this browser. Export .mid writes one clip (96 PPQ, MIDI channel 1) with
			the notes, swing and lock automation, ready to drop into Ableton.
		</p>
	</div>
</section>

<style>
	.transport,
	.clock,
	.nav,
	.library__bar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.5rem 0.7rem;
	}

	.transport {
		margin-bottom: 0.6rem;
	}

	.transport__play {
		min-inline-size: 6.5rem;
		padding-block: 0.55rem;
		font-size: 0.84rem;
	}

	.transport__status {
		align-self: center;
		min-inline-size: 7.5rem;
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.76rem;
		color: #a5f3fc;
	}

	.clock {
		align-items: center;
		margin-bottom: 0.7rem;
	}

	.clock__led {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.74rem;
		color: #64748b;
	}

	.clock__led::before {
		content: '';
		inline-size: 0.5rem;
		block-size: 0.5rem;
		background: #334155;
		border-radius: 999px;
	}

	.clock__led--on {
		color: #a5f3fc;
	}

	.clock__led--on::before {
		background: #22d3ee;
		box-shadow: 0 0 8px rgba(34, 211, 238, 0.8);
	}

	.field {
		display: grid;
		gap: 0.2rem;
		font-size: 0.64rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #64748b;
	}

	.field select,
	.field input[type='number'],
	.field input[type='text'] {
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

	.field--num input {
		inline-size: 4.6rem;
	}

	.field--range input {
		inline-size: 8rem;
		accent-color: #ea580c;
	}

	.field--grow {
		flex: 1 1 12rem;
	}

	.field--grow input {
		inline-size: 100%;
	}

	.seg {
		display: inline-flex;
		padding: 2px;
		background: #0b0d11;
		border: 1px solid #2e3543;
		border-radius: 0.55rem;
	}

	.seg__btn {
		position: relative;
		margin: 0;
		padding: 0.32rem 0.65rem;
		font-size: 0.74rem;
		font-weight: 700;
		color: #94a3b8;
		background: transparent;
		border: 0;
		border-radius: 0.42rem;
		cursor: pointer;
	}

	.seg__btn[aria-pressed='true'] {
		color: #fff7ed;
		background: rgba(234, 88, 12, 0.28);
		box-shadow: inset 0 0 0 1px #ea580c;
	}

	.seg__live {
		position: absolute;
		top: 3px;
		right: 3px;
		inline-size: 5px;
		block-size: 5px;
		background: #22d3ee;
		border-radius: 999px;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.76rem;
		color: #cbd5e1;
		cursor: pointer;
	}

	.check input {
		accent-color: #ea580c;
	}

	.nav {
		align-items: center;
		margin-bottom: 0.45rem;
	}

	.nav__gap {
		flex: 1 1 0;
	}

	.nav__range {
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.72rem;
		color: #94a3b8;
	}

	.editor {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.8rem;
		margin-top: 0.9rem;
		padding: 0.8rem;
		background: #0b0d11;
		border: 1px solid #2a2f3a;
		border-radius: 0.7rem;
	}

	.editor__col {
		display: grid;
		align-content: start;
		gap: 0.55rem;
	}

	.editor__title {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 800;
		color: #f8fafc;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.18rem 0.3rem 0.18rem 0.55rem;
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.74rem;
		font-weight: 700;
		color: #fff7ed;
		background: rgba(234, 88, 12, 0.22);
		border: 1px solid #c2410c;
		border-radius: 999px;
	}

	.chip--rest {
		padding-inline: 0.6rem;
		color: #94a3b8;
		background: transparent;
		border-color: #334155;
	}

	.chip__x {
		display: grid;
		place-items: center;
		inline-size: 1.1rem;
		block-size: 1.1rem;
		margin: 0;
		padding: 0;
		color: #fdba74;
		background: transparent;
		border: 0;
		border-radius: 999px;
		cursor: pointer;
	}

	.chip__x:hover {
		color: #fff7ed;
		background: rgba(234, 88, 12, 0.4);
	}

	.lock {
		display: grid;
		gap: 0.4rem;
		padding-bottom: 0.55rem;
		border-bottom: 1px solid #1e2430;
	}

	.lock:last-child {
		border-bottom: 0;
	}

	.lock__head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.lock .btn {
		justify-self: start;
	}

	.library {
		display: grid;
		gap: 0.55rem;
		margin-top: 0.9rem;
	}

	.saved {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.saved__item {
		display: grid;
		grid-template-columns: 1fr auto auto;
		grid-template-areas:
			'name load del'
			'meta load del';
		align-items: center;
		column-gap: 0.4rem;
		padding: 0.45rem 0.6rem;
		background: #0b0d11;
		border: 1px solid #2a2f3a;
		border-radius: 0.55rem;
	}

	.saved__item--current {
		border-color: #ea580c;
	}

	.saved__name {
		grid-area: name;
		font-size: 0.82rem;
		font-weight: 800;
		color: #f1f5f9;
	}

	.saved__meta {
		grid-area: meta;
		font-size: 0.68rem;
		color: #64748b;
	}

	.saved__item > :global(.btn:first-of-type) {
		grid-area: load;
	}

	.library :global(.tool__status),
	.library :global(.tool__empty),
	.library :global(.tool__hint) {
		margin: 0;
	}
</style>
