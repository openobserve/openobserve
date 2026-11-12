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
  <div class="flex flex-col gap-2" data-test="autoobserve2-headline-coverage-bar">
    <div class="flex h-2 gap-0.5 overflow-hidden rounded-full">
      <button
        v-for="seg in shown"
        :key="seg.key"
        type="button"
        tabindex="-1"
        aria-hidden="true"
        class="h-full basis-0 transition-opacity hover:opacity-80"
        :class="seg.color"
        :style="{ flexGrow: seg.count }"
        :data-test="`autoobserve2-headline-bar-${seg.key}`"
        @click="emit('select', seg.filter)"
      />
    </div>
    <div class="flex flex-wrap gap-x-4 gap-y-1">
      <button
        v-for="seg in shown"
        :key="seg.key"
        type="button"
        class="text-text-body hover:text-text-heading focus-visible:ring-focus-ring-accent rounded-default flex min-h-6 items-center gap-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
        :data-test="`autoobserve2-headline-legend-${seg.key}`"
        @click="emit('select', seg.filter)"
      >
        <span class="size-2 rounded-full" :class="seg.color" />
        {{ seg.label }}
        <span class="text-text-heading font-medium tabular-nums">{{ seg.count }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { coverageWord } from "../live/liveCopy";

const props = defineProps<{
  watching: number;
  learning: number;
  gaps: number;
  live?: boolean;
}>();

const emit = defineEmits<{ select: [filter: "watching" | "learning" | "attention"] }>();

const { t } = useI18nTyped();

// Same segments and colours as the coverage drawer's bar, so the two read as one thing.
const shown = computed(() =>
  [
    {
      key: props.live ? "watched" : "watching",
      count: props.watching,
      color: "bg-badge-success-soft-text",
      filter: "watching" as const,
      label: props.live
        ? coverageWord(t, "watched")
        : t("autoobserve2.coverageDrawer.legend.watching"),
    },
    {
      key: "learning",
      count: props.learning,
      color: "bg-status-info-text",
      filter: "learning" as const,
      label: t("autoobserve2.coverageDrawer.legend.learning"),
    },
    {
      key: props.live ? "gap" : "unseen",
      count: props.gaps,
      color: "bg-badge-amber-soft-text",
      filter: "attention" as const,
      label: props.live ? coverageWord(t, "gap") : t("autoobserve2.coverageDrawer.legend.unseen"),
    },
  ].filter((seg) => seg.count > 0),
);
</script>
