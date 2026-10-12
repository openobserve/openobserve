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

const HEADER_FOCUSABLE =
  '.o2-app-header a[href], .o2-app-header button, .o2-app-header [tabindex]:not([tabindex="-1"])';

const CONTENT_FOCUSABLE =
  '.o2-content-scroll a[href]:not([tabindex="-1"]), .o2-content-scroll button:not([disabled]):not([tabindex="-1"]), .o2-content-scroll input:not([disabled]):not([tabindex="-1"]), .o2-content-scroll select:not([disabled]):not([tabindex="-1"]), .o2-content-scroll [tabindex]:not([tabindex="-1"])';

// The desktop header keeps a display-none hamburger first in DOM order, which focus() silently ignores.
export function isVisibleFocusable(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  return el.ownerDocument.defaultView?.getComputedStyle(el).display !== "none";
}

function firstVisible(doc: Document, selector: string): HTMLElement | null {
  for (const el of doc.querySelectorAll<HTMLElement>(selector)) {
    if (isVisibleFocusable(el)) return el;
  }
  return null;
}

export function findHeaderFocusTarget(doc: Document = document): HTMLElement | null {
  return firstVisible(doc, HEADER_FOCUSABLE);
}

export function findContentFocusTarget(doc: Document = document): HTMLElement | null {
  return firstVisible(doc, CONTENT_FOCUSABLE);
}
