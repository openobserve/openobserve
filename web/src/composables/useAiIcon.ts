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

/**
 * useAiIcon — returns the theme-aware AI button icon src.
 *
 * Light mode → ai_icon_gradient.svg  (colour gradient sparkle)
 * Dark mode  → ai_icon_dark.svg      (light sparkle for dark backgrounds)
 *
 * Use in any component that renders an "Ask AI" button to keep the icon
 * consistent with the header AI button.
 *
 * Usage:
 *   const { aiIconSrc } = useAiIcon()
 *   <img :src="aiIconSrc" class="w-4 h-4 shrink-0" />
 */

import { computed } from "vue";
import { useStore } from "vuex";
import { getImageURL } from "@/utils/zincutils";

export function useAiIcon() {
  const store = useStore();

  const aiIconSrc = computed<string>(() =>
    store.state.theme === "dark"
      ? getImageURL("images/common/ai_icon_dark.svg")
      : getImageURL("images/common/ai_icon_gradient.svg"),
  );

  return { aiIconSrc };
}
