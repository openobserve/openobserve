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
  <button
    type="button"
    class="bg-surface-base border-border-subtle hover:border-border-strong focus-visible:outline-focus-ring-accent rounded-surface flex min-w-0 cursor-pointer flex-col gap-1 border p-2.5 text-start shadow-xs focus-visible:outline-2"
    :aria-label="ariaLabel"
    :data-test="`autoobserve-coverage-kpi-${signal}`"
    @click="emit('open')"
  >
    <span class="flex items-center gap-1.5">
      <span class="size-2 shrink-0 rounded-full" :class="DOT[health]" />
      <span class="text-text-secondary min-w-0 truncate text-xs">{{ label }}</span>
    </span>
    <span
      class="text-xl leading-tight font-semibold tabular-nums"
      :class="health === 'gap' ? 'text-text-muted' : 'text-text-heading'"
      >{{ value }}</span
    >
    <span class="flex items-center gap-2">
      <span
        v-if="health === 'gap'"
        class="text-text-secondary text-2xs"
        data-test="autoobserve-coverage-kpi-not-watched"
        >{{ t("autoobserve.coverage.badgeNotWatched") }}</span
      >
      <span
        v-else-if="delta"
        class="text-2xs inline-flex items-center gap-0.5 font-medium tabular-nums"
        :class="delta.tone"
      >
        <OIcon :name="delta.up ? 'arrow-upward' : 'arrow-downward'" size="xs" />{{ delta.text }}
      </span>
      <svg
        v-if="health !== 'gap' && line"
        class="ms-auto h-5 w-16 shrink-0 overflow-visible"
        viewBox="0 0 64 20"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path :d="line" fill="none" :stroke="stroke" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { Signal } from "./fixtures";

export type KpiHealth = "ok" | "drift" | "learning" | "gap";

const props = defineProps<{
  signal: Signal;
  label: I18nText;
  value: I18nText;
  ariaLabel: I18nText;
  health: KpiHealth;
  accent: `--${string}`;
  points: number[];
  delta: { text: I18nText; up: boolean; tone: string } | null;
}>();

const emit = defineEmits<{ open: [] }>();

const { t } = useI18nTyped();

const DOT: Record<KpiHealth, string> = {
  ok: "bg-status-success-text",
  drift: "bg-status-warning-text",
  learning: "bg-status-info-text",
  gap: "border border-border-strong",
};

const stroke = computed(() => `var(${props.accent})`);

const line = computed(() => {
  const pts = props.points;
  if (pts.length < 2) return "";
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const span = max - min || 1;
  return pts
    .map((v, i) => {
      const x = (64 * i) / (pts.length - 1);
      const y = 18 - (16 * (v - min)) / span;
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
});
</script>
