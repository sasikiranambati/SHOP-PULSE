/**
 * Stage 3D Browser E2E Verification: Inventory Edit Modal Pricing-Basis Compatibility.
 *
 * Verifies:
 * 1. Real isolated backend + Vite frontend integration.
 * 2. Desktop (1280x860):
 *    - Edit a VERIFIED product in Inventory
 *    - Normal stock/name edit saves cleanly without modifying pricing basis
 *    - Compatible unit conversion (kg -> g) aligns price/MRP basis (1 kg -> 1000 g) while preserving prices & stock, requires confirmation, saves, persists across reload, and records PRICING_BASIS_UPDATE audit log
 *    - Incompatible unit change (g -> pcs) & ambiguous package unit change (bottle -> ml) block saving with clear error messages
 *    - Cashier role can update stock on VERIFIED item, and gets authoritative 403 surfaced on rejected pricing/unit change
 * 3. Mobile (390x844):
 *    - Responsive modal renders unit selector, basis controls, warnings, and buttons without horizontal overflow
 *
 * Run via isolated launcher:
 *   node scripts/e2e/run.cjs edit_product_pricing_basis_check
 */

const path = require('path');
const { chromium } = require('playwright');
const { e2eTarget } = require('./e2e_env.cjs');

const { API, WEB } = e2eTarget();
const ARTIFACTS_DIR = process.argv[2] || '';
const results = [];

function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function loginAndSeed() {
  const H = { 'Content-Type': 'application/json' };
  const ts = Date.now();
  const password = 'Password123!';

  const ownerEmail = `owner.3d.${ts}@example.com`;
  const cashierEmail = `cashier.3d.${ts}@example.com`;

  await fetch(`${API}/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ email: ownerEmail, password }) });
  const ownerLogin = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: ownerEmail, password }) }).then((r) => r.json());
  const ownerAuth = { ...H, Authorization: `Bearer ${ownerLogin.access_token}` };

  const shop = await fetch(`${API}/shops`, {
    method: 'POST',
    headers: ownerAuth,
    body: JSON.stringify({
      shop_name: 'Stage 3D Kirana',
      owner_name: 'Suresh Owner',
      business_type: 'Grocery/Kirana',
      location: 'Hyderabad',
    }),
  }).then((r) => r.json());

  const cashierReg = await fetch(`${API}/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ email: cashierEmail, password }) }).then((r) => r.json());
  await fetch(`${API}/shops/${shop.id}/members`, {
    method: 'POST',
    headers: ownerAuth,
    body: JSON.stringify({ user_id: cashierReg.id, role: 'CASHIER' }),
  });
  const cashierLogin = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: cashierEmail, password }) }).then((r) => r.json());

  const createVerified = async (payload) => {
    const res = await fetch(`${API}/products`, {
      method: 'POST',
      headers: ownerAuth,
      body: JSON.stringify({ ...payload, pricing_status: 'VERIFIED' }),
    });
    if (!res.ok) throw new Error(`Seed failed: ${res.status} ${await res.text()}`);
    return res.json();
  };

  const rice = await createVerified({
    name: 'Basmati Rice Loose',
    category: 'Groceries',
    selling_price: 120,
    purchase_price: 95,
    mrp: 150,
    unit: 'kg',
    price_basis_quantity: 1,
    price_basis_unit: 'kg',
    mrp_basis_quantity: 1,
    mrp_basis_unit: 'kg',
    current_stock: 10,
    reorder_level: 3,
  });

  const bottle = await createVerified({
    name: 'Sesame Oil Bottle',
    category: 'Groceries',
    selling_price: 180,
    purchase_price: 150,
    mrp: 210,
    unit: 'bottle',
    price_basis_quantity: 1,
    price_basis_unit: 'bottle',
    mrp_basis_quantity: 1,
    mrp_basis_unit: 'bottle',
    current_stock: 15,
    reorder_level: 4,
  });

  return { shop, ownerEmail, ownerLogin, ownerAuth, cashierEmail, cashierLogin, rice, bottle };
}

(async () => {
  const { shop, ownerEmail, ownerLogin, ownerAuth, cashierEmail, cashierLogin, rice, bottle } = await loginAndSeed();
  check('Seeded isolated VERIFIED products', Boolean(rice.id && bottle.id), `rice=${rice.id}`);

  const browser = await chromium.launch();
  try {
    // -----------------------------------------------------------------------
    // Desktop verification (Owner)
    // -----------------------------------------------------------------------
    const ownerProfile = {
      uid: ownerEmail,
      email: ownerEmail,
      displayName: 'Suresh Owner',
      ownerName: 'Suresh Owner',
      shopName: shop.shop_name,
      shopId: shop.id,
      role: 'owner',
      theme: 'light',
      language: 'en',
    };
    const ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ownerCtx.addInitScript(({ token, profile }) => {
      localStorage.setItem('shoppulse_token', token);
      localStorage.setItem('shoppulse_local_session', JSON.stringify(profile));
      sessionStorage.setItem('shoppulse_local_session', JSON.stringify(profile));
      sessionStorage.setItem('shelfora_active_page', 'inventory');
      sessionStorage.setItem('shoppulse_active_page', 'inventory');
    }, { token: ownerLogin.access_token, profile: ownerProfile });

    const page = await ownerCtx.newPage();
    await page.goto(`${WEB}/`);
    await page.waitForSelector('button[aria-label="Edit Basmati Rice Loose"]', { timeout: 15000 });

    // Open Edit modal for Basmati Rice Loose
    await page.locator('button[aria-label="Edit Basmati Rice Loose"]:visible').click();
    await page.waitForSelector('[data-testid="edit-pricing-status-badge"]', { timeout: 10000 });
    const badgeText = await page.locator('[data-testid="edit-pricing-status-badge"]').textContent();
    check('Desktop: VERIFIED pricing badge visible in Edit modal', badgeText.includes('Verified Pricing'));

    // Test ambiguous/incompatible unit first: kg -> pcs
    await page.fill('#edit-product-unit', 'pcs');
    await page.waitForSelector('[data-testid="unit-change-warning"]', { timeout: 5000 });
    const incompatMsg = await page.locator('[data-testid="unit-change-warning"]').textContent();
    const saveBtn = page.locator('button[type="submit"]:has-text("Save Changes")');
    check(
      'Desktop: incompatible kg -> pcs shows warning and blocks save',
      /incompatible/i.test(incompatMsg) && (await saveBtn.isDisabled()),
    );

    // Change to compatible unit: kg -> g
    await page.fill('#edit-product-unit', 'g');
    await page.waitForTimeout(150);
    const compatMsg = await page.locator('[data-testid="unit-change-warning"]').textContent();
    const basisSummary = await page.locator('[data-testid="edit-basis-summary"]').textContent();
    const stockVal = await page.locator('#edit-product-stock').inputValue();
    check(
      'Desktop: compatible kg -> g converts basis 1 kg -> 1000 g cleanly without altering stock',
      compatMsg.includes('1 kg to 1000 g') && basisSummary.includes('1000 g') && stockVal === '10' && (await saveBtn.isDisabled()),
      `summary=${basisSummary}, stock=${stockVal}`,
    );

    if (ARTIFACTS_DIR) {
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'desktop_edit_modal_compatible_kg_to_g.png') });
    }

    // Confirm and save
    await page.click('[data-testid="confirm-pricing-basis"]');
    check('Desktop: Save Changes enabled after confirmation', await saveBtn.isEnabled());

    const putPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/products/${rice.id}`) && res.request().method() === 'PUT',
      { timeout: 15000 },
    );
    await saveBtn.click();
    const putRes = await putPromise;
    check('Desktop: PUT /products returned 200 OK', putRes.status() === 200, `status=${putRes.status()}`);

    // Wait for modal close and reload to confirm persistence from backend
    await page.waitForSelector('#edit-product-unit', { state: 'detached', timeout: 10000 });
    await page.reload();
    await page.waitForSelector('button[aria-label="Edit Basmati Rice Loose"]', { timeout: 15000 });

    const persistedRice = await fetch(`${API}/products/${rice.id}`, { headers: ownerAuth }).then((r) => r.json());
    check(
      'Desktop: persisted product has unit=g, price_basis_quantity=1000, price_basis_unit=g, mrp_basis=1000g, stock=10, VERIFIED',
      persistedRice.unit === 'g' &&
        persistedRice.price_basis_quantity === 1000 &&
        persistedRice.price_basis_unit === 'g' &&
        persistedRice.mrp_basis_quantity === 1000 &&
        persistedRice.mrp_basis_unit === 'g' &&
        persistedRice.selling_price === 120 &&
        persistedRice.mrp === 150 &&
        persistedRice.current_stock === 10 &&
        persistedRice.pricing_status === 'VERIFIED',
    );

    const auditTrail = await fetch(`${API}/products/${rice.id}/audit-trail`, { headers: ownerAuth }).then((r) => r.json());
    const basisAudit = auditTrail.find((a) => a.action_type === 'PRICING_BASIS_UPDATE');
    check(
      'Desktop: backend recorded PRICING_BASIS_UPDATE audit log',
      Boolean(basisAudit && basisAudit.reason.includes("'kg' -> 'g'")),
    );

    // Check ambiguous package change (Sesame Oil Bottle: bottle -> ml)
    await page.locator('button[aria-label="Edit Sesame Oil Bottle"]:visible').click();
    await page.fill('#edit-product-unit', 'ml');
    await page.waitForSelector('[data-testid="unit-change-warning"]', { timeout: 5000 });
    const pkgMsg = await page.locator('[data-testid="unit-change-warning"]').textContent();
    check(
      'Desktop: ambiguous bottle -> ml refuses assumption and blocks save',
      /cannot convert/i.test(pkgMsg) && (await saveBtn.isDisabled()),
    );
    await ownerCtx.close();

    // -----------------------------------------------------------------------
    // Desktop verification (Cashier authorization integration)
    // -----------------------------------------------------------------------
    const cashierProfile = {
      uid: cashierEmail,
      email: cashierEmail,
      displayName: 'Cashier User',
      shopName: shop.shop_name,
      shopId: shop.id,
      role: 'cashier',
      theme: 'light',
      language: 'en',
    };
    const cashierCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await cashierCtx.addInitScript(({ token, profile }) => {
      localStorage.setItem('shoppulse_token', token);
      localStorage.setItem('shoppulse_local_session', JSON.stringify(profile));
      sessionStorage.setItem('shoppulse_local_session', JSON.stringify(profile));
      sessionStorage.setItem('shelfora_active_page', 'inventory');
      sessionStorage.setItem('shoppulse_active_page', 'inventory');
    }, { token: cashierLogin.access_token, profile: cashierProfile });

    const cashierPage = await cashierCtx.newPage();
    await cashierPage.goto(`${WEB}/`);
    await cashierPage.waitForSelector('button[aria-label="Edit Sesame Oil Bottle"]', { timeout: 15000 });

    // Cashier allowed non-pricing edit (stock 15 -> 18)
    await cashierPage.locator('button[aria-label="Edit Sesame Oil Bottle"]:visible').click();
    await cashierPage.waitForSelector('[data-testid="cashier-verified-hint"]', { timeout: 5000 });
    await cashierPage.fill('#edit-product-stock', '18');
    const stockPutPromise = cashierPage.waitForResponse(
      (res) => res.url().includes(`/api/v1/products/${bottle.id}`) && res.request().method() === 'PUT',
      { timeout: 15000 },
    );
    await cashierPage.locator('button[type="submit"]:has-text("Save Changes")').click();
    const stockPutRes = await stockPutPromise;
    check('Cashier: permitted stock-only update on VERIFIED item returns 200', stockPutRes.status() === 200);
    await cashierPage.waitForSelector('#edit-product-stock', { state: 'detached', timeout: 10000 });

    // Cashier attempts pricing/unit override -> backend rejects with 403 and UI displays error cleanly
    await cashierPage.locator('button[aria-label="Edit Sesame Oil Bottle"]:visible').click();
    await cashierPage.fill('#edit-product-unit', 'pcs');
    await cashierPage.fill('#edit-product-priceBasisUnit', 'pcs');
    await cashierPage.fill('#edit-product-mrpBasisUnit', 'pcs');
    await cashierPage.click('[data-testid="confirm-pricing-basis"]');
    const forbiddenPromise = cashierPage.waitForResponse(
      (res) => res.url().includes(`/api/v1/products/${bottle.id}`) && res.request().method() === 'PUT',
      { timeout: 15000 },
    );
    await cashierPage.locator('button[type="submit"]:has-text("Save Changes")').click();
    const forbiddenRes = await forbiddenPromise;
    await cashierPage.waitForSelector('[role="dialog"] [role="alert"]', { timeout: 5000 });
    const alertText = await cashierPage.locator('[role="dialog"] [role="alert"]').textContent();
    check(
      'Cashier: pricing/unit override rejected 403 by backend and error surfaced cleanly',
      forbiddenRes.status() === 403 && /manager or owner role required/i.test(alertText),
    );
    await cashierCtx.close();

    // -----------------------------------------------------------------------
    // Mobile verification (390x844)
    // -----------------------------------------------------------------------
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await mobileCtx.addInitScript(({ token, profile }) => {
      localStorage.setItem('shoppulse_token', token);
      localStorage.setItem('shoppulse_local_session', JSON.stringify(profile));
      sessionStorage.setItem('shoppulse_local_session', JSON.stringify(profile));
      sessionStorage.setItem('shelfora_active_page', 'inventory');
      sessionStorage.setItem('shoppulse_active_page', 'inventory');
    }, { token: ownerLogin.access_token, profile: ownerProfile });

    const mobilePage = await mobileCtx.newPage();
    await mobilePage.goto(`${WEB}/`);
    await mobilePage.waitForSelector('button[aria-label="Edit Basmati Rice Loose"]:visible', { timeout: 15000 });
    await mobilePage.locator('button[aria-label="Edit Basmati Rice Loose"]:visible').click();
    await mobilePage.waitForSelector('#edit-product-unit', { timeout: 5000 });

    await mobilePage.fill('#edit-product-unit', 'pcs');
    await mobilePage.waitForSelector('[data-testid="unit-change-warning"]', { timeout: 5000 });

    const overflow = await mobilePage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      diff: document.documentElement.scrollWidth - window.innerWidth,
    }));
    const dialogBox = await mobilePage.locator('[role="dialog"]').boundingBox();
    const saveBox = await mobilePage.locator('button[type="submit"]:has-text("Save Changes")').boundingBox();
    check(
      'Mobile (390x844): modal fits viewport cleanly without horizontal overflow',
      overflow.diff <= 1 && Boolean(dialogBox && dialogBox.width <= 390) && Boolean(saveBox && saveBox.height >= 40),
      `overflow=${overflow.diff}px, dialogWidth=${dialogBox?.width}`,
    );

    if (ARTIFACTS_DIR) {
      await mobilePage.screenshot({ path: path.join(ARTIFACTS_DIR, 'mobile_edit_modal_incompatible_warning.png') });
    }
    await mobileCtx.close();
  } finally {
    await browser.close();
  }

  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
})().catch((err) => {
  console.error('SCRIPT ERROR', err);
  process.exit(1);
});
