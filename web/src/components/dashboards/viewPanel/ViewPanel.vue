<!-- Copyright 2026 OpenObserve Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
-->

<!-- eslint-disable vue/no-unused-components -->
<template>
  <div class="flex h-full flex-col overflow-hidden" data-test="view-panel-screen">
    <div class="flex items-center justify-between p-3 max-md:flex-wrap max-md:gap-y-2">
      <div
        class="me-3 flex min-w-0 items-center text-xl tracking-[0.005em] max-md:me-0 max-md:flex-1 max-md:basis-full"
      >
        <OTruncatedText data-test="dashboard-viewpanel-title">
          {{ panelTitle }}
        </OTruncatedText>
        <ExemplarToggle
          v-if="viewExemplarsEligible"
          class="ms-2 shrink-0"
          :on="viewExemplarsOn"
          :loading="panelSchemaRendererRef?.exemplarsStatus === 'loading'"
          :count="panelSchemaRendererRef?.exemplarsCount ?? 0"
          data-test="dashboard-viewpanel-exemplars-toggle"
          @toggle="setViewExemplarOverride(!viewExemplarsOn)"
        />
      </div>
      <div class="flex shrink-0 items-center gap-2 max-md:ms-auto">
        <!-- histogram interval for sql queries -->
        <HistogramIntervalDropDown
          v-if="!promqlMode && histogramFields.length"
          v-model="histogramInterval"
          class="hover:bg-interactive-hover-bg h-7.5 w-37.5 transition-all duration-200"
          data-test="dashboard-viewpanel-histogram-interval-dropdown"
        />

        <DateTimePickerDashboard
          :model-value="pickedDate ?? selectedDate"
          :auto-apply-dashboard="true"
          ref="dateTimePickerRef"
          class="hover:bg-interactive-hover-bg h-7.5 min-h-7.5 transition-all duration-200"
          data-test="dashboard-viewpanel-date-time-picker"
          :disable="disable"
          calendar-presets
          @update:model-value="timeGate.onPick"
          @show="timeGate.onShow"
          @hide="onTimePickerHide"
          @timezone-change="timeGate.flush"
        />
        <AutoRefreshInterval
          v-model="refreshInterval"
          trigger
          :min-refresh-interval="store.state?.zoConfig?.min_auto_refresh_interval || 5"
          @trigger="refreshData"
          class="hover:bg-interactive-hover-bg h-7.5 transition-all duration-200"
          data-test="dashboard-viewpanel-refresh-interval"
        />
        <OButtonGroup class="shrink-0">
          <OTooltip v-if="isCancelShown" :content="t('panel.cancel')" :disabled="!isMobile">
            <OButton
              variant="cancel-query"
              :size="isMobile ? 'icon-toolbar' : 'sm-toolbar'"
              @click="cancelViewPanelQuery"
              :aria-label="t('panel.cancel')"
              data-test="dashboard-viewpanel-cancel-btn"
              :icon-left="isMobile ? 'cancel' : undefined"
            >
              <!-- Both labels share one grid cell: Cancel keeps the Refresh width and still fits a longer translation. -->
              <span v-if="!isMobile" class="grid items-center justify-items-center">
                <span
                  class="invisible col-start-1 row-start-1 flex items-center gap-1.5"
                  aria-hidden="true"
                >
                  <OIcon name="refresh" size="sm" />{{ t("dashboard.viewDashboard.refresh") }}
                </span>
                <span class="col-start-1 row-start-1">{{ t("panel.cancel") }}</span>
              </span>
            </OButton>
          </OTooltip>
          <!-- Wrapper mode: a child-mode tooltip would hover-bind only the icon, not the labelled button. -->
          <OTooltip
            v-else
            :content="refreshTooltip"
            :disabled="!isMobile && !isAutoRunOn && !showApplyHint"
          >
            <OButton
              :variant="refreshVariant"
              :size="isMobile ? 'icon-toolbar' : 'sm-toolbar'"
              @click="refreshData"
              :disabled="disable"
              :aria-label="t('dashboard.viewDashboard.refresh')"
              data-test="dashboard-viewpanel-refresh-data-btn"
              :icon-left="isAutoRunOn ? 'autorenew' : 'refresh'"
            >
              <template v-if="!isMobile">{{ t("dashboard.viewDashboard.refresh") }}</template>
            </OButton>
          </OTooltip>
          <ODropdown v-if="isAutoRunAvailable" align="end" side="bottom">
            <template #trigger>
              <OButton
                :variant="refreshOptionsVariant"
                size="icon-toolbar"
                class="w-5!"
                :disabled="disable"
                :aria-label="t('dashboard.viewDashboard.moreRefreshOptions')"
                data-test="dashboard-viewpanel-refresh-options-btn"
                icon-left="arrow-drop-down"
              />
            </template>
            <ODropdownItem
              data-test="dashboard-viewpanel-refresh-item"
              icon-left="refresh"
              :disabled="disable"
              @select="refreshData"
            >
              {{ t("common.refresh") }}
            </ODropdownItem>
            <ODropdownSeparator />
            <ODropdownItem
              data-test="dashboard-viewpanel-auto-run-toggle-btn"
              @select="toggleAutoRun"
            >
              <template #icon-left>
                <OIcon
                  :name="isAutoRunOn ? 'autorenew' : 'sync-disabled'"
                  size="sm"
                  :class="isAutoRunOn ? 'text-accent' : ''"
                />
              </template>
              <span>
                <div class="font-medium">
                  {{ isAutoRunOn ? t("search.turnOffLiveMode") : t("search.turnOnLiveMode") }}
                </div>
                <div class="text-text-secondary text-xs">
                  {{ t("dashboard.viewDashboard.autoRunDescription") }}
                </div>
                <div
                  class="text-text-secondary text-xs"
                  data-test="dashboard-viewpanel-auto-run-scope"
                >
                  {{ t("dashboard.viewDashboard.autoRunScope") }}
                </div>
              </span>
            </ODropdownItem>
          </ODropdown>
        </OButtonGroup>
        <OButton
          :aria-label="t('common.close')"
          variant="outline"
          size="icon-toolbar"
          @click="goBack"
          data-test="dashboard-viewpanel-close-btn"
          icon-left="close"
        >
        </OButton>
      </div>
    </div>
    <OSeparator />
    <div class="flex flex-1 overflow-hidden">
      <div class="flex h-full w-full flex-col">
        <div class="flex h-full w-full">
          <div class="flex h-full w-full flex-col">
            <div class="flex h-full flex-col">
              <VariablesValueSelector
                :variablesConfig="currentDashboardData.data?.variables"
                :showDynamicFilters="currentDashboardData.data?.variables?.showDynamicFilters"
                :selectedTimeDate="dateTimeForVariables || dashboardPanelData.meta.dateTime"
                :initialVariableValues="getInitialVariablesData()"
                @variablesData="variablesDataUpdated"
                data-test="dashboard-viewpanel-variables-value-selector"
                :showAllVisible="true"
                :tabId="currentTabId"
                :panelId="currentPanelId"
              />
              <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div
                  class="me-2 flex shrink-0 items-center justify-end"
                  data-test="view-panel-last-refreshed-at"
                >
                  <PanelViewToggle
                    v-if="showDataViewToggle"
                    v-model="previewView"
                    class="ms-2 me-auto"
                    data-test-prefix="dashboard-viewpanel"
                  />
                  <!-- Error/Warning tooltips -->
                  <PanelErrorButtons
                    :error="errorMessage"
                    :maxQueryRangeWarning="maxQueryRangeWarning"
                    :limitNumberOfSeriesWarningMessage="limitNumberOfSeriesWarningMessage"
                    v-bind="noticeProps"
                    :canEdit="canEditFromNotice"
                    :canRefresh="true"
                    @refresh-panel="refreshData"
                    @edit-panel="onNoticeEditPanel"
                    :sparklineWarning="sparklineWarning"
                    :isCachedDataDifferWithCurrentTimeRange="isCachedDataDifferWithCurrentTimeRange"
                    :isPartialData="isPartialData"
                    :isPanelLoading="isPanelLoading"
                    :lastTriggeredAt="lastTriggeredAt"
                    :viewOnly="false"
                  />
                </div>
                <div class="relative flex min-h-0 flex-1 flex-col">
                  <PanelSchemaRenderer
                    class="min-h-0 flex-1"
                    v-if="chartData"
                    :key="dashboardPanelData.data.type"
                    :panelSchema="chartData"
                    :dashboard-id="dashboardId"
                    :folder-id="folderId"
                    :selectedTimeObj="dashboardPanelData.meta.dateTime"
                    :variablesData="currentVariablesDataRef"
                    :currentVariablesData="liveVariablesData"
                    :tabId="currentTabId"
                    :panelId="currentPanelId"
                    :width="6"
                    :searchType="searchType"
                    :showLegendsButton="true"
                    :exemplars-override="viewExemplarOverride"
                    @error="handleChartApiError"
                    @updated:data-zoom="onDataZoom"
                    @update:initialVariableValues="onUpdateInitialVariableValues"
                    @last-triggered-at-update="handleLastTriggeredAtUpdate"
                    @result-metadata-update="handleResultMetadataUpdate"
                    @panel-diagnostics-update="handlePanelDiagnosticsUpdate"
                    @series-limit-update="handleSeriesLimitUpdate"
                    @region-join-update="handleRegionJoinUpdate"
                    @sankey-notice-update="handleSankeyNoticeUpdate"
                    @limit-number-of-series-warning-message-update="
                      handleLimitNumberOfSeriesWarningMessage
                    "
                    @sparkline-warning-update="handleSparklineWarningUpdate"
                    @is-partial-data-update="handleIsPartialDataUpdate"
                    @loading-state-change="handleLoadingStateChange"
                    @is-cached-data-differ-with-current-time-range-update="
                      handleIsCachedDataDifferWithCurrentTimeRangeUpdate
                    "
                    @show-legends="showLegendsDialog = true"
                    data-test="dashboard-viewpanel-panel-schema-renderer"
                    ref="panelSchemaRendererRef"
                  />
                  <PanelDataView
                    v-if="showDataOverlay && chartData"
                    class="absolute inset-0 z-10"
                    :data="previewRawData"
                    :query-type="dashboardPanelData.data.queryType"
                    :loading="isPanelLoading"
                    data-test-prefix="dashboard-viewpanel"
                  />
                </div>
              </div>
              <DashboardErrorsComponent
                :errors="errorData"
                data-test="dashboard-viewpanel-dashboard-errors"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <ShowLegendsPopup v-model:open="showLegendsDialog" :panelData="currentPanelData" />
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  toRaw,
  nextTick,
  watch,
  reactive,
  onUnmounted,
  onMounted,
  onBeforeMount,
  onActivated,
  inject,
  provide,
  computed,
  defineAsyncComponent,
} from "vue";

import { useI18nTyped } from "@/types/i18n";
import { usePanelTitle } from "@/composables/dashboard/usePanelTitle";
import { getDashboard, getPanel, checkIfVariablesAreLoaded } from "../../../utils/commons";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import DateTimePickerDashboard from "../../../components/DateTimePickerDashboard.vue";
import DashboardErrorsComponent from "../../../components/dashboards/addPanel/DashboardErrors.vue";
import VariablesValueSelector from "../../../components/dashboards/VariablesValueSelector.vue";
import PanelSchemaRenderer from "../../../components/dashboards/PanelSchemaRenderer.vue";
import PanelDataView from "@/components/dashboards/addPanel/PanelDataView.vue";
import PanelViewToggle from "@/components/dashboards/PanelViewToggle.vue";
import { usePanelDataView } from "@/composables/dashboard/usePanelDataView";
// import _ from "lodash-es";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import { parseDuration } from "@/utils/date";
import HistogramIntervalDropDown from "@/components/dashboards/addPanel/HistogramIntervalDropDown.vue";
import { replaceHistogramInterval } from "@/utils/dashboard/histogramIntervalReplacer";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import config from "@/aws-exports";
import { isEqual } from "lodash-es";
import { usePanelNotices } from "@/composables/dashboard/usePanelNotices";
import {
  PANEL_EDITOR_FOCUS_PARAM,
  type PanelEditorFocusTarget,
} from "@/composables/dashboard/usePanelEditorFocus";
import type { PanelNoticeActionId } from "@/utils/dashboard/panelNotices";
import { useVariablesManager } from "@/composables/dashboard/useVariablesManager";
import { useAutoRunToggle } from "@/composables/dashboard/useAutoRunToggle";
import { useDashboardTimeGate } from "@/composables/dashboard/useDashboardTimeGate";
import useBreakpoint from "@/composables/useBreakpoint";
import {
  DASHBOARD_FRESH_PANEL_TIME,
  freshTimeFromAppliedRange,
} from "@/composables/dashboard/dashboardFreshPanelTime";
import { panelRefreshTargets } from "@/utils/dashboard/convertCustomChartData";
import { pickerValueToTimeObj, toPickerSavedDate } from "@/utils/dashboard/panelTimeUtils";
import OButton from "@/lib/core/Button/OButton.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import ExemplarToggle from "@/components/dashboards/exemplars/ExemplarToggle.vue";
import {
  exemplarOverrideKey,
  useExemplarOverride,
} from "@/composables/dashboard/useExemplarOverride";
import { isExemplarEligible } from "@/utils/dashboard/exemplars/exemplarEligibility";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

const ShowLegendsPopup = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/ShowLegendsPopup.vue");
});
const PanelErrorButtons = defineAsyncComponent(() => {
  return import("@/components/dashboards/PanelErrorButtons.vue");
});

export default defineComponent({
  name: "ViewPanel",
  components: {
    OSeparator,
    DateTimePickerDashboard,
    DashboardErrorsComponent,
    VariablesValueSelector,
    PanelSchemaRenderer,
    PanelDataView,
    PanelViewToggle,
    AutoRefreshInterval,
    HistogramIntervalDropDown,
    ShowLegendsPopup,
    PanelErrorButtons,
    OButton,
    OButtonGroup,
    ODropdown,
    ODropdownItem,
    ODropdownSeparator,
    OIcon,
    OTooltip,
    ExemplarToggle,
    OTruncatedText,
  },
  props: {
    panelId: {
      type: String,
      required: true,
    },
    dashboardId: {
      type: String,
      required: false,
    },
    folderId: {
      type: String,
      required: false,
    },
    selectedDateForViewPanel: {
      type: Object,
    },
    initialVariableValues: {
      type: Object,
    },
    searchType: {
      default: null,
      type: String || null,
    },
    /** Read-only embedding: hides the notices' editor actions (Use Top N, Edit function). */
    viewOnly: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["closePanel", "update:initialVariableValues"],
  setup(props, { emit }) {
    // This will be used to copy the chart data to the chart renderer component
    // This will deep copy the data object without reactivity and pass it on to the chart renderer
    const chartData = ref();
    const showLegendsDialog = ref(false);
    const panelSchemaRendererRef: any = ref(null);
    const { t } = useI18nTyped();
    const route = useRoute();
    const store = useStore();

    // IMPORTANT: Always create a NEW isolated instance for ViewPanel
    // ViewPanel should NEVER share the variables manager with the parent dashboard
    // This ensures that variable changes in ViewPanel don't affect the parent dashboard
    const variablesManager = useVariablesManager(t);

    // Provide to child components (ViewPanel's own isolated instance)
    provide("variablesManager", variablesManager);

    const currentVariablesDataRef: any = reactive({});

    let parser: any;
    const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
    const { dashboardPanelData, promqlMode, resetDashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
      t,
    );
    const {
      previewView,
      showDataViewToggle,
      showDataOverlay,
      rawData: previewRawData,
    } = usePanelDataView({
      panelType: () => dashboardPanelData.data.type,
      renderer: panelSchemaRendererRef,
    });
    // The applied range the chart loads with; the picker's own value is `timeGate.picked`.
    const selectedDate: any = ref(props.selectedDateForViewPanel);
    const dateTimePickerRef: any = ref(null);
    const errorData: any = reactive({
      errors: [],
    });
    let variablesData: any = reactive({});
    // True while the selector holds values the chart has not applied yet.
    const isVariablesChanged = ref(false);
    let needsVariablesAutoUpdate = true;

    const variablesDataUpdated = (data: any) => {
      try {
        // update the variables data
        Object.assign(variablesData, data);

        if (needsVariablesAutoUpdate) {
          // check if the length is > 0
          if (checkIfVariablesAreLoaded(variablesData)) {
            needsVariablesAutoUpdate = false;
          }

          Object.assign(currentVariablesDataRef, variablesData);
        }

        return;
      } catch (error) {
        /* ignore: best-effort */
      }

      // resize the chart when variables data is updated
      // because if variable requires some more space then need to resize chart
      // NOTE: need to improve this logic it should only called if the variable requires more space
      window.dispatchEvent(new Event("resize"));
    };
    const currentDashboardData: any = reactive({
      data: {},
    });

    // refresh interval v-model
    const refreshInterval = ref(0);

    // histogram interval
    const histogramInterval: any = ref(null);

    // array of histogram fields
    let histogramFields: any = ref([]);

    // to store and show when the panel was last loaded
    const lastTriggeredAt = ref(null);
    const handleLastTriggeredAtUpdate = (data: any) => {
      lastTriggeredAt.value = data;
    };

    // Warning messages
    // Function errors and partial reasons have their own header chips; the range warning keeps the rest.
    const {
      maxQueryRangeWarning,
      noticeProps,
      handleResultMetadataUpdate,
      handlePanelDiagnosticsUpdate,
      handleSeriesLimitUpdate,
      handleRegionJoinUpdate,
      handleSankeyNoticeUpdate,
    } = usePanelNotices(() => store.state.timezone);
    const limitNumberOfSeriesWarningMessage = ref("");
    const sparklineWarning = ref("");
    const errorMessage = ref("");
    const isPartialData = ref(false);
    const isPanelLoading = ref(false);
    const isCachedDataDifferWithCurrentTimeRange = ref(false);

    const handleIsPartialDataUpdate = (data: boolean) => {
      isPartialData.value = data;
    };

    const handleLoadingStateChange = (data: boolean) => {
      isPanelLoading.value = data;
    };

    const handleIsCachedDataDifferWithCurrentTimeRangeUpdate = (data: boolean) => {
      isCachedDataDifferWithCurrentTimeRange.value = data;
    };

    onBeforeMount(async () => {
      await importSqlParser();
    });

    const importSqlParser = async () => {
      const useSqlParser: any = await import("@/composables/useParser");
      const { sqlParser }: any = useSqlParser.default();
      parser = await sqlParser();
    };

    // Track if we're in initial setup to avoid marking interval as changed on mount
    let isInitialHistogramSetup = true;

    watch(
      () => histogramInterval.value,
      async () => {
        // Capture the flag BEFORE any await — it may change while we're paused
        const wasInitialSetup = isInitialHistogramSetup;

        // import sql parser if not imported
        if (!parser) {
          await importSqlParser();
        }
        // replace the histogram interval in the query by finding histogram aggregation
        dashboardPanelData?.data?.queries?.forEach((query: any) => {
          const originalQuery = query.query;
          const updatedQuery = replaceHistogramInterval(originalQuery, histogramInterval.value);

          // Only update if the query actually changed
          if (updatedQuery !== originalQuery) {
            query.query = updatedQuery;
          }
        });

        // Mark as changed to signal refresh needed (unless this is initial setup)
        if (!wasInitialSetup) {
          isVariablesChanged.value = true;
        }
      },
    );

    const onDataZoom = (event: any) => {
      const selectedDateObj = {
        start: new Date(event.start),
        end: new Date(event.end),
      };
      // Truncate seconds and milliseconds from the dates
      selectedDateObj.start.setSeconds(0, 0);
      selectedDateObj.end.setSeconds(0, 0);

      // Compare the truncated dates
      if (selectedDateObj.start.getTime() === selectedDateObj.end.getTime()) {
        // Increment the end date by 1 minute
        selectedDateObj.end.setMinutes(selectedDateObj.end.getMinutes() + 1);
      }

      // set it as a absolute time
      dateTimePickerRef?.value?.setCustomDate("absolute", selectedDateObj);
    };

    onUnmounted(async () => {
      // clear a few things
      resetDashboardPanelData();
      parser = null;
    });

    onMounted(async () => {
      errorData.errors = [];

      // todo check for the edit more
      if (props.panelId) {
        const panelData = await getPanel(
          store,
          route.query.dashboard,
          props.panelId,
          route.query.folder,
          route.query.tab ?? dashboardPanelData.data.panels?.[0]?.tabId,
        );
        Object.assign(dashboardPanelData.data, JSON.parse(JSON.stringify(panelData)));
        await nextTick();
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      }

      //if sql, get histogram fields from all queries
      histogramFields.value =
        dashboardPanelData.data.queryType != "sql"
          ? []
          : dashboardPanelData.data.queries
              .map((q: any) =>
                [...q.fields.x, ...q.fields.y, ...q.fields.z].find(
                  (f: any) => f.functionName == "histogram",
                ),
              )
              .filter((field: any) => field != undefined);

      // if there is at least 1 histogram field
      // then set the default histogram interval
      if (histogramFields.value.length > 0) {
        for (let i = 0; i < histogramFields.value.length; i++) {
          if (histogramFields.value[i]?.args && histogramFields.value[i]?.args.length > 0) {
            // Histogram function signature: histogram(field, interval)
            // args[0] = timestamp field (object)
            // args[1] = interval (string like '5m', '1h', etc.)

            // Check if there's a second argument (the interval)
            if (histogramFields.value[i].args.length > 1 && histogramFields.value[i].args[1]) {
              const intervalArg = histogramFields.value[i].args[1];

              // Extract interval value with explicit type checking
              let intervalValue: string | null = null;

              if (typeof intervalArg === "string") {
                // Direct string value
                intervalValue = intervalArg;
              } else if (typeof intervalArg === "object" && intervalArg !== null) {
                // Object with value property
                if ("value" in intervalArg && typeof intervalArg.value === "string") {
                  intervalValue = intervalArg.value;
                }
              }

              // Set the histogram interval only if we have a valid non-empty string
              if (intervalValue && intervalValue.trim() !== "") {
                histogramInterval.value = intervalValue;
              } else {
                // No valid interval - use Auto mode
                histogramInterval.value = null;
              }
              break;
            } else {
              // No interval specified - this is "Auto" mode
              histogramInterval.value = null;
              break;
            }
          }
        }
      }

      // Mark that initial histogram setup is complete
      await nextTick();
      isInitialHistogramSetup = false;

      loadDashboard();
    });

    onActivated(() => {
      const params: any = route.query;

      if (params.refresh) {
        refreshInterval.value = parseDuration(params.refresh);
      }
    });
    watch(
      () => variablesData,
      () => {
        const hasApplied = currentVariablesDataRef?.values?.length > 0;
        const isInSync =
          hasApplied &&
          variablesData.values?.every((variable: any, index: number) => {
            const prevValue = currentVariablesDataRef.values[index]?.value;
            const newValue = variable.value;
            // Compare current and previous values; handle both string and array cases
            return Array.isArray(newValue) ? isEqual(prevValue, newValue) : prevValue === newValue;
          });
        isVariablesChanged.value = hasApplied && !isInSync;
      },
      { deep: true },
    );
    const refreshData = () => {
      if (!disable.value) {
        // Apply histogram interval to ALL queries before copying to chartData
        dashboardPanelData.data.queries?.forEach((query: any) => {
          const originalQuery = query.query;
          const updatedQuery = replaceHistogramInterval(originalQuery, histogramInterval.value);
          if (updatedQuery !== originalQuery) {
            query.query = updatedQuery;
          }
        });

        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
        timeGate.refresh();
        Object.assign(currentVariablesDataRef, JSON.parse(JSON.stringify(variablesData)));
        isVariablesChanged.value = false;
      }
    };

    const { isAutoRunAvailable, isAutoRunOn, toggleAutoRun } = useAutoRunToggle();

    const timeGate = useDashboardTimeGate({
      applied: selectedDate,
      isAutoRunOn: () => isAutoRunOn.value,
      showInPicker: (value) =>
        dateTimePickerRef.value?.setSavedDate(toPickerSavedDate(value, store.state.timezone)),
    });

    const showApplyHint = computed(
      () => (isVariablesChanged.value && !isAutoRunOn.value) || timeGate.needsRefresh.value,
    );

    const { isMobile } = useBreakpoint();
    const refreshVariant = computed(() => (showApplyHint.value ? "pending" : "primary"));

    const refreshTooltip = computed(() => {
      if (isAutoRunOn.value) return t("dashboard.viewDashboard.autoRunDescription");
      if (timeGate.needsRefresh.value) {
        return isVariablesChanged.value
          ? t("dashboard.refreshToApplyTimeRangeAndVariables")
          : t("dashboard.refreshToApplyTimeRange");
      }
      return isVariablesChanged.value
        ? t("dashboard.refreshToApplyVariables")
        : t("common.refresh");
    });

    watch(isAutoRunOn, (on) => variablesManager.setLiveMode(on), { immediate: true });

    // Resolved from this view's own range, which the dashboard's resolver knows nothing about.
    provide(
      DASHBOARD_FRESH_PANEL_TIME,
      freshTimeFromAppliedRange(
        () => isAutoRunOn.value,
        () => selectedDate.value,
      ),
    );

    // The chart reads the selector snapshot, not the manager's committed state, so apply it here.
    const stopAutoCommit = variablesManager.onAutoCommit(async () => {
      await nextTick();
      Object.assign(currentVariablesDataRef, JSON.parse(JSON.stringify(variablesData)));
      isVariablesChanged.value = false;
    });
    onUnmounted(stopAutoCommit);

    const currentDashboard = toRaw(store.state.currentSelectedDashboard);

    const loadDashboard = async () => {
      let data = JSON.parse(
        JSON.stringify(
          await getDashboard(store, route.query.dashboard, route.query.folder ?? "default"),
        ),
      );
      currentDashboardData.data = data;

      // Initialize variables manager with dashboard variables
      try {
        // Get current tab and panel IDs for initialization
        const tabId = (route.query.tab as string) ?? currentDashboardData.data?.tabs?.[0]?.tabId;

        // Initialize with panel-to-tab mapping (3rd parameter is critical for panel variables!)
        await variablesManager.initialize(
          currentDashboardData.data?.variables?.list || [],
          currentDashboardData.data,
          props.panelId ? { [props.panelId]: tabId || "" } : {},
        );

        // Mark current tab and panel as visible so their variables can load
        // This needs to happen BEFORE loading from URL so tab/panel scoped variables exist
        if (tabId) {
          variablesManager.setTabVisibility(tabId, true);
        }

        // Mark the panel as visible
        if (props.panelId) {
          variablesManager.setPanelVisibility(props.panelId, true);
        }

        // If parent passed variable values, use them to prevent API calls for those variables
        if (
          props.initialVariableValues &&
          props.initialVariableValues.values &&
          props.initialVariableValues.values.length > 0
        ) {
          // Update variablesManager with passed values
          props.initialVariableValues.values.forEach((passedVar: any) => {
            // Find and update the variable in the manager (global scope)
            const globalVar = variablesManager.variablesData.global.find(
              (v: any) => v.name === passedVar.name,
            );
            if (globalVar) {
              globalVar.value = passedVar.value;
              globalVar.isVariablePartialLoaded = true;
              globalVar.isLoading = false;
              // Set pending to false to prevent API call
              globalVar.isVariableLoadingPending = false;
            }
          });

          // Also populate currentVariablesDataRef with passed values
          Object.assign(currentVariablesDataRef, props.initialVariableValues);
          Object.assign(variablesData, props.initialVariableValues);
        }

        // Load variable values from URL parameters (supports tab-level and panel-level variables)
        // This handles patterns like:
        // - var-myVar (global)
        // - var-myVar.t.tabId (tab-scoped)
        // - var-myVar.p.panelId (panel-scoped)
        // URL values will OVERRIDE parent-passed values
        variablesManager.loadFromUrl(route);

        // Commit the values immediately so they're used by the chart
        variablesManager.commitAll();
      } catch (error) {
        /* ignore: best-effort */
      }

      // if variables data is null, set it to empty list
      if (!(
        currentDashboardData.data?.variables && currentDashboardData.data?.variables?.list.length
      )) {
        variablesData.isVariablesLoading = false;
        variablesData.values = [];
      }
    };

    watch(selectedDate, () => {
      updateDateTime();

      // CRITICAL: When the applied date time changes, also commit any pending variable changes
      // This ensures that if user changed both variables and date time,
      // both changes are applied to the chart together
      Object.assign(currentVariablesDataRef, JSON.parse(JSON.stringify(variablesData)));

      isVariablesChanged.value = false;
    });

    const dateTimeForVariables = ref<{
      start_time: Date;
      end_time: Date;
    } | null>(null);

    // Variables load with the applied range; a range still waiting must not reach them.
    const setTimeForVariables = () => {
      const appliedTime = pickerValueToTimeObj(selectedDate.value);
      if (appliedTime) dateTimeForVariables.value = appliedTime;
    };

    const onTimePickerHide = () => {
      timeGate.onHide();
      setTimeForVariables();
    };

    const updateDateTime = () => {
      const appliedTime = pickerValueToTimeObj(selectedDate.value);
      if (!appliedTime) return;

      // CRITICAL: Clear panelRefreshTargets to ensure panel refreshes
      // In view panel mode, when time changes, this panel should always refresh
      panelRefreshTargets.clear();

      dashboardPanelData.meta.dateTime = appliedTime;

      dateTimeForVariables.value = {
        start_time: new Date(appliedTime.start_time),
        end_time: new Date(appliedTime.end_time),
      };
    };
    const goBack = () => {
      emit("closePanel");
    };

    const handleChartApiError = (errorMsg: { message: string; code: string }) => {
      if (errorMsg?.message) {
        errorMessage.value = errorMsg.message;
        const errorList = errorData.errors ?? [];
        errorList.splice(0);
        errorList.push(errorMsg.message);
      }
    };

    // Handle limit number of series warning from PanelSchemaRenderer
    const handleLimitNumberOfSeriesWarningMessage = (message: string) => {
      limitNumberOfSeriesWarningMessage.value = message;
    };
    const handleSparklineWarningUpdate = (message: string) => {
      sparklineWarning.value = message;
    };

    const router = useRouter();
    // The fix lives in the editor: close this view and land there on the setting that resolves the notice.
    const canEditFromNotice = computed(() => !props.viewOnly && !!route.query.dashboard);
    const onNoticeEditPanel = (action: PanelNoticeActionId) => {
      const focus: PanelEditorFocusTarget = action === "edit-function" ? "vrl" : "top-n";
      emit("closePanel");
      router.push({
        path: "/dashboards/add_panel",
        query: {
          ...route.query,
          dashboard: String(route.query.dashboard),
          panelId: props.panelId,
          folder: route.query.folder ?? "default",
          tab: route.query.tab ?? currentTabId.value,
          [PANEL_EDITOR_FOCUS_PARAM]: focus,
        },
      });
    };

    const getInitialVariablesData = () => {
      const variableObj: any = {};
      props?.initialVariableValues?.values?.forEach((variable: any) => {
        if (variable.type === "dynamic_filters") {
          const filters = (variable.value || []).filter(
            (item: any) => item.name && item.operator && item.value,
          );
          const encodedFilters = filters.map((item: any) => ({
            name: item.name,
            operator: item.operator,
            value: item.value,
          }));
          variableObj[`${variable.name}`] = encodeURIComponent(JSON.stringify(encodedFilters));
        } else {
          variableObj[`${variable.name}`] = variable.value;
        }
      });
      // pass initial variable values in value property
      return { value: variableObj };
    };

    const onUpdateInitialVariableValues = (...args: any[]) => {
      emit("update:initialVariableValues", ...args);
    };

    // [START] cancel running queries

    //reactive object for loading state of variablesData and panels
    const variablesAndPanelsDataLoadingState = reactive({
      variablesData: {},
      panels: {},
      searchRequestTraceIds: {},
    });

    // provide variablesAndPanelsDataLoadingState to share data between components
    provide("variablesAndPanelsDataLoadingState", variablesAndPanelsDataLoadingState);

    const searchRequestTraceIds = computed(() => {
      const searchIds = Object.values(
        variablesAndPanelsDataLoadingState.searchRequestTraceIds,
      ).filter((item: any) => item.length > 0);
      return searchIds.flat() as string[];
    });

    const { traceIdRef, cancelQuery } = useCancelQuery(t);

    const cancelViewPanelQuery = () => {
      traceIdRef.value = searchRequestTraceIds.value;
      cancelQuery();
    };

    const disable = ref(false);
    const isCancelShown = computed(
      () =>
        config.isEnterprise == "true" && searchRequestTraceIds.value.length > 0 && disable.value,
    );
    const refreshOptionsVariant = computed(() =>
      isCancelShown.value ? "cancel-query" : refreshVariant.value,
    );

    watch(variablesAndPanelsDataLoadingState, () => {
      const panelsValues = Object.values(variablesAndPanelsDataLoadingState.panels);
      disable.value = panelsValues.some((item: any) => item === true);
    });

    // [END] cancel running queries

    // Computed properties for current tab and panel IDs
    const currentTabId = computed(() => {
      return (route.query.tab as string) ?? currentDashboardData.data?.tabs?.[0]?.tabId;
    });

    const currentPanelId = computed(() => {
      return props.panelId;
    });

    const panelTitle = usePanelTitle({
      title: () => dashboardPanelData.data.title,
      variablesData: () => currentVariablesDataRef,
      context: () => ({ tabId: currentTabId.value, panelId: currentPanelId.value }),
    });

    // Same session key as the dashboard header, so the full-screen choice carries back to the grid.
    const viewExemplarsEligible = computed(() => isExemplarEligible(chartData.value));
    const {
      override: viewExemplarOverride,
      effective: viewExemplarsOn,
      set: setViewExemplarOverride,
    } = useExemplarOverride(
      computed(() =>
        exemplarOverrideKey(
          store.state.selectedOrganization?.identifier ?? "",
          props.dashboardId ?? "",
          String(props.panelId ?? ""),
        ),
      ),
      computed(() => chartData.value?.config?.show_exemplars),
    );

    // Computed property for LIVE merged variables (for HTML/Markdown panels and drilldown)
    // This includes global + tab + panel scoped variables with proper precedence
    const liveVariablesData = computed(() => {
      if (variablesManager && variablesManager.variablesData.isInitialized) {
        const mergedVars = variablesManager.getVariablesForPanel(
          currentPanelId.value,
          currentTabId.value || "",
        );

        return {
          isVariablesLoading: variablesManager.isLoading.value,
          values: mergedVars,
        };
      } else {
        // Fallback to variablesData
        return variablesData;
      }
    });

    const currentPanelData = computed(() => {
      const rendererData = panelSchemaRendererRef.value?.panelData || {};
      return {
        ...rendererData,
        config: dashboardPanelData.data.config || {},
      };
    });

    return {
      t,
      isMobile,
      isCancelShown,
      refreshVariant,
      refreshOptionsVariant,
      setTimeForVariables,
      dateTimeForVariables,
      updateDateTime,
      goBack,
      currentDashboard,
      dashboardPanelData,
      panelTitle,
      chartData,
      selectedDate,
      errorData,
      handleChartApiError,
      handleResultMetadataUpdate,
      handleLimitNumberOfSeriesWarningMessage,
      handleSparklineWarningUpdate,
      variablesDataUpdated,
      currentDashboardData,
      variablesData,
      liveVariablesData,
      dateTimePickerRef,
      refreshInterval,
      refreshData,
      promqlMode,
      histogramInterval,
      histogramFields,
      onDataZoom,
      getInitialVariablesData,
      onUpdateInitialVariableValues,
      lastTriggeredAt,
      handleLastTriggeredAtUpdate,
      searchRequestTraceIds,
      cancelViewPanelQuery,
      disable,
      config,
      currentVariablesDataRef,
      isVariablesChanged,
      showApplyHint,
      refreshTooltip,
      timeGate,
      pickedDate: timeGate.picked,
      onTimePickerHide,
      isAutoRunAvailable,
      isAutoRunOn,
      toggleAutoRun,
      store,
      maxQueryRangeWarning,
      noticeProps,
      handlePanelDiagnosticsUpdate,
      handleSeriesLimitUpdate,
      handleRegionJoinUpdate,
      handleSankeyNoticeUpdate,
      canEditFromNotice,
      onNoticeEditPanel,
      limitNumberOfSeriesWarningMessage,
      sparklineWarning,
      errorMessage,
      warning: "warning",
      currentTabId,
      currentPanelId,
      viewExemplarsEligible,
      viewExemplarOverride,
      viewExemplarsOn,
      setViewExemplarOverride,
      showLegendsDialog,
      currentPanelData,
      panelSchemaRendererRef,
      previewView,
      showDataViewToggle,
      showDataOverlay,
      previewRawData,
      isPartialData,
      isPanelLoading,
      isCachedDataDifferWithCurrentTimeRange,
      handleIsPartialDataUpdate,
      handleLoadingStateChange,
      handleIsCachedDataDifferWithCurrentTimeRangeUpdate,
    };
  },
});
</script>
