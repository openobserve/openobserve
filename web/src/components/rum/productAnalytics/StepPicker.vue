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
  <OSelect
    :model-value="value"
    :options="options"
    :placeholder="placeholder"
    :loading="loading"
    :disabled="disabled"
    :clearable="clearable"
    :error-message="failed ? t('rum.analytics.picker.loadFailed') : undefined"
    icon-key="icon"
    searchable
    :search-debounce="300"
    size="sm"
    :data-test="dataTest"
    @open="load"
    @search="onSearch"
    @update:model-value="onPick"
  >
    <template #empty>
      <span v-if="failed" :data-test="`${dataTest}-empty-error`">{{
        t("rum.analytics.picker.loadFailed")
      }}</span>
      <span v-else>{{ t("components.select.noOptionsFound") }}</span>
    </template>
  </OSelect>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import useProductAnalytics, {
  PICKER_LIMIT,
  type PickerOption,
} from "@/composables/rum/useProductAnalytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { StepKind, StepRef } from "@/utils/rum/productAnalyticsQueries";

const FULL_LIST = PICKER_LIMIT;
const KIND_ICON: Record<StepKind, string> = { p: "article", c: "ads-click", e: "bookmark" };

const props = withDefaults(
  defineProps<{
    modelValue: StepRef | null;
    placeholder: I18nText;
    events: NamedEvent[];
    dataTest: string;
    kinds?: StepKind[];
    disabled?: boolean;
    clearable?: boolean;
  }>(),
  { kinds: () => ["e", "p", "c"], disabled: false, clearable: false },
);
const emit = defineEmits<{ "update:modelValue": [StepRef | null] }>();
const { t } = useI18nTyped();
const pa = useProductAnalytics();

const rows = ref<PickerOption[]>([]);
const searched = ref<{ scope: string; options: PickerOption[] }>({ scope: "", options: [] });
const loading = ref(false);
const failed = ref(false);
let loadedKey = "";

const encode = (s: { kind: StepKind; key: string }) => `${s.kind}:${s.key}`;

const value = computed(() => (props.modelValue ? encode(props.modelValue) : null));

const options = computed<SelectOption[]>(() => {
  const seen = new Set<string>();
  const byKind: Record<StepKind, SelectOption[]> = { e: [], p: [], c: [] };
  for (const e of props.events) {
    byKind.e.push({
      label: raw(e.name),
      value: encode({ kind: "e", key: e.id }),
      icon: KIND_ICON.e,
    });
    seen.add(encode({ kind: "e", key: e.id }));
  }
  const found = searched.value.scope === pa.scopeKey.value ? searched.value.options : [];
  for (const r of [...rows.value, ...found]) {
    const v = encode(r);
    if (r.kind === "e" || seen.has(v)) continue;
    seen.add(v);
    byKind[r.kind].push({ label: raw(r.key), value: v, icon: KIND_ICON[r.kind] });
  }
  if (props.modelValue && !seen.has(encode(props.modelValue))) {
    byKind[props.modelValue.kind].unshift({
      label: raw(props.modelValue.key),
      value: encode(props.modelValue),
      icon: KIND_ICON[props.modelValue.kind],
    });
  }
  const headers: Record<StepKind, I18nText> = {
    e: t("rum.analytics.picker.events"),
    p: t("rum.analytics.picker.pages"),
    c: t("rum.analytics.picker.clicks"),
  };
  return props.kinds.flatMap((k) =>
    byKind[k].length
      ? [{ label: headers[k], header: true, value: `header:${k}` }, ...byKind[k]]
      : [],
  );
});

// Only a successful read marks the scope loaded, so a failure is retried on the next open.
const load = async () => {
  const key = pa.scopeKey.value;
  if (loadedKey === key) return;
  loading.value = true;
  try {
    const res = await pa.loadPicker();
    if (key !== pa.scopeKey.value) return;
    failed.value = res.status !== "ok";
    rows.value = res.options;
    if (res.status === "ok") loadedKey = key;
  } finally {
    loading.value = false;
  }
};

// The server is asked only when the first rows did not already hold every key.
const onSearch = async (term: string) => {
  failed.value = false;
  if (!term || rows.value.length < FULL_LIST) return;
  const scope = pa.scopeKey.value;
  loading.value = true;
  try {
    const res = await pa.searchPicker(term);
    if (scope !== pa.scopeKey.value) return;
    failed.value = res.status !== "ok";
    searched.value = { scope, options: res.options };
  } finally {
    loading.value = false;
  }
};

const onPick = (v: unknown) => {
  if (typeof v !== "string" || v.startsWith("header:")) {
    emit("update:modelValue", null);
    return;
  }
  const i = v.indexOf(":");
  emit("update:modelValue", { kind: v.slice(0, i) as StepKind, key: v.slice(i + 1) });
};
</script>
