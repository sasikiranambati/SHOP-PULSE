/**
 * Browser check (Voice-to-Bill & POS final UX + security resilience):
 * 1. Verifies zero horizontal overflow across 1920x1080, 1366x768, 768x1024, 390x844, and 320x568
 *    in the full Shelfora web app (Sales POS + Voice-to-Bill modal).
 * 2. Verifies removal of outdated "12 Languages" / "बोलकर बिल बनाएं" claims.
 * 3. Verifies mocked Web Speech API double-tap session lock + homophone ("To Maggie") extraction.
 * 4. Verifies 401 session expiration during checkout preserves the active POS cart/customer/payment
 *    across redirect to Login and restores the bill upon re-authentication to complete checkout.
 *
 * Run through the isolated test launcher:
 *   node scripts/e2e/run.cjs voice_pos_401_and_responsive_check
 */
const { chromium } = require('playwright');
const fs = require('fs');
const SP = process.argv[2] || '.';
const { API, WEB } = require('./e2e_env.cjs').e2eTarget();

const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
};

(async () => {
  fs.mkdirSync(SP, { recursive: true });
  const H = { 'Content-Type': 'application/json' };
  const email = `voice-401-${Date.now()}@example.com`;
  const password = 'password123';

  await fetch(`${API}/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ email, password }) });
  const { access_token: tok } = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  const auth = { ...H, Authorization: `Bearer ${tok}` };

  await fetch(`${API}/shops`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      shop_name: 'E2E Voice Kirana',
      owner_name: 'Kiran Owner',
      business_type: 'Grocery/Kirana',
      location: 'Hyderabad',
    }),
  });

  const mk = (name, unit, stock, price) =>
    fetch(`${API}/products`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name,
        unit,
        current_stock: stock,
        selling_price: price,
        purchase_price: price,
        pricing_status: 'VERIFIED',
      }),
    }).then((r) => r.json());

  const rice = await mk('Basmati Rice', 'kg', 20, 80);
  const maggi = await mk('Maggi Noodles', 'packet', 40, 14);
  const stockOf = async (p) => (await fetch(`${API}/products/${p.id}`, { headers: auth }).then((r) => r.json())).current_stock;

  const browser = await chromium.launch();

  // ---------------------------------------------------------------------------
  // Part 1: Full 5-Viewport Responsive Check + Mocked SpeechRecognition Race Test
  // ---------------------------------------------------------------------------
  const viewports = [
    ['desktop_1920', 1920, 1080],
    ['laptop_1366', 1366, 768],
    ['tablet_768', 768, 1024],
    ['mobile_390', 390, 844],
    ['small_mobile_320', 320, 568],
  ];

  for (const [vpName, width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();

    // Seed verified session via API + install mocked Web Speech API for SpeechRecognition tests
    await page.addInitScript(() => {
      window.__speechConstructCount = 0;
      window.__speechInstances = [];
      class MockSpeechRecognition {
        constructor() {
          window.__speechConstructCount += 1;
          window.__speechInstances.push(this);
          this.lang = '';
          this.interimResults = false;
          this.maxAlternatives = 1;
          this.continuous = false;
        }
        start() {
          // Delay onstart slightly to simulate real browser STT startup window for double-tap race testing
          setTimeout(() => {
            if (!this._aborted && typeof this.onstart === 'function') {
              this.onstart();
            }
          }, 80);
        }
        abort() {
          this._aborted = true;
        }
        stop() {
          if (typeof this.onend === 'function') this.onend();
        }
      }
      window.webkitSpeechRecognition = MockSpeechRecognition;
      window.SpeechRecognition = MockSpeechRecognition;
    });

    await page.goto(WEB);
    const loginDirect = page.locator('button:has-text("Log in"), a:has-text("Log in"), button:has-text("Sign In")').first();
    if (await loginDirect.isVisible().catch(() => false)) {
      await loginDirect.click();
    } else {
      await page.locator('button[aria-label="Toggle navigation menu"]').click();
      await page.locator('button:has-text("Log In to Existing Store")').click();
    }

    // Log in through the real Login form
    await page.locator('#login-identifier').waitFor({ timeout: 20000 });
    await page.fill('#login-identifier', email);
    await page.fill('#login-password', password);
    await page.click('button[type="submit"]');

    // Navigate to Sales / POS (wait for visible desktop sidebar button or mobile BottomNav button)
    const salesNav = page.locator('nav[aria-label="Bottom mobile navigation"] button:visible, nav[aria-label="Main menu"] button:visible').filter({ hasText: /Sales/i }).first();
    await salesNav.waitFor({ timeout: 20000 });
    await salesNav.click();
    await page.locator('button[aria-label="Open Voice-to-Bill"]').first().waitFor({ timeout: 20000 });

    const salesText = await page.locator('body').innerText();
    const salesHtml = await page.content();
    check(
      `${vpName}: Sales POS removes outdated 12-language claims`,
      !salesText.includes('12 Languages') && !salesHtml.includes('बोलकर बिल बनाएं') && !salesText.includes('12 Indian'),
    );

    const salesOverflowInfo = await page.evaluate(() => {
      const iw = window.innerWidth;
      const offenders = [];
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > iw + 1) {
          offenders.push(`${el.tagName}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
        }
      }
      return { overflow: document.documentElement.scrollWidth - iw, offenders: offenders.slice(0, 5) };
    });
    check(
      `${vpName}: Sales POS has zero horizontal overflow (${salesOverflowInfo.overflow}px)`,
      salesOverflowInfo.overflow <= 1,
      salesOverflowInfo.offenders.join(' | '),
    );

    // Open Voice-to-Bill modal
    await page.locator('button[aria-label="Open Voice-to-Bill"]').first().click();
    await page.locator('#voice-to-bill-title').waitFor({ timeout: 15000 });

    const modalText = await page.locator('[role="dialog"]').innerText();
    check(
      `${vpName}: Voice modal is English-only without language selectors`,
      modalText.includes('English Only') && (await page.locator('[role="dialog"] select').count()) === 0,
    );

    if (vpName === 'small_mobile_320' || vpName === 'desktop_1920') {
      // Test SpeechRecognition double-tap guard + homophone "To Maggie" resolution
      const micBtn = page.locator('button[aria-label="Voice-to-Bill primary action button"]');
      await micBtn.dblclick();
      await page.waitForTimeout(150);
      const createdCount = await page.evaluate(() => window.__speechConstructCount);
      check(`${vpName}: rapid double-tap starts only 1 SpeechRecognition session`, createdCount === 1, `count=${createdCount}`);

      // Emit final speech event with homophone "To Maggie" + STT alternatives
      await page.evaluate(() => {
        const inst = window.__speechInstances[window.__speechInstances.length - 1];
        const alt0 = { transcript: 'To Maggie', confidence: 0.78 };
        const alt1 = { transcript: 'Two Maggie', confidence: 0.75 };
        const res = {
          isFinal: true,
          length: 2,
          0: alt0,
          1: alt1,
        };
        if (inst && typeof inst.onresult === 'function') {
          inst.onresult({ resultIndex: 0, results: [res] });
        }
      });

      // Stop and process right away
      await micBtn.click();
      await page.waitForSelector('input[aria-label="Line total for Maggi Noodles"]', { timeout: 15000 });
      check(
        `${vpName}: mocked SpeechRecognition resolves "To Maggie" -> 2 × Maggi`,
        (await page.locator('input[aria-label="Line total for Maggi Noodles"]').inputValue()) === '28',
      );
    } else {
      // Simulate input cleanly on remaining viewports
      await page.fill('input[placeholder*="voice sentence"]', '2 kg Basmati Rice');
      await page.click('button:has-text("Simulate")');
      await page.waitForSelector('input[aria-label="Line total for Basmati Rice"]', { timeout: 15000 });
    }

    const modalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${vpName}: Voice modal has zero horizontal overflow (${modalOverflow}px)`, modalOverflow <= 1);
    if (vpName === 'small_mobile_320') {
      await page.screenshot({ path: `${SP}/voice_modal_320x568.png`, fullPage: false });
    }

    // Add to Bill and check Sales overflow with populated cart
    await page.click('button:has-text("Add to Bill")');
    await page.waitForSelector('[data-testid="cart-line"]', { timeout: 15000 });
    const postCartOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${vpName}: Sales POS with cart items has zero horizontal overflow (${postCartOverflow}px)`, postCartOverflow <= 1);
    if (vpName === 'small_mobile_320') {
      await page.screenshot({ path: `${SP}/sales_pos_320x568.png`, fullPage: false });
    }

    await context.close();
  }

  // ---------------------------------------------------------------------------
  // Part 2: 401 Session-Expiration POS Cart Preservation & Re-Login Recovery
  // ---------------------------------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();

    await page.goto(WEB);
    await page.locator('button:has-text("Log in"), a:has-text("Log in"), button:has-text("Sign In")').first().click().catch(() => {});
    await page.locator('#login-identifier').waitFor({ timeout: 20000 });
    await page.fill('#login-identifier', email);
    await page.fill('#login-password', password);
    await page.click('button[type="submit"]');

    const salesNav = page.locator('nav button:has-text("Sales"), aside button:has-text("Sales")').first();
    await salesNav.waitFor({ timeout: 20000 });
    await salesNav.click();
    await page.locator('button[aria-label="Open Voice-to-Bill"]').first().waitFor({ timeout: 15000 });

    // Add 2 kg Basmati Rice via Voice-to-Bill
    await page.locator('button[aria-label="Open Voice-to-Bill"]').first().click();
    await page.fill('input[placeholder*="voice sentence"]', '2 kg Basmati Rice');
    await page.click('button:has-text("Simulate")');
    await page.waitForSelector('input[aria-label="Line total for Basmati Rice"]', { timeout: 15000 });
    await page.click('button:has-text("Add to Bill")');
    await page.waitForSelector('[data-testid="cart-line"]', { timeout: 15000 });

    await page.fill('input[placeholder="Customer name (optional)"]', 'Sita Devi');
    await page.click('button:has-text("UPI")');

    // Expire token cleanly right before clicking Complete Sale
    await page.evaluate(() => localStorage.setItem('shoppulse_token', 'expired.jwt.token'));
    await page.locator('button:has-text("Complete Sale")').first().click();

    // App redirects to Login and displays the preserved-draft notice
    await page.locator('#session-expired-notice').waitFor({ timeout: 15000 });
    const expiredNotice = await page.locator('#session-expired-notice').innerText();
    check(
      '401 expiry redirects to Login with preserved POS draft notice',
      expiredNotice.includes('session expired') && expiredNotice.includes('saved'),
      expiredNotice,
    );
    check('401 expiry leaves backend rice stock untouched (20 kg)', (await stockOf(rice)) === 20);

    // Re-authenticate on Login page -> returns to Sales with exact draft intact
    await page.fill('#login-identifier', email);
    await page.fill('#login-password', password);
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="restored-pos-draft-banner"]', { timeout: 15000 }).catch(async (err) => {
      const snap = await page.evaluate(() => ({
        h1: document.querySelector('h1')?.textContent,
        page: sessionStorage.getItem('shelfora_active_page'),
        draft: sessionStorage.getItem('shoppulse_pos_draft_v1'),
        exp: sessionStorage.getItem('shoppulse_session_expired_v1'),
        body: document.body.innerText.slice(0, 300),
      }));
      console.log('DIAG 401 RECOVER:', JSON.stringify(snap));
      throw err;
    });
    const restoredLine = await page.locator('[data-testid="cart-line"]').first().innerText();
    const restoredCust = await page.locator('input[placeholder="Customer name (optional)"]').inputValue();
    check(
      'Re-login restores Sales POS with Basmati Rice draft, customer name, and total ₹160.00',
      restoredLine.includes('Basmati Rice') && restoredLine.includes('₹160.00') && restoredCust === 'Sita Devi',
    );
    await page.screenshot({ path: `${SP}/pos_401_restored_draft.png`, fullPage: false });

    // Complete Sale now succeeds cleanly and deducts 2 kg
    await page.locator('button:has-text("Complete Sale (₹160.00)")').first().click();
    await page.locator('button:has-text("View & Print Receipt")').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    check('Restored cart completes sale (₹160.00) and deducts 2 kg stock', (await stockOf(rice)) === 18);

    await context.close();
  }

  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
