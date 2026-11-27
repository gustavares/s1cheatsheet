export type MainViewMode = 'all' | 'pinned' | 'studio';
export type StudioTab = 'patches' | 'drills' | 'lessons' | 'keystep' | 'sequencer' | 'recorder';

class UiStore {
	viewMode = $state<MainViewMode>('all');
	studioTab = $state<StudioTab>('patches');
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
