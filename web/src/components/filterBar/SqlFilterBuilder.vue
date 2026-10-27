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
import { computed, ref, watch } from "vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { emptyFilterGroup, filterTreeToSql, type FilterGroup } from "@/utils/query/filterBar";
import { parseSqlFilter } from "@/utils/query/filterBarParser";
import QueryFilterBar from "./QueryFilterBar.vue";
import type { SqlFilterBuilderEmits, SqlFilterBuilderProps } from "./SqlFilterBuilder.types";

const props = withDefaults(defineProps<SqlFilterBuilderProps>(), {
  loadValues: undefined,
  fieldsLoading: false,
  freeText: true,
  dataTest: "sql-filter-builder",
});
const emit = defineEmits<SqlFilterBuilderEmits>();

const { t } = useI18nTyped();

const tree = ref<FilterGroup>(emptyFilterGroup());
const unparsable = ref(false);
let lastEmitted: string | null = null;

const preview = computed(() => filterTreeToSql(tree.value, props.fields));

// The query can change outside the bar (a field-list click, a saved view, the URL); re-read it unless it is our own echo.
watch(
  () => props.query,
  (query) => {
    if (query === lastEmitted) return;
    const parsed = parseSqlFilter(query ?? "");
    unparsable.value = !parsed;
    if (!parsed) return;
    tree.value = parsed;
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

function clearAndBuild() {
  unparsable.value = false;
  onTreeChange(emptyFilterGroup());
}
</script>

<template>
  <div class="flex w-full min-w-0 flex-col gap-1" :data-test="dataTest">
    <OBanner
      v-if="unparsable"
      variant="warning"
      icon="warning"
      dense
      inline-actions
      :content="t('filterBar.queryNotParsable')"
      :data-test="`${dataTest}-unparsable`"
    >
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          :data-test="`${dataTest}-keep-query`"
          @click="emit('exit')"
          >{{ t("filterBar.query") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm"
          :data-test="`${dataTest}-clear-and-build`"
          @click="clearAndBuild"
          >{{ t("filterBar.clearAndBuild") }}</OButton
        >
      </template>
    </OBanner>
    <template v-else>
      <QueryFilterBar
        :model-value="tree"
        :fields="fields"
        :free-text="freeText"
        :load-values="loadValues"
        :fields-loading="fieldsLoading"
        size="sm"
        :data-test="`${dataTest}-bar`"
        @update:model-value="onTreeChange"
        @submit="emit('submit')"
      />
      <OTruncatedText
        v-if="preview"
        class="text-text-secondary text-2xs min-w-0 px-1 font-mono"
        :data-test="`${dataTest}-preview`"
        >{{ raw(`WHERE ${preview}`) }}</OTruncatedText
      >
    </template>
  </div>
</template>
