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
  KpiCardRow — the grid that holds a row of KpiCards.

  Why this exists: the same stat-tile row was hand-rolled in eight places with
  six different grid declarations (inline `style` with a raw px minmax, the same
  minmax as a Tailwind arbitrary value, grid-cols-5, grid-cols-4, grid-cols-2,
  responsive pairs) and two different gaps. This owns the grid + gap so a new
  dashboard gets the right rhythm for free. See SPACING_AUDIT.md §7.

  Usage:
    <KpiCardRow>            responsive auto-fit (default)
    <KpiCardRow :columns="4">   fixed 4-up

  The row deliberately has NO horizontal padding — it inherits its page's
  inset, so it lines up with the header and any table below it.
-->
<template>
  <div class="grid gap-2.5" :style="gridStyle" data-test="kpi-card-row">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** Fixed column count. Omit for a responsive auto-fit grid. */
    columns?: number;
    /** Minimum card width before the responsive grid wraps. */
    minWidth?: string;
  }>(),
  {
    columns: undefined,
    minWidth: "11.25rem",
  },
);

const gridStyle = computed(() =>
  props.columns
    ? { gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` }
    : {
        gridTemplateColumns: `repeat(auto-fit, minmax(${props.minWidth}, 1fr))`,
      },
);
</script>
