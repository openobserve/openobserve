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
  OContent — the single content-inset primitive for the app.

  It applies the app's ONE horizontal content inset (`--spacing-page-edge`, the
  same grid line the page header, tables, rails and tab labels all align to) so
  every page body, panel, tab-panel and dialog section lines up on the same
  vertical rule. Use it instead of hand-picking `px-2` / `px-4` / `p-2.5` on a
  wrapper — that is exactly how screens drift out of alignment.

    <OContent class="flex-1 min-h-0 overflow-auto">…</OContent>

  Escape hatches (mirror ODrawer/ODialog's `bleed`):
    • `bleed`  — remove the inset on BOTH axes (full-bleed tables/charts/editors
                 that own their own edge — e.g. an OTable, a flow canvas).
    • `bleed-x`— remove only the horizontal inset (keep vertical).
    • `bleed-y`— remove only the vertical inset (keep horizontal).

  By default OContent insets the HORIZONTAL axis only (the alignment-critical
  one). Pass `y` to also apply the standard vertical inset, or add your own
  `py-*` / `gap-*` via class. The root merges any class you pass, so layout
  utilities (`flex`, `h-full`, `overflow-*`) compose normally.
-->
<template>
  <component :is="as" :class="paddingClass">
    <slot />
  </component>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** Remove the content inset on both axes (full-bleed). */
    bleed?: boolean;
    /** Remove only the horizontal inset. */
    bleedX?: boolean;
    /** Remove only the vertical inset. */
    bleedY?: boolean;
    /** Also apply the standard vertical inset (off by default). */
    y?: boolean;
    /** Root element tag. */
    as?: string;
  }>(),
  { bleed: false, bleedX: false, bleedY: false, y: false, as: "div" },
);

const paddingClass = computed(() => {
  const classes: string[] = [];
  if (!props.bleed && !props.bleedX) classes.push("px-page-edge");
  if (props.y && !props.bleed && !props.bleedY) classes.push("py-page-edge");
  return classes.join(" ");
});
</script>
