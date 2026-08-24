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

import { onBeforeUnmount, onMounted, ref } from "vue";

// Mirrors Tailwind's default `sm` breakpoint (40rem / 640px) — the same
// threshold OPageHeader's `max-sm:` utilities key off, so the app-shell
// (navbar rail) and page-level layout collapse together.
const MOBILE_MEDIA_QUERY = "(max-width: 639px)";

/**
 * Tracks whether the viewport is currently narrower than the mobile
 * breakpoint. Backed by `matchMedia` (not a resize listener) so it only
 * fires on actual breakpoint crossings.
 */
export function useIsMobile() {
  const isMobile = ref(
    typeof window !== "undefined" ? window.matchMedia(MOBILE_MEDIA_QUERY).matches : false,
  );

  let mql: MediaQueryList | null = null;
  const handleChange = (event: MediaQueryListEvent) => {
    isMobile.value = event.matches;
  };

  onMounted(() => {
    mql = window.matchMedia(MOBILE_MEDIA_QUERY);
    isMobile.value = mql.matches;
    mql.addEventListener("change", handleChange);
  });

  onBeforeUnmount(() => {
    mql?.removeEventListener("change", handleChange);
  });

  return { isMobile };
}
