import { ChevronRight, KeyRound, MapPin } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { collectingLoad, customerOf, formatLitres, loadTotal, siteOf, truckLoads } from '../domain/logic';
import { useDemo } from '../store/context';
import { JobDrawer, JobStatusChip, serviceLabel, useJobParam } from './JobDrawer';

export function DriverView() {
  const state = useDemo();
  const [params, setParams] = useSearchParams();
  const { open } = useJobParam();
  const trucks = Object.values(state.trucks);
  const driverId = params.get('driver') ?? trucks[0].driverId;
  const truck = trucks.find((t) => t.driverId === driverId) ?? trucks[0];
  const load = collectingLoad(state, truck.id);
  const waiting = truckLoads(state, truck.id).find((l) => l.status === 'awaiting_disposal');
  const stops = truck.runOrder.map((id) => state.jobs[id]);
  const done = stops.filter((j) => j.status === 'collected' || j.status === 'blocked').length;

  return (
    <div className="page page-driver">
      <h1 className="page-title">My run</h1>
      <label className="driver-select">
        <span className="field-label">Driver</span>
        <select className="input" value={truck.driverId} onChange={(e) => setParams({ driver: e.target.value })}>
          {trucks.map((t) => <option key={t.id} value={t.driverId}>{state.drivers[t.driverId].name} · {t.name}</option>)}
        </select>
      </label>

      <dl className="driver-summary">
        <div><dt>Truck</dt><dd>{truck.name} · {truck.wasteType === 'grease' ? 'Grease' : 'Septic'}</dd></div>
        <div>
          <dt>Current load</dt>
          <dd className="mono">{load ? `${formatLitres(loadTotal(load))} / ${formatLitres(truck.capacityLitres)}` : 'No open load'}</dd>
        </div>
        <div><dt>Progress</dt><dd className="mono">{done} of {stops.length} stops</dd></div>
      </dl>
      {!load && waiting && <p className="alert alert-warning">Load {waiting.id} is awaiting disposal. New collections can start once the office reconciles it and starts a new load.</p>}

      <h2 className="section-title">Stops</h2>
      <ol className="driver-stops">
        {stops.map((j, i) => {
          const site = siteOf(state, j);
          return (
            <li key={j.id} className="driver-stop">
              <div className="driver-stop-head">
                <span className="stop-n mono">{i + 1}</span>
                <div>
                  <h3 className="stop-title">{customerOf(state, j).name}</h3>
                  <p className="sub"><span className="mono">{j.id} · {j.windowStart}–{j.windowEnd}</span> · {serviceLabel(j)}</p>
                </div>
                <JobStatusChip job={j} />
              </div>
              <p className="driver-line"><MapPin className="icon" aria-hidden /> {site.address}, {site.locality}</p>
              <p className="driver-line"><KeyRound className="icon" aria-hidden /> {site.accessNote}</p>
              <button type="button" className={`btn btn-lg btn-block ${j.status === 'assigned' || j.status === 'in_progress' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => open(j.id)}>
                Open job <ChevronRight className="icon" aria-hidden />
              </button>
            </li>
          );
        })}
        {stops.length === 0 && <li className="empty">No stops assigned to {truck.name} yet.</li>}
      </ol>
      <JobDrawer role="driver" />
    </div>
  );
}
