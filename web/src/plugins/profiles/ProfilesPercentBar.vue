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
  <div class="flex w-full min-w-0 items-center gap-2" :class="showBar ? undefined : 'justify-end'">
    <span
      v-if="showLabel"
      class="text-text-secondary w-12 shrink-0 text-right text-xs tabular-nums"
      >{{ label }}</span
    >
    <div
      v-if="showBar"
      class="bg-surface-page h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
      :role="showLabel ? undefined : 'img'"
      :aria-label="showLabel ? undefined : label"
    >
      <div
        class="bg-accent h-full rounded-full transition-[width]"
        :style="{ width: `${widthPct}%` }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    value: number;
    total: number;
    showLabel?: boolean;
    showBar?: boolean;
  }>(),
  { showLabel: true, showBar: true },
);

const { t } = useI18nTyped();

const widthPct = computed(() => {
  if (props.total <= 0 || props.value <= 0) return 0;
  return Math.min(100, (props.value / props.total) * 100);
});

const label = computed(() => {
  const ratio = props.total <= 0 ? 0 : (props.value / props.total) * 100;
  const value = ratio.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return t("profiles.percentValue", { value });
});
</script>
