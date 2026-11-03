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
<template>
  <OverviewRowButton
    :data-test="`overview-data-health-row-${row.key}`"
    :disabled="!row.ok"
    @click="emit('open', row.destination)"
  >
    <!-- the text column shrinks and wraps instead of the row, so every row keeps its status on the label's line -->
    <span
      class="flex w-full items-center justify-between gap-x-3 whitespace-normal max-sm:items-start"
    >
      <span class="flex min-w-0 flex-1 items-start gap-2.5 text-start">
        <span
          :class="['mt-1.5 size-2 shrink-0 rounded-full', DOT[tier]]"
          aria-hidden="true"
          :data-test="`overview-data-health-dot-${row.key}`"
        />
        <span class="flex min-w-0 flex-col">
          <span class="text-text-body text-sm">{{ row.label }}</span>
          <span class="text-text-secondary text-xs">{{ row.note }}</span>
        </span>
      </span>
      <span class="ms-auto flex shrink-0 items-baseline gap-3">
        <span
          :class="['text-xs font-semibold', WORD[tier]]"
          :data-test="`overview-data-health-status-${row.key}`"
          >{{ row.word }}</span
        >
        <span
          :class="['min-w-8 text-end text-sm font-semibold tabular-nums', valueTone]"
          :data-test="`overview-data-health-value-${row.key}`"
          >{{ row.value }}</span
        >
      </span>
    </span>
  </OverviewRowButton>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { I18nText } from "@/types/i18n";
import OverviewRowButton from "./OverviewRowButton.vue";
import type { HealthTone, OverviewDestination } from "./overviewFormat";

export interface HealthRow {
  key: string;
  label: I18nText;
  note: I18nText;
  destination: OverviewDestination;
  tone: HealthTone;
  word: I18nText;
  value: I18nText;
  ok: boolean;
  notSetUp: boolean;
}

type Tier = HealthTone | "notSetUp";

// the dot and the status word share the tier's colour; the word itself always carries the meaning
const DOT: Record<Tier, string> = {
  error: "bg-status-negative",
  warning: "bg-status-warning-text",
  info: "bg-status-info-text",
  success: "bg-status-positive",
  neutral: "bg-border-strong",
  notSetUp: "bg-border-strong",
};

const WORD: Record<Tier, string> = {
  error: "text-status-error-text",
  warning: "text-status-warning-text",
  info: "text-status-info-text",
  success: "text-status-success-text",
  neutral: "text-text-secondary",
  notSetUp: "text-text-muted",
};

const VALUE_TONE: Record<HealthTone, string> = {
  error: "text-status-negative",
  warning: "text-status-warning-text",
  info: "text-text-heading",
  success: "text-text-heading",
  neutral: "text-text-muted",
};

const props = defineProps<{ row: HealthRow }>();

const emit = defineEmits<{ open: [destination: OverviewDestination] }>();

const tier = computed<Tier>(() => (props.row.notSetUp ? "notSetUp" : props.row.tone));

// a not-set-up or unloaded row shows a dash, which stays muted whatever its tier
const valueTone = computed(() =>
  props.row.notSetUp ? "text-text-muted" : VALUE_TONE[props.row.tone],
);
</script>
