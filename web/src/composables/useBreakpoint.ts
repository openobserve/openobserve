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

import { computed, ref } from "vue";

// Mirrors Tailwind's default `md` (48rem) and `lg` (64rem) screens so JS-driven
// layout (inline widths, drawers) switches at the same point as CSS variants.
const MD_QUERY = "(min-width: 48rem)";
const LG_QUERY = "(min-width: 64rem)";

// Module-level singletons: one pair of matchMedia listeners for the whole app,
// alive for the app's lifetime — every consumer shares the same refs.
const mdUp = ref(true);
const lgUp = ref(true);
let initialized = false;

const track = (query: string, target: typeof mdUp) => {
  const mql = window.matchMedia(query);
  // A reset test mock (vi.resetAllMocks()) or a non-standard embed can make
  // matchMedia() return a falsy value instead of a MediaQueryList — fall back
  // to the desktop-like default (ref stays `true`) rather than crashing.
  if (!mql) return;
  target.value = mql.matches;
  // Older WebKit exposes only addListener; jsdom mocks may expose neither.
  const onChange = (e: MediaQueryListEvent) => {
    target.value = e.matches;
  };
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
  } else if (typeof (mql as any).addListener === "function") {
    (mql as any).addListener(onChange);
  }
};

const ensureInit = () => {
  if (initialized || typeof window === "undefined" || typeof window.matchMedia !== "function")
    return;
  initialized = true;
  track(MD_QUERY, mdUp);
  track(LG_QUERY, lgUp);
};

/**
 * Reactive viewport breakpoints: mobile < md ≤ tablet < lg ≤ desktop.
 * Use for JS-driven layout only — pure styling belongs in Tailwind
 * `max-md:` / `lg:` variants so it needs no runtime.
 */
const useBreakpoint = () => {
  ensureInit();
  return {
    isMobile: computed(() => !mdUp.value),
    isTablet: computed(() => mdUp.value && !lgUp.value),
    isDesktop: computed(() => lgUp.value),
    mdUp: computed(() => mdUp.value),
    lgUp: computed(() => lgUp.value),
  };
};

export default useBreakpoint;
