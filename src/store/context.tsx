import { createContext, useCallback, useContext, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DomainError, type Command, type CommandResult } from '../domain/logic';
import type { DemoState } from '../domain/types';
import { DemoStore, SaveError } from './store';

const StoreContext = createContext<DemoStore | null>(null);

export type SaveState = 'saved' | 'saving' | 'failed';
const SaveStateContext = createContext<{ saveState: SaveState; setSaveState: (s: SaveState) => void }>({ saveState: 'saved', setSaveState: () => {} });

export function StoreProvider({ store, children }: { store: DemoStore; children: ReactNode }) {
  const [saveState, setSaveState] = useState<SaveState>('saved');
  return (
    <StoreContext.Provider value={store}>
      <SaveStateContext.Provider value={{ saveState, setSaveState }}>{children}</SaveStateContext.Provider>
    </StoreContext.Provider>
  );
}

export function useStore(): DemoStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreProvider missing');
  return store;
}

export function useDemo(): DemoState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}

export const useSaveState = () => useContext(SaveStateContext);

export interface CommandRunner {
  run: (cmd: Command, mutationId?: string) => Promise<CommandResult | undefined | null>;
  pending: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
  clearError: () => void;
}

/**
 * Runs commands with pending state and user-facing errors. Resolves to null
 * on failure so callers can branch without try/catch.
 */
export function useCommand(): CommandRunner {
  const store = useStore();
  const { setSaveState } = useSaveState();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(false);

  const run = useCallback(
    async (cmd: Command, mutationId?: string) => {
      // Repeated clicks while a write is pending are ignored; the mutation key covers anything that slips through.
      if (inFlight.current) return null;
      inFlight.current = true;
      setPending(true);
      setSaveState('saving');
      try {
        const result = await store.dispatch(cmd, mutationId);
        setError(null);
        setFieldErrors({});
        setSaveState('saved');
        return result;
      } catch (e) {
        if (e instanceof DomainError) {
          setError(e.message);
          setFieldErrors(e.fieldErrors ?? {});
          setSaveState('saved');
        } else {
          setError(e instanceof SaveError ? e.message : 'Could not save on this device. Your changes are still here.');
          setSaveState('failed');
        }
        return null;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [store, setSaveState],
  );

  const clearError = useCallback(() => {
    setError(null);
    setFieldErrors({});
  }, []);

  return { run, pending, error, fieldErrors, clearError };
}
