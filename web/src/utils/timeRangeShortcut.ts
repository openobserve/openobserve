// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

const pickers = new Map<HTMLElement, () => void>();

const isEligible = (el: HTMLElement): boolean =>
  el.isConnected &&
  el.hasAttribute("data-date-time-shortcut") &&
  el.getClientRects().length > 0 &&
  !el.closest('[role="dialog"], [role="alertdialog"]');

/** Adds a picker root to the `t` shortcut's candidates; the returned function removes it. */
export function registerTimeRangePicker(el: HTMLElement, open: () => void): () => void {
  pickers.set(el, open);
  return () => {
    if (pickers.get(el) === open) pickers.delete(el);
  };
}

/** Opens the first eligible picker in document order, so the page's main toolbar picker wins. */
export function openPrimaryTimeRangePicker(): void {
  const first = [...pickers.keys()]
    .filter(isEligible)
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))[0];
  if (first) pickers.get(first)?.();
}
