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
  <div class="tw:flex tw:flex-col index-menu tw:p-[0.375rem]! tw:bg-surface-panel!">
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
          <div class="tw:p-2">{{ t("search.noResult") }}</div>
        </template>
    </OSelect>
    <div
      class="index-table tw:h-[calc(100%-2rem)]!"
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
                    class="tw:flex tw:justify-center tw:py-[0.5rem]"
                  >
                    <OSpinner size="xs" />
                  </div>
                  <template v-else-if="hasDurationPercentiles">
                    <div
                      v-for="p in PERCENTILE_LABELS"
                      :key="p.key"
                      class="tw:flex tw:items-center tw:justify-between tw:py-[0.15rem] tw:pl-[0.5rem]"
                    >
                      <span class="tw:text-[0.75rem] tw:w-[2rem] tw:shrink-0">{{ p.label }}</span>
                      <span class="tw:text-[0.75rem] tw:flex-1 tw:text-right tw:pr-[0.25rem]">
                        {{ formatTimeWithSuffix(durationPercentiles[p.key]) }}
                      </span>
                      <div class="tw:flex tw:w-[3rem]">
                        <OButton
                          v-if="p.key !== 'max'"
                          variant="ghost"
                          size="icon-xs-circle"
                          :title="`duration >= ${formatTimeWithSuffix(durationPercentiles[p.key])}`"
                          @click.stop="addSearchTerm(`duration>='${formatTimeWithSuffix(durationPercentiles[p.key])}'`)"
                          class="o2-custom-button-hover tw:ml-[0.25rem]! tw:border! tw:border-[var(--o2-border-color)]!"
                        >
                          <OIcon name="arrow-forward-ios" size="sm" class="tw:h-[0.5rem]! tw:w-[0.5rem]!" />
                        </OButton>
                        <OButton
                          variant="ghost"
                          size="icon-xs-circle"
                          :title="`duration <= ${formatTimeWithSuffix(durationPercentiles[p.key])}`"
                          @click.stop="addSearchTerm(`duration<='${formatTimeWithSuffix(durationPercentiles[p.key])}'`)"
                          class="o2-custom-button-hover tw:mr-[0.625rem]! tw:border! tw:border-[var(--o2-border-color)]! tw:ml-auto!"
                        >
                          <OIcon name="arrow-back-ios" size="sm" class="tw:h-[0.5rem]! tw:w-[0.5rem]!" />
                        </OButton>
                      </div>
                    </div>
                  </template>
                  <div v-else class="tw:pl-3 tw:py-1 tw:text-sm tw:font-medium">
                    {{ durationPercentileErrMsg || "No values found" }}
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
            class="tw:flex tw:items-center tw:justify-center tw:w-full tw:pt-[2rem]"
          >
            <div
              class="tw:text-sm tw:font-medium text-weight-bold tw:w-fit tw:mx-auto tw:my-0 tw:flex-col tw:justify-items-center"
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
import useTraces, { DEFAULT_TRACE_COLUMNS } from "../../composables/useTraces";
import { getImageURL, b64EncodeUnicode, b64DecodeUnicode, formatTimeWithSuffix } from "../../utils/zincutils";
import FieldRow from "@/components/common/FieldRow.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import useFieldValuesStream from "@/composables/useFieldValuesStream";
import useDurationPercentiles, { parseDurationWhereClause } from "@/composables/useDurationPercentiles";
import useParser from "@/composables/useParser";
import { SPAN_KIND_MAP, parseSpanKindWhereClause } from "@/utils/traces/constants";
import { removeFieldFromWhereAST, logsUtils } from "@/composables/useLogs/logsUtils";

export default defineComponent({
  name: "ComponentSearchIndexSelect",
  components: {
    FieldRow,
    OButton,
    OSelect,
    OInput,
    OSpinner,
    OIcon,
    GroupedFieldList: defineAsyncComponent(
      () => import("@/components/common/GroupedFieldList.vue"),
    ),
    FieldListPagination: defineAsyncComponent(
      () => import("@/components/common/FieldListPagination.vue"),
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
    const { searchObj } = useTraces();
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

    const onStreamChange = (selectedValue: string | null) => {
      const stream = selectedValue
        ? searchObj.data.stream.streamLists.find((s: any) => s.value === selectedValue) ?? null
        : null;
      searchObj.data.stream.selectedStream = stream;
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

    const sqlParser = ref<any>(null);

    onMounted(async () => {
      const { sqlParser: loadSqlParser } = useParser();
      sqlParser.value = await loadSqlParser();
    });

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

    const expandedFields = ref<Record<string, boolean>>({});
    const fieldValuesCurrentFrom = ref<Record<string, number>>({});
    const fieldValuesCurrentKeyword = ref<Record<string, string>>({});

    const { fnParsedSQL, fnUnparsedSQL } = logsUtils();

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
        sqlParser.value,
        searchObj.data.stream.selectedStream.value,
      );
      if (typeof durationParseResult === "string") {
        whereClause = durationParseResult;
      }

      whereClause = parseSpanKindWhereClause(
        whereClause,
        sqlParser.value,
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
        const decodedSql = b64DecodeUnicode(buildFieldValuesSql(field.name));
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
      getValueMapper,
    };
  },
});
</script>

<style lang="scss" scoped>
.index-menu {
  width: 100%;

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

  .index-table {
    width: 100%;

    :deep(table) {
      display: table;
      table-layout: fixed !important;
    }

    :deep(thead) {
      display: none;
    }

    :deep(tr) {
      margin-bottom: 1px;
    }

    :deep(tbody),
    :deep(tr),
    :deep(td) {
      width: 100%;
      display: block;
      height: fit-content;
      overflow: hidden;
    }

    :deep(.q-table__control),
    label.q-field {
      width: 100%;
    }

    :deep(thead tr),
    :deep(tbody td) {
      height: auto;
    }
  }

  .field_list {
    padding: 0px;
    margin-bottom: 0.125rem;
    position: relative;
    overflow: visible;
    cursor: default;

    &.field-group-header {
      font-weight: 600;
      font-size: 0.75rem;
      padding: 0.25rem 0.325rem;
    }

    .field_label {
      pointer-events: none;
      font-size: 0.825rem;
      position: relative;
      display: inline;
      z-index: 2;
      left: 0;
      // text-transform: capitalize;
    }

    .field-container {
      height: 25px;
    }

    .field_overlay {
      position: absolute;
      height: 100%;
      right: 0;
      top: 0;
      z-index: 5;
      padding: 0 6px;
      visibility: hidden;
      display: flex;
      align-items: center;
}

    &.selected {
      .field_overlay {
        background-color: var(--o2-hover-accent);

        .field_icons {
          opacity: 0;
        }
      }
    }
    // &:hover {
    //   .field-container {
    //     background-color: #e8e8e8;
    //   }
    //   body.body--dark {
    //     .field-container {
    //       background-color: #424242;
    //     }
    //   }
    // }
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
.q-field--dense .q-field__control,
.q-field--dense .q-field__marginal {
  height: 34px;
}
</style>

<style lang="scss">
.index-table {
  table {
    width: 100%;
    table-layout: fixed;

    .q-expansion-item {
      .q-item-type {
        &:hover {
          .field_overlay {
            visibility: visible;
}
        }
      }
      .field-expansion-icon {
        img {
          width: 12px;
          height: 12px;
        }
      }
    }

    .field-container {
      &:hover {
        .field_overlay {
          visibility: visible;
}
      }
    }

    .field_list {
      &.selected {
        background-color: var(--o2-hover-accent);

        .field_overlay {
          // background-color: #ffffff;
        }
      }
    }
  }
}
</style>
