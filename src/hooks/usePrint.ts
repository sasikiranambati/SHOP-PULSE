/**
 * @file usePrint.ts
 * @description Request printing of a document rendered with <PrintPortal>.
 * The portal is mounted first, then the browser print dialog opens on the next frame,
 * and the portal is removed again after printing finishes.
 */

import { useCallback, useEffect, useState } from 'react';

export function usePrintRequest(): { isPrinting: boolean; requestPrint: () => void } {
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    if (!isPrinting) return;
    const done = () => setIsPrinting(false);
    window.addEventListener('afterprint', done);
    const frame = window.requestAnimationFrame(() => window.print());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', done);
    };
  }, [isPrinting]);

  const requestPrint = useCallback(() => {
    // Some mobile browsers never fire 'afterprint'; printing again must still work.
    setIsPrinting((already) => {
      if (already) window.print();
      return true;
    });
  }, []);

  return { isPrinting, requestPrint };
}
