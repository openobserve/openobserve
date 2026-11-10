<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import type { SeverityValue } from "@/utils/security/eventQuery";

const props = defineProps<{
  fieldNames: string[];
  hasSeverity: boolean;
  severityOptions: SelectOption[];
  severity: SeverityValue[];
  /** Top values of a field over the current window, for the value picker. */
  loadValues: (field: string) => Promise<{ value: string }[]>;
}>();
const emit = defineEmits<{
  "update:severity": [values: SeverityValue[]];
  add: [field: string, value: string, op: string];
}>();
const { t } = useI18nTyped();

const builderField = ref("");
const builderOp = ref("=");
const builderValue = ref("");
const builderValueOptions = ref<SelectOption[]>([]);
const builderValuesLoading = ref(false);

const FILTER_OPS = computed(() => [
  { label: t("siem.op.eq"), value: "=" },
  { label: t("siem.op.neq"), value: "!=" },
  { label: t("siem.op.contains"), value: "contains" },
  { label: t("siem.op.notContains"), value: "not_contains" },
]);
const fieldNameOptions = computed(() => props.fieldNames.map((n) => ({ label: raw(n), value: n })));

watch(builderField, async (field) => {
  builderValue.value = "";
  builderValueOptions.value = [];
  if (!field) {
    builderValuesLoading.value = false;
    return;
  }
  builderValuesLoading.value = true;
  const values = await props.loadValues(field);
  // Another field may have been picked while these loaded.
  if (builderField.value !== field) return;
  builderValueOptions.value = values.map((v) => ({ label: raw(v.value), value: v.value }));
  builderValuesLoading.value = false;
});

function commitFilter() {
  const field = builderField.value.trim();
  const value = String(builderValue.value ?? "").trim();
  if (!field || !value) return;
  emit("add", field, value, builderOp.value);
  builderValue.value = "";
}

function onSeverityChange(v: unknown) {
  const next = (Array.isArray(v) ? v : v == null ? [] : [v])
    .filter((x) => x !== null && x !== undefined && x !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n)) as SeverityValue[];
  const cur = props.severity;
  if (next.length === cur.length && next.every((n, i) => n === cur[i])) return;
  emit("update:severity", next);
}
</script>

<template>
  <div class="contents">
    <div v-if="hasSeverity" class="w-52 shrink-0">
      <OSelect
        :aria-label="t('siem.aria.severityFilter')"
        :model-value="severity"
        :options="severityOptions"
        multiple
        clearable
        :placeholder="t('siem.events.allSeverities')"
        data-test="security-events-severity-filter"
        @update:model-value="onSeverityChange"
      />
    </div>
    <OSeparator vertical class="mx-1 h-5" />
    <div class="w-48 shrink-0">
      <OSelect
        :aria-label="t('siem.aria.filterField')"
        v-model="builderField"
        :options="fieldNameOptions"
        :placeholder="t('siem.events.field')"
        searchable
        data-test="security-events-builder-field"
      />
    </div>
    <div class="w-36 shrink-0">
      <OSelect
        :aria-label="t('siem.aria.filterOperator')"
        v-model="builderOp"
        :options="FILTER_OPS"
        data-test="security-events-builder-op"
      />
    </div>
    <div class="w-56 shrink-0">
      <OSelect
        :aria-label="t('siem.aria.filterValue')"
        v-model="builderValue"
        :options="builderValueOptions"
        :loading="builderValuesLoading"
        :disabled="!builderField"
        :placeholder="t('siem.events.value')"
        searchable
        creatable
        data-test="security-events-builder-value"
        @create="(v: string) => (builderValue = v)"
      />
    </div>
    <OButton
      variant="outline"
      size="sm"
      icon-left="add"
      :disabled="!builderField || !builderValue"
      data-test="security-events-builder-add"
      @click="commitFilter"
    >
      {{ t("siem.events.addFilter") }}
    </OButton>
  </div>
</template>
