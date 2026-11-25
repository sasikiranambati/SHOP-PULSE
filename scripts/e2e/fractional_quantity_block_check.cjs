/**
 * Browser check (P0, updated for Phase 4): a fractional quantity in a whole-number unit (2.5 box) is
 * never rounded into stock. kg, g, L and ml accept fractions (checked in invoice_units_fraction_check);
 * boxes, packets, pcs, dozen, quintal and tonne do not. Confirmation is blocked with an explanation, the
 * extracted quantity stays visible for correction, nothing is posted until the line is corrected (desktop)
 * or deselected (phone), and whole-number lines are posted as before. Desktop width and an emulated Pixel 7.
 *
 * The extraction response is fixed (page.route); confirmation goes to the real backend. Generic test values.
 *
 * Run through the isolated test launcher (test backend, test database, dedicated ports):
 *   node scripts/e2e/run.cjs fractional_quantity_block_check
 */
const { enterSellingPrices } = require('./scanner_helpers.cjs');
const { chromium, devices } = require('playwright');
const fs = require('fs');
const SP = process.argv[2] || '.';
const { API, HARNESS } = require('./e2e_env.cjs').e2eTarget();
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const extraction = (label) => ({
  id: `inv_e2e_frac_${label}`, supplier_name: 'Generic Wholesale Traders', invoice_number: `FRAC-${Date.now()}-${label}`,
  invoice_date: '05/11/2026', total_amount: 550.0, total_units: 22.5, total_items: 2, confidence_score: 90,
  status: 'needs_review', printed_total: null, total_reconciliation: null, bundle_notes: [],
  items: [
    { id: 'salt', product_name: `E2E Salt 1KG ${label}`, quantity: 20, unit: 'pcs', purchase_price: 22.0, rate: 22.0,
      amount: 440.0, line_total: 440.0, confidence: 95, confidence_level: 'HIGH', needs_review: false,
      validation_issues: [], suggestions: [], derived_fields: [], selling_price: 25.0 },
    { id: 'giftbox', product_name: `E2E Gift Box ${label}`, quantity: 2.5, unit: 'box', purchase_price: 44.0, rate: 44.0,
      amount: 110.0, line_total: 110.0, confidence: 95, confidence_level: 'HIGH', needs_review: false,
      validation_issues: [], suggestions: [], derived_fields: [], selling_price: 50.0 },
  ],
});

(async () => {
  fs.mkdirSync(SP, { recursive: true });
  const H = { 'Content-Type': 'application/json' };
  const email = `frac-ui-${Date.now()}@example.com`;
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
    await page.waitForSelector('select[data-testid="unit-select"]:not([disabled])', { timeout: 30000 });  // unit registry loaded

    const sugarRow = page.locator(`tr:has(input[aria-label="Select E2E Gift Box ${label}"])`);
    const sugarQty = sugarRow.locator('input[type=number][step="1"]');  // box: whole numbers only
    check(`${label}: extracted 2.5 kept in the field (not rounded)`, (await sugarQty.inputValue()) === '2.5');
    check(`${label}: line marked "Whole units only"`, (await sugarRow.locator('text=Whole units only').count()) === 1);

    await page.click('button:has-text("Items to Inventory")');
    await page.waitForTimeout(500);
    const block = page.locator('[data-testid="fractional-quantity-block"]');
    const blockText = (await block.count()) ? await block.innerText() : '';
    check(`${label}: confirmation blocked with an explanation`, /allowed only for kg, g, L, ml/.test(blockText) && /Nothing has been added to stock/.test(blockText)
      && blockText.includes(`E2E Gift Box ${label} (2.5 box): box is counted in whole numbers`), blockText.slice(0, 160));
    check(`${label}: no request sent, no bypass button`, confirmBodies.length === 0 && (await block.locator('button').count()) === 0
      && (await page.locator('[data-testid="free-units-confirm"]').count()) === 0);
    check(`${label}: no stock posted while blocked`, !(await products()).some((p) => p.name.endsWith(label)));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label}: no horizontal page overflow`, overflow <= 1, `overflow ${overflow}px`);
    await block.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SP}/fractional_${label}.png`, fullPage: false });

    if (label === 'desktop') {
      // Correct it to whole boxes (the unit is already registered)
      await sugarQty.fill('5');
      check('desktop: banner clears once corrected; extracted reading still shown', (await block.count()) === 0
        && (await sugarRow.locator('[data-testid="extracted-quantity"]').innerText()).includes('Read as 2.5'));
    } else {
      await page.click(`input[aria-label="Select E2E Gift Box ${label}"]`);
      check('phone: banner clears once the line is deselected', (await block.count()) === 0);
    }
    await page.click('button:has-text("Items to Inventory")');
    await page.waitForSelector('text=Successfully confirmed', { timeout: 60000 });
    const body = confirmBodies[0] || {};
    const qty = Object.fromEntries((body.items || []).map((i) => [i.name.replace(` ${label}`, ''), i.quantity]));
    check(`${label}: only whole quantities sent`, label === 'desktop'
      ? qty['E2E Salt 1KG'] === 20 && qty['E2E Gift Box'] === 5
      : qty['E2E Salt 1KG'] === 20 && !('E2E Gift Box' in qty), JSON.stringify(qty));
    const mine = Object.fromEntries((await products()).filter((p) => p.name.endsWith(label)).map((p) => [p.name.replace(` ${label}`, ''), p.current_stock]));
    check(`${label}: stock posted after correction (whole-number lines as before)`, label === 'desktop'
      ? mine['E2E Salt 1KG'] === 20 && mine['E2E Gift Box'] === 5
      : mine['E2E Salt 1KG'] === 20 && !('E2E Gift Box' in mine), JSON.stringify(mine));
    await page.close();
  }
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
