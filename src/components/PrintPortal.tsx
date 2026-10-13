import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const BODY_CLASS = 'print-document-active';
let activePortals = 0;

/**
 * Renders a print-only document directly under <body>. It is invisible on screen; while it is
 * mounted, printing outputs only this document (the app shell, dialogs and navigation are hidden
 * by the print stylesheet), so pressing Ctrl+P with a receipt open prints the receipt.
 */
export const PrintPortal: React.FC<{ children: React.ReactNode; label: string }> = ({ children, label }) => {
  const [container] = useState<HTMLDivElement | null>(() => {
    if (typeof document === 'undefined') return null;
    const el = document.createElement('div');
    el.className = 'print-root';
    return el;
  });

  useEffect(() => {
    if (!container) return;
    container.setAttribute('aria-label', label);
    document.body.appendChild(container);
    activePortals++;
    document.body.classList.add(BODY_CLASS);
    return () => {
      activePortals--;
      if (activePortals === 0) document.body.classList.remove(BODY_CLASS);
      container.remove();
    };
  }, [container, label]);

  return container ? createPortal(children, container) : null;
};
