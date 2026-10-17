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
  <div
    class="rounded-surface border-border-default bg-surface-base flex flex-wrap items-center gap-1 border p-1 shadow-xs"
    data-test="fleet-flow-legend"
  >
    <OButton
      v-for="item in items"
      :key="item.key"
      variant="ghost"
      size="xs"
      :active="filter === item.key"
      :data-test="`fleet-flow-legend-${item.key}`"
      @click="filter = filter === item.key ? null : item.key"
    >
      <span class="h-2 w-2 shrink-0 rounded-full" :class="SEVERITY_DOT[item.key]" />
      {{ item.label }}
      <span class="text-text-secondary tabular-nums">{{ counts[item.key] ?? 0 }}</span>
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { SEVERITY_DOT, type PathSeverity } from "./flowIssues";

const props = defineProps<{ counts: Partial<Record<PathSeverity, number>> }>();
const filter = defineModel<PathSeverity | null>({ required: true });

const { t } = useI18nTyped();

const items = computed<{ key: PathSeverity; label: I18nText }[]>(() => [
  { key: "error", label: t("fleet.flowIssues.legendError") },
  { key: "warning", label: t("fleet.flowIssues.legendWarning") },
  { key: "info", label: t("fleet.flowIssues.legendInfo") },
  { key: "progress", label: t("fleet.flowIssues.legendProgress") },
  { key: "healthy", label: t("fleet.flowIssues.legendHealthy") },
  ...(props.counts.restricted
    ? [{ key: "restricted" as const, label: t("fleet.flow.metricsRestricted") }]
    : []),
]);
</script>
