/**
 * @file patches.svelte.ts
 * @description Patch library: saves the live S-1 parameter state under a name, keeps the
 * library in localStorage (same JSON format as the export file) and recalls patches by sending
 * their CCs to the S-1.
 */
import {
	createPatch,
	exportPatches,
	MAX_NAME_LENGTH,
	parsePatchFile,
	recallMessages,
	type Patch
} from '#lib/patches.js';
import { midiStore } from './midi.svelte.js';

const STORAGE_KEY = 's1-patches-v1';

class PatchStore {
	patches = $state<Patch[]>([]);
	/** The patch last saved or recalled (the jam recorder names takes after it). */
	currentId = $state<string | null>(null);
	#loaded = false;

	get current(): Patch | null {
		return this.patches.find((p) => p.id === this.currentId) ?? null;
	}

	/** Reads the library from localStorage once (browser only). */
	load() {
		if (this.#loaded || typeof localStorage === 'undefined') return;
		this.#loaded = true;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) this.patches = parsePatchFile(raw).patches;
		} catch {
			// Unreadable storage: start with an empty library rather than failing.
		}
	}

	#persist() {
		try {
			localStorage.setItem(STORAGE_KEY, exportPatches(this.patches));
		} catch {
			// Storage full or blocked (private mode): the library still works for this session.
		}
	}

	/** Saves the live parameter state (every CC seen since connecting) as a new patch. */
	saveCurrent(name: string): Patch {
		const patch = createPatch(name, midiStore.values);
		this.patches = [patch, ...this.patches];
		this.currentId = patch.id;
		this.#persist();
		return patch;
	}

	/** Saves an explicit set of values (e.g. a drill target) as a new patch. */
	saveValues(name: string, values: Record<string, number>): Patch {
		const patch = createPatch(name, values);
		this.patches = [patch, ...this.patches];
		this.#persist();
		return patch;
	}

	rename(id: string, name: string) {
		const clean = name.trim().slice(0, MAX_NAME_LENGTH);
		if (!clean) return;
		this.patches = this.patches.map((p) => (p.id === id ? { ...p, name: clean } : p));
		this.#persist();
	}

	remove(id: string) {
		this.patches = this.patches.filter((p) => p.id !== id);
		if (this.currentId === id) this.currentId = null;
		this.#persist();
	}

	/** Sends the patch's CCs to the S-1. Returns how many were sent (0 if not connected). */
	recall(id: string): number {
		const patch = this.patches.find((p) => p.id === id);
		if (!patch) return 0;
		const sent = midiStore.sendControlChanges(recallMessages(patch.values));
		if (sent > 0) this.currentId = id;
		return sent;
	}

	exportAll(): string {
		return exportPatches(this.patches);
	}

	/** Imports an exported file; patches whose id already exists get a fresh id. */
	importText(text: string): { added: number; skipped: number } {
		const { patches, skipped } = parsePatchFile(text);
		const existing = this.patches.map((p) => p.id);
		const fresh = patches.map((p) =>
			existing.includes(p.id) ? { ...createPatch(p.name, p.values), createdAt: p.createdAt } : p
		);
		this.patches = [...fresh, ...this.patches];
		this.#persist();
		return { added: fresh.length, skipped };
	}
}

export const patchStore = new PatchStore();
