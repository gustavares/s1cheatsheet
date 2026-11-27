<script lang="ts">
	/**
	 * @file PatchLibrary.svelte
	 * @description Save the S-1's current sound (as tracked by the knob mirror), keep a library in
	 * the browser, recall patches to the hardware, and back them up as JSON.
	 */
	import { Download, Send, Trash2, Upload, Pencil } from '@lucide/svelte';
	import { cleanValues, coverage } from '#lib/patches.js';
	import { midiStore } from '#lib/stores/midi.svelte.js';
	import { patchStore } from '#lib/stores/patches.svelte.js';
	import PatchMini from './PatchMini.svelte';

	patchStore.load();

	let name = $state('');
	let message = $state('');
	let error = $state(false);
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);

	const connected = $derived(midiStore.status === 'connected');
	const canRecall = $derived(connected && midiStore.outputReady);
	const live = $derived(cleanValues(midiStore.values));
	const liveCoverage = $derived(coverage(live));
	const hasLive = $derived(Object.keys(live).length > 0);

	const dateFormat = new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	function say(text: string, isError = false) {
		message = text;
		error = isError;
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		const patch = patchStore.saveCurrent(name || `Patch ${patchStore.patches.length + 1}`);
		name = '';
		const c = coverage(patch.values);
		say(`Saved “${patch.name}” (${c.knobs}/${c.knobTotal} knobs, ${c.others} other settings).`);
	}

	function recall(id: string, patchName: string) {
		const sent = patchStore.recall(id);
		if (sent > 0)
			say(`Sent “${patchName}” to the S-1: ${sent} CC messages on channel ${midiStore.channel}.`);
		else say('Connect S-1 first (button above the drawing) to recall patches.', true);
	}

	function startRename(id: string, current: string) {
		editingId = id;
		editName = current;
	}

	function commitRename(event: SubmitEvent) {
		event.preventDefault();
		if (editingId) patchStore.rename(editingId, editName);
		editingId = null;
	}

	function remove(id: string, patchName: string) {
		if (window.confirm(`Delete “${patchName}” from your library?`)) {
			patchStore.remove(id);
			say(`Deleted “${patchName}”.`);
		}
	}

	function exportJson() {
		const blob = new Blob([patchStore.exportAll()], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `s1-patches-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		say(`Exported ${patchStore.patches.length} patches.`);
	}

	async function importJson(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const { added, skipped } = patchStore.importText(await file.text());
			say(
				`Imported ${added} ${added === 1 ? 'patch' : 'patches'}${skipped ? ` (${skipped} skipped)` : ''}.`
			);
		} catch (err) {
			say(err instanceof Error ? err.message : 'Import failed.', true);
		}
	}
</script>

<section class="tool" aria-labelledby="patches-title">
	<header class="tool__head">
		<h3 id="patches-title">Patch library</h3>
		<p>
			Save the S-1's current sound under a name and send it back later. The S-1 can't send its
			settings over MIDI (its MIDI chart lists no SysEx), so a patch is built from the values this
			page has seen: turn each knob on the S-1 once, or drag it on the drawing, and it lights up
			below. Recall sends every captured CC; anything not captured keeps its current setting on the
			S-1.
		</p>
	</header>

	{#if !connected}
		<p class="tool__note">
			Press <strong>Connect S-1</strong> above the drawing to capture and recall patches.
		</p>
	{/if}

	<div class="capture">
		<div class="capture__mini">
			<PatchMini values={live} label="Live knob positions" />
		</div>
		<div class="capture__side">
			<p class="capture__stats">
				<span class="capture__big">{liveCoverage.knobs}/{liveCoverage.knobTotal}</span> knobs ·
				<span class="capture__big">{liveCoverage.others}/{liveCoverage.otherTotal}</span> SHIFT & menu
				settings captured
			</p>
			<form class="capture__form" onsubmit={save}>
				<input
					type="text"
					bind:value={name}
					maxlength="60"
					placeholder="Patch name (e.g. Acid bass)"
					aria-label="Patch name"
				/>
				<button type="submit" class="btn btn--primary" disabled={!hasLive}>Save patch</button>
			</form>
			{#if !hasLive}
				<p class="tool__hint">Nothing captured yet: move a knob on the S-1 or on the drawing.</p>
			{/if}
		</div>
	</div>

	<div class="library__bar">
		<h4>Saved patches ({patchStore.patches.length})</h4>
		<div class="library__actions">
			<button
				type="button"
				class="btn"
				onclick={exportJson}
				disabled={patchStore.patches.length === 0}
			>
				<Download size={14} /> Export JSON
			</button>
			<button type="button" class="btn" onclick={() => fileInput?.click()}>
				<Upload size={14} /> Import JSON
			</button>
			<input
				bind:this={fileInput}
				class="visually-hidden"
				type="file"
				accept="application/json,.json"
				onchange={importJson}
				tabindex="-1"
				aria-hidden="true"
			/>
		</div>
	</div>

	{#if message}
		<p class="tool__status" class:tool__status--error={error} role="status">{message}</p>
	{/if}

	{#if patchStore.patches.length === 0}
		<p class="tool__empty">No patches yet. Capture a sound above and save it.</p>
	{:else}
		<ul class="library" role="list">
			{#each patchStore.patches as patch (patch.id)}
				{@const c = coverage(patch.values)}
				<li class="patch" class:patch--current={patch.id === patchStore.currentId}>
					<PatchMini values={patch.values} label="{patch.name} knob positions" />
					<div class="patch__body">
						{#if editingId === patch.id}
							<form class="patch__rename" onsubmit={commitRename}>
								<input
									type="text"
									bind:value={editName}
									maxlength="60"
									aria-label="New name for {patch.name}"
								/>
								<button type="submit" class="btn btn--small">Save</button>
							</form>
						{:else}
							<p class="patch__name">{patch.name}</p>
						{/if}
						<p class="patch__meta">
							{dateFormat.format(new Date(patch.createdAt))} · {c.knobs}/{c.knobTotal} knobs, {c.others}
							other
						</p>
						<div class="patch__actions">
							<button
								type="button"
								class="btn btn--primary btn--small"
								disabled={!canRecall}
								title={canRecall ? 'Send this sound to the S-1' : 'Connect S-1 first'}
								onclick={() => recall(patch.id, patch.name)}
							>
								<Send size={13} /> Recall
							</button>
							<button
								type="button"
								class="btn btn--small"
								onclick={() => startRename(patch.id, patch.name)}
								aria-label="Rename {patch.name}"
							>
								<Pencil size={13} />
							</button>
							<button
								type="button"
								class="btn btn--small btn--danger"
								onclick={() => remove(patch.id, patch.name)}
								aria-label="Delete {patch.name}"
							>
								<Trash2 size={13} />
							</button>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.capture {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
		gap: 0.9rem;
		align-items: center;
		padding: 0.75rem;
		background: #0b0d11;
		border: 1px solid #1f3b45;
		border-radius: 0.7rem;
	}

	@container studio (max-width: 560px) {
		.capture {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.capture__stats {
		margin: 0 0 0.6rem;
		font-size: 0.78rem;
		color: #94a3b8;
	}

	.capture__big {
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-weight: 800;
		color: #67e8f9;
	}

	.capture__form,
	.patch__rename {
		display: flex;
		gap: 0.4rem;
	}

	.capture__form input,
	.patch__rename input {
		flex: 1;
		min-inline-size: 0;
		padding: 0.45rem 0.6rem;
		font-size: 0.8rem;
		color: #e2e8f0;
		background: #13161c;
		border: 1px solid #334155;
		border-radius: 0.45rem;
	}

	.library__bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 1.1rem;
	}

	.library__bar h4 {
		margin: 0;
		font-size: 0.9rem;
		color: #e2e8f0;
	}

	.library__actions {
		display: flex;
		gap: 0.4rem;
	}

	.library {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr));
		gap: 0.7rem;
		margin: 0.7rem 0 0;
		padding: 0;
		list-style: none;
	}

	.patch {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem;
		background: #14171e;
		border: 1px solid #242934;
		border-radius: 0.65rem;
	}

	.patch--current {
		border-color: #0e7490;
		box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.25);
	}

	.patch__name {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 700;
		color: #f1f5f9;
		overflow-wrap: anywhere;
	}

	.patch__meta {
		margin: 0.15rem 0 0.45rem;
		font-size: 0.7rem;
		color: #64748b;
	}

	.patch__actions {
		display: flex;
		gap: 0.35rem;
	}
</style>
