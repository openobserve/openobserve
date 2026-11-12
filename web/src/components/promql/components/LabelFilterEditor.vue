<template>
  <div data-test="promql-labelfilter-editor">
    <div class="flex flex-row ps-2">
      <div
        data-test="promql-labelfilter-editor-label"
        class="flex min-w-24 items-center whitespace-nowrap"
      >
        <span
          class="rounded-default bg-badge-orange-ol-text me-1.5 h-2 w-2 shrink-0"
          aria-hidden="true"
        ></span>
        {{ t("panel.labelFilters") }}
      </div>
      <span class="ms-0.5 me-0.5 flex items-center">:</span>
      <div class="m-0.5 flex min-h-8 min-w-0 flex-1 items-center">
        <FilterBuilder
          :key="builderKey"
          profile="promql-builder"
          :model-value="props.labels"
          :fields="fields"
          :fields-loading="loadingLabels"
          :load-values="loadValues"
          :extra-value-suggestions="variableSuggestions"
          appearance="plain"
          data-test="promql-label-filter-builder"
          @update:model-value="onChange"
        />
      </div>
    </div>
    <div
      v-if="tooMany"
      class="text-status-error-text ps-2 text-xs"
      role="alert"
      data-test="promql-labelfilter-too-many-branches"
    >
      {{
        t("metrics.labelGroups.tooManyBranches", {
          count: tooMany,
          max: MAX_FILTER_BRANCHES,
        })
      }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import type { PromqlLabelMatcher } from "@/components/promql/types";
import type { FilterField } from "@/utils/query/filterBar";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import { compileLabelFilters, MAX_FILTER_BRANCHES } from "@/components/promql/labelBoolean";
import analytics from "@/services/product_analytics";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { getFieldValuesForSuggestion, requestFieldValues } from "@/composables/fieldValueStore";
import { queryClient } from "@/composables/query/queryClient";
import { streamSchemaQuery } from "@/services/stream.queries";

const props = defineProps<{
  labels: PromqlLabelMatcher[];
  metric?: string;
  dashboardData?: any; // Dashboard data containing variables
  dashboardPanelData?: any;
}>();

const emit = defineEmits<{
  "update:labels": [value: PromqlLabelMatcher[]];
}>();

const { t } = useI18nTyped();
const store = useStore();

const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
const { fetchPromQLLabels } = useDashboardPanelData(dashboardPanelDataPageKey, t);

const NON_LABEL_COLUMNS = new Set(["value", "_timestamp", "__hash__", "__name__"]);

// The /promql page has no panel to hold the metric's labels, so it keeps its own.
const ownLabels = ref<string[]>([]);
const ownLoading = ref(false);
const inPanel = computed(() => Boolean(props.dashboardPanelData));

const availableLabels = computed<string[]>(() =>
  inPanel.value ? props.dashboardPanelData?.meta?.promql?.availableLabels || [] : ownLabels.value,
);

const loadingLabels = computed<boolean>(() =>
  inPanel.value ? Boolean(props.dashboardPanelData?.meta?.promql?.loadingLabels) : ownLoading.value,
);

const fields = computed<FilterField[]>(() =>
  availableLabels.value.map((name) => ({ name, type: "string" })),
);

const compiled = computed(() => compileLabelFilters(props.labels));

/** The branch count of an edit that was refused for passing the cap; 0 once an edit lands. */
const refusedCount = ref(0);
const tooMany = computed(() =>
  compiled.value.ok ? refusedCount.value : compiled.value.branchCount,
);

// Bumped to re-read the saved labels, so a refused edit leaves the builder too.
const builderKey = ref(0);

// A new list, such as another query tab's, was never refused.
watch(
  () => props.labels,
  () => {
    refusedCount.value = 0;
  },
);

const streamContext = (metric: string) => ({
  org: store.state.selectedOrganization.identifier,
  streamType: "metrics",
  streamName: metric,
});

async function loadOwnLabels(metric: string) {
  ownLoading.value = true;
  try {
    const response: any = await queryClient.fetchQuery(
      streamSchemaQuery(store.state.selectedOrganization.identifier, metric, "metrics"),
    );
    const columns = response?.schema ?? response?.uds_schema ?? [];
    ownLabels.value = columns
      .map((column: any) => column?.name)
      .filter((name: string) => name && !NON_LABEL_COLUMNS.has(name))
      .sort();
  } catch {
    ownLabels.value = [];
  } finally {
    ownLoading.value = false;
  }
}

// The label list is the metric's schema, which has no time dimension, so only the metric matters.
watch(
  () => props.metric,
  async (metric) => {
    if (!metric) {
      ownLabels.value = [];
      return;
    }
    if (inPanel.value) await fetchPromQLLabels(metric);
    else await loadOwnLabels(metric);
  },
  { immediate: true },
);

// Keyed by metric through the value store, not the panel's per-label map, so a metric switch never offers the old metric's values.
const loadValues = async (label: string): Promise<string[]> => {
  const metric = props.metric;
  if (!metric || !label) return [];
  const cached = await getFieldValuesForSuggestion(streamContext(metric), label);
  return cached.length ? cached : requestFieldValues(streamContext(metric), label);
};

const variableSuggestions = (): string[] =>
  (props.dashboardData?.variables?.list ?? []).map((variable: any) => `$${variable.name}`);

// A query past the cap cannot render, so only a removal may land while over it.
function onChange(next: unknown) {
  const labels = next as PromqlLabelMatcher[];
  const compiledNext = compileLabelFilters(labels);
  if (!compiledNext.ok && labels.length >= props.labels.length) {
    refusedCount.value = compiledNext.branchCount;
    builderKey.value++;
    return;
  }
  refusedCount.value = 0;
  if (labels.length > props.labels.length) {
    const groups = new Set(props.labels.map((label) => label.group ?? 0));
    const newGroup = labels.some((label) => !groups.has(label.group ?? 0));
    analytics.track("promql_builder_label_filter_added", { new_group: newGroup });
  }
  emit("update:labels", labels);
}
</script>
