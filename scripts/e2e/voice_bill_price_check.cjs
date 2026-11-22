/**
 * Browser check (Voice-to-Bill, Stage 4C.1 Decision 1): a spoken price is a customer request.
 *
 * "3 tea packets for 100 rupees and 500 g sugar" (verified catalogue: tea ₹40 / packet, sugar ₹44 / kg):
 * - tea: spoken ₹100 differs from the catalogue ₹120 -> shown as "Spoken price · needs approval";
 * - sugar: 500 g sold as 0.5 kg at the catalogue ₹22.00, corrected by hand to ₹25.00 -> "Edited price · needs approval";
 * - the bill (₹125.00) is labelled "not final" next to the catalogue total (₹142.00) before approval.
 * Desktop, signed in as the OWNER: the sale is approved by the server (₹125.00 saved, two audit entries).
 * Phone, signed in as a CASHIER: the server refuses (Manager approval required), nothing is saved and the
 * bill is kept; the cashier switches the lines to catalogue prices and the sale completes at ₹142.00.
 * Real Sales page and voice modal (typed-sentence simulation; the backend voice service is real).
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
  const account = async (label) => {
    const email = `voice-${label}-${Date.now()}@example.com`;
    const { id } = await fetch(`${API}/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'password123' }) }).then((r) => r.json());
    const { access_token: tok } = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'password123' }) }).then((r) => r.json());
    return { id, tok, auth: { ...H, Authorization: `Bearer ${tok}` } };
  };
  const owner = await account('owner');
  const shop = await fetch(`${API}/shops`, { method: 'POST', headers: owner.auth, body: JSON.stringify({ shop_name: 'K', owner_name: 'R', business_type: 'Grocery/Kirana', location: 'B' }) }).then((r) => r.json());
  const cashier = await account('cashier');
  await fetch(`${API}/shops/${shop.id}/members`, { method: 'POST', headers: owner.auth, body: JSON.stringify({ user_id: cashier.id, role: 'CASHIER' }) });
  // Valid retail products, verified by the owner (only verified pricing can be sold)
  const mk = (name, unit, stock, price) => fetch(`${API}/products`, { method: 'POST', headers: owner.auth,
    body: JSON.stringify({ name, unit, current_stock: stock, selling_price: price, purchase_price: price, pricing_status: 'VERIFIED' }) }).then((r) => r.json());
  const tea = await mk('Tea', 'packet', 20, 40);
  const sugar = await mk('Sugar', 'kg', 10, 44);
  check('setup: products verified', tea.pricing_status === 'VERIFIED' && sugar.pricing_status === 'VERIFIED');
  const stock = async (p) => (await fetch(`${API}/products/${p.id}`, { headers: owner.auth }).then((r) => r.json())).current_stock;
  const overrides = async () => {
    const trail = await fetch(`${API}/products/${tea.id}/audit-trail`, { headers: owner.auth }).then((r) => r.json());
    const trail2 = await fetch(`${API}/products/${sugar.id}/audit-trail`, { headers: owner.auth }).then((r) => r.json());
    return [...trail, ...trail2].filter((e) => e.action_type === 'SALE_PRICE_OVERRIDE').length;
  };

  const browser = await chromium.launch();
  let expected = { tea: 20, sugar: 10 };
  for (const [label, who, ctxOpts] of [
    ['desktop', 'owner', { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 }],
    ['phone', 'cashier', { ...devices['Pixel 7'] }],
  ]) {
    const user = who === 'owner' ? owner : cashier;
    const page = await (await browser.newContext(ctxOpts)).newPage();
    await page.addInitScript((t) => localStorage.setItem('shoppulse_token', t), user.tok);  // token before page scripts
    const saleBodies = [];
    const saleResponses = [];
    page.on('request', (r) => { if (/\/api\/v1\/sales\/?$/.test(new URL(r.url()).pathname) && r.method() === 'POST') saleBodies.push(JSON.parse(r.postData() || '{}')); });
    page.on('response', async (r) => {
      if (/\/api\/v1\/sales\/?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST') saleResponses.push({ status: r.status(), body: await r.json().catch(() => ({})) });
    });
    page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
    await page.goto(SALES);
    await page.locator('button[title="Voice-to-Bill assistant"]').first().waitFor({ timeout: 30000 });
    await page.locator('button[title="Voice-to-Bill assistant"]').first().click();
    const input = page.locator('input[placeholder^="Type voice sentence"]');
    await input.waitFor({ timeout: 30000 });
    await input.fill('3 tea packets for 100 rupees and 500 g sugar');
    await page.click('button:has-text("Simulate")');
    await page.waitForSelector('input[aria-label="Line total for Sugar"]', { timeout: 30000 });
    const teaTotal = page.locator('input[aria-label="Line total for Tea"]');
    const sugarTotal = page.locator('input[aria-label="Line total for Sugar"]');
    check(`${label} (${who}): spoken ₹100 shown as a request needing approval, with the catalogue price`, (await teaTotal.inputValue()) === '100'
      && (await page.locator('[data-testid="voice-price-source"]:has-text("Spoken price · needs approval (catalogue ₹120.00)")').count()) === 1);
    check(`${label} (${who}): 500 g sugar is 0.5 kg at the catalogue price`, (await sugarTotal.inputValue()) === '22'
      && (await page.locator('text=said 500 g').count()) === 1);

    await sugarTotal.fill('25');
    await sugarTotal.press('Enter');
    check(`${label} (${who}): corrected price is also a request; bill marked not final`, (await sugarTotal.inputValue()) === '25'
      && (await page.locator('[data-testid="voice-price-source"]:has-text("Edited price · needs approval")').count()) === 1
      && (await page.locator('[data-testid="voice-approval-note"]').innerText()).includes('Catalogue total ₹142.00')
      && (await page.locator('button:has-text("needs approval")').count()) >= 1);
    await page.screenshot({ path: `${SP}/voice_bill_${label}.png`, fullPage: false });

    await page.click('button:has-text("Add to Bill")');
    await page.waitForSelector('[data-testid="cart-line"]', { timeout: 15000 }).catch(async (e) => {
      await page.screenshot({ path: `${SP}/voice_addtobill_failed_${label}.png`, fullPage: true });
      console.log('[debug]', (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 600));
      throw e;
    });
    const totals = await page.locator('[data-testid="cart-line-total"]').allInnerTexts();
    const approvals = await page.locator('[data-testid="cart-line-approval"]').allInnerTexts();
    check(`${label} (${who}): cart keeps the requests, each marked with its catalogue price`, JSON.stringify(totals) === JSON.stringify(['₹100.00', '₹25.00'])
      && approvals.length === 2 && approvals[0].includes('Catalogue ₹120.00') && approvals[1].includes('Catalogue ₹22.00') && approvals[1].includes('500 g'),
      JSON.stringify(totals));
    const note = page.locator('[data-testid="approval-pending-note"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="quote-status"]'), null, { timeout: 15000 });
    // The role loads after the page (until then the safe cashier text is shown): wait for it for the owner
    if (who === 'owner') {
      await page.waitForFunction(() => document.querySelector('[data-testid="approval-role-note"]')?.textContent?.includes('You can approve'),
        null, { timeout: 15000 }).catch(() => undefined);
    }
    const roleNote = await page.locator('[data-testid="approval-role-note"]').innerText();
    const button = who === 'owner'
      ? page.locator('button:has-text("Approve & complete sale (₹125.00)")')
      : page.locator('button:has-text("Complete Sale (₹125.00 · not final · needs approval)")');
    const facts = { notes: await note.count(), noteHas142: (await note.innerText()).includes('₹142.00'), buttons: await button.count(),
      disabled: (await button.count()) ? await button.first().isDisabled() : null, roleNote: roleNote.slice(0, 30),
      lines: await page.$$eval('[data-testid="cart-line"]', (ls) => ls.map((l) => l.getAttribute('data-line-state'))),
      blocked: await page.locator('[data-testid="quote-blocked"]').count(),
      quote: await page.locator('[data-testid="bill-total"]').evaluate((el) => [el.dataset.quoteStatus, el.dataset.quoteLines, el.dataset.cartLines]),
      errors: await page.locator('[data-testid="cart-line-error"]').allInnerTexts() };
    check(`${label} (${who}): total ₹125.00 labelled not final next to the catalogue ₹142.00, role-specific action`, facts.notes === 1
      && facts.noteHas142 && facts.buttons >= 1
      && (who === 'owner' ? roleNote.includes('You can approve') && facts.disabled === false
                          : roleNote.includes('A cashier cannot apply') && facts.disabled === true), JSON.stringify(facts));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label} (${who}): no horizontal page overflow`, overflow <= 1, `overflow ${overflow}px`);
    await note.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SP}/voice_cart_${label}.png`, fullPage: false });

    if (who === 'owner') {
      await button.first().click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="cart-line"]'), null, { timeout: 30000 });
      await page.waitForTimeout(800);
      const sent = Object.fromEntries((saleBodies[0]?.items || []).map((i) => [i.product_id, [i.quantity, i.requested_line_total]]));
      check(`${label} (${who}): the requests are sent for approval (not as catalogue prices)`, JSON.stringify(sent[tea.id]) === JSON.stringify([3, 100])
        && JSON.stringify(sent[sugar.id]) === JSON.stringify([0.5, 25]), JSON.stringify(sent));
      check('desktop (owner): owner approval saves ₹125.00, audited twice', saleResponses[0]?.status === 201 && saleResponses[0]?.body.total_amount === 125
        && (await overrides()) === 2, JSON.stringify(saleResponses[0]));
      expected = { tea: expected.tea - 3, sugar: Math.round((expected.sugar - 0.5) * 1000) / 1000 };
    } else {
      // The cashier cannot send a requested price at all (the server would refuse it with 403 too)
      await button.first().click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(600);
      check('phone (cashier): no approval action: nothing sent, nothing saved, bill kept', saleBodies.length === 0
        && (await page.locator('[data-testid="cart-line"]').count()) === 2 && (await overrides()) === 2 && (await stock(tea)) === expected.tea);
      await page.screenshot({ path: `${SP}/voice_refused_${label}.png`, fullPage: false });
      // Manager review is not available on the counter: the cashier sells at catalogue prices instead
      for (let i = 0; i < 2; i++) await page.locator('button:has-text("Use catalogue price")').first().click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="quote-status"]'), null, { timeout: 15000 });
      check('phone (cashier): catalogue prices restore a normal bill of ₹142.00', (await page.locator('[data-testid="approval-pending-note"]').count()) === 0
        && (await page.locator('button:has-text("Complete Sale (₹142.00)")').count()) === 1);
      await page.locator('button:has-text("Complete Sale (₹142.00)")').first().click();
      await page.waitForFunction(() => document.body.innerText.includes('142'), null, { timeout: 30000 });
      await page.waitForTimeout(800);
      const last = saleResponses[saleResponses.length - 1];
      check('phone (cashier): sale saved at the catalogue total, no new override', last?.status === 201 && last.body.total_amount === 142
        && (await overrides()) === 2, JSON.stringify(last));
      expected = { tea: expected.tea - 3, sugar: Math.round((expected.sugar - 0.5) * 1000) / 1000 };
    }
    const got = { tea: await stock(tea), sugar: await stock(sugar) };
    check(`${label} (${who}): stock reduced once (tea -3, sugar -0.5 kg)`, JSON.stringify(got) === JSON.stringify(expected), JSON.stringify(got));
    await page.close();
  }
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
