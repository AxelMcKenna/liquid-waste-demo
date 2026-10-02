// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider } from '../store/context';
import { DemoStore } from '../store/store';
import { createIdbStorage, type StorageAdapter } from '../store/storage';
import { JobDrawer } from './JobDrawer';
import { OfficeView } from './Office';
import { DispatchView } from './Dispatch';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const clock = { now: () => '2026-10-02T10:15:00+13:00' };
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});
const DriverDrawer = () => <JobDrawer role="driver" />;
async function mount(store: DemoStore, path: string, View: ComponentType = DriverDrawer) {
  document.body.innerHTML = '<div id="root"></div>';
  const router = createMemoryRouter([{ path: '*', element: <View /> }], { initialEntries: [path] });
  root = createRoot(document.getElementById('root')!);
  await act(async () => root!.render(<StoreProvider store={store}><RouterProvider router={router} /></StoreProvider>));
  return router;
}
const button = (name: string) => Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.trim() === name || element.getAttribute('aria-label') === name)!;
async function click(name: string) {
  expect(button(name), `button ${name}`).toBeDefined();
  await act(async () => button(name).click());
}
async function input(selector: string, value: string) {
  const element = document.querySelector<HTMLInputElement>(selector)!;
  expect(element).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function settle(check: () => void) {
  // Let IndexedDB transactions and the corresponding React render settle together.
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    try { check(); return; } catch (error) { if (attempt === 99) throw error; }
  }
}
async function fixture(driver = true) {
  const storage = createIdbStorage(`forms-${crypto.randomUUID()}`);
  let fail = false;
  let delay: Promise<void> | undefined;
  const wrapped: StorageAdapter = { ...storage, commit: async (update) => {
    if (delay) await delay;
    if (fail) throw new Error('quota');
    return storage.commit(update);
  } };
  const store = new DemoStore(wrapped, clock);
  await store.init();
  if (driver) {
    await store.dispatch({ type: 'assign', jobId: 'J101', truckId: 'T01' });
    await store.dispatch({ type: 'start', jobId: 'J101' });
    await store.dispatch({ type: 'addPhoto', jobId: 'J101', photo: { stage: 'before', source: 'sample', name: 'Sample', mime: 'image/svg+xml', sampleUrl: '/sample.svg' } });
  }
  return { store, storage, fail: (value: boolean) => { fail = value; }, delay: (value?: Promise<void>) => { delay = value; } };
}

describe('collection draft navigation', () => {
  it('saves rapid review and close before the debounce fires', async () => {
    const { store, storage } = await fixture();
    await mount(store, '/driver?job=J101');
    await input('.input-litres', '650');
    await click('Review collection');
    await settle(() => expect(button('Confirm collection')).toBeDefined());
    await click('Close');
    expect((await storage.load())!.drafts.J101.litres).toBe('650');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('flushes rapid close and browser-style back navigation', async () => {
    const { store, storage } = await fixture();
    const router = await mount(store, '/driver');
    await act(async () => { await router.navigate('/driver?job=J101'); });
    await input('.input-litres', '700');
    await act(async () => { await router.navigate(-1); });
    await settle(() => expect(router.state.location.search).toBe(''));
    expect((await storage.load())!.drafts.J101.litres).toBe('700');
    await act(async () => { await router.navigate('/driver?job=J101'); });
    await input('.input-litres', '725');
    await click('Close');
    await settle(() => expect(router.state.location.search).toBe(''));
    expect((await storage.load())!.drafts.J101.litres).toBe('725');
  });

  it('keeps edits on failed navigation save and retries without losing them', async () => {
    const f = await fixture();
    const router = await mount(f.store, '/driver?job=J101');
    await input('.input-litres', '650');
    f.fail(true);
    await click('Close');
    await settle(() => expect(document.body.textContent).toContain('Draft not saved'));
    expect(router.state.location.search).toBe('?job=J101');
    expect(document.querySelector<HTMLInputElement>('.input-litres')!.value).toBe('650');
    expect((await f.storage.load())!.drafts.J101.litres).toBe('');
    f.fail(false);
    await click('Retry save and leave');
    await settle(() => expect(router.state.location.search).toBe(''));
    expect((await f.storage.load())!.drafts.J101.litres).toBe('650');
  });

  it('stays on the form if saving before review fails', async () => {
    const f = await fixture();
    await mount(f.store, '/driver?job=J101');
    await input('.input-litres', '650');
    f.fail(true);
    await click('Review collection');
    expect(button('Confirm collection')).toBeUndefined();
    expect(document.querySelector<HTMLInputElement>('.input-litres')!.value).toBe('650');
    expect(document.body.textContent).toContain('Could not save on this device');
    f.fail(false);
    await click('Review collection');
    await settle(() => expect(button('Confirm collection')).toBeDefined());
  });

  it('preserves newer typing while a slow save and close are in flight', async () => {
    const f = await fixture();
    const router = await mount(f.store, '/driver?job=J101');
    let release!: () => void;
    f.delay(new Promise<void>((resolve) => { release = resolve; }));
    await input('.input-litres', '650');
    await click('Save draft');
    await input('.input-litres', '800');
    await click('Close');
    await act(async () => { f.delay(); release(); });
    await settle(() => expect(router.state.location.search).toBe(''));
    expect((await f.storage.load())!.drafts.J101.litres).toBe('800');
  });

  it('autosaves idle edits and protects a hard refresh while dirty', async () => {
    const { store, storage } = await fixture();
    await mount(store, '/driver?job=J101');
    await input('.input-litres', '650');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await settle(() => expect(store.state.drafts.J101.litres).toBe('650'));
    expect((await storage.load())!.drafts.J101.litres).toBe('650');
  });
});

describe('invoice edit persistence', () => {
  it('clears dirty state after normalized rate, tax, and description saves', async () => {
    const { store, storage } = await fixture(false);
    const router = await mount(store, '/office?tab=drafts&invoice=D107', OfficeView);
    await input('#rate-J107-base', '200');
    await input('#tax-rate', '12.50');
    await input('#desc-J107-base', '  Updated base charge  ');
    await click('Save draft changes');
    await settle(() => expect(button('Save draft changes').disabled).toBe(true));
    expect((await storage.load())!.invoices.D107.lines[0]).toMatchObject({ unitRate: 2_000_000, description: 'Updated base charge' });
    await act(async () => { await router.navigate('/office'); });
    expect(document.body.textContent).not.toContain('Discard unsaved changes?');
    expect(router.state.location.search).toBe('');
  });

  it('retains unsaved edits on failed save and clears them only after retry', async () => {
    const f = await fixture(false);
    await mount(f.store, '/office?tab=drafts&invoice=D107', OfficeView);
    await input('#rate-J107-base', '200');
    f.fail(true);
    await click('Save draft changes');
    expect(button('Save draft changes').disabled).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#rate-J107-base')!.value).toBe('200');
    f.fail(false);
    await click('Save draft changes');
    await settle(() => expect(button('Save draft changes').disabled).toBe(true));
  });

  it('does not overwrite newer edits when an earlier invoice save completes', async () => {
    const f = await fixture(false);
    await mount(f.store, '/office?tab=drafts&invoice=D107', OfficeView);
    let release!: () => void;
    f.delay(new Promise<void>((resolve) => { release = resolve; }));
    await input('#rate-J107-base', '200');
    await click('Save draft changes');
    await input('#rate-J107-base', '210');
    await act(async () => { f.delay(); release(); });
    await settle(() => expect(f.store.state.invoices.D107.lines[0].unitRate).toBe(2_000_000));
    expect(document.querySelector<HTMLInputElement>('#rate-J107-base')!.value).toBe('210');
    expect(button('Save draft changes').disabled).toBe(false);
    await click('Save draft changes');
    await settle(() => expect(button('Save draft changes').disabled).toBe(true));
    expect((await f.storage.load())!.invoices.D107.lines[0].unitRate).toBe(2_100_000);
  });
});

describe('transactional assignment feedback', () => {
  it('shows an incompatible-truck error after async validation without changing the job', async () => {
    const { store, storage } = await fixture(false);
    await mount(store, '/dispatch', DispatchView);
    await click('Assign J108');
    const radio = document.querySelector<HTMLInputElement>('input[type="radio"][value="T01"]')!;
    expect(radio).toBeTruthy();
    await act(async () => radio.click());
    const assign = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((element) => element.textContent?.trim() === 'Assign')!;
    await act(async () => assign.click());
    await settle(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('grease waste only'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect((await storage.load())!.jobs.J108.status).toBe('unassigned');
    expect(store.state.jobs.J108.truckId).toBeUndefined();
  });
});

describe('URL-driven dispatch search', () => {
  it('filters after the router update and restores all jobs when cleared', async () => {
    const { store } = await fixture(false);
    const router = await mount(store, '/dispatch', DispatchView);
    await input('input[type="search"]', 'Ridge');
    await settle(() => {
      expect(router.state.location.search).toBe('?q=Ridge');
      const rows = document.querySelectorAll('.jobs-table tbody tr');
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('Ridge');
    });
    await click('Clear filters');
    await settle(() => {
      expect(router.state.location.search).toBe('');
      expect(document.querySelectorAll('.jobs-table tbody tr')).toHaveLength(8);
    });
  });
});

describe('truck run load summary', () => {
  it('shows unreconciled collected litres until disposal is reconciled', async () => {
    const { store } = await fixture(false);
    await mount(store, '/dispatch', DispatchView);
    const truck = () => Array.from(document.querySelectorAll('.run')).find((element) => element.querySelector('.run-name')?.textContent?.includes('T03'))!;
    expect(truck().querySelector('.run-load > .mono')?.textContent).toBe('2,300 L');
    expect(truck().querySelector('.run-status')?.textContent).toContain('awaiting disposal');
    expect(truck().querySelector('.run-status')?.textContent).toContain('no open load');
    expect(truck().querySelector<HTMLElement>('.meter span')!.style.width).toBe('38%');
    await act(async () => {
      await store.dispatch({ type: 'acceptDifference', loadId: 'L103', reason: 'Demo meter variance' });
      await store.dispatch({ type: 'reconcile', loadId: 'L103' });
    });
    expect(truck().querySelector('.run-load > .mono')?.textContent).toBe('0 L');
    expect(truck().querySelector('.run-status')?.textContent).toBe('No open load');
    expect(truck().textContent).toContain('New load');
  });
});
