import type { DemoState, InvoiceDraft, InvoiceLine } from './types';

/** Illustrative demo rates in 1/10,000 NZD. Not a real price list. */
export const RATES = {
  grease: { base: 1_800_000, perLitre: 1200 },
  septic: { base: 2_400_000, perLitre: 1000 },
  extraPerHour: 900_000,
} as const;

export const DEFAULT_TAX_BASIS_POINTS = 1500;

/** Integer division rounding half up, for non-negative integers. */
export function roundDiv(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Additional work is billed in 15-minute increments, rounded up. */
export function billableMinutes(minutes: number): number {
  return Math.ceil(minutes / 15) * 15;
}

/** Line amount in integer cents. */
export function lineAmountCents(line: InvoiceLine): number {
  // unitRate is 1/10,000 NZD; cents are 1/100 NZD.
  const divisor = line.kind === 'extra' ? 100 * 60 : 100;
  return roundDiv(line.quantity * line.unitRate, divisor);
}

export function invoiceTotals(draft: Pick<InvoiceDraft, 'lines' | 'taxBasisPoints'>) {
  const subtotal = draft.lines.reduce((sum, line) => sum + lineAmountCents(line), 0);
  const tax = roundDiv(subtotal * draft.taxBasisPoints, 10_000);
  return { subtotal, tax, total: subtotal + tax };
}

export function buildInvoiceLines(state: DemoState, jobId: string): InvoiceLine[] {
  const job = state.jobs[jobId];
  if (!job.collection) throw new Error(`${jobId} has no collection`);
  const rates = RATES[job.service];
  const label = job.service === 'grease' ? 'Grease trap collection' : 'Septic tank pump-out';
  const lines: InvoiceLine[] = [
    { id: `${jobId}-base`, kind: 'base', description: `${label} · base charge`, quantity: 1, unitRate: rates.base },
    { id: `${jobId}-litres`, kind: 'litres', description: `${label} · volume`, quantity: job.collection.litres, unitRate: rates.perLitre },
  ];
  const extra = job.collection.extraWork;
  if (extra?.review === 'approved') {
    lines.push({
      id: `${jobId}-extra`,
      kind: 'extra',
      description: `Additional work · ${extra.description}`,
      quantity: billableMinutes(extra.minutes),
      unitRate: RATES.extraPerHour,
    });
  }
  return lines;
}

export function formatNzd(cents: number): string {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', currencyDisplay: 'code', minimumFractionDigits: 2 })
    .format(cents / 100)
    .replace('NZD', 'NZ$')
    .replace(/\s/g, '');
}

/** Rate in 1/10,000 NZD → editable dollar string, trimmed to needed decimals (min 2). */
export function rateToInput(unitRate: number): string {
  const s = (unitRate / 10_000).toFixed(4);
  return s.replace(/(\.\d\d\d?)0+$/, '$1').replace(/(\.\d\d)0$/, '$1');
}

/** Parse a dollar string with up to 4 decimals into 1/10,000 NZD. Returns null if invalid. */
export function parseRate(input: string): number | null {
  const m = /^\s*(\d{1,6})(?:\.(\d{1,4}))?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 10_000 + Number((m[2] ?? '').padEnd(4, '0'));
}

/** Parse a percentage with up to 2 decimals into basis points (0–100%). */
export function parsePercent(input: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}
