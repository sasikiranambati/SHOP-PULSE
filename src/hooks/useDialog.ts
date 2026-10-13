/**
 * @file useDialog.ts
 * @description Shared behaviour for modal dialogs and drawers: Escape to close, focus moved into
 * the dialog and trapped there, focus restored to the opener on close, and background scroll locked.
 * Nested dialogs are supported: only the top-most open dialog reacts to Escape/Tab, and the page
 * stays locked until the last dialog closes.
 */

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Keyboard-focusable elements inside a container, in DOM order. */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length > 0
  );
}

let scrollLockCount = 0;
let savedBodyOverflow = '';

/** Locks page scrolling; calls are counted so nested dialogs do not unlock the page early. */
export function lockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount++;
}

export function unlockBodyScroll(): void {
  if (typeof document === 'undefined' || scrollLockCount === 0) return;
  scrollLockCount--;
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow;
  }
}

// Open dialogs in the order they were opened; the last entry is the top-most one.
const dialogStack: symbol[] = [];

export interface UseDialogOptions {
  isOpen: boolean;
  /** Called when the user presses Escape. */
  onClose?: () => void;
  /** Set to false while an operation is running so Escape cannot interrupt it. */
  closeOnEscape?: boolean;
  /** Element to focus when the dialog opens (defaults to the first focusable element). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  lockScroll?: boolean;
}

/**
 * Attach the returned ref to the dialog panel element.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>({
  isOpen,
  onClose,
  closeOnEscape = true,
  initialFocusRef,
  lockScroll = true,
}: UseDialogOptions): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);
  const initialFocusTargetRef = useRef(initialFocusRef);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeOnEscapeRef.current = closeOnEscape;
    initialFocusTargetRef.current = initialFocusRef;
  });

  useEffect(() => {
    if (!isOpen) return;

    const id = Symbol('dialog');
    dialogStack.push(id);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (lockScroll) lockBodyScroll();

    const focusInitial = () => {
      const container = containerRef.current;
      if (!container) return;
      const target = initialFocusTargetRef.current?.current || getFocusableElements(container)[0];
      if (target) {
        target.focus();
      } else {
        if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
        container.focus();
      }
    };
    // Wait a frame so the dialog content is mounted and laid out.
    const frame = window.requestAnimationFrame(focusInitial);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== id) return;
      const container = containerRef.current;
      if (!container) return;

      if (event.key === 'Escape') {
        if (closeOnEscapeRef.current && onCloseRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }

      if (event.key === 'Tab') {
        const focusable = getFocusableElements(container);
        if (focusable.length === 0) {
          event.preventDefault();
          container.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !container.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !container.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      const index = dialogStack.indexOf(id);
      if (index >= 0) dialogStack.splice(index, 1);
      if (lockScroll) unlockBodyScroll();
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
    // Re-run only when the dialog opens or closes; the latest callbacks are read from refs.
  }, [isOpen, lockScroll]);

  return containerRef;
}
