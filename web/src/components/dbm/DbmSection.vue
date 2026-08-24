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
  DbmSection — the bordered card and its heading row.

  The query detail page stacks six of these, and every one of them hand-wrote
  the same section shell plus the same `<h3>`. What genuinely differed was the
  heading row's alignment, so that is the one prop: `baseline` for headings
  whose trailing note sits on the text baseline, `center` for rows carrying a
  control, and `between` for the two rows that push their note to the far edge.

  The body is the default slot — it sits OUTSIDE the header row, so a section
  can put a table, a tile grid or a state note under the heading without this
  component knowing which. `#hint` follows the title inside the header row;
  `#actions` closes it.
-->
<template>
  <section class="card-container border-border-default rounded-surface flex flex-col border">
    <div :class="headerClass">
      <h3 class="text-text-heading text-sm font-medium">{{ title }}</h3>
      <slot name="hint" />
      <slot name="actions" />
    </div>
    <slot />
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    title: I18nText;
    /**
     * How the heading row lays its children out. Three real variants, not a
     * free-form class: `baseline` sits the trailing note on the heading's
     * baseline, `center` centres a row that carries a control, `between`
     * pushes a single trailing note to the card's far edge.
     */
    headerAlign?: "baseline" | "center" | "between";
  }>(),
  { headerAlign: "baseline" },
);

const headerClass = computed(
  () =>
    ({
      baseline: "flex flex-wrap items-baseline gap-2 p-3 pb-1",
      center: "flex flex-wrap items-center gap-2 p-3 pb-1",
      between: "flex items-center justify-between gap-2 p-3 pb-1",
    })[props.headerAlign],
);
</script>
