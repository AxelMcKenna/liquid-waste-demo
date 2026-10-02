import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, PanelRightOpen, Plus, Search, Truck as TruckIcon, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  canStartNewLoad, collectingLoad, committedLitres, customerOf, driverOf, formatLitres, loadTotal, siteOf, STATUS_LABEL, truckLoads,
} from '../domain/logic';
import type { DemoState, Job, JobStatus, Truck } from '../domain/types';
import { useCommand, useDemo } from '../store/context';
import { Button, Dialog, Drawer, ErrorSummary } from '../ui/components';
import { JobDrawer, JobStatusChip, serviceLabel, useJobParam, useJobsSorted } from './JobDrawer';

export function DispatchView() {
  const state = useDemo();
  const jobs = useJobsSorted(state);
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = (params.get('status') ?? '') as JobStatus | '';
  const truck = params.get('truck') ?? '';
  const { jobId, open } = useJobParam();
  const [assignJob, setAssignJob] = useState<Job | null>(null);
  const [runsOpen, setRunsOpen] = useState(false);

  const setParam = (k: string, v: string) => setParams((p) => { if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true });

  const filtered = jobs.filter((j) => {
    if (status && j.status !== status) return false;
    if (truck === 'none' ? j.truckId : truck && j.truckId !== truck) return false;
    if (q) {
      const site = siteOf(state, j);
      const hay = `${j.id} ${customerOf(state, j).name} ${site.address} ${site.locality}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });
  const counts = {
    total: jobs.length,
    unassigned: jobs.filter((j) => j.status === 'unassigned').length,
    blocked: jobs.filter((j) => j.status === 'blocked').length,
  };
  const filtersOn = !!(q || status || truck);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Today's collections</h1>
          <p className="summary-line">
            <span className="mono">{counts.total}</span> jobs · <span className="mono">{counts.unassigned}</span> unassigned · <span className="mono">{counts.blocked}</span> blocked
          </p>
        </div>
        <Button className="runs-toggle" icon={PanelRightOpen} onClick={() => setRunsOpen(true)}>Truck runs</Button>
      </div>

      <div className="work-surface">
        <section className="jobs-pane" aria-label="Jobs">
          <div className="toolbar" role="search">
            <label className="search">
              <Search className="icon" aria-hidden />
              <span className="sr-only">Search jobs</span>
              <input type="search" placeholder="Search job, customer or site" value={q} onChange={(e) => setParam('q', e.target.value)} />
            </label>
            <label className="filter">
              <span className="sr-only">Status</span>
              <select value={status} onChange={(e) => setParam('status', e.target.value)}>
                <option value="">All statuses</option>
                {(Object.keys(STATUS_LABEL.job) as JobStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL.job[s]}</option>)}
              </select>
            </label>
            <label className="filter">
              <span className="sr-only">Truck</span>
              <select value={truck} onChange={(e) => setParam('truck', e.target.value)}>
                <option value="">All trucks</option>
                {Object.values(state.trucks).map((t) => <option key={t.id} value={t.id}>{t.name} · {driverOf(state, t).name}</option>)}
                <option value="none">No truck</option>
              </select>
            </label>
            {filtersOn && (
              <Button icon={X} onClick={() => setParams((p) => { p.delete('q'); p.delete('status'); p.delete('truck'); return p; }, { replace: true })}>Clear filters</Button>
            )}
          </div>

          <table className="table jobs-table">
            <caption className="sr-only">Collections for Fri 2 Oct 2026, {filtered.length} shown</caption>
            <thead>
              <tr>
                <th scope="col">Job · window</th>
                <th scope="col">Customer · site</th>
                <th scope="col">Service</th>
                <th scope="col" className="num">Litres</th>
                <th scope="col">Truck · driver</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((j) => {
                const site = siteOf(state, j);
                const t = j.truckId ? state.trucks[j.truckId] : undefined;
                return (
                  <tr key={j.id} className={jobId === j.id ? 'row-selected' : undefined}>
                    <td data-label="Job"><span className="mono strong">{j.id}</span><span className="sub mono">{j.windowStart}–{j.windowEnd}</span></td>
                    <td data-label="Customer">
                      <button type="button" className="link-btn" onClick={() => open(j.id)}>{customerOf(state, j).name}</button>
                      <span className="sub">{site.address}, {site.locality}</span>
                    </td>
                    <td data-label="Service">{serviceLabel(j)}</td>
                    <td data-label="Litres" className="num">
                      {j.collection ? <><span className="mono">{formatLitres(j.collection.litres)}</span><span className="sub">actual</span></> : j.status === 'blocked' ? <span className="sub">none</span> : <><span className="mono">{formatLitres(j.estimatedLitres)}</span><span className="sub">estimated</span></>}
                    </td>
                    <td data-label="Truck">{t ? <>{t.name}<span className="sub">{driverOf(state, t).name}</span></> : <span className="muted">—</span>}</td>
                    <td data-label="Status"><JobStatusChip job={j} /></td>
                    <td className="action-cell">
                      {j.status === 'unassigned' ? (
                        <Button variant="primary" onClick={() => setAssignJob(j)} aria-label={`Assign ${j.id}`} data-focus-key={`row-${j.id}`}>Assign</Button>
                      ) : (
                        <Button onClick={() => open(j.id)} aria-label={`Open ${j.id}`} data-focus-key={`row-${j.id}`}>Open</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty">
              <p>No jobs match these filters.</p>
              <Button onClick={() => setParams({}, { replace: true })}>Clear filters</Button>
            </div>
          )}
        </section>

        <aside className="runs-rail" aria-label="Truck runs">
          <TruckRuns state={state} />
        </aside>
      </div>

      {runsOpen && (
        <Drawer title="Truck runs" onClose={() => setRunsOpen(false)}>
          <TruckRuns state={state} inDrawer />
        </Drawer>
      )}
      {assignJob && <AssignDialog job={state.jobs[assignJob.id]} onClose={() => setAssignJob(null)} />}
      <JobDrawer role="dispatch" />
    </div>
  );
}

function TruckRuns({ state, inDrawer }: { state: DemoState; inDrawer?: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="runs">
      <div className="runs-head">
        {!inDrawer && <h2 className="section-title">Truck runs</h2>}
        <span className="field-hint">Manual order</span>
      </div>
      <ul className="runs-list">
        {Object.values(state.trucks).map((t) => (
          <TruckRow key={t.id} truck={t} state={state} expanded={expanded === t.id} onToggle={() => setExpanded(expanded === t.id ? null : t.id)} />
        ))}
      </ul>
    </div>
  );
}

function TruckRow({ truck, state, expanded, onToggle }: { truck: Truck; state: DemoState; expanded: boolean; onToggle: () => void }) {
  const cmd = useCommand();
  const { open } = useJobParam();
  const load = collectingLoad(state, truck.id);
  const pendingLoad = truckLoads(state, truck.id).find((l) => l.status === 'awaiting_disposal');
  // A load awaiting disposal is still unreconciled; do not present the truck as empty.
  const displayedLoad = load ?? pendingLoad;
  const collected = displayedLoad ? loadTotal(displayedLoad) : 0;
  const pct = Math.min(100, Math.round((collected / truck.capacityLitres) * 100));
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const listId = `stops-${truck.id}`;

  return (
    <li className="run">
      <button type="button" className="run-toggle" aria-expanded={expanded} aria-controls={listId} onClick={onToggle}>
        <Chevron className="icon" aria-hidden />
        <span className="run-main">
          <span className="run-name"><TruckIcon className="icon-sm" aria-hidden /> {truck.name} · {driverOf(state, truck).name}</span>
          <span className="sub">{truck.wasteType === 'grease' ? 'Grease' : 'Septic'} · <span className="mono">{truck.runOrder.length}</span> {truck.runOrder.length === 1 ? 'stop' : 'stops'}</span>
        </span>
        <span className="run-load">
          <span className="mono">{formatLitres(collected)}</span>
          <span className="sub mono">of {formatLitres(truck.capacityLitres)}</span>
        </span>
      </button>
      <div className="meter" aria-hidden><span style={{ width: `${pct}%` }} /></div>
      <p className="run-status sub">
        {load ? <>Open load <span className="mono">{load.id}</span> · actual collected</> : pendingLoad ? <>Load <span className="mono">{pendingLoad.id}</span> awaiting disposal · no open load</> : 'No open load'}
      </p>
      {!load && canStartNewLoad(state, truck.id) && (
        <Button icon={Plus} pending={cmd.pending} onClick={() => cmd.run({ type: 'newLoad', truckId: truck.id }, `newload:${truck.id}:${Object.keys(state.loads).length}`)}>New load</Button>
      )}
      {cmd.error && <p className="field-error" role="alert">{cmd.error}</p>}
      {expanded && (
        <ol id={listId} className="stops">
          {truck.runOrder.map((id, i) => {
            const j = state.jobs[id];
            const movable = j.status === 'assigned';
            const canUp = movable && i > 0 && state.jobs[truck.runOrder[i - 1]].status === 'assigned';
            const canDown = movable && i < truck.runOrder.length - 1 && state.jobs[truck.runOrder[i + 1]].status === 'assigned';
            return (
              <li key={id} className="stop">
                <span className="stop-n mono">{i + 1}</span>
                <span className="stop-main">
                  <button type="button" className="link-btn" onClick={() => open(id)}>{customerOf(state, j).name}</button>
                  <span className="sub"><span className="mono">{j.id} · {j.windowStart}</span> · {STATUS_LABEL.job[j.status]}</span>
                  {!movable && <span className="sub">Position fixed: {j.status === 'blocked' ? 'blocked visit' : 'work started'}</span>}
                </span>
                <span className="stop-moves">
                  <button type="button" className="icon-btn" disabled={!canUp || cmd.pending} aria-label={`Move ${j.id} up`} title="Move up"
                    onClick={() => cmd.run({ type: 'move', truckId: truck.id, jobId: id, direction: -1 })}><ArrowUp className="icon" aria-hidden /></button>
                  <button type="button" className="icon-btn" disabled={!canDown || cmd.pending} aria-label={`Move ${j.id} down`} title="Move down"
                    onClick={() => cmd.run({ type: 'move', truckId: truck.id, jobId: id, direction: 1 })}><ArrowDown className="icon" aria-hidden /></button>
                </span>
              </li>
            );
          })}
          {truck.runOrder.length === 0 && <li className="sub">No stops yet.</li>}
        </ol>
      )}
    </li>
  );
}

export function AssignDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const state = useDemo();
  const [truckId, setTruckId] = useState(job.truckId ?? '');
  const cmd = useCommand();
  const trucks = useMemo(() => Object.values(state.trucks), [state.trucks]);
  const reassign = job.status === 'assigned';

  const save = async () => {
    if (!truckId) return;
    const r = await cmd.run({ type: 'assign', jobId: job.id, truckId }, `assign:${job.id}:${truckId}:${state.activity.length}`);
    if (r !== null) onClose();
  };

  return (
    <Dialog
      title={`${reassign ? 'Reassign' : 'Assign'} ${job.id} · ${customerOf(state, job).name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" pending={cmd.pending} disabled={!truckId || truckId === job.truckId} onClick={save}>{reassign ? 'Reassign' : 'Assign'}</Button>
        </>
      }
    >
      <p className="muted">{serviceLabel(job)} · estimated <span className="mono">{formatLitres(job.estimatedLitres)}</span> · <span className="mono">{job.windowStart}–{job.windowEnd}</span></p>
      <ErrorSummary message={cmd.error} />
      <fieldset className="truck-choices">
        <legend className="field-label">Truck and driver</legend>
        {trucks.map((t, i) => {
          const committed = committedLitres(state, t.id, job.id);
          const compatible = t.wasteType === job.service;
          return (
            <label key={t.id} className={`choice ${truckId === t.id ? 'choice-on' : ''}`}>
              <input type="radio" name="truck" value={t.id} checked={truckId === t.id} onChange={() => { setTruckId(t.id); cmd.clearError(); }} data-autofocus={i === 0 || undefined} />
              <span className="choice-main">
                <span className="strong">{t.name} · {driverOf(state, t).name}</span>
                <span className="sub">
                  {t.wasteType === 'grease' ? 'Grease only' : 'Septic only'}{!compatible && ' · not compatible with this job'} · <span className="mono">{formatLitres(committed)}</span> committed of <span className="mono">{formatLitres(t.capacityLitres)}</span>
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </Dialog>
  );
}
