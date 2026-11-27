<script lang="ts">
	/**
	 * @file DrillTrainer.svelte
	 * @description "Recreate this sound": the page plays a target, overlays its waveform on the
	 * oscilloscope, and scores how close the live S-1 gets. Targets are CC values, so Reveal can
	 * show the knob positions and a target can be saved as a patch.
	 */
	import { untrack } from 'svelte';
	import { Check, Eye, EyeOff, Music, Save, Square, Volume2, Wand2 } from '@lucide/svelte';
	import drillData from '#lib/data/drills.json';
	import { cleanValues } from '#lib/patches.js';
	import { audioStore } from '#lib/stores/audio.svelte.js';
	import { midiStore } from '#lib/stores/midi.svelte.js';
	import { patchStore } from '#lib/stores/patches.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { vizStore } from '#lib/stores/viz.svelte.js';
	import { playTarget, renderTarget, type TargetRender } from '#lib/synth/voice.js';
	import { mixDown, type AudioCapture } from '#lib/audio/capture.js';
	import {
		envelopeOf,
		envelopeSimilarity,
		noteName,
		timbreSimilarity
	} from '#lib/visualizer/dsp.js';
	import CompareChart from './CompareChart.svelte';
	import PatchMini from './PatchMini.svelte';

	interface Drill {
		id: string;
		title: string;
		category: 'Oscillator' | 'Filter' | 'Envelope';
		level: number;
		compare: 'cycle' | 'envelope';
		goal: string;
		listen: string;
		look: string;
		start: Record<string, number>;
		target: Record<string, number>;
	}

	const DRILLS = drillData.drills as unknown as Drill[];
	const BASE = drillData.baseStart as Record<string, number>;
	const NOTE = drillData.note;
	const FREQUENCY = 440 * 2 ** ((NOTE - 69) / 12);
	const NOTE_NAME = noteName(FREQUENCY).name;
	const CYCLE_GATE = 1.6;
	const ENVELOPE_GATE = 1.0;
	const CAPTURE_TAIL = 2.0;
	const CATEGORIES = ['Oscillator', 'Filter', 'Envelope'] as const;
	const PROGRESS_KEY = 's1-drills-v1';
	const DONE_AT = 0.8;

	function loadProgress(): Record<string, number> {
		try {
			return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, number>;
		} catch {
			return {};
		}
	}

	let selectedId = $state(DRILLS[0].id);
	let progress = $state<Record<string, number>>(loadProgress());
	let target = $state.raw<TargetRender | null>(null);
	let revealed = $state(false);
	let holding = $state(false);
	let capturing = $state(false);
	let liveEnvelope = $state.raw<Float32Array | null>(null);
	let envelopeScore = $state<number | null>(null);
	let message = $state('');
	let synth: AudioContext | null = null;
	let recording: AudioCapture | null = null;

	const drill = $derived(DRILLS.find((d) => d.id === selectedId) ?? DRILLS[0]);
	const startValues = $derived({ ...BASE, ...drill.start });
	const targetValues = $derived({ ...BASE, ...drill.target });
	const connected = $derived(midiStore.status === 'connected' && midiStore.outputReady);
	const listening = $derived(audioStore.status === 'running');
	const cycleScore = $derived(
		drill.compare === 'cycle' && target && vizStore.liveCycle && vizStore.livePitch
			? timbreSimilarity(target.cycle, target.cycleHz, vizStore.liveCycle, vizStore.livePitch, {
					spanDb: 24
				})
			: null
	);
	const score = $derived(drill.compare === 'cycle' ? cycleScore : envelopeScore);
	const live = $derived(cleanValues(midiStore.values));

	function verdict(s: number): string {
		if (s >= 0.92) return 'Spot on!';
		if (s >= 0.8) return 'Very close';
		if (s >= 0.6) return 'Getting warmer';
		return 'Keep tweaking';
	}

	// Render the target offline whenever the drill changes; reset the comparison.
	$effect(() => {
		const d = drill;
		const values = targetValues;
		let cancelled = false;
		untrack(() => {
			target = null;
			liveEnvelope = null;
			envelopeScore = null;
			revealed = false;
			message = '';
			uiStore.ghostValues = null;
			vizStore.overlay = null;
			if (d.compare === 'cycle') vizStore.view = 'scope';
		});
		const gate = d.compare === 'cycle' ? CYCLE_GATE : ENVELOPE_GATE;
		const seconds = d.compare === 'cycle' ? CYCLE_GATE + 0.2 : ENVELOPE_GATE + CAPTURE_TAIL;
		renderTarget(values, FREQUENCY, gate, seconds).then((result) => {
			if (cancelled) return;
			target = result;
			vizStore.overlay = d.compare === 'cycle' ? { cycle: result.cycle, label: d.title } : null;
		});
		return () => {
			cancelled = true;
		};
	});

	// Keep the best score per drill.
	$effect(() => {
		const s = score;
		const id = drill.id;
		if (s === null) return;
		untrack(() => {
			if (s > (progress[id] ?? 0)) {
				progress = { ...progress, [id]: s };
				try {
					localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
				} catch {
					// progress just isn't remembered
				}
			}
		});
	});

	// Leaving the drills: clear the overlay and ghosts, release a held note, stop recording.
	$effect(() => () => {
		vizStore.overlay = null;
		uiStore.ghostValues = null;
		if (untrack(() => holding)) noteOff();
		void recording?.stop();
		recording = null;
	});

	function select(id: string) {
		if (holding) noteOff();
		holding = false;
		selectedId = id;
	}

	function playTargetSound() {
		synth ??= new AudioContext();
		void synth.resume();
		playTarget(
			synth,
			targetValues,
			FREQUENCY,
			drill.compare === 'cycle' ? CYCLE_GATE : ENVELOPE_GATE
		);
	}

	function setUpStart() {
		const sent = midiStore.sendControlChanges(
			Object.entries(startValues).map(([cc, v]): [number, number] => [Number(cc), v])
		);
		message = sent
			? `Sent the starting sound to the S-1 (${sent} CCs). Now tweak it towards the target.`
			: 'Connect S-1 first (above the drawing).';
	}

	function noteOn(): boolean {
		return midiStore.send([0x90 | (midiStore.channel - 1), NOTE, 100]);
	}

	function noteOff() {
		midiStore.send([0x80 | (midiStore.channel - 1), NOTE, 0]);
	}

	function toggleHold() {
		if (holding) {
			noteOff();
			holding = false;
		} else if (noteOn()) {
			holding = true;
		} else {
			message = 'Connect S-1 first, or hold the note on the S-1 yourself.';
		}
	}

	/**
	 * Records the S-1 while the page plays one note (timed with Web MIDI timestamps), then
	 * measures its loudness curve exactly like the target's.
	 */
	async function playAndCapture() {
		if (!listening) {
			message = 'Open the Visualizer first so the page can hear the S-1.';
			return;
		}
		const id = drill.id;
		capturing = true;
		liveEnvelope = null;
		envelopeScore = null;
		message = '';
		const capture = await audioStore.startCapture();
		if (!capture) {
			capturing = false;
			message = 'Couldn’t record the audio input. Close and reopen the Visualizer, then try again.';
			return;
		}
		recording = capture;
		const lead = 80;
		const at = performance.now() + lead;
		const status = midiStore.channel - 1;
		if (!midiStore.send([0x90 | status, NOTE, 100], at)) {
			recording = null;
			await capture.stop();
			capturing = false;
			message = 'Connect S-1 first so the page can play the note.';
			return;
		}
		midiStore.send([0x80 | status, NOTE, 0], at + ENVELOPE_GATE * 1000);
		await new Promise((resolve) =>
			setTimeout(resolve, lead + (ENVELOPE_GATE + CAPTURE_TAIL) * 1000)
		);
		if (recording !== capture) return; // the drills were closed meanwhile
		recording = null;
		const audio = await capture.stop();
		capturing = false;
		if (drill.id !== id) return;
		const mono = mixDown(audio.channels);
		let peak = 0;
		for (const v of mono) peak = Math.max(peak, Math.abs(v));
		if (peak < 1e-3) {
			message = 'No sound came in. Check that the S-1 is the Visualizer input and VOLUME is up.';
			return;
		}
		const env = envelopeOf(mono, audio.sampleRate);
		liveEnvelope = env;
		envelopeScore = target ? envelopeSimilarity(target.envelope, env) : null;
	}

	function toggleReveal() {
		revealed = !revealed;
		uiStore.ghostValues = revealed ? cleanValues(targetValues) : null;
	}

	function saveTarget() {
		const patch = patchStore.saveValues(`Drill: ${drill.title}`, targetValues);
		message = `Saved “${patch.name}” to your patch library.`;
	}
</script>

<section class="tool" aria-labelledby="drills-title">
	<header class="tool__head">
		<h3 id="drills-title">Recreate this sound</h3>
		<p>
			Listen to the target, then tweak the S-1 until your waveform (and your ear) matches it. The
			target is played by a small in-browser model of the S-1's oscillator → filter → envelope path,
			so match the <em>sound</em>, not exact knob positions. The score compares harmonics (or the
			loudness curve) and is just for fun.
		</p>
	</header>

	<div class="picker">
		{#each CATEGORIES as category (category)}
			<div class="picker__group">
				<span class="picker__label">{category}</span>
				<div class="picker__chips">
					{#each DRILLS.filter((d) => d.category === category) as d (d.id)}
						{@const best = progress[d.id] ?? 0}
						<button
							type="button"
							class="chip"
							class:chip--active={d.id === drill.id}
							class:chip--done={best >= DONE_AT}
							aria-pressed={d.id === drill.id}
							onclick={() => select(d.id)}
						>
							{#if best >= DONE_AT}<Check size={12} />{/if}
							{d.title}
						</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>

	<article class="drill">
		<div class="drill__head">
			<div>
				<p class="drill__kicker">
					{drill.category} · level {drill.level} · note {NOTE_NAME}
				</p>
				<h4 class="drill__title">{drill.title}</h4>
			</div>
			{#if score !== null}
				<div class="score" class:score--great={score >= DONE_AT}>
					<span class="score__value">{Math.round(score * 100)}%</span>
					<span class="score__verdict">{verdict(score)}</span>
				</div>
			{/if}
		</div>
		<p class="drill__goal">{drill.goal}</p>
		<ul class="drill__hints">
			<li><Volume2 size={13} /> <span><strong>Listen:</strong> {drill.listen}</span></li>
			<li><Music size={13} /> <span><strong>Look:</strong> {drill.look}</span></li>
		</ul>

		<div class="drill__actions">
			<button type="button" class="btn btn--accent" onclick={playTargetSound}>
				<Volume2 size={14} /> Play target
			</button>
			<button type="button" class="btn" onclick={setUpStart} disabled={!connected}>
				<Wand2 size={14} /> Set up the start
			</button>
			{#if drill.compare === 'cycle'}
				<button
					type="button"
					class="btn btn--primary"
					aria-pressed={holding}
					onclick={toggleHold}
					disabled={!connected}
				>
					{#if holding}<Square size={13} /> Release {NOTE_NAME}{:else}<Music size={14} /> Hold
						{NOTE_NAME} on S-1{/if}
				</button>
			{:else}
				<button
					type="button"
					class="btn btn--primary"
					onclick={playAndCapture}
					disabled={!connected || capturing}
				>
					<Music size={14} />
					{capturing ? 'Listening…' : `Play ${NOTE_NAME} on S-1 & compare`}
				</button>
			{/if}
			<button type="button" class="btn" aria-pressed={revealed} onclick={toggleReveal}>
				{#if revealed}<EyeOff size={14} /> Hide answer{:else}<Eye size={14} /> Reveal{/if}
			</button>
			<button type="button" class="btn" onclick={saveTarget}
				><Save size={14} /> Save as patch</button
			>
		</div>

		<details class="plain">
			<summary>Before you start: make it a plain sound</summary>
			<p>
				<strong>Set up the start</strong> can only send knob values: Roland doesn't document the CC values
				of the SHIFT + pad switches. Check these on the S-1 so nothing else reshapes the wave:
			</p>
			<ul>
				<li>
					POLY on <code>Nono</code> or <code>PoLy</code> (<code>Uni</code> and <code>Chd</code> stack
					extra notes)
				</li>
				<li>AMP on <code>Env</code>, ENV TRG on <code>GAtE</code> or <code>triG</code></li>
				<li>
					OSC DRAW <code>OFF</code>, OSC CHOP Overtone <code>0</code>, Chorus <code>OFF</code>
				</li>
				<li>PWM SRC on <code>NAn</code> (a steady pulse width), SUB OCT on <code>-1oc</code></li>
				<li>RANGE on 8′, so {NOTE_NAME} sounds at {Math.round(FREQUENCY)} Hz</li>
			</ul>
		</details>

		{#if !connected}
			<p class="tool__note">
				Connect S-1 to send the starting sound and play {NOTE_NAME} from here, or play it on the S-1 yourself.
			</p>
		{/if}
		{#if !audioStore.open}
			<p class="tool__note">
				<button
					type="button"
					class="btn btn--small btn--primary"
					onclick={() => audioStore.start()}
				>
					Open the Visualizer
				</button>
				so the page can hear the S-1 and draw the target over your waveform.
			</p>
		{/if}
		{#if message}<p class="tool__status" role="status">{message}</p>{/if}

		<CompareChart
			kind={drill.compare}
			target={drill.compare === 'cycle' ? (target?.cycle ?? null) : (target?.envelope ?? null)}
			live={drill.compare === 'cycle' ? vizStore.liveCycle : liveEnvelope}
			label="{drill.title}: target versus your S-1"
		/>
		<p class="tool__hint">
			{#if drill.compare === 'cycle'}
				Hold the note and tweak: the oscilloscope also draws the target in orange behind your trace.
				For the same pitch, set RANGE to 8′.
			{:else}
				Press play: the page plays {NOTE_NAME} for {ENVELOPE_GATE} s and records how loud the S-1 is over
				time.
			{/if}
		</p>

		{#if revealed}
			<div class="reveal">
				<PatchMini values={live} ghost={cleanValues(targetValues)} label="Target knob positions" />
				<p class="tool__hint">
					Orange ticks mark the target positions, here and on the drawing. White pointers are your
					S-1 (as far as the page has seen).
				</p>
			</div>
		{/if}
	</article>
</section>

<style>
	.picker {
		display: grid;
		gap: 0.55rem;
		margin-bottom: 0.9rem;
	}

	.picker__group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
	}

	.picker__label {
		min-inline-size: 5.5rem;
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #64748b;
	}

	.picker__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.3rem 0.65rem;
		font-size: 0.74rem;
		font-weight: 700;
		color: #cbd5e1;
		background: #171b22;
		border: 1px solid #2e3543;
		border-radius: 999px;
		cursor: pointer;
		margin: 0;
	}

	.chip--done {
		color: #86efac;
		border-color: rgba(74, 222, 128, 0.45);
	}

	.chip--active {
		color: #fff7ed;
		background: rgba(234, 88, 12, 0.2);
		border-color: #ea580c;
	}

	.drill {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.9rem;
		background: #0b0d11;
		border: 1px solid #2a2f3a;
		border-radius: 0.75rem;
	}

	.drill :global(.tool__note),
	.drill :global(.tool__status),
	.drill :global(.tool__hint) {
		margin: 0;
	}

	.drill__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.drill__kicker {
		margin: 0;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #fb923c;
	}

	.drill__title {
		margin: 0.15rem 0 0;
		font-size: 1.05rem;
		color: #f8fafc;
	}

	.drill__goal {
		margin: 0;
		font-size: 0.85rem;
		color: #e2e8f0;
	}

	.drill__hints {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.76rem;
		color: #94a3b8;
	}

	.drill__hints li {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
	}

	.drill__hints strong {
		color: #cbd5e1;
	}

	.drill__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.score {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		padding: 0.35rem 0.65rem;
		background: #13161c;
		border: 1px solid #2e3543;
		border-radius: 0.6rem;
	}

	.score--great {
		border-color: rgba(74, 222, 128, 0.6);
		box-shadow: 0 0 14px rgba(74, 222, 128, 0.18);
	}

	.score__value {
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 1.2rem;
		font-weight: 800;
		color: #f8fafc;
	}

	.score--great .score__value {
		color: #86efac;
	}

	.score__verdict {
		font-size: 0.68rem;
		color: #94a3b8;
	}

	.plain {
		font-size: 0.76rem;
		color: #94a3b8;
		background: #10131a;
		border: 1px solid #262b36;
		border-radius: 0.55rem;
		padding: 0.45rem 0.7rem;
	}

	.plain summary {
		cursor: pointer;
		font-weight: 700;
		color: #cbd5e1;
	}

	.plain p {
		margin: 0.45rem 0 0.3rem;
		line-height: 1.5;
	}

	.plain ul {
		display: grid;
		gap: 0.2rem;
		margin: 0;
		padding-inline-start: 1.1rem;
	}

	.plain code {
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.72rem;
		color: #fdba74;
	}

	.reveal {
		display: grid;
		gap: 0.4rem;
		max-inline-size: 420px;
	}
</style>
