import { Ban, ClipboardCheck, FileText, Play, RotateCcw, Save, Trash2, Truck as TruckIcon, Upload, Image as ImageIcon, ArrowLeft, Check, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SAMPLE_PHOTOS } from '../domain/fixtures';
import {
  billingInfo, customerOf, disposalStatus, driverOf, formatLitres, formatTime, remainingCapacity, siteOf, startBlocker,
  STATUS_LABEL, validateCollection, validatePhotoFile, PHOTO_TYPES, type CollectionInput, type FieldErrors,
} from '../domain/logic';
import type { DemoState, Job } from '../domain/types';
import { useCommand, useDemo, useStore } from '../store/context';
import {
  BILLING_ICON, BILLING_TONE, Button, Chip, Drawer, ErrorSummary, Field, JOB_ICON, JOB_TONE, Meta, Notice, PhotoThumb, UnsavedGuard,
} from '../ui/components';
import { AssignDialog } from './Dispatch';

export type ViewRole = 'dispatch' | 'driver' | 'office';

export function serviceLabel(job: Job) {
  return job.service === 'grease' ? 'Grease trap' : 'Septic tank';
}

/** Opens/closes the job drawer via the `job` search param so back/forward/refresh keep it. */
export function useJobParam() {
  const [params, setParams] = useSearchParams();
  return {
    jobId: params.get('job'),
    open: (id: string) => setParams((p) => { p.set('job', id); return p; }),
    close: () => setParams((p) => { p.delete('job'); return p; }),
  };
}

export function JobStatusChip({ job }: { job: Job }) {
  return <Chip tone={JOB_TONE[job.status]} icon={JOB_ICON[job.status]}>{STATUS_LABEL.job[job.status]}</Chip>;
}

export function JobDrawer({ role }: { role: ViewRole }) {
  const state = useDemo();
  const { jobId, close } = useJobParam();
  const job = jobId ? state.jobs[jobId] : undefined;
  if (!jobId) return null;
  if (!job)
    return (
      <Drawer title="Job not found" onClose={close}>
        <p>There is no job {jobId} in this demo.</p>
      </Drawer>
    );
  return <JobDrawerContent key={job.id} job={job} role={role} state={state} onClose={close} />;
}

type Mode = 'detail' | 'collect' | 'review' | 'block';

function JobDrawerContent({ job, role, state, onClose }: { job: Job; role: ViewRole; state: DemoState; onClose: () => void }) {
  const site = siteOf(state, job);
  const customer = customerOf(state, job);
  const truck = job.truckId ? state.trucks[job.truckId] : undefined;
  const [mode, setMode] = useState<Mode>(role === 'driver' && job.status === 'in_progress' ? 'collect' : 'detail');
  const [assigning, setAssigning] = useState(false);
  const cmd = useCommand();
  const navigate = useNavigate();

  const subtitle = (
    <span className="drawer-sub">
      <span className="mono">{job.id}</span> · {serviceLabel(job)} · <span className="mono">{job.windowStart}–{job.windowEnd}</span> <JobStatusChip job={job} />
    </span>
  );

  if (mode === 'collect' || mode === 'review') {
    return <CollectionForm job={job} state={state} mode={mode} setMode={setMode} onClose={onClose} title={customer.name} subtitle={subtitle} />;
  }
  if (mode === 'block') {
    return <BlockForm job={job} onDone={() => setMode('detail')} onClose={onClose} title={customer.name} subtitle={subtitle} />;
  }

  const billing = billingInfo(state, job.id);
  const blocker = startBlocker(state, job);
  const load = job.loadId ? state.loads[job.loadId] : undefined;
  const disposal = load?.disposalRecordId ? state.disposals[load.disposalRecordId] : undefined;
  const invoiceId = state.invoiceByJob[job.id];
  const extra = job.collection?.extraWork;

  let footer: React.ReactNode = null;
  if (role === 'dispatch') {
    if (job.status === 'unassigned' || job.status === 'assigned')
      footer = <Button variant="primary" icon={TruckIcon} onClick={() => setAssigning(true)}>{job.status === 'unassigned' ? 'Assign' : 'Reassign'}</Button>;
    else if (job.status === 'blocked')
      footer = <Button variant="primary" icon={RotateCcw} pending={cmd.pending} onClick={() => cmd.run({ type: 'resolveBlocked', jobId: job.id }, `resolve:${job.id}:${state.activity.length}`)}>Resolve blocked visit</Button>;
    else if (job.status === 'collected') footer = <p className="footer-note">Collected work is fixed. Office handles disposal and billing.</p>;
    else footer = <p className="footer-note">The driver has started this job, so it can't be reassigned.</p>;
  } else if (role === 'driver') {
    if (job.status === 'assigned')
      footer = (
        <>
          <Button icon={Ban} onClick={() => setMode('block')}>Can't complete</Button>
          <Button variant="primary" size="lg" icon={Play} pending={cmd.pending} disabled={!!blocker}
            onClick={async () => { if (await cmd.run({ type: 'start', jobId: job.id }, `start:${job.id}:${state.activity.length}`)) setMode('collect'); }}>
            Start job
          </Button>
        </>
      );
    else if (job.status === 'in_progress')
      footer = <Button variant="primary" size="lg" icon={ClipboardCheck} onClick={() => setMode('collect')}>Continue collection</Button>;
    else footer = <p className="footer-note">{job.status === 'collected' ? 'Collection confirmed. No further driver action.' : job.status === 'blocked' ? 'Dispatch will follow up on this visit.' : 'Waiting for dispatch to assign this job.'}</p>;
  } else {
    if (invoiceId) footer = <Button variant="primary" icon={FileText} onClick={() => navigate(`/office?tab=drafts&invoice=${invoiceId}`)}>Open draft {invoiceId}</Button>;
    else if (billing.status === 'ready')
      footer = (
        <Button variant="primary" icon={FileText} pending={cmd.pending}
          onClick={async () => { const r = await cmd.run({ type: 'createDraft', jobId: job.id }, `draft:${job.id}`); const id = r?.ref ?? state.invoiceByJob[job.id]; if (r !== null && id) navigate(`/office?tab=drafts&invoice=${id}`); }}>
          Create draft
        </Button>
      );
    else if (load && load.status !== 'reconciled')
      footer = <Button variant="primary" onClick={() => navigate(`/office?load=${load.id}`)}>Open load {load.id}</Button>;
    else footer = <p className="footer-note">{billing.blockers[0] ?? ''}</p>;
  }

  return (
    <Drawer title={customer.name} subtitle={subtitle} onClose={onClose} footer={<div className="footer-actions">{cmd.error && <p className="field-error footer-error" role="alert">{cmd.error}</p>}{footer}</div>}>
      {role === 'driver' && blocker && <Notice tone="warning">{blocker}</Notice>}

      <section className="detail-section" aria-labelledby="sec-site">
        <h3 id="sec-site" className="detail-heading">Site and access</h3>
        <Meta items={[
          { label: 'Site', value: <>{site.address}<br /><span className="muted">{site.locality}</span></> },
          { label: 'Window', value: `${job.windowStart}–${job.windowEnd}`, mono: true },
          { label: 'Truck', value: truck ? `${truck.name} · ${driverOf(state, truck).name}` : 'Unassigned' },
          { label: 'Service interval', value: `Every ${site.serviceIntervalWeeks} weeks (read-only)` },
        ]} />
        <p className="access-note"><strong>Access:</strong> {site.accessNote}</p>
        {job.blockedReason && <Notice tone="error"><strong>Blocked:</strong> {job.blockedReason}</Notice>}
      </section>

      <section className="detail-section" aria-labelledby="sec-collection">
        <h3 id="sec-collection" className="detail-heading">Collection record</h3>
        {job.collection ? (
          <>
            <Meta items={[
              { label: 'Actual', value: formatLitres(job.collection.litres), mono: true },
              { label: 'Estimated', value: formatLitres(job.estimatedLitres), mono: true },
              { label: 'Confirmed', value: formatTime(job.collection.collectedAt), mono: true },
            ]} />
            <div className="thumb-row">{job.collection.photoIds.map((id) => state.photos[id] && <PhotoThumb key={id} photo={state.photos[id]} />)}</div>
            {job.collection.notes && <p className="muted">Notes: {job.collection.notes}</p>}
            {extra && (
              <div className="extra-box">
                <p><strong>Additional work:</strong> {extra.description} · <span className="mono">{extra.minutes} min</span></p>
                <Chip tone={extra.review === 'pending' ? 'warning' : extra.review === 'approved' ? 'success' : 'neutral'}>
                  {extra.review === 'pending' ? 'Awaiting office review' : extra.review === 'approved' ? 'Approved' : 'Declined'}
                </Chip>
                {extra.reviewNote && <p className="muted">Review note: {extra.reviewNote}</p>}
                {role === 'office' && extra.review === 'pending' && <ExtraWorkReview jobId={job.id} />}
              </div>
            )}
          </>
        ) : (
          <p className="muted">Estimated <span className="mono">{formatLitres(job.estimatedLitres)}</span>. Nothing collected yet.</p>
        )}
      </section>

      <section className="detail-section" aria-labelledby="sec-load">
        <h3 id="sec-load" className="detail-heading">Load and disposal</h3>
        {load ? (
          <Meta items={[
            { label: 'Load', value: `${load.id} · ${STATUS_LABEL.load[load.status]}`, mono: false },
            { label: 'Disposal', value: disposal ? `${disposal.id} · ${STATUS_LABEL.disposal[disposalStatus(state, load)]}` : STATUS_LABEL.disposal.missing },
          ]} />
        ) : (
          <p className="muted">Not on a load yet.</p>
        )}
      </section>

      <section className="detail-section" aria-labelledby="sec-billing">
        <h3 id="sec-billing" className="detail-heading">Billing</h3>
        <p><Chip tone={BILLING_TONE[billing.status]} icon={BILLING_ICON[billing.status]}>{STATUS_LABEL.billing[billing.status]}</Chip>{invoiceId && <span className="mono"> {invoiceId}</span>}</p>
        {billing.blockers.length > 0 && <ul className="blockers">{billing.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
      </section>

      <section className="detail-section" aria-labelledby="sec-activity">
        <h3 id="sec-activity" className="detail-heading">Activity</h3>
        <ol className="timeline">
          {state.activity.filter((a) => a.jobId === job.id || (job.loadId && a.loadId === job.loadId && !a.jobId)).map((a) => (
            <li key={a.id}>
              <span className="timeline-time mono">{formatTime(a.at)}</span>
              <span>{a.message}</span>
            </li>
          ))}
        </ol>
      </section>
      {assigning && <AssignDialog job={job} onClose={() => setAssigning(false)} />}
    </Drawer>
  );
}

export function ExtraWorkReview({ jobId }: { jobId: string }) {
  const [note, setNote] = useState('');
  const cmd = useCommand();
  const decide = (decision: 'approved' | 'declined') => cmd.run({ type: 'reviewExtra', jobId, decision, note }, `extra:${jobId}`);
  return (
    <div className="stack-12">
      <Field label="Review note" error={cmd.fieldErrors.note}>
        {(p) => <input {...p} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      {cmd.error && !cmd.fieldErrors.note && <p className="field-error" role="alert">{cmd.error}</p>}
      <div className="row-8">
        <Button icon={X} pending={cmd.pending} onClick={() => decide('declined')}>Decline</Button>
        <Button variant="primary" icon={Check} pending={cmd.pending} onClick={() => decide('approved')}>Approve charge</Button>
      </div>
      <p className="field-hint">Approved work is billed at the illustrative NZ$90/hour in 15-minute increments.</p>
    </div>
  );
}

/* ---------- Blocked visit ---------- */

function BlockForm({ job, onDone, onClose, title, subtitle }: { job: Job; onDone: () => void; onClose: () => void; title: string; subtitle: React.ReactNode }) {
  const [reason, setReason] = useState('');
  const cmd = useCommand();
  return (
    <Drawer title={title} subtitle={subtitle} onClose={onClose}
      footer={
        <div className="footer-actions">
          <Button onClick={onDone}>Back</Button>
          <Button variant="destructive" size="lg" icon={Ban} pending={cmd.pending}
            onClick={async () => { if (await cmd.run({ type: 'block', jobId: job.id, reason })) onDone(); }}>
            Mark visit blocked
          </Button>
        </div>
      }>
      <UnsavedGuard dirty={reason.trim() !== '' && !cmd.pending} />
      <ErrorSummary message={cmd.error} errors={cmd.fieldErrors} />
      <p>A blocked visit records no litres, no load entry and can't be invoiced. Dispatch can resolve it later.</p>
      <Field label="Reason" error={cmd.fieldErrors.reason} hint="For example: gate locked, tank covered, customer asked to reschedule.">
        {(p) => <textarea {...p} className="input textarea" data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />}
      </Field>
    </Drawer>
  );
}

/* ---------- Collection form ---------- */

function CollectionForm({ job, state, mode, setMode, onClose, title, subtitle }: {
  job: Job; state: DemoState; mode: 'collect' | 'review'; setMode: (m: Mode) => void; onClose: () => void; title: string; subtitle: React.ReactNode;
}) {
  const saved = state.drafts[job.id];
  const [form, setForm] = useState(() => ({
    litres: saved?.litres ?? '',
    extraWork: saved?.extraWork ?? false,
    extraDescription: saved?.extraDescription ?? '',
    extraMinutes: saved?.extraMinutes ?? '',
    notes: saved?.notes ?? '',
  }));
  const photoIds = saved?.photoIds ?? [];
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const draftCmd = useCommand();
  const photoCmd = useCommand();
  const submitCmd = useCommand();
  const mutationKey = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const truck = state.trucks[job.truckId!];
  const remaining = remainingCapacity(state, truck.id);

  const store = useStore();
  const saveDraftCommand = draftCmd.run;
  const formRef = useRef(form);
  formRef.current = form;
  const saving = useRef<Promise<boolean> | null>(null);
  const matches = (draft: typeof saved, entry: typeof form) =>
    entry.litres === (draft?.litres ?? '') && entry.extraWork === (draft?.extraWork ?? false) &&
    entry.extraDescription === (draft?.extraDescription ?? '') && entry.extraMinutes === (draft?.extraMinutes ?? '') &&
    entry.notes === (draft?.notes ?? '');
  const dirty = !matches(saved, form);

  // All exits share the same save, and edits made during a slow write are saved next.
  // A failure leaves the input intact; only a deliberate retry or new edit retries it.
  const saveDraft = useCallback((): Promise<boolean> => {
    if (saving.current) return saving.current;
    const flush = async () => {
      while (!matches(store.state.drafts[job.id], formRef.current)) {
        const result = await saveDraftCommand({ type: 'saveDraft', jobId: job.id, draft: { ...formRef.current, photoIds: [] } });
        if (result === null) return false;
      }
      return true;
    };
    const promise = flush().finally(() => { saving.current = null; });
    saving.current = promise;
    return promise;
  }, [job.id, store, saveDraftCommand]);

  useEffect(() => {
    if (!dirty || mode !== 'collect') return;
    const timer = setTimeout(() => { void saveDraft(); }, 700);
    return () => clearTimeout(timer);
  }, [form, dirty, mode, saveDraft]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const input: CollectionInput = { ...form, photoIds };

  const addFiles = async (files: FileList | null) => {
    setPhotoError(null);
    let count = photoIds.length;
    for (const file of Array.from(files ?? [])) {
      const problem = validatePhotoFile(file, count);
      if (problem) { setPhotoError(problem); break; }
      const r = await photoCmd.run({ type: 'addPhoto', jobId: job.id, photo: { stage: count === 0 ? 'before' : 'after', source: 'upload', name: file.name, mime: file.type }, blob: file });
      if (!r) break;
      count++;
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const addSample = () => {
    setPhotoError(null);
    const stage = photoIds.length === 0 ? 'before' : 'after';
    if (photoIds.length >= 3) return setPhotoError('You can add up to 3 photos.');
    photoCmd.run({ type: 'addPhoto', jobId: job.id, photo: { stage, source: 'sample', name: `Built-in sample ${stage} photo`, mime: 'image/svg+xml', sampleUrl: SAMPLE_PHOTOS[stage] } });
  };

  const review = async () => {
    const e = validateCollection(state, job.id, input);
    setErrors(e);
    if (Object.keys(e).length) {
      setSummary('Check the highlighted fields. Your entries are still here.');
      return;
    }
    setSummary(null);
    if (!await saveDraft()) return;
    mutationKey.current ??= `collect:${job.id}:${crypto.randomUUID()}`;
    setMode('review');
  };

  const confirm = async () => {
    const r = await submitCmd.run({ type: 'confirmCollection', jobId: job.id, input }, mutationKey.current!);
    if (r !== null) setMode('detail');
  };

  const litres = Number(form.litres);
  const savedAt = saved?.savedAt;

  if (mode === 'review') {
    return (
      <Drawer title={title} subtitle={subtitle} onClose={() => { if (!submitCmd.pending) onClose(); }}
        footer={
          <div className="footer-actions">
            {submitCmd.error && <p className="field-error footer-error" role="alert">{submitCmd.error}</p>}
            <Button icon={ArrowLeft} onClick={() => setMode('collect')} disabled={submitCmd.pending}>Edit</Button>
            <Button variant="primary" size="lg" icon={Check} pending={submitCmd.pending} onClick={confirm}>Confirm collection</Button>
          </div>
        }>
        <UnsavedGuard dirty={dirty} onSave={saveDraft} />
        <h3 className="section-title">Review collection</h3>
        <p className="muted">Confirming adds this volume to {truck.name}'s open load and can't be edited afterwards.</p>
        <dl className="review-list">
          <div><dt>Actual litres</dt><dd className="mono big-number">{formatLitres(litres)}</dd></div>
          <div><dt>Truck</dt><dd>{truck.name} · {formatLitres(remaining - litres)} capacity left after this stop</dd></div>
          <div><dt>Photos</dt><dd><div className="thumb-row">{photoIds.map((id) => state.photos[id] && <PhotoThumb key={id} photo={state.photos[id]} />)}</div></dd></div>
          <div><dt>Additional work</dt><dd>{form.extraWork ? `${form.extraDescription} · ${form.extraMinutes} min (office will review)` : 'None'}</dd></div>
          {form.notes && <div><dt>Notes</dt><dd>{form.notes}</dd></div>}
        </dl>
      </Drawer>
    );
  }

  return (
    <Drawer title={title} subtitle={subtitle} onClose={onClose}
      footer={
        <div className="footer-actions">
          <Button icon={Ban} disabled={draftCmd.pending} onClick={async () => { if (await saveDraft()) setMode('block'); }}>Can't complete</Button>
          <Button icon={Save} pending={draftCmd.pending} onClick={saveDraft}>Save draft</Button>
          <Button variant="primary" size="lg" icon={ClipboardCheck} disabled={draftCmd.pending || photoCmd.pending} onClick={review}>Review collection</Button>
        </div>
      }>
      <UnsavedGuard dirty={dirty} onSave={saveDraft} />
      <form className="stack-20" onSubmit={(e) => { e.preventDefault(); void review(); }} noValidate>
        <ErrorSummary message={summary ?? draftCmd.error} errors={summary ? (errors as Record<string, string>) : undefined} />
        <p className="draft-state" aria-live="polite">
          {draftCmd.error ? 'Draft not saved.' : dirty ? 'Saving draft on this device…' : savedAt ? `Draft saved on this device at ${formatTime(savedAt)}` : 'Draft not saved yet'}
        </p>

        <Field label="Actual litres collected" error={errors.litres} hint={<>Estimated <span className="mono">{formatLitres(job.estimatedLitres)}</span> · <span className="mono">{formatLitres(remaining)}</span> capacity left on {truck.name}</>}>
          {(p) => (
            <div className="litre-input">
              <input {...p} className="input input-litres mono" inputMode="numeric" autoComplete="off" data-autofocus value={form.litres}
                onChange={(e) => set('litres', e.target.value)} />
              <span aria-hidden>L</span>
            </div>
          )}
        </Field>

        <fieldset className={`field ${errors.photos || photoError ? 'field-invalid' : ''}`} aria-describedby="photo-hint">
          <legend className="field-label">Photos (1–3)</legend>
          <p id="photo-hint" className="field-hint">JPEG, PNG or WebP up to 5 MB each. Photos stay on this device.</p>
          <ul className="photo-list">
            {photoIds.map((id) => {
              const photo = state.photos[id];
              if (!photo) return null;
              return (
                <li key={id} className="photo-item">
                  <PhotoThumb photo={photo} size={88} />
                  <div className="photo-controls">
                    <label className="sr-only" htmlFor={`stage-${id}`}>Photo stage</label>
                    <select id={`stage-${id}`} className="input select-sm" value={photo.stage}
                      onChange={(e) => photoCmd.run({ type: 'setPhotoStage', photoId: id, stage: e.target.value as 'before' | 'after' })}>
                      <option value="before">Before</option>
                      <option value="after">After</option>
                    </select>
                    <Button icon={Trash2} onClick={() => photoCmd.run({ type: 'removePhoto', jobId: job.id, photoId: id })} aria-label={`Remove ${photo.stage} photo`}>Remove</Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {photoIds.length < 3 && (
            <div className="row-8 wrap">
              <input ref={fileRef} id={`file-${job.id}`} type="file" accept={PHOTO_TYPES.join(',')} multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
              <label htmlFor={`file-${job.id}`} className="btn btn-secondary btn-lg file-label">
                <Upload className="icon" aria-hidden /> Choose photo file
              </label>
              <Button size="lg" icon={ImageIcon} onClick={addSample} pending={photoCmd.pending}>Add built-in sample photo</Button>
            </div>
          )}
          {(photoError || photoCmd.error || errors.photos) && (
            <p className="field-error" role="alert">{photoError ?? photoCmd.error ?? errors.photos}</p>
          )}
        </fieldset>

        <fieldset className="field">
          <legend className="field-label">Additional work?</legend>
          <div className="segmented" role="radiogroup">
            {[false, true].map((v) => (
              <label key={String(v)} className={`segment ${form.extraWork === v ? 'segment-on' : ''}`}>
                <input type="radio" name={`extra-${job.id}`} checked={form.extraWork === v} onChange={() => set('extraWork', v)} />
                {v ? 'Yes' : 'No'}
              </label>
            ))}
          </div>
        </fieldset>
        {form.extraWork && (
          <>
            <Field label="What extra work was done?" error={errors.extraDescription}>
              {(p) => <input {...p} className="input" value={form.extraDescription} onChange={(e) => set('extraDescription', e.target.value)} />}
            </Field>
            <Field label="Time taken (minutes)" error={errors.extraMinutes} hint="Office reviews this before it can be charged.">
              {(p) => <input {...p} className="input input-short mono" inputMode="numeric" value={form.extraMinutes} onChange={(e) => set('extraMinutes', e.target.value)} />}
            </Field>
          </>
        )}
        <Field label="Notes (optional)">
          {(p) => <textarea {...p} className="input textarea" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />}
        </Field>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Drawer>
  );
}

export function useJobsSorted(state: DemoState) {
  return useMemo(() => Object.values(state.jobs).sort((a, b) => a.windowStart.localeCompare(b.windowStart) || a.id.localeCompare(b.id)), [state.jobs]);
}

