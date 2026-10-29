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
  <div class="flex min-w-0 flex-wrap items-center gap-2" data-test="profiles-label-filters">
    <span class="flex items-center text-sm whitespace-nowrap">
      <span
        class="rounded-default bg-badge-orange-ol-text me-1.5 h-2 w-2 shrink-0"
        aria-hidden="true"
      ></span>
      {{ t("panel.labelFilters") }}
    </span>
    <div class="min-w-0 flex-1">
      <FilterBuilder
        profile="profiles"
        :model-value="filters"
        :fields="fields"
        :load-values="loadValues"
        :placeholder="t('metrics.labelFilterEditor.addLabelFilter')"
        data-test="profiles-filter-builder"
        @update:model-value="(next) => emit('update:filters', next as ProfileFilter[])"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import type { ProfileFilter } from "@/services/profiles";
import { useI18nTyped } from "@/types/i18n";
import type { FilterField } from "@/utils/query/filterBar";

const props = defineProps<{
  filters: ProfileFilter[];
  labels: string[];
  loadValues: (label: string, search: string) => Promise<string[]>;
}>();
const emit = defineEmits<{
  "update:filters": [filters: ProfileFilter[]];
}>();

const { t } = useI18nTyped();

const fields = computed<FilterField[]>(() =>
  props.labels.map((name) => ({ name, type: "string" })),
);
</script>
