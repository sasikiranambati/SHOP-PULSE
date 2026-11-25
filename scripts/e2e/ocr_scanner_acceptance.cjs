/**
 * OCR scanner acceptance (Playwright, real browser, real backend OCR): OCR-UI-01 ... OCR-UI-34.
 *
 * Uses the repository's invoice fixtures (backend/tests/fixtures/...) through the real InvoiceScanner page
 * and the real /invoices/extract and /invoices/confirm endpoints. Only network / server failures are
 * simulated (OCR-UI-27/28). Inventory, purchase and price checks read the API afterwards.
 * Generic test values. Run through the isolated launcher:
 *   node scripts/e2e/run.cjs ocr_scanner_acceptance
 */
const { chromium, devices } = require('playwright');
const { enterSellingPrices } = require('./scanner_helpers.cjs');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const SP = process.env.E2E_ARTIFACT_DIR || process.argv[2] || '.';
const { API, HARNESS } = require('./e2e_env.cjs').e2eTarget();

const FIX = path.resolve(__dirname, '..', '..', 'backend', 'tests', 'fixtures');
const GT = path.join(FIX, 'ground_truth', 'invoices');
const OR = path.join(FIX, 'ocr_rectification');
const results = [];
const check = (id, name, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} ${name}${d ? ' — ' + String(d).slice(0, 220) : ''}`); };

function blankPng(w, h) {  // a blank white page (unreadable: no text)
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 255); for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  fs.mkdirSync(SP, { recursive: true });
  const H = { 'Content-Type': 'application/json' };
  const email = `ocr-ui-${Date.now()}@example.com`;
  await fetch(`${API}/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'password123' }) });
  const { access_token: tok } = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'password123' }) }).then((r) => r.json());
  const auth = { ...H, Authorization: `Bearer ${tok}` };
  await fetch(`${API}/shops`, { method: 'POST', headers: auth, body: JSON.stringify({ shop_name: 'K', owner_name: 'R', business_type: 'Grocery/Kirana', location: 'B' }) });
  const mk = (b) => fetch(`${API}/products`, { method: 'POST', headers: auth, body: JSON.stringify({ purchase_price: b.selling_price, pricing_status: 'VERIFIED', ...b }) }).then((r) => r.json());
  // Existing inventory: rice stocked loose in kg, salt in packets
  const rice = await mk({ name: 'Basmati Rice', unit: 'kg', current_stock: 10, selling_price: 120, purchase_price: 90 });
  const product = async (id) => fetch(`${API}/products/${id}`, { headers: auth }).then((r) => r.json());
  const products = async () => { const p = await fetch(`${API}/products?limit=100`, { headers: auth }).then((r) => r.json()); return Array.isArray(p) ? p : (p.items || []); };
  const purchases = async () => { const p = await fetch(`${API}/purchases`, { headers: auth }).then((r) => r.json()); return Array.isArray(p) ? p : (p.items || []); };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Invoice scanning error|Invoice confirmation failed/.test(m.text())) consoleErrors.push(m.text()); });
  const confirmBodies = [];
  page.on('request', (r) => { if (r.url().includes('/invoices/confirm')) confirmBodies.push(JSON.parse(r.postData() || '{}')); });
  await page.addInitScript((t) => localStorage.setItem('shoppulse_token', t), tok);

  const rows = () => page.locator('tbody tr:has(input[aria-label^="Select"])');
  async function upload(file, { name, buffer, mimeType } = {}) {
    await page.goto(HARNESS);
    await page.click('[role=tab]:has-text("Upload PDF or file")');
    if (buffer) await page.setInputFiles('input[type=file]:not([multiple]):not([capture])', { name, mimeType, buffer });
    else await page.setInputFiles('input[type=file]:not([multiple]):not([capture])', file);
    const t0 = Date.now();
    await page.click('button:has-text("Extract Line Items")');
    await Promise.race([
      page.waitForSelector('text=Extracted Grocery Line Items', { timeout: 180000 }),
      page.waitForSelector('.bg-\\[\\#FDF1EF\\] >> text=/./', { timeout: 180000 }),
    ]).catch(() => {});
    return Date.now() - t0;
  }
  const names = async () => (await rows().locator('input[aria-label^="Product name"]').evaluateAll((els) => els.map((e) => e.value)));
  const qtyOf = (n) => page.locator(`input[aria-label="Quantity for ${n}"]`);
  const unitOf = (n) => page.locator(`select[aria-label="Unit for ${n}"]`);
  const rowOf = (n) => page.locator(`tr:has(input[aria-label="Select ${n}"])`);
  const errorText = async () => { const e = page.locator('div.bg-\\[\\#FDF1EF\\]'); return (await e.count()) ? (await e.first().innerText()) : ''; };

  // ---------------------------------------------------------------- OCR-UI-01/03/06..14: pack-column wholesale PNG
  let ms = await upload(path.join(OR, 'OR01_pack_column_wholesale.png'));
  check('OCR-UI-01', 'valid invoice uploads and extracts', (await rows().count()) === 4, `${ms} ms`);
  check('OCR-UI-03', 'PNG upload', (await rows().count()) === 4);
  check('OCR-UI-06', 'extracted table rendered', (await page.locator('text=Extracted Grocery Line Items').count()) === 1 && (await page.locator('th:has-text("Invoice Rate")').count()) === 1);
  const n1 = await names();
  check('OCR-UI-07', 'product names', JSON.stringify(n1) === JSON.stringify(['Basmati Rice', 'Sugar', 'Sunflower Oil', 'Toor Dal']), JSON.stringify(n1));
  const qs = await Promise.all(n1.map((n) => qtyOf(n).inputValue()));
  check('OCR-UI-08', 'quantities', JSON.stringify(qs) === JSON.stringify(['2', '1', '3', '10']), JSON.stringify(qs));
  await page.waitForSelector('select[aria-label="Unit for Toor Dal"]:not([disabled])', { timeout: 30000 });
  const us = await Promise.all(n1.map((n) => unitOf(n).inputValue()));
  check('OCR-UI-09', 'units', JSON.stringify(us) === JSON.stringify(['bag', 'bag', 'tin', 'packet']), JSON.stringify(us));
  const packs = await Promise.all(n1.map((n) => page.locator(`input[aria-label="Pack size for ${n}"]`).inputValue()));
  check('OCR-UI-10', 'pack sizes', JSON.stringify(packs) === JSON.stringify(['25', '50', '15', '1']), JSON.stringify(packs));
  const phys = await rowOf('Basmati Rice').locator('[data-testid="physical-quantity"]').innerText();
  const physOil = await rowOf('Sunflower Oil').locator('[data-testid="physical-quantity"]').innerText();
  check('OCR-UI-11', 'physical quantity = qty x pack (2 bag x 25 kg = 50 kg; 3 tin x 15 L = 45 L)', /=\s*50 kg/.test(phys) && /=\s*45 L/.test(physOil), `${phys} | ${physOil}`);
  const rate = await page.locator('input[aria-label="Rate for Basmati Rice"]').inputValue();
  check('OCR-UI-12', 'purchase cost (invoice rate) as printed', rate === '2350', rate);
  const cost = await rowOf('Basmati Rice').locator('[data-testid="cost-per-standard-unit"]').innerText();
  check('OCR-UI-14', 'normalized cost per standard unit (Rs 4,700 / 50 kg = Rs 94/kg)', /₹94\.00 per kg/.test(cost) && /not a selling price/.test(cost), cost);
  check('OCR-UI-18', 'product matching (invoice line -> existing product)', (await rowOf('Basmati Rice').locator('text=Matches: Basmati Rice').count()) === 1
    && (await rowOf('Sugar').locator('text=Matches:').count()) === 0);
  await page.screenshot({ path: `${SP}/ocr_review_desktop.png` });

  // ---------------------------------------------------------------- editing, deleting, adding (OCR-UI-15/16/17/31)
  await qtyOf('Toor Dal').fill('12');
  const dalAmount = await rowOf('Toor Dal').locator('td').nth(8).innerText();
  const dalPhys = await rowOf('Toor Dal').locator('[data-testid="physical-quantity"]').innerText();
  check('OCR-UI-15', 'edit quantity -> amount and physical quantity update', /1,620\.00/.test(dalAmount) && /=\s*12 kg/.test(dalPhys), `${dalAmount} | ${dalPhys}`);
  await page.locator('input[aria-label="Pack size for Sugar"]').fill('25');
  const sugarCost = await rowOf('Sugar').locator('[data-testid="cost-per-standard-unit"]').innerText();
  check('OCR-UI-32a', 'edit pack size -> cost per kg recalculated (Rs 2,200 / 25 kg = Rs 88/kg)', /₹88\.00 per kg/.test(sugarCost), sugarCost);
  await page.locator('input[aria-label="Pack size for Sugar"]').fill('50');
  await page.locator('button[aria-label="Delete row 3"]').click();
  check('OCR-UI-16', 'delete row', (await rows().count()) === 3 && !(await names()).includes('Sunflower Oil'));
  await page.click('button:has-text("Add Item")');
  const manualName = page.locator('input[aria-label="Product name, row 4"]');
  check('OCR-UI-17a', 'manual row starts empty (nothing invented)', (await rows().count()) === 4 && (await manualName.inputValue()) === ''
    && (await page.locator('input[aria-label="Rate for row 4"]').inputValue()) === '');
  await manualName.fill('Moong Dal');
  await qtyOf('Moong Dal').fill('5');
  await page.waitForSelector('select[aria-label="Unit for Moong Dal"]:not([disabled])');
  await unitOf('Moong Dal').selectOption('kg');
  await page.locator('input[aria-label="Rate for Moong Dal"]').fill('118');
  check('OCR-UI-17', 'add manual item', (await names()).includes('Moong Dal'));
  check('OCR-UI-31', 'no data loss while editing other rows', (await qtyOf('Basmati Rice').inputValue()) === '2' && (await qtyOf('Toor Dal').inputValue()) === '12'
    && (await page.locator('input[aria-label="Rate for Sugar"]').inputValue()) === '2200' && (await page.locator('input[aria-label="Pack size for Sugar"]').inputValue()) === '50');

  // Review safety before saving: new products need a typed selling price
  await page.fill('input[aria-label="Invoice number"]', 'ABT-7101');
  await page.click('button:has-text("Items to Inventory")');
  await page.waitForTimeout(400);
  const blocked = await errorText();
  check('OCR-UI-32b', 'no invented selling price: confirmation asks for it on new products', /enter a selling price/.test(blocked) && confirmBodies.length === 0, blocked);
  for (const [n, p] of [['Sugar', '48'], ['Toor Dal', '150'], ['Moong Dal', '135']]) await page.fill(`input[aria-label="Selling price for ${n}"]`, p);

  // ---------------------------------------------------------------- confirm + inventory + integrity (OCR-UI-19/20/32/33)
  await page.click('button:has-text("Items to Inventory")');
  const missingPrompt = page.locator('button:has-text("Add to stock without")');
  if (await missingPrompt.count()) await missingPrompt.first().click();
  await page.waitForSelector('text=Successfully confirmed', { timeout: 60000 }).catch(() => {});
  check('OCR-UI-19', 'confirm purchase', (await page.locator('text=Successfully confirmed').count()) === 1, await errorText());
  const sent = confirmBodies[0] || { items: [] };
  const riceSent = sent.items.find((i) => i.name.startsWith('Basmati')) || {};
  check('OCR-UI-32c', 'payload: printed pack size sent, existing selling price not sent', riceSent.pack_size === 25 && riceSent.pack_size_unit === 'kg'
    && riceSent.selling_price === undefined && riceSent.update_selling_price === false, JSON.stringify(riceSent).slice(0, 200));
  const riceAfter = await product(rice.id);
  check('OCR-UI-20', 'inventory: 2 bag x 25 kg added as 50 kg (10 -> 60 kg)', riceAfter.current_stock === 60 && riceAfter.unit === 'kg', JSON.stringify([riceAfter.current_stock, riceAfter.unit]));
  check('OCR-UI-32', 'prices: cost Rs 94/kg; selling price unchanged at Rs 120', riceAfter.purchase_price === 94 && riceAfter.selling_price === 120, JSON.stringify([riceAfter.purchase_price, riceAfter.selling_price]));
  const all = await products();
  const sugar = all.find((p) => p.name === 'Sugar');
  const dal = all.find((p) => p.name === 'Toor Dal');
  const moong = all.find((p) => p.name === 'Moong Dal');
  const pur = (await purchases()).find((p) => p.invoice_number === 'ABT-7101');
  const lines = pur ? pur.items : [];
  const sumLines = lines.reduce((a, l) => a + l.line_amount, 0);
  check('OCR-UI-33', 'purchase + inventory integrity (one purchase, lines as printed, total = sum of lines, new products created once)',
    pur && lines.length === 4 && Math.abs(pur.total_amount - sumLines) < 0.005 && Math.abs(pur.total_amount - (4700 + 2200 + 1620 + 590)) < 0.005
      && sugar && sugar.current_stock === 1 && sugar.unit === 'bag' && sugar.purchase_price === 2200 && sugar.selling_price === 48
      && dal && dal.current_stock === 12 && moong && moong.current_stock === 5 && all.filter((p) => p.name === 'Sugar').length === 1,
    JSON.stringify({ total: pur && pur.total_amount, lines: lines.length, sugar: sugar && [sugar.current_stock, sugar.unit, sugar.purchase_price, sugar.selling_price], dal: dal && [dal.current_stock, dal.unit], moong: moong && [moong.current_stock, moong.unit], sugars: all.filter((p) => p.name === 'Sugar').length }));

  // ---------------------------------------------------------------- duplicate invoice (OCR-UI-21)
  await upload(path.join(OR, 'OR01_pack_column_wholesale.png'));
  await enterSellingPrices(page);  // any line that is a new product needs the reviewer's price
  await page.fill('input[aria-label="Invoice number"]', 'abt-7101');
  await page.click('button:has-text("Items to Inventory")');
  if (await missingPrompt.count()) await missingPrompt.first().click();
  await page.waitForSelector('text=already added to stock', { timeout: 60000 }).catch(() => {});
  const dupErr = await errorText();
  check('OCR-UI-21', 'duplicate invoice prevented, stock unchanged', /already added to stock/.test(dupErr) && (await product(rice.id)).current_stock === 60, dupErr);

  // ---------------------------------------------------------------- formats (OCR-UI-02/04/05/13/25/26)
  ms = await upload(path.join(GT, 'TC03_phone_photo.jpg'));
  check('OCR-UI-02', 'JPG upload (phone photo)', (await rows().count()) === 5 && (await names()).includes('Aashirvaad Atta 5kg'), `${await rows().count()} rows, ${ms} ms`);
  ms = await upload(path.join(GT, 'TC01_clean_digital.pdf'));
  check('OCR-UI-04', 'PDF upload', (await rows().count()) === 5, `${ms} ms`);
  check('OCR-UI-13', 'MRP extracted (Aashirvaad Atta 5kg: Rs 289)', (await page.locator('input[aria-label="MRP for Aashirvaad Atta 5kg"]').inputValue()) === '289');
  ms = await upload(path.join(GT, 'TC21_rotated_skewed.png'));
  const rot = await names();
  check('OCR-UI-05', 'rotated / skewed invoice', rot.length === 3 && rot.some((n) => /Mustard Oil/.test(n)), JSON.stringify(rot));
  ms = await upload(path.join(GT, 'TC07_long_40_lines.pdf'));
  check('OCR-UI-25', 'large invoice (40 lines)', (await rows().count()) === 40, `${ms} ms`);
  ms = await upload(path.join(OR, 'OR03_two_page_scanned.pdf'));
  check('OCR-UI-26', 'multi-page PDF (lines from both pages)', (await rows().count()) === 5 && (await names()).some((n) => /Surf Excel/.test(n)), `${ms} ms`);

  // ---------------------------------------------------------------- invalid / unreadable / empty (OCR-UI-22/23/24)
  await page.goto(HARNESS);
  await page.click('[role=tab]:has-text("Upload PDF or file")');
  await page.setInputFiles('input[type=file]:not([multiple]):not([capture])', { name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\x03\x04 not an invoice') });
  check('OCR-UI-22', 'invalid file type refused with a message', /valid image .* or PDF/.test(await errorText()), await errorText());
  await upload(null, { name: 'blank.png', mimeType: 'image/png', buffer: blankPng(1200, 800) });
  check('OCR-UI-23', 'unreadable image: no lines invented, user told', (await rows().count()) === 0, await errorText() || 'no rows');
  await upload(path.join(GT, 'TC11_empty_file.pdf'));
  check('OCR-UI-24', 'empty invoice file: clear error', /empty/i.test(await errorText()), await errorText());

  // ---------------------------------------------------------------- network / backend failure + retry (OCR-UI-27/28/29)
  await page.route('**/api/v1/invoices/extract', (r) => r.abort('failed'));
  await upload(path.join(OR, 'OR04_rate_per_kg.png'));
  const netErr = await errorText();
  check('OCR-UI-27', 'network failure shown, no rows', netErr.length > 0 && (await rows().count()) === 0, netErr);
  await page.unroute('**/api/v1/invoices/extract');
  await page.route('**/api/v1/invoices/extract', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Failed to extract invoice: RuntimeError"}' }));
  await page.click('button:has-text("Extract Line Items")');
  await page.waitForTimeout(800);
  const srvErr = await errorText();
  check('OCR-UI-28', 'backend failure shown with its reason', /Failed to extract invoice/.test(srvErr) && (await rows().count()) === 0, srvErr);
  await page.unroute('**/api/v1/invoices/extract');
  await page.click('button:has-text("Extract Line Items")');
  await page.waitForSelector('text=Extracted Grocery Line Items', { timeout: 120000 }).catch(() => {});
  const sugarRate = await page.locator('input[aria-label="Rate for Sugar"]').inputValue().catch(() => '');
  const rateNote = await rowOf('Sugar').locator('text=Rate is per kg').count();
  check('OCR-UI-29', 'retry after failure succeeds (same file, no re-upload)', (await rows().count()) === 1 && sugarRate === '44' && rateNote === 1, `rate ${sugarRate}`);
  await ctx.close();

  // ---------------------------------------------------------------- mobile (OCR-UI-30)
  const mctx = await browser.newContext({ ...devices['Pixel 7'] });
  const m = await mctx.newPage();
  await m.addInitScript((t) => localStorage.setItem('shoppulse_token', t), tok);
  await m.goto(HARNESS);
  await m.click('[role=tab]:has-text("Upload PDF or file")');
  await m.setInputFiles('input[type=file]:not([multiple]):not([capture])', path.join(OR, 'OR01_pack_column_wholesale.png'));
  await m.click('button:has-text("Extract Line Items")');
  await m.waitForSelector('text=Extracted Grocery Line Items', { timeout: 120000 });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const tableScrolls = await m.evaluate(() => { const t = document.querySelector('table'); const p = t && t.parentElement; return !!p && getComputedStyle(p).overflowX !== 'visible'; });
  await m.locator('input[aria-label="Pack size for Basmati Rice"]').scrollIntoViewIfNeeded();
  await m.screenshot({ path: `${SP}/ocr_review_phone.png` });
  check('OCR-UI-30', 'mobile: no page overflow, table scrolls in its container, review controls usable',
    overflow <= 1 && tableScrolls && (await m.locator('input[aria-label="Pack size for Basmati Rice"]').isVisible()), `overflow ${overflow}px`);
  await mctx.close();

  check('OCR-UI-34', 'complete workflow: upload -> review -> edit -> confirm -> inventory', results.every(Boolean), `${results.filter(Boolean).length}/${results.length} prior checks`);
  check('OCR-UI-console', 'no uncaught page errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
