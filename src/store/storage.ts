import { openDB, type IDBPDatabase } from 'idb';
import type { DemoState } from '../domain/types';

export interface StorageAdapter {
  load(): Promise<DemoState | undefined>;
  /** Writes state, new blobs and blob deletions in one transaction. */
  commit(state: DemoState, putBlobs: { id: string; blob: Blob }[], deleteBlobs: string[]): Promise<void>;
  getBlob(id: string): Promise<Blob | undefined>;
  /** Clears only this demo's database. */
  clear(): Promise<void>;
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
    async commit(state, putBlobs, deleteBlobs) {
      const tx = (await db()).transaction(['state', 'blobs'], 'readwrite');
      const blobs = tx.objectStore('blobs');
      await Promise.all([
        tx.objectStore('state').put(state, 'current'),
        ...putBlobs.map((b) => blobs.put(b.blob, b.id)),
        ...deleteBlobs.map((id) => blobs.delete(id)),
        tx.done,
      ]);
    },
    async getBlob(id) {
      return (await db()).get('blobs', id);
    },
    async clear() {
      const tx = (await db()).transaction(['state', 'blobs'], 'readwrite');
      await Promise.all([tx.objectStore('state').clear(), tx.objectStore('blobs').clear(), tx.done]);
    },
  };
}
