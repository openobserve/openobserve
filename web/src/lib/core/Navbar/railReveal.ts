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

// Must match the rail's mask utilities (calc(100% - 3rem)) or a tile can rest under the fade.
export const RAIL_FADE_REM = 3;

// A fade counts as drawn with the same 1 px tolerance the overflow attributes use.
const EDGE_TOLERANCE = 1;

export interface RevealMetrics {
  railTop: number;
  railBottom: number;
  tileTop: number;
  tileBottom: number;
  scrollTop: number;
  maxScrollTop: number;
  fadePx: number;
}

/** The rail scrollTop that puts the tile inside the clear band, or null when it already is. */
export function revealScrollTop(m: RevealMetrics): number | null {
  const topFade = m.scrollTop > EDGE_TOLERANCE ? m.fadePx : 0;
  const bottomFade = m.scrollTop < m.maxScrollTop - EDGE_TOLERANCE ? m.fadePx : 0;
  const clearTop = m.railTop + topFade;
  const clearBottom = m.railBottom - bottomFade;
  let next: number | null = null;
  if (m.tileTop < clearTop) next = m.scrollTop - (clearTop - m.tileTop);
  else if (m.tileBottom > clearBottom) next = m.scrollTop + (m.tileBottom - clearBottom);
  if (next === null) return null;
  next = Math.round(Math.min(Math.max(next, 0), m.maxScrollTop));
  return next === Math.round(m.scrollTop) ? null : next;
}

export function hrefPathname(href: string): string {
  return new URL(href, "http://localhost").pathname;
}

// Only the clicks RouterLink itself navigates on: plain left click on a same-tab in-app anchor.
export function railClickPath(event: MouseEvent): string | null {
  const target = event.target as Element | null;
  const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || anchor.target === "_blank") return null;
  if (event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  return hrefPathname(anchor.href);
}

// jsdom's selector engine may reject :focus-visible; a rejection means no reveal, never a throw.
export function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return false;
  }
}
