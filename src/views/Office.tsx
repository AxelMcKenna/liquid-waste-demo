import { ArrowLeft, Check, FileText, Flag, Plus, Save, Scale } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ATTENTION_GROUPS, attentionRows, billingInfo, canStartNewLoad, customerOf, disposalStatus, formatDate, formatLitres, formatLocalDateTime,
  formatTime, jobsReadyForDraft, loadTotal, STATUS_LABEL, type AttentionRow,
} from '../domain/logic';
import { formatNzd, invoiceTotals, lineAmountCents, parsePercent, parseRate, rateToInput } from '../domain/pricing';
import type { DemoState, InvoiceDraft, Load } from '../domain/types';
import { useCommand, useDemo } from '../store/context';
import { Button, Chip, ErrorSummary, Field, Notice, PhotoThumb, UnsavedGuard, type Tone } from '../ui/components';
import { ExtraWorkReview, JobDrawer, serviceLabel, useJobParam } from './JobDrawer';

const DISPOSAL_TONE: Record<string, Tone> = { missing: 'warning', entered: 'neutral', discrepancy: 'error', reconciled: 'success' };
const LOAD_TONE: Record<string, Tone> = { collecting: 'neutral', awaiting_disposal: 'warning', reconciled: 'success' };

export function OfficeView() {
  const state = useDemo();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'drafts' ? 'drafts' : 'attention';
  const rows = attentionRows(state);
  const drafts = Object.values(state.invoices);
  const selection = params.get('load') ?? params.get('extra') ?? params.get('invoice');

  return (
    <div className={`page office ${selection ? 'has-selection' : ''}`}>
      <h1 className="page-title">Office</h1>
      <div className="tabs" role="tablist" aria-label="Office queues">
        {([['attention', 'Needs attention', rows.length], ['drafts', 'Draft invoices', drafts.length]] as const).map(([key, label, n]) => (
          <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`}
            className="tab" onClick={() => setParams(key === 'drafts' ? { tab: 'drafts' } : {})}>
            {label} <span className="count mono">{n}</span>
          </button>
        ))}
      </div>
      <div className="office-surface" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'attention' ? <AttentionTab state={state} rows={rows} /> : <DraftsTab state={state} />}
      </div>
      <JobDrawer role="office" />
    </div>
  );
}

/* ---------- Needs attention ---------- */

function AttentionTab({ state, rows }: { state: DemoState; rows: AttentionRow[] }) {
  const [params, setParams] = useSearchParams();
  const loadId = params.get('load');
  const extraId = params.get('extra');
  const loadOpen = loadId && state.loads[loadId];
  const extraOpen = extraId && state.jobs[extraId];

  return (
    <div className="split">
      <div className="queue">
        {rows.length === 0 && <p className="empty">Nothing needs attention. Reconciled jobs appear under Draft invoices.</p>}
        {ATTENTION_GROUPS.map((g) => {
          const items = rows.filter((r) => r.group === g.key);
          if (!items.length) return null;
          return (
            <section key={g.key} className="queue-group" aria-labelledby={`g-${g.key}`}>
              <h2 id={`g-${g.key}`} className="queue-title">{g.title} <span className="count mono">{items.length}</span></h2>
              <ul>
                {items.map((r) => {
                  if (r.group === 'extra_work') {
                    const j = state.jobs[r.jobId];
                    return (
                      <li key={r.jobId}>
                        <button type="button" className={`queue-row ${extraId === r.jobId ? 'row-selected' : ''}`} aria-current={extraId === r.jobId || undefined} onClick={() => setParams({ extra: r.jobId })}>
                          <span className="strong">{customerOf(state, j).name}</span>
                          <span className="sub"><span className="mono">{j.id}</span> · {j.collection!.extraWork!.description} · <span className="mono">{j.collection!.extraWork!.minutes} min</span></span>
                          <Chip tone="warning" icon={Flag}>Review</Chip>
                        </button>
                      </li>
                    );
                  }
                  const load = state.loads[r.loadId];
                  const ds = disposalStatus(state, load);
                  return (
                    <li key={r.loadId}>
                      <button type="button" className={`queue-row ${loadId === r.loadId ? 'row-selected' : ''}`} aria-current={loadId === r.loadId || undefined} onClick={() => setParams({ load: r.loadId })}>
                        <span className="strong">Load <span className="mono">{load.id}</span> · {state.trucks[load.truckId].name}</span>
                        <span className="sub"><span className="mono">{formatLitres(loadTotal(load))}</span> from <span className="mono">{load.contributions.length}</span> {load.contributions.length === 1 ? 'job' : 'jobs'} · {STATUS_LABEL.load[load.status]}</span>
                        <Chip tone={DISPOSAL_TONE[ds]}>{STATUS_LABEL.disposal[ds]}</Chip>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <div className="detail-pane">
        {loadOpen ? <LoadPanel key={loadId} load={state.loads[loadId]} state={state} /> : extraOpen ? <ExtraPanel key={extraId} jobId={extraId} state={state} /> : (
          <p className="empty">Select a row to see its source jobs, evidence and next step.</p>
        )}
      </div>
    </div>
  );
}

function BackToList() {
  const [, setParams] = useSearchParams();
  const [params] = useSearchParams();
  return (
    <Button className="back-btn" icon={ArrowLeft} onClick={() => setParams(params.get('invoice') ? { tab: 'drafts' } : {})}>Back to list</Button>
  );
}

function SourceJobs({ load, state }: { load: Load; state: DemoState }) {
  const { open } = useJobParam();
  return (
    <table className="table compact">
      <caption className="sr-only">Source jobs on {load.id}</caption>
      <thead><tr><th scope="col">Job</th><th scope="col">Evidence</th><th scope="col" className="num">Litres</th></tr></thead>
      <tbody>
        {load.contributions.map((c) => {
          const j = state.jobs[c.jobId];
          return (
            <tr key={c.jobId}>
              <td data-label="Job">
                <button type="button" className="link-btn" onClick={() => open(j.id)}>{customerOf(state, j).name}</button>
                <span className="sub"><span className="mono">{j.id}</span> · collected <span className="mono">{formatTime(j.collection!.collectedAt)}</span></span>
              </td>
              <td data-label="Evidence"><div className="thumb-row">{j.collection!.photoIds.map((id) => state.photos[id] && <PhotoThumb key={id} photo={state.photos[id]} size={48} />)}</div></td>
              <td data-label="Litres" className="num mono">{formatLitres(c.litres)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LoadPanel({ load, state }: { load: Load; state: DemoState }) {
  const rec = load.disposalRecordId ? state.disposals[load.disposalRecordId] : undefined;
  const ds = disposalStatus(state, load);
  const driverTotal = loadTotal(load);
  const truck = state.trucks[load.truckId];
  const initial = { facility: rec?.facility ?? '', docketRef: rec?.docketRef ?? '', disposedAt: rec?.disposedAt ?? 'T', reportedLitres: rec ? String(rec.reportedLitres) : '' };
  const [form, setForm] = useState(initial);
  const [reason, setReason] = useState('');
  const saveCmd = useCommand();
  const actCmd = useCommand();
  const acceptCmd = useCommand();
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== initial[k]);
  const reported = rec?.reportedLitres;
  const diff = rec ? rec.driverLitres - rec.reportedLitres : null;
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const r = await saveCmd.run({ type: 'saveDisposal', loadId: load.id, ...form });
    if (r) setForm({ ...form, facility: form.facility.trim(), docketRef: form.docketRef.trim(), reportedLitres: String(Number(form.reportedLitres)) });
  };
  const canEdit = load.status === 'awaiting_disposal';

  return (
    <article className="panel stack-20" aria-labelledby="load-title">
      <UnsavedGuard dirty={dirty && canEdit} />
      <BackToList />
      <header>
        <h2 id="load-title" className="panel-title">Load <span className="mono">{load.id}</span> · {truck.name}</h2>
        <p className="row-8 wrap">
          <Chip tone={LOAD_TONE[load.status]}>{STATUS_LABEL.load[load.status]}</Chip>
          <Chip tone={DISPOSAL_TONE[ds]}>{STATUS_LABEL.disposal[ds]}</Chip>
        </p>
      </header>

      <section aria-labelledby="src-title">
        <h3 id="src-title" className="section-title">Source jobs and evidence</h3>
        <SourceJobs load={load} state={state} />
      </section>

      <section aria-labelledby="totals-title">
        <h3 id="totals-title" className="section-title">Volume check</h3>
        <dl className="totals">
          <div><dt>Driver total</dt><dd className="mono">{formatLitres(driverTotal)}</dd></div>
          <div><dt>Facility reported</dt><dd className="mono">{reported !== undefined ? formatLitres(reported) : '—'}</dd></div>
          <div className={diff ? 'total-diff' : ''}><dt>Difference</dt><dd className="mono">{diff === null ? '—' : diff === 0 ? '0 L' : `${diff > 0 ? '−' : '+'}${formatLitres(Math.abs(diff))}`}</dd></div>
        </dl>
        {diff !== null && diff !== 0 && (
          <p className="sub">{formatLitres(driverTotal)} recorded by drivers − {formatLitres(reported!)} at the facility = {formatLitres(Math.abs(diff))} {diff > 0 ? 'less' : 'more'} at disposal.</p>
        )}
        {rec?.acceptedDifference && <Notice tone="neutral">Difference of {formatLitres(Math.abs(rec.acceptedDifference.litres))} accepted: {rec.acceptedDifference.reason}</Notice>}
      </section>

      {load.status === 'collecting' && (
        <section className="stack-12">
          <Notice tone="warning">This load is still collecting. Finish it to stop new contributions, then enter the disposal record.</Notice>
          {actCmd.error && <p className="field-error" role="alert">{actCmd.error}</p>}
          <div><Button variant="primary" pending={actCmd.pending} onClick={() => actCmd.run({ type: 'finishLoad', loadId: load.id }, `finish:${load.id}`)}>Finish load</Button></div>
        </section>
      )}

      {load.status !== 'collecting' && (
        <section aria-labelledby="disp-title" className="stack-12">
          <h3 id="disp-title" className="section-title">Disposal record {rec && <span className="mono">{rec.id}</span>}</h3>
          {canEdit ? (
            <form className="form-grid" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
              <div className="span-2"><ErrorSummary message={saveCmd.error} errors={saveCmd.fieldErrors} /></div>
              <Field label="Facility" error={saveCmd.fieldErrors.facility}>
                {(p) => <input {...p} className="input" value={form.facility} onChange={(e) => set('facility', e.target.value)} />}
              </Field>
              <Field label="Docket reference" error={saveCmd.fieldErrors.docketRef}>
                {(p) => <input {...p} className="input mono" value={form.docketRef} onChange={(e) => set('docketRef', e.target.value)} />}
              </Field>
              <Field label="Disposal date" error={saveCmd.fieldErrors.disposedAt}>
                {(p) => <input {...p} type="date" className="input mono" value={form.disposedAt.slice(0, 10)} onChange={(e) => set('disposedAt', `${e.target.value}T${form.disposedAt.slice(11)}`)} />}
              </Field>
              <Field label="Disposal time (24-hour)" hint="For example 13:40" error={saveCmd.fieldErrors.disposedAt}>
                {(p) => <input {...p} className="input mono" inputMode="numeric" placeholder="HH:MM" value={form.disposedAt.slice(11)} onChange={(e) => set('disposedAt', `${form.disposedAt.slice(0, 10)}T${e.target.value}`)} />}
              </Field>
              <Field label="Facility litres" error={saveCmd.fieldErrors.reportedLitres}>
                {(p) => <input {...p} inputMode="numeric" className="input mono" value={form.reportedLitres} onChange={(e) => set('reportedLitres', e.target.value)} />}
              </Field>
              <div className="span-2">
                <Button type="submit" variant={ds === 'missing' ? 'primary' : 'secondary'} icon={Save} pending={saveCmd.pending} disabled={!dirty}>
                  {rec ? 'Save correction' : 'Save disposal record'}
                </Button>
                {!dirty && rec && <span className="field-hint inline-hint">No unsaved changes.</span>}
              </div>
            </form>
          ) : rec && (
            <dl className="review-list">
              <div><dt>Facility</dt><dd>{rec.facility}</dd></div>
              <div><dt>Docket</dt><dd className="mono">{rec.docketRef}</dd></div>
              <div><dt>Disposed</dt><dd className="mono">{formatLocalDateTime(rec.disposedAt)}</dd></div>
              <div><dt>Facility litres</dt><dd className="mono">{formatLitres(rec.reportedLitres)}</dd></div>
            </dl>
          )}
        </section>
      )}

      {canEdit && ds === 'discrepancy' && !dirty && (
        <section aria-labelledby="accept-title" className="stack-12 subtle-box">
          <h3 id="accept-title" className="section-title">Resolve the difference</h3>
          <p>Correct the disposal entry above if it was mistyped, or accept the difference with a reason. Collected litres are never rewritten.</p>
          <Field label="Reason for accepting" error={acceptCmd.fieldErrors.reason}>
            {(p) => <input {...p} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          {acceptCmd.error && !acceptCmd.fieldErrors.reason && <p className="field-error" role="alert">{acceptCmd.error}</p>}
          <div><Button icon={Scale} pending={acceptCmd.pending} onClick={() => acceptCmd.run({ type: 'acceptDifference', loadId: load.id, reason })}>Accept difference</Button></div>
        </section>
      )}

      {canEdit && rec && (
        <section className="stack-12">
          {actCmd.error && <p className="field-error" role="alert">{actCmd.error}</p>}
          <div className="row-8 wrap">
            <Button variant="primary" icon={Check} pending={actCmd.pending} disabled={ds === 'discrepancy' || dirty}
              onClick={() => actCmd.run({ type: 'reconcile', loadId: load.id }, `reconcile:${load.id}`)}>
              Reconcile load
            </Button>
            {(ds === 'discrepancy' || dirty) && <span className="field-hint inline-hint">{dirty ? 'Save the disposal record first.' : 'Correct the entry or accept the difference first.'}</span>}
          </div>
        </section>
      )}

      {load.status === 'reconciled' && canStartNewLoad(state, truck.id) && (
        <section className="stack-12">
          <Notice tone="success">Load reconciled. {truck.name} has no open load; start one so its remaining stops can be collected.</Notice>
          {actCmd.error && <p className="field-error" role="alert">{actCmd.error}</p>}
          <div><Button icon={Plus} pending={actCmd.pending} onClick={() => actCmd.run({ type: 'newLoad', truckId: truck.id }, `newload:${truck.id}:${Object.keys(state.loads).length}`)}>New load for {truck.name}</Button></div>
        </section>
      )}

      <p className="field-hint">Demo workflow assumption: this check compares two numbers. It is not environmental or legal validation.</p>
      <LoadActivity load={load} state={state} />
    </article>
  );
}

function LoadActivity({ load, state }: { load: Load; state: DemoState }) {
  const events = state.activity.filter((a) => a.loadId === load.id);
  return (
    <section aria-labelledby="la-title">
      <h3 id="la-title" className="section-title">Activity</h3>
      <ol className="timeline">
        {events.map((a) => <li key={a.id}><span className="timeline-time mono">{formatTime(a.at)}</span><span>{a.message}</span></li>)}
      </ol>
    </section>
  );
}

function ExtraPanel({ jobId, state }: { jobId: string; state: DemoState }) {
  const j = state.jobs[jobId];
  const extra = j.collection?.extraWork;
  const { open } = useJobParam();
  return (
    <article className="panel stack-20" aria-labelledby="extra-title">
      <BackToList />
      <header>
        <h2 id="extra-title" className="panel-title">Additional work · {customerOf(state, j).name}</h2>
        <p className="sub"><span className="mono">{j.id}</span> · {serviceLabel(j)} · <span className="mono">{formatLitres(j.collection!.litres)}</span> collected</p>
      </header>
      <div className="thumb-row">{j.collection!.photoIds.map((id) => state.photos[id] && <PhotoThumb key={id} photo={state.photos[id]} size={88} />)}</div>
      {extra && (
        <>
          <dl className="review-list">
            <div><dt>Driver's description</dt><dd>{extra.description}</dd></div>
            <div><dt>Time recorded</dt><dd className="mono">{extra.minutes} min</dd></div>
            <div><dt>Status</dt><dd>{extra.review === 'pending' ? 'Awaiting review' : extra.review === 'approved' ? 'Approved' : 'Declined'}{extra.reviewNote && ` · ${extra.reviewNote}`}</dd></div>
          </dl>
          {extra.review === 'pending' && <ExtraWorkReview jobId={j.id} />}
        </>
      )}
      <div><Button onClick={() => open(j.id)}>Open job details</Button></div>
    </article>
  );
}

/* ---------- Draft invoices ---------- */

function DraftsTab({ state }: { state: DemoState }) {
  const [params, setParams] = useSearchParams();
  const invoiceId = params.get('invoice');
  const ready = jobsReadyForDraft(state);
  const drafts = Object.values(state.invoices);
  const cmd = useCommand();
  const blocked = Object.values(state.jobs).filter((j) => j.status === 'collected' && billingInfo(state, j.id).status === 'review_required');

  const create = async (jobId: string) => {
    const r = await cmd.run({ type: 'createDraft', jobId }, `draft:${jobId}`);
    const id = r?.ref ?? state.invoiceByJob[jobId];
    if (r !== null && id) setParams({ tab: 'drafts', invoice: id });
  };

  return (
    <div className="split">
      <div className="queue">
        {cmd.error && <p className="field-error" role="alert">{cmd.error}</p>}
        <section className="queue-group" aria-labelledby="ready-title">
          <h2 id="ready-title" className="queue-title">Ready for a draft <span className="count mono">{ready.length}</span></h2>
          {ready.length === 0 && <p className="sub pad">No reconciled jobs are waiting for a draft.</p>}
          <ul>
            {ready.map((j) => (
              <li key={j.id} className="queue-row queue-row-static">
                <span className="strong">{customerOf(state, j).name}</span>
                <span className="sub"><span className="mono">{j.id} · {formatLitres(j.collection!.litres)}</span></span>
                <Button variant="primary" icon={FileText} pending={cmd.pending} onClick={() => create(j.id)} aria-label={`Create draft for ${j.id}`}>Create draft</Button>
              </li>
            ))}
          </ul>
        </section>
        <section className="queue-group" aria-labelledby="drafts-title">
          <h2 id="drafts-title" className="queue-title">Drafts <span className="count mono">{drafts.length}</span></h2>
          <ul>
            {drafts.map((d) => {
              const j = state.jobs[d.jobId];
              return (
                <li key={d.id}>
                  <button type="button" className={`queue-row ${invoiceId === d.id ? 'row-selected' : ''}`} aria-current={invoiceId === d.id || undefined} onClick={() => setParams({ tab: 'drafts', invoice: d.id })}>
                    <span className="strong"><span className="mono">{d.id}</span> · {customerOf(state, j).name}</span>
                    <span className="sub mono">{formatNzd(invoiceTotals(d).total)}</span>
                    <Chip tone="neutral" icon={FileText}>Draft · Not sent</Chip>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        {blocked.length > 0 && (
          <section className="queue-group" aria-labelledby="blocked-title">
            <h2 id="blocked-title" className="queue-title">Not yet billable <span className="count mono">{blocked.length}</span></h2>
            <ul>
              {blocked.map((j) => (
                <li key={j.id} className="queue-row queue-row-static">
                  <span className="strong">{customerOf(state, j).name} <span className="mono">{j.id}</span></span>
                  <span className="sub">{billingInfo(state, j.id).blockers.join(' · ')}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="detail-pane">
        {invoiceId && state.invoices[invoiceId] ? <InvoiceSheet key={invoiceId} draft={state.invoices[invoiceId]} state={state} /> : (
          <p className="empty">Select a draft to review it, or create one from a reconciled job.</p>
        )}
      </div>
    </div>
  );
}

function InvoiceSheet({ draft, state }: { draft: InvoiceDraft; state: DemoState }) {
  const job = state.jobs[draft.jobId];
  const site = state.sites[job.siteId];
  const initial = {
    lines: draft.lines.map((l) => ({ id: l.id, description: l.description, rate: rateToInput(l.unitRate) })),
    tax: String(draft.taxBasisPoints / 100),
  };
  const [form, setForm] = useState(initial);
  const cmd = useCommand();
  const navigate = useNavigate();
  // Compare persisted values, not formatting (e.g. 200 and 200.00 are the same rate).
  // Keep local inputs untouched so a completed save cannot erase newer typing.
  const dirty = parsePercent(form.tax) !== draft.taxBasisPoints || form.lines.some((line, index) => {
    const saved = draft.lines[index];
    return line.id !== saved.id || line.description.trim() !== saved.description || parseRate(line.rate) !== saved.unitRate;
  });

  const rateErrors = form.lines.map((l) => (parseRate(l.rate) === null ? 'Enter a rate like 0.12 (up to 4 decimals).' : null));
  const descErrors = form.lines.map((l) => (l.description.trim() ? null : 'Enter a description.'));
  const taxBp = parsePercent(form.tax);
  const valid = rateErrors.every((e) => !e) && descErrors.every((e) => !e) && taxBp !== null;
  const preview = valid
    ? { lines: draft.lines.map((l, i) => ({ ...l, unitRate: parseRate(form.lines[i].rate)! })), taxBasisPoints: taxBp! }
    : draft;
  const totals = invoiceTotals(preview);

  const save = () =>
    cmd.run({ type: 'updateInvoice', invoiceId: draft.id, taxBasisPoints: taxBp!, lines: form.lines.map((l) => ({ id: l.id, description: l.description, unitRate: parseRate(l.rate)! })) });

  const qtyLabel = (kind: string, q: number) => (kind === 'litres' ? formatLitres(q) : kind === 'extra' ? `${(q / 60).toFixed(2)} h` : String(q));
  const rateUnit = (kind: string) => (kind === 'litres' ? '/ L' : kind === 'extra' ? '/ h' : 'each');

  return (
    <article className="panel invoice stack-20" aria-labelledby="inv-title">
      <UnsavedGuard dirty={dirty} />
      <BackToList />
      <header className="invoice-head">
        <div>
          <h2 id="inv-title" className="panel-title">Draft invoice <span className="mono">{draft.id}</span></h2>
          <p className="sub">Created <span className="mono">{formatTime(draft.createdAt)}</span> · Illustrative rates</p>
        </div>
        <Chip tone="warning" icon={FileText}>Draft · Not sent</Chip>
      </header>
      <dl className="meta-band">
        <div><dt>Customer</dt><dd>{customerOf(state, job).name}</dd></div>
        <div><dt>Site</dt><dd>{site.address}, {site.locality}</dd></div>
        <div><dt>Job</dt><dd><button type="button" className="link-btn mono" onClick={() => navigate(`/office?tab=drafts&invoice=${draft.id}&job=${job.id}`)}>{job.id}</button> · {formatDate(job.collection!.collectedAt)}</dd></div>
        <div><dt>Collected</dt><dd className="mono">{formatLitres(job.collection!.litres)}</dd></div>
      </dl>
      <ErrorSummary message={cmd.error} />
      <div className="table-scroll">
        <table className="table invoice-table">
          <caption className="sr-only">Invoice lines</caption>
          <thead><tr><th scope="col">Description</th><th scope="col" className="num">Quantity</th><th scope="col" className="num">Unit rate (NZ$)</th><th scope="col" className="num">Amount</th></tr></thead>
          <tbody>
            {draft.lines.map((l, i) => (
              <tr key={l.id}>
                <td data-label="Description">
                  <label className="sr-only" htmlFor={`desc-${l.id}`}>Description for line {i + 1}</label>
                  <input id={`desc-${l.id}`} className="input" value={form.lines[i].description} aria-invalid={!!descErrors[i] || undefined}
                    onChange={(e) => setForm((f) => ({ ...f, lines: f.lines.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)) }))} />
                  {descErrors[i] && <p className="field-error">{descErrors[i]}</p>}
                </td>
                <td data-label="Quantity" className="num mono">{qtyLabel(l.kind, l.quantity)}</td>
                <td data-label="Unit rate" className="num">
                  <label className="sr-only" htmlFor={`rate-${l.id}`}>Unit rate for line {i + 1}, NZ$ {rateUnit(l.kind)}</label>
                  <span className="rate-input">
                    <input id={`rate-${l.id}`} className="input mono num-input" inputMode="decimal" value={form.lines[i].rate} aria-invalid={!!rateErrors[i] || undefined}
                      onChange={(e) => setForm((f) => ({ ...f, lines: f.lines.map((x, k) => (k === i ? { ...x, rate: e.target.value } : x)) }))} />
                    <span className="sub">{rateUnit(l.kind)}</span>
                  </span>
                  {rateErrors[i] && <p className="field-error">{rateErrors[i]}</p>}
                </td>
                <td data-label="Amount" className="num mono">{formatNzd(lineAmountCents(preview.lines[i]))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="invoice-totals">
        <div><dt>Subtotal</dt><dd className="mono">{formatNzd(totals.subtotal)}</dd></div>
        <div>
          <dt>
            <label htmlFor="tax-rate">Illustrative GST (%)</label>
          </dt>
          <dd className="tax-cell">
            <input id="tax-rate" className="input mono num-input short" inputMode="decimal" value={form.tax} aria-invalid={taxBp === null || undefined} aria-describedby="tax-hint"
              onChange={(e) => setForm((f) => ({ ...f, tax: e.target.value }))} />
            <span className="mono">{formatNzd(totals.tax)}</span>
          </dd>
        </div>
        {taxBp === null && <p className="field-error">Enter a percentage from 0 to 100 with up to 2 decimals.</p>}
        <div className="grand"><dt>Total</dt><dd className="mono">{formatNzd(totals.total)}</dd></div>
      </dl>
      <p id="tax-hint" className="field-hint">Prices exclude the illustrative tax. Demo-only figures: not a tax engine, accounting ledger or sent invoice. Quantities come from the collection record and can't be edited.</p>
      <div className="row-8 wrap">
        <Button variant="primary" icon={Save} pending={cmd.pending} disabled={!dirty || !valid} onClick={save}>Save draft changes</Button>
        {!dirty && <span className="field-hint inline-hint">No unsaved changes.</span>}
        {dirty && !valid && <span className="field-hint inline-hint">Fix the highlighted values to save.</span>}
      </div>
    </article>
  );
}
