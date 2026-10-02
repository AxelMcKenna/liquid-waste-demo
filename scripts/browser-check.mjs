// Browser acceptance checks. Usage: npm run build && npm run test:browser
// Starts `vite preview`, drives the core walkthrough in Chromium, checks layouts, saves screenshots.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4179;
const BASE = `http://localhost:${PORT}`;
const SHOTS = 'screenshots';
mkdirSync(SHOTS, { recursive: true });

let server;
let browser;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};

const consoleErrors = [];
const watch = (page) => {
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
};

try {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => finish(new Error(`Preview did not start within 15 seconds. ${stderr}`)), 15_000);
    const onData = (data) => { if (String(data).includes(`http://localhost:${PORT}`)) finish(); };
    const onError = (error) => finish(error);
    const onExit = (code) => finish(new Error(`Preview exited (${code}). ${stderr}`));
    function finish(error) {
      clearTimeout(timeout);
      server.stdout.off('data', onData);
      server.off('error', onError);
      server.off('exit', onExit);
      if (error) reject(error); else resolve();
    }
    server.stderr.on('data', (data) => { stderr += String(data); });
    server.stdout.on('data', onData);
    server.once('error', onError);
    server.once('exit', onExit);
  });
  browser = await chromium.launch();

  /* ---------- Desktop walkthrough ---------- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(`${BASE}/dispatch`);
  await page.getByRole('heading', { name: "Today's collections" }).waitFor();
  check('Dispatch summary counts', (await page.locator('.summary-line').innerText()).replace(/\s+/g, ' ').includes('8 jobs · 2 unassigned · 1 blocked'));
  check('Fonts render macrons (Ōtāhuhu/Whangārei)', await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('14px "IBM Plex Sans"', 'Ōtāhuhu Whangārei');
  }));
  await page.screenshot({ path: `${SHOTS}/dispatch-1440.png` });

  // Filters
  await page.getByPlaceholder('Search job, customer or site').fill('Ridge');
  check('Search filters rows', (await page.locator('.jobs-table tbody tr').count()) === 1);
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  check('Clear filters restores eight jobs', await until(async () => (await page.locator('.jobs-table tbody tr').count()) === 8));

  // Incompatible assignment
  await page.getByRole('button', { name: 'Assign J108' }).click();
  await page.getByRole('radio', { name: /T01/ }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Assign', exact: true }).click();
  check('Septic job rejected on grease truck', await page.getByRole('alert').filter({ hasText: 'grease waste only' }).isVisible());
  await page.keyboard.press('Escape');
  check('Escape closes dialog', (await page.getByRole('dialog').count()) === 0);
  check('Focus returns to opener after Escape', await until(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Assign J108')));

  // Keyboard assign J101 → T01
  await page.getByRole('button', { name: 'Assign J101' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  await until(() => page.evaluate(() => document.activeElement?.getAttribute('value') === 'T01')); // first radio is autofocused
  await page.keyboard.press('Space');
  await page.getByRole('dialog').getByRole('button', { name: 'Assign', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const j101Row = page.locator('tr', { hasText: 'J101' });
  check('Keyboard assignment of J101 to T01', (await j101Row.innerText()).includes('Mara Cole'));
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName);
  check('Focus restored after dialog closes', await until(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Open J101')), focused);

  // Driver collection
  await page.goto(`${BASE}/driver?driver=D01`);
  await page.locator('.driver-stop', { hasText: 'Harbour Pantry' }).getByRole('button', { name: 'Open job' }).click();
  await page.getByRole('button', { name: 'Start job' }).click();
  await page.getByLabel('Actual litres collected').waitFor();
  await page.getByRole('button', { name: 'Review collection' }).click();
  check('Empty litres + no photo shows error summary', (await page.getByRole('alert').first().innerText()).includes('Check the highlighted fields'));
  await page.getByLabel('Actual litres collected').fill('-5');
  await page.getByRole('button', { name: 'Review collection' }).click();
  check('Negative litres rejected', await page.locator('.field-error', { hasText: 'Enter a positive whole number of litres.' }).isVisible());

  const fileInput = page.locator('input[type=file]');
  await fileInput.setInputFiles({ name: 'clip.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  check('Invalid image type rejected', await page.getByText('clip.gif is not a JPEG, PNG or WebP image.').isVisible());
  await fileInput.setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 10) });
  check('Oversize image rejected', await page.getByText('huge.png is larger than 5 MB.').isVisible());
  check('Litre input kept after photo errors', (await page.getByLabel('Actual litres collected').inputValue()) === '-5');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await fileInput.setInputFiles({ name: 'trap.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Add built-in sample photo' }).click();
  await page.locator('.photo-item').nth(1).waitFor();
  await page.getByLabel('Actual litres collected').fill('650');
  await page.getByText(/Draft saved on this device at/).waitFor({ timeout: 4000 });
  await page.reload();
  await page.getByLabel('Actual litres collected').waitFor();
  check('Draft litres survive refresh', (await page.getByLabel('Actual litres collected').inputValue()) === '650');
  check('Uploaded photo blob survives refresh', await page.locator('.photo-item img[alt*="trap.png"]').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false));
  await page.screenshot({ path: `${SHOTS}/driver-form-1440.png` });

  await page.getByRole('button', { name: 'Review collection' }).click();
  const confirmBtn = page.getByRole('button', { name: 'Confirm collection' });
  await confirmBtn.dblclick();
  await page.getByText('Collection confirmed. No further driver action.').waitFor();
  await page.reload();
  await page.goto(`${BASE}/dispatch`);
  await page.locator('.run', { hasText: 'T01' }).getByText('1,100 L').waitFor();
  check('L101 totals 1,100 L once after double-click + refresh', true);

  // Office reconciliation
  await page.goto(`${BASE}/office?load=L101`);
  await page.getByRole('button', { name: 'Finish load' }).click();
  await page.getByLabel('Facility', { exact: true }).fill('South Yard Demo Facility');
  await page.getByLabel('Docket reference').fill('SY-DEMO-2301');
  await page.getByLabel('Disposal date').fill('2026-10-02');
  await page.getByLabel('Disposal time (24-hour)').fill('13:40');
  await page.getByLabel('Facility litres').fill('1100');
  await page.getByRole('button', { name: 'Save disposal record' }).click();
  await page.getByRole('button', { name: 'Reconcile load' }).click();
  await page.getByText('Load reconciled.').waitFor();
  await page.getByRole('tab', { name: /Draft invoices/ }).click();
  await page.getByRole('button', { name: 'Create draft for J101' }).dblclick();
  await page.getByRole('heading', { name: /Draft invoice D101/ }).waitFor();
  const totalText = await page.locator('.invoice-totals .grand dd').innerText();
  check('J101 draft totals NZ$296.70', totalText.includes('296.70'), totalText);
  await page.screenshot({ path: `${SHOTS}/office-invoice-1440.png` });
  await page.reload();
  await page.goBack().catch(() => {});
  await page.goto(`${BASE}/office?tab=drafts`);
  const draftRows = await page.locator('.queue-row', { hasText: 'D101' }).count();
  check('Exactly one D101 draft after double-click, refresh, back', draftRows === 1);
  check('D107 remains single', (await page.locator('.queue-row', { hasText: 'D107' }).count()) === 1);

  // Edit illustrative GST
  await page.locator('.queue-row', { hasText: 'D101' }).click();
  await page.getByLabel('Illustrative GST (%)').fill('10');
  await page.getByRole('button', { name: 'Save draft changes' }).click();
  await page.getByText('No unsaved changes.').waitFor();
  await page.reload();
  check('Invoice edits persist and recompute', (await page.locator('.invoice-totals .grand dd').innerText()).includes('283.80'));

  // Unsaved guard
  await page.getByLabel('Illustrative GST (%)').fill('12');
  await page.getByRole('tab', { name: /Needs attention/ }).click();
  check('Unsaved changes prompt on navigation', await until(() => page.getByRole('dialog', { name: 'Discard unsaved changes?' }).isVisible()));
  await page.getByRole('button', { name: 'Discard changes' }).click();

  // L103 discrepancy
  await page.goto(`${BASE}/office?load=L103`);
  const totals = await page.locator('.totals').innerText();
  check('L103 shows 2,300 L vs 2,200 L', totals.includes('2,300 L') && totals.includes('2,200 L') && totals.includes('100 L'));
  check('L103 reconcile blocked until discrepancy resolved', await page.getByRole('button', { name: 'Reconcile load' }).isDisabled());
  await page.screenshot({ path: `${SHOTS}/office-discrepancy-1440.png` });
  await page.goto(`${BASE}/dispatch?job=J106`);
  check('Blocked visit shows no litres and is not billable', (await page.getByRole('dialog').innerText()).includes('Visit blocked: nothing was collected'));
  await page.keyboard.press('Escape');
  check('Escape closes job drawer and clears URL', !page.url().includes('job='));

  // Reset: cancel then confirm
  await page.getByRole('button', { name: 'Demo controls' }).first().click();
  await page.getByRole('button', { name: 'Reset demo…' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.keyboard.press('Escape');
  check('Cancelling reset changes nothing', (await page.locator('tr', { hasText: 'J101' }).innerText()).includes('Collected'));
  await page.getByRole('button', { name: 'Demo controls' }).first().click();
  await page.getByRole('button', { name: 'Reset demo…' }).click();
  await page.getByRole('button', { name: 'Reset demo data' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  check('Reset restores fixtures', (await page.locator('tr', { hasText: 'J101' }).innerText()).includes('Unassigned'));
  await ctx.close();

  /* ---------- Responsive layouts ---------- */
  const sizes = [[1440, 900], [1024, 768], [390, 844], [360, 740]];
  const routes = ['/dispatch', '/dispatch?job=J105', '/driver?driver=D01', '/office?load=L103', '/office?tab=drafts&invoice=D107'];
  for (const [w, h] of sizes) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const p = await c.newPage();
    watch(p);
    for (const r of routes) {
      await p.goto(`${BASE}${r}`);
      await p.locator('.page').waitFor();
      await p.waitForTimeout(250);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`No page overflow at ${w}×${h} ${r}`, overflow <= 0, overflow > 0 ? `${overflow}px` : '');
      const clipped = await p.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll('button, a, input, select')) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || el.closest('.sr-only')) continue;
          if (b.right > window.innerWidth + 1 || b.left < -1) bad.push(el.textContent?.trim() || el.getAttribute('aria-label') || el.tagName);
        }
        return bad;
      });
      check(`No clipped controls at ${w}×${h} ${r}`, clipped.length === 0, clipped.join(', '));
      if (w <= 390) {
        const small = await p.evaluate(() => [...document.querySelectorAll('.drawer button, .page button, .bottom-nav a')]
          .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && !el.classList.contains('link-btn') && (b.height < 44 || b.width < 44); })
          .map((el) => el.textContent?.trim() || el.getAttribute('aria-label')));
        check(`Touch targets ≥44px at ${w} ${r}`, small.length === 0, small.join(', '));
      }
      const name = r.replace(/[/?=&]+/g, '-').replace(/^-/, '');
      if (w !== 360) await p.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: r === '/driver?driver=D01' });
    }
    if (w === 1024) {
      await p.goto(`${BASE}/dispatch`);
      await p.getByRole('button', { name: 'Truck runs' }).click();
      check('Truck runs drawer opens at 1024', await p.getByRole('dialog', { name: 'Truck runs' }).isVisible());
      await p.getByRole('button', { name: /T03/ }).click();
      await p.waitForTimeout(300);
      await p.screenshot({ path: `${SHOTS}/dispatch-runs-drawer-1024.png` });
    }
    await c.close();
  }

  /* ---------- Mobile driver flow at 390 ---------- */
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mp = await m.newPage();
  watch(mp);
  await mp.goto(`${BASE}/dispatch`);
  await mp.getByRole('button', { name: 'Assign J101' }).click();
  await mp.getByRole('radio', { name: /T01/ }).check();
  await mp.getByRole('dialog').getByRole('button', { name: 'Assign', exact: true }).click();
  await mp.getByRole('dialog').waitFor({ state: 'detached' });
  await mp.goto(`${BASE}/driver?driver=D01&job=J101`);
  await mp.getByRole('button', { name: 'Start job' }).tap();
  await mp.getByLabel('Actual litres collected').fill('650');
  await mp.getByRole('button', { name: 'Add built-in sample photo' }).tap();
  await mp.locator('.photo-item').first().waitFor();
  await mp.screenshot({ path: `${SHOTS}/driver-form-390.png` });
  await mp.getByRole('button', { name: 'Review collection' }).tap();
  await mp.getByRole('button', { name: 'Confirm collection' }).waitFor();
  await mp.screenshot({ path: `${SHOTS}/driver-review-390.png` });
  await mp.getByRole('button', { name: 'Confirm collection' }).tap();
  await mp.getByText('Collection confirmed. No further driver action.').waitFor();
  check('Mobile driver flow completes at 390', true);
  await m.close();

  /* ---------- Reduced motion ---------- */
  const rm = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const rp = await rm.newPage();
  await rp.goto(`${BASE}/dispatch?job=J102`);
  const dur = await rp.locator('.drawer').evaluate((el) => getComputedStyle(el).animationDuration);
  check('Reduced motion disables drawer animation', parseFloat(dur) < 0.05, dur);
  await rm.close();
} catch (e) {
  check('Script completed without exception', false, e.message.split('\n')[0]);
} finally {
  check('No uncaught console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  await browser?.close().catch((error) => check('Browser cleanup', false, error.message));
  server?.kill();
  const failed = results.filter((r) => !r.ok);
  writeFileSync(`${SHOTS}/browser-results.json`, JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
