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

<!-- Live condition rows, [field] [is | starts with] [value] ✕, shared by the rule editor and Test routing. -->
<template>
  <div class="flex flex-col gap-2" :data-test="`${testPrefix}-conditions`">
    <div
      v-for="(row, index) in rows"
      :key="row.key"
      class="flex flex-wrap items-center gap-2"
      :data-test="`${testPrefix}-row-${index}`"
    >
      <OSelect
        :model-value="row.name"
        :options="fieldOptionsFor(row)"
        :placeholder="t('oncall.ruleEditorFieldPlaceholder')"
        size="sm"
        width="sm"
        searchable
        :aria-label="t('oncall.conditionFieldAria')"
        :data-test="`${testPrefix}-field-${index}`"
        @update:model-value="(v: unknown) => setField(row, v)"
      />
      <OSelect
        :model-value="row.op"
        :options="operatorOptions"
        :searchable="false"
        size="sm"
        width="xs"
        :aria-label="t('oncall.conditionOperatorAria')"
        :data-test="`${testPrefix}-op-${index}`"
        @update:model-value="(v: unknown) => (row.op = v === 'prefix' ? 'prefix' : 'is')"
      />
      <span class="min-w-40 flex-1">
        <OSelect
          :ref="(el) => setValueSelect(row.key, el)"
          :model-value="row.value || null"
          :options="valueOptionsFor(row)"
          :placeholder="t('oncall.ruleEditorPickValue')"
          :disabled="!row.name"
          size="sm"
          searchable
          creatable
          :aria-label="t('oncall.conditionValueAria')"
          :data-test="`${testPrefix}-value-${index}`"
          @update:model-value="(v: unknown) => setValue(row, v === null ? '' : String(v))"
          @create="(v: string) => createValue(row, v)"
        />
      </span>
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="close"
        :aria-label="t('oncall.ruleEditorRemoveCondition')"
        :data-test="`${testPrefix}-remove-${index}`"
        @click="removeRow(index)"
      />
      <OText
        v-if="row.touched && row.name && !row.value.trim()"
        variant="meta"
        class="basis-full"
        :data-test="`${testPrefix}-pick-value-${index}`"
      >
        {{ t("oncall.ruleEditorPickValue") }}
      </OText>
    </div>

    <OButton
      variant="outline"
      size="sm"
      icon-left="add"
      class="self-start"
      :data-test="`${testPrefix}-add-condition`"
      @click="addRow"
    >
      {{ t("oncall.ruleEditorAnd") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { DimensionCatalogue, DiscoveredService, UnroutedSignal } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  SERVICE_DIMENSION,
  fieldLabel,
  normalizeDimensionValue,
  routingFieldIds,
} from "@/utils/oncall";

type Operator = "is" | "prefix";

interface ConditionRow {
  key: number;
  name: string;
  op: Operator;
  value: string;
  /** Set once a value was picked, so an untouched row never repeats its own placeholder. */
  touched: boolean;
}

const props = withDefaults(
  defineProps<{
    /** Read once on mount; a host re-seeds by changing the component's `key`. */
    modelValue?: Record<string, string>;
    aliases?: { id: string; display?: string }[];
    catalogue?: DimensionCatalogue;
    /** Their values join the catalogue's as pickable options. */
    signals?: UnroutedSignal[];
    /** Offered as values of the service field. */
    services?: DiscoveredService[];
    /** Existing rules: the fields they pin are offered even when discovery has not seen them. */
    rules?: { dimensions: Record<string, string> }[];
    testPrefix?: string;
  }>(),
  {
    modelValue: () => ({}),
    aliases: () => [],
    catalogue: () => ({ present: [], values: {} }),
    signals: () => [],
    services: () => [],
    rules: () => [],
    testPrefix: "oncall-rule-editor",
  },
);

const emit = defineEmits<{
  /** Complete rows only, with `starts with` written as the engine's trailing `*`. */
  (e: "update:modelValue", dimensions: Record<string, string>): void;
}>();

const { t } = useI18nTyped();

let nextKey = 0;

/// What this org emits or already routes on; the whole vocabulary only when none of that is known.
const fieldIds = computed<string[]>(() => {
  const known = routingFieldIds(props.catalogue.present, props.signals, props.rules);
  return known.length ? known : props.aliases.map((alias) => alias.id);
});

function rowsFrom(dimensions: Record<string, string>): ConditionRow[] {
  return Object.keys(dimensions)
    .sort()
    .map((name) => {
      const value = String(dimensions[name]);
      const prefix = value.endsWith("*");
      return {
        key: nextKey++,
        name,
        op: prefix ? "prefix" : "is",
        value: prefix ? value.slice(0, -1) : value,
        touched: false,
      };
    });
}

function emptyRow(taken: ConditionRow[]): ConditionRow {
  const used = new Set(taken.map((row) => row.name));
  const service = fieldIds.value.includes(SERVICE_DIMENSION) && !used.has(SERVICE_DIMENSION);
  return {
    key: nextKey++,
    name: service ? SERVICE_DIMENSION : "",
    op: "is",
    value: "",
    touched: false,
  };
}

const seeded = rowsFrom(props.modelValue);
const rows = ref<ConditionRow[]>(seeded.length ? seeded : [emptyRow([])]);

/// A half-filled row is ignored, never emitted and never blocking.
const complete = computed<Record<string, string>>(() =>
  Object.fromEntries(
    rows.value
      .filter((row) => row.name && row.value.trim())
      .map((row) => {
        const value = normalizeDimensionValue(row.value);
        return [row.name, row.op === "prefix" ? `${value}*` : value];
      }),
  ),
);

watch(complete, (dimensions) => emit("update:modelValue", dimensions), {
  deep: true,
  immediate: true,
});

function labelOf(id: string): I18nText {
  return raw(fieldLabel(id, props.aliases));
}

function fieldOptionsFor(row: ConditionRow) {
  const taken = new Set(rows.value.filter((other) => other !== row).map((other) => other.name));
  const ids =
    row.name && !fieldIds.value.includes(row.name) ? [...fieldIds.value, row.name] : fieldIds.value;
  return ids.filter((id) => !taken.has(id)).map((id) => ({ label: labelOf(id), value: id }));
}

const operatorOptions = computed(() => [
  { label: t("oncall.ruleEditorOpIs"), value: "is" },
  { label: t("oncall.ruleEditorOpStartsWith"), value: "prefix" },
]);

/// Known values first, by how many services carry them, then by how often an unowned alert fired with them.
function valueOptionsFor(row: ConditionRow) {
  if (!row.name) return [];
  const services = new Map<string, number>(Object.entries(props.catalogue.values[row.name] ?? {}));
  const fired = new Map<string, number>();
  const known = new Set<string>(services.keys());
  props.signals.forEach((signal) => {
    const value = signal.dimensions?.[row.name];
    if (!value) return;
    known.add(value);
    fired.set(value, (fired.get(value) ?? 0) + signal.occurrences);
  });
  if (row.name === SERVICE_DIMENSION) props.services.forEach((service) => known.add(service.name));
  if (row.value) known.add(row.value);
  const weight = (value: string) => [fired.get(value) ?? 0, services.get(value) ?? 0];
  return (
    [...known]
      .sort((a, b) => {
        const [fa, sa] = weight(a);
        const [fb, sb] = weight(b);
        return fb - fa || sb - sa || a.localeCompare(b);
      })
      // Not `subLabelInline`: the stacked layout cuts a long value with a tooltip instead of clipping it.
      .map((value) => ({ label: raw(value), value, subLabel: firesOf(fired.get(value) ?? 0) }))
  );
}

/// One unit on every value, the one Unrouted and the match count speak: alerts in the last 30 days.
function firesOf(fires: number): I18nText | undefined {
  return fires ? t("oncall.routingFiresWindow", { count: fires }, fires) : undefined;
}

function setValue(row: ConditionRow, value: string) {
  row.value = value;
  row.touched = true;
}

const valueSelects = new Map<number, { close: () => void }>();

function setValueSelect(key: number, el: unknown) {
  if (el && typeof (el as { close?: unknown }).close === "function") {
    valueSelects.set(key, el as { close: () => void });
  } else {
    valueSelects.delete(key);
  }
}

function createValue(row: ConditionRow, value: string) {
  setValue(row, value);
  valueSelects.get(row.key)?.close();
}

function setField(row: ConditionRow, value: unknown) {
  const name = value === null ? "" : String(value);
  if (name === row.name) return;
  row.name = name;
  row.value = "";
}

function addRow() {
  rows.value.push(emptyRow(rows.value));
}

function removeRow(index: number) {
  rows.value.splice(index, 1);
  if (!rows.value.length) rows.value.push(emptyRow([]));
}
</script>
