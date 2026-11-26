<script lang="ts">
	/**
	 * @file Faceplate.svelte
	 * @description Interactive Roland S-1 front panel (SVG) & bidirectional highlighter
	 *
	 * 1. Hardware -> Cards (Active Filter): Clicking any knob, button, key or pad toggles its ID
	 *    in `activeButtons`; the card list filters to shortcuts that use it.
	 * 2. Card -> Hardware (Inspector Highlight): Clicking a shortcut card sets `selectedTip`; the
	 *    panel lights up the exact controls and the LED display shows the code the S-1 shows.
	 * 3. Spatial Muscle Memory: the SVG keeps the real panel geometry (positions come from
	 *    `PANEL_CONTROLS` in device.js, measured from the panel diagram in the Owner's Manual);
	 *    the Zoom toggle enlarges it inside a scroll area for thumb tapping on phones.
	 */
	import { GENERIC_CONTROLS, PANEL_CONTROLS, type PanelControl, type Tip } from '#lib/types.js';

	interface Props {
		activeButtons: string[];
		selectedTip?: Tip | null;
		matchCount: number;
		onToggleButton: (buttonId: string) => void;
		onClearButtons: () => void;
		onClearSelectedTip?: () => void;
	}

	let {
		activeButtons,
		selectedTip = null,
		matchCount,
		onToggleButton,
		onClearButtons,
		onClearSelectedTip
	}: Props = $props();

	const highlightedButtons = $derived(selectedTip ? selectedTip.buttons : activeButtons);
	const isShiftActive = $derived(highlightedButtons.includes('SHIFT'));
	const isAnyPadActive = $derived(highlightedButtons.includes('PAD'));
	const isAnyKnobActive = $derived(highlightedButtons.includes('KNOB'));

	let isZoomed = $state(false);

	const knobs = PANEL_CONTROLS.filter((c) => c.kind === 'knob');
	const rectButtons = PANEL_CONTROLS.filter((c) => c.kind === 'button');
	const blackKeys = PANEL_CONTROLS.filter((c) => c.kind === 'key');
	const whitePads = PANEL_CONTROLS.filter((c) => c.kind === 'pad');
	const powerSwitch = PANEL_CONTROLS.find((c) => c.kind === 'switch');

	const KNOB_RADIUS = { small: 19, medium: 25, large: 42 } as const;
	const RING_COLOURS = { white: '#f1f1ee', green: '#4fb58f', orange: '#e0823d', dark: 'none' };

	// White-pad function labels as printed under the keys (grouped labels share a bracket).
	const PAD_GROUPS = [
		{ label: 'OSC', from: 5, to: 6 },
		{ label: 'ARPEGGIO', from: 8, to: 10 },
		{ label: 'CLEAR', from: 11, to: 12 }
	];
	const PAD_WORDS: Record<number, string[]> = {
		5: ['DRAW'],
		6: ['CHOP'],
		7: ['FILTER', 'KYBD'],
		8: ['ON'],
		9: ['TYPE'],
		10: ['RATE'],
		11: ['NOTE'],
		12: ['MOTION']
	};
	const groupedPad = (n: number) => PAD_GROUPS.some((g) => n >= g.from && n <= g.to);

	const PAD_PITCH = 84;
	const padX = (n: number) => 116 + PAD_PITCH * (n - 1);

	function isSelected(id: string): boolean {
		return highlightedButtons.includes(id);
	}

	function ariaLabel(c: PanelControl): string {
		const name = c.id === c.label || /^PAD \d+$/.test(c.id) ? c.id : `${c.id} (${c.label})`;
		const kind = c.kind === 'knob' ? ' knob' : c.kind === 'key' ? ' key' : '';
		return `${name}${kind}${c.sub && c.kind !== 'switch' ? ` — ${c.sub}` : ''}`;
	}

	function handleKeydown(event: KeyboardEvent, id: string) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onToggleButton(id);
		}
	}

	const displayText = $derived.by(() => {
		if (selectedTip) return selectedTip.display ?? `P.${selectedTip.citation.page}`;
		return String(matchCount);
	});

	// Four 7-segment cells; a "." lights the decimal point of the preceding cell (e.g. "CLr.n").
	const DISPLAY_CELL_X = [124, 184, 244, 304];
	const displayCells = $derived.by(() => {
		const cells: { ch: string; dot: boolean }[] = [];
		for (const ch of displayText) {
			const last = cells.at(-1);
			if (ch === '.' && last && !last.dot) last.dot = true;
			else cells.push({ ch, dot: false });
		}
		while (cells.length < 4) cells.unshift({ ch: '', dot: false });
		return cells.slice(-4);
	});
</script>

<section
	class="faceplate"
	class:faceplate--shift={isShiftActive}
	aria-label="Interactive Roland S-1 front panel"
>
	<div class="faceplate__branding">
		<div class="brand-identity">
			<span class="brand-roland">Roland</span>
			<span class="brand-model">S-1</span>
			<span class="brand-tagline">Tweak Synth</span>
		</div>
		<button
			type="button"
			class="layout-mode-btn"
			class:layout-mode-btn--active={isZoomed}
			aria-pressed={isZoomed}
			onclick={() => (isZoomed = !isZoomed)}
			title={isZoomed ? 'Fit the whole panel' : 'Enlarge the panel for easier tapping'}
		>
			{isZoomed ? 'Fit Panel' : 'Zoom'}
		</button>
	</div>

	<div class="faceplate__scroll" class:faceplate__scroll--zoomed={isZoomed}>
		<svg
			class="panel"
			viewBox="0 0 1500 850"
			role="group"
			aria-label="S-1 controls: click to filter shortcuts"
		>
			<defs>
				<radialGradient id="knobBody" cx="40%" cy="35%" r="70%">
					<stop offset="0%" stop-color="#4a4b4f" />
					<stop offset="100%" stop-color="#141416" />
				</radialGradient>
				<linearGradient id="padFace" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="#fbfbfb" />
					<stop offset="100%" stop-color="#cfd1d5" />
				</linearGradient>
				<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation="6" result="blur" />
					<feMerge>
						<feMergeNode in="blur" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>

			<!-- Chassis -->
			<rect class="chassis" x="8" y="24" width="1484" height="818" rx="46" />

			<!-- Top strip: branding, charge LED, jacks (decorative) -->
			<g aria-hidden="true">
				<text class="silk silk--brand" x="62" y="104">Roland</text>
				<text class="silk silk--model" x="64" y="140">S-1</text>
				<circle cx="655" cy="97" r="6" class="led led--charge" />
				<text class="silk silk--small" x="672" y="104">CHARGE</text>
				{#each [868, 975, 1090, 1200] as jx (jx)}
					<circle cx={jx} cy="97" r="22" class="jack" />
					<circle cx={jx} cy="97" r="12" class="jack__hole" />
				{/each}
				<text class="silk silk--label" x="922" y="150" text-anchor="middle">IN — SYNC — OUT</text>
				<text class="silk silk--label" x="1145" y="150" text-anchor="middle">IN — MIX — OUT</text>
			</g>

			<!-- Left zone: 7-segment display + TEMPO/VALUE + PLAY/REC -->
			<g aria-hidden="true">
				<rect class="zone-plate" x="62" y="178" width="282" height="378" rx="14" />
				<rect class="display" x="92" y="203" width="244" height="122" rx="10" />
				{#each displayCells as cell, ci (ci)}
					<text class="display__ghost" x={DISPLAY_CELL_X[ci]} y="290" text-anchor="middle">8</text>
					<circle class="display__dot-ghost" cx={DISPLAY_CELL_X[ci] + 27} cy="286" r="5" />
					<text class="display__text" x={DISPLAY_CELL_X[ci]} y="290" text-anchor="middle"
						>{cell.ch}</text
					>
					{#if cell.dot}
						<circle class="display__dot" cx={DISPLAY_CELL_X[ci] + 27} cy="286" r="5" />
					{/if}
				{/each}
			</g>

			<!-- Section titles and printed divider lines -->
			<g aria-hidden="true">
				<text class="silk silk--section" x="432" y="200" text-anchor="middle">LFO</text>
				<text class="silk silk--section" x="750" y="200" text-anchor="middle">OSCILLATOR</text>
				<text class="silk silk--section" x="1154" y="200" text-anchor="middle">FILTER</text>
				<text class="silk silk--section" x="1380" y="200" text-anchor="middle">EFX</text>
				<line class="divider" x1="512" y1="210" x2="512" y2="430" />
				<line class="divider" x1="993" y1="210" x2="993" y2="430" />
				<line class="divider" x1="1313" y1="210" x2="1313" y2="556" />
				<line class="divider" x1="680" y1="470" x2="680" y2="556" />
				<line class="divider" x1="372" y1="448" x2="955" y2="448" />
				<line class="divider" x1="1027" y1="448" x2="1300" y2="448" />
				<text class="silk silk--section" x="991" y="457" text-anchor="middle">ENV</text>

				<!-- RANGE footage marks -->
				<text class="silk silk--tiny" x="570" y="208" text-anchor="middle">16′</text>
				<text class="silk silk--tiny" x="615" y="208" text-anchor="middle">8′</text>
				<text class="silk silk--tiny" x="550" y="246" text-anchor="middle">32′</text>
				<text class="silk silk--tiny" x="636" y="246" text-anchor="middle">4′</text>
				<text class="silk silk--tiny" x="560" y="280" text-anchor="middle">64′</text>
				<text class="silk silk--tiny" x="625" y="280" text-anchor="middle">2′</text>

				<!-- WAVE FORM positions -->
				<path class="wave-icon" d="M 397 333 l 8 -9 l 8 9" />
				<path class="wave-icon" d="M 452 333 v -9 h 7 v 9 h 7 v -9" />
				<path class="wave-icon" d="M 382 360 l 12 -9 v 9 l 12 -9" />
				<path class="wave-icon" d="M 382 388 l 12 9 v -9 l 12 9" />
				<text class="silk silk--tiny" x="462" y="360">RND</text>
				<text class="silk silk--tiny" x="462" y="392">NOISE</text>
			</g>

			<!-- Knobs -->
			{#each knobs as knob (knob.id)}
				{@const r = KNOB_RADIUS[knob.size ?? 'medium']}
				{@const ringColour = RING_COLOURS[knob.ring ?? 'dark']}
				<g
					class="ctl ctl--knob"
					class:ctl--active={isSelected(knob.id)}
					class:ctl--any={isAnyKnobActive && !isSelected(knob.id)}
					transform="translate({knob.x} {knob.y})"
					role="button"
					tabindex="0"
					aria-pressed={isSelected(knob.id)}
					aria-label={ariaLabel(knob)}
					onclick={() => onToggleButton(knob.id)}
					onkeydown={(e) => handleKeydown(e, knob.id)}
				>
					<circle class="ctl__hit" r={r + 16} />
					<circle class="ctl__focus" r={r + 12} />
					{#if ringColour !== 'none'}
						<circle class="knob__ring" r={r + 6} style:stroke={ringColour} />
					{/if}
					<circle class="knob__body" {r} />
					<line class="knob__pointer" x1="0" y1={-r + 3} x2="0" y2={-r * 0.35} />
					{#if knob.id !== 'TEMPO/VALUE'}
						<circle class="knob__dot" cx={-r * 0.72} cy={r + 13} r="3" />
						<circle class="knob__dot" cx={r * 0.72} cy={r + 13} r="3" />
					{/if}
					{#if knob.icon === 'square'}
						<path class="wave-icon" d="M -16 64 v -14 h 10 v 14 h 10 v -14 h 10 v 14" />
					{:else if knob.icon === 'saw'}
						<path class="wave-icon" d="M -14 64 l 26 -16 v 16" />
					{:else}
						<text
							class="silk silk--label"
							y={r + (knob.size === 'large' ? 26 : 40)}
							text-anchor="middle">{knob.label}</text
						>
					{/if}
				</g>
			{/each}

			<!-- Rectangular buttons: PLAY, REC, PATTERN, STEP, D-MOTION, SHIFT, HOLD -->
			{#each rectButtons as btn (btn.id)}
				<g
					class="ctl ctl--button"
					class:ctl--active={isSelected(btn.id)}
					transform="translate({btn.x} {btn.y})"
					role="button"
					tabindex="0"
					aria-pressed={isSelected(btn.id)}
					aria-label={ariaLabel(btn)}
					onclick={() => onToggleButton(btn.id)}
					onkeydown={(e) => handleKeydown(e, btn.id)}
				>
					<rect class="ctl__hit" x="-52" y="-34" width="104" height={btn.sub ? 104 : 68} />
					<rect class="ctl__focus" x="-48" y="-30" width="96" height="60" rx="10" />
					<rect class="button__cap" x="-40" y="-23" width="80" height="46" rx="6" />
					{#if btn.id === 'PLAY'}
						<path class="button__play" d="M -9 -10 L 11 0 L -9 10 Z" />
					{:else if btn.id === 'REC'}
						<circle class="button__rec" r="9" />
					{:else}
						<text class="button__text" y="7" text-anchor="middle">{btn.label}</text>
					{/if}
					{#if btn.sub}
						<text class="silk silk--sub" y="47" text-anchor="middle">{btn.sub}</text>
					{/if}
				</g>
			{/each}

			<!-- Rear-panel POWER switch (needed for power-on shortcuts) -->
			{#if powerSwitch}
				<g
					class="ctl ctl--switch"
					class:ctl--active={isSelected(powerSwitch.id)}
					transform="translate({powerSwitch.x} {powerSwitch.y})"
					role="button"
					tabindex="0"
					aria-pressed={isSelected(powerSwitch.id)}
					aria-label="POWER switch (rear panel)"
					onclick={() => onToggleButton(powerSwitch.id)}
					onkeydown={(e) => handleKeydown(e, powerSwitch.id)}
				>
					<rect class="ctl__hit" x="-30" y="-14" width="150" height="30" />
					<rect class="ctl__focus" x="-20" y="-12" width="128" height="26" rx="6" />
					<rect class="switch__tab" x="-12" y="-8" width="24" height="20" rx="3" />
					<text class="silk silk--tiny" x="20" y="8">POWER (rear)</text>
				</g>
			{/if}

			<!-- Black keyboard pads (SHIFT functions printed on the keys) -->
			{#each blackKeys as key (key.id)}
				<g
					class="ctl ctl--key"
					class:ctl--active={isSelected(key.id)}
					transform="translate({key.x} {key.y})"
					role="button"
					tabindex="0"
					aria-pressed={isSelected(key.id)}
					aria-label={ariaLabel(key)}
					onclick={() => onToggleButton(key.id)}
					onkeydown={(e) => handleKeydown(e, key.id)}
				>
					<rect class="ctl__hit" x="-38" y="-38" width="76" height="76" />
					<rect class="ctl__focus" x="-31" y="-38" width="62" height="76" rx="8" />
					<rect class="key__cap" x="-24" y="-32" width="48" height="64" rx="4" />
					{#each key.label.split(' ') as word, wi (wi)}
						<text class="key__text" y={-16 + wi * 16} text-anchor="middle">{word}</text>
					{/each}
					{#if key.sub}
						<rect class="key__arrow-box" x="-12" y="8" width="24" height="16" rx="2" />
						<text class="key__text" y="21" text-anchor="middle">{key.sub}</text>
					{/if}
				</g>
			{/each}

			<!-- White keyboard / step pads [1]–[16] -->
			<g aria-hidden="true">
				{#each PAD_GROUPS as group (group.label)}
					{@const x1 = padX(group.from) - 34}
					{@const x2 = padX(group.to) + 34}
					{@const mid = (x1 + x2) / 2}
					{@const half = group.label.length * 7 + 10}
					<line class="pad-group" {x1} y1="764" x2={mid - half} y2="764" />
					<line class="pad-group" x1={mid + half} y1="764" {x2} y2="764" />
					<text class="silk silk--fn" x={mid} y="770" text-anchor="middle">{group.label}</text>
				{/each}
			</g>
			{#each whitePads as pad, i (pad.id)}
				{@const n = i + 1}
				{@const words = PAD_WORDS[n] ?? [pad.sub ?? '']}
				<g
					class="ctl ctl--pad"
					class:ctl--active={isSelected(pad.id)}
					class:ctl--any={isAnyPadActive && !isSelected(pad.id)}
					transform="translate({pad.x} {pad.y})"
					role="button"
					tabindex="0"
					aria-pressed={isSelected(pad.id)}
					aria-label={ariaLabel(pad)}
					onclick={() => onToggleButton(pad.id)}
					onkeydown={(e) => handleKeydown(e, pad.id)}
				>
					<rect class="ctl__hit" x="-42" y="-48" width="84" height="134" />
					<rect class="ctl__focus" x="-36" y="-48" width="72" height="96" rx="10" />
					<rect class="pad__cap" x="-29" y="-40" width="58" height="80" rx="6" />
					<text class="pad__num" y="30" text-anchor="middle">{pad.label}</text>
					{#each words as word, wi (wi)}
						<text
							class="silk silk--fn pad__fn"
							y={(groupedPad(n) ? 84 : 62) + wi * 20}
							text-anchor="middle">{word}</text
						>
					{/each}
				</g>
			{/each}
		</svg>
	</div>

	<div class="faceplate__readout" role="status" aria-live="polite">
		{#if selectedTip}
			<div class="readout__main">
				<span class="readout__combo">{selectedTip.combo.join(' + ')}</span>
				<span class="readout__action">{selectedTip.action}</span>
			</div>
			<button type="button" class="readout__clear" onclick={onClearSelectedTip}>
				Clear card preview
			</button>
		{:else if activeButtons.length > 0}
			<div class="readout__main">
				<span class="readout__combo">{activeButtons.join(' + ')}</span>
				<span class="readout__action">
					{matchCount}
					{matchCount === 1 ? 'matching shortcut' : 'matching shortcuts'}
				</span>
			</div>
			<button type="button" class="readout__clear" onclick={onClearButtons}>
				Clear selection
			</button>
		{:else}
			<p class="readout__hint">
				Tap any control to filter shortcuts, or a card to light up its buttons. The display shows
				the code the S-1 shows (or the manual page).
			</p>
		{/if}
	</div>

	<div class="faceplate__generic" role="group" aria-label="Generic controls">
		{#each GENERIC_CONTROLS as generic (generic.id)}
			<button
				type="button"
				class="generic-btn"
				class:generic-btn--active={isSelected(generic.id)}
				aria-pressed={isSelected(generic.id)}
				onclick={() => onToggleButton(generic.id)}
			>
				{generic.label}
			</button>
		{/each}
	</div>
</section>

<style>
	.faceplate {
		inline-size: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: clamp(0.45rem, 2.2vw, 0.9rem);
		background: #13161c;
		border: 1px solid #262b36;
		border-radius: 0.85rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
		user-select: none;
	}

	.faceplate__branding {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.35rem 0.5rem;
		padding-bottom: 0.35rem;
		border-bottom: 1px solid #222731;
	}

	.brand-identity {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
	}

	.brand-roland {
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.14em;
		color: #94a3b8;
		text-transform: uppercase;
	}

	.brand-model {
		font-size: 0.86rem;
		font-weight: 900;
		letter-spacing: 0.08em;
		color: #e2e8f0;
	}

	.brand-tagline {
		font-size: 0.68rem;
		font-weight: 600;
		color: #64748b;
	}

	.layout-mode-btn {
		padding: 0.16rem 0.6rem;
		font-size: 0.62rem;
		font-weight: 700;
		color: #94a3b8;
		background: #1a1e26;
		border: 1px solid #2e3543;
		border-radius: 999px;
		cursor: pointer;
		margin: 0;
		line-height: 1.2;
	}

	.layout-mode-btn:hover {
		color: #e2e8f0;
		border-color: #475569;
	}

	.layout-mode-btn--active {
		color: #fdba74;
		border-color: #ea580c;
		background: rgba(234, 88, 12, 0.12);
	}

	.faceplate__scroll {
		inline-size: 100%;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		border-radius: 0.6rem;
	}

	.panel {
		display: block;
		inline-size: 100%;
		block-size: auto;
	}

	.faceplate__scroll--zoomed .panel {
		inline-size: max(100%, 1100px);
	}

	/* Static panel artwork */
	.chassis {
		fill: #2a2b2e;
		stroke: #3c3e43;
		stroke-width: 3;
	}

	.zone-plate {
		fill: #232427;
	}

	.silk {
		fill: #e7e7e4;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
		font-weight: 700;
		letter-spacing: 0.06em;
		pointer-events: none;
	}

	.silk--brand {
		font-size: 44px;
		font-weight: 800;
		letter-spacing: 0.02em;
	}

	.silk--model {
		font-size: 24px;
	}

	.silk--section {
		font-size: 24px;
	}

	.silk--label {
		font-size: 21px;
	}

	.silk--sub {
		font-size: 17px;
		fill: #c9cbcf;
	}

	.silk--small {
		font-size: 18px;
	}

	.silk--tiny {
		font-size: 15px;
		fill: #c9cbcf;
	}

	.silk--fn {
		font-size: 18px;
		fill: #d4d5d8;
	}

	.faceplate--shift .pad__fn,
	.faceplate--shift .key__text {
		fill: #fdba74;
	}

	.divider,
	.pad-group {
		stroke: #9a9ca1;
		stroke-width: 2;
	}

	.wave-icon {
		fill: none;
		stroke: #e7e7e4;
		stroke-width: 2.5;
		stroke-linejoin: round;
		pointer-events: none;
	}

	.led--charge {
		fill: #34d27a;
	}

	.jack {
		fill: #19191b;
		stroke: #4b4d52;
		stroke-width: 3;
	}

	.jack__hole {
		fill: #050505;
	}

	.display {
		fill: #0b0b0c;
		stroke: #3a3b3f;
		stroke-width: 2;
	}

	.display__ghost,
	.display__text {
		font-family: 'DSEG7 Classic', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 66px;
		font-weight: 700;
		font-style: italic;
	}

	.display__ghost,
	.display__dot-ghost {
		fill: rgba(255, 50, 40, 0.09);
	}

	.display__dot {
		fill: #ff3b30;
	}

	.display__text {
		fill: #ff3b30;
		filter: drop-shadow(0 0 6px rgba(255, 59, 48, 0.65));
	}

	/* Interactive controls */
	.ctl {
		cursor: pointer;
		outline: none;
	}

	.ctl__hit {
		fill: transparent;
	}

	.ctl__focus {
		fill: none;
		stroke: #fbbf24;
		stroke-width: 3;
		opacity: 0;
	}

	.ctl:focus-visible .ctl__focus {
		opacity: 1;
	}

	.knob__ring {
		fill: none;
		stroke-width: 6;
	}

	.knob__body {
		fill: url(#knobBody);
		stroke: #0c0c0d;
		stroke-width: 2;
		transition: stroke 0.15s ease;
	}

	.knob__pointer {
		stroke: #f4f4f2;
		stroke-width: 4;
		stroke-linecap: round;
	}

	.knob__dot {
		fill: #e7e7e4;
	}

	.ctl--knob:hover .knob__body {
		stroke: #94a3b8;
	}

	.ctl--knob.ctl--active .knob__body {
		stroke: #f97316;
		stroke-width: 6;
		filter: url(#glow);
	}

	.ctl--knob.ctl--any .knob__body {
		stroke: #fb923c;
		stroke-width: 3;
		stroke-dasharray: 6 5;
	}

	.button__cap {
		fill: #55575c;
		stroke: #1d1e20;
		stroke-width: 2;
		transition:
			fill 0.15s ease,
			stroke 0.15s ease;
	}

	.button__text {
		fill: #f1f1ef;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
		font-size: 17px;
		font-weight: 700;
		letter-spacing: 0.04em;
		pointer-events: none;
	}

	.button__play {
		fill: #4ade80;
	}

	.button__rec {
		fill: #ef4444;
	}

	.ctl--button:hover .button__cap,
	.ctl--switch:hover .switch__tab {
		stroke: #94a3b8;
	}

	.ctl--button.ctl--active .button__cap,
	.ctl--switch.ctl--active .switch__tab {
		fill: #ea580c;
		stroke: #fdba74;
		filter: url(#glow);
	}

	.switch__tab {
		fill: #3b3d42;
		stroke: #1d1e20;
		stroke-width: 2;
	}

	.key__cap {
		fill: #1c1d20;
		stroke: #4a4c51;
		stroke-width: 2;
		transition:
			fill 0.15s ease,
			stroke 0.15s ease;
	}

	.key__text {
		fill: #e7e7e4;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
		font-size: 14px;
		font-weight: 700;
		pointer-events: none;
	}

	.key__arrow-box {
		fill: none;
		stroke: #8b8d92;
		stroke-width: 1.5;
	}

	.ctl--key:hover .key__cap {
		stroke: #94a3b8;
	}

	.ctl--key.ctl--active .key__cap {
		fill: #c2410c;
		stroke: #fdba74;
		filter: url(#glow);
	}

	.pad__cap {
		fill: url(#padFace);
		stroke: #8f9298;
		stroke-width: 2;
		transition:
			fill 0.15s ease,
			stroke 0.15s ease;
	}

	.pad__num {
		fill: #2b2c30;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
		font-size: 18px;
		font-weight: 700;
		pointer-events: none;
	}

	.ctl--pad:hover .pad__cap {
		stroke: #f8fafc;
	}

	.ctl--pad.ctl--active .pad__cap {
		fill: #fb923c;
		stroke: #fff7ed;
		stroke-width: 3;
		filter: url(#glow);
	}

	.ctl--pad.ctl--any .pad__cap {
		stroke: #f97316;
		stroke-width: 4;
		stroke-dasharray: 8 6;
	}

	/* Readout + generic controls (HTML) */
	.faceplate__readout {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem 0.75rem;
		min-block-size: 2.6rem;
		padding: 0.5rem 0.7rem;
		background: #0b0d11;
		border: 1px solid #252b36;
		border-radius: 0.55rem;
	}

	.readout__main {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-inline-size: 0;
	}

	.readout__combo {
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.78rem;
		font-weight: 700;
		color: #fdba74;
		overflow-wrap: anywhere;
	}

	.readout__action {
		font-size: 0.78rem;
		color: #cbd5e1;
	}

	.readout__hint {
		margin: 0;
		font-size: 0.74rem;
		line-height: 1.4;
		color: #94a3b8;
	}

	.readout__clear {
		padding: 0.25rem 0.6rem;
		font-size: 0.7rem;
		font-weight: 700;
		color: #e2e8f0;
		background: #1a1e26;
		border: 1px solid #334155;
		border-radius: 0.4rem;
		cursor: pointer;
		margin: 0;
	}

	.readout__clear:hover {
		border-color: #64748b;
	}

	.faceplate__generic {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.generic-btn {
		padding: 0.28rem 0.7rem;
		font-size: 0.72rem;
		font-weight: 700;
		color: #cbd5e1;
		background: #171b22;
		border: 1px dashed #475569;
		border-radius: 999px;
		cursor: pointer;
		margin: 0;
	}

	.generic-btn:hover {
		color: #fff;
		border-color: #94a3b8;
	}

	.generic-btn--active {
		color: #fff7ed;
		background: rgba(234, 88, 12, 0.22);
		border: 1px solid #f97316;
	}

	@media (pointer: coarse) {
		.generic-btn,
		.layout-mode-btn,
		.readout__clear {
			min-block-size: 2.25rem;
		}
	}
</style>
