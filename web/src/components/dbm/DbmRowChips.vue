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
  DbmRowChips — the row-level half of the no-duplication rule.

  An insight whose entire evidence is ONE row is not a card and not a strip
  entry: it is a property OF that row, so it renders here, on the row, where
  the claim sits on the thing it is about and costs the table no vertical
  space. The strip carries only what spans rows.

  The chips are deliberately SHOUTED (uppercase, 10px, semibold) rather than
  styled as tags. They are read peripherally while scanning a column of SQL —
  the reader is looking at the query text, and the chip has to register without
  being looked at directly. Sentence-case tags disappear into the metadata line.

  Each carries its own arithmetic where it has any (ALL 380 FAILED, RUNS
  15× PER REQUEST), for the same reason the strip does: a claim without its
  evidence gets ignored.

  The failure chip says FAILED, not DEADLOCKED: the rule behind it fires on the
  error SHARE regardless of error class, so naming one cause would assert a
  diagnosis the data does not carry — and would claim deadlocks on engines like
  Redis that have no transactions to deadlock.
-->
<template>
  <template v-for="chip in chips" :key="chip.id">
    <span
      class="text-3xs inline-flex h-3.75 items-center gap-0.5 rounded-full px-1.5 font-semibold whitespace-nowrap"
      :class="TONES[chip.tone]"
      :data-test="`dbm-row-chip-${chip.id}`"
    >
      {{ chip.label }}
      <OTooltip v-if="chip.rule" side="bottom" :content="chip.rule" />
    </span>
  </template>
</template>

<script setup lang="ts">
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { I18nText } from "@/types/i18n";

/** A fact about one row, ready to render. */
export interface DbmRowChip {
  id: string;
  label: I18nText;
  tone: "error" | "warning" | "info" | "new";
  /** The rule that produced it, shown on hover. */
  rule?: I18nText;
}

withDefaults(
  defineProps<{
    /** Chips derived from insights that named exactly this row. */
    chips?: DbmRowChip[];
  }>(),
  { chips: () => [] },
);

const TONES: Record<DbmRowChip["tone"], string> = {
  error: "bg-badge-error-soft-bg text-badge-error-soft-text",
  warning: "bg-badge-warning-soft-bg text-badge-warning-soft-text",
  info: "bg-badge-blue-soft-bg text-badge-blue-soft-text",
  new: "bg-badge-primary-soft-bg text-badge-primary-soft-text",
};
</script>
