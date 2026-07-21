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
  <div
    class="flex flex-col logs-index-menu w-full h-full bg-surface-panel!"
  >
    <!-- Stream type + stream selector. Shares the same page-edge gutter as the
         field search input and the field rows below it (baked into OFieldList),
         so all three form controls line up on one left/right edge. The scrolling
         list itself deliberately runs flush to the divider so its scrollbar lands
         on the panel edge — only the rows inside it carry the gutter. -->
    <div
      class="flex items-center gap-2 px-page-edge max-w-full"
    >
      <OButton
        v-if="
          searchObj.data.stream.streamType &&
          searchObj.data.stream.streamType !== 'logs'
        "
        data-test="log-search-index-list-back-to-logs-btn"
        variant="outline"
        size="icon-sm"
        class="shrink-0 h-8 w-8 border border-border-default rounded-default p-0"
        @click="onStreamTypeChange('logs')"
      >
        <OIcon name="swap-horiz" size="sm" />
        <OTooltip :content="t('search.switchToLogs')" side="bottom" align="center" />
      </OButton>
      <div class="flex-1 min-w-0">
        <OSelect
          ref="streamSelect"
          data-test="log-search-index-list-select-stream"
          :model-value="selectionMode === 'single' ? searchObj.data.stream.selectedStream[0] ?? null : searchObj.data.stream.selectedStream"
          :options="streamOptions"
          :placeholder="placeHolderText"
          :multiple="selectionMode === 'multi'"
          :row-click-single-select="selectionMode === 'multi'"
          class="w-full"
          @update:model-value="handleStreamSelection"
        >
          <template #empty>{{ t("search.noResult") }}</template>
        </OSelect>
        <OTooltip
          v-if="searchObj.data.stream.selectedStream.length > 1"
          :delay="500"
          side="bottom"
          align="start"
          max-width="280px"
          :content="searchObj.data.stream.selectedStream.join(', ')"
        />
      </div>
    </div>
    <div
      v-if="!searchObj.data.stream.selectedStream.length"
      class="index-table mt-1"
    >
      <OEmptyState
        data-test="logs-search-no-stream-selected"
        preset="no-stream-selected"
        size="inline"
        icon="database"
      >
        <template v-if="quickPickStreams.length" #extra>
          <div
            data-test="logs-search-stream-quick-pick"
            class="flex flex-col gap-1 w-full"
          >
            <span
              class="text-text-secondary text-xs font-medium text-center mb-0.5"
            >
              {{ t("search.quickPickStreamsLabel") }}
            </span>
            <OButton
              v-for="stream in quickPickStreams"
              :key="stream.value"
              :data-test="`logs-search-stream-quick-pick-${stream.value}`"
              variant="outline"
              size="sm"
              icon-left="database"
              class="w-full justify-start"
              @click="quickSelectStream(stream.value)"
            >
              <span class="truncate">{{ stream.label }}</span>
            </OButton>
            <span
              v-if="streamList.length > quickPickStreams.length"
              data-test="logs-search-stream-quick-pick-more"
              class="text-text-secondary text-xs text-center mt-0.5"
            >
              {{
                t("search.quickPickMoreStreams", {
                  count: streamList.length - quickPickStreams.length,
                })
              }}
            </span>
          </div>
        </template>
      </OEmptyState>
    </div>
    <div v-else class="index-table mt-1">
      <GroupedFieldList
        ref="fieldListRef"
        :fields="streamFieldsRows"
        :search="searchObj.data.stream.filterField"
        :loading="searchObj.loadingStream"
        :theme="store.state.theme"
        :show-pagination="true"
        :page-size="pagination.rowsPerPage"
        :current-page="pagination.page"
        @update:search="searchObj.data.stream.filterField = $event"
        @update:current-page="setPage($event)"
      >
        <template #field-row="{ row }">
          <FieldRow
            :field="row"
            :selected-fields="searchObj.data.stream.selectedFields"
            :timestamp-column="store.state.zoConfig.timestamp_column"
            :theme="store.state.theme"
            :show-quick-mode="searchObj.meta.quickMode"
            :show-fts-field-values="showFtsFieldValues"
            @add-to-filter="addToFilter"
            @toggle-field="clickFieldFn"
            @toggle-interesting="addToInterestingFieldList"
          >
            <template #expansion="{ field }">
              <FieldExpansion
                :field="field"
                :field-values="fieldValues[field.name]"
                :active-include-values="activeIncludeFilterValues?.[field.name] ?? []"
                :active-exclude-values="activeExcludeFilterValues?.[field.name] ?? []"
                :expanded="expandedFields?.[field.name] ?? false"
                :selected-fields="searchObj.data.stream.selectedFields"
                :selected-streams-count="searchObj.data.stream.selectedStream.length"
                :theme="store.state.theme"
                :show-quick-mode="searchObj.meta.quickMode"
                :default-values-count="store.state.zoConfig?.query_values_default_num || 10"
                @add-to-filter="addToFilter"
                @toggle-field="clickFieldFn"
                @toggle-interesting="addToInterestingFieldList"
                @add-search-term="addSearchTerm"
                @add-multiple-search-terms="addMultipleSearchTerms"
                @remove-field-filter="removeFieldFilter"
                @before-show="openFilterCreator"
                @before-hide="cancelFilterCreator"
                @search-field-values="searchFieldValues"
                @load-more-values="loadMoreFieldValues"
              />
            </template>
          </FieldRow>
        </template>

        <template #after-list="bottomProps">
          <GroupedFieldListPagination
            data-test-prefix="logs-page"
            :show-schema-toggle="showUserDefinedSchemaToggle"
            :show-quick-mode="searchObj.meta.quickMode"
            :use-user-defined-schemas="searchObj.meta.useUserDefinedSchemas"
            :show-only-interesting-fields="showOnlyInterestingFields"
            :schema-toggle-options="userDefinedSchemaBtnGroupOption"
            :interesting-fields-toggle-options="selectedFieldsBtnGroupOption"
            :current-page="bottomProps.currentPage"
            :pages-number="bottomProps.totalPages"
            :is-first-page="bottomProps.isFirstPage"
            :is-last-page="bottomProps.isLastPage"
            :total-fields-count="totalFieldsCount"
            @toggle-schema="toggleSchema"
            @toggle-interesting-fields="toggleInterestingFields"
            @first-page="bottomProps.firstPage()"
            @last-page="bottomProps.lastPage()"
            @set-page="setPage"
            @reset-fields="resetSelectedFileds"
          />
        </template>

        <template #empty>
          <div
            data-test="logs-search-no-field-found-text"
            class="text-center w-5/6 mx-0 pt-3"
          >
            <OIcon name="info" size="sm" class="align-middle mr-1" />
            {{ t("search.noFieldFoundInStream") }}
          </div>
        </template>

        <template #loading>
          <div
            data-test="logs-indexlist-fieldlist-loading-skeleton"
            class="w-full flex flex-col"
          >
            <!-- Group 1 header -->
            <div class="h-7 flex items-center justify-between px-2">
              <OSkeleton type="rect" class="h-3 w-24 rounded-default" />
              <OSkeleton type="rect" class="h-3 w-3 rounded-default" />
            </div>
            <!-- Group 1 fields -->
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="flex-1" />
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="w-3/4" />
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="flex-1" />
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="w-4/5" />
            </div>
            <!-- Group 2 header -->
            <div class="h-7 flex items-center justify-between px-2 mt-2">
              <OSkeleton type="rect" class="h-3 w-16 rounded-default" />
              <OSkeleton type="rect" class="h-3 w-3 rounded-default" />
            </div>
            <!-- Group 2 field -->
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="w-2/3" />
            </div>
            <!-- Group 3 header -->
            <div class="h-7 flex items-center justify-between px-2 mt-2">
              <OSkeleton type="rect" class="h-3 w-32 rounded-default" />
              <OSkeleton type="rect" class="h-3 w-3 rounded-default" />
            </div>
            <!-- Group 3 fields -->
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="flex-1" />
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="w-4/5" />
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="flex-1" />
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="w-3/4" />
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="flex-1" />
            </div>
          </div>
        </template>
      </GroupedFieldList>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  type Ref,
  watch,
  computed,
  onBeforeMount,
  onBeforeUnmount,
  nextTick,
  defineAsyncComponent,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useLogs from "../../composables/useLogs";
import {
  b64EncodeUnicode,
  getImageURL,
  convertTimeFromMicroToMilli,
  formatLargeNumber,
  useLocalInterestingFields,
  generateTraceContext,
  isStreamingEnabled,
  addSpacesToOperators,
} from "../../utils/zincutils";
import streamService from "../../services/stream";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep } from "lodash-es";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import searchService from "@/services/search";
import useHttpStreaming from "@/composables/useStreamingSearch";
import {
  logsUtils,
  removeFieldFromWhereAST,
} from "@/composables/useLogs/logsUtils";
import { useSearchBar } from "@/composables/useLogs/useSearchBar";
import { applyCollapseFilter } from "@/utils/fieldCategories";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { searchState } from "@/composables/useLogs/searchState";
import { useStreamFields } from "@/composables/useLogs/useStreamFields";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { captureFromValuesApi } from "@/composables/useFieldValueStore";
import { saveLogsStreamType, saveLogsStream } from "@/utils/streamPersist";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import { toast } from "@/lib/feedback/Toast/useToast";

interface Filter {
  fieldName: string;
  selectedValues: string[];
  selectedOperator: string;
}
export default defineComponent({
  name: "ComponentSearchIndexSelect",
  props: {
    selectionMode: {
      type: String as () => "single" | "multi",
      default: "multi",
    },
  },
  components: {
    EqualIcon,
    NotEqualIcon,
    GroupedFieldList: defineAsyncComponent(
      () => import("@/components/common/GroupedFieldList.vue"),
    ),
    FieldRow: defineAsyncComponent(
      () => import("@/components/common/FieldRow.vue"),
    ),
    FieldExpansion: defineAsyncComponent(
      () => import("@/components/common/FieldExpansion.vue"),
    ),
    FieldListPagination: defineAsyncComponent(
      () => import("@/components/common/FieldListPagination.vue"),
    ),
    GroupedFieldListPagination: defineAsyncComponent(
      () => import("@/components/common/FieldListPagination.vue"),
    ),
    OButton,
    OSelect,
    OIcon,
    OTooltip,
    OSpinner,
    OEmptyState,
  },
  emits: ["setInterestingFieldInSQLQuery"],
  methods: {
    handleStreamSelection(value: string | string[] | null) {
      if (this.selectionMode === "single") {
        this.searchObj.data.stream.selectedStream = value ? [value as string] : [];
      } else {
        this.searchObj.data.stream.selectedStream = (value as string[]) ?? [];
      }
      this.$nextTick(() => {
        const indexListSelectField = this.$refs.streamSelect as any;
        if (indexListSelectField?.updateInputValue) {
          indexListSelectField.updateInputValue("");
        }
      });
      this.onStreamChange("");
      this.resetPagination();
    },
    // One-click stream pick from the empty state — mirrors a dropdown
    // selection so fields load immediately, without opening the dropdown.
    quickSelectStream(streamName: string) {
      this.handleStreamSelection(
        this.selectionMode === "single" ? streamName : [streamName],
      );
    },
  },
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const {
      reorderSelectedFields,
      getFilterExpressionByFieldType,
      extractValueQuery,
    } = useLogs();

    const { filterHitsColumns, extractFields, getStreamList } =
      useStreamFields();

    const { searchObj, streamSchemaFieldsIndexMapping } = searchState();

    const { onStreamChange, handleQueryData } = useSearchBar();
    const { validateFilterForMultiStream } = useSearchStream();

    const { fnParsedSQL, fnUnparsedSQL, updatedLocalLogFilterField } =
      logsUtils();

    const { fetchQueryDataWithWebSocket, sendSearchMessageBasedOnRequestId } =
      useSearchWebSocket();

    const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
      useHttpStreaming();

    const traceIdMapper = ref<{ [key: string]: string[] }>({});

    const showOnlyInterestingFields = ref(false);

    const showFtsFieldValues = computed(
      () => store.state.zoConfig?.show_fts_field_values ?? false,
    );

    const userDefinedSchemaBtnGroupOption = ref([
      {
        label: "",
        value: "user_defined_schema",
        slot: "user_defined_slot",
      },
      {
        label: "",
        value: "all_fields",
        slot: "all_fields_slot",
      },
    ]);

    const selectedFieldsBtnGroupOption = [
      {
        label: "",
        value: false,
        slot: "all_fields_slot",
      },
      {
        label: "",
        value: true,
        slot: "interesting_fields_slot",
      },
    ];

    const streamOptions: any = ref([]);
    const fieldValues: Ref<{
      [key: string | number]: {
        isLoading: boolean;
        values: { key: string; count: number }[];
        errMsg?: string;
        hasMore?: boolean;
      };
    }> = ref({});

    const openedFilterFields = ref<string[]>([]);
    const expandedFields = ref<Record<string, boolean>>({});

    // Stores the last fetch payloads per field so value-search can reuse them
    const lastFieldFetchPayloads = ref<Record<string, any[]>>({});
    // Caches the original (no-keyword) values so clearing the search box
    // restores them instantly without a new API call.
    const cachedFieldValues = ref<
      Record<string, { key: string; count: number }[]>
    >({});
    // Caches the per-stream values alongside cachedFieldValues so "load more"
    // appends correctly after a search is cleared.
    const cachedStreamFieldValues = ref<
      Record<
        string,
        Record<string, { values: { key: string; count: number }[] }>
      >
    >({});
    // Tracks the cumulative size requested per field (grows on "load more").
    const fieldValuesCurrentSize = ref<Record<string, number>>({});
    // Stores finalized values from previous pages (immutable during streaming).
    const fieldValuesFinalizedValues = ref<
      Record<string, { key: string; count: number }[]>
    >({});
    // Stores the pinned time range from the first request per field.
    const fieldValuesTimeRange = ref<
      Record<string, { start_time: number; end_time: number }>
    >({});
    // Tracks the active keyword search term per field so "load more" re-applies it.
    const fieldSearchKeywords = ref<Record<string, string>>({});

    // New state to store field values with stream context
    const streamFieldValues: Ref<{
      [key: string]: {
        [stream: string]: {
          values: { key: string; count: number }[];
        };
      };
    }> = ref({});

    const pagination = ref({
      page: 1,
      rowsPerPage: 25,
    });

    const onStreamTypeChange = async (newType: string) => {
      searchObj.data.stream.streamType = newType;
      searchObj.data.stream.selectedStream = [];
      searchObj.data.stream.selectedStreamFields = [];
      saveLogsStreamType(store.state.selectedOrganization.identifier, newType);
      saveLogsStream(store.state.selectedOrganization.identifier, []);
      await getStreamList(true);
    };

    const showUserDefinedSchemaToggle = computed(() => {
      return (
        store.state.zoConfig.user_defined_schemas_enabled &&
        searchObj.meta.hasUserDefinedSchemas
      );
    });

    const streamList = computed(() => {
      return searchObj.data.stream.streamLists;
    });

    // First few streams surfaced as one-click picks in the no-stream empty
    // state. Ordered by most recently ingested data (stats.doc_time_max desc)
    // so the streams most likely worth exploring sit at the top. Capped so a
    // narrow panel stays scannable; the rest stay reachable through the
    // dropdown's search. Falls back to the plain stream-list order when
    // ingestion stats aren't available.
    const QUICK_PICK_LIMIT = 8;
    const quickPickStreams = computed(() => {
      const detailed = searchObj.data.streamResults?.list;
      if (Array.isArray(detailed) && detailed.length) {
        return [...detailed]
          .sort(
            (a: any, b: any) =>
              (b?.stats?.doc_time_max ?? 0) - (a?.stats?.doc_time_max ?? 0),
          )
          .slice(0, QUICK_PICK_LIMIT)
          .map((item: any) => ({ label: item.name, value: item.name }));
      }
      return (streamList.value || []).slice(0, QUICK_PICK_LIMIT);
    });

    const checkSelectedFields = computed(() => {
      return (
        searchObj.data.stream.selectedFields &&
        searchObj.data.stream.selectedFields.length > 0
      );
    });

    /**
     * Extracts a plain column name from a DataFusion SQL AST column node.
     * The parser represents column names as either a plain string or a nested
     * object ({ expr: { value: "name" } }), so we handle both shapes and
     * strip surrounding double-quotes when present.
     */
    const extractColName = (col: any): string | null => {
      if (typeof col === "string") return col.replace(/^"|"$/g, "");
      if (col?.expr?.value != null) return String(col.expr.value);
      return null;
    };

    /**
     * Derives which field values are currently *included* in the active query.
     * Returns a map of { fieldName: [value, ...] } by walking the SQL WHERE AST
     * and collecting:
     *   - equality conditions  (field = 'value')
     *   - IS NULL conditions   (field IS NULL  → sentinel key "")
     *
     * Used to pre-check the corresponding checkboxes (blue) in the field sidebar.
     */
    const activeIncludeFilterValues = computed((): Record<string, string[]> => {
      const result: Record<string, string[]> = {};
      const query = searchObj.data.query;
      if (!query) return result;
      try {
        const queryToParse = searchObj.meta.sqlMode
          ? query
          : `select * from stream where ${query}`;
        const parsed = fnParsedSQL(queryToParse);
        if (!parsed?.where) return result;
        const walkNode = (node: any) => {
          if (!node) return;
          const op = node.operator?.toUpperCase();
          if (op === "OR" || op === "AND") {
            walkNode(node.left);
            walkNode(node.right);
          } else if (op === "=") {
            if (node.left?.type === "column_ref") {
              const colName = extractColName(node.left.column);
              if (colName && node.right?.value != null) {
                const val = String(node.right.value);
                if (!result[colName]) result[colName] = [];
                if (!result[colName].includes(val)) result[colName].push(val);
              }
            }
          } else if (op === "IS") {
            if (node.left?.type === "column_ref") {
              const colName = extractColName(node.left.column);
              if (colName) {
                if (!result[colName]) result[colName] = [];
                if (!result[colName].includes("")) result[colName].push("");
              }
            }
          }
        };
        walkNode(parsed.where);
      } catch {
        // ignore parse errors
      }
      return result;
    });

    /**
     * Derives which field values are currently *excluded* from the active query.
     * Returns a map of { fieldName: [value, ...] } by walking the SQL WHERE AST
     * and collecting:
     *   - inequality conditions  (field != 'value' / field <> 'value')
     *   - IS NOT NULL conditions (field IS NOT NULL → sentinel key "")
     *
     * Used to pre-check the corresponding checkboxes (red) in the field sidebar.
     */
    const activeExcludeFilterValues = computed((): Record<string, string[]> => {
      const result: Record<string, string[]> = {};
      const query = searchObj.data.query;
      if (!query) return result;
      try {
        const queryToParse = searchObj.meta.sqlMode
          ? query
          : `select * from stream where ${query}`;
        const parsed = fnParsedSQL(queryToParse);
        if (!parsed?.where) return result;
        const walkNode = (node: any) => {
          if (!node) return;
          const op = node.operator?.toUpperCase();
          if (op === "OR" || op === "AND") {
            walkNode(node.left);
            walkNode(node.right);
          } else if (op === "!=" || op === "<>") {
            if (node.left?.type === "column_ref") {
              const colName = extractColName(node.left.column);
              if (colName && node.right?.value != null) {
                const val = String(node.right.value);
                if (!result[colName]) result[colName] = [];
                if (!result[colName].includes(val)) result[colName].push(val);
              }
            }
          } else if (op === "IS NOT") {
            if (node.left?.type === "column_ref") {
              const colName = extractColName(node.left.column);
              if (colName) {
                if (!result[colName]) result[colName] = [];
                if (!result[colName].includes("")) result[colName].push("");
              }
            }
          }
        };
        walkNode(parsed.where);
      } catch {
        // ignore parse errors
      }
      return result;
    });

    // `immediate` seeds streamOptions on every (re)mount — without it the lazy
    // watcher never fires after a v-if remount (streamList itself is unchanged)
    // and the list stays empty. OSelect handles search filtering internally over
    // these options.
    watch(
      () => streamList.value,
      () => {
          streamOptions.value = [...streamList.value];
      },
      {
        deep: true,
        immediate: true,
      },
    );

    const resetFields = async () => {
      searchObj.loadingStream = true;

      // Wait for next tick to ensure loading state is rendered
      await nextTick();

      streamSchemaFieldsIndexMapping.value = {};
      await extractFields();

      // Wait for next tick before removing loading state
      await nextTick();
      searchObj.loadingStream = false;
    };

    const fieldListRef = ref<HTMLElement | null>(null);
    const streamSelect = ref<InstanceType<typeof OSelect> | null>(null);

    const scrollToTop = () => {
      // Use FieldList's exposed scrollToTop which works with OFieldList/OTable
      (fieldListRef.value as any)?.scrollToTop?.();
    };

    const resetPagination = () => {
      pagination.value.page = 1;

      // Tell FieldList to skip its scroll-preserve logic for this intentional reset.
      (fieldListRef.value as any)?.prepareScrollReset?.();

      // Reset scroll position when changing tabs
      nextTick(() => {
        scrollToTop();
      });
    };

    watch(
      () => searchObj.meta.quickMode,
      (isActive) => {
        if (isActive) {
          // check if its present in the array dont add it again
          if (
            !userDefinedSchemaBtnGroupOption.value.some(
              (option) => option.value === "interesting_fields",
            )
          ) {
            userDefinedSchemaBtnGroupOption.value.push({
              label: "",
              value: "interesting_fields",
              slot: "interesting_fields_slot",
            });
          }
          setDefaultFieldTab();
        } else {
          userDefinedSchemaBtnGroupOption.value =
            userDefinedSchemaBtnGroupOption.value.filter(
              (option) => option.value !== "interesting_fields",
            );

          if (searchObj.meta.useUserDefinedSchemas === "interesting_fields") {
            // As we are changing the tab reset the pagination
            if (pagination.value) resetPagination();
            searchObj.meta.useUserDefinedSchemas = "user_defined_schema";
          }

          if (showOnlyInterestingFields.value)
            if (pagination.value) resetPagination();

          showOnlyInterestingFields.value = false;
        }
      },
      {
        immediate: true,
      },
    );

    // Removed resetFields() call on quick mode toggle to prevent flicker
    // watch(
    //   () => searchObj.meta.quickMode,
    //   () => {
    //     resetFields();
    //   },
    // );

    watch(
      () => [
        showUserDefinedSchemaToggle.value,
        searchObj.meta.useUserDefinedSchemas,
      ],
      (isActive) => {
        showOnlyInterestingFields.value =
          searchObj.meta.useUserDefinedSchemas === "interesting_fields";
      },
      {
        immediate: true,
      },
    );

    /**
     * Added this watcher to set default field tab when user defined schema toggle is changed
     * As when user selects stream defineSchema flag is set and there is no any event to identify that
     * so we are using this watcher to set default field tab as per the stream settings
     */
    watch(showUserDefinedSchemaToggle, () => {
      setDefaultFieldTab();
    });

    // Reset to page 1 whenever the field search term changes so the user
    // always sees results from the beginning of the filtered list.
    watch(
      () => searchObj.data.stream.filterField,
      () => { pagination.value = { ...pagination.value, page: 1 }; },
    );

    // Close the stream-select dropdown whenever the Source Details drawer opens
    // so the open popover does not obscure the drawer in both single and multi-select mode.
    watch(
      () => searchObj.meta.showDetailTab,
      (isOpen) => {
        if (isOpen) {
          (streamSelect.value as any)?.close?.();
        }
      },
    );

    const filterStreamFn = (val: string, update: any) => {
      update(() => {
        const needle = val.toLowerCase();
        const source = streamList.value || [];
        if (!needle) {
          streamOptions.value = [...source];
        } else {
          streamOptions.value = source.filter(
            (v: any) => v.label.toLowerCase().indexOf(needle) > -1,
          );
        }
      });
    };

    const selectedStream = ref("");

    // if interesting field is enabled, then set default tab as interesting fields
    // otherwise set default tab as user defined schema
    function setDefaultFieldTab() {
      if (store.state.zoConfig.log_page_default_field_list === "uds") {
        // reset pagination only if tab has changed
        if (searchObj.meta.useUserDefinedSchemas !== "user_defined_schema")
          resetPagination();
        searchObj.meta.useUserDefinedSchemas = "user_defined_schema";
        showOnlyInterestingFields.value = false;
      } else {
        // reset pagination only if tab has changed
        if (searchObj.meta.useUserDefinedSchemas !== "interesting_fields")
          resetPagination();
        searchObj.meta.useUserDefinedSchemas = "interesting_fields";
        showOnlyInterestingFields.value = true;
      }
    }

    const filterFieldFn = (rows: any, terms: any) => {
      if (!terms) return rows;

      const term = terms.toLowerCase();

      // Build a label-row lookup from the current rows so we can re-inject
      // the correct group header for each matched field.
      const labelByGroup: Record<string, any> = {};
      for (const row of rows) {
        if (row.label && row.group) labelByGroup[row.group] = row;
      }

      const seen = new Set<string>();
      const seenGroups = new Set<string>();
      const filtered: any[] = [];

      for (const row of rows) {
        // Never include label rows directly — they'll be re-injected below
        if (row.label) continue;

        if (row.name.toLowerCase().includes(term) && !seen.has(row.name)) {
          seen.add(row.name);

          // Inject the group label row once, the first time a field from that group matches
          const group = row.group;
          if (group && labelByGroup[group] && !seenGroups.has(group)) {
            seenGroups.add(group);
            filtered.push(labelByGroup[group]);
          }

          filtered.push(row);
        }
      }

      if (!filtered.length) {
        return [{ name: t("logs.indexList.noMatchingFields"), label: true, group: "__none__" }];
      }
      return filtered;
    };

    const addToFilter = (field: any) => {
      if (searchObj.meta.sqlMode === true && typeof field === "string") {
        const fieldAndOperator = field.match(
          /^([^=!<>\s()"]+)(\s*(?:!=|=)\s*.*)$/,
        );
        if (fieldAndOperator) {
          searchObj.data.stream.addToFilter = `${quoteSqlIdentifierIfNeeded(fieldAndOperator[1])}${fieldAndOperator[2]}`;
          return;
        }
      }
      searchObj.data.stream.addToFilter = field;
    };

    function clickFieldFn(row: { name: never }) {
      // Explicit user action — clear the system-pick marker so this selection
      // persists to logFilterField.
      searchObj.meta.isFtsDefaultColumn = false;
      let selectedFields = reorderSelectedFields();

      if (selectedFields.includes(row.name)) {
        selectedFields = selectedFields.filter((v: any) => v !== row.name);
      } else {
        selectedFields.push(row.name);
      }

      searchObj.data.stream.selectedFields = selectedFields.filter(
        (_field) =>
          _field !== (store?.state?.zoConfig?.timestamp_column || "_timestamp"),
      );

      searchObj.organizationIdentifier =
        store.state.selectedOrganization.identifier;
      updatedLocalLogFilterField();
      filterHitsColumns();
    }

    function resetSelectedFileds() {
      searchObj.meta.isFtsDefaultColumn = false;
      searchObj.data.stream.selectedFields = [];
      updatedLocalLogFilterField();
    }

    // Get page numbers to display (3 at a time)
    function getPageNumbers(currentPage: number, totalPages: number) {
      const pages: number[] = [];

      if (totalPages <= 3) {
        // If 3 or fewer pages, show all
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Show 3 pages centered around current page
        let startPage = Math.max(1, currentPage - 1);
        let endPage = Math.min(totalPages, startPage + 2);

        // Adjust if we're near the end
        if (endPage === totalPages) {
          startPage = Math.max(1, endPage - 2);
        }

        for (let i = startPage; i <= endPage; i++) {
          pages.push(i);
        }
      }

      return pages;
    }

    /**
     * Recursively removes WHERE conditions that reference the given field from an AST node.
     * For AND/OR chains, removes the matching branch and preserves the rest.
     * Returns null if the entire subtree references only the excluded field.
     */
    /**
     * Single Stream
     * - Consider filter in sql and non sql mode, create sql query and fetch values
     *
     * Multiple Stream
     * - Dont consider filter in both mode, create sql query for each stream and fetch values
     *
     * @param event
     * @param param1
     */

    const openFilterCreator = async (
      event: any,
      { name, ftsKey, isSchemaField, streams }: any,
    ) => {
      if (ftsKey && !showFtsFieldValues.value) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      try {
        //maintaing  the opened fields
        openedFilterFields.value.push(name);
        expandedFields.value[name] = true;
        let timestamps: any =
          searchObj.data.datetime.type === "relative"
            ? getConsumableRelativeTime(
                searchObj.data.datetime.relativeTimePeriod,
              )
            : cloneDeep(searchObj.data.datetime);

        if (searchObj.data.stream.streamType === "enrichment_tables") {
          const stream = searchObj.data.streamResults.list.find((stream: any) =>
            searchObj.data.stream.selectedStream.includes(stream.name),
          );
          if (stream.stats) {
            timestamps = {
              startTime:
                new Date(
                  convertTimeFromMicroToMilli(
                    stream.stats.doc_time_min - 300000000,
                  ),
                ).getTime() * 1000,
              endTime:
                new Date(
                  convertTimeFromMicroToMilli(
                    stream.stats.doc_time_max + 300000000,
                  ),
                ).getTime() * 1000,
            };
          }
        }

        const startISOTimestamp: number = timestamps?.startTime || 0;
        const endISOTimestamp: number = timestamps?.endTime || 0;

        fieldValues.value[name] = {
          isLoading: true,
          values: [],
          errMsg: "",
        };
        lastFieldFetchPayloads.value[name] = [];
        delete cachedFieldValues.value[name];
        delete cachedStreamFieldValues.value[name];
        fieldValuesCurrentSize.value[name] =
          store.state.zoConfig?.query_values_default_num || 10;
        fieldValuesFinalizedValues.value[name] = [];
        fieldValuesTimeRange.value[name] = {
          start_time: startISOTimestamp,
          end_time: endISOTimestamp,
        };
        delete fieldSearchKeywords.value[name];
        let query_context = "";
        let query = searchObj.data.query;
        let whereClause = "";
        let queries: any = {};
        searchObj.data.filterErrMsg = "";
        searchObj.data.missingStreamMessage = "";
        searchObj.data.stream.missingStreamMultiStreamFilter = [];
        if (searchObj.meta.sqlMode == true && query.trim().length) {
          const parsedSQL: any = fnParsedSQL(query);
          //hack add time stamp column to parsedSQL if not already added
          query_context = fnUnparsedSQL(parsedSQL).replace(/`/g, '"') || "";

          // Check if parser failed to parse the query (e.g., UNION ALL BY NAME)
          // If both columns and from arrays are empty, the parser couldn't handle the syntax
          if (
            query_context === "" &&
            parsedSQL.columns?.length === 0 &&
            parsedSQL.from?.length === 0
          ) {
            // Fallback: Use simple SELECT * query for field values
            // This will be replaced with actual stream name later
            query_context = 'SELECT * FROM "[INDEX_NAME]"';
          }

          if (searchObj.data.stream.selectedStream.length > 1) {
            queries = extractValueQuery();
          }
        } else {
          let parseQuery = query.split("|");
          let queryFunctions = "";
          let whereClause = "";
          if (parseQuery.length > 1) {
            queryFunctions = "," + parseQuery[0].trim();
            whereClause = parseQuery[1].trim();
          } else {
            whereClause = parseQuery[0].trim();
          }

          query_context = `SELECT *${queryFunctions} FROM "[INDEX_NAME]" [WHERE_CLAUSE]`;

          if (whereClause.trim() != "") {
            whereClause = addSpacesToOperators(whereClause);

            const parsedSQL = whereClause.split(" ");
            searchObj.data.stream.selectedStreamFields.forEach((field: any) => {
              parsedSQL.forEach((node: any, index: any) => {
                if (node == field.name) {
                  node = node.replaceAll('"', "");
                  parsedSQL[index] = '"' + node + '"';
                }
              });
            });

            whereClause = parsedSQL.join(" ");

            // query_context = query_context.replace(
            //   "[WHERE_CLAUSE]",
            //   " WHERE " + whereClause,
            // );
            query_context = query_context
              .split("[WHERE_CLAUSE]")
              .join(" WHERE " + whereClause);
          } else {
            query_context = query_context.replace("[WHERE_CLAUSE]", "");
          }
          // query_context = b64EncodeUnicode(query_context) || "";
        }

        let query_fn = "";
        if (
          searchObj.data.tempFunctionContent != "" &&
          searchObj.data.transformType === "function"
        ) {
          query_fn = b64EncodeUnicode(searchObj.data.tempFunctionContent) || "";
        }

        let action_id = "";
        if (
          searchObj.data.transformType === "action" &&
          searchObj.data.selectedTransform?.id
        ) {
          action_id = searchObj.data.selectedTransform.id;
        }

        resetFieldValues(name, true);

        if (whereClause.trim() != "") {
          // validateFilterForMultiStream function called to get missingStreamMultiStreamFilter
          const validationFlag = validateFilterForMultiStream();
          if (!validationFlag) {
            fieldValues.value[name]["isLoading"] = false;
            fieldValues.value[name]["errMsg"] =
              t("logs.indexList.filterNotValidForStreams");
            return;
          }
          if (searchObj.data.stream.missingStreamMultiStreamFilter.length > 0) {
            streams = searchObj.data.stream.selectedStream.filter(
              (streams: any) =>
                !searchObj.data.stream.missingStreamMultiStreamFilter.includes(
                  streams,
                ),
            );
          }
        }

        let countTotal = streams.length;
        for (const selectedStream of streams) {
          if (streams.length > 1) {
            query_context = "select * from [INDEX_NAME]";
          }
          if (
            searchObj.data.stream.selectedStream.length > 1 &&
            searchObj.meta.sqlMode &&
            queries[selectedStream]
          ) {
            query_context = queries[selectedStream];
          }

          if (query_context !== "") {
            query_context = query_context == undefined ? "" : query_context;

            // Build SQL with the expanded field's own filter condition removed so
            // field value counts are not constrained by that filter.
            const rawSQL = query_context.replace(
              "[INDEX_NAME]",
              selectedStream,
            );
            let sqlForValues = rawSQL;
            try {
              const parsedForValues = fnParsedSQL(rawSQL);
              if (parsedForValues?.from?.length > 0) {
                const modifiedWhere = removeFieldFromWhereAST(
                  parsedForValues.where,
                  name,
                );
                const modifiedSQL = fnUnparsedSQL({
                  ...parsedForValues,
                  where: modifiedWhere,
                }).replace(/`/g, '"');
                if (modifiedSQL) {
                  sqlForValues = modifiedSQL;
                }
              }
            } catch {
              // Fall back to original SQL if AST manipulation fails
            }

            const fetchPayload = {
              fields: [name],
              size: store.state.zoConfig?.query_values_default_num || 10,
              no_count: false,
              regions: searchObj.meta.regions,
              clusters: searchObj.meta.clusters,
              vrl_fn: query_fn,
              start_time: startISOTimestamp,
              end_time: endISOTimestamp,
              timeout: 30000,
              stream_name: selectedStream,
              stream_type: searchObj.data.stream.streamType,
              use_cache: (window as any).use_cache ?? true,
              sql: b64EncodeUnicode(sqlForValues) || "",
            };

            // Store for reuse by searchFieldValues
            if (!lastFieldFetchPayloads.value[name]) {
              lastFieldFetchPayloads.value[name] = [];
            }
            lastFieldFetchPayloads.value[name].push(fetchPayload);

            // Implement streaming based field values, check getQueryData in useLogs for streaming enabled
            fetchValuesWithWebsocket(fetchPayload);
          }
        }

        openedFilterFields.value = openedFilterFields.value.filter(
          (field: string) => field !== name,
        );
      } catch (err) {
        fieldValues.value[name]["isLoading"] = false;
        openedFilterFields.value = openedFilterFields.value.filter(
          (field: string) => field !== name,
        );
        console.log(err);
        toast({
          variant: "error",
          message: t("logs.indexList.errorFetchingFieldValues"),
        });
      }
    };

    const addSearchTerm = (
      field: string,
      field_value: string | number | boolean,
      action: string,
    ) => {
      const expression = getFilterExpressionByFieldType(
        field,
        field_value,
        action,
      );

      if (expression) {
        searchObj.data.stream.addToFilter = expression;
      } else {
        toast({
          variant: "error",
          message: t("logs.indexList.failedToGenerateFilterExpression"),
        });
      }
    };

    const addMultipleSearchTerms = (
      field: string,
      values: string[],
      action: string,
    ) => {
      if (!values.length) return;

      const expressions = values
        .map((v) => getFilterExpressionByFieldType(field, v, action))
        .filter(Boolean);

      if (!expressions.length) {
        toast({
          variant: "error",
          message: t("logs.indexList.failedToGenerateFilterExpressions"),
        });
        return;
      }

      const joinOperator = action === "include" ? " OR " : " AND ";
      const combined =
        expressions.length > 1
          ? `(${expressions.join(joinOperator)})`
          : expressions[0];

      searchObj.data.stream.addToFilter = combined;
    };

    const removeFieldFilter = (fieldName: string) => {
      searchObj.data.stream.removeFilterField = fieldName;
    };

    const loadMoreFieldValues = (fieldName: string) => {
      const payloads = lastFieldFetchPayloads.value[fieldName];
      if (!payloads?.length) return;

      const pageSize = store.state.zoConfig?.query_values_default_num || 10;
      const currentSize = fieldValuesCurrentSize.value[fieldName] || pageSize;
      const newSize = currentSize + pageSize;
      fieldValuesCurrentSize.value[fieldName] = newSize;

      // Snapshot current values as finalized (they won't change during streaming).
      fieldValuesFinalizedValues.value[fieldName] = [
        ...(fieldValues.value[fieldName]?.values || []),
      ];

      // Show loading without wiping existing values while the next page arrives.
      if (fieldValues.value[fieldName]) {
        fieldValues.value[fieldName].isLoading = true;
        fieldValues.value[fieldName].hasMore = false;
      }

      const keyword = fieldSearchKeywords.value[fieldName];
      const pinnedTime = fieldValuesTimeRange.value[fieldName];

      for (const payload of payloads) {
        fetchValuesWithWebsocket({
          ...payload,
          size: newSize,
          ...(pinnedTime
            ? {
                start_time: pinnedTime.start_time,
                end_time: pinnedTime.end_time,
              }
            : {}),
          ...(keyword ? { keyword } : {}),
        });
      }
    };

    const searchFieldValues = (fieldName: string, searchTerm: string) => {
      // Reset pagination whenever the search term changes.
      fieldValuesCurrentSize.value[fieldName] =
        store.state.zoConfig?.query_values_default_num || 10;
      delete fieldValuesFinalizedValues.value[fieldName];
      // Track the active keyword so "load more" can re-apply it.
      fieldSearchKeywords.value[fieldName] = searchTerm;

      // Restore from cache when the search term is cleared — no API call needed.
      if (!searchTerm && cachedFieldValues.value[fieldName]) {
        const cachedVals = cachedFieldValues.value[fieldName];
        const pageSize = store.state.zoConfig?.query_values_default_num || 10;
        // Restore per-stream values so "load more" appends to the right baseline.
        streamFieldValues.value[fieldName] =
          cachedStreamFieldValues.value[fieldName] || {};
        fieldValues.value[fieldName] = {
          isLoading: false,
          values: [...cachedVals],
          errMsg: "",
          hasMore: cachedVals.length >= pageSize,
        };
        return;
      }

      const payloads = lastFieldFetchPayloads.value[fieldName];
      if (!payloads?.length) return;

      // Snapshot the current values as cache before the first keyword search.
      if (searchTerm && !cachedFieldValues.value[fieldName]) {
        const current = fieldValues.value[fieldName]?.values;
        if (current?.length) {
          cachedFieldValues.value[fieldName] = [...current];
          cachedStreamFieldValues.value[fieldName] = JSON.parse(
            JSON.stringify(streamFieldValues.value[fieldName] || {}),
          );
        }
      }

      fieldValues.value[fieldName] = {
        isLoading: true,
        values: [],
        errMsg: "",
      };
      resetFieldValues(fieldName, true);

      for (const payload of payloads) {
        fetchValuesWithWebsocket({
          ...payload,
          keyword: searchTerm || undefined,
        });
      }
    };

    let fieldIndex: any = -1;
    const addToInterestingFieldList = (
      field: any,
      isInterestingField: boolean,
    ) => {
      if (!Object.keys(streamSchemaFieldsIndexMapping.value).length) {
        return;
      }

      const defaultInterestingFields = new Set(
        store.state?.zoConfig?.default_quick_mode_fields || [],
      );

      if (isInterestingField) {
        const index = searchObj.data.stream.interestingFieldList.indexOf(
          field.name,
        );

        if (index > -1) {
          // only splice array when item is found
          searchObj.data.stream.interestingFieldList.splice(index, 1); // 2nd parameter means remove one item only

          searchObj.data.stream.selectedInterestingStreamFields =
            searchObj.data.stream.selectedInterestingStreamFields.filter(
              (item: any) => item.name !== field.name,
            );

          if (field.group) {
            if (
              searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                field.group
              ] > 0
            ) {
              searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                field.group
              ] =
                searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                  field.group
                ] - 1;
            }
          }

          field.isInterestingField = !isInterestingField;
          fieldIndex = streamSchemaFieldsIndexMapping.value[field.name];
          if (fieldIndex > -1) {
            searchObj.data.stream.selectedStreamFields[
              fieldIndex
            ].isInterestingField = !isInterestingField;
            fieldIndex = -1;
          }
          // searchObj.data.stream.selectedStreamFields[3].isInterestingField = !isInterestingField;
          const localInterestingFields: any = useLocalInterestingFields();
          let localStreamFields: any = {};
          if (localInterestingFields.value != null) {
            localStreamFields = localInterestingFields.value;
          }

          if (field.streams.length > 0) {
            let localFieldIndex = -1;
            for (const selectedStream of field.streams) {
              localFieldIndex = localStreamFields?.[
                searchObj.organizationIdentifier + "_" + selectedStream
              ]?.indexOf(field.name);
              if (localFieldIndex > -1) {
                localStreamFields[
                  searchObj.organizationIdentifier + "_" + selectedStream
                ].splice(localFieldIndex, 1);
              }

              // If the field is in the default interesting fields, add it to the deselect list
              const deselectField =
                localStreamFields?.[
                  "deselect" +
                    "_" +
                    searchObj.organizationIdentifier +
                    "_" +
                    selectedStream
                ] || [];
              if (
                defaultInterestingFields.has(field.name) &&
                !deselectField.includes(field.name)
              ) {
                localStreamFields[
                  "deselect" +
                    "_" +
                    searchObj.organizationIdentifier +
                    "_" +
                    selectedStream
                ] = [...deselectField, field.name];
              }
            }
          }

          // If no interesting fields are selected, show all fields
          if (!searchObj.data.stream.interestingFieldList.length)
            showOnlyInterestingFields.value = false;

          useLocalInterestingFields(localStreamFields);
        }
      } else {
        const index = searchObj.data.stream.interestingFieldList.indexOf(
          field.name,
        );
        if (index == -1 && field.name != "*") {
          searchObj.data.stream.interestingFieldList.push(field.name);

          const localInterestingFields: any = useLocalInterestingFields();
          field.isInterestingField = !isInterestingField;
          fieldIndex = streamSchemaFieldsIndexMapping.value[field.name];
          if (fieldIndex > -1) {
            searchObj.data.stream.selectedStreamFields[
              fieldIndex
            ].isInterestingField = !isInterestingField;
            fieldIndex = -1;
          }

          let localStreamFields: any = {};
          if (localInterestingFields.value != null) {
            localStreamFields = localInterestingFields.value;
          }
          if (field.streams.length > 0) {
            for (const selectedStream of field.streams) {
              if (selectedStream != undefined) {
                if (
                  localStreamFields[
                    searchObj.organizationIdentifier + "_" + selectedStream
                  ] == undefined
                ) {
                  localStreamFields[
                    searchObj.organizationIdentifier + "_" + selectedStream
                  ] = [];
                }

                // If the field is not in the local stream fields and is not the timestamp column, add it to the local stream fields
                // As timestamp column is default interesting field, we don't need to add it to the local stream fields
                if (
                  localStreamFields[
                    searchObj.organizationIdentifier + "_" + selectedStream
                  ]?.indexOf(field.name) == -1 &&
                  field.name !== store.state.zoConfig?.timestamp_column &&
                  !defaultInterestingFields.has(field.name)
                ) {
                  localStreamFields[
                    searchObj.organizationIdentifier + "_" + selectedStream
                  ].push(field.name);
                }

                // If the field is in the deselect list, remove it from the local stream fields
                const isFieldDeselected = new Set(
                  localStreamFields?.[
                    "deselect" +
                      "_" +
                      searchObj.organizationIdentifier +
                      "_" +
                      selectedStream
                  ] || [],
                ).has(field.name);

                if (
                  defaultInterestingFields.has(field.name) &&
                  isFieldDeselected
                ) {
                  localStreamFields[
                    "deselect" +
                      "_" +
                      searchObj.organizationIdentifier +
                      "_" +
                      selectedStream
                  ] = localStreamFields[
                    "deselect" +
                      "_" +
                      searchObj.organizationIdentifier +
                      "_" +
                      selectedStream
                  ].filter((item: any) => item !== field.name);
                }
              }
            }
          }
          useLocalInterestingFields(localStreamFields);
          addInterestingFieldToSelectedStreamFields(field);
        }
      }

      emit("setInterestingFieldInSQLQuery", field, isInterestingField);
    };

    const addInterestingFieldToSelectedStreamFields = (field: any) => {
      const defaultFields = [
        store.state.zoConfig?.timestamp_column,
        store.state.zoConfig?.all_fields_name,
      ];

      let expandKeys = Object.keys(searchObj.data.stream.expandGroupRows);

      let index = 0;
      for (const key of expandKeys) {
        if (Object.keys(expandKeys).length > 1) index += 1;

        if (key === field.group) break;
        index =
          index +
          searchObj.data.stream.interestingExpandedGroupRowsFieldCount[key];
      }

      // Add the field to the beginning of the array, add all after timestamp column if timestamp column is present
      if (field.name === store.state.zoConfig?.timestamp_column) {
        searchObj.data.stream.selectedInterestingStreamFields.splice(
          index,
          0,
          field,
        );
      } else {
        searchObj.data.stream.selectedInterestingStreamFields.splice(
          index +
            searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
              field.group
            ],
          0,
          field,
        );
      }

      searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
        field.group
      ] =
        searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
          field.group
        ] + 1;
    };

    const toggleSchema = async (newValue: string) => {
      // Update the schema type with the new value from the toggle
      searchObj.meta.useUserDefinedSchemas = newValue;

      // Reset pagination to page 1 before resetting fields
      resetPagination();

      const isInterestingFields =
        searchObj.meta.useUserDefinedSchemas === "interesting_fields";

      if (isInterestingFields) {
        showOnlyInterestingFields.value = true;
      } else {
        showOnlyInterestingFields.value = false;
      }

      await resetFields();
    };

    const toggleInterestingFields = (newValue: boolean) => {
      // Update the interesting fields toggle with the new value
      showOnlyInterestingFields.value = newValue;

      // Reset pagination to page 1 before resetting fields
      resetPagination();
      resetFields();
    };

    const toggleFieldGroup = (group: string) => {
      searchObj.data.stream.expandGroupRows[group] =
        !searchObj.data.stream.expandGroupRows[group];
      // Reset to page 1 so the table recalculates page count from the new row total
      pagination.value = { ...pagination.value, page: 1 };
    };

    const hasUserDefinedSchemas = () => {
      return searchObj.data.stream.selectedStream.some((stream: any) => {
        store.state.zoConfig.user_defined_schemas_enabled &&
          searchObj.meta.useUserDefinedSchemas == "user_defined_schema" &&
          stream.settings.hasOwnProperty("defined_schema_fields") &&
          (stream.settings?.defined_schema_fields?.slice() || []) > 0;
      });
    };

    const sortedStreamFields = () => {
      return searchObj.data.stream.selectedStreamFields.sort(
        (a: any, b: any) => a.group - b.group,
      );
    };

    const placeHolderText = computed(() => {
      return searchObj.data.stream?.selectedStream?.length === 0
        ? t("search.selectStream")
        : "";
    });

    // ----- WebSocket Implementation -----

    const fetchValuesWithWebsocket = (payload: any) => {
      const fieldName = payload.fields[0];
      const streamName = payload.stream_name;

      // Pre-allocate the stream slot on fresh loads (skip on "load more"
      // so existing per-stream values survive until replaced by new data).
      const isLoadMore =
        (fieldValuesFinalizedValues.value[fieldName]?.length || 0) > 0;
      if (
        !isLoadMore &&
        fieldName &&
        streamName &&
        streamFieldValues.value[fieldName]
      )
        streamFieldValues.value[fieldName][streamName] = { values: [] };

      const wsPayload = {
        queryReq: payload,
        type: "values",
        isPagination: false,
        traceId: generateTraceContext().traceId,
        org_id: searchObj.organizationIdentifier,
        meta: payload,
      };
      initializeWebSocketConnection(wsPayload);

      addTraceId(payload.fields[0], wsPayload.traceId);
    };

    const initializeWebSocketConnection = (payload: any) => {
      // if (isStreamingEnabled(store.state)) {
      fetchQueryDataWithHttpStream(payload, {
        data: handleSearchResponse,
        error: handleSearchError,
        complete: handleSearchClose,
        reset: handleSearchReset,
      });
      return;
      // }
    };

    const sendSearchMessage = (queryReq: any) => {
      const payload = {
        type: "values",
        content: {
          trace_id: queryReq.traceId,
          payload: queryReq.queryReq,
          stream_type: searchObj.data.stream.streamType,
          search_type: "ui",
          use_cache: (window as any).use_cache ?? true,
          org_id: searchObj.organizationIdentifier,
        },
      };

      if (
        Object.hasOwn(queryReq.queryReq, "regions") &&
        Object.hasOwn(queryReq.queryReq, "clusters")
      ) {
        payload.content.payload["regions"] = queryReq.queryReq.regions;
        payload.content.payload["clusters"] = queryReq.queryReq.clusters;
      }

      sendSearchMessageBasedOnRequestId(payload);
    };

    const handleSearchClose = (payload: any, response: any) => {
      // Disable the loading indicator
      if (fieldValues.value[payload.queryReq.fields[0]]) {
        fieldValues.value[payload.queryReq.fields[0]].isLoading = false;
      }

      //TODO Omkar: Remove the duplicate error codes, are present same in useSearchWebSocket.ts
      const errorCodes = [1001, 1006, 1010, 1011, 1012, 1013];

      if (errorCodes.includes(response.code)) {
        handleSearchError(payload, {
          content: {
            message: t("logs.indexList.websocketTerminated"),
            trace_id: payload.traceId,
            code: response.code,
            error_detail: "",
          },
          type: "error",
        });
      }

      removeTraceId(payload.queryReq.fields[0], payload.traceId);
    };

    const handleSearchError = (request: any, err: any) => {
      if (fieldValues.value[request.queryReq?.fields[0]]) {
        fieldValues.value[request.queryReq.fields[0]].isLoading = false;
        fieldValues.value[request.queryReq.fields[0]].errMsg =
          t("logs.indexList.failedToFetchFieldValues");
      }

      removeTraceId(request.queryReq.fields[0], request.traceId);
    };

    const handleSearchResponse = (payload: any, response: any) => {
      const fieldName = payload?.queryReq?.fields[0];
      const streamName = payload?.queryReq?.stream_name;
      // Per-page count is always query_values_default_num regardless of the
      // total `size` sent (which equals from + pageSize for paginated requests).
      const pageSize = store.state.zoConfig?.query_values_default_num || 10;

      try {
        // We don't need to handle search_response_metadata
        if (response.type === "cancel_response") {
          removeTraceId(payload.queryReq.fields[0], response.content.trace_id);
          return;
        }

        if (response.type !== "search_response_hits") {
          return;
        }

        // Initialize if not exists
        if (!fieldValues.value[fieldName]) {
          fieldValues.value[fieldName] = {
            values: [],
            isLoading: false,
            errMsg: "",
            hasMore: false,
          };
        }

        // Initialize stream-specific values if not exists
        if (!streamFieldValues.value[fieldName]) {
          streamFieldValues.value[fieldName] = {};
        }

        if (!streamFieldValues.value[fieldName][streamName])
          streamFieldValues.value[fieldName][streamName] = {
            values: [],
          };

        // Process the results
        if (response.content.results.hits.length) {
          // Collect values from this response chunk
          const streamValues: { key: string; count: number }[] = [];

          response.content.results.hits.forEach((item: any) => {
            item.values.forEach((subItem: any) => {
              streamValues.push({
                key: subItem.zo_sql_key,
                count: parseInt(subItem.zo_sql_num),
              });
            });
          });

          // [NEW] Background capture into IndexedDB — does not block return
          if (streamValues.length > 0 && fieldName) {
            captureFromValuesApi(
              {
                org: store.state.selectedOrganization.identifier,
                streamType: searchObj.data.stream.streamType ?? "logs",
                streamName: streamName ?? "",
              },
              fieldName,
              streamValues,
            );
          }

          // The backend returns the full cumulative result set (from rank 0
          // to from+size), so always replace per-stream values.
          streamFieldValues.value[fieldName][streamName].values = streamValues;

          // Aggregate values across all streams
          const aggregatedValues: { [key: string]: number } = {};

          Object.keys(streamFieldValues.value[fieldName]).forEach((stream) => {
            streamFieldValues.value[fieldName][stream].values.forEach(
              (value) => {
                if (aggregatedValues[value.key]) {
                  aggregatedValues[value.key] += value.count;
                } else {
                  aggregatedValues[value.key] = value.count;
                }
              },
            );
          });

          // Convert aggregated values to array and sort by count descending
          const aggregatedArray = Object.keys(aggregatedValues).map((key) => ({
            key,
            count: aggregatedValues[key],
          }));
          aggregatedArray.sort((a, b) => b.count - a.count);

          // Merge with finalized values from previous pages.
          const finalized = fieldValuesFinalizedValues.value[fieldName] || [];
          const currentSize =
            fieldValuesCurrentSize.value[fieldName] || pageSize;

          if (finalized.length > 0) {
            const finalizedKeys = new Set(finalized.map((v) => v.key));
            const merged = [...finalized];
            for (const item of aggregatedArray) {
              if (!finalizedKeys.has(item.key)) {
                merged.push(item);
              }
            }
            merged.sort((a, b) => b.count - a.count);
            fieldValues.value[fieldName].values = merged;
          } else {
            fieldValues.value[fieldName].values = aggregatedArray;
          }

          fieldValues.value[fieldName].hasMore =
            aggregatedArray.length >= currentSize;
        }

        // Mark as not loading
        fieldValues.value[fieldName].isLoading = false;
      } catch (error) {
        console.error("Failed to fetch field values:", error);
        fieldValues.value[fieldName].errMsg = t("logs.indexList.failedToFetchFieldValues");
        fieldValues.value[fieldName].isLoading = false;
      }
    };

    const resetFieldValues = (
      fieldName: string,
      isLoading: boolean = false,
    ) => {
      // Reset the main fieldValues state
      fieldValues.value[fieldName] = {
        values: [],
        isLoading,
        errMsg: "",
        hasMore: false,
      };

      // Reset the streamFieldValues state for this field
      streamFieldValues.value[fieldName] = {};
      delete fieldValuesFinalizedValues.value[fieldName];
    };

    const handleSearchReset = (data: any) => {
      const fieldName = data.payload.queryReq.fields[0];

      resetFieldValues(fieldName, true);
      traceIdMapper.value[fieldName] = [];

      fetchValuesWithWebsocket(data.payload.queryReq);
    };

    const addTraceId = (field: string, traceId: string) => {
      if (!traceIdMapper.value[field]) {
        traceIdMapper.value[field] = [];
      }

      traceIdMapper.value[field].push(traceId);
    };

    const removeTraceId = (field: string, traceId: string) => {
      if (traceIdMapper.value[field]) {
        traceIdMapper.value[field] = traceIdMapper.value[field].filter(
          (id) => id !== traceId,
        );
      }
    };

    const cancelFilterCreator = (row: any) => {
      // Abort the in-flight HTTP-stream values request so collapsing actually
      // cancels a slow fetch, then clear local state.
      expandedFields.value[row.name] = false;
      cancelTraceId(row.name);
      cancelValueApi(row.name);
      if (fieldValues.value[row.name]) {
        fieldValues.value[row.name].isLoading = false;
      }
      delete lastFieldFetchPayloads.value[row.name];
      delete cachedFieldValues.value[row.name];
      delete cachedStreamFieldValues.value[row.name];
      delete fieldValuesCurrentSize.value[row.name];
      delete fieldValuesFinalizedValues.value[row.name];
      delete fieldValuesTimeRange.value[row.name];
    };

    const cancelTraceId = (field: string) => {
      // Field values stream over fetchQueryDataWithHttpStream, so abort via the
      // HTTP-stream cancel (cancelStreamQueryBasedOnRequestId), not the WebSocket one.
      const traceIds = traceIdMapper.value[field];
      if (traceIds?.length) {
        traceIds.forEach((traceId) =>
          cancelStreamQueryBasedOnRequestId({
            trace_id: traceId,
            org_id: store?.state?.selectedOrganization?.identifier,
          }),
        );
        traceIdMapper.value[field] = [];
      }
    };

    const cancelValueApi = (value: string) => {
      //remove the field from the openedFilterFields
      openedFilterFields.value = openedFilterFields.value.filter(
        (field: string) => field !== value,
      );
    };

    const getValuesPartition = async (
      start: number,
      end: number,
      name: string,
      queryToBeSent: string,
    ) => {
      try {
        const queryReq = {
          sql: queryToBeSent,
          start_time: start,
          end_time: end,
          // streaming_output: true,
        };
        const res = await searchService.partition({
          org_identifier: store.state.selectedOrganization.identifier,
          query: queryReq,
          page_type: searchObj.data.stream.streamType,
          traceparent: generateTraceContext().traceId,
          enable_align_histogram: true,
        });

        return res;
      } catch (err) {
        console.error("Failed to fetch field values:", err);
        fieldValues.value[name].errMsg = t("logs.indexList.failedToFetchFieldValues");
      }
    };

    const onPaginationUpdate = (newPagination: {
      page: number;
      rowsPerPage: number;
    }) => {
      // When extractFields() temporarily clears the field list, the table
      // recalculates pages and emits page=1.  Ignore that automatic
      // reset while the stream fields are still loading so the user stays on
      // their current page after the query completes.
      if (
        (searchObj as any).loadingStream &&
        newPagination.page === 1 &&
        pagination.value.page !== 1
      ) {
        return;
      }
      pagination.value = newPagination;
    };

    const setPage = (page) => {
      pagination.value = { ...pagination.value, page };
    };

    return {
      t,
      store,
      router,
      searchObj,
      streamOptions,
      filterFieldFn,
      addToFilter,
      clickFieldFn,
      addMultipleSearchTerms,
      removeFieldFilter,
      searchFieldValues,
      loadMoreFieldValues,
      getImageURL,
      filterStreamFn,
      openFilterCreator,
      addSearchTerm,
      fieldValues,
      onStreamTypeChange,
      "add": "add",
      "visibility-off": "visibility-off",
      "visibility": "visibility",
      handleQueryData,
      onStreamChange,
      addToInterestingFieldList,
      extractFields,
      userDefinedSchemaBtnGroupOption,
      selectedFieldsBtnGroupOption,
      pagination,
      onPaginationUpdate,
      toggleSchema,
      toggleInterestingFields,
      fieldListRef,
      streamSelect,
      toggleFieldGroup,
      streamFieldsRows: computed(() => {
        const source = showOnlyInterestingFields.value
          ? searchObj.data.stream.selectedInterestingStreamFields
          : searchObj.data.stream.selectedStreamFields;

        if (!source?.length) return source;

        return source.map((row: any) => ({
          ...row,
          isGroup: !!row.label,
          groupName: row.label ? row.name : (row.group || row.name),
          stream: row.group || row.name,
        }));
      }),

      totalFieldsCount: computed(() =>
        searchObj.data.stream.selectedStream.length > 1
          ? searchObj.data.stream.selectedStreamFields.length -
            (searchObj.data.stream.selectedStream.length + 1)
          : searchObj.data.stream.selectedStreamFields.length,
      ),
      formatLargeNumber,
      sortedStreamFields,
      placeHolderText,
      cancelTraceId,
      cancelFilterCreator,
      selectedStream,
      getFilterExpressionByFieldType,
      addTraceId,
      removeTraceId,
      traceIdMapper,
      checkSelectedFields,
      resetSelectedFileds,
      getPageNumbers,
      handleSearchResponse,
      handleSearchReset,
      showOnlyInterestingFields,
      showUserDefinedSchemaToggle,
      // Additional functions exposed for testing
      resetFields,
      sendSearchMessage,
      handleSearchClose,
      handleSearchError,
      fetchValuesWithWebsocket,
      initializeWebSocketConnection,
      cancelValueApi,
      getValuesPartition,
      streamList,
      quickPickStreams,
      hasUserDefinedSchemas,
      setPage,
      resetPagination,
      removeFieldFromWhereAST,
      activeIncludeFilterValues,
      activeExcludeFilterValues,
      expandedFields,
      showFtsFieldValues,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:o2-table): `.logs-index-menu` and both `.index-table` divs are
   this component's own template, but the tbody/tr/td they lay out are OTable's
   internal render (via GroupedFieldList) and `.schema-field-toggle` is
   FieldListPagination's DOM — child DOM this owner can only reach with :deep().
   The `.logs-index-menu` ancestor is kept so the selectors match at their original
   specificity. */
.logs-index-menu .index-table {
  width: 100%;
  height: calc(100% - 2.5rem);
}

.logs-index-menu .index-table :deep(tr) {
  margin-bottom: 1px;
}

.logs-index-menu .index-table :deep(tbody),
.logs-index-menu .index-table :deep(tr),
.logs-index-menu .index-table :deep(td) {
  width: 100%;
  display: block;
  height: fit-content;
  overflow: hidden;
}

.logs-index-menu .index-table :deep(.schema-field-toggle) {
  border: 1px solid var(--color-card-glass-border);
  border-radius: 0.325rem;
  background-color: transparent;
  line-height: 0.625rem;
}
</style>
