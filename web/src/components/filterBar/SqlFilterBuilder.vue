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

<script setup lang="ts">
import { ref, watch } from "vue";
import { emptyFilterGroup, filterTreeToSql, type FilterGroup } from "@/utils/query/filterBar";
import { parseSqlFilterLocking } from "@/utils/query/filterBarParser";
import QueryFilterBar from "./QueryFilterBar.vue";
import type { QueryFilterBarExpose } from "./QueryFilterBar.types";
import type {
  SqlFilterBuilderEmits,
  SqlFilterBuilderExpose,
  SqlFilterBuilderProps,
} from "./SqlFilterBuilder.types";

const props = withDefaults(defineProps<SqlFilterBuilderProps>(), {
  loadValues: undefined,
  fieldsLoading: false,
  freeText: true,
  extraSuggestions: undefined,
  maxRows: 3,
  dataTest: "sql-filter-builder",
});
const emit = defineEmits<SqlFilterBuilderEmits>();

const tree = ref<FilterGroup>(emptyFilterGroup());
const barRef = ref<QueryFilterBarExpose | null>(null);
let lastEmitted: string | null = null;

// The query can change outside the bar (a field-list click, a saved view, the URL); re-read it unless it is our own echo.
watch(
  () => props.query,
  (query) => {
    // The echo is skipped once only, so a later external change back to the same text is still read.
    const echo = query === lastEmitted;
    lastEmitted = null;
    if (echo) return;
    tree.value = parseSqlFilterLocking(query ?? "");
  },
  { immediate: true },
);

function onTreeChange(next: FilterGroup) {
  tree.value = next;
  const sql = filterTreeToSql(next, props.fields);
  if (sql === (props.query ?? "").trim()) return;
  lastEmitted = sql;
  emit("update:query", sql);
}

defineExpose<SqlFilterBuilderExpose>({ activate: () => barRef.value?.activate() });
</script>

<template>
  <div class="flex w-full min-w-0 flex-col gap-1" :data-test="dataTest">
    <QueryFilterBar
      ref="barRef"
      :model-value="tree"
      :fields="fields"
      :free-text="freeText"
      search-functions
      open-on-type
      :extra-suggestions="extraSuggestions"
      :load-values="loadValues"
      :fields-loading="fieldsLoading"
      size="sm"
      appearance="plain"
      :max-rows="maxRows"
      :data-test="`${dataTest}-bar`"
      @update:model-value="onTreeChange"
      @submit="emit('submit')"
      @focus="emit('focus')"
      @extra-select="(key, event) => emit('extra-select', key, event)"
    />
  </div>
</template>
