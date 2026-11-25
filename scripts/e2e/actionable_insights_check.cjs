/**
 * Browser check (Stage 7.5): prioritized insights on the real Dashboard and Insights pages.
 *
 * Shop A (owner, manager, cashier): Rice out of stock after a sale (CRITICAL), Jam below its minimum
 * (MEDIUM), Soap never sold; one sale today. Shop B has a product only it owns ("Zeta Secret Oil").
 * - API: owner and manager 200, cashier 403; counts and today's figures match the records.
 * - Dashboard: "Priority actions" lists Rice first; "View all" opens the Insights Action Center.
 * - Action Center: today's sales match the sale; Rice is the first (CRITICAL) card with recorded and
 *   configured evidence; priority filter; nothing from shop B; a 500 shows an error with retry, then loads.
 * - Cashier: Insights is restricted and no actionable-insights request is sent; no dashboard card.
 * - Desktop and an emulated Pixel 7: no horizontal page overflow.
 * Generic test values.
 *
 * Run through the isolated test launcher:
 *   node scripts/e2e/run.cjs actionable_insights_check
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const SP = process.env.E2E_ARTIFACT_DIR || process.argv[2] || '.';
const { API, WEB } = require('./e2e_env.cjs').e2eTarget();
const PAGE = `${WEB}/scripts/e2e/harness/insights.html`;
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const H = { 'Content-Type': 'application/json' };
const post = (url, body, headers = H) => fetch(`${API}${url}`, { method: 'POST', headers, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
async function user(email) {
  await post('/auth/register', { email, password: 'password123' });
  const { body } = await post('/auth/login', { email, password: 'password123' });
  return { token: body.access_token, h: { ...H, Authorization: `Bearer ${body.access_token}` } };
}
async function memberOf(shopId, ownerH, role, ts) {
  const email = `ins-${role.toLowerCase()}-${ts}@example.com`;
  const reg = await post('/auth/register', { email, password: 'password123' });
  await post(`/shops/${shopId}/members`, { user_id: reg.body.id, role }, ownerH);
  return user(email);
}

(async () => {
  fs.mkdirSync(SP, { recursive: true });
  const ts = Date.now();
  const owner = await user(`ins-owner-${ts}@example.com`);
  const shopA = await post('/shops', { shop_name: 'Insights A', owner_name: 'O', business_type: 'Grocery/Kirana', location: 'L' }, owner.h);
  const mk = (h, name, unit, stock, price, reorder) =>
    post('/products', { name, unit, current_stock: stock, selling_price: price, purchase_price: price, mrp: Math.max(price * 2, 100), pricing_status: 'VERIFIED', ...(reorder !== undefined ? { reorder_level: reorder } : {}) }, h).then((r) => r.body);
  const rice = await mk(owner.h, 'Rice', 'kg', 2, 60, 5);
  await mk(owner.h, 'Jam', 'pcs', 2, 80, 5);
  await mk(owner.h, 'Soap', 'pcs', 20, 25);
  const sale = await post('/sales', { items: [{ product_id: rice.id, quantity: 2, unit_price: 60 }], payment_method: 'cash' }, owner.h);
  check('setup: sale recorded (Rice now out of stock)', sale.status === 200 || sale.status === 201, String(sale.status));
  const manager = await memberOf(shopA.body.id, owner.h, 'MANAGER', ts);
  const cashier = await memberOf(shopA.body.id, owner.h, 'CASHIER', ts);

  const other = await user(`ins-other-${ts}@example.com`);
  await post('/shops', { shop_name: 'Insights B', owner_name: 'B', business_type: 'Grocery/Kirana', location: 'L' }, other.h);
  const secret = await mk(other.h, 'Zeta Secret Oil', 'L', 1, 99, 10);
  await post('/sales', { items: [{ product_id: secret.id, quantity: 1, unit_price: 99 }], payment_method: 'cash' }, other.h);

  // API ground truth
  const api = await fetch(`${API}/insights/actionable`, { headers: owner.h }).then((r) => r.json());
  const first = api.insights?.[0];
  check('API: owner gets prioritized insights, CRITICAL Rice first', first?.priority === 'CRITICAL' && first?.product_name === 'Rice' && first?.type === 'out_of_stock_with_demand', JSON.stringify(first && [first.priority, first.product_name, first.type]));
  check('API: today summary matches the recorded sale', api.summary?.today_sales === 120 && api.summary?.today_transactions === 1 && api.summary?.products_sold_today === 1, JSON.stringify(api.summary && [api.summary.today_sales, api.summary.today_transactions]));
  check('API: Jam below minimum (MEDIUM, configured threshold 5)', api.insights.some((i) => i.type === 'below_minimum_stock' && i.product_name === 'Jam' && i.priority === 'MEDIUM' && i.threshold_value === 5));
  check('API: no data from shop B', !JSON.stringify(api).includes('Zeta'));
  check('API: manager 200, cashier 403', (await fetch(`${API}/insights/actionable`, { headers: manager.h })).status === 200
    && (await fetch(`${API}/insights/actionable`, { headers: cashier.h })).status === 403);

  const browser = await chromium.launch();
  try {
    for (const [label, ctxOpts] of [['desktop', { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 }], ['phone', { ...devices['Pixel 7'] }]]) {
      const ctx = await browser.newContext(ctxOpts);
      await ctx.addInitScript((t) => { localStorage.setItem('shoppulse_token', t); localStorage.setItem('shoppulse_role', 'owner'); }, owner.token);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
      await page.goto(PAGE);

      // Dashboard card
      const card = page.locator('[data-testid="priority-actions"]');
      await card.locator('li').first().waitFor({ timeout: 30000 });
      const firstItem = await card.locator('li').first().innerText();
      check(`${label}: dashboard Priority actions lists Rice first (Critical)`, firstItem.includes('Rice is out of stock') && /critical/i.test(firstItem), firstItem.replace(/\n/g, ' | '));
      check(`${label}: dashboard card shows no other shop's data`, !(await card.innerText()).includes('Zeta'));
      await page.screenshot({ path: `${SP}/insights_dashboard_${label}.png` });

      // View all -> Action Center
      await page.locator('button:has-text("View all in Action Center"), button:has(span:has-text("View all in Action Center"))').first().click();
      await page.locator('[data-testid="action-center"]').waitFor({ timeout: 30000 });
      const selected = await page.locator('button[role="tab"][aria-selected="true"]').innerText();
      check(`${label}: View all opens the Action Center tab`, selected.includes('Action Center'), selected);
      const summary = await page.locator('[data-testid="actions-summary"]').innerText();
      check(`${label}: summary shows today's recorded sales`, summary.includes('₹120.00') && summary.includes('1 transaction · 1 product'), summary.replace(/\n/g, ' | '));
      const cards = page.locator('[data-testid="insight-card"]');
      const firstCard = await cards.first().innerText();
      check(`${label}: first card is Critical Rice with recorded and configured evidence`, (await cards.first().getAttribute('data-priority')) === 'CRITICAL'
        && firstCard.includes('Rice is out of stock') && firstCard.includes('Recorded') && firstCard.includes('Your setting') && /suggested action \(advisory\)/i.test(firstCard), firstCard.replace(/\n/g, ' | ').slice(0, 200));
      check(`${label}: Action Center shows no other shop's data`, !(await page.locator('[data-testid="action-center"]').innerText()).includes('Zeta'));
      await page.screenshot({ path: `${SP}/insights_action_center_${label}.png`, fullPage: label === 'desktop' });

      await page.locator('button[aria-pressed]:has-text("Medium")').click();
      const prios = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-priority')));
      check(`${label}: Medium filter shows only Medium insights`, prios.length > 0 && prios.every((p) => p === 'MEDIUM'), JSON.stringify(prios));

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${label}: no horizontal page overflow`, overflow <= 1, `overflow ${overflow}px`);

      if (label === 'desktop') {
        // Failure then retry, via the page's own refresh
        await page.route('**/api/v1/insights/actionable**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Internal error"}' }));
        await page.reload();
        await page.locator('[data-testid="priority-actions"]').waitFor({ timeout: 30000 });
        const dashErr = page.locator('[data-testid="priority-actions"] [role="alert"]');
        await dashErr.waitFor({ timeout: 30000 });
        check('desktop: dashboard card shows an error with retry, no items', (await dashErr.innerText()).includes('Could not load priority actions.')
          && (await page.locator('[data-testid="priority-actions"] li').count()) === 0);
        await page.locator('button:has-text("View all in Action Center"), button:has(span:has-text("View all in Action Center"))').first().click();
        await page.locator('[data-testid="actions-error"]').waitFor({ timeout: 30000 });
        const errText = await page.locator('[data-testid="actions-error"]').innerText();
        check('desktop: Action Center error with Try again and no figures', errText.includes('Try again') && !/₹\d/.test(errText), errText.replace(/\n/g, ' | '));
        await page.unroute('**/api/v1/insights/actionable**');
        await page.locator('[data-testid="actions-error"] button:has-text("Try again")').click();
        await page.locator('[data-testid="action-center"]').waitFor({ timeout: 30000 });
        check('desktop: retry loads the real insights', (await page.locator('[data-testid="insight-card"]').first().innerText()).includes('Rice is out of stock'));
      }
      await ctx.close();
    }

    // Cashier
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript((t) => { localStorage.setItem('shoppulse_token', t); localStorage.setItem('shoppulse_role', 'cashier'); }, cashier.token);
    const page = await ctx.newPage();
    const actionableRequests = [];
    page.on('request', (r) => { if (r.url().includes('/insights/actionable')) actionableRequests.push(r.url()); });
    await page.goto(PAGE);
    await page.waitForTimeout(2500);
    check('cashier: no Priority actions card on the dashboard', (await page.locator('[data-testid="priority-actions"]').count()) === 0);
    check('cashier: no actionable-insights request sent', actionableRequests.length === 0, JSON.stringify(actionableRequests));
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
