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
  <div class="col-auto" data-test="dashboard-panel-searchbar">
    <div
      class="sql-bar tw:flex tw:flex-row tw:items-center tw:justify-between tw:gap-x-3"
      :style="{
        backgroundColor:
          store.state.theme === 'dark'
            ? 'var(--o2-header-menu-bg)'
            : 'var(--color-primary-100)',
      }"
      @click.stop
    >
      <div
        class="tw:flex tw:flex-row tw:items-center tw:flex-1 tw:min-w-0"
        data-test="dashboard-query-data"
      >
        <div
          style="max-width: 600px; overflow: hidden"
        >
          <OTabs
            v-model="dashboardPanelData.layout.currentQueryIndex"
            dense
            mobile-arrows
            @click.stop
            data-test="dashboard-panel-query-tab"
          >
            <OTab
              v-for="(tab, index) in dashboardPanelData.data.queries"
              :key="index"
              :name="index"
              @click.stop
              :data-test="`dashboard-panel-query-tab-${index}`"
            >
              <!-- Inline editable query name (multi-SQL).
                   Wrapped in a <div @click.stop> because OInput has
                   inheritAttrs: false and doesn't re-emit `click`, so a
                   listener on <OInput> wouldn't catch the tab-click. -->
              <div
                v-if="editingQueryIndex === index"
                @click.stop
                class="tw:inline-block query-tab-name-input-wrap"
              >
                <OInput
                  ref="renameInputRef"
                  v-model="editingQueryName"
                  size="sm"
                  autofocus
                  :id="`dashboard-query-rename-input-${index}`"
                  class="query-tab-name-input"
                  :data-test="`dashboard-panel-query-tab-name-input-${index}`"
                  @keydown.enter.stop="saveQueryName(index)"
                  @keydown.escape.stop="cancelQueryNameEdit"
                  @blur="saveQueryName(index)"
                />
              </div>
              <span
                v-else
                @dblclick.stop.prevent="startEditQueryName(index, tab)"
                class="query-tab-name-text"
                style="font-size: 12px"
                :title="'Double-click to rename'"
                :data-test="`dashboard-panel-query-tab-name-${index}`"
              >{{ tab.tabName || ('Query ' + (index + 1)) }}</span>
              <!-- Eye icon + its tooltip wrapped in a span so the tooltip's
                   trigger is scoped to JUST the icon, not the entire OTab. -->
              <span
                v-if="promqlMode || dashboardPanelData.data.queries.length > 1"
                class="tw:inline-flex tw:items-center tw:relative"
              >
                <OIcon
                  :name="
                    (dashboardPanelData.layout.hiddenQueries || []).includes(index)
                      ? 'visibility-off'
                      : 'visibility'
                  "
                  class="tw:ml-1 dashboard-query-visibility-icon"
                  @click.stop="toggleQueryVisibility(index)"
                  @mousedown.stop.prevent
                  @pointerdown.stop.prevent
                  style="cursor: pointer"
                  size="sm"
                  :data-test="`dashboard-panel-query-tab-visibility-${index}`"
                  :data-test-hidden="
                    (dashboardPanelData.layout.hiddenQueries || []).includes(index)
                      ? 'true'
                      : 'false'
                  "
                />
                <OTooltip
                  :content="
                    (dashboardPanelData.layout.hiddenQueries || []).includes(index)
                      ? t('dashboard.showQueryResults')
                      : t('dashboard.hideQueryResults')
                  "
                />
              </span>
              <OIcon
                v-if="
                  index > 0 ||
                  (index === 0 && dashboardPanelData.data.queries.length > 1)
                "
                name="close"
                size="sm"
                class="dashboard-query-remove-icon"
                @click.stop.prevent="removeTab(index)"
                @mousedown.stop.prevent
                @pointerdown.stop.prevent
                style="cursor: pointer"
                :data-test="`dashboard-panel-query-tab-remove-${index}`"
              />
            </OTab>
          </OTabs>
        </div>
        <OButton
          variant="ghost"
          size="icon"
          @click.stop="addTab"
          data-test="dashboard-panel-query-tab-add"
          icon-left="add"
        >
        </OButton>
        <!-- D5: Warning for restricted chart types with multiple queries.
             Outlined soft-background chip (warning-soft variant + ring),
             height-aligned (h-8) with the toolbar's size="sm" buttons. -->
        <OBadge
          v-if="multiQueryWarning"
          variant="warning-soft"
          size="sm"
          icon="info-outline"
          class="dashboard-multi-query-warning tw:h-8 tw:mr-2 tw:ring-1 tw:ring-inset tw:ring-current"
        >
          {{ multiQueryWarning }}
        </OBadge>
      </div>
      <div class="tw:flex tw:items-center tw:gap-3 tw:shrink-0">
        <OSwitch
          data-test="logs-search-bar-show-query-toggle-btn"
          v-model="dashboardPanelData.layout.vrlFunctionToggle"
          :title="t('dashboard.toggleFunctionEditor')"
          @update:model-value="onFunctionToggle"
          :disabled="promqlMode"
          size="lg"
        >
          <template #label>
            <img
              :src="getImageURL('images/common/function.svg')"
              :style="{
                width: '16px',
                height: '16px',
                filter: store.state.theme === 'dark' ? 'invert(1)' : 'none',
              }"
            />
          </template>
        </OSwitch>
        <QueryTypeSelector @click.stop></QueryTypeSelector>
      </div>
    </div>
  </div>
  <div
    class="tw:flex tw:flex-col tw:flex-1"
    :style="
      !dashboardPanelData.layout.showQueryBar ? 'height: 0px; flex: none;' : ''
    "
    style="overflow: hidden"
    data-test="dashboard-query"
  >
      <div class="tw:flex tw:flex-col" style="width: 100%; height: 100%">
      <div class="tw:flex tw:flex-col" style="width: 100%; height: 100%">
        <div class="tw:flex" style="height: 100%">
          <OSplitter
            style="width: 100%; height: 100%"
            v-model="splitterModel"
            :disable="
              promqlMode || !dashboardPanelData.layout.vrlFunctionToggle
            "
            :limits="[
              30,
              promqlMode || !dashboardPanelData.layout.vrlFunctionToggle
                ? 100
                : 70,
            ]"
          >
            <template #separator>
              <div class="tw:w-1 tw:h-full tw:bg-(--o2-border) tw:transition-colors hover:tw:bg-[orange]"></div>
            </template>
            <template #before>
              <UnifiedQueryEditor
                ref="queryEditorRef"
                :languages="['sql', 'promql']"
                :default-language="dashboardPanelData.data.queryType"
                :query="
                  dashboardPanelData.data.queries[
                    dashboardPanelData.layout.currentQueryIndex
                  ].query
                "
                :read-only="
                  !dashboardPanelData.data.queries[
                    dashboardPanelData.layout.currentQueryIndex
                  ].customQuery
                "
                :hide-nl-toggle="
                  !dashboardPanelData.data.queries[
                    dashboardPanelData.layout.currentQueryIndex
                  ].customQuery
                "
                :keywords="currentEditorKeywords"
                :suggestions="currentEditorSuggestions"
                @update:query="handleQueryUpdate"
                @focus="_sqlOnFocus"
                @blur="_sqlOnBlur"
                @language-change="handleLanguageChange"
                @ask-ai="handleAskAI"
                @run-query="handleRunQuery"
                data-test="dashboard-panel-query-editor"
                data-test-prefix="dashboard-query"
                editor-height="100%"
              />
            </template>
            <template #after>
              <div style="display: flex; flex-direction: column; height: 100%; width: 100%">
                <div style="flex: 1; min-height: 0; width: 100%">
                  <UnifiedQueryEditor
                    v-if="
                      !promqlMode && dashboardPanelData.layout.vrlFunctionToggle
                    "
                    data-test="dashboard-vrl-function-editor"
                    style="width: 100%; height: 100%"
                    ref="vrlFnEditorRef"
                    :languages="['vrl']"
                    default-language="vrl"
                    :query="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].vrlFunctionQuery
                    "
                    :hide-nl-toggle="false"
                    :disable-ai="false"
                    :disable-ai-reason="''"
                    :ai-placeholder="t('function.askAIFunctionPlaceholder')"
                    :ai-tooltip="t('function.enterFunctionPrompt')"
                    editor-height="100%"
                    @focus="functionEditorPlaceholderFlag = false"
                    @blur="functionEditorPlaceholderFlag = true"
                    @update:query="handleVrlFunctionUpdate"
                    @generation-start="handleVrlGenerationStart"
                    @generation-end="handleVrlGenerationEnd"
                    @generation-success="handleVrlGenerationSuccess"
                  />
                  <div
                    v-if="!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].vrlFunctionQuery && functionEditorPlaceholderFlag"
                    class="query-editor-placeholder-overlay"
                  >
                    <span class="query-editor-placeholder-typewriter">{{ vrlPlaceholder }}</span>
                  </div>
                </div>
                <div style="flex-shrink: 0; width: 100%">
                  <div style="display: flex;" class="tw:items-center">
                    <OSelect
                      v-model="selectedFunction"
                      :label="t('dashboard.useSavedFunction')"
                      :options="functionOptions"
                      label-position="inside"
                      data-test="dashboard-use-saved-vrl-function"
                      labelKey="name"
                      valueKey="function"
                      @search="onFunctionSearch"
                      @update:model-value="onFunctionSelect"
                      class="tw:flex-1"
                    />
                    <OButton
                      variant="ghost"
                      size="icon"
                      data-test="dashboard-addpanel-config-drilldown-info"
                    >
                      <template #icon-left
                        ><OIcon name="info-outline" size="sm"
                      /></template>
                      <OTooltip
                        :content="t('dashboard.vrlExtractionTooltip')"
                        max-width="250px"
                      />
                    </OButton>
                  </div>
                </div>
              </div>
            </template>
          </OSplitter>
        </div>
      </div>
      <div style="color: red; z-index: 100000" class="tw:mx-2 col-auto">
        {{ dashboardPanelData.meta.errors.queryErrors.join(", ") }}
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
// @ts-nocheck
import {
  defineComponent,
  ref,
  watch,
  computed,
  onMounted,
  defineAsyncComponent,
  nextTick,
  onUnmounted,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import ConfirmDialog from "../../../components/ConfirmDialog.vue";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import QueryTypeSelector from "../addPanel/QueryTypeSelector.vue";
import usePromqlSuggestions from "@/composables/usePromqlSuggestions";
import { inject } from "vue";
import { onBeforeMount } from "vue";
import { getImageURL } from "@/utils/zincutils";
import useNotifications from "@/composables/useNotifications";
import { useStore } from "vuex";
import useFunctions from "@/composables/useFunctions";
import useSqlSuggestions from "@/composables/useSuggestions";
import { useSqlEditorDiagnostics } from "@/composables/useSqlEditorDiagnostics";
import { useVrlPlaceholder } from "@/composables/useVrlPlaceholder";
import UnifiedQueryEditor from "@/components/QueryEditor.vue";
import { isQueryVrlEnabled } from "@/composables/dashboard/useVrlFunction";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

export default defineComponent({
  name: "DashboardQueryEditor",
  components: {
    OTabs,
    OTab,
    ConfirmDialog,
    QueryTypeSelector,
    UnifiedQueryEditor,
    OButton,
    OSelect,
    OSwitch,
    OTooltip,
    OIcon,
    OSplitter,
    OInput,
    OBadge,
  },
  emits: ["searchdata", "run-query"],
  methods: {
    searchData() {
      this.$emit("searchdata");
    },
  },
  setup() {
    const router = useRouter();
    const { t } = useI18n();
    const { showErrorNotification, showPositiveNotification } =
      useNotifications();
    const store = useStore();
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );

    const { getAllFunctions } = useFunctions();
    const functionList = ref([]);
    const functionOptions = ref([]);
    const selectedFunction = ref<string | undefined>(undefined);

    const getFunctions = async () => {
      try {
        if (store.state.organizationData.functions.length == 0) {
          await getAllFunctions();
        }

        store.state.organizationData.functions.map((data: any) => {
          const args: any = [];
          for (let i = 0; i < parseInt(data.num_args); i++) {
            args.push("'${1:value}'");
          }

          const itemObj: {
            name: any;
            args: string;
          } = {
            name: data.name,
            args: "(" + args.join(",") + ")",
          };

          functionList.value.push({
            name: data.name,
            function: data.function,
          });
          // if (!data.stream_name) {
          //   searchObj.data.stream.functions.push(itemObj);
          // }
        });
        functionOptions.value = [...functionList.value];
        return;
      } catch (e) {
        showErrorNotification(t("dashboard.errorFetchingFunctions"));
      }
    };

    const filterFunctionOptions = (val: string, update: any) => {
      update(() => {
        functionOptions.value = functionList.value.filter((fn: any) => {
          return fn.name.toLowerCase().indexOf(val.toLowerCase()) > -1;
        });
      });
    };

    const onFunctionSearch = (val: string) => {
      functionOptions.value = functionList.value.filter((fn: any) => {
        return fn.name.toLowerCase().indexOf(val.toLowerCase()) > -1;
      });
    };

    const onFunctionSelect = (fnCode: string | null | undefined) => {
      if (!fnCode) return;
      // assign selected vrl function
      vrlFnEditorRef.value?.setValue(fnCode);
      // find function name for notification
      const fn = functionList.value.find((f: any) => f.function === fnCode);
      // clear v-model
      selectedFunction.value = undefined;

      // show success message
      showPositiveNotification(
        t("dashboard.functionAppliedSuccess", { name: fn?.name ?? fnCode }),
      );
    };

    const {
      dashboardPanelData,
      promqlMode,
      addQuery,
      removeQuery,
      selectedStreamFieldsBasedOnUserDefinedSchema,
    } = useDashboardPanelData(dashboardPanelDataPageKey);

    const splitterModel = ref(
      promqlMode || !dashboardPanelData.layout.vrlFunctionToggle ? 100 : 70,
    );

    watch(
      () => splitterModel.value,
      () => {
        window.dispatchEvent(new Event("resize"));
      },
    );
    const confirmQueryModeChangeDialog = ref(false);

    const {
      autoCompleteData: promqlAutoCompleteData,
      autoCompletePromqlKeywords: promqlAutoCompleteKeywords,
      getSuggestions: promqlGetSuggestions,
      updateMetricKeywords,
    } = usePromqlSuggestions();

    const {
      autoCompleteData: sqlAutoCompleteData,
      autoCompleteKeywords: sqlAutoCompleteKeywords,
      autoCompleteSuggestions: sqlAutoCompleteSuggestions,
      effectiveKeywords: sqlEffectiveKeywords,
      effectiveSuggestions: sqlEffectiveSuggestions,
      getSuggestions: sqlGetSuggestions,
      updateAllKeywords: sqlUpdateAllKeywords,
      updateStreamKeywords: sqlUpdateStreamKeywords,
    } = useSqlSuggestions();

    const queryEditorRef = ref(null);

    const { onFocus: _sqlOnFocus, onBlur: _sqlOnBlur, onQueryChange: _sqlOnQueryChange } =
      useSqlEditorDiagnostics({
        queryEditorRef,
        sqlMode: computed(() => dashboardPanelData.data.queryType === "sql"),
        query: computed(
          () =>
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.query ?? "",
        ),
      });

    const currentEditorKeywords = computed(() => {
      if (dashboardPanelData.data.queryType === "promql") {
        return promqlAutoCompleteKeywords.value;
      }
      return sqlEffectiveKeywords.value;
    });

    const currentEditorSuggestions = computed(() => {
      if (dashboardPanelData.data.queryType === "promql") {
        return [];
      }
      return sqlEffectiveSuggestions.value;
    });

    const functionEditorPlaceholderFlag = ref(true);
    const vrlFnEditorRef = ref(null);
    const { placeholder: vrlPlaceholder } = useVrlPlaceholder();


    // A table panel with a breakdown field is a pivot table, which only
    // supports a single query (so the add-query button is hidden and a warning
    // is shown if multiple queries already exist).
    const isPivotTable = computed(
      () =>
        dashboardPanelData.data.type === "table" &&
        (dashboardPanelData.data.queries?.[0]?.fields?.breakdown?.length ?? 0) >
          0,
    );

    // D5: Warning banner for restricted chart types with multiple queries
    const multiQueryWarning = computed(() => {
      if (dashboardPanelData.data.queries.length <= 1) return null;
      if (promqlMode.value) return null;

      if (isPivotTable.value) {
        return t("dashboard.multiQueryWarning", { chartType: "Pivot Table" });
      }

      return null;
    });

    const addTab = () => {
      // addQuery() seeds the new query's default builder fields (and PromQL
      // sample query) synchronously, so the tab is ready the moment it activates.
      addQuery();
      dashboardPanelData.layout.currentQueryIndex =
        dashboardPanelData.data.queries.length - 1;
    };

    const updatePromQLQuery = async (value, event) => {
      promqlAutoCompleteData.value.query = value;
      // promqlAutoCompleteData.value.text = event.changes[0].text;

      // set the start and end time
      if (
        dashboardPanelData.meta.dateTime.start_time &&
        dashboardPanelData.meta.dateTime.end_time
      ) {
        promqlAutoCompleteData.value.dateTime = {
          startTime: dashboardPanelData.meta.dateTime.start_time?.getTime(),
          endTime: dashboardPanelData.meta.dateTime.end_time?.getTime(),
        };
      }

      promqlAutoCompleteData.value.position.cursorIndex =
        queryEditorRef.value.getCursorIndex();
      promqlAutoCompleteData.value.popup.open =
        queryEditorRef.value.triggerAutoComplete;
      promqlAutoCompleteData.value.popup.close =
        queryEditorRef.value.disableSuggestionPopup;

      promqlGetSuggestions();
    };

    const updateQuery = (query, event) => {
      if (dashboardPanelData.data.queryType === "promql") {
        updatePromQLQuery(query, event);
      } else {
        sqlAutoCompleteData.value.query = query;
        sqlAutoCompleteData.value.cursorIndex =
          queryEditorRef.value?.getCursorIndex();
        sqlAutoCompleteData.value.popup.open =
          queryEditorRef.value?.triggerAutoComplete;
        sqlAutoCompleteData.value.popup.close =
          queryEditorRef.value?.disableSuggestionPopup;
        sqlGetSuggestions();
      }
    };

    // The fx toggle is PER QUERY and derived from VRL presence: on tab change
    // (and mount) it's ON iff the active query has a VRL function, OFF otherwise.
    watch(
      () => dashboardPanelData.layout.currentQueryIndex,
      (idx) => {
        dashboardPanelData.layout.vrlFunctionToggle = isQueryVrlEnabled(
          dashboardPanelData.data.queries[idx],
        );
      },
      { immediate: true },
    );

    // Keep the splitter in sync with the VRL toggle and query mode: 70/30 when
    // the VRL editor is shown (SQL + toggle on), 100/0 otherwise. Runs on mount
    // and on tab switch so the active query's state is reflected.
    watch(
      () => [
        promqlMode.value,
        dashboardPanelData.layout.vrlFunctionToggle,
        dashboardPanelData.layout.currentQueryIndex,
      ],
      () => {
        if (promqlMode.value || !dashboardPanelData.layout.vrlFunctionToggle) {
          splitterModel.value = 100;
        } else {
          splitterModel.value = 70;
        }
      },
      { immediate: true },
    );

    // SQL field + function keyword autocomplete.
    // Sources (in priority order):
    //   1. selectedStreamFieldsBasedOnUserDefinedSchema — user-defined schema when enabled
    //   2. customQueryFields — columns derived from query results (custom SQL mode, post-run)
    //   3. groupedFields[].schema — stream schema fetched on stream selection (always available)
    // groupedFields is the primary source in SQL/custom mode because selectedStreamFields
    // is always [] (never populated by the dashboard composable — only groupedFields is).
    // Field lists and function lists are replaced as new array references (never mutated
    // in-place), so deep watching is unnecessary and expensive.
    watch(
      [
        () => selectedStreamFieldsBasedOnUserDefinedSchema.value,
        () => dashboardPanelData.meta.stream.customQueryFields,
        () => dashboardPanelData.meta.streamFields.groupedFields,
        () => functionList.value,
      ],
      ([streamFields, customFields, groupedFields, functions]) => {
        // Flatten schema fields from all selected streams (the Fields panel source).
        const schemaFields = ((groupedFields as any[]) ?? []).flatMap(
          (group: any) => group.schema ?? [],
        );
        // Merge all sources; deduplicate by name so fields don't appear twice.
        const allFields = [
          ...((streamFields as any[]) ?? []),
          ...((customFields as any[]) ?? []),
          ...schemaFields,
        ];
        const seen = new Set<string>();
        const uniqueFields = allFields.filter((f: any) => {
          if (seen.has(f.name)) return false;
          seen.add(f.name);
          return true;
        });
        sqlUpdateAllKeywords(uniqueFields, (functions as any[]) ?? []);
      },
      { immediate: true },
    );

    // Feed stream names into PromQL metric keyword autocomplete
    // and SQL FROM autocomplete (stream suggestions after FROM keyword).
    watch(
      [
        () => dashboardPanelData.meta?.stream?.streamResults,
        () => promqlMode.value,
      ],
      ([newResults]) => {
        if (promqlMode.value && newResults?.length) {
          updateMetricKeywords(
            newResults.map((stream: any) => ({
              label: stream.name,
              type: stream.metrics_meta?.metric_type || "",
            })),
          );
        } else {
          updateMetricKeywords([]);
        }
        // SQL: always update stream keywords so FROM suggestions stay in sync.
        sqlUpdateStreamKeywords(
          (newResults ?? []).map((stream: any) => ({ name: stream.name })),
        );
      },
      { immediate: true },
    );

    const removeTab = async (index) => {
      if (
        dashboardPanelData.layout.currentQueryIndex >=
        dashboardPanelData.data.queries.length - 1
      )
        dashboardPanelData.layout.currentQueryIndex -= 1;
      removeQuery(index);
    };

    const toggleQueryVisibility = (index) => {
      // Lazy-init for layouts loaded from saved dashboards that predate the multi-SQL feature.
      if (!Array.isArray(dashboardPanelData.layout.hiddenQueries)) {
        dashboardPanelData.layout.hiddenQueries = [];
      }
      const hiddenQueries = dashboardPanelData.layout.hiddenQueries;
      const queryIndex = hiddenQueries.indexOf(index);

      if (queryIndex > -1) {
        // Query is currently hidden, show it
        hiddenQueries.splice(queryIndex, 1);
      } else {
        // Query is currently visible, hide it
        hiddenQueries.push(index);
      }
    };

    // toggle show query view
    const onDropDownClick = () => {
      dashboardPanelData.layout.showQueryBar =
        !dashboardPanelData.layout.showQueryBar;
    };

    watch(
      () => dashboardPanelData.layout.showQueryBar,
      () => {
        window.dispatchEvent(new Event("resize"));
      },
    );

    // this is only for VRLs
    const resizeEventListener = async () => {
      await nextTick();
      vrlFnEditorRef?.value?.resetEditorLayout();
    };

    onMounted(async () => {
      window.removeEventListener("resize", resizeEventListener);
      window.addEventListener("resize", resizeEventListener);
      getFunctions();
    });

    onUnmounted(() => {
      // Remove event listeners
      window.removeEventListener("resize", resizeEventListener);

      // Clear refs to prevent memory leaks
      queryEditorRef.value = null;
      vrlFnEditorRef.value = null;
    });
    // End for VRL resize

    onMounted(() => {
      dashboardPanelData.meta.errors.queryErrors = [];
      vrlFnEditorRef?.value?.resetEditorLayout();
    });

    onBeforeMount(() => {
      if (
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].vrlFunctionQuery
      ) {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].vrlFunctionQuery = "";
      }
    });

    // on queryerror change dispatch resize event to resize monaco editor
    watch(
      () => dashboardPanelData.meta.errors.queryErrors,
      () => {
        window.dispatchEvent(new Event("resize"));
      },
    );

    const onUpdateToggle = (value) => {
      dashboardPanelData.meta.errors.queryErrors = [];
    };

    const onFunctionToggle = (value, event) => {
      // OSwitch's @update:model-value calls this with only the value (no event),
      // so guard it.
      event?.stopPropagation();

      const idx = dashboardPanelData.layout.currentQueryIndex;

      if (value) {
        // On: show the function editor pane (70/30 split).
        if (!promqlMode.value) splitterModel.value = 70;
      } else {
        // Off: hide the editor and remove this query's VRL function and its
        // derived field list, so VRL is no longer applied for this query.
        splitterModel.value = 100;
        if (dashboardPanelData.data.queries[idx]) {
          dashboardPanelData.data.queries[idx].vrlFunctionQuery = "";
        }
        if (dashboardPanelData.meta.queryFields[idx]) {
          dashboardPanelData.meta.queryFields[idx].vrlFunctionFieldList = [];
        }
        dashboardPanelData.meta.stream.vrlFunctionFieldList = [];
      }

      // open query editor
      dashboardPanelData.layout.showQueryBar = true;
    };

    // Unified Query Editor: Handle query update
    const handleQueryUpdate = (newQuery) => {
      _sqlOnQueryChange();
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].query = newQuery;

      // Also call the existing updateQuery logic for autocomplete
      updateQuery(newQuery, {});
    };

    // Unified Query Editor: Handle language change
    const handleLanguageChange = (newLanguage: "sql" | "promql") => {
      dashboardPanelData.data.queryType = newLanguage;

      // Explicitly sync the editor with the correct query after language change
      setTimeout(() => {
        if (queryEditorRef.value && queryEditorRef.value.setValue) {
          const currentQuery =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].query;
          queryEditorRef.value.setValue(currentQuery);
        }
      }, 50);
    };

    // Unified Query Editor: Handle Ask AI
    const handleAskAI = async (
      naturalLanguage: string,
      language: "sql" | "promql",
    ) => {
      // The unified component handles AI generation internally
      // This event is just for parent components that may need to react
    };

    // Try to inject runQuery from parent (if provided), otherwise use emit
    const injectedRunQuery = inject<((withoutCache?: boolean) => void) | null>(
      "runQuery",
      null,
    );

    // Unified Query Editor: Handle run query from AI bar execution intent
    const handleRunQuery = () => {
      if (injectedRunQuery) {
        injectedRunQuery(false);
      } else {
        // Emit event for parent to handle
        // Note: emits need to be handled by parent in template
        console.warn(
          "[DashboardQueryEditor] No injected runQuery found, parent should listen to @run-query event",
        );
      }
    };

    // VRL Function Editor AI Handlers
    const handleVrlFunctionUpdate = (newFunction: string) => {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].vrlFunctionQuery = newFunction;
    };

    const handleVrlGenerationStart = () => {
      // Can add loading indicators here if needed
    };

    const handleVrlGenerationEnd = () => {
      // Can remove loading indicators here if needed
    };

    const handleVrlGenerationSuccess = (payload: {
      type: string;
      message: string;
    }) => {
      // VRL function code is already updated via @update:query handler
    };

    // Inline query tab renaming
    const editingQueryIndex = ref(-1);
    const editingQueryName = ref("");
    // Vue ref to the OInput wrapper for the rename field.
    // OInput doesn't call defineExpose, so we reach into $el and grab the
    // underlying <input> via querySelector. Cleaner than a global DOM lookup.
    const renameInputRef = ref<any>(null);

    const startEditQueryName = (index: number, tab: any) => {
      editingQueryIndex.value = index;
      editingQueryName.value = tab.tabName || "Query " + (index + 1);
      // OInput renders on the next tick; focus + select the inner <input>
      // by its deterministic id (forwarded by OInput onto the input element).
      nextTick(() => {
        const el = document.getElementById(
          `dashboard-query-rename-input-${index}`,
        ) as HTMLInputElement | null;
        el?.focus();
        el?.select();
      });
    };

    const saveQueryName = (index: number) => {
      if (editingQueryIndex.value !== index) return;
      const trimmed = editingQueryName.value.trim();
      dashboardPanelData.data.queries[index].tabName =
        trimmed || undefined;
      editingQueryIndex.value = -1;
      editingQueryName.value = "";
    };

    const cancelQueryNameEdit = () => {
      editingQueryIndex.value = -1;
      editingQueryName.value = "";
    };

    return {
      t,
      router,
      onDropDownClick,
      promqlMode,
      dashboardPanelData,
      confirmQueryModeChangeDialog,
      onUpdateToggle,
      addTab,
      removeTab,
      toggleQueryVisibility,
      promqlAutoCompleteKeywords,
      sqlAutoCompleteKeywords,
      sqlAutoCompleteSuggestions,
      queryEditorRef,
      updateQuery,
      functionEditorPlaceholderFlag,
      vrlFnEditorRef,
      splitterModel,
      getImageURL,
      onFunctionToggle,
      functionOptions,
      selectedFunction,
      filterFunctionOptions,
      onFunctionSearch,
      onFunctionSelect,
      selectedStreamFieldsBasedOnUserDefinedSchema,
      store,
      multiQueryWarning,
      isPivotTable,
      handleQueryUpdate,
      handleLanguageChange,
      handleAskAI,
      handleRunQuery,
      handleVrlFunctionUpdate,
      handleVrlGenerationStart,
      handleVrlGenerationEnd,
      handleVrlGenerationSuccess,
      editingQueryIndex,
      editingQueryName,
      renameInputRef,
      startEditQueryName,
      saveQueryName,
      cancelQueryNameEdit,
      currentEditorKeywords,
      currentEditorSuggestions,
      _sqlOnFocus,
      _sqlOnBlur,
      vrlPlaceholder,
    };
  },
});
</script>

<!-- removed scope due to VRL background image issue-->
<style lang="scss">
.sql-bar {
  height: 40px;
}

.dashboard-query-remove-icon {
  opacity: 0.6;
  transition: opacity 0.15s, background-color 0.15s;

  &:hover {
    opacity: 1;
    background-color: var(--o2-hover-gray);
    border-radius: 50%;
  }
}

.dashboard-query-visibility-icon {
  opacity: 0.7;
  transition: opacity 0.15s, background-color 0.15s;

  &:hover {
    opacity: 1;
    background-color: var(--o2-hover-gray);
    border-radius: 50%;
  }
}

.query-tab-name-text {
  cursor: default;
  user-select: none;
  white-space: nowrap;
}

.query-tab-name-input-wrap {
  width: 90px;
  min-width: 50px;
  max-width: 160px;
}


// .query-tabs-container {
//   width: 100%;
//   display: flex;
//   flex-direction: row;
//   justify-content: flex-start;
//   align-items: center;
// }

// .query-tab {
//   display: flex;
//   flex-direction: row;
//   align-items: center;
//   margin-right: 10px;
//   padding: 5px;

//   &:hover {
//         background-color: #eaeaeaa5;
//     }
// }

// .tab-label {
//   margin-right: 5px;
// }

// .remove-button {
//   cursor: pointer;
//   display: flex;
//   align-items: center;
//   justify-content: center;
//   width: 20px;
//   height: 20px;
// }

// .query-tab.active {
//     border-bottom: 3px solid #000;
// }

.query-editor-placeholder-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: flex-start;
  padding: 0.1875rem 0.5rem 0 2.15rem;
  pointer-events: none;
  z-index: 1;
  user-select: none;

  .query-editor-placeholder-typewriter {
    font-family: monospace;
    font-size: var(--text-base);
    line-height: 1.3125rem;
    color: #a0aec0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
:global(.body--dark) .query-editor-placeholder-overlay .query-editor-placeholder-typewriter {
  color: #718096;
}
</style>
