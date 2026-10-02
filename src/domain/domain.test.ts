import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createFixtures } from './fixtures';
import {
  applyCommand, attentionRows, billingInfo, collectingLoad, disposalStatus, DomainError, loadTotal, validatePhotoFile,
  type Command, type CollectionInput,
} from './logic';
import { formatNzd, invoiceTotals, parsePercent, parseRate, rateToInput } from './pricing';
import { DemoStore, SaveError } from '../store/store';
import { createIdbStorage, type StorageAdapter } from '../store/storage';
import type { DemoState } from './types';

const clock = { now: () => '2026-10-02T10:15:00+13:00' };
const run = (s: DemoState, cmd: Command) => applyCommand(s, cmd, clock).state;
const sample = { stage: 'before' as const, source: 'sample' as const, name: 'Sample', mime: 'image/svg+xml', sampleUrl: '/x.svg' };
const input = (photoIds: string[], litres = '650', extra: Partial<CollectionInput> = {}): CollectionInput => ({
  litres, photoIds, extraWork: false, extraDescription: '', extraMinutes: '', notes: '', ...extra,
});

function memoryStorage(): StorageAdapter & { fail: boolean; saved?: DemoState } {
  const blobs = new Map<string, Blob>();
  const m = {
    fail: false,
    saved: undefined as DemoState | undefined,
    async load() { return m.saved && structuredClone(m.saved); },
    async commit(update: Parameters<StorageAdapter['commit']>[0]) {
      if (m.fail) throw new Error('quota');
      const change = update(m.saved && structuredClone(m.saved));
      m.saved = structuredClone(change.state);
      if (change.clearBlobs) blobs.clear();
      change.putBlobs?.forEach((b) => blobs.set(b.id, b.blob));
      change.deleteBlobs?.forEach((id) => blobs.delete(id));
      return change.state;
    },
    async getBlob(id: string) { return blobs.get(id); },
  };
  return m;
}

/** Assign J101 to T01, start, add a sample photo; returns state and photo id. */
function startJ101(s: DemoState) {
  s = run(s, { type: 'assign', jobId: 'J101', truckId: 'T01' });
  s = run(s, { type: 'start', jobId: 'J101' });
  const r = applyCommand(s, { type: 'addPhoto', jobId: 'J101', photo: sample }, clock);
  return { s: r.state, photoId: r.ref! };
}

describe('fixtures', () => {
  const s = createFixtures();
  it('has eight jobs on the demo day with consistent references', () => {
    expect(Object.keys(s.jobs)).toHaveLength(8);
    for (const job of Object.values(s.jobs)) {
      expect(s.sites[job.siteId]).toBeDefined();
      expect(s.sites[job.siteId].address).toMatch(/(Demo Lane|Sample Road)$/);
      if (job.truckId) expect(s.trucks[job.truckId].wasteType).toBe(job.service);
      if (job.collection) {
        expect(job.status).toBe('collected');
        const load = s.loads[job.loadId!];
        expect(load.contributions.filter((c) => c.jobId === job.id)).toEqual([{ jobId: job.id, litres: job.collection.litres }]);
        job.collection.photoIds.forEach((id) => expect(s.photos[id].jobId).toBe(job.id));
      } else expect(job.loadId).toBeUndefined();
    }
    for (const truck of Object.values(s.trucks)) truck.runOrder.forEach((id) => expect(s.jobs[id].truckId).toBe(truck.id));
  });
  it('seeds the specified loads and discrepancy', () => {
    expect(loadTotal(s.loads.L101)).toBe(450);
    expect(loadTotal(s.loads.L102)).toBe(0);
    expect(loadTotal(s.loads.L103)).toBe(2300);
    expect(s.disposals.DR103.reportedLitres).toBe(2200);
    expect(disposalStatus(s, s.loads.L103)).toBe('discrepancy');
    expect(collectingLoad(s, 'T03')).toBeUndefined();
    expect(s.invoiceByJob).toEqual({ J107: 'D107' });
    expect(billingInfo(s, 'J102').status).toBe('review_required');
    expect(billingInfo(s, 'J106').status).toBe('not_ready');
  });
});

describe('pricing', () => {
  it('prices J101 at 650 L as NZ$296.70', () => {
    let { s, photoId } = startJ101(createFixtures());
    s = run(s, { type: 'confirmCollection', jobId: 'J101', input: input([photoId]) });
    s = run(s, { type: 'finishLoad', loadId: 'L101' });
    s = run(s, { type: 'saveDisposal', loadId: 'L101', facility: 'South Yard Demo Facility', docketRef: 'SY-1', disposedAt: '2026-10-02T13:00', reportedLitres: '1100' });
    s = run(s, { type: 'reconcile', loadId: 'L101' });
    const r = applyCommand(s, { type: 'createDraft', jobId: 'J101' }, clock);
    const t = invoiceTotals(r.state.invoices[r.ref!]);
    expect(t).toEqual({ subtotal: 25800, tax: 3870, total: 29670 });
    expect(formatNzd(t.total)).toBe('NZ$296.70');
  });
  it('round-trips rates and percentages', () => {
    expect(rateToInput(1200)).toBe('0.12');
    expect(rateToInput(1_800_000)).toBe('180.00');
    expect(rateToInput(1250)).toBe('0.125');
    expect(parseRate('0.125')).toBe(1250);
    expect(parseRate('-1')).toBeNull();
    expect(parsePercent('15')).toBe(1500);
    expect(parsePercent('12.5')).toBe(1250);
    expect(parsePercent('101')).toBeNull();
  });
  it('bills approved extra work in 15-minute increments', () => {
    let s = createFixtures();
    s = run(s, { type: 'reviewExtra', jobId: 'J105', decision: 'approved', note: 'Confirmed with kitchen' });
    s = run(s, { type: 'acceptDifference', loadId: 'L103', reason: 'Facility meter reading' });
    s = run(s, { type: 'reconcile', loadId: 'L103' });
    const r = applyCommand(s, { type: 'createDraft', jobId: 'J105' }, clock);
    const inv = r.state.invoices[r.ref!];
    // 180 + 500*0.12 + 0.5h*90 = 285.00
    expect(invoiceTotals(inv).subtotal).toBe(28500);
  });
});

describe('dispatch rules', () => {
  it('rejects septic jobs on a grease truck', () => {
    const s = createFixtures();
    expect(() => run(s, { type: 'assign', jobId: 'J108', truckId: 'T01' })).toThrow(/grease waste only/);
    expect(() => run(s, { type: 'assign', jobId: 'J103', truckId: 'T03' })).toThrow(/can't mix/);
  });
  it('rejects over-capacity assignment', () => {
    const s = createFixtures();
    s.trucks.T01.capacityLitres = 1000;
    expect(() => run(s, { type: 'assign', jobId: 'J101', truckId: 'T01' })).toThrow(/over capacity/);
  });
  it('blocks reorder and reassignment after work starts', () => {
    let s = run(createFixtures(), { type: 'assign', jobId: 'J101', truckId: 'T01' });
    expect(() => run(s, { type: 'move', truckId: 'T01', jobId: 'J101', direction: -1 })).toThrow(/position is fixed/);
    s = run(s, { type: 'start', jobId: 'J101' });
    expect(() => run(s, { type: 'assign', jobId: 'J101', truckId: 'T03' })).toThrow(/already started/);
  });
  it('reorders pending stops', () => {
    let s = run(createFixtures(), { type: 'assign', jobId: 'J108', truckId: 'T02' });
    s = run(s, { type: 'resolveBlocked', jobId: 'J106' });
    s = run(s, { type: 'move', truckId: 'T02', jobId: 'J108', direction: -1 });
    expect(s.trucks.T02.runOrder).toEqual(['J103', 'J108', 'J106']);
  });
  it('cannot start on a truck whose load awaits disposal, then can after a new load', () => {
    let s = run(createFixtures(), { type: 'assign', jobId: 'J101', truckId: 'T03' });
    expect(() => run(s, { type: 'start', jobId: 'J101' })).toThrow(/awaiting disposal/);
    expect(() => run(s, { type: 'newLoad', truckId: 'T03' })).toThrow(/reconciled first/);
    s = run(s, { type: 'acceptDifference', loadId: 'L103', reason: 'Meter variance' });
    s = run(s, { type: 'reconcile', loadId: 'L103' });
    s = run(s, { type: 'newLoad', truckId: 'T03' });
    expect(collectingLoad(s, 'T03')?.id).toBe('L105');
    s = run(s, { type: 'start', jobId: 'J101' });
    expect(s.jobs.J101.status).toBe('in_progress');
  });
});

describe('collection', () => {
  it('validates litres and photos', () => {
    const { s, photoId } = startJ101(createFixtures());
    const check = (i: CollectionInput) => {
      try { run(s, { type: 'confirmCollection', jobId: 'J101', input: i }); } catch (e) { return (e as DomainError).fieldErrors; }
      return undefined;
    };
    expect(check(input([photoId], ''))?.litres).toMatch(/Enter the litres/);
    expect(check(input([photoId], '-5'))?.litres).toMatch(/positive whole/);
    expect(check(input([photoId], '12.5'))?.litres).toMatch(/positive whole/);
    expect(check(input([photoId], 'abc'))?.litres).toMatch(/positive whole/);
    expect(check(input([photoId], '0'))?.litres).toMatch(/positive whole/);
    expect(check(input([photoId], '5551'))?.litres).toMatch(/remaining capacity of 5,550 L/);
    expect(check(input([]))?.photos).toMatch(/at least one photo/);
    expect(check(input([photoId], '650', { extraWork: true }))?.extraDescription).toBeDefined();
  });
  it('validates photo files', () => {
    expect(validatePhotoFile({ type: 'image/gif', size: 10, name: 'a.gif' }, 0)).toMatch(/not a JPEG/);
    expect(validatePhotoFile({ type: 'image/png', size: 6 * 1024 * 1024, name: 'a.png' }, 0)).toMatch(/larger than 5 MB/);
    expect(validatePhotoFile({ type: 'image/webp', size: 10, name: 'a.webp' }, 3)).toMatch(/up to 3/);
    expect(validatePhotoFile({ type: 'image/jpeg', size: 10, name: 'a.jpg' }, 2)).toBeNull();
  });
  it('blocked visits contribute nothing and cannot be invoiced', () => {
    let s = run(createFixtures(), { type: 'block', jobId: 'J103', reason: 'Dog loose on site' });
    expect(s.jobs.J103.status).toBe('blocked');
    expect(loadTotal(s.loads.L102)).toBe(0);
    expect(() => run(s, { type: 'createDraft', jobId: 'J103' })).toThrow(/Visit blocked/);
    expect(() => run(s, { type: 'block', jobId: 'J104', reason: 'x' })).toThrow();
    expect(() => run(s, { type: 'block', jobId: 'J108', reason: '' })).toThrow();
  });
  it('completed collections are immutable', () => {
    const s = createFixtures();
    expect(() => run(s, { type: 'confirmCollection', jobId: 'J102', input: input(['P-J102-before']) })).toThrow(/only a job in progress/);
    expect(() => run(s, { type: 'setPhotoStage', photoId: 'P-J102-before', stage: 'after' })).toThrow();
  });
});

describe('office', () => {
  it('L103 stays blocked until discrepancy and extra work are reviewed', () => {
    let s = createFixtures();
    expect(attentionRows(s).map((r) => r.group).sort()).toEqual(['discrepancy', 'extra_work', 'missing_disposal']);
    expect(() => run(s, { type: 'reconcile', loadId: 'L103' })).toThrow(/Correct the disposal entry/);
    expect(() => run(s, { type: 'acceptDifference', loadId: 'L103', reason: ' ' })).toThrow();
    s = run(s, { type: 'acceptDifference', loadId: 'L103', reason: 'Facility meter reading' });
    expect(s.disposals.DR103.acceptedDifference).toEqual({ litres: 100, reason: 'Facility meter reading' });
    s = run(s, { type: 'reconcile', loadId: 'L103' });
    expect(s.jobs.J104.collection!.litres).toBe(1800);
    expect(billingInfo(s, 'J104').status).toBe('ready');
    expect(billingInfo(s, 'J105').blockers).toEqual(['Additional work awaiting office review']);
    s = run(s, { type: 'reviewExtra', jobId: 'J105', decision: 'declined', note: 'Included in contract' });
    expect(billingInfo(s, 'J105').status).toBe('ready');
    expect(s.activity.some((a) => a.message.includes('Accepted difference of 100 L'))).toBe(true);
  });
  it('correcting a disposal entry to match allows reconciling, and changing litres voids an acceptance', () => {
    let s = run(createFixtures(), { type: 'acceptDifference', loadId: 'L103', reason: 'x' });
    const base = { type: 'saveDisposal' as const, loadId: 'L103', facility: 'South Yard Demo Facility', docketRef: 'SY-DEMO-2213', disposedAt: '2026-10-02T09:40' };
    s = run(s, { ...base, reportedLitres: '2250' });
    expect(disposalStatus(s, s.loads.L103)).toBe('discrepancy');
    s = run(s, { ...base, reportedLitres: '2300' });
    expect(disposalStatus(s, s.loads.L103)).toBe('entered');
    expect(() => run(s, { ...base, facility: '', reportedLitres: '2300' })).toThrow(DomainError);
  });
  it('cannot add disposal to a collecting load or edit a reconciled one', () => {
    const s = createFixtures();
    const cmd = { type: 'saveDisposal' as const, facility: 'F', docketRef: 'D', disposedAt: '2026-10-02T09:40', reportedLitres: '450' };
    expect(() => run(s, { ...cmd, loadId: 'L101' })).toThrow(/Finish the load/);
    expect(() => run(s, { ...cmd, loadId: 'L104' })).toThrow(/reconciled/);
  });
  it('existing D107 stays a single draft', () => {
    const r = applyCommand(createFixtures(), { type: 'createDraft', jobId: 'J107' }, clock);
    expect(r.ref).toBe('D107');
    expect(Object.keys(r.state.invoices)).toEqual(['D107']);
  });
});

describe('store', () => {
  it('runs the J101 walkthrough exactly once despite double submissions and survives reload', async () => {
    const storage = createIdbStorage('test-walkthrough');
    const store = new DemoStore(storage, clock);
    await store.init();
    await store.dispatch({ type: 'assign', jobId: 'J101', truckId: 'T01' }, 'm-assign');
    await store.dispatch({ type: 'start', jobId: 'J101' }, 'm-start');
    const add = await store.dispatch({ type: 'addPhoto', jobId: 'J101', photo: { ...sample, source: 'upload', mime: 'image/png', sampleUrl: undefined }, blob: new Blob(['png'], { type: 'image/png' }) });
    const confirm = { type: 'confirmCollection' as const, jobId: 'J101', input: input([add!.ref!]) };
    await Promise.all([store.dispatch(confirm, 'm-collect'), store.dispatch(confirm, 'm-collect')]);

    const reloaded = new DemoStore(createIdbStorage('test-walkthrough'), clock);
    await reloaded.init();
    expect(loadTotal(reloaded.state.loads.L101)).toBe(1100);
    expect(reloaded.state.loads.L101.contributions.filter((c) => c.jobId === 'J101')).toHaveLength(1);
    expect(reloaded.state.activity.filter((a) => a.jobId === 'J101' && a.message.startsWith('Collection confirmed'))).toHaveLength(1);
    expect(await reloaded.getBlob(add!.ref!)).toBeDefined();

    await reloaded.dispatch({ type: 'finishLoad', loadId: 'L101' }, 'm-finish');
    await reloaded.dispatch({ type: 'saveDisposal', loadId: 'L101', facility: 'South Yard Demo Facility', docketRef: 'SY-9', disposedAt: '2026-10-02T13:00', reportedLitres: '1100' });
    await reloaded.dispatch({ type: 'reconcile', loadId: 'L101' }, 'm-rec');
    const drafts = await Promise.all([
      reloaded.dispatch({ type: 'createDraft', jobId: 'J101' }, 'draft:J101'),
      reloaded.dispatch({ type: 'createDraft', jobId: 'J101' }, 'draft:J101-second-tab'),
    ]);
    expect(drafts[0]!.ref).toBe('D101');
    expect(drafts[1]!.ref).toBe('D101');
    expect(Object.values(reloaded.state.invoices).filter((i) => i.jobId === 'J101')).toHaveLength(1);
    expect(invoiceTotals(reloaded.state.invoices.D101).total).toBe(29670);
  });

  it('keeps state unchanged when saving fails', async () => {
    const storage = memoryStorage();
    const store = new DemoStore(storage, clock);
    await store.init();
    storage.fail = true;
    await expect(store.dispatch({ type: 'assign', jobId: 'J101', truckId: 'T01' }, 'm1')).rejects.toBeInstanceOf(SaveError);
    expect(store.state.jobs.J101.status).toBe('unassigned');
    expect(store.state.appliedMutations.m1).toBeUndefined();
    storage.fail = false;
    await store.dispatch({ type: 'assign', jobId: 'J101', truckId: 'T01' }, 'm1');
    expect(store.state.jobs.J101.status).toBe('assigned');
  });

  it('reset restores exactly the fixtures', async () => {
    const storage = memoryStorage();
    const store = new DemoStore(storage, clock);
    await store.init();
    await store.dispatch({ type: 'assign', jobId: 'J101', truckId: 'T01' });
    await store.reset();
    expect(store.state).toEqual(createFixtures());
    expect(storage.saved).toEqual(createFixtures());
  });
});
