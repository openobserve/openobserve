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

<!-- An insight whose whole evidence is one row renders on that row, as a soft chip carrying its rule, not in the strip. -->
<template>
  <OTag
    v-for="chip in chips"
    :key="chip.id"
    :variant="DBM_SOFT_VARIANTS[chip.tone]"
    size="xs"
    class="whitespace-nowrap"
    :data-test="`dbm-row-chip-${chip.id}`"
  >
    {{ chip.label }}
    <OTooltip v-if="chip.rule" side="bottom" :content="chip.rule" />
  </OTag>
</template>

<script setup lang="ts">
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { I18nText } from "@/types/i18n";
import { DBM_SOFT_VARIANTS, type DbmRowChipTone } from "@/utils/dbm/tones";

/** A fact about one row, ready to render. */
export interface DbmRowChip {
  id: string;
  label: I18nText;
  tone: DbmRowChipTone;
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
</script>
