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
  <FunnelSectionRow
    :title="t('rum.analytics.funnel.filterAllTitle')"
    :caption="t('rum.analytics.funnel.filterAllCaption')"
    :stacked="stacked"
    test-id="rum-analytics-funnel-filter-all"
  >
    <template #body>
      <FilterBuilder
        profile="rum-funnel"
        :model-value="def.f ?? []"
        :fields="builderFields"
        :load-values="loadValues"
        :layout="stacked ? 'vertical' : undefined"
        :placeholder="t('rum.analytics.funnel.addFilter')"
        data-test="rum-analytics-funnel-filter-builder"
        @update:model-value="onChange"
      />
    </template>
  </FunnelSectionRow>
</template>

<script setup lang="ts">
import { computed } from "vue";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import FunnelSectionRow from "@/components/rum/productAnalytics/funnelParts/FunnelSectionRow.vue";
import {
  filterFieldLabel,
  valuesLoader,
  type FilterValuesState,
} from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import { useI18nTyped } from "@/types/i18n";
import { toFilterFieldType, type FilterField } from "@/utils/query/filterBar";
import { parseFunnelFilter } from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef, FunnelFilter } from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "FunnelFilterBar" });

const props = defineProps<{
  def: FunnelDef;
  fields: readonly string[];
  fieldTypes?: Readonly<Record<string, string>>;
  values: FilterValuesState;
  stacked?: boolean;
}>();
const emit = defineEmits<{
  "update:def": [FunnelDef];
  "filter-values": [string];
}>();
const { t } = useI18nTyped();

const builderFields = computed<FilterField[]>(() =>
  props.fields.map((name) => ({
    name,
    label: filterFieldLabel(t, name),
    type: toFilterFieldType(props.fieldTypes?.[name]),
  })),
);

const loadValues = valuesLoader(
  () => props.values,
  (field) => emit("filter-values", field),
);

// A rule the server would refuse stays in the builder, marked, and the funnel keeps its last valid filters.
const onChange = (next: unknown) => {
  const rules = next as FunnelFilter[];
  if (!rules.every((rule) => parseFunnelFilter(rule))) return;
  const out: FunnelDef = { ...props.def, f: rules };
  if (!rules.length) delete out.f;
  emit("update:def", out);
};
</script>
