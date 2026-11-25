/**
 * Shared steps for the invoice-scanner browser checks.
 *
 * The review screen never invents a selling price (no MRP fallback, no margin on the purchase cost):
 * a reviewer types one for every new or loose product before confirming. The checks do the same with
 * a generic Rs 1, which can never exceed an MRP. Lines matched to an existing product keep their price.
 */
async function enterSellingPrices(page, price = '1') {
  const inputs = page.locator('input[aria-label^="Selling price for"]');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const input = inputs.nth(i);
    if (!(await input.inputValue())) await input.fill(price);
  }
  return n;
}

module.exports = { enterSellingPrices };
