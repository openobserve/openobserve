<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div
    class="column index-menu"
    :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'"
  >
    <OFieldList
      ref="fieldListRef"
      :fields="flattenGroupedFields"
      :search="dashboardPanelData.meta.stream.filterField"
      :search-placeholder="t('search.searchField')"
      :page-size="250"
      :page-size-options="[250]"
      :show-pagination="true"
      :current-page="currentPage"
      row-key="name"
      :draggable="!hideAllFieldsSelection"
      :drag-enabled-fn="isRowDragEnabled"
      :sort-fn="sortFieldsFn"
      @update:search="onSearchChange"
      @update:current-page="currentPage = $event"
      @drag-start="onDragStart"
      @drag-end="onDragEnd"
    >
      <!-- Stream selectors -->
      <template #before-list>
        <div class="tw:mx-[0.625rem]">
          <OSelect
            v-if="dashboardPanelDataPageKey !== 'metrics'"
            :model-value="currentStreamType"
            :label="t('dashboard.selectStreamType')"
            :options="streamTypeOptions"
            data-test="index-dropdown-stream_type"
            class="tw:mb-1"
            :readonly="dashboardPanelDataPageKey === 'logs'"
            @update:model-value="onStreamTypeChange"
          />
          <OSelect
            :model-value="currentStream"
            :label="t('dashboard.selectIndex')"
            :options="filteredStreamsWithIcons"
            data-test="index-dropdown-stream"
            :loading="streamDataLoading.isLoading.value"
            label-key="name"
            value-key="name"
            :icon-key="currentStreamType === 'metrics' ? '_icon' : undefined"
            searchable
            :readonly="dashboardPanelDataPageKey === 'logs'"
            :title="currentStream"
            @search="onStreamSearch"
            @update:model-value="onStreamChange"
          >
            <template
              v-if="currentStreamType === 'metrics' && selectedMetricTypeIcon"
              #icon-left
            >
              <OIcon
                size="xs"
                :name="metricsIconMapping[selectedMetricTypeIcon || '']"
              />
            </template>
          </OSelect>
        </div>
      </template>

      <!-- Group header -->
      <template #group-header="{ row }">
        <div
          class="tw:pl-2 tw:py-1 tw:font-semibold field-group-header"
          :title="row.groupName"
        >
          {{ row.groupName }}
        </div>
      </template>

      <!-- Field row -->
      <template #field-row="{ row }">
        <OIcon
          :name="getTypeIcon(row.type)"
          size="sm"
          color="grey-6"
          class="tw:mr-1"
        />
        <span class="tw:text-[0.825rem] tw:truncate">{{ row.name }}</span>
      </template>

      <!-- Field actions -->
      <template #field-actions="{ row, index }">
        <!-- Standard chart actions -->
        <div
          v-if="showStandardActions(row, index)"
          class="field_icons"
        >
          <OButton
            variant="ghost-neutral"
            size="chip"
            :disabled="isAddXAxisNotAllowed"
            data-test="dashboard-add-x-data"
            @click.stop="addXAxisItem(row)"
          >
            {{ dashboardPanelData.data.type != 'h-bar' ? '+X' : '+Y' }}
          </OButton>
          <OButton
            variant="ghost-neutral"
            size="chip"
            :disabled="isAddYAxisNotAllowed"
            data-test="dashboard-add-y-data"
            @click.stop="addYAxisItem(row)"
          >
            {{ dashboardPanelData.data.type != 'h-bar' ? '+Y' : '+X' }}
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
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].customQuery == false
            "
            variant="ghost-neutral"
            size="chip"
            :disabled="
              !!dashboardPanelData.meta.stream.vrlFunctionFieldList.find(
                (vrlField: any) => vrlField.name == row.name,
              )
            "
            data-test="dashboard-add-filter-data"
            @click.stop="addFilteredItem(row)"
          >
            +F
          </OButton>
        </div>

        <!-- Geomap actions -->
        <div
          v-if="showGeomapActions(row, index)"
          class="field_icons"
        >
          <OButton
            variant="ghost-neutral"
            size="chip"
            :disabled="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.latitude != null
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
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.longitude != null
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
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.weight != null
            "
            data-test="dashboard-add-weight-data"
            @click.stop="addWeight(row)"
          >
            +W
          </OButton>
          <OButton
            v-if="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].customQuery == false
            "
            variant="ghost-neutral"
            size="chip"
            :disabled="
              !!dashboardPanelData.meta.stream.vrlFunctionFieldList.find(
                (vrlField: any) => vrlField.name == row.name,
              )
            "
            data-test="dashboard-add-filter-data"
            @click.stop="addFilteredItem(row)"
          >
            +F
          </OButton>
        </div>

        <!-- Maps actions -->
        <div
          v-if="showMapsActions(row, index)"
          class="field_icons"
        >
          <OButton
            variant="ghost-neutral"
            size="chip"
            :disabled="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.name != null
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
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.value_for_maps != null
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
            @click.stop="addFilteredItem(row)"
          >
            +F
          </OButton>
        </div>

        <!-- Sankey actions -->
        <div
          v-if="showSankeyActions(row, index)"
          class="field_icons"
        >
          <OButton
            variant="ghost-neutral"
            size="chip"
            :disabled="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.source != null
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
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.target != null
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
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.value != null
            "
            data-test="dashboard-add-value-data"
            @click.stop="addValue(row)"
          >
            +V
          </OButton>
          <OButton
            v-if="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].customQuery == false
            "
            variant="ghost-neutral"
            size="chip"
            :disabled="
              !!dashboardPanelData.meta.stream.vrlFunctionFieldList.find(
                (vrlField: any) => vrlField.name == row.name,
              )
            "
            data-test="dashboard-add-filter-data"
            @click.stop="addFilteredItem(row)"
          >
            +F
          </OButton>
        </div>
      </template>

      <!-- After list: pagination -->
      <template #after-list="bottomProps">
        <div
          v-if="bottomProps.totalPages > 1"
          class="field-list-pagination tw:flex tw:items-center tw:justify-center tw:gap-1 tw:py-1"
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
          <template
            v-for="page in visiblePagesForTotal(bottomProps)"
            :key="page"
          >
            <OButton
              :variant="
                bottomProps.currentPage === page ? 'primary' : 'ghost'
              "
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
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { useLoading } from "@/composables/useLoading";
import useStreams from "@/composables/useStreams";
import useNotifications from "@/composables/useNotifications";
import usePromqlSuggestions from "@/composables/usePromqlSuggestions";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OFieldList from "@/lib/lists/FieldList/OFieldList.vue";
import type { FieldItem } from "@/lib/lists/FieldList/OFieldList.types";

const props = defineProps<{
  editMode?: boolean;
  hideAllFieldsSelection?: boolean;
}>();

const dashboardPanelDataPageKey: string = inject(
  "dashboardPanelDataPageKey",
  "dashboard",
);

const store = useStore();
const { t } = useI18n();
const { getStreams, getStream } = useStreams();
const { showErrorNotification } = useNotifications();
const { parsePromQlQuery } = usePromqlSuggestions();

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

// ── Stream type icons ─────────────────────────────────────────────────

const metricsIconMapping: Record<string, string> = {
  Summary: "description",
  Gauge: "speed",
  Histogram: "bar_chart",
  Counter: "pin",
};

const selectedMetricTypeIcon = computed(() => {
  return dashboardPanelData.meta.stream.streamResults.find(
    (it: any) =>
      it.name ==
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
        .fields.stream,
  )?.metrics_meta?.metric_type;
});

// ── Stream type / stream v-model bridges ──────────────────────────────

const currentStreamType = computed(
  () =>
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.stream_type,
);

const currentStream = computed(
  () =>
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.stream,
);

function onStreamTypeChange(val: string) {
  dashboardPanelData.data.queries[
    dashboardPanelData.layout.currentQueryIndex
  ].fields.stream_type = val;
}

function onStreamChange(val: string) {
  dashboardPanelData.data.queries[
    dashboardPanelData.layout.currentQueryIndex
  ].fields.stream = val;
}

// ── Stream type options ────────────────────────────────────────────────

const streamTypeOptions = computed(() =>
  ["logs", "metrics", "traces"].map((t: string) => ({ label: t, value: t })),
);

// ── Stream list ────────────────────────────────────────────────────────

const filteredStreams = ref<any[]>([]);

const streamDataLoading = useLoading(async (stream_type: any) => {
  await getStreamList(stream_type);
});

const loadStreamsListBasedOnType = async () => {
  streamDataLoading.execute(
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      .fields.stream_type,
  );
};

watch(
  () => [
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      .fields.stream_type,
  ],
  async () => {
    loadStreamsListBasedOnType();
  },
);

onMounted(() => {
  loadStreamsListBasedOnType();
});

const onStreamSearch = (val: string) => {
  filteredStreams.value = dashboardPanelData.meta.stream.streamResults.filter(
    (stream: any) => {
      return stream.name.toLowerCase().indexOf(val.toLowerCase()) > -1;
    },
  );
};

watch(
  () => dashboardPanelData.meta.stream.streamResults,
  (results) => {
    filteredStreams.value = results ?? [];
  },
  { immediate: true },
);

const filteredStreamsWithIcons = computed(() =>
  (filteredStreams.value as any[]).map((s) => ({
    ...s,
    _icon: s.metrics_meta
      ? metricsIconMapping[s.metrics_meta.metric_type] || undefined
      : undefined,
  })),
);

// ── Stream fields ──────────────────────────────────────────────────────

const getStreamFields = useLoading(
  async (fieldName: string, streamType: string) => {
    return await getStream(fieldName, streamType, true);
  },
);

// ── Query stream tracking ──────────────────────────────────────────────

const queryStreamTracking = ref<
  Record<
    number,
    { stream: string | null | undefined; streamType: string | null | undefined }
  >
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
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.stream,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.stream_type,
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
    const streamChangedForThisQuery =
      previousForThisQuery.stream !== currentStream;
    const streamTypeChangedForThisQuery =
      previousForThisQuery.streamType !== currentStreamType;

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
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
            .fields.stream &&
        it.stream_type ==
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
            .fields.stream_type,
    );

    if (
      fields &&
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
        .fields.stream_type === dashboardPanelData.meta.stream.streamResultsType
    ) {
      try {
        if (promqlMode.value && dashboardPanelDataPageKey === "metrics") {
          let parsedQuery = null;
          try {
            parsedQuery = parsePromQlQuery(
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].query,
            );
          } catch (error: any) {
            console.error("Failed to parse PromQL query:", error);
            parsedQuery = null;
          }

          const metricName = parsedQuery?.metricName;
          const streamName =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream;

          if (!streamName) {
            console.warn("Cannot update query: stream name is undefined");
            return;
          }

          if (!metricName || metricName !== streamName) {
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].query = streamName + "{}";
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
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      .fields.stream_type,
    dashboardPanelData.meta.stream.streamResults,
    dashboardPanelData.meta.stream.streamResultsType,
  ],
  () => {
    if (
      dashboardPanelData.meta.stream.streamResults.length > 0 &&
      dashboardPanelData.meta.stream.streamResultsType ===
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
          .fields.stream_type
    ) {
      const currentIndex = dashboardPanelData.layout.currentQueryIndex;
      const existingStream = dashboardPanelData.meta.stream.streamResults.find(
        (it: any) =>
          it.name ==
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream,
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

  dashboardPanelData.meta.stream.customQueryFields.forEach((field: any) => {
    flattenedFields.push({
      name: field.name,
      type: field.type,
      isGroup: false,
    });
  });

  dashboardPanelData.meta.stream.vrlFunctionFieldList.forEach((field: any) => {
    flattenedFields.push({
      name: field.name,
      type: field.type,
      isGroup: false,
    });
  });

  dashboardPanelData.meta.streamFields.groupedFields.forEach((group: any) => {
    flattenedFields.push({
      isGroup: true,
      groupName: group.name,
    });

    if (
      group.settings.hasOwnProperty("defined_schema_fields") &&
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
          group.settings.hasOwnProperty("defined_schema_fields") &&
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

  return flattenedFields;
});

watch(
  () => ({
    stream:
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
        .fields.stream,
    streamType:
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
        .fields.stream_type,
    joins:
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
        .joins,
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

function isRowDragEnabled(row: FieldItem, _index: number): boolean {
  if (hideAllFieldsSelection.value) return false;
  if (promqlMode.value) return false;
  const currentQuery =
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
  if (currentQuery.customQuery && !customFieldNames.value.has(row.name)) {
    return false;
  }
  return true;
}

function onDragStart(row: FieldItem, _event: DragEvent) {
  dashboardPanelData.meta.dragAndDrop.dragging = true;
  dashboardPanelData.meta.dragAndDrop.dragElement = row;
  dashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
  dashboardPanelData.meta.dragAndDrop.dragSourceIndex = null;
}

function onDragEnd(_row: FieldItem, _event: DragEvent) {
  cleanupDraggingFields();
}

// ── Sort ───────────────────────────────────────────────────────────────

function sortFieldsFn(a: FieldItem, b: FieldItem): number {
  // Group headers always come first within their section
  if (a.isGroup && b.isGroup) return 0;
  if (a.isGroup) return -1;
  if (b.isGroup) return 1;

  const aIsCustom = customFieldNames.value.has(a.name);
  const bIsCustom = customFieldNames.value.has(b.name);

  const aPriority = aIsCustom ? 0 : 1;
  const bPriority = bIsCustom ? 0 : 1;
  return aPriority - bPriority;
}

// ── Search binding ─────────────────────────────────────────────────────

function onSearchChange(value: string) {
  dashboardPanelData.meta.stream.filterField = value;
}

// ── Action visibility helpers ──────────────────────────────────────────

function showStandardActions(row: FieldItem, _index: number): boolean {
  if (hideAllFieldsSelection.value) return false;
  if (promqlMode.value) return false;

  const currentQuery =
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
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

function showGeomapActions(row: FieldItem, _index: number): boolean {
  if (hideAllFieldsSelection.value) return false;
  if (promqlMode.value) return false;

  const currentQuery =
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
  if (currentQuery.customQuery && !customFieldNames.value.has(row.name)) {
    return false;
  }

  return dashboardPanelData.data.type === "geomap";
}

function showMapsActions(row: FieldItem, _index: number): boolean {
  if (hideAllFieldsSelection.value) return false;
  if (promqlMode.value) return false;

  const currentQuery =
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
  if (currentQuery.customQuery && !customFieldNames.value.has(row.name)) {
    return false;
  }

  return dashboardPanelData.data.type === "maps";
}

function showSankeyActions(row: FieldItem, _index: number): boolean {
  if (hideAllFieldsSelection.value) return false;
  if (promqlMode.value) return false;

  const currentQuery =
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
  if (currentQuery.customQuery && !customFieldNames.value.has(row.name)) {
    return false;
  }

  return dashboardPanelData.data.type === "sankey";
}

// ── Type icon helper ───────────────────────────────────────────────────

function getTypeIcon(type: string | undefined): string {
  if (!type) return "tag";
  if (type === "Utf8") return "text-fields";
  if (type === "Boolean") return "toggle-off";
  return "tag";
}

// ── Stream list fetch ──────────────────────────────────────────────────

const getStreamList = async (stream_type: any) => {
  await getStreams(stream_type, false).then((res: any) => {
    dashboardPanelData.meta.stream.streamResults = [];
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

<style lang="scss" scoped>
.index-menu {
  width: 100%;
  height: 100%;

  .q-field {
    &__control {
      height: 35px;
      padding: 0px 5px;
      min-height: auto !important;

      &-container {
        padding-top: 0px !important;
      }
    }

    &__native :first-of-type {
      padding-top: 0.25rem;
    }
  }
}

.field_icons {
  display: flex;
  align-items: center;
  gap: 0.125rem;
}

.field-group-header {
  font-size: 0.75rem;
}

.theme-dark {
  .field-group-header {
    background-color: var(--o2-header-menu-bg);
  }
}

.theme-light {
  .field-group-header {
    background-color: var(--color-primary-100);
  }
}

.q-field--dense .q-field__before,
.q-field--dense .q-field__prepend {
  padding: 0px 0px 0px 0px;
  height: auto;
  line-height: auto;
}

.q-field__native,
.q-field__input {
  padding: 0px 0px 0px 0px;
}

.q-field--dense .q-field__label {
  top: 5px;
}

:deep(.metric_icon_present .q-field__label) {
  margin-left: -24px;
}

.q-field--dense .q-field__control,
.q-field--dense .q-field__marginal {
  height: 34px;
}
</style>
