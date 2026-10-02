import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createFixtures } from '../domain/fixtures';
import { DomainError, loadTotal, type CollectionInput } from '../domain/logic';
import { DemoStore } from './store';
import { createIdbStorage, type StorageAdapter } from './storage';

const clock = { now: () => '2026-10-02T10:15:00+13:00' };
const database = () => `persistence-${crypto.randomUUID()}`;
const sample = { stage: 'before' as const, source: 'sample' as const, name: 'Sample', mime: 'image/svg+xml', sampleUrl: '/sample.svg' };
const input = (photoIds: string[]): CollectionInput => ({ litres: '650', photoIds, extraWork: false, extraDescription: '', extraMinutes: '', notes: '' });
async function pair() {
  const name = database();
  const storage = createIdbStorage(name);
  const a = new DemoStore(storage, clock);
  const b = new DemoStore(createIdbStorage(name), clock);
  await Promise.all([a.init(), b.init()]);
  return { a, b, storage };
}

describe('transactional browser persistence', () => {
  it('preserves independent writes from stale instances, including concurrent commands', async () => {
    const { a, b, storage } = await pair();
    await Promise.all([
      a.dispatch({ type: 'assign', jobId: 'J101', truckId: 'T01' }, 'assign-a'),
      b.dispatch({ type: 'assign', jobId: 'J108', truckId: 'T02' }, 'assign-b'),
    ]);
    const saved = (await storage.load())!;
    expect(saved.jobs.J101.status).toBe('assigned');
    expect(saved.jobs.J108.status).toBe('assigned');
    expect(saved.appliedMutations).toMatchObject({ 'assign-a': true, 'assign-b': true });
    expect(new Set(saved.activity.map((event) => event.id)).size).toBe(saved.activity.length);
  });

  it('revalidates a stale command against committed state', async () => {
    const { a, b, storage } = await pair();
    await a.dispatch({ type: 'assign', jobId: 'J101', truckId: 'T01' });
    await a.dispatch({ type: 'start', jobId: 'J101' });
    await expect(b.dispatch({ type: 'assign', jobId: 'J101', truckId: 'T03' })).rejects.toBeInstanceOf(DomainError);
    expect((await storage.load())!.jobs.J101).toMatchObject({ status: 'in_progress', truckId: 'T01' });
    await b.dispatch({ type: 'assign', jobId: 'J108', truckId: 'T02' });
    expect(b.state.jobs.J101.status).toBe('in_progress');
  });

  it('checks mutation IDs inside the transaction across tabs', async () => {
    const { a, b, storage } = await pair();
    await a.dispatch({ type: 'assign', jobId: 'J101', truckId: 'T01' });
    await a.dispatch({ type: 'start', jobId: 'J101' });
    const photo = await a.dispatch({ type: 'addPhoto', jobId: 'J101', photo: sample });
    const command = { type: 'confirmCollection' as const, jobId: 'J101', input: input([photo!.ref!]) };
    const results = await Promise.all([a.dispatch(command, 'confirm'), b.dispatch(command, 'confirm')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(loadTotal((await storage.load())!.loads.L101)).toBe(1100);
    expect(b.state.jobs.J101.status).toBe('collected');
  });

  it('rejects stale photo evidence removed in another tab', async () => {
    const { a, b, storage } = await pair();
    await a.dispatch({ type: 'assign', jobId: 'J101', truckId: 'T01' });
    await a.dispatch({ type: 'start', jobId: 'J101' });
    const photo = await a.dispatch({ type: 'addPhoto', jobId: 'J101', photo: sample });
    await a.dispatch({ type: 'removePhoto', jobId: 'J101', photoId: photo!.ref! });
    await expect(b.dispatch({ type: 'confirmCollection', jobId: 'J101', input: input([photo!.ref!]) })).rejects.toMatchObject({ fieldErrors: { photos: expect.stringMatching(/Photo evidence changed/) } });
    expect((await storage.load())!.jobs.J101.status).toBe('in_progress');
  });

  it('rolls back state and blob clearing when a later write fails', async () => {
    const storage = createIdbStorage(database());
    const original = createFixtures();
    await storage.commit(() => ({ state: original, putBlobs: [{ id: 'original', blob: new Blob(['photo']) }] }));
    const changed = createFixtures();
    changed.seq++;
    await expect(storage.commit(() => ({
      state: changed, clearBlobs: true,
      putBlobs: [{ id: 'uncloneable', blob: (() => undefined) as unknown as Blob }],
    }))).rejects.toThrow();
    expect(await storage.load()).toEqual(original);
    expect(await storage.getBlob('original')).toBeDefined();
    expect(await storage.getBlob('uncloneable')).toBeUndefined();
  });

  it('keeps persisted state and photos after failed reset, then retries safely', async () => {
    const storage = createIdbStorage(database());
    let fail = false;
    const wrapped: StorageAdapter = { ...storage, commit: (update) => {
      if (fail) return Promise.reject(new Error('quota'));
      return storage.commit(update);
    } };
    const store = new DemoStore(wrapped, clock);
    await store.init();
    await store.dispatch({ type: 'assign', jobId: 'J101', truckId: 'T01' });
    await storage.commit((state) => ({ state: state!, putBlobs: [{ id: 'upload', blob: new Blob(['photo']) }] }));
    const before = await storage.load();
    fail = true;
    await expect(store.reset()).rejects.toThrow('quota');
    expect(await storage.load()).toEqual(before);
    expect(store.state).toEqual(before);
    expect(await storage.getBlob('upload')).toBeDefined();
    fail = false;
    await store.reset();
    expect(await storage.load()).toEqual(createFixtures());
    expect(await storage.getBlob('upload')).toBeUndefined();
  });

  it('serializes reset with immediately following commands', async () => {
    const { a, storage } = await pair();
    await a.dispatch({ type: 'assign', jobId: 'J101', truckId: 'T01' });
    await Promise.all([a.reset(), a.dispatch({ type: 'assign', jobId: 'J108', truckId: 'T02' })]);
    expect((await storage.load())!.jobs.J101.status).toBe('unassigned');
    expect((await storage.load())!.jobs.J108.status).toBe('assigned');
  });
});
