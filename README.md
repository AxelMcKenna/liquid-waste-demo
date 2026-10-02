# Liquid Waste Demo

A working browser prototype for a **fictional** independent NZ liquid-waste operator. It covers one workflow end to end: dispatch a collection, record it on a driver's phone, reconcile the truck load against a disposal record, and review a draft invoice.

Everything runs locally in the browser. There is no backend, login, accounting integration, live GPS or real sync. Data is saved in this browser's IndexedDB (database `liquid-waste-demo`) and nowhere else.

## Run it

```bash
npm ci
npm run dev          # http://localhost:5173
npm test             # domain, persistence and component regression tests
npm run build        # typecheck + production build
npm run test:browser # needs a prior build; drives Chromium via Playwright and saves screenshots/
```

Use Node 22.22.2+ on the 22 LTS line, Node 24.15.0+ on the 24 LTS line, or Node 26+. The test dependencies require these versions. The browser checks use Playwright's bundled Chromium (`npx playwright install chromium` if it's missing).

## Stack

React 19, TypeScript, Vite, React Router (data router, for URL state and unsaved-change blocking), Lucide icons, `idb`. Fonts are IBM Plex Sans/Mono, self-hosted via `@fontsource`. The SIL Open Font License is in `public/IBM-Plex-OFL.txt`. The fallbacks are Arial and monospace.

| Path | What it holds |
|---|---|
| `src/domain/types.ts` | Typed entities: Customer, Site, Job, Driver, Truck, Load, DisposalRecord, InvoiceDraft, ActivityEvent |
| `src/domain/fixtures.ts` | The single seed fixture (8 jobs on Fri 2 Oct 2026) |
| `src/domain/logic.ts` | Selectors (derived totals and statuses), validation and every state-changing command as a pure function |
| `src/domain/pricing.ts` | Illustrative pricing in integer units with deterministic rounding |
| `src/store/` | Each command reads the latest state and commits state, photo blobs and its mutation ID in one IndexedDB transaction, including across tabs |
| `src/views/` | Shell, Dispatch, Driver, Office, job drawer |
| `src/styles.css` | Design tokens and all styles |

## Fixture and workflow assumptions

- **Demo date** is fixed at Fri 2 Oct 2026. New activity timestamps use that date plus the real Auckland time of day (NZDT, +13:00).
- **Loads** carry one waste type. Each job contributes to at most one load. Only a truck's `collecting` load counts toward capacity. Historical L104 is excluded. The truck-run meter also displays an awaiting-disposal load's collected litres until reconciliation, so a pending load is not shown as an empty truck.
- **Assignment capacity** is the open load's actual litres plus the estimates of the truck's assigned and in-progress jobs.
- **Collection capacity** checks actual litres against capacity minus the open load's total.
- **Starting a job** needs an open (`collecting`) load. T03 starts without one because L103 is awaiting disposal. Office (or the Dispatch truck rail) can start a **New load** once L103 is reconciled.
- **Billing status** is derived: `not_ready` (not collected, or blocked), `review_required` (collected, but disposal is unreconciled, additional work is pending or evidence is missing), `ready`, or `draft`.
- **Discrepancies**: the driver total and the facility total are stored separately. The office either corrects the entry or accepts the difference with a reason, which is logged permanently. Collected litres are never rewritten. Changing the facility figure voids an earlier acceptance.
- **Idempotency**: commands carry mutation keys checked against the latest persisted state, buttons ignore clicks while a write is pending, and `invoiceByJob` enforces one draft per job inside the transaction.
- **Same-browser tabs**: overlapping writes are serialized by IndexedDB and domain rules are checked against the latest data. Unrelated changes are preserved. This is not live multi-user sync: reload a passive tab to see another tab's edits; simultaneous edits to the same form still use the last successful save.
- **Draft safety**: collection edits autosave after 700 ms. Review, closing the drawer and in-app navigation wait for the latest draft to save. A failed save keeps the entries open for retry; refresh/closing the browser warns while unsaved.
- **Reset safety**: fixtures replace stored state and uploaded photos are removed in one transaction. A failure rolls back the whole reset.
- **Sample photos** are bundled SVG illustrations labelled "Sample". Uploaded files are validated: JPEG/PNG/WebP, 5 MB or less, 1–3 photos. They're stored as blobs in IndexedDB.
- Disposal time is entered as 24-hour `HH:MM` text so the browser locale can't switch it to am/pm.

### Illustrative pricing (demo only, excludes the illustrative tax)

| Item | Rate |
|---|---|
| Grease collection | NZ$180 base + NZ$0.12/L |
| Septic pump-out | NZ$240 base + NZ$0.10/L |
| Approved additional work | NZ$90/hour, rounded up to 15-minute increments |
| Illustrative GST | 15% by default, editable |

Rates are stored in 1/10,000 NZD and amounts in integer cents, rounded half up. J101 at 650 L comes to NZ$258.00 + NZ$38.70 = **NZ$296.70**. This is not a tax engine or an accounting ledger.

## Three-minute walkthrough

1. **Dispatch** (`/dispatch`): the summary reads "8 jobs · 2 unassigned · 1 blocked". Click **Assign** on J101 Harbour Pantry, choose **T01 · Mara Cole** and assign. (Try J108 on T01 first: it's refused because loads can't mix waste types.) Expand T01 in *Truck runs* to see the manual stop order.
2. **Driver** (`/driver`): pick *Mara Cole · T01*, open Harbour Pantry and tap **Start job**. Enter `650`, then **Add built-in sample photo** (or choose a real image). Refresh the page: the draft and photo are still there. Tap **Review collection**, then **Confirm collection**. T01's load L101 now shows 1,100 L.
3. **Office** (`/office`): under *Missing disposal record*, open L101, click **Finish load**, enter South Yard Demo Facility, any docket, 2 Oct 2026, 13:40 and 1100 L, save, then **Reconcile load**.
4. **Draft invoices**: click **Create draft** for J101. The sheet shows NZ$296.70 and "Draft · Not sent". Edit the GST rate to see the totals recompute.
5. Back in **Needs attention**, open L103. It shows 2,300 L collected against 2,200 L disposed, and *Reconcile load* stays disabled until you correct the entry or accept the difference with a reason. Open the Parkside Eatery additional-work row and approve or decline it with a note.
6. **Demo controls** (rail bottom or phone header) → **Reset demo…** → confirm. This restores the fixtures and clears this demo's storage only.

## Readiness verification (2 Oct 2026)

**Current branch: `npm test`, 44/44 passed. `npm run build` (TypeScript + production build), passed on Node 24.19.0.** The original 21 domain/persistence checks remain, plus regressions covering:

- HTTP preview readiness with coloured/chunked logs, startup errors, non-success responses and timeouts
- URL-driven search and clearing filters after asynchronous navigation
- truck run cards retaining collected litres for loads awaiting disposal, then clearing after reconciliation
- separate store instances writing concurrently to one database without losing unrelated changes
- cross-tab idempotency, stale command validation and asynchronous incompatible-truck errors
- collection photo evidence removed by another tab
- failed atomic writes/reset preserving stored state and photo blobs
- reset serialized with immediately following commands
- rapid review/close, direct close and browser-style Back before autosave fires
- failed draft saves retaining entries for retry
- typing during a slow save, including closing with a newer edit in flight
- hard-refresh warning and idle autosave
- normalized invoice rate/tax/description saves clearing the unsaved flag
- failed invoice saves and newer typing during an earlier save

Component regressions use jsdom, not a real rendering engine. Local socket restrictions prevent a Chromium run in the editing environment. GitHub Actions runs clean install, tests, build and all 87 Chromium acceptance checks on pushes and pull requests, without secrets or deployment. Check the current commit’s CI result before calling it browser-verified.

### Historical baseline browser report (original prototype, before these fixes)

**Original report: `npm run test:browser`, 82/82 passed** (Chromium, production build, repeated 4× with no flakes). It covers:
- counts, search and clearing filters
- keyboard assignment, Escape, and focus returning to the opener
- incompatible-truck errors
- empty, negative, wrong-type and oversize inputs keeping the form state
- the draft and uploaded blob surviving a refresh
- a double-clicked confirm adding volume once (L101 = 1,100 L)
- reconcile → draft = NZ$296.70
- a double-clicked draft, refresh and back leaving one D101
- D107 staying single
- invoice edits persisting
- the unsaved-changes prompt
- the L103 2,300/2,200 L block
- the blocked job not being billable
- reset cancel and confirm
- no page overflow or clipped controls on 5 routes at 1440×900, 1024×768, 390×844 and 360×740
- touch targets of at least 44px at phone widths
- the tablet truck-runs drawer
- the full mobile driver flow with touch at 390px
- reduced motion
- Plex rendering of Ōtāhuhu and Whangārei
- no console errors

Screenshots go to `screenshots/`.

**Contrast**: computed for every token pair in use. Text pairs range from 5.2:1 to 13.5:1. Control borders are 3.66:1 and focus rings at least 9:1.

**Not tested or mocked**:
- No screen-reader pass (VoiceOver/NVDA). Labels, roles and live regions were set by hand but not audited with assistive tech.
- No Safari or Firefox run.
- Save failures are covered by injected-adapter domain/component tests and IndexedDB transaction-abort regressions. There's no in-app failure simulator.
- Storage quota limits haven't been tested.
- "Saved on this device" means IndexedDB in this browser profile only.
- Optional P2 items are not built: no-signal simulation and the schematic map.

This is a fictional demo. It isn't production-ready, multi-user, compliant, synced or validated with customers.
