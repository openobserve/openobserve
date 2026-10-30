// Copyright 2026 OpenObserve Inc.

const TABBABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]";
const ESCAPE_OWNER = '[role="dialog"], [data-fullscreen="true"]';

/** Moves focus to the first visible tabbable control that follows `container` in document order. */
export function focusControlAfter(container: HTMLElement) {
  const next = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).find(
    (el) =>
      el.getAttribute("tabindex") !== "-1" &&
      !container.contains(el) &&
      el.getClientRects().length > 0 &&
      container.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  (next ?? (document.activeElement as HTMLElement | null))?.focus();
}

/** Escape leaves the editor, unless a dialog or fullscreen wrapper owns it and takes the key. */
export function escapeEditor(container: HTMLElement) {
  if (!container.closest(ESCAPE_OWNER)) {
    focusControlAfter(container);
    return;
  }
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  (container.parentElement ?? document.body).dispatchEvent(escape);
  if (escape.defaultPrevented) focusControlAfter(container);
}
