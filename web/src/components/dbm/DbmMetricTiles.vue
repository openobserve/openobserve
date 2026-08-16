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
  DbmMetricTiles — a row of headline figures as a bordered grid.

  The query detail page draws two of these: the client-vantage headline stats
  and, below them, what the database's own counters say. They are the SAME grid
  — same breakpoints, same tile padding, same label and value type — because the
  two vantages must be visually comparable at a glance; a reader who has to
  re-learn the layout between them will misread one for the other.

  Deliberately not the library's `OStatStrip`: that is a wrapping flex strip of
  `OStatCard`s sized `grow basis-52`, with no grid, no cell borders, and no
  place for the sub-label or the caption line. Rendering these figures through
  it would change the page's DOM wholesale, which is the opposite of what a
  dedup is for.

  Two containers, one tile. `standalone` is the client block — a `rounded-surface`
  card with a border all round. `attached` is the server block, which sits INSIDE a
  `DbmSection` under its heading, so it carries only the rule that separates it
  from that heading.
-->
<template>
  <div :class="containerClass">
    <div
      v-for="item in items"
      :key="item.id"
      class="border-border-subtle border-r border-b px-3 py-2 last:border-r-0"
      :data-test="`${tileDataTest}-${item.id}`"
    >
      <!-- The percentile the plain-English label stands for, alongside it in
           the quiet weight — the tile says what it means and what it is. Only
           the grid that HAS sub-labels pays for the row that holds them. -->
      <div v-if="withSubLabels" class="flex items-baseline gap-1">
        <span class="text-text-label text-3xs font-semibold tracking-wide uppercase">
          {{ item.label }}
        </span>
        <span v-if="item.sub" class="text-text-muted text-3xs" :data-test="`${tileDataTest}-sub`">
          {{ item.sub }}
        </span>
      </div>
      <div v-else class="text-text-label text-3xs font-semibold tracking-wide uppercase">
        {{ item.label }}
      </div>
      <div
        class="text-text-heading font-mono text-lg leading-tight font-semibold tabular-nums"
        :class="item.tone"
      >
        {{ item.value }}
      </div>
      <div v-if="withSubLabels" class="text-text-secondary text-3xs">{{ item.detail }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { I18nText } from "@/types/i18n";

/** One figure: what it is, what it reads, and what it is worth. */
export interface DbmMetricTile {
  id: string;
  label: I18nText;
  /** The formal name the plain-English label stands for, e.g. `p95`. */
  sub?: I18nText;
  value: I18nText;
  /** The caption under the figure — how it changed, or how exact it is. */
  detail?: I18nText;
  /** A colour class, applied only where the page's own threshold fired. */
  tone?: string;
}

const props = withDefaults(
  defineProps<{
    items: DbmMetricTile[];
    /**
     * `standalone` is a card in its own right; `attached` sits under a section
     * heading and carries only the rule dividing it from that heading.
     */
    variant?: "standalone" | "attached";
    /**
     * Whether the tiles carry a sub-label and a caption line. The two grids
     * differ here and nowhere else: the client block qualifies every figure,
     * the server block's counters are exact and need no caption.
     */
    withSubLabels?: boolean;
    /** Prefix for each tile's `data-test`; the id is appended. */
    tileDataTest: string;
  }>(),
  { variant: "standalone", withSubLabels: false },
);

const containerClass = computed(() =>
  props.variant === "standalone"
    ? "border-border-default rounded-surface grid grid-cols-2 overflow-hidden border md:grid-cols-3 xl:grid-cols-6"
    : "border-border-default grid grid-cols-2 overflow-hidden border-t md:grid-cols-3 xl:grid-cols-6",
);
</script>
