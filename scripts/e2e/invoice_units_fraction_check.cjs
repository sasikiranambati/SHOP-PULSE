/**
 * Browser check (Phase 4 finalisation): invoice review units and fractional quantities.
 *
 * - a missing unit is flagged for review, never defaulted to pcs; an unregistered unit likewise;
 * - the unit is chosen from the canonical registry (select), keeping quantity, rate and amount;
 * - confirmation is blocked (no request, no stock) while a unit is missing or invalid;
 * - 2.5 kg and 750 ml are accepted and editable (2.5 -> 2.75 kg);
 * - a package (packet) stays whole-number: 2.5 is blocked until corrected, never rounded;
 * - after correction the request carries the exact values and stock is updated exactly.
 * Runs at desktop width and on an emulated Pixel 7.
 *
 * The extraction response is fixed (page.route); confirmation goes to the real test backend.
 * Generic test values only.
 *
 * Run through the isolated test launcher (test backend, test database, dedicated ports):
 *   node scripts/e2e/run.cjs invoice_units_fraction_check
 */
const { enterSellingPrices } = require('./scanner_helpers.cjs');
const { chromium, devices } = require('playwright');
const fs = require('fs');
const SP = process.argv[2] || '.';
const { API, HARNESS } = require('./e2e_env.cjs').e2eTarget();
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const line = (id, name, quantity, unit, rate, amount, extra = {}) => ({
  id, product_name: name, quantity, unit, purchase_price: rate, rate, amount, line_total: amount, confidence: 95,
  confidence_level: 'HIGH', needs_review: false, validation_issues: [], suggestions: [], derived_fields: [], ...extra,
});

const extraction = (label) => ({
  id: `inv_e2e_units_${label}`, supplier_name: 'Generic Wholesale Traders', invoice_number: `UNITS-${Date.now()}-${label}`,
  invoice_date: '05/11/2026', total_amount: 1510.0, total_items: 6, confidence_score: 90,
  status: 'needs_review', printed_total: null, total_reconciliation: null, bundle_notes: [],
  items: [
    line('dal', `E2E Toor Dal ${label}`, 2.5, 'kg', 132.0, 330.0, { selling_price: 150.0 }),
    line('oil', `E2E Coconut Oil ${label}`, 750, 'ml', 0.24, 180.0, { selling_price: 0.3 }),
    line('rice', `E2E Basmati Rice ${label}`, 2, '', 90.0, 180.0, {
      selling_price: 100.0, needs_review: true,
      validation_issues: ['Unit not printed or not read: enter the unit before adding to stock.'],
    }),
    line('tea', `E2E Tea Leaf ${label}`, 4, 'unit', 50.0, 200.0, {
      selling_price: 60.0, needs_review: true,
      validation_issues: ["Unit 'unit' is not a registered unit: correct it before adding to stock."],
    }),
    line('soap', `E2E Soap Pack ${label}`, 2.5, 'packet', 76.0, 190.0, { selling_price: 85.0 }),
    line('salt', `E2E Salt ${label}`, 20, 'pcs', 22.0, 440.0, { selling_price: 25.0 }),
  ],
});

(async () => {
  fs.mkdirSync(SP, { recursive: true });
  const H = { 'Content-Type': 'application/json' };
  const email = `units-ui-${Date.now()}@example.com`;
  await fetch(`${API}/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'password123' }) });
  const { access_token: tok } = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'password123' }) }).then((r) => r.json());
  await fetch(`${API}/shops`, { method: 'POST', headers: { ...H, Authorization: `Bearer ${tok}` }, body: JSON.stringify({ shop_name: 'K', owner_name: 'R', business_type: 'Grocery/Kirana', location: 'B' }) });
  const auth = { Authorization: `Bearer ${tok}` };
  const products = async () => (await fetch(`${API}/products?limit=100`, { headers: auth }).then((r) => r.json())).items;

  const browser = await chromium.launch();
  for (const [label, ctxOpts] of [['desktop', { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 }], ['phone', { ...devices['Pixel 7'] }]]) {
    const page = await (await browser.newContext(ctxOpts)).newPage();
    const confirmBodies = [];
    page.on('request', (r) => { if (r.url().includes('/invoices/confirm')) confirmBodies.push(JSON.parse(r.postData() || '{}')); });
    await page.route('**/api/v1/invoices/extract', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(extraction(label)) }));
    await page.addInitScript((t) => localStorage.setItem('shoppulse_token', t), tok);  // token present before any page script (no 401 race)
    await page.goto(HARNESS);
    await page.click('[role=tab]:has-text("Upload PDF or file")');
    await page.setInputFiles('input[type=file]:not([multiple]):not([capture])', { name: 'bill.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') });
    await page.click('button:has-text("Extract Line Items")');
    await page.waitForSelector('text=Extracted Grocery Line Items', { timeout: 60000 });
    await enterSellingPrices(page);  // the reviewer's step: no selling price is invented
    await page.waitForSelector(`select[aria-label="Unit for E2E Salt ${label}"]:not([disabled])`, { timeout: 30000 });

    const row = (name) => page.locator(`tr:has(input[aria-label="Select E2E ${name} ${label}"])`);
    const qty = (name) => page.locator(`input[aria-label="Quantity for E2E ${name} ${label}"]`);
    const unitSel = (name) => page.locator(`select[aria-label="Unit for E2E ${name} ${label}"]`);
    const unitBlock = page.locator('[data-testid="unit-block"]');
    const fracBlock = page.locator('[data-testid="fractional-quantity-block"]');

    // 1. missing and unregistered units: flagged, never defaulted
    const riceWarn = row('Basmati Rice').locator('[data-testid="unit-warning"]');
    check(`${label}: missing unit shows a warning and needs review`, (await riceWarn.count()) === 1
      && /Needs review: Unit missing/.test(await riceWarn.innerText()), (await riceWarn.count()) ? await riceWarn.innerText() : '');
    check(`${label}: missing unit is not defaulted (no unit selected)`, (await unitSel('Basmati Rice').inputValue()) === ''
      && (await unitSel('Basmati Rice').getAttribute('aria-invalid')) === 'true');
    const teaWarn = row('Tea Leaf').locator('[data-testid="unit-warning"]');
    check(`${label}: unregistered unit flagged`, (await teaWarn.count()) === 1 && /'unit' is not a registered unit/.test(await teaWarn.innerText()));
    check(`${label}: valid printed units kept`, (await unitSel('Toor Dal').inputValue()) === 'kg' && (await unitSel('Coconut Oil').inputValue()) === 'ml'
      && (await unitSel('Soap Pack').inputValue()) === 'packet' && (await unitSel('Salt').inputValue()) === 'pcs'
      && (await page.locator('[data-testid="unit-warning"]').count()) === 2);
    const opts = await unitSel('Salt').locator('option').allTextContents();
    check(`${label}: unit choices come from the registry`, opts.length === 27 && ['kg', 'g', 'L', 'ml', 'pcs', 'dozen', 'packet'].every((u) => opts.includes(u)), `${opts.length} options`);

    // 2. fractional quantities: kg / ml accepted, packet whole-number
    check(`${label}: 2.5 kg and 750 ml shown as extracted, fraction steps`, (await qty('Toor Dal').inputValue()) === '2.5' && (await qty('Toor Dal').getAttribute('step')) === '0.001'
      && (await qty('Coconut Oil').inputValue()) === '750' && (await qty('Coconut Oil').getAttribute('step')) === '0.001'
      && (await row('Toor Dal').locator('text=Whole units only').count()) === 0);
    check(`${label}: package line 2.5 packet marked whole units only`, (await qty('Soap Pack').getAttribute('step')) === '1'
      && (await row('Soap Pack').locator('text=Whole units only').count()) === 1);

    // 3. confirmation blocked
    await page.click('button:has-text("Items to Inventory")');
    await page.waitForTimeout(500);
    const ub = (await unitBlock.count()) ? await unitBlock.innerText() : '';
    const fb = (await fracBlock.count()) ? await fracBlock.innerText() : '';
    check(`${label}: confirmation blocked for missing / invalid units`, /Nothing has been added to stock/.test(ub)
      && ub.includes(`E2E Basmati Rice ${label} (unit missing)`) && ub.includes(`E2E Tea Leaf ${label} ('unit' is not a registered unit)`), ub.slice(0, 200));
    check(`${label}: package fraction blocked, kg / ml lines not blocked`, fb.includes(`E2E Soap Pack ${label} (2.5 packet): packet is counted in whole numbers`)
      && !fb.includes('Toor Dal') && !fb.includes('Coconut Oil'), fb.slice(0, 200));
    check(`${label}: no request sent and no stock posted while blocked`, confirmBodies.length === 0 && !(await products()).some((p) => p.name.endsWith(label)));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label}: no horizontal page overflow`, overflow <= 1, `overflow ${overflow}px`);
    await unitBlock.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SP}/units_blocked_${label}.png`, fullPage: false });

    // 4. select units; other values are kept
    await unitSel('Basmati Rice').selectOption('kg');
    check(`${label}: unit selected; quantity, rate and amount kept`, (await qty('Basmati Rice').inputValue()) === '2'
      && (await row('Basmati Rice').locator('[data-testid="unit-warning"]').count()) === 0
      && (await row('Basmati Rice').locator('input[type=number][step="0.001"]').nth(1).inputValue()) === '90'
      && (await unitBlock.count()) === 1);
    await unitSel('Tea Leaf').selectOption('box');
    check(`${label}: block clears once every unit is valid`, (await unitBlock.count()) === 0 && (await page.locator('[data-testid="unit-warning"]').count()) === 0);

    // 5. fractional editing and the package correction
    await qty('Toor Dal').fill('2.75');
    check(`${label}: fractional edit 2.5 -> 2.75 kg accepted`, (await qty('Toor Dal').inputValue()) === '2.75'
      && (await row('Toor Dal').locator('text=Whole units only').count()) === 0 && (await row('Toor Dal').locator('[data-testid="extracted-quantity"]').innerText()).includes('Read as 2.5 kg'));
    await qty('Soap Pack').fill('2.25');
    check(`${label}: another fraction in packets is still refused`, (await row('Soap Pack').locator('text=Whole units only').count()) === 1 && (await fracBlock.count()) === 1);
    await qty('Soap Pack').fill('3');
    check(`${label}: package corrected to a whole number clears the block`, (await fracBlock.count()) === 0);
    await page.screenshot({ path: `${SP}/units_corrected_${label}.png`, fullPage: false });

    // 6. confirm
    await page.click('button:has-text("Items to Inventory")');
    await page.waitForSelector('text=Successfully confirmed', { timeout: 60000 });
    const sent = Object.fromEntries((confirmBodies[0]?.items || []).map((i) => [i.name.replace(` ${label}`, '').replace('E2E ', ''), [i.quantity, i.unit]]));
    const expected = { 'Toor Dal': [2.75, 'kg'], 'Coconut Oil': [750, 'ml'], 'Basmati Rice': [2, 'kg'], 'Tea Leaf': [4, 'box'], 'Soap Pack': [3, 'packet'], Salt: [20, 'pcs'] };
    check(`${label}: one request with exact quantities and selected units (no truncation)`, confirmBodies.length === 1
      && JSON.stringify(sent) === JSON.stringify(expected), JSON.stringify(sent));
    const mine = Object.fromEntries((await products()).filter((p) => p.name.endsWith(label)).map((p) => [p.name.replace(` ${label}`, '').replace('E2E ', ''), [p.current_stock, p.unit]]));
    check(`${label}: stock updated exactly (2.75 kg, 750 ml, whole packets)`, JSON.stringify(Object.keys(expected).map((k) => mine[k])) === JSON.stringify(Object.values(expected)), JSON.stringify(mine));
    await page.close();
  }
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
