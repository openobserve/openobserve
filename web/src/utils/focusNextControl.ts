// Copyright 2026 OpenObserve Inc.

const TABBABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]";
const ESCAPE_OWNER = '[role="dialog"], [data-fullscreen="true"]';

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/** Moves focus to the nearest visible tabbable control after (or before) `container` in document order. */
export function focusControlAfter(container: HTMLElement, backward = false) {
  const position = backward ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) =>
      el.getAttribute("tabindex") !== "-1" &&
      !container.contains(el) &&
      el.getClientRects().length > 0 &&
      container.compareDocumentPosition(el) & position,
  );
  const next = backward ? candidates.at(-1) : candidates[0];
  (next ?? (document.activeElement as HTMLElement | null))?.focus();
}

/** Focuses the first visible control in `container` outside `skip`; false when there is none. */
export function focusFirstControl(container: HTMLElement, skip?: string): boolean {
  // An info icon (role="img") is in the Tab order for its tooltip, but it is not a control.
  const first = Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).find(
    (el) =>
      el.getAttribute("tabindex") !== "-1" &&
      el.getAttribute("role") !== "img" &&
      !(skip && el.closest(skip)) &&
      el.getClientRects().length > 0,
  );
  first?.focus({ preventScroll: true });
  return first !== undefined;
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

/** Escape arms it; the next Tab or Shift+Tab then leaves the editor instead of indenting, and any other key disarms it. */
export function createTabOut(container: () => HTMLElement | null) {
  let armed = false;
  return {
    arm: () => (armed = true),
    disarm: () => (armed = false),
    /** True when the key moved focus out, so the editor must not handle it. */
    onKey(key: string, shift: boolean): boolean {
      if (!armed || key === "Escape" || MODIFIER_KEYS.has(key)) return false;
      armed = false;
      const host = container();
      if (key !== "Tab" || !host) return false;
      focusControlAfter(host, shift);
      return true;
    },
  };
}
