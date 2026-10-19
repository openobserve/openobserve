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
    ref="root"
    class="flex h-104 flex-col gap-2 max-lg:h-auto lg:max-h-[calc(var(--reka-popper-available-height,26rem)-1.625rem)]"
    data-test="rum-analytics-funnel-field-picker"
  >
    <template v-if="!field">
      <div v-if="fields.length" class="flex min-h-0 flex-1 flex-col max-lg:h-72">
        <GroupedFieldList
          keyboard
          :fields="listFields"
          :search="search"
          search-class="px-0"
          @update:search="(v: string) => (search = v)"
          @row-click="onRowClick"
        >
          <template #field-row="{ row }">
            <OFieldRow :data-test="`rum-analytics-funnel-field-picker-field-${row.field}`">
              <OFieldLabel :field="{ name: row.name }" />
            </OFieldRow>
          </template>
          <template #empty>
            <span
              class="text-text-secondary py-2 text-xs"
              data-test="rum-analytics-funnel-field-picker-no-field"
              >{{ t("rum.analytics.funnel.filterNoField") }}</span
            >
          </template>
        </GroupedFieldList>
      </div>
      <span v-else class="text-text-secondary text-xs">{{
        t("rum.analytics.funnel.filterNoFields")
      }}</span>
    </template>
    <template v-else>
      <span class="flex min-w-0 items-center gap-1.5">
        <OButton
          v-if="!lockField"
          variant="ghost"
          size="icon-sm"
          icon-left="arrow-back"
          :aria-label="t('rum.analytics.funnel.filterBack')"
          data-test="rum-analytics-funnel-field-picker-back"
          @click="back"
          ><OTooltip :content="t('rum.analytics.funnel.filterBack')"
        /></OButton>
        <span class="text-text-heading min-w-0 text-sm font-semibold break-all">{{
          filterFieldLabel(t, field)
        }}</span>
      </span>
      <OSelect
        :model-value="condition.id"
        :options="conditionOptions"
        :label="t('rum.analytics.funnel.filterCondition')"
        label-position="inside"
        size="sm"
        data-test="rum-analytics-funnel-field-picker-condition"
        @update:model-value="setCondition"
      />
      <OInput
        v-model="typed"
        size="sm"
        :placeholder="t('rum.analytics.funnel.filterSearchValues')"
        data-test="rum-analytics-funnel-field-picker-typed"
        @keydown.enter.prevent="addTyped"
      />
      <span
        v-if="valuesHere.status === 'loading'"
        class="text-text-secondary text-xs"
        data-test="rum-analytics-funnel-field-picker-loading"
        >{{ t("rum.analytics.funnel.filterLoading") }}</span
      >
      <span
        v-else-if="valuesHere.status === 'error'"
        class="text-text-secondary flex items-center gap-1.5 text-xs"
        data-test="rum-analytics-funnel-field-picker-error"
        >{{ t("rum.analytics.funnel.filterValuesFailed") }}
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="rum-analytics-funnel-field-picker-retry"
          @click="emit('load', field)"
          >{{ t("common.retry") }}</OButton
        ></span
      >
      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto max-lg:max-h-60">
        <span
          v-for="(row, i) in listed"
          :key="row.value"
          class="flex items-center justify-between gap-2 py-0.5"
          :data-test="`rum-analytics-funnel-field-picker-value-${i}`"
        >
          <OCheckbox
            :model-value="picked.includes(row.value)"
            :label="raw(row.value)"
            :disabled="!picked.includes(row.value) && full"
            @update:model-value="(v) => toggle(row.value, v === true)"
          />
          <span v-if="row.sessions !== null" class="text-text-secondary text-xs tabular-nums">{{
            addCommasToNumber(row.sessions)
          }}</span>
        </span>
      </div>
      <span
        v-if="typedNew"
        class="text-text-secondary text-xs"
        data-test="rum-analytics-funnel-field-picker-enter-hint"
        >{{ t("rum.analytics.funnel.filterPressEnter", { value: raw(typedNew) }) }}</span
      >
      <span class="border-border-default flex items-center justify-between gap-2 border-t pt-2">
        <span class="text-text-secondary flex items-center gap-1 text-xs">
          <span data-test="rum-analytics-funnel-field-picker-count">{{
            t("rum.analytics.funnel.filterSelected", { count: picked.length }, picked.length)
          }}</span>
          <OButton
            variant="ghost-primary"
            size="xs"
            :disabled="!picked.length"
            data-test="rum-analytics-funnel-field-picker-clear"
            @click="picked = []"
            >{{ t("rum.analytics.funnel.clear") }}</OButton
          >
        </span>
        <span class="flex gap-1.5">
          <OButton
            variant="ghost"
            size="sm"
            data-test="rum-analytics-funnel-field-picker-cancel"
            @click="emit('cancel')"
            >{{ t("common.cancel") }}</OButton
          >
          <OButton
            variant="primary"
            size="sm"
            :disabled="!picked.length"
            data-test="rum-analytics-funnel-field-picker-apply"
            @click="apply"
            >{{ t("common.apply") }}</OButton
          >
        </span>
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OFieldRow from "@/lib/lists/FieldList/OFieldRow.vue";
import OFieldLabel from "@/lib/lists/FieldList/OFieldLabel.vue";
import GroupedFieldList from "@/components/common/GroupedFieldList.vue";
import useFieldGrouping from "@/composables/useFieldGrouping";
import { applyFieldGrouping, buildSemanticIndex, type FieldObj } from "@/utils/fieldCategories";
import {
  conditionOf,
  FILTER_CONDITIONS,
  filterFieldLabel,
  type FilterCondition,
  type FilterValuesState,
} from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import { raw, useI18nTyped } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import { isFilterColumn, MAX_FILTER_VALUES } from "@/utils/rum/productAnalyticsModel";
import type { FunnelFilter } from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "SessionFieldPicker" });

const props = defineProps<{
  fields: readonly string[];
  fieldTypes?: Readonly<Record<string, string>>;
  values: FilterValuesState;
  initial?: FunnelFilter;
  lockField?: boolean;
  conditions?: readonly FilterCondition[];
}>();
const emit = defineEmits<{
  load: [string];
  apply: [FunnelFilter];
  cancel: [];
}>();
const { t } = useI18nTyped();
const { semanticIndex, keyFieldSet, keyGroupSet, loadGroupingContext } = useFieldGrouping();
// Without the org's semantic groups the Logs grouping still buckets by name prefix, then by type.
const prefixOnly = buildSemanticIndex([]);

const field = ref<string | null>(props.initial?.field ?? null);
const picked = ref<string[]>([...(props.initial?.values ?? [])]);
const condition = ref<FilterCondition>(conditionOf(props.initial ?? { op: "in" }));
const typed = ref("");
const search = ref("");

// Built-in fields are listed under their readable names, so the search finds "Browser family" too.
const listFields = computed(() => {
  const rows = props.fields.map((field): FieldObj => ({
    name: filterFieldLabel(t, field),
    field,
    dataType: props.fieldTypes?.[field] ?? "",
    ftsKey: false,
    isSchemaField: true,
    showValues: false,
    isInterestingField: false,
    group: "",
    streams: [],
  }));
  const builtin = rows.filter((r) => !isFilterColumn(r.field as string)).map((r) => r.name);
  return applyFieldGrouping(
    rows,
    semanticIndex.value ?? prefixOnly,
    new Set([...keyFieldSet.value, ...builtin.map((n) => n.toLowerCase())]),
    keyGroupSet.value,
  );
});

const offered = computed(() => props.conditions ?? FILTER_CONDITIONS);

const conditionOptions = computed(() =>
  offered.value.map((c) => ({
    label: t(`rum.analytics.funnel.conditions.${c.id}`),
    value: c.id,
  })),
);

const full = computed(() => picked.value.length >= MAX_FILTER_VALUES);

const idle: FilterValuesState = { field: null, status: "idle", rows: [] };
// Rows loaded for another field must never be offered for this one.
const valuesHere = computed(() => (props.values.field === field.value ? props.values : idle));

const loaded = computed(() => (valuesHere.value.status === "ok" ? valuesHere.value.rows : []));

// A picked value the loaded rows lack (typed, or from an edited filter) stays listed, ticked, on top.
const listed = computed<{ value: string; sessions: number | null }[]>(() => {
  const q = typed.value.trim().toLowerCase();
  const extra = picked.value
    .filter((v) => !loaded.value.some((r) => r.value === v))
    .map((value) => ({ value, sessions: null }));
  return [
    ...extra,
    ...(q ? loaded.value.filter((r) => r.value.toLowerCase().includes(q)) : loaded.value),
  ];
});

// A typed value no listed row carries is added with Enter.
const typedNew = computed(() => {
  const v = typed.value.trim();
  if (!v || full.value || picked.value.includes(v)) return "";
  return listed.value.some((r) => r.value === v) ? "" : v;
});

const root = ref<HTMLElement | null>(null);
// Switching between the field list and its values unmounts the focused row, so focus moves to the new view's input.
const focusIn = (testId: string) =>
  void nextTick(() =>
    root.value?.querySelector<HTMLInputElement>(`[data-test="${testId}"] input`)?.focus(),
  );

const pickField = (f: string) => {
  field.value = f;
  picked.value = [];
  typed.value = "";
  emit("load", f);
  focusIn("rum-analytics-funnel-field-picker-typed");
};

const onRowClick = (row: { name: string; field?: unknown; isGroup?: boolean }) => {
  if (!row.isGroup) pickField(typeof row.field === "string" ? row.field : row.name);
};

const back = () => {
  field.value = null;
  search.value = "";
  focusIn("o-field-list-search");
};

const setCondition = (id: unknown) => {
  condition.value = offered.value.find((c) => c.id === id) ?? offered.value[0];
};

const toggle = (value: string, on: boolean) => {
  if (on && !picked.value.includes(value) && !full.value) picked.value = [...picked.value, value];
  if (!on) picked.value = picked.value.filter((v) => v !== value);
};

const addTyped = () => {
  if (!typedNew.value) return;
  toggle(typedNew.value, true);
  typed.value = "";
};

const apply = () => {
  if (!field.value) return;
  const { op, not } = condition.value;
  emit("apply", {
    field: field.value,
    op,
    values: [...picked.value],
    ...(not ? { not: true as const } : {}),
  });
};

onMounted(() => {
  if (field.value) emit("load", field.value);
  // Grouping is best effort; without it the list stays flat, as in the Logs field list.
  loadGroupingContext("logs").catch(() => undefined);
});
</script>
