<script lang="ts">
	/**
	 * @file Studio.svelte
	 * @description Hands-on tools for a connected S-1, shown in place of the shortcut cards while
	 * the panel drawing (with Connect S-1 and the Visualizer) stays alongside.
	 */
	import { uiStore, type StudioTab } from '#lib/stores/ui.svelte.js';
	import DrillTrainer from './DrillTrainer.svelte';
	import KeystepPanel from './KeystepPanel.svelte';
	import LessonPlayer from './LessonPlayer.svelte';
	import PatchLibrary from './PatchLibrary.svelte';

	const TABS: { id: StudioTab; label: string; blurb: string }[] = [
		{ id: 'patches', label: 'Patches', blurb: 'Save and recall sounds' },
		{ id: 'drills', label: 'Drills', blurb: 'Recreate this sound' },
		{ id: 'lessons', label: 'Lessons', blurb: 'Learn the knobs step by step' },
		{ id: 'keystep', label: 'KeyStep', blurb: 'Keys, chords and scales' }
	];
</script>

<section class="studio" aria-labelledby="studio-title">
	<header class="studio__head">
		<h2 id="studio-title" class="studio__title">Studio</h2>
		<p class="studio__lede">
			Hands-on tools for your S-1. Most of them need <strong>Connect S-1</strong> (Chrome or Edge,
			Web MIDI on channel 3) and some use the <strong>Visualizer</strong>, both above the drawing.
		</p>
	</header>

	<div class="studio__tabs" role="tablist" aria-label="Studio tools">
		{#each TABS as tab (tab.id)}
			<button
				type="button"
				role="tab"
				id="studio-tab-{tab.id}"
				class="studio__tab"
				class:studio__tab--active={uiStore.studioTab === tab.id}
				aria-selected={uiStore.studioTab === tab.id}
				aria-controls="studio-panel"
				onclick={() => (uiStore.studioTab = tab.id)}
			>
				<span class="studio__tab-label">{tab.label}</span>
				<span class="studio__tab-blurb">{tab.blurb}</span>
			</button>
		{/each}
	</div>

	<div
		id="studio-panel"
		class="studio__panel"
		role="tabpanel"
		aria-labelledby="studio-tab-{uiStore.studioTab}"
	>
		{#if uiStore.studioTab === 'patches'}
			<PatchLibrary />
		{:else if uiStore.studioTab === 'drills'}
			<DrillTrainer />
		{:else if uiStore.studioTab === 'lessons'}
			<LessonPlayer />
		{:else if uiStore.studioTab === 'keystep'}
			<KeystepPanel />
		{/if}
	</div>
</section>

<style>
	.studio {
		container-type: inline-size;
		container-name: studio;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.studio__title {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 800;
		color: #f1f5f9;
	}

	.studio__lede {
		margin: 0.25rem 0 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: #94a3b8;
	}

	.studio__lede strong {
		color: #cbd5e1;
	}

	.studio__tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.studio__tab {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
		padding: 0.45rem 0.75rem;
		text-align: left;
		background: #13161c;
		border: 1px solid #262b36;
		border-radius: 0.6rem;
		cursor: pointer;
		margin: 0;
	}

	.studio__tab:hover {
		border-color: #475569;
	}

	.studio__tab--active {
		background: rgba(234, 88, 12, 0.12);
		border-color: #ea580c;
	}

	.studio__tab-label {
		font-size: 0.82rem;
		font-weight: 800;
		color: #f1f5f9;
	}

	.studio__tab-blurb {
		font-size: 0.68rem;
		color: #94a3b8;
	}

	.studio__panel {
		padding: 1rem;
		background: #13161c;
		border: 1px solid #262b36;
		border-radius: 0.85rem;
	}

	/* Shared building blocks for every studio tool */
	.studio :global(.tool__head h3) {
		margin: 0;
		font-size: 1rem;
		font-weight: 800;
		color: #f1f5f9;
	}

	.studio :global(.tool__head p) {
		margin: 0.35rem 0 0.9rem;
		font-size: 0.8rem;
		line-height: 1.55;
		color: #94a3b8;
	}

	.studio :global(.tool__note) {
		margin: 0 0 0.8rem;
		padding: 0.55rem 0.75rem;
		font-size: 0.78rem;
		color: #a5f3fc;
		background: rgba(8, 145, 178, 0.1);
		border: 1px solid #155e75;
		border-radius: 0.55rem;
	}

	.studio :global(.tool__hint) {
		margin: 0.45rem 0 0;
		font-size: 0.72rem;
		color: #64748b;
	}

	.studio :global(.tool__status) {
		margin: 0.7rem 0 0;
		font-size: 0.78rem;
		color: #86efac;
	}

	.studio :global(.tool__status--error) {
		color: #fcd34d;
	}

	.studio :global(.tool__empty) {
		margin: 0.8rem 0 0;
		font-size: 0.8rem;
		color: #64748b;
	}

	.studio :global(.btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		padding: 0.42rem 0.75rem;
		font-size: 0.76rem;
		font-weight: 700;
		color: #e2e8f0;
		background: #1a1e26;
		border: 1px solid #334155;
		border-radius: 0.45rem;
		cursor: pointer;
		margin: 0;
		white-space: nowrap;
	}

	.studio :global(.btn:hover:not(:disabled)) {
		border-color: #64748b;
	}

	.studio :global(.btn:disabled) {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.studio :global(.btn--primary) {
		color: #ecfeff;
		background: rgba(8, 145, 178, 0.22);
		border-color: #0e7490;
	}

	.studio :global(.btn--accent) {
		color: #fff7ed;
		background: rgba(234, 88, 12, 0.22);
		border-color: #ea580c;
	}

	.studio :global(.btn--small) {
		padding: 0.3rem 0.55rem;
		font-size: 0.72rem;
	}

	.studio :global(.btn--danger:hover:not(:disabled)) {
		color: #fecaca;
		border-color: #b91c1c;
	}

	@media (pointer: coarse) {
		.studio :global(.btn),
		.studio__tab {
			min-block-size: 2.4rem;
		}
	}
</style>
