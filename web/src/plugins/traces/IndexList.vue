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
  <div class="flex flex-col w-full index-menu py-1.5! bg-surface-panel!">
    <!-- Stream selector sits on the same page-edge rail inset as the field list below it. -->
    <div class="px-page-edge">
      <OSelect
        data-test="log-search-index-list-select-stream"
        :model-value="searchObj.data.stream.selectedStream?.value ?? null"
        :label="
          searchObj.data.stream.selectedStream?.label
            ? ''
            : t('search.selectIndex')
        "
        :options="streamOptions"
        data-cy="index-dropdown"
        @search="onStreamSearch"
        @update:model-value="onStreamChange"
      >
        <template #empty>
          <div class="p-2">{{ t("search.noResult") }}</div>
        </template>
      </OSelect>
    </div>
    <div
      class="index-table h-[calc(100%-2rem)]! w-full"
      data-test="log-search-index-list-fields-table"
    >
      <GroupedFieldList
        ref="fieldListRef"
        :fields="normalizedFieldList"
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
            :show-quick-mode="false"
            :show-visibility-toggle="row.enableVisibility"
            @add-to-filter="addToFilter(`${row.name}=''`)"
            @toggle-field="toggleField"
          >
            <template #expansion="{ field }">
              <FieldExpansion
                :field="field"
                :field-values="fieldValues[field.name]"
                :active-include-values="activeIncludeFieldValues?.[field.name] ?? []"
                :active-exclude-values="activeExcludeFieldValues?.[field.name] ?? []"
                :expanded="expandedFields?.[field.name] ?? false"
                :selected-fields="searchObj.data.stream.selectedFields"
                :theme="store.state.theme"
                :show-visibility-toggle="row.enableVisibility"
                :show-filter-icon="true"
                :show-quick-mode="false"
                :default-values-count="defaultValuesCount"
                :value-mapper="getValueMapper(field.name)"
                @add-to-filter="(val: string) => addSearchTerm(val)"
                @toggle-field="toggleField"
                @add-search-term="handleAddSearchTerm"
                @add-multiple-search-terms="handleAddMultipleSearchTerms"
                @remove-field-filter="(fieldName: string) => searchObj.data.stream.removeFilterField = fieldName"
                @search-field-values="handleSearchFieldValues"
                @load-more-values="handleLoadMoreValues"
                @before-show="openFilterCreator"
                @before-hide="cancelFilterCreator"
              >
                <template v-if="field.name === 'duration'" #body>
                  <div
                    v-if="durationPercentilesLoading"
                    class="flex justify-center py-2"
                  >
                    <OSpinner size="xs" />
                  </div>
                  <template v-else-if="hasDurationPercentiles">
                    <div
                      v-for="p in PERCENTILE_LABELS"
                      :key="p.key"
                      class="flex items-center justify-between py-[0.15rem] pl-2"
                    >
                      <span class="text-xs w-8 shrink-0">{{ p.label }}</span>
                      <span class="text-xs flex-1 text-right pr-1">
                        {{ formatPercentile(durationPercentiles[p.key]) }}
                      </span>
                      <div class="flex w-12">
                        <OButton
                          v-if="p.key !== 'max'"
                          variant="ghost"
                          size="icon-xs-circle"
                          :title="`duration >= ${formatPercentile(durationPercentiles[p.key])}`"
                          @click.stop="addSearchTerm(`duration>='${formatPercentile(durationPercentiles[p.key])}'`)"
                          class="o2-custom-button-hover ml-1! border! border-card-glass-border!"
                        >
                          <OIcon name="arrow-forward-ios" size="sm" class="h-2! w-2!" />
                        </OButton>
                        <OButton
                          variant="ghost"
                          size="icon-xs-circle"
                          :title="`duration <= ${formatPercentile(durationPercentiles[p.key])}`"
                          @click.stop="addSearchTerm(`duration<='${formatPercentile(durationPercentiles[p.key])}'`)"
                          class="o2-custom-button-hover mr-2.5! border! border-card-glass-border! ml-auto!"
                        >
                          <OIcon name="arrow-back-ios" size="sm" class="h-2! w-2!" />
                        </OButton>
                      </div>
                    </div>
                  </template>
                  <div v-else class="pl-3 py-1 text-sm font-medium">
                    {{ durationPercentileErrMsg || t('traces.indexList.noValuesFound') }}
                  </div>
                </template>
              </FieldExpansion>
            </template>
          </FieldRow>
        </template>

        <template #after-list="bottomProps">
          <GroupedFieldListPagination
            data-test-prefix="traces-page"
            :current-page="bottomProps.currentPage"
            :pages-number="bottomProps.totalPages"
            :is-first-page="bottomProps.isFirstPage"
            :is-last-page="bottomProps.isLastPage"
            :total-fields-count="totalFieldsCount"
            @first-page="bottomProps.firstPage()"
            @last-page="bottomProps.lastPage()"
            @set-page="setPage"
            @reset-fields="resetSelectedFields"
          />
        </template>

        <template #loading>
          <div
            class="flex items-center justify-center w-full pt-8"
          >
            <div
              class="text-sm font-medium w-fit mx-auto my-0 flex items-center gap-1.5"
            >
              <OSpinner size="sm" />
              {{ t("traces.loadingStream") }}
            </div>
          </div>
        </template>
      </GroupedFieldList>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, defineAsyncComponent, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useTraces, { DEFAULT_TRACE_COLUMNS } from "@/composables/useTraces";
import { getImageURL, b64EncodeUnicode, b64DecodeUnicode, formatTimeWithSuffix } from "../../utils/zincutils";
import FieldRow from "@/components/common/FieldRow.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import useFieldValuesStream from "@/composables/useFieldValuesStream";
import useDurationPercentiles, { parseDurationWhereClause } from "@/composables/useDurationPercentiles";
import { SPAN_KIND_MAP, parseSpanKindWhereClause } from "@/utils/traces/constants";
import { logsUtils } from "@/composables/useLogs/logsUtils";

export default defineComponent({
  name: "ComponentSearchIndexSelect",
  components: {
    FieldRow,
    OButton,
    OSelect,
    OSpinner,
    OIcon,
    GroupedFieldList: defineAsyncComponent(
      () => import("@/components/common/GroupedFieldList.vue"),
    ),
    GroupedFieldListPagination: defineAsyncComponent(
      () => import("@/components/common/FieldListPagination.vue"),
    ),
    FieldExpansion: defineAsyncComponent(
      () => import("@/components/common/FieldExpansion.vue"),
    ),
},
  emits: ["update:changeStream", "update:selectedFields"],
  props: {
    fieldList: {
      type: Array,
      default: () => [],
    },
    activeIncludeFieldValues: {
      type: Object as () => Record<string, string[]>,
      default: () => ({}),
    },
    activeExcludeFieldValues: {
      type: Object as () => Record<string, string[]>,
      default: () => ({}),
    },
  },
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const { searchObj, tracesParser } = useTraces();
    const streamOptions: any = ref(searchObj.data.stream.streamLists);

    const pagination = ref({
      page: 1,
      rowsPerPage: 25,
    });

    const fieldListRef = ref<HTMLElement | null>(null);

    const duration = ref({
      slider: {
        min: 0,
        max: 0,
      },
      input: {
        min: 0,
        max: 100000,
      },
    });

    const showFtsFieldValues = computed(
      () => store.state.zoConfig?.show_fts_field_values ?? false,
    );

    const fnMarkerLabel = computed(() => {
      const markers = [];
      const diffDuration =
        duration.value.slider.max - duration.value.slider.min;
      const step = diffDuration / 4;
      for (let i = 0; i < 5; i++) {
        markers.push({
          label: `${Math.round(duration.value.slider.min + step * i)}ms`,
          value: duration.value.slider.min + step * i,
        });
      }
      return markers;
    });

    const filterStreamFn = (val: string, update: any) => {
      update(() => {
        streamOptions.value = searchObj.data.stream.streamLists;
        const needle = val.toLowerCase();
        streamOptions.value = streamOptions.value.filter(
          (v: any) => v.label.toLowerCase().indexOf(needle) > -1,
        );
      });
    };


    const addToFilter = (field: any) => {
      searchObj.data.stream.addToFilter = field;
    };

    const addSearchTerm = (term: string) => {
      // searchObj.meta.showDetailTab = false;
      searchObj.data.stream.addToFilter = term;
    };

    const onStreamSearch = (val: string) => {
      streamOptions.value = searchObj.data.stream.streamLists;
      if (!val) return;
      const needle = val.toLowerCase();
      streamOptions.value = streamOptions.value.filter(
        (v: any) => v.label.toLowerCase().indexOf(needle) > -1,
      );
    };

    const onStreamChange = (selectedValue: SelectModelValue) => {
      const streamValue = typeof selectedValue === "string" ? selectedValue : null;
      const matched = streamValue
        ? searchObj.data.stream.streamLists.find(
            (s: any) => s.value === streamValue,
          )
        : undefined;
      // No match clears to the empty-stream sentinel (the codebase's "cleared"
      // convention everywhere else — resetSearchObj, SearchBar, Index).
      searchObj.data.stream.selectedStream = matched ?? {
        label: "",
        value: "",
      };
      searchObj.data.query = "";
      searchObj.data.editorValue = "";
      searchObj.data.resultGrid.currentPage = 0;
      emit("update:changeStream");
    };

    // Column ID "status" maps to stream field "span_status" — the only mismatch.
    const TRACES_LOCKED_FIELD_NAMES = new Set(
      [...DEFAULT_TRACE_COLUMNS.traces].map((id) =>
        id === "status" ? "span_status" : id,
      ),
    );

    const normalizedFieldList = computed(() =>
      (props.fieldList as any[]).map((f: any) => ({
        ...f,
        isGroup: !!f.label,
        groupName: f.label ? f.name : (f.group || f.name),
        stream: f.group || f.name,
        isSchemaField: f.label === true ? false : true,
        enableVisibility: f.label === true ? false : !TRACES_LOCKED_FIELD_NAMES.has(f.name),
      })),
    );

    const totalFieldsCount = computed(
      () => normalizedFieldList.value.filter((f: any) => !f.isGroup).length,
    );

    const setPage = (page: number) => {
      pagination.value = { ...pagination.value, page };
    };

    const resetSelectedFields = () => {
      searchObj.data.stream.selectedFields = [];
      emit("update:selectedFields", null);
    };

    // Reset to page 1 whenever the field search term changes
    watch(
      () => searchObj.data.stream.filterField,
      () => {
        pagination.value = { ...pagination.value, page: 1 };
      },
    );

    const isFieldEditable = (fieldName: string): boolean =>
      searchObj.meta.searchMode === "traces" &&
      !TRACES_LOCKED_FIELD_NAMES.has(fieldName);

    const toggleField = async (field: any) => {
      emit("update:selectedFields", field);
    };

    // -----------------------------------------------------------------------
    // Field value fetching (moved from BasicValuesFilter)
    // -----------------------------------------------------------------------

    const { fieldValues, fetchFieldValues, cancelFieldStream, resetFieldValues } =
      useFieldValuesStream();

    const {
      percentiles: durationPercentiles,
      isLoading: durationPercentilesLoading,
      fetchPercentiles,
      cancelFetch: cancelPercentileFetch,
      errMsg: durationPercentileErrMsg,
    } = useDurationPercentiles();

    const PERCENTILE_LABELS = [
      { key: "p25", label: "P25" },
      { key: "p50", label: "P50" },
      { key: "p75", label: "P75" },
      { key: "p95", label: "P95" },
      { key: "p99", label: "P99" },
      { key: "max", label: "Max" },
    ] as const;

    const hasDurationPercentiles = computed(() =>
      PERCENTILE_LABELS.some((p) => durationPercentiles.value[p.key] !== null),
    );

    const formatPercentile = (value: number | null) =>
      value === null ? "" : formatTimeWithSuffix(value);

    const expandedFields = ref<Record<string, boolean>>({});
    const fieldValuesCurrentFrom = ref<Record<string, number>>({});
    const fieldValuesCurrentKeyword = ref<Record<string, string>>({});

    logsUtils();

    const removeFieldFromWhereStr = (
      whereClause: string,
      fieldName: string,
    ): string => {
      const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const fieldPattern = new RegExp(`^"?${escaped}"?\\s*[=!<>]`, "i");
      const multiPattern = new RegExp(`^\\(\\s*"?${escaped}"?\\s*[=!<>]`, "i");
      const remaining = whereClause.split(/\s+AND\s+/i).filter((cond) => {
        const trimmed = cond.trim();
        return !fieldPattern.test(trimmed) && !multiPattern.test(trimmed);
      });
      return remaining.join(" AND ");
    };

    const buildFieldValuesSql = (fieldName: string): string => {
      const query = searchObj.data.editorValue;
      const parts = query.split("|");
      let whereClause = (parts.length > 1 ? parts[1] : parts[0]).trim();

      const durationParseResult = parseDurationWhereClause(
        whereClause,
        tracesParser.value,
        searchObj.data.stream.selectedStream.value,
      );
      if (typeof durationParseResult === "string") {
        whereClause = durationParseResult;
      }

      whereClause = parseSpanKindWhereClause(
        whereClause,
        tracesParser.value,
        searchObj.data.stream.selectedStream.value,
      );

      const streamName = searchObj.data.stream.selectedStream.value;
      let sql = `SELECT * FROM "${streamName}"`;

      if (whereClause !== "") {
        const filteredWhere = removeFieldFromWhereStr(whereClause, fieldName);
        if (filteredWhere.trim() !== "") {
          sql += ` WHERE ${filteredWhere}`;
        }
      }

      return b64EncodeUnicode(sql) || "";
    };

    const defaultValuesCount = computed(
      () => store.state.zoConfig?.query_values_default_num || 10,
    );

    const fetchFieldValuesData = (
      fieldName: string,
      from: number = 0,
      keyword: string = "",
    ) => {
      const fetchPayload: any = {
        fields: [fieldName],
        size: from + defaultValuesCount.value,
        from,
        no_count: false,
        start_time: searchObj.data.datetime.startTime,
        end_time: searchObj.data.datetime.endTime,
        stream_name: searchObj.data.stream.selectedStream.value,
        stream_type: "traces",
        sql: buildFieldValuesSql(fieldName),
        timeout: 30000,
        use_cache: (globalThis as any).use_cache ?? true,
      };

      if (keyword) {
        fetchPayload.keyword = keyword;
      }

      fetchFieldValues(fetchPayload);
    };

    const openFilterCreator = (event: any, field: any) => {
      if (field.ftsKey && !showFtsFieldValues.value) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }

      expandedFields.value[field.name] = true;

      if (field.name === "duration") {
        // buildFieldValuesSql emits valid base64, so the decode never hits its catch (undefined) path.
        const decodedSql = b64DecodeUnicode(buildFieldValuesSql(field.name))!;
        const whereMatch = decodedSql.match(/\bWHERE\b\s+([\s\S]+)$/i);
        fetchPercentiles({
          streamName: searchObj.data.stream.selectedStream.value,
          startTime: searchObj.data.datetime.startTime,
          endTime: searchObj.data.datetime.endTime,
          whereClause: whereMatch ? whereMatch[1].trim() : "",
        });
        return;
      }

      fieldValuesCurrentFrom.value[field.name] = 0;
      fieldValuesCurrentKeyword.value[field.name] = "";
      cancelFieldStream(field.name);
      resetFieldValues(field.name, true);
      fetchFieldValuesData(field.name, 0, "");
    };

    const handleSearchFieldValues = (fieldName: string, term: string) => {
      fieldValuesCurrentKeyword.value[fieldName] = term;
      fieldValuesCurrentFrom.value[fieldName] = 0;
      cancelFieldStream(fieldName);
      resetFieldValues(fieldName, true);
      fetchFieldValuesData(fieldName, 0, term);
    };

    const handleLoadMoreValues = (fieldName: string) => {
      const prevFrom = fieldValuesCurrentFrom.value[fieldName] ?? 0;
      const newFrom = prevFrom + defaultValuesCount.value;
      fieldValuesCurrentFrom.value[fieldName] = newFrom;
      fetchFieldValuesData(fieldName, newFrom, fieldValuesCurrentKeyword.value[fieldName] ?? "");
    };

    const handleAddSearchTerm = (
      fieldName: string,
      value: string,
      action: string,
    ) => {
      if (action === "include") {
        addSearchTerm(
          fieldName === "duration"
            ? `${fieldName}>=${value}`
            : `${fieldName}='${value}'`,
        );
      } else {
        addSearchTerm(
          fieldName === "duration"
            ? `${fieldName}<=${value}`
            : `${fieldName}!='${value}'`,
        );
      }
    };

    const handleAddMultipleSearchTerms = (
      fieldName: string,
      values: string[],
      action: string,
    ) => {
      const joinOp = action === "include" ? " or " : " and ";
      const expressions = values.map((v) =>
        action === "include" ? `${fieldName}='${v}'` : `${fieldName}!='${v}'`,
      );
      const combined =
        expressions.length > 1 ? `(${expressions.join(joinOp)})` : expressions[0];
      addSearchTerm(combined);
    };

    const cancelFilterCreator = (field: any) => {
      expandedFields.value[field.name] = false;
      if (field.name === "duration") {
        cancelPercentileFetch();
        return;
      }
      cancelFieldStream(field.name);
      resetFieldValues(field.name);
      delete fieldValuesCurrentFrom.value[field.name];
      delete fieldValuesCurrentKeyword.value[field.name];
    };

    // -----------------------------------------------------------------------
    // span_kind value mapper for common FieldExpansion
    // -----------------------------------------------------------------------

    const spanKindValueMapper = (values: { key: string; count: number }[]) =>
      values.map((v) => ({
        ...v,
        key:
          v.key === null || v.key === undefined || v.key === ""
            ? "Unspecified"
            : (SPAN_KIND_MAP[v.key] ?? v.key),
      }));

    const getValueMapper = (fieldName: string) =>
      fieldName === "span_kind" ? spanKindValueMapper : undefined;

    return {
      t,
      store,
      router,
      searchObj,
      streamOptions,
      addToFilter,
      getImageURL,
      filterStreamFn,
      onStreamSearch,
      addSearchTerm,
      fnMarkerLabel,
      duration,
      onStreamChange,
      showFtsFieldValues,
      normalizedFieldList,
      isFieldEditable,
      toggleField,
      TRACES_LOCKED_FIELD_NAMES,
      pagination,
      fieldListRef,
      totalFieldsCount,
      setPage,
      resetSelectedFields,
      // Field value fetching
      fieldValues,
      defaultValuesCount,
      expandedFields,
      openFilterCreator,
      handleSearchFieldValues,
      handleLoadMoreValues,
      handleAddSearchTerm,
      handleAddMultipleSearchTerms,
      cancelFilterCreator,
      // Duration percentiles
      durationPercentiles,
      durationPercentilesLoading,
      durationPercentileErrMsg,
      hasDurationPercentiles,
      PERCENTILE_LABELS,
      formatTimeWithSuffix,
      formatPercentile,
      getValueMapper,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:GroupedFieldList): fixed table-layout + block rows on the child
   OTable's <table>, and field-row label/overlay/container overrides on the child
   FieldRow DOM — reached through child components, so not expressible as utilities. */
.index-menu .index-table :deep(table) {
  display: table;
  table-layout: fixed !important;
}

.index-menu .index-table :deep(thead) {
  display: none;
}

.index-menu .index-table :deep(tr) {
  margin-bottom: 1px;
}

.index-menu .index-table :deep(tbody),
.index-menu .index-table :deep(tr),
.index-menu .index-table :deep(td) {
  width: 100%;
  display: block;
  height: fit-content;
  overflow: hidden;
}

.index-menu .index-table :deep(thead tr),
.index-menu .index-table :deep(tbody td) {
  height: auto;
}

.index-menu :deep(.field_list) {
  padding: 0;
  margin-bottom: 0.125rem;
  position: relative;
  overflow: visible;
  cursor: default;
}

/* Vertical padding only — the horizontal inset comes from OFieldList's group
   header (--spacing-page-edge) so this list lines up with the page header. */
.index-menu :deep(.field_list.field-group-header) {
  font-weight: 600;
  font-size: var(--text-xs);
  padding-block: 0.25rem;
}

.index-menu :deep(.field_list .field_label) {
  pointer-events: none;
  font-size: var(--text-compact);
  position: relative;
  display: inline;
  z-index: 2;
  left: 0;
}

.index-menu :deep(.field_list .field-container) {
  height: 1.5625rem;
}

.index-menu :deep(.field_list .field_overlay) {
  position: absolute;
  height: 100%;
  right: 0;
  top: 0;
  z-index: 5;
  padding: 0 0.375rem;
  visibility: hidden;
  display: flex;
  align-items: center;
}

.index-menu :deep(.field_list.selected .field_overlay) {
  background-color: var(--color-interactive-hover-bg);
}

.index-table :deep(table) {
  width: 100%;
  table-layout: fixed;
}

.index-table :deep(table .field-container:hover .field_overlay) {
  visibility: visible;
}

.index-table :deep(table .field_list.selected) {
  background-color: var(--color-interactive-hover-bg);
}
</style>
