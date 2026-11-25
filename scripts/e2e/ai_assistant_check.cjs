/**
 * Browser check (Stage 7.4): the business assistant answers from the shop's real records.
 *
 * Two shops on the isolated test backend. Shop A (owner + cashier) has Sugar (kg), Tea (low stock),
 * Rice (out of stock) and Soap, and one sale today (2.5 kg sugar at ₹44/kg + 1 tea at ₹40 = ₹150.00, one transaction).
 * Shop B has a product only it owns ("Zeta Secret Oil").
 *
 * - Owner: suggested and typed questions (Enter) return answers whose figures match the API; nothing
 *   from shop B appears; forecast answers carry confidence; summary and product explanation work.
 * - Failures: a 500 shows an error with "Try again" and no figures; retry then loads; a malformed
 *   response is refused; "Clear conversation" empties the chat.
 * - Cashier: restricted note, no suggestions, no insights request from the assistant; the API itself
 *   returns 403 for the cashier.
 * - Desktop and an emulated Pixel 7: no horizontal page overflow; Escape closes the dialog.
 * Generic test values.
 *
 * Run through the isolated test launcher:
 *   node scripts/e2e/run.cjs ai_assistant_check
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const SP = process.env.E2E_ARTIFACT_DIR || process.argv[2] || '.';
const { API, WEB } = require('./e2e_env.cjs').e2eTarget();
const PAGE = `${WEB}/scripts/e2e/harness/assistant.html`;
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const H = { 'Content-Type': 'application/json' };
const post = (url, body, headers = H) => fetch(`${API}${url}`, { method: 'POST', headers, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function user(email) {
  await post('/auth/register', { email, password: 'password123' });
  const { body } = await post('/auth/login', { email, password: 'password123' });
  return { token: body.access_token, h: { ...H, Authorization: `Bearer ${body.access_token}` } };
}

async function openAssistant(page) {
  await page.goto(PAGE);
  await page.locator('button[aria-label="Open Shelfora Assistant"]').click();
  await page.locator('[role="dialog"]').waitFor({ timeout: 30000 });
}

/** Ask (typed + Enter, or chip) and return the text of the new answer. */
async function askTyped(page, q) {
  const before = await page.locator('[data-testid="assistant-answer"]').count();
  const input = page.locator('[role="dialog"] input[type="text"]');
  await input.fill(q);
  await input.press('Enter');
  await page.locator('[data-testid="assistant-answer"]').nth(before).waitFor({ timeout: 30000 });
  return page.locator('[data-testid="assistant-answer"]').nth(before);
}
async function askChip(page, label) {
  const before = await page.locator('[data-testid="assistant-answer"]').count();
  await page.locator(`[role="dialog"] button:has-text("${label}")`).first().click();
  await page.locator('[data-testid="assistant-answer"]').nth(before).waitFor({ timeout: 30000 });
  return page.locator('[data-testid="assistant-answer"]').nth(before);
}

(async () => {
  fs.mkdirSync(SP, { recursive: true });
  const ts = Date.now();

  // ---- Shop A: owner, cashier, products, two sales today
  const owner = await user(`assistant-owner-${ts}@example.com`);
  const shopA = await post('/shops', { shop_name: 'Assistant A', owner_name: 'Owner', business_type: 'Grocery/Kirana', location: 'Street' }, owner.h);
  const mk = (h, name, unit, stock, price, reorder) =>
    post('/products', { name, unit, current_stock: stock, selling_price: price, purchase_price: price, mrp: Math.max(price * 2, 100), pricing_status: 'VERIFIED', ...(reorder !== undefined ? { reorder_level: reorder } : {}) }, h).then((r) => r.body);
  const sugar = await mk(owner.h, 'Sugar', 'kg', 10, 44, 2);
  const tea = await mk(owner.h, 'Tea', 'packet', 3, 40, 5);
  await mk(owner.h, 'Rice', 'kg', 0, 60, 5);
  await mk(owner.h, 'Soap', 'pcs', 20, 25);
  const sale = await post('/sales', { items: [{ product_id: sugar.id, quantity: 2.5, unit_price: 44 }, { product_id: tea.id, quantity: 1, unit_price: 40 }], payment_method: 'cash' }, owner.h);
  check('setup: shop A sale recorded', sale.status === 200 || sale.status === 201, `${sale.status} ${JSON.stringify(sale.body).slice(0, 300)}`);

  const cashierEmail = `assistant-cashier-${ts}@example.com`;
  const reg = await post('/auth/register', { email: cashierEmail, password: 'password123' });
  await post(`/shops/${shopA.body.id}/members`, { user_id: reg.body.id, role: 'CASHIER' }, owner.h);
  const cashier = await user(cashierEmail);

  // ---- Shop B: a different owner and a product only shop B has
  const other = await user(`assistant-other-${ts}@example.com`);
  await post('/shops', { shop_name: 'Assistant B', owner_name: 'Other', business_type: 'Grocery/Kirana', location: 'Road' }, other.h);
  const secret = await mk(other.h, 'Zeta Secret Oil', 'L', 5, 99, 10);
  await post('/sales', { items: [{ product_id: secret.id, quantity: 5, unit_price: 99 }], payment_method: 'cash' }, other.h);

  // Ground truth from the API (owner A)
  const apiSales = await fetch(`${API}/insights/sales?period=today`, { headers: owner.h }).then((r) => r.json());
  const cashierStatus = await fetch(`${API}/insights/sales?period=today`, { headers: cashier.h }).then((r) => r.status);
  check('API: owner A total today is ₹150', apiSales.overview?.total_sales === 150, JSON.stringify(apiSales.overview?.total_sales));
  check('API: cashier gets 403 from insights', cashierStatus === 403, String(cashierStatus));

  const browser = await chromium.launch();
  try {
    for (const [label, ctxOpts] of [['desktop', { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 }], ['phone', { ...devices['Pixel 7'] }]]) {
      const ctx = await browser.newContext(ctxOpts);
      await ctx.addInitScript((t) => { localStorage.setItem('shoppulse_token', t); localStorage.setItem('shoppulse_role', 'owner'); }, owner.token);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
      await openAssistant(page);
      check(`${label}: empty state shows data note and suggestions`, (await page.locator('[data-testid="assistant-empty"]').innerText()).includes("Answers use only your shop's sales, stock and forecast records."));

      const salesAns = await (await askChip(page, 'How are my sales today?')).innerText();
      const tx = apiSales.overview.transaction_count;
      check(`${label}: sales today matches the API (₹150.00, ${tx} transaction(s), UTC)`, tx === 1 && salesAns.includes('Total sales: ₹150.00 from 1 transaction.') && salesAns.includes('UTC') && !salesAns.includes('%'), salesAns.replace(/\n/g, ' | ').slice(0, 200));

      const out = await (await askTyped(page, 'What is out of stock?')).innerText();
      check(`${label}: out of stock lists Rice only from shop A`, out.includes('Rice') && !out.includes('Zeta'), out.replace(/\n/g, ' | ').slice(0, 200));

      const low = await (await askTyped(page, 'Which products are running low?')).innerText();
      check(`${label}: low stock shows Tea with its configured minimum`, low.includes('Tea') && low.includes('2 packet in stock · minimum 5 packet'), low.replace(/\n/g, ' | ').slice(0, 200));

      if (label === 'desktop') {
        const top = await (await askTyped(page, 'top selling products this week')).innerText();
        check('desktop: top sellers from real sales', top.includes('1. Sugar') && top.includes('2.5 kg sold · ₹110.00 revenue') && !top.includes('Zeta'), top.replace(/\n/g, ' | ').slice(0, 200));

        const explain = await (await askTyped(page, 'explain the forecast for sugar')).innerText();
        check('desktop: product forecast shows confidence and method', explain.includes('Forecast · Sugar') && /Confidence: (HIGH|MEDIUM|LOW|NONE)/.test(explain) && explain.includes('Method:'), explain.replace(/\n/g, ' | ').slice(0, 200));

        const notFound = await (await askTyped(page, 'explain the forecast for zeta secret oil')).innerText();
        check('desktop: another shop\'s product is not found', notFound.includes('Product not found'), notFound.slice(0, 120));

        const summary = await (await askTyped(page, 'Give me a business summary')).innerText();
        check('desktop: business summary from real data', summary.includes('Business summary') && summary.includes('Overall:') && summary.includes('₹150.00') && !summary.includes('Zeta'), summary.replace(/\n/g, ' | ').slice(0, 240));

        const reorder = await (await askTyped(page, 'What should I reorder?')).innerText();
        check('desktop: reorder answer is advisory (or states none)', /Reorder suggestions/.test(reorder) && (/advisory, not orders/.test(reorder) || /No reorder is suggested/.test(reorder)), reorder.replace(/\n/g, ' | ').slice(0, 200));

        const unknown = await (await askTyped(page, 'what is the weather')).innerText();
        check('desktop: unrelated question gets help, no figures', unknown.includes('Questions I can answer') && !/₹\d/.test(unknown));

        // Failure, retry, malformed
        await page.route('**/api/v1/insights/inventory', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Internal error"}' }));
        const errAns = await askTyped(page, 'inventory summary');
        const errText = await errAns.innerText();
        check('desktop: server failure shows an error with retry and no figures', (await errAns.getAttribute('data-kind')) === 'error' && errText.includes('Try again') && !/\d+ (in stock|active products?)/.test(errText), errText.replace(/\n/g, ' | '));
        await page.screenshot({ path: `${SP}/assistant_error_${label}.png` });
        await page.unroute('**/api/v1/insights/inventory');
        const before = await page.locator('[data-testid="assistant-answer"]').count();
        await errAns.locator('button:has-text("Try again")').click();
        await page.waitForFunction((n) => {
          const all = document.querySelectorAll('[data-testid="assistant-answer"]');
          return all.length >= n && all[all.length - 1].getAttribute('data-kind') !== 'error';
        }, before, { timeout: 30000 });
        const retried = await page.locator('[data-testid="assistant-answer"]').last().innerText();
        check('desktop: retry loads the real inventory summary', retried.includes('Inventory summary') && retried.includes('4 active products'), retried.replace(/\n/g, ' | ').slice(0, 200));

        await page.route('**/api/v1/insights/sales**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"unexpected":true}' }));
        const bad = await (await askTyped(page, 'sales this week')).innerText();
        check('desktop: malformed response is refused', bad.includes('Unexpected response') && !/₹\d/.test(bad), bad.replace(/\n/g, ' | '));
        await page.unroute('**/api/v1/insights/sales**');
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${label}: no horizontal page overflow`, overflow <= 1, `overflow ${overflow}px`);
      await page.screenshot({ path: `${SP}/assistant_${label}.png` });

      await page.locator('button[aria-label="Clear conversation"]').click();
      check(`${label}: clear conversation returns to the empty state`, (await page.locator('[data-testid="assistant-answer"]').count()) === 0 && (await page.locator('[data-testid="assistant-empty"]').count()) === 1);
      await page.keyboard.press('Escape');
      await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      check(`${label}: Escape closes the assistant`, (await page.locator('[role="dialog"]').count()) === 0);
      await ctx.close();
    }

    // ---- Cashier
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript((t) => { localStorage.setItem('shoppulse_token', t); localStorage.setItem('shoppulse_role', 'cashier'); }, cashier.token);
    const page = await ctx.newPage();
    const insightRequests = [];
    page.on('request', (r) => { if (r.url().includes('/api/v1/insights/')) insightRequests.push(r.url()); });
    await openAssistant(page);
    const empty = await page.locator('[data-testid="assistant-empty"]').innerText();
    check('cashier: restricted note, no analytics suggestions', empty.includes('Business insights are available to shop owners and managers.') && !empty.includes('How are my sales today?'));
    const restricted = await (await askTyped(page, 'How are my sales today?')).innerText();
    check('cashier: restricted answer, no figures', restricted.includes('Access restricted') && !/₹\d/.test(restricted));
    check('cashier: the assistant sent no insights request', insightRequests.length === 0, JSON.stringify(insightRequests));
    await page.screenshot({ path: `${SP}/assistant_cashier.png` });
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
