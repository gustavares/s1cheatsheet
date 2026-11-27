/**
 * @file takes.ts
 * @description Jam takes kept in IndexedDB (audio is far too big for localStorage): the WAV file,
 * its waveform peaks and the S-1 sound that was loaded when it was recorded.
 */

export interface Take {
	id: string;
	name: string;
	createdAt: number;
	/** Seconds. */
	duration: number;
	sampleRate: number;
	channelCount: number;
	/** Min/max pairs for drawing (see computePeaks). */
	peaks: Float32Array;
	/** The patch that was loaded (recalled or saved) when recording started, if any. */
	patch: { id: string; name: string } | null;
	/** The S-1 knob values the page had seen when recording started. */
	values: Record<string, number>;
	wav: Blob;
}

const DB_NAME = 's1-jams';
const STORE = 'takes';

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB is not available'));
			return;
		}
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE)) {
				request.result.createObjectStore(STORE, { keyPath: 'id' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Couldn’t open IndexedDB'));
	});
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>) {
	return open().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(STORE, mode);
				const request = body(tx.objectStore(STORE));
				tx.oncomplete = () => {
					db.close();
					resolve(request.result);
				};
				tx.onerror = tx.onabort = () => {
					db.close();
					reject(tx.error ?? request.error ?? new Error('IndexedDB request failed'));
				};
			})
	);
}

export async function listTakes(): Promise<Take[]> {
	const takes = await run<Take[]>('readonly', (store) => store.getAll() as IDBRequest<Take[]>);
	return takes.sort((a, b) => b.createdAt - a.createdAt);
}

export function saveTake(take: Take): Promise<IDBValidKey> {
	return run('readwrite', (store) => store.put(take));
}

export function deleteTake(id: string): Promise<undefined> {
	return run('readwrite', (store) => store.delete(id));
}
