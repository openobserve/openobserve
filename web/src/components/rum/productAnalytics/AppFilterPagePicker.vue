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
    class="flex h-104 flex-col gap-2 max-lg:h-auto lg:max-h-[calc(var(--reka-popper-available-height,26rem)-1.625rem)]"
    data-test="rum-analytics-app-filter-page-picker"
  >
    <span class="flex items-center gap-1.5">
      <span class="w-44 shrink-0">
        <OSelect
          v-model="op"
          :options="opOptions"
          :aria-label="t('rum.analytics.exclusions.match')"
          size="sm"
          data-test="rum-analytics-app-filter-page-picker-op"
        />
      </span>
      <OInput
        v-model="value"
        size="sm"
        class="min-w-0 flex-1"
        :aria-label="t('rum.analytics.exclusions.value')"
        :placeholder="t('rum.analytics.exclusions.pagePlaceholder')"
        data-test="rum-analytics-app-filter-page-picker-value"
        @update:model-value="onType"
        @keydown.enter.prevent="apply"
      />
    </span>
    <div v-if="op !== 'regex'" class="flex min-h-0 flex-1 flex-col max-lg:h-72 max-lg:flex-none">
      <OFieldList
        keyboard
        :fields="listRows"
        :search="value"
        :show-search="false"
        row-key="value"
        :loading="loading && !value"
        :show-pagination="false"
        @row-click="onRowClick"
      >
        <template #field-row="{ row }">
          <OFieldRow :data-test="`rum-analytics-app-filter-page-picker-page-${row.value}`">
            <OTruncatedText as="span" class="min-w-0 flex-1">{{ row.name }}</OTruncatedText>
            <span v-if="row.sessions !== null" class="text-text-secondary text-xs tabular-nums">{{
              addCommasToNumber(Number(row.sessions))
            }}</span>
          </OFieldRow>
        </template>
        <template #loading>
          <span class="text-text-secondary py-2 text-xs">{{
            t("rum.analytics.exclusions.pagesLoading")
          }}</span>
        </template>
        <template #empty>
          <span
            v-if="failed"
            class="text-text-secondary flex items-center gap-1.5 py-2 text-xs"
            data-test="rum-analytics-app-filter-page-picker-failed"
            >{{ t("rum.analytics.exclusions.pagesLoadFailed") }}
            <OButton
              variant="ghost-primary"
              size="xs"
              data-test="rum-analytics-app-filter-page-picker-retry"
              @click="load"
              >{{ t("common.retry") }}</OButton
            ></span
          >
          <span v-else class="text-text-secondary py-2 text-xs">{{
            t("components.select.noOptionsFound")
          }}</span>
        </template>
      </OFieldList>
    </div>
    <span
      v-if="invalid"
      class="text-status-error-text text-xs"
      role="alert"
      data-test="rum-analytics-app-filter-page-picker-invalid"
      >{{ t("rum.analytics.exclusions.valueInvalid") }}</span
    >
    <span class="border-border-default mt-auto flex items-center justify-end gap-1.5 border-t pt-2">
      <OButton
        variant="ghost"
        size="sm"
        data-test="rum-analytics-app-filter-page-picker-cancel"
        @click="emit('cancel')"
        >{{ t("common.cancel") }}</OButton
      >
      <OButton
        variant="primary"
        size="sm"
        :disabled="!ready"
        data-test="rum-analytics-app-filter-page-picker-apply"
        @click="apply"
        >{{ t("common.apply") }}</OButton
      >
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OFieldList from "@/lib/lists/FieldList/OFieldList.vue";
import OFieldRow from "@/lib/lists/FieldList/OFieldRow.vue";
import type { FieldItem } from "@/lib/lists/FieldList/OFieldList.types";
import useStepOptions from "@/composables/rum/useStepOptions";
import { PAGE_OPS } from "@/components/rum/productAnalytics/AppSettings.schema";
import { raw, useI18nTyped } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import { MAX_KEY_LENGTH, regexProblem, type PageRule } from "@/utils/rum/productAnalyticsModel";

defineOptions({ name: "AppFilterPagePicker" });

const SEARCH_DEBOUNCE_MS = 300;

const props = defineProps<{ initial?: PageRule }>();
const emit = defineEmits<{ apply: [PageRule]; cancel: [] }>();
const { t } = useI18nTyped();

const { groups, loading, failed, load, onSearch } = useStepOptions({
  events: () => [],
  kinds: () => ["p"],
});

const op = ref<PageRule["op"]>(props.initial?.op ?? "eq");
const value = ref(props.initial?.value ?? "");
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const opOptions = computed(() =>
  PAGE_OPS.map((o) => ({ label: t(`rum.analytics.exclusions.pageOps.${o}`), value: o })),
);

const listRows = computed<FieldItem[]>(() =>
  (groups.value[0]?.rows ?? []).map((r) => ({
    name: raw(r.label),
    value: r.step.key,
    sessions: r.sessions,
  })),
);

const trimmed = computed(() => value.value.trim());
const invalid = computed(
  () =>
    !!trimmed.value &&
    (trimmed.value.length > MAX_KEY_LENGTH ||
      (op.value === "regex" && regexProblem(trimmed.value) !== null)),
);
const ready = computed(() => !!trimmed.value && !invalid.value);

const clearSearchTimer = () => {
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = null;
};

// The first rows may not hold every page, so a typed path asks the server for the rest.
const onType = () => {
  clearSearchTimer();
  searchTimer = setTimeout(() => {
    searchTimer = null;
    void (failed.value ? load() : onSearch(trimmed.value));
  }, SEARCH_DEBOUNCE_MS);
};

const onRowClick = (row: FieldItem) => {
  clearSearchTimer();
  value.value = String(row.value);
};

const apply = () => {
  if (ready.value) emit("apply", { op: op.value, value: trimmed.value });
};

onMounted(() => void load());
onBeforeUnmount(clearSearchTimer);
</script>
