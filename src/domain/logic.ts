import type {
  BillingStatus, CollectionDraft, DemoState, DisposalStatus, Job, Load, Photo, Truck,
} from './types';
import { buildInvoiceLines, DEFAULT_TAX_BASIS_POINTS } from './pricing';

/* ---------- formatting ---------- */

const litresFmt = new Intl.NumberFormat('en-NZ', { maximumFractionDigits: 0 });
export const formatLitres = (n: number) => `${litresFmt.format(n)} L`;

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

/** "2026-10-02T13:40" (local Auckland wall time, as entered) → "2 Oct 2026, 13:40" */
export function formatLocalDateTime(local: string): string {
  const [d, t] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const month = new Intl.DateTimeFormat('en-NZ', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, day)));
  return `${day} ${month} ${y}, ${t}`;
}

export const STATUS_LABEL = {
  job: { unassigned: 'Unassigned', assigned: 'Assigned', in_progress: 'In progress', collected: 'Collected', blocked: 'Blocked' },
  load: { collecting: 'Collecting', awaiting_disposal: 'Awaiting disposal', reconciled: 'Reconciled' },
  disposal: { missing: 'Disposal missing', entered: 'Disposal entered', discrepancy: 'Discrepancy', reconciled: 'Reconciled' },
  billing: { not_ready: 'Not ready', review_required: 'Review required', ready: 'Ready to draft', draft: 'Draft' },
} as const;

/* ---------- selectors ---------- */

export const siteOf = (s: DemoState, job: Job) => s.sites[job.siteId];
export const customerOf = (s: DemoState, job: Job) => s.customers[siteOf(s, job).customerId];
export const driverOf = (s: DemoState, truck: Truck) => s.drivers[truck.driverId];

export const loadTotal = (load: Load) => load.contributions.reduce((sum, c) => sum + c.litres, 0);

export function collectingLoad(s: DemoState, truckId: string): Load | undefined {
  return Object.values(s.loads).find((l) => l.truckId === truckId && l.status === 'collecting');
}

/** Today's (non-historical) loads for a truck, oldest first. */
export function truckLoads(s: DemoState, truckId: string): Load[] {
  return Object.values(s.loads).filter((l) => l.truckId === truckId && !l.historical);
}

/** Litres in today's open load plus estimates of pending jobs assigned to the truck. */
export function committedLitres(s: DemoState, truckId: string, excludeJobId?: string): number {
  const load = collectingLoad(s, truckId);
  const pending = Object.values(s.jobs)
    .filter((j) => j.truckId === truckId && j.id !== excludeJobId && (j.status === 'assigned' || j.status === 'in_progress'))
    .reduce((sum, j) => sum + j.estimatedLitres, 0);
  return (load ? loadTotal(load) : 0) + pending;
}

export function remainingCapacity(s: DemoState, truckId: string): number {
  const load = collectingLoad(s, truckId);
  return s.trucks[truckId].capacityLitres - (load ? loadTotal(load) : 0);
}

export function disposalStatus(s: DemoState, load: Load): DisposalStatus {
  if (load.status === 'reconciled') return 'reconciled';
  const rec = load.disposalRecordId ? s.disposals[load.disposalRecordId] : undefined;
  if (!rec) return 'missing';
  if (rec.reportedLitres !== rec.driverLitres && !rec.acceptedDifference) return 'discrepancy';
  return 'entered';
}

export function billingInfo(s: DemoState, jobId: string): { status: BillingStatus; blockers: string[] } {
  const job = s.jobs[jobId];
  if (s.invoiceByJob[jobId]) return { status: 'draft', blockers: [] };
  if (job.status === 'blocked') return { status: 'not_ready', blockers: ['Visit blocked: nothing was collected'] };
  if (job.status !== 'collected' || !job.collection) return { status: 'not_ready', blockers: ['Not collected yet'] };
  const blockers: string[] = [];
  if (job.collection.photoIds.length === 0) blockers.push('Missing collection photo evidence');
  const load = job.loadId ? s.loads[job.loadId] : undefined;
  if (!load || load.status !== 'reconciled') {
    const ds = load ? disposalStatus(s, load) : 'missing';
    blockers.push(ds === 'discrepancy' ? `Volume discrepancy on ${load!.id} not resolved` : `Disposal for ${load?.id ?? 'load'} not reconciled`);
  }
  if (job.collection.extraWork?.review === 'pending') blockers.push('Additional work awaiting office review');
  return { status: blockers.length ? 'review_required' : 'ready', blockers };
}

export type AttentionRow =
  | { group: 'missing_disposal'; loadId: string }
  | { group: 'discrepancy'; loadId: string }
  | { group: 'ready_to_reconcile'; loadId: string }
  | { group: 'extra_work'; jobId: string };

export const ATTENTION_GROUPS = [
  { key: 'missing_disposal', title: 'Missing disposal record' },
  { key: 'discrepancy', title: 'Volume discrepancy' },
  { key: 'ready_to_reconcile', title: 'Ready to reconcile' },
  { key: 'extra_work', title: 'Additional work review' },
] as const;

export function attentionRows(s: DemoState): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const load of Object.values(s.loads)) {
    if (load.status === 'reconciled' || load.contributions.length === 0) continue;
    const ds = disposalStatus(s, load);
    if (ds === 'missing') rows.push({ group: 'missing_disposal', loadId: load.id });
    else if (ds === 'discrepancy') rows.push({ group: 'discrepancy', loadId: load.id });
    else rows.push({ group: 'ready_to_reconcile', loadId: load.id });
  }
  for (const job of Object.values(s.jobs)) {
    if (job.collection?.extraWork?.review === 'pending') rows.push({ group: 'extra_work', jobId: job.id });
  }
  return rows;
}

export function jobsReadyForDraft(s: DemoState): Job[] {
  return Object.values(s.jobs).filter((j) => billingInfo(s, j.id).status === 'ready');
}

/** Why a job can't be started right now, or null if it can. */
export function startBlocker(s: DemoState, job: Job): string | null {
  if (job.status !== 'assigned') return null;
  const truck = s.trucks[job.truckId!];
  if (!collectingLoad(s, truck.id)) {
    const open = truckLoads(s, truck.id).find((l) => l.status === 'awaiting_disposal');
    return open
      ? `${truck.name}'s load ${open.id} is awaiting disposal. The office must reconcile it and start a new load before this collection.`
      : `${truck.name} has no open load. Start a new load first.`;
  }
  return null;
}

export function canStartNewLoad(s: DemoState, truckId: string): boolean {
  return !collectingLoad(s, truckId) && truckLoads(s, truckId).every((l) => l.status === 'reconciled');
}

/* ---------- validation ---------- */

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 3;

export function validatePhotoFile(file: { type: string; size: number; name: string }, existingCount: number): string | null {
  if (existingCount >= MAX_PHOTOS) return `You can add up to ${MAX_PHOTOS} photos.`;
  if (!PHOTO_TYPES.includes(file.type)) return `${file.name} is not a JPEG, PNG or WebP image.`;
  if (file.size > MAX_PHOTO_BYTES) return `${file.name} is larger than 5 MB.`;
  return null;
}

/** Parse a strictly positive whole number of litres; null if invalid. */
export function parseWholeNumber(input: string): number | null {
  if (!/^\s*\d+\s*$/.test(input)) return null;
  const n = Number(input);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export interface CollectionInput {
  litres: string;
  photoIds: string[];
  extraWork: boolean;
  extraDescription: string;
  extraMinutes: string;
  notes: string;
}

export type FieldErrors = Partial<Record<'litres' | 'photos' | 'extraDescription' | 'extraMinutes', string>>;

export function validateCollection(s: DemoState, jobId: string, input: CollectionInput): FieldErrors {
  const errors: FieldErrors = {};
  const job = s.jobs[jobId];
  const litres = parseWholeNumber(input.litres);
  if (input.litres.trim() === '') errors.litres = 'Enter the litres collected.';
  else if (litres === null) errors.litres = 'Enter a positive whole number of litres.';
  else if (job.truckId) {
    const remaining = remainingCapacity(s, job.truckId);
    if (litres > remaining) errors.litres = `${formatLitres(litres)} is more than the truck's remaining capacity of ${formatLitres(remaining)}. Check the reading.`;
  }
  if (input.photoIds.length === 0) errors.photos = 'Add at least one photo.';
  else if (input.photoIds.length > MAX_PHOTOS) errors.photos = `Use no more than ${MAX_PHOTOS} photos.`;
  if (input.extraWork) {
    if (!input.extraDescription.trim()) errors.extraDescription = 'Describe the additional work.';
    const minutes = parseWholeNumber(input.extraMinutes);
    if (minutes === null || minutes > 480) errors.extraMinutes = 'Enter minutes as a whole number from 1 to 480.';
  }
  return errors;
}

/* ---------- commands ---------- */

export class DomainError extends Error {
  constructor(message: string, readonly fieldErrors?: Record<string, string>) {
    super(message);
  }
}

export type Command =
  | { type: 'assign'; jobId: string; truckId: string }
  | { type: 'move'; truckId: string; jobId: string; direction: -1 | 1 }
  | { type: 'start'; jobId: string }
  | { type: 'saveDraft'; jobId: string; draft: Omit<CollectionDraft, 'savedAt'> }
  | { type: 'addPhoto'; jobId: string; photo: Omit<Photo, 'id' | 'jobId'>; blob?: Blob }
  | { type: 'removePhoto'; jobId: string; photoId: string }
  | { type: 'setPhotoStage'; photoId: string; stage: Photo['stage'] }
  | { type: 'confirmCollection'; jobId: string; input: CollectionInput }
  | { type: 'block'; jobId: string; reason: string }
  | { type: 'resolveBlocked'; jobId: string }
  | { type: 'finishLoad'; loadId: string }
  | { type: 'saveDisposal'; loadId: string; facility: string; docketRef: string; disposedAt: string; reportedLitres: string }
  | { type: 'acceptDifference'; loadId: string; reason: string }
  | { type: 'reconcile'; loadId: string }
  | { type: 'newLoad'; truckId: string }
  | { type: 'reviewExtra'; jobId: string; decision: 'approved' | 'declined'; note: string }
  | { type: 'createDraft'; jobId: string }
  | { type: 'updateInvoice'; invoiceId: string; lines: { id: string; description: string; unitRate: number }[]; taxBasisPoints: number };

export interface CommandResult {
  state: DemoState;
  putBlobs: { id: string; blob: Blob }[];
  deleteBlobs: string[];
  /** Id of an entity created or referenced, e.g. a new photo or invoice. */
  ref?: string;
}

export interface Clock {
  now(): string;
}

function emptyDraft(): CollectionDraft {
  return { litres: '', photoIds: [], extraWork: false, extraDescription: '', extraMinutes: '', notes: '', savedAt: '' };
}

/**
 * Applies a command to a deep copy of state. Throws DomainError if the
 * command is not allowed; the input state is never mutated.
 */
export function applyCommand(prev: DemoState, cmd: Command, clock: Clock): CommandResult {
  const s: DemoState = structuredClone(prev);
  const result: CommandResult = { state: s, putBlobs: [], deleteBlobs: [] };
  const now = clock.now();
  const nextId = (prefix: string) => `${prefix}${++s.seq}`;
  const log = (message: string, refs: { jobId?: string; loadId?: string } = {}) =>
    s.activity.push({ id: nextId('A'), at: now, message, ...refs });
  const job = 'jobId' in cmd ? s.jobs[cmd.jobId] : undefined;
  if ('jobId' in cmd && !job) throw new DomainError(`Unknown job ${cmd.jobId}`);

  switch (cmd.type) {
    case 'assign': {
      const j = job!;
      const truck = s.trucks[cmd.truckId];
      if (!truck) throw new DomainError('Choose a truck.');
      if (j.status !== 'unassigned' && j.status !== 'assigned')
        throw new DomainError(`${j.id} has already started, so it can't be reassigned.`);
      if (j.truckId === truck.id) return result;
      if (truck.wasteType !== j.service)
        throw new DomainError(`${truck.name} carries ${truck.wasteType} waste only. ${j.id} is a ${j.service} job, and loads can't mix waste types.`);
      const committed = committedLitres(s, truck.id, j.id);
      if (committed + j.estimatedLitres > truck.capacityLitres)
        throw new DomainError(
          `${truck.name} would be over capacity: ${formatLitres(committed)} already committed plus ${formatLitres(j.estimatedLitres)} estimated exceeds ${formatLitres(truck.capacityLitres)}. Choose another truck or move a stop.`,
        );
      if (j.truckId) s.trucks[j.truckId].runOrder = s.trucks[j.truckId].runOrder.filter((id) => id !== j.id);
      const from = j.truckId;
      j.truckId = truck.id;
      j.status = 'assigned';
      truck.runOrder.push(j.id);
      log(from ? `Reassigned from ${from} to ${truck.name} (${driverOf(s, truck).name})` : `Assigned to ${truck.name} (${driverOf(s, truck).name})`, { jobId: j.id });
      return result;
    }
    case 'move': {
      const truck = s.trucks[cmd.truckId];
      const i = truck.runOrder.indexOf(cmd.jobId);
      const k = i + cmd.direction;
      if (i < 0 || k < 0 || k >= truck.runOrder.length) throw new DomainError('That stop is already at the end of the run.');
      const other = truck.runOrder[k];
      for (const id of [cmd.jobId, other]) {
        if (s.jobs[id].status !== 'assigned') throw new DomainError(`${id} has started or finished, so its position is fixed.`);
      }
      [truck.runOrder[i], truck.runOrder[k]] = [other, cmd.jobId];
      log(`Moved ${cmd.direction < 0 ? 'up' : 'down'} in ${truck.name}'s manual order`, { jobId: cmd.jobId });
      return result;
    }
    case 'start': {
      const j = job!;
      if (j.status !== 'assigned') throw new DomainError(`${j.id} is ${STATUS_LABEL.job[j.status].toLowerCase()}, so it can't be started.`);
      const blocker = startBlocker(s, j);
      if (blocker) throw new DomainError(blocker);
      j.status = 'in_progress';
      log('Job started by driver', { jobId: j.id });
      return result;
    }
    case 'saveDraft': {
      const j = job!;
      if (j.status !== 'in_progress') throw new DomainError('Only jobs in progress have a collection draft.');
      s.drafts[j.id] = { ...cmd.draft, photoIds: s.drafts[j.id]?.photoIds ?? [], savedAt: now };
      return result;
    }
    case 'addPhoto': {
      const j = job!;
      if (j.status !== 'in_progress') throw new DomainError('Photos can only be added to a job in progress.');
      const draft = (s.drafts[j.id] ??= emptyDraft());
      if (draft.photoIds.length >= MAX_PHOTOS) throw new DomainError(`You can add up to ${MAX_PHOTOS} photos.`);
      const id = nextId('P');
      s.photos[id] = { ...cmd.photo, id, jobId: j.id };
      draft.photoIds.push(id);
      draft.savedAt = now;
      if (cmd.blob) result.putBlobs.push({ id, blob: cmd.blob });
      result.ref = id;
      return result;
    }
    case 'removePhoto': {
      const draft = s.drafts[cmd.jobId];
      if (!draft?.photoIds.includes(cmd.photoId)) return result;
      draft.photoIds = draft.photoIds.filter((id) => id !== cmd.photoId);
      draft.savedAt = now;
      if (s.photos[cmd.photoId].source === 'upload') result.deleteBlobs.push(cmd.photoId);
      delete s.photos[cmd.photoId];
      return result;
    }
    case 'setPhotoStage': {
      const photo = s.photos[cmd.photoId];
      if (!photo || s.jobs[photo.jobId].status !== 'in_progress') throw new DomainError('That photo is part of a confirmed record.');
      photo.stage = cmd.stage;
      return result;
    }
    case 'confirmCollection': {
      const j = job!;
      if (j.status !== 'in_progress') throw new DomainError(`${j.id} is ${STATUS_LABEL.job[j.status].toLowerCase()}; only a job in progress can be confirmed.`);
      const errors = validateCollection(s, j.id, cmd.input);
      if (Object.keys(errors).length) throw new DomainError('Check the highlighted fields.', errors);
      const load = collectingLoad(s, j.truckId!);
      if (!load || load.wasteType !== j.service) throw new DomainError(startBlocker(s, { ...j, status: 'assigned' }) ?? 'No compatible open load.');
      const litres = parseWholeNumber(cmd.input.litres)!;
      j.collection = {
        litres,
        photoIds: [...cmd.input.photoIds],
        notes: cmd.input.notes.trim(),
        collectedAt: now,
        ...(cmd.input.extraWork
          ? { extraWork: { description: cmd.input.extraDescription.trim(), minutes: parseWholeNumber(cmd.input.extraMinutes)!, review: 'pending' as const } }
          : {}),
      };
      j.status = 'collected';
      j.loadId = load.id;
      load.contributions.push({ jobId: j.id, litres });
      delete s.drafts[j.id];
      log(`Collection confirmed: ${formatLitres(litres)} onto ${load.id}${cmd.input.extraWork ? ' · additional work flagged for office review' : ''}`, { jobId: j.id, loadId: load.id });
      return result;
    }
    case 'block': {
      const j = job!;
      if (j.status !== 'assigned' && j.status !== 'in_progress') throw new DomainError('Only an assigned or in-progress visit can be marked blocked.');
      const reason = cmd.reason.trim();
      if (!reason) throw new DomainError('Give a reason for the blocked visit.', { reason: 'Give a reason for the blocked visit.' });
      j.status = 'blocked';
      j.blockedReason = reason;
      for (const id of s.drafts[j.id]?.photoIds ?? []) {
        if (s.photos[id]?.source === 'upload') result.deleteBlobs.push(id);
        delete s.photos[id];
      }
      delete s.drafts[j.id];
      log(`Visit blocked: ${reason}`, { jobId: j.id });
      return result;
    }
    case 'resolveBlocked': {
      const j = job!;
      if (j.status !== 'blocked') throw new DomainError(`${j.id} is not blocked.`);
      j.status = 'assigned';
      delete j.blockedReason;
      log('Blocked visit resolved by dispatch; returned to assigned', { jobId: j.id });
      return result;
    }
    case 'finishLoad': {
      const load = s.loads[cmd.loadId];
      if (load.status !== 'collecting') throw new DomainError(`${load.id} is already finished.`);
      if (load.contributions.length === 0) throw new DomainError(`${load.id} is empty, so there is nothing to dispose of.`);
      load.status = 'awaiting_disposal';
      log(`Load ${load.id} finished; awaiting disposal`, { loadId: load.id });
      return result;
    }
    case 'saveDisposal': {
      const load = s.loads[cmd.loadId];
      if (load.status !== 'awaiting_disposal') throw new DomainError(load.status === 'collecting' ? 'Finish the load before entering a disposal record.' : `${load.id} is reconciled and can't be edited.`);
      const fe: Record<string, string> = {};
      if (!cmd.facility.trim()) fe.facility = 'Enter the facility.';
      if (!cmd.docketRef.trim()) fe.docketRef = 'Enter the docket reference.';
      if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(cmd.disposedAt)) fe.disposedAt = 'Enter the disposal date and a 24-hour time such as 13:40.';
      const reported = parseWholeNumber(cmd.reportedLitres);
      if (reported === null) fe.reportedLitres = 'Enter the facility litres as a positive whole number.';
      if (Object.keys(fe).length) throw new DomainError('Check the highlighted fields.', fe);
      const existing = load.disposalRecordId ? s.disposals[load.disposalRecordId] : undefined;
      const id = existing?.id ?? `DR${load.id.slice(1)}`;
      const driverLitres = loadTotal(load);
      s.disposals[id] = {
        id, loadId: load.id, facility: cmd.facility.trim(), docketRef: cmd.docketRef.trim(), disposedAt: cmd.disposedAt,
        driverLitres, reportedLitres: reported!,
        // An accepted difference only stands while the figure it was accepted for is unchanged.
        ...(existing?.acceptedDifference && existing.reportedLitres === reported ? { acceptedDifference: existing.acceptedDifference } : {}),
      };
      load.disposalRecordId = id;
      log(`Disposal record ${id} ${existing ? 'updated' : 'entered'}: ${formatLitres(reported!)} at ${cmd.facility.trim()}`, { loadId: load.id });
      return result;
    }
    case 'acceptDifference': {
      const load = s.loads[cmd.loadId];
      const rec = load.disposalRecordId ? s.disposals[load.disposalRecordId] : undefined;
      if (!rec || load.status !== 'awaiting_disposal') throw new DomainError('There is no open disposal record to accept.');
      const diff = rec.driverLitres - rec.reportedLitres;
      if (diff === 0) throw new DomainError('The totals match; there is no difference to accept.');
      const reason = cmd.reason.trim();
      if (!reason) throw new DomainError('Give a reason for accepting the difference.', { reason: 'Give a reason for accepting the difference.' });
      rec.acceptedDifference = { litres: diff, reason };
      log(`Accepted difference of ${formatLitres(Math.abs(diff))} (driver ${formatLitres(rec.driverLitres)}, facility ${formatLitres(rec.reportedLitres)}): ${reason}`, { loadId: load.id });
      return result;
    }
    case 'reconcile': {
      const load = s.loads[cmd.loadId];
      if (load.status !== 'awaiting_disposal') throw new DomainError(`${load.id} must be awaiting disposal to reconcile.`);
      const ds = disposalStatus(s, load);
      if (ds === 'missing') throw new DomainError('Enter the disposal record first.');
      if (ds === 'discrepancy') throw new DomainError('Correct the disposal entry or accept the difference with a reason first.');
      load.status = 'reconciled';
      log(`Load ${load.id} reconciled against docket ${s.disposals[load.disposalRecordId!].docketRef}`, { loadId: load.id });
      return result;
    }
    case 'newLoad': {
      const truck = s.trucks[cmd.truckId];
      if (!canStartNewLoad(s, truck.id)) throw new DomainError(`${truck.name}'s previous load must be reconciled first.`);
      const max = Math.max(...Object.keys(s.loads).map((id) => Number(id.slice(1))));
      const id = `L${max + 1}`;
      s.loads[id] = { id, truckId: truck.id, wasteType: truck.wasteType, status: 'collecting', contributions: [] };
      log(`New load ${id} started on ${truck.name}`, { loadId: id });
      result.ref = id;
      return result;
    }
    case 'reviewExtra': {
      const extra = job!.collection?.extraWork;
      if (!extra || extra.review !== 'pending') throw new DomainError('There is no additional work awaiting review.');
      const note = cmd.note.trim();
      if (!note) throw new DomainError('Add a review note.', { note: 'Add a review note.' });
      extra.review = cmd.decision;
      extra.reviewNote = note;
      log(`Additional work ${cmd.decision}: ${note}`, { jobId: job!.id });
      return result;
    }
    case 'createDraft': {
      const j = job!;
      const existing = s.invoiceByJob[j.id];
      if (existing) {
        result.ref = existing;
        return result;
      }
      const info = billingInfo(s, j.id);
      if (info.status !== 'ready') throw new DomainError(info.blockers.join(' · '));
      const id = `D${j.id.slice(1)}`;
      s.invoices[id] = { id, jobId: j.id, createdAt: now, lines: buildInvoiceLines(s, j.id), taxBasisPoints: DEFAULT_TAX_BASIS_POINTS };
      s.invoiceByJob[j.id] = id;
      log(`Draft invoice ${id} created`, { jobId: j.id });
      result.ref = id;
      return result;
    }
    case 'updateInvoice': {
      const inv = s.invoices[cmd.invoiceId];
      if (!inv) throw new DomainError('Unknown draft.');
      for (const edit of cmd.lines) {
        const line = inv.lines.find((l) => l.id === edit.id);
        if (!line) continue;
        if (!edit.description.trim()) throw new DomainError('Line descriptions can’t be blank.');
        line.description = edit.description.trim();
        line.unitRate = edit.unitRate;
      }
      inv.taxBasisPoints = cmd.taxBasisPoints;
      log(`Draft ${inv.id} edited`, { jobId: inv.jobId });
      return result;
    }
  }
}
