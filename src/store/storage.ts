import { openDB, type IDBPDatabase } from 'idb';
import type { DemoState } from '../domain/types';

export interface StorageChange {
  state: DemoState;
  putBlobs?: { id: string; blob: Blob }[];
  deleteBlobs?: string[];
  clearBlobs?: boolean;
}

export interface StorageAdapter {
  load(): Promise<DemoState | undefined>;
  /** Read the latest state and synchronously derive its replacement inside one transaction. */
  commit(update: (current: DemoState | undefined) => StorageChange): Promise<DemoState>;
  getBlob(id: string): Promise<Blob | undefined>;
}

const DB_NAME = 'liquid-waste-demo';

export function createIdbStorage(dbName = DB_NAME): StorageAdapter {
  let dbPromise: Promise<IDBPDatabase> | undefined;
  const db = () =>
    (dbPromise ??= openDB(dbName, 1, {
      upgrade(d) {
        d.createObjectStore('state');
        d.createObjectStore('blobs');
      },
    }));

  return {
    async load() {
      return (await db()).get('state', 'current');
    },
    async commit(update) {
      // IndexedDB serializes overlapping read/write transactions, including across tabs.
      // Never derive a new snapshot before acquiring this transaction.
      const tx = (await db()).transaction(['state', 'blobs'], 'readwrite');
      const writes: Promise<unknown>[] = [tx.done];
      try {
        const states = tx.objectStore('state');
        const change = update(await states.get('current'));
        const blobs = tx.objectStore('blobs');
        writes.push(states.put(change.state, 'current'));
        if (change.clearBlobs) writes.push(blobs.clear());
        for (const blob of change.putBlobs ?? []) writes.push(blobs.put(blob.blob, blob.id));
        for (const id of change.deleteBlobs ?? []) writes.push(blobs.delete(id));
        await Promise.all(writes);
        return change.state;
      } catch (error) {
        // A failed command or blob write must roll back the entire change, including reset.
        try { tx.abort(); } catch { /* The transaction may already have aborted. */ }
        await Promise.allSettled(writes);
        throw error;
      }
    },
    async getBlob(id) {
      return (await db()).get('blobs', id);
    },
  };
}
