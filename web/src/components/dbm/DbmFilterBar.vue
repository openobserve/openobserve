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

<!--
  DbmFilterBar — the one-row filter block every DBM tab shares:
  [search] [Instance / Engine / Schema selects] [page toggles] [More Filters] [trailing].
  Any other dimension (Environment, Service) and the `more` slot live in the
  More Filters popover, so the row never wraps at lg and up. The selects are
  always rendered so a change never moves the search or the rows below.
-->
<template>
  <div class="flex shrink-0 flex-col" data-test="dbm-filter-bar">
    <div class="px-page-edge flex flex-wrap items-center gap-2 py-2" data-test="dbm-filter-row">
      <div
        v-for="filter in primaryFilters"
        :key="filter.key"
        class="w-44 shrink-0 max-md:w-auto max-md:min-w-0 max-md:flex-1"
      >
        <OSelect
          :model-value="filter.value ?? ALL"
          :label="filter.dimension"
          label-position="inside"
          :options="withAll(filter)"
          :searchable="false"
          :disabled="filter.disabled"
          class="rounded-default w-full"
          :data-test="`dbm-filter-${filter.key}`"
          @update:model-value="(value: unknown) => onFilterChange(filter, value)"
        />
        <OTooltip
          v-if="filter.disabled && filter.disabledReason"
          side="bottom"
          :content="filter.disabledReason"
        />
      </div>
      <!-- Filters first, then the search takes the rest of the row; the wrapper sets the width because OSearchInput's own w-full beats a class on it. -->
      <div v-if="searchDataTest" class="min-w-48 flex-1 max-md:w-full max-md:basis-full">
        <OSearchInput
          :model-value="search"
          :placeholder="placeholder"
          clearable
          :debounce="debounce"
          :data-test="searchDataTest"
          @update:model-value="onSearch"
        />
      </div>
      <slot />
      <OPopover v-if="hasMore" align="end">
        <template #trigger>
          <OButton variant="outline" size="sm" class="shrink-0" data-test="dbm-more-filters">
            {{ t("dbm.filters.moreFilters") }}
            <OTag
              v-if="moreActive"
              :label="raw(String(moreActive))"
              size="xs"
              class="ms-1"
              data-test="dbm-more-filters-count"
            />
          </OButton>
        </template>
        <div class="flex w-72 flex-col gap-2.5 p-3" data-test="dbm-more-filters-panel">
          <OSelect
            v-for="filter in moreFilters"
            :key="filter.key"
            :model-value="filter.value ?? ALL"
            :label="filter.dimension"
            :options="withAll(filter)"
            :searchable="false"
            :data-test="`dbm-filter-${filter.key}`"
            @update:model-value="(value: unknown) => onFilterChange(filter, value)"
          />
          <slot name="more" />
        </div>
      </OPopover>
      <slot name="trailing" />
    </div>
    <slot name="coverage" />
  </div>
</template>

<script setup lang="ts">
import type { DbmScopeFilter } from "@/components/dbm/DbmScopeFilters.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import analytics from "@/services/product_analytics";
import { computed, useSlots } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

// A non-empty sentinel: the select treats "" as no selection and would show no label.
const ALL = "__all__";

const props = withDefaults(
  defineProps<{
    /** Omit the three search props on a tab with no search (Metrics). */
    search?: string;
    placeholder?: I18nText;
    searchDataTest?: string;
    filters: DbmScopeFilter[];
    /** Databases types against an already-loaded client list, so it filters on every keystroke. */
    debounce?: number;
    /** How many controls in the `more` slot are set, added to the count on the button. */
    moreCount?: number;
  }>(),
  { search: "", placeholder: undefined, searchDataTest: undefined, debounce: 400, moreCount: 0 },
);

const emit = defineEmits<{
  "update:search": [value: string];
  search: [value: string];
}>();

const { t } = useI18nTyped();
const slots = useSlots();

// Instance, Engine and Schema stay on the row; every other dimension moves into the popover.
const ROW_KEYS = ["instance", "system", "namespace"];
const primaryFilters = computed(() => props.filters.filter((f) => ROW_KEYS.includes(f.key)));
const moreFilters = computed(() => props.filters.filter((f) => !ROW_KEYS.includes(f.key)));
const hasMore = computed(() => moreFilters.value.length > 0 || !!slots.more);
const moreActive = computed(
  () => moreFilters.value.filter((f) => f.value).length + props.moreCount,
);

const withAll = (filter: DbmScopeFilter) => [
  { value: ALL, label: t("dbm.filters.all") },
  ...filter.options,
];

const onFilterChange = (filter: DbmScopeFilter, value: unknown) => {
  const next = value === ALL ? null : value;
  filter.onChange(next);
  analytics.track("dbm_filter_applied", { dimension: filter.key, cleared: !next });
};

const onSearch = (value: unknown) => {
  const next = typeof value === "string" ? value : "";
  emit("update:search", next);
  emit("search", next);
};
</script>
