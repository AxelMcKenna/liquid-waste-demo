export type WasteType = 'grease' | 'septic';
export type JobStatus = 'unassigned' | 'assigned' | 'in_progress' | 'collected' | 'blocked';
export type LoadStatus = 'collecting' | 'awaiting_disposal' | 'reconciled';
export type DisposalStatus = 'missing' | 'entered' | 'discrepancy' | 'reconciled';
export type BillingStatus = 'not_ready' | 'review_required' | 'ready' | 'draft';

export interface Customer {
  id: string;
  name: string;
}

export interface Site {
  id: string;
  customerId: string;
  address: string;
  locality: string;
  accessNote: string;
  /** Read-only context; there is no recurrence scheduler. */
  serviceIntervalWeeks: number;
}

export interface Driver {
  id: string;
  name: string;
}

export interface Truck {
  id: string;
  name: string;
  driverId: string;
  capacityLitres: number;
  wasteType: WasteType;
  /** Manual stop order for today. */
  runOrder: string[];
}

export interface Photo {
  id: string;
  jobId: string;
  stage: 'before' | 'after';
  /** 'sample' photos are built-in illustrations, never camera captures. */
  source: 'upload' | 'sample';
  name: string;
  mime: string;
  /** For sample photos: path of the bundled image. */
  sampleUrl?: string;
}

export interface ExtraWork {
  description: string;
  minutes: number;
  review: 'pending' | 'approved' | 'declined';
  reviewNote?: string;
}

export interface Collection {
  litres: number;
  photoIds: string[];
  notes: string;
  extraWork?: ExtraWork;
  collectedAt: string;
}

export interface Job {
  id: string;
  siteId: string;
  service: WasteType;
  windowStart: string; // "09:00"
  windowEnd: string;
  estimatedLitres: number;
  status: JobStatus;
  truckId?: string;
  loadId?: string;
  collection?: Collection;
  blockedReason?: string;
}

export interface LoadContribution {
  jobId: string;
  litres: number;
}

export interface Load {
  id: string;
  truckId: string;
  wasteType: WasteType;
  status: LoadStatus;
  contributions: LoadContribution[];
  disposalRecordId?: string;
  historical?: boolean;
}

export interface DisposalRecord {
  id: string;
  loadId: string;
  facility: string;
  docketRef: string;
  disposedAt: string; // "2026-10-02T13:40"
  /** Driver total at time of entry; stored separately from the facility figure. */
  driverLitres: number;
  reportedLitres: number;
  acceptedDifference?: { litres: number; reason: string };
}

export interface InvoiceLine {
  id: string;
  kind: 'base' | 'litres' | 'extra';
  description: string;
  /** Read-only source quantity: 1 for base, litres, or billable minutes. */
  quantity: number;
  /** Unit rate in 1/10,000 NZD (so NZ$0.12 = 1200). Per each, per litre or per hour. */
  unitRate: number;
}

export interface InvoiceDraft {
  id: string;
  jobId: string;
  createdAt: string;
  lines: InvoiceLine[];
  /** Illustrative GST in basis points (1500 = 15%). */
  taxBasisPoints: number;
}

export interface ActivityEvent {
  id: string;
  at: string;
  jobId?: string;
  loadId?: string;
  message: string;
}

export interface CollectionDraft {
  litres: string;
  photoIds: string[];
  extraWork: boolean;
  extraDescription: string;
  extraMinutes: string;
  notes: string;
  savedAt: string;
}

export interface DemoState {
  version: number;
  customers: Record<string, Customer>;
  sites: Record<string, Site>;
  drivers: Record<string, Driver>;
  trucks: Record<string, Truck>;
  jobs: Record<string, Job>;
  loads: Record<string, Load>;
  disposals: Record<string, DisposalRecord>;
  invoices: Record<string, InvoiceDraft>;
  /** Uniqueness key: one draft per source job. */
  invoiceByJob: Record<string, string>;
  photos: Record<string, Photo>;
  activity: ActivityEvent[];
  drafts: Record<string, CollectionDraft>;
  appliedMutations: Record<string, true>;
  seq: number;
}
