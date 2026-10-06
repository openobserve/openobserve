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
  <div class="flex flex-col gap-1" data-test="alert-forecast-fields">
    <div
      class="rounded-default text-compact flex items-start gap-3 px-3 py-2 max-md:flex-col max-md:gap-1"
    >
      <span
        class="text-text-heading text-compact w-40 min-w-40 shrink-0 leading-8.5 font-bold whitespace-nowrap"
        >{{ t("alerts.forecast.alertWhen") }} *</span
      >
      <div class="flex flex-wrap items-start gap-2">
        <OFormSelect
          name="_ui.forecast.direction"
          :options="directionOptions"
          :searchable="false"
          width="xs"
          data-test="alert-forecast-direction"
        />
        <OFormInput
          name="_ui.forecast.T"
          type="number"
          width="xs"
          :placeholder="t('alerts.forecast.threshold')"
          :debounce="300"
          data-test="alert-forecast-threshold"
        />
        <span class="text-text-secondary leading-8.5">{{ t("alerts.forecast.within") }}</span>
        <OFormInput
          name="_ui.forecast.H"
          type="number"
          width="xs"
          :debounce="300"
          data-test="alert-forecast-horizon"
        >
          <template #suffix>{{ t("alerts.forecast.days") }}</template>
        </OFormInput>
      </div>
    </div>
    <div
      class="rounded-default text-compact flex items-start gap-3 px-3 py-2 max-md:flex-col max-md:gap-1"
    >
      <span
        class="text-text-heading text-compact w-40 min-w-40 shrink-0 leading-8.5 font-bold whitespace-nowrap"
        >{{ t("alerts.forecast.basedOn") }}</span
      >
      <div class="flex flex-col gap-1">
        <OFormSelect
          name="_ui.forecast.W"
          :options="windowOptions"
          :searchable="false"
          width="sm"
          data-test="alert-forecast-window"
        />
        <span class="text-text-secondary text-xs" data-test="alert-forecast-help">{{
          t("alerts.forecast.help")
        }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import {
  forecastModeFields,
  forecastRowTemplate,
  type ForecastAlert,
} from "@/utils/alerts/forecastAlert";

/** A row template this form wrote, which it may rewrite when the threshold changes. */
const GENERATED_ROW_TEMPLATE = /^reaches \S+ in \{value\} days$/;

const { t } = useI18nTyped();
const form: any = inject(FORM_CONTEXT_KEY, null);

const directionOptions = computed(() => [
  { label: t("alerts.forecast.rises"), value: "rises" },
  { label: t("alerts.forecast.falls"), value: "falls" },
]);

const windowOptions = computed(() => [
  { label: t("alerts.forecast.window6h"), value: "6h" },
  { label: t("alerts.forecast.window1d"), value: "1d" },
  { label: t("alerts.forecast.window2d"), value: "2d" },
  { label: t("alerts.forecast.window7d"), value: "7d" },
]);

// Inputs hand back strings, and a blank one must stay blank rather than read as 0.
const toNumber = (value: unknown) =>
  value === "" || value === null || value === undefined ? Number.NaN : Number(value);

const forecast = form?.useStore?.((s: any) => s.values?._ui?.forecast);

watch(
  () => forecast?.value,
  (value: ForecastAlert | null | undefined) => {
    if (!value) return;
    const T = toNumber(value.T);
    const fields = forecastModeFields({ ...value, T, H: toNumber(value.H) });
    Object.entries(fields).forEach(([path, next]) => form.setFieldValue(path, next));
    const row = String(form.getFieldValue("row_template") ?? "");
    if (Number.isFinite(T) && (!row.trim() || GENERATED_ROW_TEMPLATE.test(row))) {
      form.setFieldValue("row_template", forecastRowTemplate(T));
    }
  },
  { deep: true, immediate: true },
);
</script>
