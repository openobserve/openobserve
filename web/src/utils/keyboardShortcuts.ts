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

/** ARIA roles that represent a text-entry widget even when not backed by a native input. */
const INPUT_ROLES = ["textbox", "combobox", "searchbox", "spinbutton"];

/**
 * Returns true when the focused element is a text-input.
 * Single-letter shortcuts should guard with this to avoid firing while typing.
 *
 * Catches native inputs, any contentEditable element (CodeMirror, ProseMirror,
 * RichTextInput, inline-editable table cells, etc.), and custom widgets that
 * expose an input-like ARIA role — regardless of which component built them.
 *
 * @param target Element to test instead of `document.activeElement`. Event
 * handlers should pass the keydown's real target (`e.composedPath()[0]`) so
 * inputs inside shadow DOM are detected; with no argument the current
 * `document.activeElement` is used.
 */
export function isInputFocused(target?: EventTarget | null): boolean {
  const el = (target ?? document.activeElement) as HTMLElement | null;
  if (!el || el === document.body || !(el instanceof Element)) return false;
  const tag = el.tagName.toLowerCase();
  if (["input", "textarea", "select"].includes(tag)) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  const role = el.getAttribute("role");
  return !!role && INPUT_ROLES.includes(role);
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
