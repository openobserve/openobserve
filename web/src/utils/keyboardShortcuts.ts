// Copyright 2026 OpenObserve Inc.

/**
 * True when running on a macOS / iOS device. Used to pick platform-specific
 * key combos (⌘ vs Ctrl) and modifier glyphs (⇧ ⌥ ⌫ vs the spelled-out words).
 *
 * `navigator.platform` is deprecated and can be empty on some browsers, so we
 * prefer the modern `userAgentData.platform`, then fall back to `platform`, then
 * the UA string. Evaluated lazily so it reflects `navigator` at call time
 * (stable in the app; stubbable in tests).
 */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const source =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    "";
  return /mac|iphone|ipad|ipod/i.test(source);
}

/**
 * Returns true when no text-input element has focus.
 * Single-letter shortcuts should guard with this to avoid firing while typing.
 */
export function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = el.tagName.toLowerCase();
  // Only treat contentEditable as an input when it has role="textbox"
  // (CodeMirror, ProseMirror, etc.). Generic contentEditable containers
  // (e.g. panel drag handles) should not block shortcuts.
  const isContentEditableInput =
    (el as HTMLElement).isContentEditable &&
    (el.getAttribute("role") === "textbox" ||
      el.closest('[role="textbox"]') !== null);
  return ["input", "textarea", "select"].includes(tag) || isContentEditableInput;
}

/**
 * Focuses a search field identified by its `data-test`, resilient to where the
 * attribute actually lands in the DOM:
 *  - O2 inputs (OInput/OSearchInput) put the real <input> at `${dataTest}-field`
 *  - otherwise the focusable element may be nested under the wrapper, or be the
 *    `data-test` element itself (raw input / CodeMirror `.cm-editor`).
 * Tries the most reliable target first so a single `/` handler works everywhere.
 */
export function focusSearchInput(dataTest: string): void {
  const target =
    document.querySelector<HTMLElement>(`[data-test="${dataTest}-field"]`) ??
    document.querySelector<HTMLElement>(
      `[data-test="${dataTest}"] input, [data-test="${dataTest}"] textarea, [data-test="${dataTest}"] .cm-editor`,
    ) ??
    (() => {
      const el = document.querySelector<HTMLElement>(`[data-test="${dataTest}"]`);
      return el && el.matches("input, textarea, .cm-editor, [contenteditable]")
        ? el
        : null;
    })();
  target?.focus();
}
