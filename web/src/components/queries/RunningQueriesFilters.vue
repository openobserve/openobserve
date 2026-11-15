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
    data-test="running-queries-filter-container"
    class="flex min-w-0 flex-1 items-center gap-3 max-md:flex-wrap max-md:gap-2"
  >
    <OToggleGroup
      mobile-dropdown
      class="shrink-0"
      :model-value="tab"
      @update:model-value="emit('update:tab', $event as QueryTab)"
      data-test="running-queries-query-type-tabs"
    >
      <OToggleGroupItem v-for="item in tabs" :key="item.value" :value="item.value" size="sm">
        {{ item.label }}
      </OToggleGroupItem>
    </OToggleGroup>
    <div class="o2-select-input o2-input">
      <OSelect
        v-model="searchField"
        :options="searchFieldOptions"
        labelKey="label"
        valueKey="value"
        class="w-35 p-0 max-md:w-28"
        data-test="running-queries-search-fields-select"
        @update:model-value="query = ''"
      />
    </div>
    <OSearchInput
      v-if="searchField == 'all'"
      v-model="query"
      class="no-border o2-search-input min-w-0 flex-1 max-md:min-w-40"
      :placeholder="t('queries.search')"
      data-test="running-queries-search-input"
    />
    <div v-else class="o2-select-input o2-input w-62.5">
      <OSelect
        v-model="query"
        :placeholder="t('queries.selectOption')"
        :options="otherFieldOptions"
        labelKey="label"
        valueKey="value"
        class="no-border search-input w-62.5"
        data-test="running-queries-search-input"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";

type QueryTab = "summary" | "all";
defineProps<{
  tab: QueryTab;
  tabs: Array<{ label: I18nText; value: QueryTab }>;
  searchFieldOptions: SelectOption[];
  otherFieldOptions: SelectOption[];
}>();
const emit = defineEmits<{ "update:tab": [value: QueryTab] }>();
const searchField = defineModel<string>("searchField", { required: true });
const query = defineModel<string>("query", { required: true });

const { t } = useI18nTyped();
</script>
