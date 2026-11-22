/**
 * Server price check of the POS cart (POST /sales/quote), refreshed after every cart change.
 *
 * The quote runs the same evaluation as checkout (pricing engine, status, units, MRP, stock, approval) and
 * records nothing. While it is running the cart total is shown as "checking", never as final; checkout
 * itself is still validated again by the server.
 */
import { useEffect, useRef, useState } from 'react';
import { salesApi, type SaleQuote } from '../api/sales';
import type { CartItem } from '../types/sale';
import { cartLineTotal } from '../utils/cartPricing';

export type QuoteStatus = 'idle' | 'checking' | 'ready' | 'error';

/** The request a cart line becomes, for the quote and for checkout alike. */
export function cartLineRequest(item: CartItem) {
  return item.needsApproval
    ? { product_id: item.product.id, quantity: item.quantity, requested_line_total: cartLineTotal(item) }
    : { product_id: item.product.id, quantity: item.quantity };
}

/** `nonce` re-runs the check for an unchanged cart (e.g. after a refused sale, stock or prices may have changed). */
export function useSaleQuote(cart: CartItem[], nonce = 0, delayMs = 250): { quote: SaleQuote | null; status: QuoteStatus } {
  // The result is stored with the cart it was computed for: the returned status is derived during render,
  // so a changed cart is "checking" immediately (never a stale "ready" or "idle" for one render)
  const [result, setResult] = useState<{ forKey: string; quote: SaleQuote | null; status: 'ready' | 'error' } | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify(cart.map(cartLineRequest));
  const requestKey = `${key}#${nonce}`;

  useEffect(() => {
    const id = ++seq.current;
    if (cart.length === 0) return;
    const timer = setTimeout(() => {
      salesApi
        .quoteSale({ items: JSON.parse(key) })
        .then((q) => {
          if (seq.current === id) setResult({ forKey: requestKey, quote: q, status: 'ready' });
        })
        .catch(() => {
          if (seq.current === id) setResult({ forKey: requestKey, quote: null, status: 'error' });
        });
    }, delayMs);
    return () => clearTimeout(timer);
    // requestKey captures every line's product, quantity and requested price, and the re-check nonce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  if (cart.length === 0) return { quote: null, status: 'idle' };
  if (!result || result.forKey !== requestKey) return { quote: null, status: 'checking' };
  return { quote: result.quote, status: result.status };
}
