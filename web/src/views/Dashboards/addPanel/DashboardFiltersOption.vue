<template>
  <div>
    <div
      v-if="
        !(
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
            .customQuery && dashboardPanelData.data.queryType == 'sql'
        )
      "
      class="flex flex-row ps-3"
    >
      <div
        class="flex items-center text-sm whitespace-nowrap"
        :class="labelWidthClass"
        data-test="dashboard-filter-layout-label"
      >
        <span
          class="rounded-default bg-text-body me-1.5 h-2 w-2 shrink-0"
          aria-hidden="true"
        ></span>
        {{ t("panel.filters") }}
      </div>
      <span class="mx-0.5 flex items-center" data-test="dashboard-filter-layout-separator">:</span>
      <div
        class="flex min-h-9 min-w-0 flex-1 items-center ps-0.5"
        data-test="dashboard-filter-layout"
        :data-condition-count="conditionCount"
      >
        <FilterBuilder
          profile="dashboard-panel"
          :model-value="filterTree"
          :fields="fields"
          :load-values="loadValues"
          :extra-value-suggestions="variableSuggestions"
          appearance="plain"
          data-test="dashboard-filter-builder"
          @update:model-value="onFilterChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { requestFieldValues } from "@/composables/fieldValueStore";
import { useI18nTyped } from "@/types/i18n";
import { getScopeType } from "@/utils/dashboard/variables/variablesScopeUtils";
import { toFilterFieldType, type FilterField } from "@/utils/query/filterBar";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import {
  dashboardFieldKey,
  type DashboardColumn,
  type DashboardFilterGroup,
} from "@/components/filterBar/codecs";

defineOptions({ name: "DashboardFiltersOption" });

const props = withDefaults(
  defineProps<{
    dashboardData?: any;
    labelWidthClass?: string;
  }>(),
  { dashboardData: undefined, labelWidthClass: "min-w-20" },
);

const route = useRoute();
const store = useStore();
const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
const { t } = useI18nTyped();
const { dashboardPanelData, getStreamNameFromStreamAlias } = useDashboardPanelData(
  dashboardPanelDataPageKey,
  t,
);

const currentQuery = computed(
  () => dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex || 0],
);

// The field list adds filters by pushing into the saved tree in place, so the builder gets a copy per content change.
const filterSnapshot = computed(() => JSON.stringify(currentQuery.value?.fields?.filter ?? null));
const filterTree = computed<DashboardFilterGroup | null>(() => JSON.parse(filterSnapshot.value));

const countLeaves = (group: any): number =>
  (group?.conditions ?? []).reduce((sum: number, item: any) => {
    if (item?.filterType === "condition") return sum + 1;
    if (item?.filterType === "group") return sum + countLeaves(item);
    return sum;
  }, 0);

/** Leaf conditions in the filter tree, read by e2e tests instead of counting chips. */
const conditionCount = computed<number>(() => countLeaves(currentQuery.value?.fields?.filter));

// A joined stream's columns are named `alias.field`, the key the codec gives a saved column.
const fields = computed<FilterField[]>(() => {
  const groups: any[] = dashboardPanelData.meta?.streamFields?.groupedFields ?? [];
  const seen = new Set<string>();
  const list: FilterField[] = [];
  for (const group of groups) {
    const streamAlias = group?.stream_alias ?? undefined;
    for (const column of group?.schema ?? []) {
      if (!column?.name) continue;
      const payload: DashboardColumn = { field: column.name, streamAlias };
      const name = dashboardFieldKey(payload);
      if (seen.has(name)) continue;
      seen.add(name);
      list.push({ name, type: toFilterFieldType(column.type), payload });
    }
  }
  return list;
});

const columnFor = (key: string): DashboardColumn => {
  const known = fields.value.find((field) => field.name === key)?.payload as
    DashboardColumn | undefined;
  return known ?? { field: key };
};

// The panel's range, in the microseconds the values API takes; absent until the date picker has run.
const panelTimeRange = () => {
  const range: any = dashboardPanelData.meta?.dateTime;
  const start = range?.start_time?.getTime?.();
  const end = range?.end_time?.getTime?.();
  return Number.isFinite(start) && Number.isFinite(end)
    ? { startTime: start as number, endTime: end as number }
    : undefined;
};

const loadValues = async (key: string, search: string): Promise<string[]> => {
  const column = columnFor(key);
  const streamName = column.streamAlias
    ? getStreamNameFromStreamAlias(column.streamAlias)
    : currentQuery.value?.fields?.stream;
  if (!streamName) return [];
  const values = await requestFieldValues(
    {
      org: store.state.selectedOrganization.identifier,
      streamType: currentQuery.value?.fields?.stream_type ?? "logs",
      streamName,
    },
    column.field,
    { timeRange: panelTimeRange(), keyword: search || undefined },
  );
  return [...values].sort((a, b) => a.localeCompare(b));
};

// Global, this tab's and this panel's variables; a new panel's own variables are scoped to "current_panel".
const visibleVariables = computed(() => {
  const panelId = route.query.panelId as string | undefined;
  const tabId = route.query.tab as string | undefined;
  return (props.dashboardData?.variables?.list ?? []).filter((variable: any) => {
    const scope = getScopeType(variable);
    if (scope === "global") return true;
    if (scope === "tabs") return Boolean(variable.tabs?.includes(tabId));
    if (scope === "panels") return Boolean(variable.panels?.includes(panelId ?? "current_panel"));
    return false;
  });
});

const variableSuggestions = (): string[] =>
  visibleVariables.value.map((variable: any) =>
    variable.multiSelect ? `(\${${variable.name}})` : `$${variable.name}`,
  );

function onFilterChange(next: unknown) {
  const query = currentQuery.value;
  if (!query?.fields) return;
  query.fields.filter = next as DashboardFilterGroup;
}
</script>
