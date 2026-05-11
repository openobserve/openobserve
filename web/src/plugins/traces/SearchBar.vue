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
  <div class="search-bar-component tw:h-full" id="searchBarComponent">
    <div class="row tw:m-0! tw:p-[0.375rem]">
      <div class="float-right col flex items-center tw:gap-[0.375rem]">
        <!-- Unified View Toggle: Service Graph / Traces / Spans -->
        <OToggleGroup
          :model-value="searchObj.meta.searchMode"
          @update:model-value="$emit('update:searchMode', $event)"
        >
          <OToggleGroupItem
            data-test="traces-search-mode-spans-btn"
            value="spans"
            size="sm"
          >
            <template #icon-left
              ><Layers class="tw:size-3.5 tw:shrink-0"
            /></template>
            Spans
          </OToggleGroupItem>
          <OToggleGroupItem
            data-test="traces-search-mode-traces-btn"
            value="traces"
            size="sm"
          >
            <template #icon-left
              ><q-icon :name="outlinedAccountTree" class="tw:text-[14px] tw:shrink-0"
            /></template>
            Traces
          </OToggleGroupItem>
          <OToggleGroupItem
            v-if="config.isEnterprise == 'true'"
            data-test="traces-service-graph-toggle"
            value="service-graph"
            size="sm"
          >
            <template #icon-left
              ><Network class="tw:size-3.5 tw:shrink-0"
            /></template>
            Service Graph
          </OToggleGroupItem>
          <OToggleGroupItem
            data-test="traces-search-mode-services-catalog-btn"
            value="services-catalog"
            size="sm"
          >
            <template #icon-left
              ><BookOpen class="tw:size-3.5 tw:shrink-0"
            /></template>
            {{ t("traces.servicesCatalog.tabLabel") }}
          </OToggleGroupItem>
          <!--
            Hidden when no traces stream has `is_llm_stream === true`.
            The parent (`Index.vue`) computes `hasLLMStreams` once
            after `getStreams` resolves; until then the prop defaults
            to `true` so the toggle doesn't flicker on first mount.
            We also keep the toggle visible when the user is already
            on the LLM Insights tab (e.g., navigated via URL) so the
            active selection isn't orphaned mid-session.
          -->
          <OToggleGroupItem
            v-if="hasLLMStreams || searchObj.meta.searchMode === 'llm-insights'"
            data-test="traces-search-mode-llm-insights-btn"
            value="llm-insights"
            size="sm"
          >
            <template #icon-left
              ><Sparkles class="tw:size-3.5 tw:shrink-0"
            /></template>
            LLM Insights
          </OToggleGroupItem>
        </OToggleGroup>

        <!-- Show search controls only when not on Service Graph or Services Catalog or llm insights -->
        <template
          v-if="
            searchObj.meta.searchMode !== 'service-graph' &&
            searchObj.meta.searchMode !== 'services-catalog' &&
            searchObj.meta.searchMode !== 'llm-insights'
          "
        >
          <div
            class="q-pr-xs tw:flex tw:items-center tw:justify-center tw:border-solid tw:border tw:border-[var(--color-button-outline-border)] tw:rounded-[0.375rem]"
          >
            <q-toggle
              data-test="traces-search-bar-show-metrics-toggle-btn"
              v-model="searchObj.meta.showHistogram"
              class="o2-toggle-button-xs tw:flex tw:items-center tw:justify-center"
              size="xs"
              flat
              :class="
                store.state.theme === 'dark'
                  ? 'o2-toggle-button-xs-dark'
                  : 'o2-toggle-button-xs-light'
              "
            >
            </q-toggle>
            <img
              :src="metricsIcon"
              alt="Metrics"
              style="width: 20px; height: 20px"
            />
            <q-tooltip>
              {{ t("traces.RedMetrics") }}
            </q-tooltip>
          </div>
          <OButton
            data-test="traces-search-bar-reset-filters-btn"
            variant="outline"
            size="icon-toolbar"
            @click="resetFilters"
          >
            <q-icon name="restart_alt" size="16px" />
            <q-tooltip>
              {{ t("search.resetFilters") }}
            </q-tooltip>
          </OButton>
          <!-- Error Only Toggle -->
          <div
            class="q-pr-xs tw:flex tw:items-center tw:justify-center tw:border-solid tw:border tw:border-[var(--color-button-outline-border)] tw:rounded-[0.375rem]"
          >
            <q-toggle
              data-test="traces-search-bar-error-only-toggle-btn"
              v-model="searchObj.meta.showErrorOnly"
              class="o2-toggle-button-xs tw:flex tw:items-center tw:justify-center"
              size="xs"
              flat
              :class="
                store.state.theme === 'dark'
                  ? 'o2-toggle-button-xs-dark'
                  : 'o2-toggle-button-xs-light'
              "
              @update:model-value="onErrorOnlyToggle"
            >
            </q-toggle>
            <q-icon
              name="error"
              size="1.1rem"
              class="tw:mx-1 tw:text-red-500"
            />
            <q-tooltip>
              {{ t("traces.showErrorOnly") }}
            </q-tooltip>
          </div>
          <syntax-guide
            data-test="logs-search-bar-sql-mode-toggle-btn"
            :sqlmode="searchObj.meta.sqlMode"
            class="tw:border! tw:border-[var(--color-button-outline-border)]! tw:h-[2rem]! tw:w-[2.25rem]!"
          />
        </template>
      </div>
      <div
        v-if="
          searchObj.meta.searchMode !== 'service-graph' &&
          searchObj.meta.searchMode !== 'services-catalog'
        "
        class="float-right col-auto tw:flex tw:items-center tw:gap-[0.375rem]"
      >
        <date-time
          ref="dateTimeRef"
          auto-apply
          :default-type="searchObj.data.datetime.type"
          :default-absolute-time="{
            startTime: searchObj.data.datetime.startTime,
            endTime: searchObj.data.datetime.endTime,
          }"
          :default-relative-time="searchObj.data.datetime.relativeTimePeriod"
          data-test="logs-search-bar-date-time-dropdown"
          :queryRangeRestrictionInHour="
            searchObj.data.datetime.queryRangeRestrictionInHour
          "
          :queryRangeRestrictionMsg="
            searchObj.data.datetime.queryRangeRestrictionMsg
          "
          class="tw:h-[2rem]"
          @on:date-change="updateDateTime"
          @on:timezone-change="updateTimezone"
        />
        <div class="search-time">
          <div class="tw:flex tw:items-center">
            <OButton
              v-if="config.isEnterprise == 'true' && isLoading"
              variant="ghost"
              data-test="traces-search-bar-cancel-btn"
              :title="t('search.cancel')"
              class="q-pa-none tw:h-[1.875rem]! o2-run-query-button o2-color-cancel element-box-shadow search-button-enterprise-border-radius"
              @click="cancelQueryData"
              >{{ t("search.cancel") }}</OButton
            >
            <OButton
              v-else
              variant="ghost"
              data-test="logs-search-bar-refresh-btn"
              data-cy="search-bar-refresh-button"
              :title="t('search.runQuery')"
              class="q-pa-none tw:h-[1.875rem]! element-box-shadow o2-run-query-button o2-color-primary"
              :class="
                store.state.zoConfig.auto_query_enabled
                  ? 'search-button-enterprise-border-radius'
                  : 'search-button-normal-border-radius'
              "
              @click="searchData"
              :loading="isLoading"
              :disabled="isLoading"
            >
              <q-tooltip
                v-if="
                  searchObj.meta.liveMode &&
                  store.state.zoConfig.auto_query_enabled
                "
                >{{ t("search.autoRunEnabled") }}</q-tooltip
              >
              <q-icon
                v-if="
                  searchObj.meta.liveMode &&
                  store.state.zoConfig.auto_query_enabled
                "
                name="autorenew"
                size="14px"
                class="q-mr-xs"
              />
              {{ t("search.runQuery") }}
            </OButton>
            <!-- Dropdown: shown when live mode feature is enabled -->
            <q-separator
              v-if="store.state.zoConfig.auto_query_enabled && !isLoading"
              class="tw:h-[1.875rem]! tw:w-[1px]"
            />
            <ODropdown
              v-if="store.state.zoConfig.auto_query_enabled && !isLoading"
              side="bottom"
              align="end"
            >
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  :class="[
                    'o2-color-primary',
                    'search-button-dropdown-enterprise-border-radius',
                  ]"
                >
                  <q-icon name="arrow_drop_down" size="18px" />
                </OButton>
              </template>
              <ODropdownItem
                data-test="traces-search-bar-live-mode-toggle-btn"
                @select="toggleLiveMode"
              >
                <template #icon-left>
                  <q-icon
                    :name="
                      searchObj.meta.liveMode ? 'autorenew' : 'sync_disabled'
                    "
                    size="16px"
                    :color="searchObj.meta.liveMode ? 'primary' : ''"
                  />
                </template>
                <span>
                  <div class="tw:font-medium tw:text-[12px]">
                    {{
                      searchObj.meta.liveMode
                        ? t("search.turnOffLiveMode")
                        : t("search.turnOnLiveMode")
                    }}
                  </div>
                  <div class="tw:text-[11px] tw:text-muted-foreground">
                    {{ t("search.liveModeTooltip") }}
                  </div>
                </span>
              </ODropdownItem>
            </ODropdown>
          </div>
        </div>
        <OButton
          variant="outline"
          size="icon-toolbar"
          :disabled="!searchObj.data.queryResults?.hits?.length"
          title="Export Traces"
          @click="downloadLogs"
        >
          <q-icon name="download" size="16px" />
        </OButton>
        <share-button
          data-test="logs-search-bar-share-link-btn"
          :url="tracesShareURL"
          variant="outline"
          size="icon-toolbar"
        />
      </div>

      <!-- Service Graph right toolbar: DateTime, Refresh, Tree/Graph tabs, Layout -->
      <div
        v-if="searchObj.meta.searchMode === 'service-graph'"
        class="float-right col-auto o2-input-full"
      >
        <div class="tw:flex tw:items-center tw:gap-[0.5rem]">
          <date-time
            ref="dateTimeRef"
            auto-apply
            :default-type="searchObj.data.datetime.type"
            :default-absolute-time="{
              startTime: searchObj.data.datetime.startTime,
              endTime: searchObj.data.datetime.endTime,
            }"
            :default-relative-time="searchObj.data.datetime.relativeTimePeriod"
            data-test="service-graph-date-time-picker"
            class="tw:h-[2rem]!"
            @on:date-change="updateDateTime"
          />
          <OButton
            data-test="service-graph-refresh-btn"
            variant="outline"
            size="icon-toolbar"
            class="tw:mr-[0.375rem]"
            @click="$emit('service-graph-refresh')"
          >
            <q-icon name="refresh" size="16px" />
            <q-tooltip>{{ t("common.refresh") }}</q-tooltip>
          </OButton>
          <OToggleGroup
            :model-value="searchObj.meta.serviceGraphVisualizationType"
            @update:model-value="onServiceGraphVisualizationChange($event)"
          >
            <OToggleGroupItem
              data-test="service-graph-tree-view-btn"
              value="tree"
              size="sm"
            >
              <template #icon-left
                ><GitBranch class="tw:size-3.5 tw:shrink-0"
              /></template>
              Tree View
            </OToggleGroupItem>
            <OToggleGroupItem
              data-test="service-graph-graph-view-btn"
              value="graph"
              size="sm"
            >
              <template #icon-left
                ><Share2 class="tw:size-3.5 tw:shrink-0"
              /></template>
              Graph View
            </OToggleGroupItem>
          </OToggleGroup>
          <q-select
            v-model="searchObj.meta.serviceGraphLayoutType"
            :options="serviceGraphLayoutOptions"
            dense
            borderless
            class="tw:w-[7.5rem] tw:min-h-[2rem]! tw:h-[2rem]!"
            emit-value
            map-options
            :disable="searchObj.meta.serviceGraphVisualizationType === 'graph'"
            @update:model-value="onServiceGraphLayoutChange"
          />
        </div>
      </div>

      <!-- Services Catalog right toolbar: DateTime, Refresh -->
      <div
        v-if="searchObj.meta.searchMode === 'services-catalog'"
        class="float-right col-auto o2-input-full"
      >
        <div class="tw:flex tw:items-center tw:gap-[0.5rem]">
          <date-time
            ref="dateTimeRef"
            auto-apply
            :default-type="searchObj.data.datetime.type"
            :default-absolute-time="{
              startTime: searchObj.data.datetime.startTime,
              endTime: searchObj.data.datetime.endTime,
            }"
            :default-relative-time="searchObj.data.datetime.relativeTimePeriod"
            data-test="services-catalog-date-time-picker"
            class="tw:h-[2rem]!"
            @on:date-change="updateDateTime"
          />
          <OButton
            data-test="services-catalog-refresh-btn"
            variant="outline"
            size="icon-toolbar"
            class="tw:mr-[0.375rem]"
            @click="$emit('services-catalog-refresh')"
          >
            <q-icon name="refresh" size="16px" />
            <q-tooltip>{{ t("common.refresh") }}</q-tooltip>
          </OButton>
        </div>
      </div>

    </div>
    <div
      v-if="
        searchObj.meta.searchMode !== 'service-graph' &&
        searchObj.meta.searchMode !== 'services-catalog' &&
        searchObj.meta.searchMode !== 'llm-insights' &&
        searchObj.meta.showQuery
      "
      class="row tw:h-[calc(100%-3.1rem)]!"
    >
      <div
        class="col tw:border tw:solid tw:border-[var(--o2-border-color)] tw:mx-[0.375rem] tw:mb-[0.375rem] tw:rounded-[0.375rem] tw:overflow-hidden tw:h-full!"
      >
        <code-query-editor
          ref="queryEditorRef"
          editor-id="traces-query-editor"
          class="monaco-editor tw:px-[0.325rem] tw:py-[0.125rem]"
          v-model:query="searchObj.data.editorValue"
          :keywords="effectiveKeywords"
          :class="
            searchObj.data.editorValue == '' &&
            searchObj.meta.queryEditorPlaceholderFlag
              ? 'empty-query'
              : ''
          "
          language="sql"
          @update:query="updateQueryValue"
          @run-query="searchData"
          @focus="searchObj.meta.queryEditorPlaceholderFlag = false"
          @blur="searchObj.meta.queryEditorPlaceholderFlag = true"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  ref,
  watch,
  nextTick,
  defineAsyncComponent,
  onBeforeUnmount,
  onActivated,
  computed,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { useStore } from "vuex";

import DateTime from "@/components/DateTime.vue";
import ShareButton from "@/components/common/ShareButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { Layers, Network, GitBranch, Share2, BookOpen, Sparkles } from "lucide-vue-next";
import { outlinedAccountTree } from "@quasar/extras/material-icons-outlined";
import useTraces from "@/composables/useTraces";
import SyntaxGuide from "./SyntaxGuide.vue";

import { debounce } from "lodash-es";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import useSqlSuggestions from "@/composables/useSuggestions";
import useStreams from "@/composables/useStreams";
import { getImageURL } from "@/utils/zincutils";
import {
  applyFilterTerm,
  replaceExistingFieldCondition,
  removeFieldCondition,
} from "@/utils/traces/filterUtils";
import { isDatetimeChanged } from "./tracesSearchBar.utils";

export default defineComponent({
  name: "ComponentSearchSearchBar",
  components: {
    DateTime,
    ShareButton,
    OToggleGroup,
    OToggleGroupItem,
    OButton,
    ODropdown,
    ODropdownItem,
    Layers,
    Network,
    GitBranch,
    Share2,
    BookOpen,
    Sparkles,
    CodeQueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
    SyntaxGuide,
  },
  emits: [
    "searchdata",
    "cancel-query",
    "update:searchMode",
    "error-only-toggled",
    "filters-reset",
    "onChangeTimezone",
    "service-graph-refresh",
    "services-catalog-refresh",
  ],
  props: {
    fieldValues: {
      type: Object,
      default: () => {},
    },
    // Using loading key directly from traces composable was not working
    // so have added as prop
    // Run query btn was not getting disabled while loading
    isLoading: {
      type: Boolean,
      default: false,
    },
    isLLMSpanPresent: {
      type: Boolean,
      default: false,
    },
    // True when the parent (`Index.vue`) has confirmed at least one
    // traces stream is flagged `is_llm_stream === true`. Drives the
    // LLM Insights tab visibility — we hide the toggle entirely when
    // no org has opted in (avoids a dead button that opens an empty
    // dashboard). Defaults to `true` so the tab doesn't flicker
    // during the brief window before streams resolve on first mount.
    hasLLMStreams: {
      type: Boolean,
      default: true,
    },
  },
  methods: {
    searchData() {
      if (this.searchObj?.loading == false) {
        // this.searchObj.runQuery = true;
        this.$emit("searchdata");
      }
    },
    cancelQueryData() {
      this.$emit("cancel-query");
    },
  },
  setup(props, { emit }) {
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const store = useStore();
    const btnRefreshInterval = ref(null);

    const { searchObj, tracesShareURL } = useTraces();
    const queryEditorRef = ref(null);

    let parser: any;
    let streamName = "";
    const dateTimeRef = ref(null);

    const { getStream } = useStreams();

    const {
      autoCompleteData,
      autoCompleteKeywords,
      effectiveKeywords,
      getSuggestions,
      updateFieldKeywords,
      updateStreamKeywords,
    } = useSqlSuggestions();

    const importSqlParser = async () => {
      const useSqlParser: any = await import("@/composables/useParser");
      const { sqlParser }: any = useSqlParser.default();
      parser = await sqlParser();
    };

    onBeforeUnmount(async () => {
      await importSqlParser();
    });

    onActivated(async () => {
      await nextTick();
      if (searchObj.data.datetime.type === "relative") {
        dateTimeRef.value.setRelativeTime(
          searchObj.data.datetime.relativeTimePeriod,
        );

        dateTimeRef.value.refresh();
      } else {
        dateTimeRef.value.setAbsoluteTime(
          searchObj.data.datetime.startTime,
          searchObj.data.datetime.endTime,
        );
      }
    });

    const refreshTimeChange = (item) => {
      searchObj.meta.refreshInterval = item.value;
      searchObj.meta.refreshIntervalLabel = item.label;
      btnRefreshInterval.value = false;
    };

    watch(
      () => searchObj.data.stream.selectedStreamFields,
      (fields) => {
        if (fields.length) updateFieldKeywords(fields);
      },
      { immediate: true, deep: true },
    );

    // Feed the selected trace stream into FROM autocomplete so typing
    // "FROM " suggests the stream name.
    watch(
      () => searchObj.data.stream.selectedStream,
      (stream) => {
        const name = stream?.value;
        updateStreamKeywords(name ? [{ name }] : []);
      },
      { immediate: true },
    );

    const updateAutoComplete = (value) => {
      autoCompleteData.value.query = value;
      autoCompleteData.value.cursorIndex =
        queryEditorRef.value.getCursorIndex();
      autoCompleteData.value.fieldValues = props.fieldValues;
      autoCompleteData.value.popup.open =
        queryEditorRef.value.triggerAutoComplete;
      // [NEW] Set stream context so getSuggestions can read stored values from
      // IndexedDB. Traces field expansion already writes to IDB via
      // captureFromValuesApi (useFieldValuesStream) with stream_type="traces",
      // so values are already being captured — this just enables the read side.
      autoCompleteData.value.org = store.state.selectedOrganization.identifier;
      autoCompleteData.value.streamType = "traces";
      autoCompleteData.value.streamName =
        searchObj.data.stream.selectedStream.value ?? "";
      getSuggestions();
    };

    const updateQueryValue = async (value: string, event?: any) => {
      updateAutoComplete(value);
      if (searchObj.meta.sqlMode == true) {
        searchObj.data.parsedQuery = parser.astify(value);
        if (searchObj.data.parsedQuery?.from?.length > 0) {
          if (
            searchObj.data.parsedQuery.from[0].table !==
              searchObj.data.stream.selectedStream.value &&
            searchObj.data.parsedQuery.from[0].table !== streamName
          ) {
            let streamFound = false;
            streamName = searchObj.data.parsedQuery.from[0].table;
            await getStream(streamName, "traces", true).then(
              (streamResponse) => {
                streamFound = true;
                let itemObj = {
                  label: streamResponse.name,
                  value: streamResponse.name,
                };
                searchObj.data.stream.selectedStream = itemObj;
                streamResponse.schema.forEach((field) => {
                  searchObj.data.stream.selectedStreamFields.push({
                    name: field.name,
                  });
                });
              },
            );

            if (streamFound == false) {
              searchObj.data.stream.selectedStream = { label: "", value: "" };
              searchObj.data.stream.selectedStreamFields = [];
              $q.notify({
                message: "Stream not found",
                color: "negative",
                position: "top",
                timeout: 2000,
              });
            }
          }
        }
      }
    };

    // Debounced query trigger for absolute time when auto-run is enabled.
    // Gives the user 2.5s to finish typing start/end time before firing.
    const triggerAbsoluteQueryDebounced = debounce((value: object) => {
      if (config.isCloud == "true" && value.userChangedValue) {
        segment.track("Button Click", {
          button: "Date Change",
          tab: value.tab,
          value: value,
          stream_name: searchObj.data.stream.selectedStream.value,
          page: "Search Logs",
        });
      }

      if (store.state.zoConfig?.auto_query_enabled && searchObj.meta.liveMode) {
        emit("searchdata");
      }
    }, 2500);

    const updateDateTime = async (value: object) => {
      if (router.currentRoute.value.name !== "traces") return;
      if (
        value.valueType == "absolute" &&
        searchObj.data.stream.selectedStream.length > 0 &&
        searchObj.data.datetime.queryRangeRestrictionInHour > 0 &&
        value.hasOwnProperty("selectedDate") &&
        value.hasOwnProperty("selectedTime") &&
        value.selectedDate.hasOwnProperty("from") &&
        value.selectedTime.hasOwnProperty("startTime")
      ) {
        // Convert hours to microseconds
        let newStartTime =
          parseInt(value.endTime) -
          searchObj.data.datetime.queryRangeRestrictionInHour *
            60 *
            60 *
            1000000;

        if (parseInt(newStartTime) > parseInt(value.startTime)) {
          value.startTime = newStartTime;

          value.selectedDate.from = timestampToTimezoneDate(
            value.startTime / 1000,
            store.state.timezone,
            "yyyy/MM/DD",
          );
          value.selectedTime.startTime = timestampToTimezoneDate(
            value.startTime / 1000,
            store.state.timezone,
            "HH:mm",
          );

          dateTimeRef.value.setAbsoluteTime(value.startTime, value.endTime);
          dateTimeRef.value.setDateType("absolute");
        }
      }

      // See `tracesSearchBar.utils.ts → isDatetimeChanged` for the
      // mount-replay filter rationale (relative ranges compare by period,
      // absolute by raw start/end).
      const datetimeChanged = isDatetimeChanged(searchObj.data.datetime, value);

      searchObj.data.datetime = {
        startTime: value.startTime,
        endTime: value.endTime,
        relativeTimePeriod: value.relativeTimePeriod
          ? value.relativeTimePeriod
          : searchObj.data.datetime.relativeTimePeriod,
        type: value.relativeTimePeriod ? "relative" : "absolute",
        queryRangeRestrictionMsg:
          searchObj.data.datetime?.queryRangeRestrictionMsg || "",
        queryRangeRestrictionInHour:
          searchObj.data.datetime?.queryRangeRestrictionInHour || 0,
      };

      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();

      if (
        value.valueType === "absolute" &&
        store.state.zoConfig?.auto_query_enabled
      ) {
        // Debounce query trigger so user can finish typing the full time value
        triggerAbsoluteQueryDebounced(value);
        return;
      }

      if (config.isCloud == "true" && value.userChangedValue) {
        segment.track("Button Click", {
          button: "Date Change",
          tab: value.tab,
          value: value,
          //user_org: this.store.state.selectedOrganization.identifier,
          //user_id: this.store.state.userInfo.email,
          stream_name: searchObj.data.stream.selectedStream.value,
          page: "Search Logs",
        });
      }

      // Live mode: auto-trigger search on a real time-range change.
      // The DateTime component also fires `on:date-change` once on its own
      // mount with the current value (no actual change). The `prev`
      // comparison above filters out that mount-time replay so a tab
      // switch that remounts the picker doesn't fire a redundant search
      // (visible in LLM Insights as a duplicate fetchAll right after the
      // dashboard's own initial load).
      if (
        store.state.zoConfig?.auto_query_enabled &&
        searchObj.meta.liveMode &&
        datetimeChanged
      ) {
        emit("searchdata");
      }
    };

    const toggleLiveMode = () => {
      searchObj.meta.liveMode = !searchObj.meta.liveMode;
      localStorage.setItem(
        "oo_toggle_auto_run",
        String(searchObj.meta.liveMode),
      );
    };

    const updateQuery = () => {
      // alert(searchObj.data.query);
      if (queryEditorRef.value?.setValue)
        queryEditorRef.value.setValue(searchObj.data.query);
    };

    // This method is used in parent component using ref
    const setEditorValue = (value: String) => {
      if (queryEditorRef.value?.setValue) queryEditorRef.value.setValue(value);
    };

    // Apply multiple filter terms independently (replace-or-append per field).
    // Used by parent (Index.vue) for metrics brush selections and error toggle.
    const applyFilters = (terms: string[]) => {
      let current = searchObj.data.editorValue;
      for (const term of terms) {
        current = applyFilterTerm(term, current);
      }
      searchObj.data.editorValue = current;
      if (queryEditorRef.value?.setValue)
        queryEditorRef.value.setValue(current);
      if (store.state.zoConfig?.auto_query_enabled && searchObj.meta.liveMode) {
        emit("searchdata");
      }
    };

    // Remove all conditions for a given field from the editor value.
    // Used by parent (Index.vue) to clear the error-only filter on toggle-off.
    const removeFilterByField = (fieldName: string) => {
      const value = searchObj.data.editorValue;
      const parts = value.split("|");
      const target = parts.length > 1 ? 1 : 0;
      const replaced = replaceExistingFieldCondition(
        parts[target] as string,
        fieldName,
        "",
      );
      parts[target] = replaced
        .replace(/\s*\band\b\s*$/i, "")
        .replace(/^\s*\band\b\s*/i, "")
        .replace(/\s+and\s+and\s+/gi, " and ")
        .trim();
      const newValue = parts.length > 1 ? parts.join("| ") : parts[0];
      searchObj.data.editorValue = newValue as string;
      if (queryEditorRef.value?.setValue)
        queryEditorRef.value.setValue(newValue);
      if (store.state.zoConfig?.auto_query_enabled && searchObj.meta.liveMode) {
        emit("searchdata");
      }
    };

    const jsonToCsv = (jsonData) => {
      const replacer = (key, value) => (value === null ? "" : value);
      const header = Object.keys(jsonData[0]);
      let csv = header.join(",") + "\r\n";

      for (let i = 0; i < jsonData.length; i++) {
        const row = header
          .map((fieldName) => JSON.stringify(jsonData[i][fieldName], replacer))
          .join(",");
        csv += row + "\r\n";
      }

      return csv;
    };

    const downloadLogs = () => {
      const filename = "traces-data.csv";
      const data = jsonToCsv(searchObj.data.queryResults.hits);
      const file = new File([data], filename, {
        type: "text/csv",
      });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };

    const updateTimezone = () => {
      emit("onChangeTimezone");
    };

    const resetFilters = () => {
      searchObj.data.editorValue = "";
      searchObj.data.advanceFiltersQuery = "";
      Object.values(searchObj.data.stream.fieldValues).forEach((field) => {
        field.selectedValues = [];
        field.searchKeyword = "";
      });

      // Clear brush selections from metrics dashboard
      searchObj.meta.metricsRangeFilters.clear();

      // Reset sort to defaults
      searchObj.meta.resultGrid.sortBy = "start_time";
      searchObj.meta.resultGrid.sortOrder = "desc";

      // Emit event to notify parent that filters were reset
      emit("filters-reset");

      if (store.state.zoConfig?.auto_query_enabled && searchObj.meta.liveMode) {
        emit("searchdata");
      }
    };

    const onErrorOnlyToggle = (value: boolean) => {
      // Emit event to parent to update filters in Query Editor
      emit("error-only-toggled", value);
    };

    /**
     * Update the date time in the date time component
     * @param value - object containing start time and end time
     * @param value.startTime - start time in microseconds
     * @param value.endTime - end time in microseconds
     */
    const updateNewDateTime = (value: object) => {
      if (!value.startTime || !value.endTime) return;
      dateTimeRef.value?.setAbsoluteTime(value.startTime, value.endTime);
      dateTimeRef.value?.setDateType("absolute");
    };

    const metricsIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/bar_chart_histogram_light.svg")
        : getImageURL("images/common/bar_chart_histogram.svg");
    });

    // Service Graph toolbar controls
    const serviceGraphVisualizationTabs = [
      { label: "Tree View", value: "tree" },
      { label: "Graph View", value: "graph" },
    ];

    const serviceGraphLayoutOptions = computed(() => {
      if (searchObj.meta.serviceGraphVisualizationType === "graph") {
        return [{ label: "Force Layout", value: "force" }];
      }
      return [
        { label: "Horizontal", value: "horizontal" },
        { label: "Vertical", value: "vertical" },
      ];
    });

    const onServiceGraphVisualizationChange = (type: "tree" | "graph") => {
      searchObj.meta.serviceGraphVisualizationType = type;
      localStorage.setItem("serviceGraph_visualizationType", type);
      const newLayout = type === "tree" ? "horizontal" : "force";
      searchObj.meta.serviceGraphLayoutType = newLayout;
      localStorage.setItem("serviceGraph_layoutType", newLayout);
    };

    const onServiceGraphLayoutChange = (type: string) => {
      searchObj.meta.serviceGraphLayoutType = type;
      localStorage.setItem("serviceGraph_layoutType", type);
    };

    return {
      t,
      router,
      store,
      searchObj,
      queryEditorRef,
      btnRefreshInterval,
      refreshTimes: searchObj.config.refreshTimes,
      refreshTimeChange,
      updateQueryValue,
      updateDateTime,
      updateQuery,
      downloadLogs,
      setEditorValue,
      autoCompleteKeywords,
      effectiveKeywords,
      updateTimezone,
      dateTimeRef,
      resetFilters,
      onErrorOnlyToggle,
      updateNewDateTime,
      metricsIcon,
      tracesShareURL,
      config,
      applyFilters,
      removeFilterByField,
      serviceGraphVisualizationTabs,
      serviceGraphLayoutOptions,
      onServiceGraphVisualizationChange,
      onServiceGraphLayoutChange,
      toggleLiveMode,
      outlinedAccountTree,
    };
  },
  computed: {
    addSearchTerm() {
      return this.searchObj.data.stream.addToFilter;
    },
    removeFieldTerm() {
      return this.searchObj.data.stream.removeFilterField;
    },
  },
  watch: {
    addSearchTerm() {
      if (this.searchObj.data.stream.addToFilter !== "") {
        const newValue = applyFilterTerm(
          this.searchObj.data.stream.addToFilter,
          this.searchObj.data.editorValue,
        );
        this.searchObj.data.editorValue = newValue;
        this.searchObj.data.query = newValue;
        this.searchObj.data.stream.addToFilter = "";
        if (this.queryEditorRef?.setValue)
          this.queryEditorRef.setValue(newValue);
        if (
          this.store.state.zoConfig.auto_query_enabled &&
          this.searchObj.meta.liveMode
        ) {
          this.searchData();
        }
      }
    },
    removeFieldTerm(fieldName: string) {
      if (!fieldName) return;
      const newValue = removeFieldCondition(
        this.searchObj.data.editorValue,
        fieldName,
      );
      this.searchObj.data.editorValue = newValue;
      this.searchObj.data.query = newValue;
      this.searchObj.data.stream.removeFilterField = "";
      if (this.queryEditorRef?.setValue) this.queryEditorRef.setValue(newValue);
      if (
        this.store.state.zoConfig.auto_query_enabled &&
        this.searchObj.meta.liveMode
      ) {
        this.searchData();
      }
    },
    filters() {},
  },
});
</script>

<style lang="scss" scoped>
.search-bar-component {
  padding-bottom: 1px;

  .q-toggle__inner {
    font-size: 30px;
  }

  .q-toggle__label {
    font-size: 12px;
  }

  .casesensitive-btn {
    padding: 8px;
    margin-left: -6px;
    background-color: #d5d5d5;
    border-radius: 0px 3px 3px 0px;
  }
  .search-field .q-field {
    &__control {
      border-radius: 3px 0px 0px 3px !important;
    }
    &__native {
      font-weight: 600;
    }
  }
  .search-time {
    // width: 120px;
    .q-btn-group {
      border-radius: 3px;

      .q-btn {
        min-height: auto;
      }
    }
  }
  .search-dropdown {
    padding: 0px;
    .block {
      color: $dark-page;
      font-weight: 600;
      font-size: 12px;
    }
    .q-btn-dropdown__arrow-container {
      color: $light-text2;
    }
  }
  .refresh-rate-dropdown-container {
    width: 220px;
    * .q-btn {
      font-size: 12px !important;
      padding-left: 8px;
      padding-right: 8px;
    }
  }

  .flex-start {
    justify-content: flex-start;
    align-items: flex-start;
    display: flex;
  }

  .resultsOverChart {
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
    color: $dark-page;
    font-weight: 700;
  }

  .ddlWrapper {
    position: relative;
    z-index: 10;

    .listWrapper {
      box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
      transition: height 0.25s ease;
      height: calc(100vh - 146px);
      background-color: white;
      position: absolute;
      top: 2.75rem;
      width: 100%;
      left: 0;

      &:empty {
        height: 0;
      }

      &,
      .q-list {
        border-radius: 3px;
      }
    }
  }
  .fields_autocomplete {
    max-height: 250px;
  }

  .search-button {
    min-width: 96px;
    line-height: 29px;
    font-weight: bold;
    text-transform: initial;
    font-size: 11px;
    color: white;
    padding: 0px 5px;

    .q-btn__content {
      background: $secondary;
      border-radius: 3px 3px 3px 3px;
      padding: 0px 5px;

      .q-icon {
        font-size: 15px;
        color: #ffffff;
      }
    }
  }

  .download-logs-btn {
    height: 30px;
  }

  .app-tabs-container {
    :deep(.o2-tabs) {
      height: 100%;

      .o2-tab {
        height: 100%;
        padding-top: 0;
        padding-bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.8125rem;
      }
    }
  }

  .reset-filters {
    width: 30px;
    height: 30px;

    .q-icon {
      margin-right: 0;
    }
  }
}

.o2-run-query-button {
  font-size: 11px;
  font-weight: 500 !important;
  line-height: 16px !important;
  padding: 0px 0px !important;
  width: 94px !important;
  transition:
    box-shadow 0.3s ease,
    opacity 0.2s ease;
}

.o2-color-primary {
  background-color: var(--o2-primary-btn-bg);
  color: var(--o2-primary-btn-text);

  &:hover {
    opacity: 0.9;
    box-shadow: 0 0 8px
      color-mix(in srgb, var(--o2-primary-btn-bg), transparent 30%);
  }
}

.search-button-enterprise-border-radius {
  border-radius: 0.375rem 0px 0px 0.375rem !important;
}

.search-button-normal-border-radius {
  border-radius: 0.375rem;
}

.search-button-dropdown-enterprise-border-radius {
  border-radius: 0px 0.375rem 0.375rem 0px !important;
}

.o2-color-cancel {
  background-color: #f67a7a;
  color: var(--o2-primary-btn-text);
}
</style>
