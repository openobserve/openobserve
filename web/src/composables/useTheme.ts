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

import { computed } from "vue";
import { useStore } from "vuex";

/**
 * The single sanctioned JS seam for reading dark mode.
 *
 * This is the ONLY file (besides `utils/chartTheme.ts`) permitted to string-compare
 * `store.state.theme`. Everywhere else, use a design token (dark handled automatically
 * by `dark.css`), the Tailwind `dark:` variant, or — for JS-only surfaces — this
 * composable / `chartColor()`. Never `store.state.theme === 'dark'`, a private `isDark`
 * const, or `classList.contains('body--dark')`.
 */
export function useTheme() {
  const store = useStore();
  const isDark = computed(() => store.state.theme === "dark");
  return { isDark };
}

export default useTheme;
