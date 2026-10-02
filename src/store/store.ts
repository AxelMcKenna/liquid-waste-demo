import { createFixtures, DEMO_DATE, FIXTURE_VERSION } from '../domain/fixtures';
import { applyCommand, type Clock, type Command, type CommandResult } from '../domain/logic';
import type { DemoState } from '../domain/types';
import type { StorageAdapter } from './storage';

/** Fixed demo date with the real Auckland time of day, so the seeded day never drifts. */
export const demoClock: Clock = {
  now() {
    const time = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date());
    return `${DEMO_DATE}T${time}+13:00`;
  },
};

export class SaveError extends Error {
  constructor() {
    super('Could not save on this device. Your changes are still here.');
  }
}

/**
 * Single typed domain store. Commands run one at a time; state only changes
 * after storage confirms the write. A repeated mutationId is a no-op.
 */
export class DemoStore {
  state!: DemoState;
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private storage: StorageAdapter, private clock: Clock = demoClock) {}

  async init() {
    const saved = await this.storage.load();
    if (saved && saved.version === FIXTURE_VERSION) {
      this.state = saved;
    } else {
      const fresh = createFixtures();
      await this.storage.clear();
      await this.storage.commit(fresh, [], []);
      this.state = fresh;
    }
    this.emit();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  dispatch(cmd: Command, mutationId?: string): Promise<CommandResult | undefined> {
    const run = async () => {
      if (mutationId && this.state.appliedMutations[mutationId]) return undefined;
      const result = applyCommand(this.state, cmd, this.clock);
      if (mutationId) result.state.appliedMutations[mutationId] = true;
      try {
        await this.storage.commit(result.state, result.putBlobs, result.deleteBlobs);
      } catch {
        throw new SaveError();
      }
      this.state = result.state;
      this.emit();
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async reset() {
    await this.queue;
    const fresh = createFixtures();
    await this.storage.clear();
    await this.storage.commit(fresh, [], []);
    this.state = fresh;
    this.emit();
  }

  getBlob(id: string) {
    return this.storage.getBlob(id);
  }
}
