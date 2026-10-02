import type { DemoState, Photo } from './types';
import { buildInvoiceLines } from './pricing';

export const FIXTURE_VERSION = 1;
export const DEMO_DATE = '2026-10-02';

export const SAMPLE_PHOTOS = {
  before: '/samples/grease-trap-before.svg',
  after: '/samples/grease-trap-after.svg',
} as const;

function samplePhotos(jobId: string): Photo[] {
  return (['before', 'after'] as const).map((stage) => ({
    id: `P-${jobId}-${stage}`,
    jobId,
    stage,
    source: 'sample',
    name: `Sample ${stage} photo (fictional)`,
    mime: 'image/svg+xml',
    sampleUrl: SAMPLE_PHOTOS[stage],
  }));
}

export function createFixtures(): DemoState {
  const photos = [...samplePhotos('J102'), ...samplePhotos('J104'), ...samplePhotos('J105'), ...samplePhotos('J107')];
  const at = (time: string) => `${DEMO_DATE}T${time}:00+13:00`;
  const collection = (jobId: string, litres: number, time: string) => ({
    litres,
    photoIds: [`P-${jobId}-before`, `P-${jobId}-after`],
    notes: '',
    collectedAt: at(time),
  });

  const state: DemoState = {
    version: FIXTURE_VERSION,
    customers: {
      C01: { id: 'C01', name: 'Harbour Pantry' },
      C02: { id: 'C02', name: 'Orchard Kitchen' },
      C03: { id: 'C03', name: 'Hillcrest Lodge' },
      C04: { id: 'C04', name: 'Quay Canteen' },
      C05: { id: 'C05', name: 'Parkside Eatery' },
      C06: { id: 'C06', name: 'Valley Retreat' },
      C07: { id: 'C07', name: 'Cedar Kitchen' },
      C08: { id: 'C08', name: 'Ridge Cottage' },
    },
    sites: {
      S01: { id: 'S01', customerId: 'C01', address: '14 Demo Lane', locality: 'Ōtāhuhu', accessNote: 'Trap lid behind the loading bay. Ask the kitchen lead for the gate code.', serviceIntervalWeeks: 4 },
      S02: { id: 'S02', customerId: 'C02', address: '3 Sample Road', locality: 'Ōtāhuhu', accessNote: 'Service lane off the car park. Hose bib on the left wall.', serviceIntervalWeeks: 4 },
      S03: { id: 'S03', customerId: 'C03', address: '210 Sample Road', locality: 'Whangārei', accessNote: 'Tank beside the woodshed. Long hose run of about 30 m.', serviceIntervalWeeks: 156 },
      S04: { id: 'S04', customerId: 'C04', address: '7 Demo Lane', locality: 'Whangārei', accessNote: 'Underground interceptor in the courtyard. Cones required.', serviceIntervalWeeks: 2 },
      S05: { id: 'S05', customerId: 'C05', address: '41 Demo Lane', locality: 'Whangārei', accessNote: 'Trap under the dish pit. Bring the short lid key.', serviceIntervalWeeks: 4 },
      S06: { id: 'S06', customerId: 'C06', address: '88 Sample Road', locality: 'Whangārei', accessNote: 'Farm gate is usually open. Call ahead if it is closed.', serviceIntervalWeeks: 156 },
      S07: { id: 'S07', customerId: 'C07', address: '19 Demo Lane', locality: 'Ōtāhuhu', accessNote: 'Rear door. Trap is near the cool store.', serviceIntervalWeeks: 6 },
      S08: { id: 'S08', customerId: 'C08', address: '5 Sample Road', locality: 'Whangārei', accessNote: 'Tank lid under the deck steps.', serviceIntervalWeeks: 156 },
    },
    drivers: {
      D01: { id: 'D01', name: 'Mara Cole' },
      D02: { id: 'D02', name: 'Eli Ward' },
      D03: { id: 'D03', name: 'Finn Reed' },
    },
    trucks: {
      T01: { id: 'T01', name: 'T01', driverId: 'D01', capacityLitres: 6000, wasteType: 'grease', runOrder: ['J102'] },
      T02: { id: 'T02', name: 'T02', driverId: 'D02', capacityLitres: 8000, wasteType: 'septic', runOrder: ['J103', 'J106'] },
      T03: { id: 'T03', name: 'T03', driverId: 'D03', capacityLitres: 6000, wasteType: 'grease', runOrder: ['J104', 'J105'] },
    },
    jobs: {
      J101: { id: 'J101', siteId: 'S01', service: 'grease', windowStart: '09:00', windowEnd: '11:00', estimatedLitres: 600, status: 'unassigned' },
      J102: { id: 'J102', siteId: 'S02', service: 'grease', windowStart: '07:00', windowEnd: '08:30', estimatedLitres: 500, status: 'collected', truckId: 'T01', loadId: 'L101', collection: collection('J102', 450, '07:48') },
      J103: { id: 'J103', siteId: 'S03', service: 'septic', windowStart: '10:00', windowEnd: '12:00', estimatedLitres: 2800, status: 'assigned', truckId: 'T02' },
      J104: { id: 'J104', siteId: 'S04', service: 'grease', windowStart: '06:30', windowEnd: '08:00', estimatedLitres: 1800, status: 'collected', truckId: 'T03', loadId: 'L103', collection: collection('J104', 1800, '07:20') },
      J105: {
        id: 'J105', siteId: 'S05', service: 'grease', windowStart: '08:00', windowEnd: '09:30', estimatedLitres: 600, status: 'collected', truckId: 'T03', loadId: 'L103',
        collection: { ...collection('J105', 500, '08:55'), extraWork: { description: 'Cleared a blocked inlet pipe before pumping', minutes: 30, review: 'pending' } },
      },
      J106: { id: 'J106', siteId: 'S06', service: 'septic', windowStart: '08:00', windowEnd: '10:00', estimatedLitres: 3000, status: 'blocked', truckId: 'T02', blockedReason: 'Access locked: farm gate closed and no answer by phone.' },
      J107: { id: 'J107', siteId: 'S07', service: 'grease', windowStart: '05:30', windowEnd: '06:30', estimatedLitres: 900, status: 'collected', truckId: 'T03', loadId: 'L104', collection: collection('J107', 900, '06:05') },
      J108: { id: 'J108', siteId: 'S08', service: 'septic', windowStart: '13:00', windowEnd: '15:00', estimatedLitres: 1200, status: 'unassigned' },
    },
    loads: {
      L101: { id: 'L101', truckId: 'T01', wasteType: 'grease', status: 'collecting', contributions: [{ jobId: 'J102', litres: 450 }] },
      L102: { id: 'L102', truckId: 'T02', wasteType: 'septic', status: 'collecting', contributions: [] },
      L103: { id: 'L103', truckId: 'T03', wasteType: 'grease', status: 'awaiting_disposal', contributions: [{ jobId: 'J104', litres: 1800 }, { jobId: 'J105', litres: 500 }], disposalRecordId: 'DR103' },
      L104: { id: 'L104', truckId: 'T03', wasteType: 'grease', status: 'reconciled', contributions: [{ jobId: 'J107', litres: 900 }], disposalRecordId: 'DR104', historical: true },
    },
    disposals: {
      DR103: { id: 'DR103', loadId: 'L103', facility: 'South Yard Demo Facility', docketRef: 'SY-DEMO-2213', disposedAt: `${DEMO_DATE}T09:40`, driverLitres: 2300, reportedLitres: 2200 },
      DR104: { id: 'DR104', loadId: 'L104', facility: 'South Yard Demo Facility', docketRef: 'SY-DEMO-2207', disposedAt: `${DEMO_DATE}T06:50`, driverLitres: 900, reportedLitres: 900 },
    },
    invoices: {},
    invoiceByJob: {},
    photos: Object.fromEntries(photos.map((p) => [p.id, p])),
    activity: [
      { id: 'A1', at: at('06:05'), jobId: 'J107', loadId: 'L104', message: 'Collection confirmed: 900 L onto L104' },
      { id: 'A2', at: at('06:52'), loadId: 'L104', message: 'Load L104 reconciled against docket SY-DEMO-2207 (900 L)' },
      { id: 'A3', at: at('07:05'), jobId: 'J107', message: 'Draft invoice D107 created' },
      { id: 'A4', at: at('07:20'), jobId: 'J104', loadId: 'L103', message: 'Collection confirmed: 1,800 L onto L103' },
      { id: 'A5', at: at('07:48'), jobId: 'J102', loadId: 'L101', message: 'Collection confirmed: 450 L onto L101' },
      { id: 'A6', at: at('08:20'), jobId: 'J106', message: 'Visit blocked: Access locked: farm gate closed and no answer by phone.' },
      { id: 'A7', at: at('08:55'), jobId: 'J105', loadId: 'L103', message: 'Collection confirmed: 500 L onto L103 · additional work flagged for office review' },
      { id: 'A8', at: at('09:05'), loadId: 'L103', message: 'Load L103 finished; awaiting disposal' },
      { id: 'A9', at: at('09:45'), loadId: 'L103', message: 'Disposal record DR103 entered: 2,200 L at South Yard Demo Facility' },
    ],
    drafts: {},
    appliedMutations: {},
    seq: 100,
  };

  state.invoices.D107 = {
    id: 'D107',
    jobId: 'J107',
    createdAt: at('07:05'),
    lines: buildInvoiceLines(state, 'J107'),
    taxBasisPoints: 1500,
  };
  state.invoiceByJob.J107 = 'D107';
  return state;
}
