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
    class="rounded-default border-border-default bg-surface-panel flex flex-wrap items-center gap-0.5 border p-0.5"
    role="group"
    :aria-label="t('fleet.flowIssues.legend')"
    data-test="fleet-flow-legend"
  >
    <OButton
      v-for="item in items"
      :key="item.key"
      variant="ghost"
      size="xs"
      :class="shown(item.key) && counts[item.key] ? '' : 'text-text-muted'"
      :aria-pressed="shown(item.key)"
      :title="t('fleet.flowIssues.legendToggle')"
      :data-test="`fleet-flow-legend-${item.key}`"
      @click="toggle(item.key)"
    >
      <span
        class="h-2 w-2 shrink-0 rounded-full"
        :class="[SEVERITY_DOT[item.key], shown(item.key) && counts[item.key] ? '' : 'opacity-40']"
      />
      <span :class="shown(item.key) ? '' : 'line-through'">{{ item.label }}</span>
      <span class="tabular-nums" :class="counts[item.key] ? 'text-text-secondary' : ''">{{
        counts[item.key] ?? 0
      }}</span>
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { SEVERITY_DOT, type PathSeverity } from "./flowIssues";

const props = defineProps<{ counts: Partial<Record<PathSeverity, number>> }>();
// The levels hidden from the map; empty hides nothing, so a fresh map shows everything.
const hidden = defineModel<PathSeverity[]>({ required: true });

const { t } = useI18nTyped();
const shown = (key: PathSeverity) => !hidden.value.includes(key);
const toggle = (key: PathSeverity) => {
  hidden.value = shown(key) ? [...hidden.value, key] : hidden.value.filter((k) => k !== key);
};

const items = computed<{ key: PathSeverity; label: I18nText }[]>(() => [
  { key: "healthy", label: t("fleet.flowIssues.legendHealthy") },
  { key: "progress", label: t("fleet.flowIssues.legendProgress") },
  { key: "error", label: t("fleet.flowIssues.legendError") },
  { key: "warning", label: t("fleet.flowIssues.legendWarning") },
  { key: "info", label: t("fleet.flowIssues.legendInfo") },
  ...(props.counts.restricted
    ? [{ key: "restricted" as const, label: t("fleet.flow.metricsRestricted") }]
    : []),
]);
</script>
