/**
 * Invoice review header integrity check (Playwright, desktop): missing supplier / invoice number /
 * date stay empty and are marked "Not detected", confirmation asks about them, invalid dates are
 * rejected, manual entry is saved exactly, real invoice numbers are protected against duplicates and
 * invoices without a number are never flagged as duplicates.
 *
 * The test invoice has a loose-weight line (Toor Dal Loose 2.5 kg, extracted as "Dal Loose"). Phase 4: kg accepts fractions, so the line
 * stays selected and is confirmed as 2.5 kg (never rounded); the header checks are unchanged.
 *
 * Run through the isolated test launcher (test backend, test database, dedicated ports):
 *   node scripts/e2e/run.cjs invoice_metadata_check
 */
const { enterSellingPrices } = require('./scanner_helpers.cjs');
const { chromium } = require('playwright');
const SP = process.argv[2];
const { API, HARNESS } = require('./e2e_env.cjs').e2eTarget();
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
(async () => {
  const H = { 'Content-Type': 'application/json' };
  const email = `meta-ui-${Date.now()}@example.com`;
  await fetch(`${API}/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'password123' }) });
  const { access_token: tok } = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'password123' }) }).then((r) => r.json());
  await fetch(`${API}/shops`, { method: 'POST', headers: { ...H, Authorization: `Bearer ${tok}` }, body: JSON.stringify({ shop_name: 'K', owner_name: 'R', business_type: 'Grocery/Kirana', location: 'B' }) });
  const purchases = async () => (await fetch(`${API}/purchases`, { headers: { Authorization: `Bearer ${tok}` } }).then((r) => r.json())).items;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 })).newPage();
  let confirmCalls = 0;
  let blockedLines = 0;
  const looseSent = [];
  page.on('request', (r) => {
    if (!r.url().includes('/invoices/confirm')) return;
    confirmCalls++;
    const loose = (JSON.parse(r.postData() || '{}').items || []).find((i) => /dal loose/i.test(i.name));
    looseSent.push(loose ? `${loose.quantity} ${loose.unit}` : 'missing');
  });
  await page.addInitScript((t) => localStorage.setItem('shoppulse_token', t), tok);  // token present before any page script (no 401 race)
  async function extract(file) {
    await page.goto(HARNESS);
    await page.click('[role=tab]:has-text("Upload PDF or file")');
    await page.setInputFiles('input[type=file]:not([multiple]):not([capture])', file);
    await page.click('button:has-text("Extract Line Items")');
    await page.waitForSelector('text=Extracted Grocery Line Items', { timeout: 120000 });
    await enterSellingPrices(page);  // the reviewer's step: no selling price is invented
    // Every printed unit is registered and the 2.5 kg line suits its unit: nothing needs correcting
    blockedLines += (await page.locator('[data-testid="unit-warning"]').count()) + (await page.locator('text=Whole units only').count());
  }
  const val = (label) => page.locator(`input[aria-label="${label}"]`).inputValue();

  // A. header details missing on the invoice
  await extract(`${SP}/hdr_none.png`);
  const [s0, n0, d0] = [await val('Supplier'), await val('Invoice number'), await val('Invoice date')];
  check('missing details shown as empty fields (nothing invented)', !s0 && !n0 && !d0, JSON.stringify([s0, n0, d0]));
  check('"Not detected – enter manually" shown 3x', (await page.locator('text=Not detected – enter manually').count()) === 3);
  check('products remain reviewable while details are missing', (await page.locator('tbody tr').count()) >= 5);
  await page.screenshot({ path: `${SP}/meta_1_missing.png` });
  await page.click('button:has-text("Items to Inventory")');
  await page.waitForTimeout(500);
  check('confirm asks about missing details first (no save yet)', (await page.locator('text=Without an invoice number this invoice cannot be checked for duplicates').count()) === 1 && confirmCalls === 0);
  await page.screenshot({ path: `${SP}/meta_2_prompt.png` });
  await page.fill('input[aria-label="Invoice date"]', '31/02/2026');
  check('invalid date shows a validation message', (await page.locator('text=Not a valid date. Use DD/MM/YYYY').count()) >= 1);
  await page.click('button:has-text("Items to Inventory")');
  await page.waitForTimeout(500);
  check('invalid date blocks saving', confirmCalls === 0 && (await page.locator('text=Invoice date: Not a valid date').count()) === 1);
  await page.fill('input[aria-label="Supplier"]', 'Balaji Traders');
  await page.fill('input[aria-label="Invoice number"]', 'BT-500');
  await page.fill('input[aria-label="Invoice date"]', '08/10/2026');
  await page.click('button:has-text("Items to Inventory")');
  await page.waitForSelector('text=Successfully confirmed', { timeout: 60000 });
  const p1 = (await purchases()).find((p) => p.invoice_number === 'BT-500');
  check('manually entered details saved exactly', p1 && p1.invoice_date === '08/10/2026' && p1.supplier_name === 'Balaji Traders', JSON.stringify(p1 && [p1.supplier_name, p1.invoice_number, p1.invoice_date]));

  // B. same invoice again: duplicate blocked
  await extract(`${SP}/hdr_none.png`);
  await page.fill('input[aria-label="Supplier"]', 'Balaji Traders');
  await page.fill('input[aria-label="Invoice number"]', 'bt-500');
  await page.fill('input[aria-label="Invoice date"]', '08/10/2026');
  await page.click('button:has-text("Items to Inventory")');
  await page.waitForSelector('text=already added to stock', { timeout: 60000 });
  check('duplicate with a real invoice number is blocked', (await purchases()).length === 1);

  // C. no invoice number twice: both saved, no false duplicate
  for (let i = 0; i < 2; i++) {
    await extract(`${SP}/hdr_none.png`);
    await page.click('button:has-text("Items to Inventory")');
    await page.click('button:has-text("Add to stock without them")');
    await page.waitForSelector('text=Successfully confirmed', { timeout: 60000 });
  }
  const all = await purchases();
  check('missing invoice numbers never flagged as duplicates', all.length === 3 && all.filter((p) => !p.invoice_number && !p.invoice_date && !p.supplier_name).length === 2);

  // D. header details printed on the invoice
  await extract(`${SP}/hdr_full.png`);
  const [s1, n1, d1] = [await val('Supplier'), await val('Invoice number'), await val('Invoice date')];
  check('extracted details shown normally', s1 === 'SRI LAKSHMI WHOLESALE TRADERS' && n1 === 'INV-00427' && d1 === '08/10/2026', JSON.stringify([s1, n1, d1]));
  check('no "Not detected" hint for extracted details', (await page.locator('text=Not detected – enter manually').count()) === 0);
  await page.screenshot({ path: `${SP}/meta_3_detected.png` });
  check('no unit or quantity corrections needed on the printed invoice', blockedLines === 0, `${blockedLines}`);
  check('loose-weight line confirmed as 2.5 kg every time (never rounded)', looseSent.length >= 4 && looseSent.every((q) => /^2\.5 kg$/i.test(q)), JSON.stringify(looseSent));
  const toor = (await fetch(`${API}/products?limit=100`, { headers: { Authorization: `Bearer ${tok}` } }).then((r) => r.json())).items.filter((p) => /dal loose/i.test(p.name));
  check('loose-weight stock is 3 x 2.5 = 7.5 kg (the duplicate added nothing)', toor.length === 1 && toor[0].current_stock === 7.5, JSON.stringify(toor.map((p) => [p.name, p.current_stock, p.unit])));
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
