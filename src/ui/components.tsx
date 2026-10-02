import {
  AlertTriangle, Ban, CheckCircle2, Circle, CircleDashed, Clock3, FileText, Loader2, X, type LucideIcon,
} from 'lucide-react';
import {
  useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject,
} from 'react';
import { useBlocker } from 'react-router-dom';
import { useStore } from '../store/context';
import type { Photo } from '../domain/types';

/* ---------- Button ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost';
  icon?: LucideIcon;
  pending?: boolean;
  size?: 'md' | 'lg';
};

export function Button({ variant = 'secondary', icon: Icon, pending, size = 'md', children, className = '', disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size} ${className}`}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...rest}
    >
      {pending ? <Loader2 className="icon spin" aria-hidden /> : Icon && <Icon className="icon" aria-hidden />}
      {children}
    </button>
  );
}

/* ---------- Status chip: icon + word, never colour alone ---------- */

export type Tone = 'success' | 'warning' | 'error' | 'neutral';
const TONE_ICON: Record<Tone, LucideIcon> = { success: CheckCircle2, warning: Clock3, error: AlertTriangle, neutral: Circle };

export function Chip({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: LucideIcon }) {
  const Icon = icon ?? TONE_ICON[tone];
  return (
    <span className={`chip chip-${tone}`}>
      <Icon className="chip-icon" aria-hidden />
      {children}
    </span>
  );
}

export const JOB_TONE = { unassigned: 'neutral', assigned: 'neutral', in_progress: 'warning', collected: 'success', blocked: 'error' } as const;
export const JOB_ICON = { unassigned: CircleDashed, assigned: Circle, in_progress: Clock3, collected: CheckCircle2, blocked: Ban } as const;
export const BILLING_TONE = { not_ready: 'neutral', review_required: 'warning', ready: 'success', draft: 'neutral' } as const;
export const BILLING_ICON = { not_ready: CircleDashed, review_required: AlertTriangle, ready: CheckCircle2, draft: FileText } as const;

/* ---------- Form field ---------- */

export function Field({
  label, error, hint, children, id,
}: { label: string; error?: string; hint?: ReactNode; children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode; id?: string }) {
  const auto = useId();
  const fieldId = id ?? auto;
  const describedBy = [hint ? `${fieldId}-hint` : '', error ? `${fieldId}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${error ? 'field-invalid' : ''}`}>
      <label htmlFor={fieldId} className="field-label">{label}</label>
      {hint && <p id={`${fieldId}-hint`} className="field-hint">{hint}</p>}
      {children({ id: fieldId, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error && (
        <p id={`${fieldId}-error`} className="field-error">
          <AlertTriangle className="icon-sm" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

/* ---------- Alerts ---------- */

export function ErrorSummary({ message, errors }: { message: string | null; errors?: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  if (!message) return null;
  const list = Object.values(errors ?? {});
  return (
    <div ref={ref} className="alert alert-error" role="alert" tabIndex={-1}>
      <AlertTriangle className="icon" aria-hidden />
      <div>
        <p className="alert-title">{message}</p>
        {list.length > 0 && (
          <ul>{list.map((e) => <li key={e}>{e}</li>)}</ul>
        )}
      </div>
    </div>
  );
}

export function Notice({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const Icon = TONE_ICON[tone];
  return (
    <div className={`alert alert-${tone}`}>
      <Icon className="icon" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/* ---------- Focus trap for modal surfaces ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: RefObject<HTMLElement | null>, onEscape: () => void) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        escape.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (items.length === 0) return;
      const [a, b] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        b.focus();
      } else if (!e.shiftKey && document.activeElement === b) {
        e.preventDefault();
        a.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      // If the opener was replaced (e.g. Assign became Open), return focus to its successor.
      const key = previous?.dataset.focusKey;
      requestAnimationFrame(() => {
        if (previous && document.contains(previous)) previous.focus();
        else if (key) document.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)?.focus();
      });
    };
  }, [ref]);
}

/* ---------- Side drawer (modal, overlays the workspace) ---------- */

export function Drawer({
  title, subtitle, onClose, children, footer, labelId, side = 'right',
}: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; labelId?: string; side?: 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const auto = useId();
  const titleId = labelId ?? auto;
  useFocusTrap(ref, onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`drawer drawer-${side}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="drawer-header">
          <div>
            <h2 id={titleId} className="panel-title">{title}</h2>
            {subtitle && <div className="drawer-subtitle">{subtitle}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X className="icon" aria-hidden />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-footer">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------- Centered dialog ---------- */

export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, onClose);
  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="section-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Blocks in-app navigation (including closing URL-driven drawers) while `dirty`. */
export function UnsavedGuard({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);
  if (blocker.state !== 'blocked') return null;
  return (
    <Dialog
      title="Discard unsaved changes?"
      onClose={() => blocker.reset()}
      footer={
        <>
          <Button onClick={() => blocker.reset()} data-autofocus>Keep editing</Button>
          <Button variant="destructive" onClick={() => blocker.proceed()}>Discard changes</Button>
        </>
      }
    >
      <p>You have edits that haven't been saved on this device.</p>
    </Dialog>
  );
}

/* ---------- Photos ---------- */

export function PhotoThumb({ photo, size = 72 }: { photo: Photo; size?: number }) {
  const store = useStore();
  const [url, setUrl] = useState<string | undefined>(photo.sampleUrl);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (photo.source !== 'upload') return;
    let objectUrl: string | undefined;
    let live = true;
    store.getBlob(photo.id).then((blob) => {
      if (!live) return;
      if (!blob) return setMissing(true);
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.id, photo.source, store]);
  const alt = `${photo.stage === 'before' ? 'Before' : 'After'} photo${photo.source === 'sample' ? ' (built-in sample illustration)' : `: ${photo.name}`}`;
  return (
    <figure className="thumb" style={{ width: size }}>
      {missing ? <div className="thumb-missing" style={{ height: size }}>Image unavailable</div> : url && <img src={url} alt={alt} width={size} height={size} />}
      <figcaption>{photo.stage === 'before' ? 'Before' : 'After'}{photo.source === 'sample' ? ' · Sample' : ''}</figcaption>
    </figure>
  );
}

export function Meta({ items }: { items: { label: string; value: ReactNode; mono?: boolean }[] }) {
  return (
    <dl className="meta-band">
      {items.map((it) => (
        <div key={it.label}>
          <dt>{it.label}</dt>
          <dd className={it.mono ? 'mono' : undefined}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
