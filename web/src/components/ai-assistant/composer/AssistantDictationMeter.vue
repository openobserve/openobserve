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
    class="text-text-secondary inline-flex min-w-0 items-center gap-1.5 text-xs"
    data-test="assistant-dictate-status"
  >
    <span
      aria-hidden="true"
      class="inline-flex h-3 items-center gap-0.5"
      data-test="assistant-dictate-level"
    >
      <span class="bg-accent rounded-default size-1.5 motion-safe:hidden" />
      <span
        v-for="weight in BAR_WEIGHTS"
        :key="weight"
        class="bg-accent rounded-default h-3 w-0.5 origin-center motion-reduce:hidden"
        :style="{ transform: `scaleY(${barScale(weight)})` }"
      />
    </span>
    <span class="min-w-0 truncate">{{ label }}</span>
    <span aria-hidden="true" class="tabular-nums" data-test="assistant-dictate-elapsed">{{
      elapsed
    }}</span>
  </span>
</template>

<script lang="ts">
import type { I18nText } from "@/types/i18n";

export interface AssistantDictationMeterProps {
  label: I18nText;
  /** 0–1. */
  level: number;
  elapsedMs: number;
}

const BAR_WEIGHTS = [0.6, 1, 0.8, 0.5] as const;

// A flat bar still has to read as a bar.
const MIN_BAR_SCALE = 0.2;
</script>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<AssistantDictationMeterProps>();

const elapsed = computed(() => {
  const seconds = Math.floor(props.elapsedMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
});

function barScale(weight: number): number {
  return Math.max(MIN_BAR_SCALE, props.level * weight);
}
</script>
