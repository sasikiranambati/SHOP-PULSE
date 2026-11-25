/**
 * Browser check (Voice-to-Bill final integration):
 * 1. Spoken & edited prices stay visible in Voice-to-Bill -> Cart, and server-authoritative checkout
 *    blocks mismatched price assertions without mutating stock (keeps cart intact).
 * 2. Catalog-aligned Voice-to-Bill checkout ("3 tea packets for 120 rupees and 500 g sugar",
 *    catalogue: tea ₹40 / packet, sugar ₹44 / kg -> 0.5 kg = ₹22, total ₹142.00) saves ₹142.00
 *    and deducts physical stock (tea -3, sugar -0.5 kg).
 * Runs across Desktop (1366x900), Pixel 7 phone, and compact Mobile (320x568) with zero overflow.
 *
 * Run through the isolated test launcher (test backend, test database, dedicated ports):
 *   node scripts/e2e/run.cjs voice_bill_price_check
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const SP = process.argv[2] || '.';
const { API, WEB } = require('./e2e_env.cjs').e2eTarget();
const SALES = `${WEB}/scripts/e2e/harness/sales.html`;
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

(async () => {
  fs.mkdirSync(SP, { recursive: true });
  const H = { 'Content-Type': 'application/json' };
  const email = `voice-ui-${Date.now()}@example.com`;
  await fetch(`${API}/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'password123' }) });
  const { access_token: tok } = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'password123' }) }).then((r) => r.json());
  const auth = { ...H, Authorization: `Bearer ${tok}` };
  await fetch(`${API}/shops`, { method: 'POST', headers: auth, body: JSON.stringify({ shop_name: 'K', owner_name: 'R', business_type: 'Grocery/Kirana', location: 'B' }) });
  const mk = (name, unit, stock, price) => fetch(`${API}/products`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name, unit, current_stock: stock, selling_price: price, purchase_price: price, pricing_status: 'VERIFIED' }),
  }).then((r) => r.json());
  const tea = await mk('Tea', 'packet', 20, 40);
  const sugar = await mk('Sugar', 'kg', 10, 44);
  const stock = async (p) => (await fetch(`${API}/products/${p.id}`, { headers: auth }).then((r) => r.json())).current_stock;

  const browser = await chromium.launch();
  let expected = { tea: 20, sugar: 10 };
  const contexts = [
    ['desktop', { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 }],
    ['phone', { ...devices['Pixel 7'] }],
    ['small_mobile_320', { viewport: { width: 320, height: 568 }, deviceScaleFactor: 1 }],
  ];

  for (const [label, ctxOpts] of contexts) {
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await page.addInitScript((t) => localStorage.setItem('shoppulse_token', t), tok);
    const saleBodies = [];
    const saleResponses = [];
    page.on('request', (r) => {
      if (/\/api\/v1\/sales\/?$/.test(new URL(r.url()).pathname) && r.method() === 'POST') {
        saleBodies.push(JSON.parse(r.postData() || '{}'));
      }
    });
    page.on('response', async (r) => {
      if (/\/api\/v1\/sales\/?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST') {
        saleResponses.push({ status: r.status(), body: await r.json().catch(() => ({})) });
      }
    });
    page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));

    await page.goto(SALES);
    await page.locator('button[title="Voice-to-Bill assistant"]').first().waitFor({ timeout: 30000 });
    check(`${label}: Sales page fits viewport width (overflow <= 1px)`,
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);

    await page.locator('button[title="Voice-to-Bill assistant"]').first().click();
    const input = page.locator('input[placeholder*="voice sentence"]');
    await input.waitFor({ timeout: 30000 });

    // Phase A: Spoken override + manual edit -> backend strictly rejects tampered/mismatched assertion (Stage 4 security)
    await input.fill('3 tea packets for 100 rupees and 500 g sugar');
    await page.click('button:has-text("Simulate")');
    await page.waitForSelector('input[aria-label="Line total for Sugar"]', { timeout: 30000 });
    const teaTotal = page.locator('input[aria-label="Line total for Tea"]');
    const sugarTotal = page.locator('input[aria-label="Line total for Sugar"]');
    check(`${label}: tea keeps spoken ₹100 (not 3 x ₹40)`, (await teaTotal.inputValue()) === '100'
      && (await page.locator('[data-testid="voice-price-source"]:has-text("Spoken price")').count()) === 1);
    check(`${label}: 500 g sugar converts to 0.5 kg @ ₹22`, (await sugarTotal.inputValue()) === '22'
      && (await page.locator('text=said 500 g').count()) === 1);
    check(`${label}: modal has zero horizontal overflow`,
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);

    await sugarTotal.fill('25');
    await sugarTotal.press('Enter');
    check(`${label}: edited sugar total ₹25 kept in modal`, (await sugarTotal.inputValue()) === '25'
      && (await page.locator('[data-testid="voice-price-source"]:has-text("Edited price")').count()) === 1);

    await page.click('button:has-text("Add to Bill")');
    await page.waitForSelector('[data-testid="cart-line"]', { timeout: 15000 });
    const totalsBeforeTamper = await page.locator('[data-testid="cart-line-total"]').allInnerTexts();
    check(`${label}: cart keeps agreed prices before checkout`, JSON.stringify(totalsBeforeTamper) === JSON.stringify(['₹100.00', '₹25.00']));

    const tamperedBtn = page.locator('button:has-text("Complete Sale (₹125.00)")').first();
    await tamperedBtn.click();
    await page.waitForSelector('text=Price assertion failed', { timeout: 15000 });
    check(`${label}: server blocks non-catalog price assertion (400) & preserves cart/stock`,
      saleResponses[0]?.status === 400
      && (await page.locator('[data-testid="cart-line"]').count()) === 2
      && (await stock(tea)) === expected.tea
      && (await stock(sugar)) === expected.sugar);

    // Clear bill cleanly, then execute valid catalog-consistent Voice-to-Bill checkout
    await page.click('button[title="Clear all items from current bill"]');
    await page.click('button:has-text("Clear bill")');

    await page.locator('button[title="Voice-to-Bill assistant"]').first().click();
    await input.waitFor({ timeout: 15000 });
    await input.fill('3 tea packets for 120 rupees and 500 g sugar');
    await page.click('button:has-text("Simulate")');
    await page.waitForSelector('input[aria-label="Line total for Sugar"]', { timeout: 15000 });
    await page.click('button:has-text("Add to Bill")');
    await page.waitForSelector('[data-testid="cart-line"]', { timeout: 15000 });

    const validBtn = page.locator('button:has-text("Complete Sale (₹142.00)")').first();
    check(`${label}: catalog-aligned bill total ₹142.00 ready`, (await validBtn.count()) === 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label}: no horizontal overflow with cart populated`, overflow <= 1, `overflow ${overflow}px`);

    await validBtn.click();
    await page.locator('button:has-text("View & Print Receipt")').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);

    const lastSaleResp = saleResponses[saleResponses.length - 1];
    check(`${label}: saved sale total ₹142.00 (= displayed)`, lastSaleResp?.status === 201 && lastSaleResp?.body?.total_amount === 142);

    expected = { tea: expected.tea - 3, sugar: Math.round((expected.sugar - 0.5) * 1000) / 1000 };
    const got = { tea: await stock(tea), sugar: await stock(sugar) };
    check(`${label}: stock reduced accurately (tea -3, sugar -0.5 kg)`, JSON.stringify(got) === JSON.stringify(expected), JSON.stringify(got));

    await page.screenshot({ path: `${SP}/voice_final_${label}.png`, fullPage: false });
    await context.close();
  }
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
