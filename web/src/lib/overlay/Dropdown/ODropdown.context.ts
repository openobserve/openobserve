/**
 * Provide/inject contract used by ODropdown to coordinate with nested
 * portaled overlays (OSelect, OCombobox, child ODropdown, etc.). While a
 * descendant overlay is open — or one just closed inside the same pointer
 * event tick — the ancestor ODropdown swallows outside-click events so
 * clicking an option in the descendant doesn't dismiss the parent.
 *
 * Kept in a dedicated .ts file (not a non-setup `<script>` block in the
 * .vue file) so descendants can import the symbol without going through
 * Vue's SFC compiler — avoids TypeScript-resolution and circular-import
 * pitfalls that crop up when importing values from `.vue` modules.
 */
export const O_DROPDOWN_NESTED_KEY = Symbol("o-dropdown-nested-overlay");

export interface DropdownNestedRegistry {
  /**
   * Call when a nested overlay opens. Returns a close function to call when
   * the same overlay closes. Pass `skipGrace = true` when the close was caused
   * by a real outside click so the parent doesn't swallow that same click.
   */
  open: () => (skipGrace?: boolean) => void;
}
