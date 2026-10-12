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
  <div class="flex flex-col gap-2" data-test="rum-analytics-funnel-field-picker">
    <template v-if="!field">
      <span class="text-text-secondary text-xs font-semibold">{{
        t("rum.analytics.funnel.filterWho")
      }}</span>
      <div class="flex flex-wrap gap-1.5">
        <OButton
          v-for="f in fields"
          :key="f"
          variant="outline"
          size="sm"
          :data-test="`rum-analytics-funnel-field-picker-field-${f}`"
          @click="pickField(f)"
          >{{ fieldLabel(f) }}</OButton
        >
      </div>
      <span v-if="!fields.length" class="text-text-secondary text-xs">{{
        t("rum.analytics.funnel.filterNoFields")
      }}</span>
    </template>
    <template v-else>
      <span class="flex items-center gap-1.5">
        <OButton
          v-if="!lockField"
          variant="ghost"
          size="icon-sm"
          icon-left="arrow-back"
          :aria-label="t('rum.analytics.funnel.filterBack')"
          data-test="rum-analytics-funnel-field-picker-back"
          @click="field = null"
          ><OTooltip :content="t('rum.analytics.funnel.filterBack')"
        /></OButton>
        <span class="text-text-heading text-sm font-semibold">{{
          t("rum.analytics.funnel.filterIsOneOf", { field: fieldLabel(field) })
        }}</span>
      </span>
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
      <div class="flex max-h-60 flex-col overflow-y-auto">
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
      <span class="flex items-center gap-1.5">
        <OInput
          v-model="typed"
          size="sm"
          class="min-w-0 flex-1"
          :placeholder="t('rum.analytics.funnel.filterTyped')"
          data-test="rum-analytics-funnel-field-picker-typed"
          @keydown.enter.prevent="addTyped"
        />
        <OButton
          variant="outline"
          size="sm"
          :disabled="!typed.trim() || full"
          data-test="rum-analytics-funnel-field-picker-add-typed"
          @click="addTyped"
          >{{ t("rum.analytics.funnel.filterAddValue") }}</OButton
        >
      </span>
      <span class="text-text-secondary text-xs">{{ t("rum.analytics.funnel.filterCaption") }}</span>
      <span class="flex justify-end gap-1.5">
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
          @click="emit('apply', field, [...picked])"
          >{{ t("common.apply") }}</OButton
        >
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { FilterValuesState } from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import { MAX_FILTER_VALUES, type SessionField } from "@/utils/rum/productAnalyticsModel";

defineOptions({ name: "SessionFieldPicker" });

const props = defineProps<{
  fields: readonly SessionField[];
  values: FilterValuesState;
  initialField?: SessionField;
  initialValues?: string[];
  lockField?: boolean;
}>();
const emit = defineEmits<{
  load: [SessionField];
  apply: [SessionField, string[]];
  cancel: [];
}>();
const { t } = useI18nTyped();

const field = ref<SessionField | null>(props.initialField ?? null);
const picked = ref<string[]>([...(props.initialValues ?? [])]);
const typed = ref("");

const fieldLabel = (f: SessionField): I18nText => t(`rum.analytics.exclusions.fields.${f}`);

const full = computed(() => picked.value.length >= MAX_FILTER_VALUES);

const idle: FilterValuesState = { field: null, status: "idle", rows: [] };
// Rows loaded for another field must never be offered for this one.
const valuesHere = computed(() => (props.values.field === field.value ? props.values : idle));

// A picked value the top list does not carry, typed or kept from the saved filter, stays listed without a count.
const listed = computed<{ value: string; sessions: number | null }[]>(() => {
  const rows = valuesHere.value.status === "ok" ? valuesHere.value.rows : [];
  const known = new Set(rows.map((r) => r.value));
  return [
    ...picked.value.filter((v) => !known.has(v)).map((value) => ({ value, sessions: null })),
    ...rows,
  ];
});

const pickField = (f: SessionField) => {
  field.value = f;
  picked.value = [];
  emit("load", f);
};

const toggle = (value: string, on: boolean) => {
  if (on && !picked.value.includes(value) && !full.value) picked.value = [...picked.value, value];
  if (!on) picked.value = picked.value.filter((v) => v !== value);
};

const addTyped = () => {
  const v = typed.value.trim();
  if (!v || full.value) return;
  toggle(v, true);
  typed.value = "";
};

onMounted(() => {
  if (field.value) emit("load", field.value);
});
</script>
