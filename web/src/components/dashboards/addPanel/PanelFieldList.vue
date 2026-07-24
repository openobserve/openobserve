<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="bg-surface-panel border-border-default flex h-full w-full flex-col border-r">
    <div class="px-page-edge my-3 flex shrink-0 items-center justify-between">
      <span class="text-base font-bold">{{ t("panel.fields") }}</span>
      <OButton
        variant="outline"
        size="icon-xs-sq"
        class="rotate-90"
        icon-left="unfold-less"
        :title="t('panel.collapseFields')"
        data-test="panel-field-list-collapse-btn"
        @click="emit('collapse')"
      />
    </div>
    <OFieldList
      ref="fieldListRef"
      class="min-h-0 flex-1"
      :fields="flattenGroupedFields"
      :search="dashboardPanelData.meta.stream.filterField"
      :search-placeholder="t('search.searchField')"
      :page-size="250"
      :page-size-options="[250]"
      :show-pagination="true"
      :current-page="currentPage"
      row-key="_uid"
      :draggable="!hideAllFieldsSelection && !promqlMode"
      :drag-enabled-fn="isRowDragEnabled"
      :sort-fn="sortFieldsFn"
      @update:search="onSearchChange"
      @update:current-page="currentPage = $event"
      @drag-start="onDragStart"
      @drag-end="onDragEnd"
    >
      <!-- Stream selectors -->
      <template #before-list>
        <div class="px-page-edge">
          <OSelect
            v-if="dashboardPanelDataPageKey !== 'metrics'"
            :model-value="currentStreamType"
            :label="t('dashboard.selectStreamType')"
            :options="streamTypeOptions"
            data-test="index-dropdown-stream_type"
            class="mb-1"
            label-position="inside"
            :disabled="dashboardPanelDataPageKey === 'logs'"
            @update:model-value="onStreamTypeChange"
          />
          <!-- Metric type as a LETTER (C/G/H/S/O), not a glyph. The `badge`
               renders inline beside the name and costs no row height. -->
          <OSelect
            :model-value="currentStream"
            :label="t('dashboard.selectIndex')"
            :options="streamOptions"
            data-test="index-dropdown-stream"
            :loading="streamListLoading"
            label-key="name"
            value-key="name"
            searchable
            label-position="inside"
            :disabled="dashboardPanelDataPageKey === 'logs'"
            :title="currentStream ?? undefined"
            option-tooltip
            @search="onStreamSearch"
            @update:model-value="onStreamChange"
          />
        </div>
      </template>

      <!-- Group header -->
      <template #group-header="{ row }">
        <div
          class="-ml-page-edge px-page-edge bg-section-header-bg text-text-secondary flex h-7! w-[calc(100%+2*var(--spacing-page-edge))] shrink-0 cursor-default items-center justify-between text-xs font-semibold select-none"
          :title="row.groupName"
        >
          <div class="min-w-0 flex-1">{{ row.groupName }}</div>
        </div>
      </template>

      <!-- Field row -->
      <template #field-row="{ row, draggable, isDragEnabled }">
        <OFieldRow>
          <OIcon
            v-if="draggable"
            name="drag-indicator"
            size="sm"
            :class="[
              'o-field-list__drag-icon text-field-list-drag-icon',
              isDragEnabled
                ? 'o-field-list__drag-icon--enabled'
                : 'o-field-list__drag-icon--disabled',
            ]"
            data-test="o-field-list-drag-indicator"
          />
          <OFieldLabel :field="row" :show-type-icon="true" />

          <!-- Field actions -->
          <template #actions>
            <!-- Standard chart actions -->
            <div v-if="showStandardActions(row)" class="flex items-center gap-0.5">
              <OButton
                variant="ghost-neutral"
                size="chip"
                :disabled="isAddXAxisNotAllowed"
                data-test="dashboard-add-x-data"
                @click.stop="addXAxisItem(row)"
              >
                {{ dashboardPanelData.data.type != "h-bar" ? "+X" : "+Y" }}
              </OButton>
              <OButton
                variant="ghost-neutral"
                size="chip"
                :disabled="isAddYAxisNotAllowed"
                data-test="dashboard-add-y-data"
                @click.stop="addYAxisItem(row)"
              >
                {{ dashboardPanelData.data.type != "h-bar" ? "+Y" : "+X" }}
              </OButton>
              <OButton
                v-if="dashboardPanelData.data.type == 'table'"
                variant="ghost-neutral"
                size="chip"
                :disabled="isAddBreakdownNotAllowed"
                data-test="dashboard-add-p-data"
                @click.stop="addBreakDownAxisItem(row)"
              >
                +P
              </OButton>
              <OButton
                v-if="
                  dashboardPanelData.data.type == 'area' ||
                  dashboardPanelData.data.type == 'bar' ||
                  dashboardPanelData.data.type == 'line' ||
                  dashboardPanelData.data.type == 'h-bar' ||
                  dashboardPanelData.data.type == 'h-stacked' ||
                  dashboardPanelData.data.type == 'scatter' ||
                  dashboardPanelData.data.type == 'area-stacked' ||
                  dashboardPanelData.data.type == 'stacked'
                "
                variant="ghost-neutral"
                size="chip"
                :disabled="isAddBreakdownNotAllowed"
                data-test="dashboard-add-b-data"
                @click.stop="addBreakDownAxisItem(row)"
              >
                +B
              </OButton>
              <OButton
                v-if="dashboardPanelData.data.type == 'heatmap'"
                variant="ghost-neutral"
                size="chip"
                :disabled="isAddZAxisNotAllowed"
                data-test="dashboard-add-z-data"
                @click.stop="addZAxisItem(row)"
              >
                +Z
              </OButton>
              <OButton
                v-if="
                  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                    .customQuery == false
                "
                variant="ghost-neutral"
                size="chip"
                :disabled="
                  !!dashboardPanelData.meta.stream.vrlFunctionFieldList.find(
                    (vrlField: any) => vrlField.name == row.name,
                  )
                "
                data-test="dashboard-add-filter-data"
                @click.stop="addFilteredItem(row as { name: string; stream: string })"
              >
                +F
              </OButton>
            </div>

            <!-- Geomap actions -->
            <div v-if="showGeomapActions(row)" class="flex items-center gap-0.5">
              <OButton
                variant="ghost-neutral"
                size="chip"
                :disabled="
                  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                    .fields?.latitude != null
                "
                data-test="dashboard-add-latitude-data"
                @click.stop="addLatitude(row)"
              >
                +Lat
              </OButton>
              <OButton
                variant="ghost-neutral"
                size="chip"
                :disabled="
                  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                    .fields?.longitude != null
                "
                data-test="dashboard-add-longitude-data"
                @click.stop="addLongitude(row)"
              >
                +Lng
              </OButton>
              <OButton
                variant="ghost-neutral"
                size="chip"
                :disabled="
                  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                    .fields?.weight != null
                "
                data-test="dashboard-add-weight-data"
                @click.stop="addWeight(row)"
              >
                +W
              </OButton>
              <OButton
                v-if="
                  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                    .customQuery == false
                "
                variant="ghost-neutral"
                size="chip"
                :disabled="
                  !!dashboardPanelData.meta.stream.vrlFunctionFieldList.find(
                    (vrlField: any) => vrlField.name == row.name,
                  )
                "
                data-test="dashboard-add-filter-data"
                @click.stop="addFilteredItem(row as { name: string; stream: string })"
              >
                +F
              </OButton>
            </div>

            <!-- Maps actions -->
            <div v-if="showMapsActions(row)" class="flex items-center gap-0.5">
              <OButton
                variant="ghost-neutral"
                size="chip"
                :disabled="
                  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                    .fields?.name != null
                "
                data-test="dashboard-add-x-data"
                @click.stop="addMapName(row)"
              >
                +N
              </OButton>
              <OButton
                variant="ghost-neutral"
                size="chip"
                :disabled="
                  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                    .fields?.value_for_maps != null
                "
                data-test="dashboard-add-y-data"
                @click.stop="addMapValue(row)"
              >
                +V
              </OButton>
              <OButton
                variant="ghost-neutral"
                size="chip"
                data-test="dashboard-add-filter-data"
                @click.stop="addFilteredItem(row as { name: string; stream: string })"
              >
                +F
              </OButton>
            </div>

            <!-- Sankey actions -->
            <div v-if="showSankeyActions(row)" class="flex items-center gap-0.5">
              <OButton
                variant="ghost-neutral"
                size="chip"
                :disabled="
                  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                    .fields?.source != null
                "
                data-test="dashboard-add-source-data"
                @click.stop="addSource(row)"
              >
                +S
              </OButton>
              <OButton
                variant="ghost-neutral"
                size="chip"
                :disabled="
                  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                    .fields?.target != null
                "
                data-test="dashboard-add-target-data"
                @click.stop="addTarget(row)"
              >
                +T
              </OButton>
              <OButton
                variant="ghost-neutral"
                size="chip"
                :disabled="
                  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                    .fields?.value != null
                "
                data-test="dashboard-add-value-data"
                @click.stop="addValue(row)"
              >
                +V
              </OButton>
              <OButton
                v-if="
                  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                    .customQuery == false
                "
                variant="ghost-neutral"
                size="chip"
                :disabled="
                  !!dashboardPanelData.meta.stream.vrlFunctionFieldList.find(
                    (vrlField: any) => vrlField.name == row.name,
                  )
                "
                data-test="dashboard-add-filter-data"
                @click.stop="addFilteredItem(row as { name: string; stream: string })"
              >
                +F
              </OButton>
            </div>
          </template>
        </OFieldRow>
      </template>

      <!-- Loading state -->
      <template #loading>
        <div class="flex flex-col">
          <div v-for="i in 6" :key="i" class="flex items-center gap-2 py-1">
            <OSkeleton type="rect" class="rounded-default h-3.5 w-3.5 flex-shrink-0" />
            <OSkeleton type="text" class="flex-1" />
          </div>
        </div>
      </template>

      <!-- Empty state -->
      <template #empty>
        <div class="flex items-center justify-center py-[0.725rem] text-center">
          <OIcon name="info" size="xs" />
          <span class="pl-1.5">{{ t("search.noFieldFound") }}</span>
        </div>
      </template>

      <!-- After list: pagination -->
      <template #after-list="bottomProps">
        <div
          v-if="bottomProps.totalPages > 1"
          class="field-list-pagination flex items-center justify-center gap-1 py-1"
          data-test="field-list-pagination"
        >
          <OTooltip
            side="left"
            align="center"
            max-width="18.75rem"
            :content="`Total Fields: ${bottomProps.totalRows}`"
          />
          <OButton
            variant="ghost-primary"
            size="icon-panel"
            :disabled="bottomProps.isFirstPage"
            data-test="field-list-pagination-first"
            @click="bottomProps.firstPage"
          >
            <OIcon name="fast-rewind" size="sm" />
          </OButton>
          <template v-for="page in visiblePagesForTotal(bottomProps)" :key="page">
            <OButton
              :variant="bottomProps.currentPage === page ? 'primary' : 'ghost'"
              size="icon-panel"
              :data-test="`field-list-pagination-page-${page}`"
              @click="setPage(page)"
            >
              {{ page }}
            </OButton>
          </template>
          <OButton
            variant="ghost-primary"
            size="icon-panel"
            :disabled="bottomProps.isLastPage"
            data-test="field-list-pagination-last"
            @click="bottomProps.lastPage"
          >
            <OIcon name="fast-forward" size="sm" />
          </OButton>
        </div>
      </template>
    </OFieldList>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, inject } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import useStreams from "@/composables/useStreams";
import { applyPromqlSeed, metricsStreamsOf } from "@/utils/dashboard/promqlSeed";
import { isAutoSeededQuery } from "@/utils/metrics/metricPanelSeed";
import { buildTypeFilterBuckets } from "@/utils/metrics/metricFamily";
import { BADGE_LABELS, getBadgeStyle } from "@/utils/metrics/metricPalette";
import useNotifications from "@/composables/useNotifications";
import usePromqlSuggestions from "@/composables/usePromqlSuggestions";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OFieldList from "@/lib/lists/FieldList/OFieldList.vue";
import OFieldRow from "@/lib/lists/FieldList/OFieldRow.vue";
import OFieldLabel from "@/lib/lists/FieldList/OFieldLabel.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { FieldItem } from "@/lib/lists/FieldList/OFieldList.types";

const props = defineProps<{
  editMode?: boolean;
  hideAllFieldsSelection?: boolean;
}>();

const dashboardPanelDataPageKey: string = inject("dashboardPanelDataPageKey", "dashboard");

const store = useStore();
const { t } = useI18n();
const { getStreams } = useStreams();
const { showErrorNotification } = useNotifications();
const { parsePromQlQuery } = usePromqlSuggestions();
const emit = defineEmits<{ collapse: [] }>();

const {
  dashboardPanelData,
  addXAxisItem,
  addYAxisItem,
  addZAxisItem,
  addBreakDownAxisItem,
  addFilteredItem,
  isAddXAxisNotAllowed,
  isAddBreakdownNotAllowed,
  isAddYAxisNotAllowed,
  isAddZAxisNotAllowed,
  promqlMode,
  addLatitude,
  addLongitude,
  addWeight,
  addMapName,
  addMapValue,
  addSource,
  addTarget,
  addValue,
  cleanupDraggingFields,
  updateGroupedFields,
  fetchPromQLLabels,
} = useDashboardPanelData(dashboardPanelDataPageKey);

const fieldListRef = ref<InstanceType<typeof OFieldList> | null>(null);
const currentPage = ref(1);

const hideAllFieldsSelection = computed(() => props.hideAllFieldsSelection ?? false);

// ── Metric type labels ────────────────────────────────────────────────

/**
 * The badge is the type's INITIAL — `C`ounter, `G`auge, `H`istogram, `S`ummary,
 * `O`ther — not the whole word, which pushed already-long metric names into
 * truncation.
 */
const initialOf = (label: string) => label.charAt(0).toUpperCase();

/**
 * Stream name -> type-filter BUCKET id (`counter`, `gauge`, …), not its label.
 * The bucket id keys both the label and the colour, so it is what gets carried
 * around. Deriving the label from the id is safe; deriving the id from the label
 * is not — a translated or decorated label misses the lookup and turns grey.
 */
const metricTypeBuckets = computed<Record<string, string>>(() => {
  if (currentStreamType.value !== "metrics") return {};
  const streams = (dashboardPanelData.meta.stream.streamResults ?? []) as any[];

  // `buildTypeFilterBuckets`, not `buildMetricCards`: a badge needs one word per
  // stream, and building the whole rule set for every metric would be a heavy
  // pass on a list that can run to thousands. It also answers for the metadata-
  // only family bases that `buildMetricCards` suppresses but the dropdown lists.
  return buildTypeFilterBuckets(streams);
});

// ── Stream type / stream v-model bridges ──────────────────────────────

const currentStreamType = computed(
  () =>
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields
      ?.stream_type,
);

const currentStream = computed(
  () =>
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.stream,
);

function onStreamTypeChange(val: SelectModelValue) {
  const fields =
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields;
  fields.stream = "";
  fields.stream_type = val;
}

function onStreamChange(val: SelectModelValue) {
  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream = val;
}

// ── Stream type options ────────────────────────────────────────────────

const streamTypeOptions = computed(() =>
  ["logs", "metrics", "traces"].map((t: string) => ({ label: t, value: t })),
);

// ── Stream list ────────────────────────────────────────────────────────

const filteredStreams = ref<any[]>([]);

const streamListLoading = ref(false);

const currentQueryFields = () =>
  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields;

const isEditPanel = props.editMode;
let initialStreamsLoaded = false;

const loadStreamsListBasedOnType = async () => {
  initialStreamsLoaded = true;
  streamListLoading.value = true;
  try {
    await getStreamList(currentQueryFields().stream_type);
  } finally {
    streamListLoading.value = false;
  }
};

watch(
  () => currentQueryFields().stream_type,
  () => {
    if (!initialStreamsLoaded) return;
    loadStreamsListBasedOnType();
  },
);

if (isEditPanel) {
  // In edit mode the panel's own data arrives asynchronously, so the list waits
  // for a stream rather than fetching against a half-built query.
  //
  // The watch is armed in `onMounted`, NOT at setup, and `immediate` is what
  // handles a stream that is already set. Two reasons it must be this shape:
  //
  //  - A parent that seeds the query in its own `onMounted` (the metrics
  //    Visualize workspace does exactly that) sets the stream BEFORE this child
  //    exists, so a change-only watcher never fires — the Stream dropdown then
  //    sits on "No options found" under a stream that is plainly selected.
  //  - `immediate` at setup would run the callback SYNCHRONOUSLY, before the
  //    `getStreamList` const below is initialised — a TDZ ReferenceError thrown
  //    inside a promise, which is silent in tests and fatal in the browser.
  //    By `onMounted` every declaration in this setup body exists.
  //
  // `loaded` (not the stop handle) enforces "only once": the handle is still in
  // its own TDZ during an immediate first pass.
  onMounted(() => {
    let loaded = false;
    let stopEditInitialLoad: (() => void) | undefined;
    const onStream = (streamName: string) => {
      if (loaded) return;
      // Metrics visualize starts blank by design; load the metric stream list
      // immediately so the stream dropdown is selectable without a preseeded stream.
      if (!streamName && dashboardPanelDataPageKey !== "metrics") return;
      loaded = true;
      // Undefined on the immediate pass — `watch` has not returned yet, so the
      // handle does not exist. `loaded` is what stops a second run; this is only
      // here to free the watcher when the stream arrives later.
      stopEditInitialLoad?.();
      loadStreamsListBasedOnType();
    };
    stopEditInitialLoad = watch(() => currentQueryFields().stream, onStream, {
      immediate: true,
    });
    // The immediate pass could not stop a watcher that did not exist yet.
    if (loaded) stopEditInitialLoad();
  });
} else {
  onMounted(() => {
    loadStreamsListBasedOnType();
  });
}

const onStreamSearch = (val: string) => {
  filteredStreams.value = dashboardPanelData.meta.stream.streamResults.filter((stream: any) => {
    return stream.name.toLowerCase().indexOf(val.toLowerCase()) > -1;
  });
};

watch(
  () => dashboardPanelData.meta.stream.streamResults,
  (results) => {
    filteredStreams.value = results ?? [];
  },
  { immediate: true },
);

const { isDark } = useTheme();

const streamOptions = computed(() =>
  (filteredStreams.value as any[]).map((s) => {
    // The bucket id drives BOTH the label and the colour, so neither is
    // reconstructed from the other.
    const bucket = metricTypeBuckets.value[s.name];
    const type = bucket ? (BADGE_LABELS[bucket] ?? "Other") : undefined;
    return {
      ...s,
      // The chip is the initial; hovering it (the title) spells the type out.
      badge: type ? initialOf(type) : undefined,
      badgeTitle: type,
      // Colour-coded from the SAME palette the Metrics Explorer badges use —
      // Counter blue, Gauge green, Histogram purple, Summary orange, Other grey —
      // so a type looks the same wherever you meet it.
      badgeStyle: bucket ? getBadgeStyle(bucket, isDark.value) : undefined,
    };
  }),
);

// ── Query stream tracking ──────────────────────────────────────────────

const queryStreamTracking = ref<
  Record<number, { stream: string | null | undefined; streamType: string | null | undefined }>
>({});

dashboardPanelData.data.queries.forEach((query: any, index: number) => {
  if (!queryStreamTracking.value[index]) {
    queryStreamTracking.value[index] = {
      stream: query?.fields?.stream || null,
      streamType: query?.fields?.stream_type || null,
    };
  }
});

watch(
  () => [
    dashboardPanelData.meta.stream.streamResults,
    dashboardPanelData.meta.stream.streamResultsType,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.stream,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields
      ?.stream_type,
    dashboardPanelData.layout.currentQueryIndex,
  ],
  async (newValues) => {
    const currentIndex = dashboardPanelData.layout.currentQueryIndex;
    const currentStream = newValues?.[2] as string | undefined;
    const currentStreamType = newValues?.[3] as string | undefined;

    if (!queryStreamTracking.value[currentIndex]) {
      queryStreamTracking.value[currentIndex] = {
        stream: currentStream,
        streamType: currentStreamType,
      };
      return;
    }

    const previousForThisQuery = queryStreamTracking.value[currentIndex];
    const streamChangedForThisQuery = previousForThisQuery.stream !== currentStream;
    const streamTypeChangedForThisQuery = previousForThisQuery.streamType !== currentStreamType;

    queryStreamTracking.value[currentIndex] = {
      stream: currentStream,
      streamType: currentStreamType,
    };

    if (!streamChangedForThisQuery && !streamTypeChangedForThisQuery) {
      return;
    }

    const fields: any = dashboardPanelData.meta.stream.streamResults.find(
      (it: any) =>
        it.name ==
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
            .stream &&
        it.stream_type ==
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
            .stream_type,
    );

    if (
      fields &&
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
        .stream_type === dashboardPanelData.meta.stream.streamResultsType
    ) {
      try {
        // On stream change in PromQL mode, re-seed the query for the new stream.
        // Metrics: custom + builder. Add Panel: PromQL custom only (builder
        // regenerates via DashboardQueryBuilder; SQL is excluded — promql-only block).
        const promqlQuery =
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
        const shouldResetPromqlQuery =
          promqlMode.value &&
          (dashboardPanelDataPageKey === "metrics" ||
            (dashboardPanelDataPageKey === "dashboard" && promqlQuery?.customQuery));
        if (shouldResetPromqlQuery) {
          let parsedQuery = null;
          try {
            parsedQuery = parsePromQlQuery(
              dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].query,
            );
          } catch (error: any) {
            console.error("Failed to parse PromQL query:", error);
            parsedQuery = null;
          }

          const metricName = parsedQuery?.metricName;
          const streamName =
            dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
              .stream;

          if (!streamName) {
            console.warn("Cannot update query: stream name is undefined");
            return;
          }

          if (!metricName || metricName !== streamName) {
            // Seed the metrics rule set's default for the new stream — the same
            // query/unit/chart type the Metrics Explorer charts it with — rather
            // than the bare `stream{}`, which is a raw cumulative counter.
            //
            // Only when the query is still one we generated. A query the user
            // wrote is LEFT ALONE, which is stricter than the old behaviour: it
            // reset the query to `stream{}` on every stream change, so a moment
            // of curiosity about another metric silently destroyed a query that
            // may have taken a while to get right. In Custom mode the query is
            // what actually runs — the stream field only drives label
            // suggestions — so leaving the two out of step is recoverable, and
            // deleting their work is not. This is what the builder-mode path in
            // DashboardQueryBuilder already does.
            const streams = metricsStreamsOf(dashboardPanelData);
            const slot =
              dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
            const seedOpts = {
              chartType: dashboardPanelData.data.type,
              requireBuilder: !slot?.customQuery,
            };

            if (isAutoSeededQuery(slot?.query, metricName, streams, seedOpts)) {
              applyPromqlSeed(dashboardPanelData, streamName, {
                // callee uses `?? `, so null and undefined behave identically
                previousStream: metricName ?? undefined,
              });
            }
          }

          fetchPromQLLabels(
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream?.toString(),
          );
        }
      } catch (error: any) {
        showErrorNotification(error?.message ?? "Failed to get stream fields");
      }
    }
  },
);

watch(
  () => [
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream_type,
    dashboardPanelData.meta.stream.streamResults,
    dashboardPanelData.meta.stream.streamResultsType,
  ],
  () => {
    if (
      dashboardPanelData.meta.stream.streamResults.length > 0 &&
      dashboardPanelData.meta.stream.streamResultsType ===
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
          .stream_type
    ) {
      const currentIndex = dashboardPanelData.layout.currentQueryIndex;
      const existingStream = dashboardPanelData.meta.stream.streamResults.find(
        (it: any) =>
          it.name ==
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
            .stream,
      );
      if (existingStream) {
        dashboardPanelData.data.queries[currentIndex].fields.stream =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream;
      } else {
        dashboardPanelData.data.queries[currentIndex].fields.stream =
          dashboardPanelData.meta.stream.streamResults[0]?.name;
      }
    }
  },
);

// ── Flatten grouped fields ─────────────────────────────────────────────

const flattenGroupedFields = computed(() => {
  const flattenedFields: any[] = [];

  // Custom query fields (from a user-written SELECT) and VRL function output
  // fields aren't tied to any stream — give them their own visible section
  // headers so they don't render as orphan rows above the first stream group.
  const customQueryFields = dashboardPanelData.meta.stream.customQueryFields ?? [];
  if (customQueryFields.length > 0) {
    flattenedFields.push({
      isGroup: true,
      groupName: "Query Fields",
    });
    customQueryFields.forEach((field: any) => {
      flattenedFields.push({
        name: field.name,
        type: field.type,
        isGroup: false,
      });
    });
  }

  const vrlFunctionFields = dashboardPanelData.meta.stream.vrlFunctionFieldList ?? [];
  if (vrlFunctionFields.length > 0) {
    flattenedFields.push({
      isGroup: true,
      groupName: "Function Fields",
    });
    vrlFunctionFields.forEach((field: any) => {
      flattenedFields.push({
        name: field.name,
        type: field.type,
        isGroup: false,
      });
    });
  }

  dashboardPanelData.meta.streamFields.groupedFields.forEach((group: any) => {
    flattenedFields.push({
      isGroup: true,
      groupName: group.name,
    });

    if (
      Object.prototype.hasOwnProperty.call(group.settings, "defined_schema_fields") &&
      group.settings.defined_schema_fields.length > 0
    ) {
      flattenedFields.push({
        name: store.state.zoConfig?.timestamp_column,
        type: "Int64",
        stream: group.name,
        streamAlias: group.stream_alias,
        isGroup: false,
      });

      for (const field of group.schema) {
        if (
          store.state.zoConfig.user_defined_schemas_enabled &&
          Object.prototype.hasOwnProperty.call(group.settings, "defined_schema_fields") &&
          group.settings.defined_schema_fields.length > 0
        ) {
          if (group.settings.defined_schema_fields.includes(field.name)) {
            flattenedFields.push({
              ...field,
              stream: group.name,
              streamAlias: group.stream_alias,
              isGroup: false,
            });
          }
        }
      }

      flattenedFields.push({
        name: store.state.zoConfig?.all_fields_name,
        type: "Utf8",
        stream: group.name,
        streamAlias: group.stream_alias,
        isGroup: false,
      });
    } else {
      group.schema.forEach((field: any) => {
        flattenedFields.push({
          ...field,
          stream: group.name,
          streamAlias: group.stream_alias,
          isGroup: false,
        });
      });
    }
  });

  // Field names can legitimately repeat across stream groups (joins,
  // multi-stream, or custom/function fields overlapping schema fields), so
  // keying the list by `name` produces DUPLICATE Vue keys. Duplicate keys
  // corrupt list patching on update — most visibly, the search filter appears
  // to stop working after the field set grows (e.g. after switching query
  // tabs). Give every row a guaranteed-unique key (index-prefixed) instead.
  flattenedFields.forEach((row: any, i: number) => {
    row._uid = `${i}:${row.isGroup ? "g:" + row.groupName : (row.stream ?? "") + ":" + row.name}`;
  });

  return flattenedFields;
});

watch(
  () => ({
    stream:
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream,
    streamType:
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
        .stream_type,
    joins: dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].joins,
  }),
  () => {
    updateGroupedFields();
  },
  { deep: true, immediate: true },
);

// ── Custom field names (for drag/action visibility) ────────────────────

const customFieldNames = computed(() => {
  const names = new Set<string>();
  for (const f of dashboardPanelData.meta.stream.customQueryFields) {
    names.add(f.name);
  }
  for (const f of dashboardPanelData.meta.stream.vrlFunctionFieldList) {
    names.add(f.name);
  }
  return names;
});

// ── Drag-and-drop ──────────────────────────────────────────────────────

function isRowDragEnabled(row: FieldItem): boolean {
  if (hideAllFieldsSelection.value) return false;
  if (promqlMode.value) return false;
  const currentQuery = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
  if (currentQuery.customQuery && !customFieldNames.value.has(row.name)) {
    return false;
  }
  return true;
}

function onDragStart(row: FieldItem) {
  dashboardPanelData.meta.dragAndDrop.dragging = true;
  dashboardPanelData.meta.dragAndDrop.dragElement = row;
  dashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
  dashboardPanelData.meta.dragAndDrop.dragSourceIndex = null;
}

function onDragEnd() {
  cleanupDraggingFields();
}

// ── Sort ───────────────────────────────────────────────────────────────

// Intentional no-op: `flattenGroupedFields` already emits rows in section order
// (query/vrl fields, then each group header followed by its fields). A real sort
// that hoisted group headers first stacked every header at the top with the
// fields jammed under the wrong group, so preserve the given order.
function sortFieldsFn(_a: FieldItem, _b: FieldItem): number {
  return 0;
}

// ── Search binding ─────────────────────────────────────────────────────

function onSearchChange(value: string) {
  dashboardPanelData.meta.stream.filterField = value;
}

// ── Action visibility helpers ──────────────────────────────────────────

function showStandardActions(row: FieldItem): boolean {
  if (hideAllFieldsSelection.value) return false;
  if (promqlMode.value) return false;
  if (dashboardPanelDataPageKey === "logs") return false;

  const currentQuery = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
  if (currentQuery.customQuery && !customFieldNames.value.has(row.name)) {
    return false;
  }

  const chartType = dashboardPanelData.data.type;
  if (
    chartType === "geomap" ||
    chartType === "maps" ||
    chartType === "custom_chart" ||
    chartType === "sankey"
  ) {
    return false;
  }

  return true;
}

function showGeomapActions(row: FieldItem): boolean {
  if (hideAllFieldsSelection.value) return false;
  if (promqlMode.value) return false;
  if (dashboardPanelDataPageKey === "logs") return false;

  const currentQuery = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
  if (currentQuery.customQuery && !customFieldNames.value.has(row.name)) {
    return false;
  }

  return dashboardPanelData.data.type === "geomap";
}

function showMapsActions(row: FieldItem): boolean {
  if (hideAllFieldsSelection.value) return false;
  if (promqlMode.value) return false;
  if (dashboardPanelDataPageKey === "logs") return false;

  const currentQuery = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
  if (currentQuery.customQuery && !customFieldNames.value.has(row.name)) {
    return false;
  }

  return dashboardPanelData.data.type === "maps";
}

function showSankeyActions(row: FieldItem): boolean {
  if (hideAllFieldsSelection.value) return false;
  if (promqlMode.value) return false;
  if (dashboardPanelDataPageKey === "logs") return false;

  const currentQuery = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
  if (currentQuery.customQuery && !customFieldNames.value.has(row.name)) {
    return false;
  }

  return dashboardPanelData.data.type === "sankey";
}

// ── Stream list fetch ──────────────────────────────────────────────────

const getStreamList = async (stream_type: any) => {
  await getStreams(stream_type, false).then((res: any) => {
    const currentType =
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
        .stream_type;
    if (stream_type !== currentType) return;
    dashboardPanelData.meta.stream.streamResults = res.list;
    dashboardPanelData.meta.stream.streamResultsType = stream_type;
  });
};

// ── Pagination ────────────────────────────────────────────────────────

function visiblePagesForTotal(bottomProps: any) {
  const pages: number[] = [];
  const page = bottomProps.currentPage;
  const total = Math.max(1, bottomProps.totalPages);
  if (total <= 3) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    let start = Math.max(1, page - 1);
    let end = Math.min(total, start + 2);
    if (end === total) start = Math.max(1, end - 2);
    for (let i = start; i <= end; i++) pages.push(i);
  }
  return pages;
}

function setPage(page: number) {
  currentPage.value = page;
}

// ── Expose ─────────────────────────────────────────────────────────────

defineExpose({ fieldListRef });
</script>
