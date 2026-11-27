/**
 * @file viz.svelte.ts
 * @description Visualizer state shared with the studio tools: which view is shown, how many
 * cycles the scope draws, an optional target overlay (drills), and the latest locked live cycle.
 */

export type VizView = 'scope' | 'spectrum' | 'spectrogram';

export interface ScopeOverlay {
	/** One cycle of the target wave, starting at its rising zero crossing, peak-normalized. */
	cycle: Float32Array;
	label: string;
}

class VizStore {
	view = $state<VizView>('scope');
	cycles = $state(2);
	overlay = $state.raw<ScopeOverlay | null>(null);

	/** Latest locked live cycle (256 points, peak-normalized) and its pitch; updated ~10×/s. */
	liveCycle = $state.raw<Float32Array | null>(null);
	livePitch = $state<number | null>(null);
}

export const vizStore = new VizStore();
