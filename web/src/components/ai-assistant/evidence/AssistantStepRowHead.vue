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
  <span
    :class="[
      'flex min-w-0 flex-1 items-center gap-2 text-xs outline-none',
      plain && 'self-stretch',
    ]"
    :tabindex="plain ? -1 : undefined"
    :data-step-header="row.step.callId"
    data-step-row
  >
    <span v-for="id in row.folded" :key="id" hidden :data-step-header="id" />
    <span class="text-text-link w-3 shrink-0 text-start font-medium">
      {{ row.step.n }}
    </span>
    <OTruncatedText
      :class="[
        'min-w-0 text-start',
        row.mono ? 'font-mono' : '',
        row.step.state === 'failed' ? 'text-status-error-text' : 'text-text-body',
      ]"
      >{{ row.text }}</OTruncatedText
    >
    <OCode v-if="row.table" class="shrink-0">{{ row.table }}</OCode>
    <span
      v-if="row.count"
      class="text-text-secondary shrink-0"
      :data-test="`assistant-queries-count-${row.step.callId}`"
    >
      {{ row.count }}
    </span>
    <span class="flex-1" />
    <slot />
  </span>
</template>

<script lang="ts">
import type { StepFacts } from "@/composables/assistant/pure";
import type { I18nText } from "@/types/i18n";

export interface StepRow {
  step: StepFacts;
  /** Schema reads folded into this row; each keeps a header so a citation of it still lands here. */
  folded: string[];
  mono: boolean;
  text: I18nText;
  table: I18nText | null;
  count: I18nText | null;
}
</script>

<script setup lang="ts">
import OCode from "@/lib/core/Code/OCode.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

defineProps<{
  row: StepRow;
  /** A row with nothing to open is not a button, so a citation focuses the row itself. */
  plain?: boolean;
}>();
</script>
