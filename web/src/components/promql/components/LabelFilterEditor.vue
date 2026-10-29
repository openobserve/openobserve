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
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import type { PromqlLabelMatcher } from "@/components/promql/types";
import type { FilterField } from "@/utils/query/filterBar";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
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
const { fetchPromQLLabels, fetchPromQLLabelValues } = useDashboardPanelData(
  dashboardPanelDataPageKey,
  t,
);

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

const loadValues = async (label: string): Promise<string[]> => {
  const metric = props.metric;
  if (!metric || !label) return [];
  if (inPanel.value) {
    await fetchPromQLLabelValues(metric, label);
    return props.dashboardPanelData?.meta?.promql?.labelValuesMap?.get(label) ?? [];
  }
  const cached = await getFieldValuesForSuggestion(streamContext(metric), label);
  return cached.length ? cached : requestFieldValues(streamContext(metric), label);
};

const variableSuggestions = (): string[] =>
  (props.dashboardData?.variables?.list ?? []).map((variable: any) => `$${variable.name}`);

function onChange(next: unknown) {
  emit("update:labels", next as PromqlLabelMatcher[]);
}
</script>
