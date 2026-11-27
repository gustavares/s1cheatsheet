export type MainViewMode = 'all' | 'pinned' | 'studio';
export type StudioTab = 'patches' | 'drills' | 'lessons' | 'keystep' | 'sequencer' | 'recorder';

class UiStore {
	viewMode = $state<MainViewMode>('all');
	studioTab = $state<StudioTab>('patches');
	/** Target knob positions (CC → value) drawn as orange ticks on the panel (drill "Reveal"). */
	ghostValues = $state.raw<Record<string, number> | null>(null);
	/** Controls the current lesson step points at (they pulse on the drawing). */
	lessonHighlight = $state.raw<string[]>([]);
	showFaceplate = $state(true);
	showPrintModal = $state(false);

	setViewMode(mode: MainViewMode) {
		this.viewMode = mode;
	}

	openStudio(tab: StudioTab) {
		this.studioTab = tab;
		this.viewMode = 'studio';
	}

	toggleFaceplate() {
		this.showFaceplate = !this.showFaceplate;
	}

	openPrintModal() {
		this.showPrintModal = true;
	}

	closePrintModal() {
		this.showPrintModal = false;
	}
}

export const uiStore = new UiStore();
