import { ClipboardList, HardDrive, RotateCcw, Settings2, Smartphone, Truck, AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSaveState, useStore } from '../store/context';
import { Button, Dialog } from '../ui/components';

export const VIEWS = [
  { path: '/dispatch', label: 'Dispatch', icon: Truck },
  { path: '/driver', label: 'Driver', icon: Smartphone },
  { path: '/office', label: 'Office', icon: ClipboardList },
] as const;

function SaveIndicator() {
  const { saveState } = useSaveState();
  if (saveState === 'failed')
    return (
      <span className="save-state save-failed" role="status">
        <AlertTriangle className="icon-sm" aria-hidden /> Last change not saved
      </span>
    );
  return (
    <span className="save-state" role="status">
      {saveState === 'saving' ? <Loader2 className="icon-sm spin" aria-hidden /> : <HardDrive className="icon-sm" aria-hidden />}
      Fictional demo · {saveState === 'saving' ? 'Saving on this device…' : 'Saved on this device'}
    </span>
  );
}

function DemoControls({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = async () => {
    setBusy(true);
    try {
      await store.reset();
      onClose();
      navigate('/dispatch');
    } catch {
      setError('Could not reset the demo on this device.');
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Demo controls"
      onClose={onClose}
      footer={
        confirming ? (
          <>
            <Button onClick={() => setConfirming(false)} data-autofocus>Cancel</Button>
            <Button variant="destructive" icon={RotateCcw} pending={busy} onClick={reset}>Reset demo data</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="destructive" icon={RotateCcw} onClick={() => setConfirming(true)}>Reset demo…</Button>
          </>
        )
      }
    >
      {confirming ? (
        <p>This clears every change and photo saved by this demo on this device and restores the original fictional data for Fri 2 Oct 2026. Other sites' storage is untouched.</p>
      ) : (
        <p>All data is fictional and saved only in this browser. Nothing is sent to a server.</p>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </Dialog>
  );
}

export function Shell() {
  const [controlsOpen, setControlsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const current = VIEWS.find((v) => location.pathname.startsWith(v.path))?.path ?? '/dispatch';

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="wordmark">
          <span className="wordmark-mark" aria-hidden>LW</span>
          <span className="wordmark-text">Liquid Waste Demo</span>
        </div>
        <ul className="rail-list">
          {VIEWS.map(({ path, label, icon: Icon }) => (
            <li key={path}>
              <NavLink to={path} className="rail-link" title={label} aria-label={label}>
                <Icon className="icon" aria-hidden />
                <span className="rail-label">{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <button type="button" className="rail-link rail-bottom" onClick={() => setControlsOpen(true)} title="Demo controls" aria-label="Demo controls">
          <Settings2 className="icon" aria-hidden />
          <span className="rail-label">Demo controls</span>
        </button>
      </nav>

      <div className="main-col">
        <header className="topbar">
          <span className="mobile-wordmark">Liquid Waste Demo</span>
          <span className="topbar-date">Fri 2 Oct 2026</span>
          <label className="role-select">
            <span>Demo view</span>
            <select value={current} onChange={(e) => navigate(e.target.value)}>
              {VIEWS.map((v) => <option key={v.path} value={v.path}>{v.label}</option>)}
            </select>
          </label>
          <SaveIndicator />
          <button type="button" className="icon-btn mobile-only" onClick={() => setControlsOpen(true)} aria-label="Demo controls">
            <Settings2 className="icon" aria-hidden />
          </button>
        </header>
        <main className="workspace" id="main">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Main">
        {VIEWS.map(({ path, label, icon: Icon }) => (
          <NavLink key={path} to={path} className="bottom-link">
            <Icon className="icon" aria-hidden />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {controlsOpen && <DemoControls onClose={() => setControlsOpen(false)} />}
    </div>
  );
}
