import { createFixtures, DEMO_DATE, FIXTURE_VERSION } from '../domain/fixtures';
import { applyCommand, DomainError, type Clock, type Command, type CommandResult } from '../domain/logic';
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
 * Commands are applied to the latest persisted state inside a single transaction.
 * This instance updates only after storage confirms the write; mutation IDs are
 * checked transactionally across instances. Reset uses the same local queue.
 */
export class DemoStore {
  state!: DemoState;
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private storage: StorageAdapter, private clock: Clock = demoClock) {}

  async init() {
    this.state = await this.storage.commit((saved) =>
      saved?.version === FIXTURE_VERSION
        ? { state: saved }
        : { state: createFixtures(), clearBlobs: true },
    );
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

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const promise = this.queue.then(run, run);
    this.queue = promise.catch(() => undefined);
    return promise;
  }

  dispatch(cmd: Command, mutationId?: string): Promise<CommandResult | undefined> {
    return this.enqueue(async () => {
      let result: CommandResult | undefined;
      try {
        this.state = await this.storage.commit((current) => {
          if (!current || current.version !== FIXTURE_VERSION) {
            throw new DomainError('Demo data changed. Reload this page before continuing.');
          }
          if (mutationId && current.appliedMutations[mutationId]) return { state: current };
          result = applyCommand(current, cmd, this.clock);
          if (mutationId) result.state.appliedMutations[mutationId] = true;
          return result;
        });
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new SaveError();
      }
      this.emit();
      return result;
    });
  }

  reset(): Promise<void> {
    return this.enqueue(async () => {
      const fresh = createFixtures();
      // Replacing state and removing uploaded blobs is one all-or-nothing transaction.
      this.state = await this.storage.commit(() => ({ state: fresh, clearBlobs: true }));
      this.emit();
    });
  }

  getBlob(id: string) {
    return this.storage.getBlob(id);
  }
}
