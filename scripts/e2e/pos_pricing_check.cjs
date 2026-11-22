/**
 * Browser check (Stage 5): POS pricing UX on the real Sales page, against the isolated test backend.
 *
 * Desktop, CASHIER (English):
 *  - all four pricing statuses are shown and explained; NEEDS_REVIEW / INCOMPLETE cannot be added and the
 *    cashier is told to ask a Manager / Owner (no verify action); WHOLESALE_ONLY is sellable with its limit;
 *  - rates show their pricing basis (₹40.00 / packet, ₹30.00 / 100 g);
 *  - the cart shows the server's quote: 0.25 kg of a ₹30 / 100 g product = ₹75.00; the total is the server's;
 *  - an over-stock quantity is refused on its line and checkout is disabled;
 *  - a refused sale keeps the cart and shows the server's reason; a double click records one sale only.
 * Phone, MANAGER (Hindi UI):
 *  - status labels are localized; the manager verifies a NEEDS_REVIEW product from the POS and can then sell it;
 *  - a requested (corrected) voice price above MRP is refused on its line; "use catalogue price" recovers.
 *
 * INCOMPLETE and WHOLESALE_ONLY cannot be created through the API (they come from data reconciliation), so the
 * product list response is adjusted for two products to show those states; their server rules are covered by
 * backend tests (test_stage5_pos_api.py).
 *
 *   node scripts/e2e/run.cjs pos_pricing_check
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
  const account = async (label) => {
    const email = `pos-${label}-${Date.now()}@example.com`;
    const { id } = await fetch(`${API}/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'password123' }) }).then((r) => r.json());
    const { access_token: tok } = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'password123' }) }).then((r) => r.json());
    return { id, tok, auth: { ...H, Authorization: `Bearer ${tok}` } };
  };
  const owner = await account('owner');
  const shop = await fetch(`${API}/shops`, { method: 'POST', headers: owner.auth, body: JSON.stringify({ shop_name: 'K', owner_name: 'R', business_type: 'Grocery/Kirana', location: 'B' }) }).then((r) => r.json());
  const staff = {};
  for (const role of ['MANAGER', 'CASHIER']) {
    staff[role] = await account(role.toLowerCase());
    await fetch(`${API}/shops/${shop.id}/members`, { method: 'POST', headers: owner.auth, body: JSON.stringify({ user_id: staff[role].id, role }) });
  }
  const mk = (body) => fetch(`${API}/products`, { method: 'POST', headers: owner.auth, body: JSON.stringify({ purchase_price: 1, ...body }) }).then((r) => r.json());
  const tea = await mk({ name: 'Tea', unit: 'packet', price_basis_unit: 'packet', current_stock: 20, selling_price: 40, mrp: 45, pricing_status: 'VERIFIED' });
  const saffron = await mk({ name: 'Saffron', unit: 'kg', price_basis_quantity: 100, price_basis_unit: 'g', current_stock: 2, selling_price: 30, pricing_status: 'VERIFIED' });
  const biscuit = await mk({ name: 'Biscuit', unit: 'pcs', current_stock: 50, selling_price: 10 });  // NEEDS_REVIEW
  const dal = await mk({ name: 'Dal Loose', unit: 'kg', current_stock: 10, selling_price: 120, pricing_status: 'VERIFIED' });
  const rice = await mk({ name: 'Rice Bag', unit: 'bag', current_stock: 10, selling_price: 1200, pricing_status: 'VERIFIED' });
  check('setup: statuses from the API', [tea, saffron, dal, rice].every((p) => p.pricing_status === 'VERIFIED') && biscuit.pricing_status === 'NEEDS_REVIEW');
  const stock = async (p) => (await fetch(`${API}/products/${p.id}`, { headers: owner.auth }).then((r) => r.json())).current_stock;

  const browser = await chromium.launch();
  for (const [label, user, lang, ctxOpts] of [
    ['desktop', staff.CASHIER, 'en', { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 }],
    ['phone', staff.MANAGER, 'hi', { ...devices['Pixel 7'] }],
  ]) {
    const page = await (await browser.newContext(ctxOpts)).newPage();
    await page.addInitScript(([t, l]) => { localStorage.setItem('shoppulse_token', t); localStorage.setItem('shelfora_language', l); }, [user.tok, lang]);
    page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
    // INCOMPLETE / WHOLESALE_ONLY cannot be created through the API: present two products in those states
    await page.route('**/api/v1/products?*', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      for (const p of body.items || []) {
        if (p.id === dal.id) p.pricing_status = 'INCOMPLETE';
        if (p.id === rice.id) p.pricing_status = 'WHOLESALE_ONLY';
      }
      await route.fulfill({ response: res, json: body });
    });
    const saleRequests = [];
    page.on('request', (r) => { if (/\/api\/v1\/sales\/?$/.test(new URL(r.url()).pathname) && r.method() === 'POST') saleRequests.push(JSON.parse(r.postData() || '{}')); });
    await page.goto(SALES);
    const card = (name) => page.locator(`[data-testid="pos-product"][data-product-name="${name}"]`);
    await card('Tea').waitFor({ timeout: 30000 });
    const badge = async (name) => ((await card(name).locator('[data-testid="pricing-status-badge"]').count()) ? card(name).locator('[data-testid="pricing-status-badge"]').innerText() : '');
    const lines = () => page.locator('[data-testid="cart-line"]');
    const waitQuote = () => page.waitForFunction(() => {
      const ls = [...document.querySelectorAll('[data-testid="cart-line"]')];
      return ls.length > 0 && ls.every((l) => l.getAttribute('data-line-state') !== 'pending') && !document.querySelector('[data-testid="quote-status"]');
    }, null, { timeout: 15000 });

    if (label === 'desktop') {
      check('desktop (cashier): four statuses shown', (await badge('Tea')) === '' && (await badge('Biscuit')) === 'Price needs review'
        && (await badge('Dal Loose')) === 'Price incomplete' && (await badge('Rice Bag')) === 'Wholesale only');
      check('desktop (cashier): unsellable products explained, no verify action for a cashier',
        (await card('Biscuit').locator('[data-testid="pricing-status-reason"]').innerText()).includes('until a Manager or Owner verifies')
        && (await card('Dal Loose').locator('[data-testid="pricing-status-reason"]').innerText()).includes('incomplete')
        && (await card('Biscuit').locator('text=Ask a Manager or Owner').count()) === 1 && (await page.locator('[data-testid="verify-price"]').count()) === 0);
      check('desktop (cashier): wholesale limit explained', (await card('Rice Bag').locator('[data-testid="pricing-status-reason"]').innerText()).includes('whole bag'));
      check('desktop (cashier): rates show their basis', (await card('Tea').locator('[data-testid="pos-rate"]').innerText()) === '₹40.00 / packet'
        && (await card('Saffron').locator('[data-testid="pos-rate"]').innerText()) === '₹30.00 / 100 g');
      await card('Biscuit').click();
      await card('Dal Loose').click();
      check('desktop (cashier): NEEDS_REVIEW / INCOMPLETE cannot be added', (await lines().count()) === 0
        && (await card('Biscuit').locator('button:has-text("Add")').isDisabled()));

      for (let i = 0; i < 3; i++) await card('Tea').locator('button:has-text("Add")').click();
      await card('Saffron').locator('button:has-text("Add")').click();
      const saffronQty = page.locator('input[aria-label="Quantity of Saffron (kg)"]');
      await saffronQty.fill('0.25');
      await saffronQty.press('Enter');
      await waitQuote();
      const totals = await page.locator('[data-testid="cart-line-total"]').allInnerTexts();
      const rates = await page.locator('[data-testid="cart-line-rate"]').allInnerTexts();
      check('desktop (cashier): server-quoted lines (0.25 kg at ₹30 / 100 g = ₹75.00)', JSON.stringify(totals) === JSON.stringify(['₹120.00', '₹75.00'])
        && rates[1] === '0.25 kg × ₹30.00 / 100 g', JSON.stringify({ totals, rates }));
      check('desktop (cashier): bill total is the server total', (await page.locator('[data-testid="bill-total"]').innerText()) === '₹195.00');

      await saffronQty.fill('5');
      await saffronQty.press('Enter');
      await waitQuote();
      const err = page.locator('[data-testid="cart-line-error"]');
      check('desktop (cashier): over-stock refused on its line, checkout disabled', (await err.count()) === 1 && (await err.innerText()).includes('Not enough stock')
        && (await page.locator('[data-testid="quote-blocked"]').count()) === 1 && (await page.locator('button:has-text("Complete Sale")').first().isDisabled()));
      await page.screenshot({ path: `${SP}/pos_line_error_${label}.png`, fullPage: false });
      await saffronQty.fill('0.25');
      await saffronQty.press('Enter');
      await waitQuote();

      // The server refuses the sale (e.g. stock changed meanwhile): nothing is lost
      await page.route('**/api/v1/sales', (route) => route.request().method() === 'POST'
        ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ detail: "Insufficient stock for product 'Tea'. Available: 1, requested: 3" }) })
        : route.continue(), { times: 1 });
      await page.locator('button:has-text("Complete Sale")').first().click();
      await page.waitForSelector('[data-testid="sale-error"]', { timeout: 15000 });
      check('desktop (cashier): refused sale keeps the cart and shows the server reason', (await lines().count()) === 2
        && (await page.locator('[data-testid="sale-error"]').innerText()).includes("Insufficient stock for product 'Tea'"));
      await waitQuote();
      const before = saleRequests.length;
      const btn = page.locator('button:has-text("Complete Sale (₹195.00)")').first();
      await btn.dblclick();
      await page.waitForFunction(() => /195/.test(document.body.innerText) && !document.querySelector('[data-testid="cart-line"]'), null, { timeout: 30000 });
      await page.waitForTimeout(600);
      check('desktop (cashier): double click records one sale; stock updated', saleRequests.length - before === 1
        && (await stock(tea)) === 17 && (await stock(saffron)) === 1.75, `${saleRequests.length - before} requests`);
    } else {
      check('phone (manager, Hindi): status labels localized', (await badge('Biscuit')) === 'मूल्य की जाँच बाकी' && (await badge('Rice Bag')) === 'केवल थोक');
      const verify = card('Biscuit').locator('[data-testid="verify-price"]');
      // The role loads after the page; until then the card shows the cashier text (no manager action)
      await verify.waitFor({ timeout: 15000 }).catch(() => undefined);
      check('phone (manager): verify action offered', (await verify.count()) === 1 && (await verify.innerText()) === 'मूल्य सत्यापित करें');
      await verify.click();
      await page.waitForFunction(() => document.querySelector('[data-product-name="Biscuit"]')?.getAttribute('data-pricing-status') === 'VERIFIED', null, { timeout: 15000 });
      check('phone (manager): verified by the server, now sellable', (await badge('Biscuit')) === ''
        && (await card('Biscuit').locator('[data-testid="product-notice"]').innerText()).includes('Biscuit'));
      await card('Biscuit').locator('button').last().click();

      // A requested price above MRP (₹140 for 3 x ₹45 MRP) is refused on its line, even for a manager
      await page.locator('button[title="Voice-to-Bill assistant"]').first().click();
      const input = page.locator('input[placeholder^="Type voice sentence"]');
      await input.waitFor({ timeout: 30000 });
      await input.fill('3 tea packets for 100 rupees');
      // Edit only after the backend result has replaced the instant local preview
      const voiceDone = page.waitForResponse((r) => r.url().includes('/api/v1/voice/process'), { timeout: 30000 });
      await page.click('button:has-text("Simulate")');
      await voiceDone;
      await page.waitForTimeout(300);
      const teaTotal = page.locator('input[aria-label="Line total for Tea"]');
      await teaTotal.waitFor({ timeout: 30000 });
      check('phone (manager): voice approval label localized for the bill language', (await page.locator('[data-testid="voice-price-source"]').count()) === 1);
      await teaTotal.fill('140');
      await teaTotal.press('Enter');
      await page.locator('button:has-text("(2)"), button:has-text("Add to Bill"), button:has-text("बिल में जोड़ें")').first().click();
      await page.waitForSelector('[data-testid="cart-line-approval"]', { timeout: 15000 });
      await waitQuote();
      const err = page.locator('[data-testid="cart-line-error"]');
      check('phone (manager): MRP refusal shown on the line (localized), checkout disabled', (await err.count()) === 1
        && (await err.innerText()).includes('MRP') && (await err.innerText()).includes('मूल्य MRP से अधिक'));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check('phone (manager): no horizontal page overflow', overflow <= 1, `overflow ${overflow}px`);
      await err.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SP}/pos_mrp_${label}.png`, fullPage: false });
      await page.locator('[data-testid="cart-line-approval"] button').first().click();
      await waitQuote();
      check('phone (manager): catalogue price clears the refusal; total from the server', (await err.count()) === 0
        && (await page.locator('[data-testid="bill-total"]').innerText()) === '₹130.00');
      await page.locator('[data-testid="bill-total"]').scrollIntoViewIfNeeded();
      await page.locator('button:has-text("₹130.00")').last().click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="cart-line"]'), null, { timeout: 30000 });
      check('phone (manager): sale recorded at catalogue prices', (await stock(tea)) === 14 && (await stock(biscuit)) === 49);
    }
    await page.close();
  }
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
