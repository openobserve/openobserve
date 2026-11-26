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
 * Draws the assistant spark (AssistantSpark.vue) with its light or dark gradient.
 *
 * Use in any component that renders an "Ask AI" button to keep the icon
 * consistent with the header AI button.
 *
 * Usage:
 *   const { aiIconSrc } = useAiIcon()
 *   <img :src="aiIconSrc" class="w-4 h-4 shrink-0" />
 */

import { computed } from "vue";
import { useThemeRevision } from "@/composables/useTheme";
import { SPARK_PATH } from "@/components/ai-assistant/common/AssistantSpark.vue";

const sparkToken = (name: string): string =>
  getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-assistant-spark-${name}`)
    .trim();

const sparkDataUri = (): string => {
  const [from, via, to] = ["from", "via", "to"].map(sparkToken);
  return (
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="s" x1="8" y1="2" x2="16" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${from}"/><stop offset="0.45" stop-color="${via}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><path d="${SPARK_PATH}" fill="url(#s)"/></svg>`,
    )
  );
};

export function useAiIcon() {
  const themeRevision = useThemeRevision();

  // An <img> cannot read CSS variables, so the token values are resolved per theme revision.
  const aiIconSrc = computed<string>(() => {
    void themeRevision.value;
    return sparkDataUri();
  });

  return { aiIconSrc };
}
