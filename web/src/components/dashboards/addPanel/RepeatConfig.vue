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
  <OEmptyState
    v-if="!repeatableVariables.length"
    size="inline"
    icon="repeat"
    :title="t('dashboard.repeat.emptyTitle')"
    :description="t('dashboard.repeat.emptyDescription')"
    data-test="dashboard-config-repeat-empty"
  />
  <div v-else class="flex flex-col gap-2.5" data-test="dashboard-config-repeat">
    <OSelect
      v-model="variableModel"
      :options="variableOptions"
      :label="t('dashboard.repeat.variable')"
      :placeholder="t('dashboard.repeat.none')"
      clearable
      data-test="dashboard-config-repeat-variable"
    />

    <p v-if="!repeat" class="text-text-secondary text-xs" data-test="dashboard-config-repeat-hint">
      {{ t("dashboard.repeat.pickHint") }}
    </p>

    <template v-else>
      <OToggleGroup
        type="single"
        label-position="top"
        :label="t('dashboard.repeat.direction')"
        v-model="directionModel"
        data-test="dashboard-config-repeat-direction"
      >
        <OToggleGroupItem
          v-for="option in directionOptions"
          :key="option.value"
          :value="option.value"
          size="sm"
          :icon-left="option.icon"
          :data-test="`dashboard-config-repeat-direction-${option.value}`"
          >{{ option.label }}</OToggleGroupItem
        >
      </OToggleGroup>

      <OSelect
        v-if="directionModel === 'h'"
        v-model="maxPerRowModel"
        :options="maxPerRowOptions"
        :label="t('dashboard.repeat.maxPerRow')"
        data-test="dashboard-config-repeat-max-per-row"
      />

      <p class="text-text-secondary text-xs" data-test="dashboard-config-repeat-preview">
        {{ previewText }}
      </p>
      <p
        v-if="resolved && !resolved.more && resolved.total > resolved.values.length"
        class="text-text-secondary text-xs"
        data-test="dashboard-config-repeat-capped"
      >
        {{
          t("dashboard.repeat.previewCapped", {
            count: resolved.values.length,
            total: resolved.total,
          })
        }}
      </p>
      <p class="text-text-secondary text-xs">{{ t("dashboard.repeat.collapseHint") }}</p>
      <p class="text-text-secondary text-xs" data-test="dashboard-config-repeat-title-hint">
        {{ t("dashboard.repeat.titleHint", { example: `$${repeat.variable}` }) }}
      </p>
    </template>
    <p class="text-text-secondary text-xs" data-test="dashboard-config-repeat-quote-hint">
      {{ t("dashboard.repeat.quoteHint", quoteExamples) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import {
  REPEAT_DEFAULT_MAX_PER_ROW,
  REPEAT_MAX_ITEMS,
  REPEAT_MAX_PER_ROW_OPTIONS,
  findRepeatVariable,
  isAllSelected,
  getRepeatableVariables,
  resolveRepeatValues,
  type RepeatConfig,
  type RepeatDirection,
} from "@/utils/dashboard/repeatByVariable";

const props = defineProps<{ variablesData?: { values?: any[] } | null }>();

const PREVIEW_VALUES = 3;

const { t } = useI18nTyped();
const pageKey = inject("dashboardPanelDataPageKey", "dashboard");
const { dashboardPanelData } = useDashboardPanelData(pageKey, t);

const repeat = computed<RepeatConfig | undefined>(() => dashboardPanelData.data.repeat);

const quoteExamples = computed(() => {
  const name = repeat.value?.variable ?? "var";
  return { equals: raw(`= $${name}`), inList: raw(`IN ($${name})`) };
});

const repeatableVariables = computed(() => getRepeatableVariables(props.variablesData?.values));

const variableOptions = computed(() =>
  repeatableVariables.value.map((variable) => ({
    label: raw(`$${variable.name}`),
    value: variable.name,
  })),
);

const variableModel = computed({
  get: () => repeat.value?.variable ?? null,
  set: (name: string | null) => {
    if (!name) {
      delete dashboardPanelData.data.repeat;
      return;
    }
    dashboardPanelData.data.repeat = {
      direction: "h",
      maxPerRow: REPEAT_DEFAULT_MAX_PER_ROW,
      ...repeat.value,
      variable: name,
    };
  },
});

const directionModel = computed({
  get: (): RepeatDirection => repeat.value?.direction ?? "h",
  set: (direction: RepeatDirection) => {
    if (repeat.value && direction) dashboardPanelData.data.repeat = { ...repeat.value, direction };
  },
});

const maxPerRowModel = computed({
  get: () => repeat.value?.maxPerRow ?? REPEAT_DEFAULT_MAX_PER_ROW,
  set: (maxPerRow: number) => {
    if (repeat.value) dashboardPanelData.data.repeat = { ...repeat.value, maxPerRow };
  },
});

const directionOptions = computed(() => [
  { value: "h" as const, label: t("dashboard.repeat.horizontal"), icon: "view-column" as const },
  { value: "v" as const, label: t("dashboard.repeat.vertical"), icon: "view-agenda" as const },
]);

const maxPerRowOptions = REPEAT_MAX_PER_ROW_OPTIONS.map((value) => ({
  label: raw(String(value)),
  value,
}));

const selectedVariable = computed(() =>
  repeat.value ? findRepeatVariable(props.variablesData?.values, repeat.value.variable) : null,
);

const resolved = computed(() =>
  selectedVariable.value ? resolveRepeatValues(selectedVariable.value) : null,
);

const previewText = computed(() => {
  const values = resolved.value?.values ?? [];
  const variable = `$${repeat.value?.variable ?? ""}`;
  // The editor only has the variable's capped options; the dashboard fetches what "All" covers.
  if (isAllSelected(selectedVariable.value) && (!values.length || resolved.value?.more)) {
    return t("dashboard.repeat.previewAll", { variable, max: REPEAT_MAX_ITEMS });
  }
  if (resolved.value?.pending) return t("dashboard.repeat.loadingValues", { variable });
  if (!values.length) return t("dashboard.repeat.previewEmpty", { variable });
  const shown = values.slice(0, PREVIEW_VALUES).join(", ");
  return t(
    "dashboard.repeat.preview",
    { count: values.length, values: values.length > PREVIEW_VALUES ? `${shown}, …` : shown },
    values.length,
  );
});
</script>
