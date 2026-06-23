<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  ConstrainedPage — the single source of truth for "this page does NOT need full
  width". It centers its content in a max-width column and scrolls vertically,
  so reading-oriented pages (settings sections, IAM/Settings hubs, general
  settings, org params, single forms) stay legible on wide monitors instead of
  stretching edge-to-edge.

  Use it either:
    • directly  — wrap a section's content: <ConstrainedPage><MyForm/></ConstrainedPage>
    • via PageLayout's `constrained` prop — PageLayout wraps its main slot in this.

  `size` maps to a fixed max-width (literal classes so Tailwind's scanner keeps
  them). `padded` toggles the default page gutter (px-6 py-6); turn it off when
  the child manages its own padding.
-->
<template>
  <div
    class="o2-constrained-page tw:h-full tw:min-h-0 tw:overflow-y-auto"
    data-test="constrained-page"
  >
    <div
      class="tw:w-full"
      :class="[alignClass, maxWidthClass, padded ? 'tw:px-6 tw:py-6' : '']"
    >
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** Reading-column width. `lg` (default) matches the section hubs. */
    size?: "sm" | "md" | "lg" | "xl";
    /** Apply the default page gutter (px-6 py-6). Off → child owns padding. */
    padded?: boolean;
    /** Column placement. `center` (default) for hubs; `left` for form pages. */
    align?: "center" | "left";
  }>(),
  {
    size: "lg",
    padded: true,
    align: "center",
  },
);

// Literal class strings so Tailwind's content scanner keeps them in the build.
const SIZE_CLASS = {
  sm: "tw:max-w-2xl", // narrow single-column forms
  md: "tw:max-w-3xl", // settings sections, org params
  lg: "tw:max-w-5xl", // section hubs (Settings/IAM landing)
  xl: "tw:max-w-7xl", // wide reading content
} as const;

const maxWidthClass = computed(() => SIZE_CLASS[props.size]);

// `center` keeps the column centered (mx-auto); `left` pins it to the start so
// form pages read left-aligned instead of floating in the middle of wide screens.
const alignClass = computed(() =>
  props.align === "left" ? "tw:mr-auto" : "tw:mx-auto",
);
</script>
