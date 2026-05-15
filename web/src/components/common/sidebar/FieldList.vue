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
  <div class="column index-menu default-index-menu tw:h-full!">
    <div class="index-table logs-index-menu tw:h-full!">
      <q-table
        data-test="log-search-index-list-fields-table"
        :visible-columns="['name']"
        :rows="fields"
        row-key="name"
        :filter="filterFieldValue"
        :filter-method="filterFieldFn"
        v-model:pagination="pagination"
        :rows-per-page-options="[]"
        :hide-bottom="!showPagination"
        hide-header
        class="traces-field-table tw:h-full"
        id="tracesFieldList"
      >
        <template #body-cell-name="props">
          <q-tr :props="props">
            <q-td :props="props" class="field_list">
              <!-- Non-expandable field (ftsKey or no values to show) -->
              <div
                v-if="
                  (props.row.ftsKey && !showFtsFieldValues) ||
                  !props.row.showValues
                "
                class="field-container flex content-center ellipsis q-pr-sm"
                :title="props.row.name"
              >
                <div
                  class="field_label ellipsis tw:flex tw:items-center tw:pl-[1.2rem]"
                >
                  {{ props.row.name }}
                </div>
                <div
                  class="field_overlay tw:bg-[var(--o2-hover-accent)]! tw:rounded-[0.25rem]!"
                >
                  <OButton
                    variant="ghost"
                    size="icon-xs-circle"
                    :data-test="`log-search-index-list-filter-${props.row.name}-field-btn`"
                    @click.stop="addSearchTerm(`${props.row.name}=''`)"
                  >
                    <q-icon :name="outlinedAdd" />
                  </OButton>
                </div>
              </div>

              <!-- Expandable field -->
              <q-expansion-item
                v-else
                dense
                hide-expand-icon
                :label="props.row.name"
                @before-show="
                  (event: any) => {
                    expandedRows[props.row.name] = true;
                    openFilterCreator(event, props.row);
                  }
                "
                @before-hide="closeField(props.row.name)"
                class="hover:tw:bg-[var(--o2-hover-accent)] tw:rounded-[0.25rem]"
              >
                <template v-slot:header>
                  <div
                    class="flex content-center ellipsis field-expansion-header"
                    :title="props.row.name"
                  >
                    <div class="field_label ellipsis tw:flex tw:items-center">
                      <span class="field-type-container">
                        <q-icon
                          class="field-expand-icon"
                          :name="
                            expandedRows[props.row.name]
                              ? 'expand_less'
                              : 'expand_more'
                          "
                          size="1rem"
                        />
                      </span>
                      {{ props.row.name }}
                    </div>
                    <div
                      v-if="!hideAddSearchTerm"
                      class="field_overlay tw:bg-[var(--o2-hover-accent)]! tw:rounded-[0.25rem]!"
                    >
                      <OButton
                        variant="ghost"
                        size="icon-xs-circle"
                        :data-test="`log-search-index-list-filter-${props.row.name}-field-btn`"
                        @click.stop="addSearchTerm(`${props.row.name}=''`)"
                      >
                        <q-icon :name="outlinedAdd" />
                      </OButton>
                    </div>
                    <div
                      v-if="!hideCopyValue"
                      class="field_overlay tw:bg-[var(--o2-hover-accent)]! tw:rounded-[0.25rem]!"
                    >
                      <OButton
                        variant="ghost"
                        size="icon-xs-circle"
                        :data-test="`log-search-index-list-filter-${props.row.name}-copy-btn`"
                        @click.stop="copyContentValue(props.row.name)"
                      >
                        <q-icon name="content_copy" />
                      </OButton>
                    </div>
                  </div>
                </template>

                <q-card>
                  <q-card-section class="q-pl-md q-pr-xs q-py-xs">
                    <FieldValuesPanel
                      :field-name="props.row.name"
                      :field-values="fieldValues[props.row.name]"
                      :show-multi-select="!hideIncludeExlcude"
                      :default-values-count="defaultValuesCount"
                      :theme="store.state.theme"
                      @add-search-term="handleAddSearchTerm"
                      @add-multiple-search-terms="handleAddMultipleSearchTerms"
                      @remove-field-filter="handleRemoveFieldFilter"
                      @load-more-values="handleLoadMoreValues"
                      @search-field-values="handleSearchFieldValues"
                    />
                  </q-card-section>
                </q-card>
              </q-expansion-item>
            </q-td>
          </q-tr>
        </template>

        <template #top-right>
          <OInput
            data-test="log-search-index-list-field-search-input"
            v-model="filterFieldValue"
            data-cy="index-field-search-input"
            clearable
            debounce="1"
            :placeholder="t('search.searchField')"
            class="o2-search-input tw:min-w-full"
          >
            <template #prepend>
              <q-icon name="search" class="o2-search-input-icon" />
            </template>
          </OInput>
        </template>

        <template #pagination="scope">
          <div v-if="scope.pagesNumber > 1" class="field-list-pagination">
            <OTooltip
              side="left"
              align="center"
              max-width="18.75rem"
              :content="`Total Fields: ${filteredFieldsCount}`"
            />
            <OButton
              variant="ghost-primary"
              size="icon-panel"
              :disabled="scope.isFirstPage"
              @click="scope.firstPage"
              class="pagination-nav-btn"
            >
              <q-icon name="fast_rewind" />
            </OButton>
            <template v-for="page in visiblePages" :key="page">
              <OButton
                :variant="scope.pagination.page === page ? 'primary' : 'ghost'"
                size="icon-panel"
                class="pagination-page-btn"
                @click="setPage(page)"
              >{{ page }}</OButton>
            </template>
            <OButton
              variant="ghost-primary"
              size="icon-panel"
              :disabled="scope.isLastPage"
              @click="scope.lastPage"
              class="pagination-nav-btn"
            >
              <q-icon name="fast_forward" />
            </OButton>
          </div>
        </template>
      </q-table>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import useFieldValuesStream from "@/composables/useFieldValuesStream";
import FieldValuesPanel from "@/components/common/FieldValuesPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import {
  formatLargeNumber,
  getImageURL,
  b64EncodeUnicode,
} from "@/utils/zincutils";
import streamService from "@/services/stream";
import { outlinedAdd } from "@quasar/extras/material-icons-outlined";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { generateTraceContext } from "@/utils/zincutils";

export default defineComponent({
  name: "IndexList",
  components: {
    FieldValuesPanel,
    OButton,
    OInput,
    OTooltip,
  },
  props: {
    fields: {
      type: Array,
      default: () => [],
    },
    streamName: {
      type: String,
      default: "",
    },
    timeStamp: {
      type: Object,
      default: () => ({ endTime: "", startTime: "" }),
    },
    streamType: {
      type: String,
      default: "logs",
    },
    hideIncludeExlcude: {
      type: Boolean,
      default: false,
    },
    hideCopyValue: {
      type: Boolean,
      default: true,
    },
    hideAddSearchTerm: {
      type: Boolean,
      default: false,
    },
    query: {
      type: String,
      default: "",
    },
    showCount: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["event-emitted"],
  setup(props, { emit }) {
    const filterFieldValue = ref("");
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();

    const expandedRows: Ref<Record<string, boolean>> = ref({});

    // Table pagination
    const pagination = ref({ page: 1, rowsPerPage: 50 });

    // Reset to first page whenever the search filter changes
    watch(filterFieldValue, () => {
      pagination.value.page = 1;
    });

    // Per-field pagination state: cumulative size (grows on "load more")
    const currentSizePerField: Ref<Record<string, number>> = ref({});
    const currentKeyword: Ref<Record<string, string>> = ref({});
    // Pinned time range per field so "load more" pages cover the same window.
    const fieldValuesTimeRange: Ref<Record<string, { start_time: number; end_time: number }>> = ref({});

    const defaultValuesCount = computed(
      () => store.state.zoConfig?.query_values_default_num || 10,
    );

    const showFtsFieldValues = computed(
      () => store.state.zoConfig?.showFtsFieldValues ?? false,
    );

    const filteredFieldsCount = computed(() => {
      if (!filterFieldValue.value) return (props.fields as any[]).length;
      return filterFieldFn(props.fields as any[], filterFieldValue.value)
        .length;
    });

    const showPagination = computed(
      () => filteredFieldsCount.value > pagination.value.rowsPerPage,
    );

    const visiblePages = computed(() => {
      const pages: number[] = [];
      const page = pagination.value.page;
      const total = Math.max(
        1,
        Math.ceil(filteredFieldsCount.value / pagination.value.rowsPerPage),
      );
      if (total <= 3) {
        for (let i = 1; i <= total; i++) pages.push(i);
      } else {
        let start = Math.max(1, page - 1);
        let end = Math.min(total, start + 2);
        if (end === total) start = Math.max(1, end - 2);
        for (let i = start; i <= end; i++) pages.push(i);
      }
      return pages;
    });

    const setPage = (page: number) => {
      pagination.value.page = page;
    };

    const {
      fieldValues,
      fieldValuesFinalizedValues,
      fieldValuesCurrentSize,
      fetchFieldValues,
      cancelFieldStream,
      resetFieldValues,
    } = useFieldValuesStream();

    // ─── Filter ──────────────────────────────────────────────────────────

    const { fetchQueryDataWithHttpStream } = useHttpStreaming();
    const traceIdMapper = ref<{ [key: string]: string[] }>({});

    const filterFieldFn = (rows: any, terms: any) => {
      const filtered = [];
      if (terms !== "") {
        const lower = terms.toLowerCase();
        for (let i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(lower)) {
            filtered.push(rows[i]);
          }
        }
      }
      return filtered;
    };

    // ─── SQL helper ──────────────────────────────────────────────────────

    const buildSql = (streamName: string, whereClause?: string) =>
      b64EncodeUnicode(
        `SELECT * FROM "${streamName}"${whereClause ? ` WHERE ${whereClause}` : ""}`,
      ) || "";

    // ─── Field expand / collapse ─────────────────────────────────────────

    const openFilterCreator = (
      event: any,
      { name, ftsKey, stream_name }: any,
    ) => {
      if (ftsKey && !showFtsFieldValues.value) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }

      cancelFieldStream(name);
      currentSizePerField.value[name] = defaultValuesCount.value;
      currentKeyword.value[name] = "";
      fieldValuesTimeRange.value[name] = { start_time: props.timeStamp.startTime, end_time: props.timeStamp.endTime };
      resetFieldValues(name, true);

      const resolvedStream = stream_name || props.streamName;
      fieldValuesCurrentSize.value[name] = defaultValuesCount.value;
      fetchFieldValues({
        fields: [name],
        size: defaultValuesCount.value,
        no_count: false,
        start_time: props.timeStamp.startTime,
        end_time: props.timeStamp.endTime,
        stream_name: resolvedStream,
        stream_type: props.streamType,
        sql: buildSql(resolvedStream, props.query || undefined),
        timeout: 30000,
        use_cache: (globalThis as any).use_cache ?? true,
      });
    };

    const closeField = (fieldName: string) => {
      cancelFieldStream(fieldName);
      expandedRows.value[fieldName] = false;
      currentSizePerField.value[fieldName] = 0;
      currentKeyword.value[fieldName] = "";
      delete fieldValuesTimeRange.value[fieldName];
      resetFieldValues(fieldName);
    };

    // ─── FieldValuesPanel event handlers ─────────────────────────────────

    const handleSearchFieldValues = (fieldName: string, term: string) => {
      const row: any = (props.fields as any[]).find(
        (f: any) => f.name === fieldName,
      );
      const resolvedStream = row?.stream_name || props.streamName;
      currentKeyword.value[fieldName] = term;
      currentSizePerField.value[fieldName] = defaultValuesCount.value;
      fieldValuesCurrentSize.value[fieldName] = defaultValuesCount.value;
      delete fieldValuesFinalizedValues.value[fieldName];
      cancelFieldStream(fieldName);
      resetFieldValues(fieldName, true);
      const pinnedTime = fieldValuesTimeRange.value[fieldName];
      fetchFieldValues({
        fields: [fieldName],
        size: defaultValuesCount.value,
        no_count: false,
        start_time: pinnedTime?.start_time ?? props.timeStamp.startTime,
        end_time: pinnedTime?.end_time ?? props.timeStamp.endTime,
        stream_name: resolvedStream,
        stream_type: props.streamType,
        sql: buildSql(resolvedStream, props.query || undefined),
        keyword: term || undefined,
        timeout: 30000,
        use_cache: (globalThis as any).use_cache ?? true,
      });
    };

    const handleLoadMoreValues = (fieldName: string) => {
      const row: any = (props.fields as any[]).find(
        (f: any) => f.name === fieldName,
      );
      const resolvedStream = row?.stream_name || props.streamName;
      const newSize =
        (currentSizePerField.value[fieldName] ?? defaultValuesCount.value) +
        defaultValuesCount.value;
      currentSizePerField.value[fieldName] = newSize;
      fieldValuesCurrentSize.value[fieldName] = newSize;

      // Snapshot current values as finalized (they won't change during streaming).
      fieldValuesFinalizedValues.value[fieldName] = [
        ...(fieldValues.value[fieldName]?.values || []),
      ];

      const pinnedTime = fieldValuesTimeRange.value[fieldName];
      fetchFieldValues({
        fields: [fieldName],
        size: newSize,
        no_count: false,
        start_time: pinnedTime?.start_time ?? props.timeStamp.startTime,
        end_time: pinnedTime?.end_time ?? props.timeStamp.endTime,
        stream_name: resolvedStream,
        stream_type: props.streamType,
        sql: buildSql(resolvedStream, props.query || undefined),
        keyword: currentKeyword.value[fieldName] || undefined,
        timeout: 30000,
        use_cache: (globalThis as any).use_cache ?? true,
      });
    };

    const isNullValue = (v: string) =>
      v === null || v === undefined || v === "" || v.toLowerCase() === "null";

    const buildExpression = (fieldName: string, v: string, action: string) =>
      isNullValue(v)
        ? action === "include"
          ? `${fieldName} IS NULL`
          : `${fieldName} IS NOT NULL`
        : action === "include"
          ? `${fieldName}='${v}'`
          : `${fieldName}!='${v}'`;

    const handleAddSearchTerm = (
      fieldName: string,
      value: string,
      action: string,
    ) => {
      addSearchTerm(buildExpression(fieldName, value, action));
    };

    const handleAddMultipleSearchTerms = (
      fieldName: string,
      values: string[],
      action: string,
    ) => {
      const joinOp = action === "include" ? " or " : " and ";
      const expressions = values.map((v) =>
        buildExpression(fieldName, v, action),
      );
      addSearchTerm(
        expressions.length > 1
          ? `(${expressions.join(joinOp)})`
          : expressions[0],
      );
    };

    const handleRemoveFieldFilter = (fieldName: string) => {
      emit("event-emitted", "remove-field", fieldName);
    };

    // ─── Misc helpers ─────────────────────────────────────────────────────

    const addSearchTerm = (term: string) => {
      emit("event-emitted", "add-field", term);
    };

    const copyContentValue = (value: string) => {
      navigator.clipboard.writeText(value);
      $q.notify({ type: "positive", message: "Value copied to clipboard" });
    };

    return {
      t,
      store,
      router,
      filterFieldFn,
      getImageURL,
      openFilterCreator,
      closeField,
      addSearchTerm,
      copyContentValue,
      fieldValues,
      expandedRows,
      defaultValuesCount,
      outlinedAdd,
      filterFieldValue,
      filteredFieldsCount,
      showPagination,
      pagination,
      visiblePages,
      setPage,
      handleAddSearchTerm,
      handleAddMultipleSearchTerms,
      handleRemoveFieldFilter,
      handleLoadMoreValues,
      handleSearchFieldValues,
      showFtsFieldValues,
    };
  },
});
</script>

<style lang="scss" scoped>
.traces-field-table {
}

.field-list-pagination {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
}

.pagination-nav-btn {
  padding: 0.375rem 0.25rem !important;
  margin: 0 !important;
  min-width: 1.5rem !important;
  width: 1.5rem !important;
  min-height: 1.375rem !important;
  height: 1.375rem !important;
  border-radius: 0.25rem !important;
  overflow: visible !important;
}

.pagination-page-btn {
  padding: 0.375rem 0.25rem !important;
  margin: 0 !important;
  min-width: 1.5rem !important;
  width: 1.5rem !important;
  min-height: 1.375rem !important;
  height: 1.375rem !important;
  font-size: 0.75rem !important;
  font-weight: 500;
  line-height: 1;
  color: var(--o2-text-primary) !important;
  border-radius: 0.25rem !important;
  overflow: visible !important;
}
.q-menu {
  box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(0.5rem);
  border-radius: 0px;

  .q-virtual-scroll__content {
    padding: 0.5rem;
  }
}
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

    .q-table {
      display: table;
      table-layout: fixed !important;
    }
    tr {
      margin-bottom: 1px;
    }
    tbody,
    tr,
    td {
      width: 100%;
      display: block;
      height: fit-content;
      overflow: hidden;
    }

    .q-table__control,
    label.q-field {
      width: 100%;
    }
    .q-table thead tr,
    .q-table tbody td {
      height: auto;
    }

    .q-table__top {
      border-bottom: unset;
    }
  }
  .traces-field-table {
    width: 100%;
  }

  .field_list {
    padding: 0px;
    margin-bottom: 0.125rem;
    position: relative;
    overflow: visible;
    cursor: default;

    .field_label {
      pointer-events: none;
      font-size: 0.825rem;
      position: relative;
      display: inline;
      z-index: 2;
      left: 0;
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

      .q-icon {
        cursor: pointer;
        opacity: 0;
        margin: 0 1px;
      }
    }

    &:hover {
      .field-container {
        background-color: color-mix(in srgb, currentColor 15%, transparent);
      }
    }
  }
}

.q-item {
  min-height: 1.3rem;
  padding: 5px 10px;

  &__label {
    font-size: 0.75rem;
  }

  &.q-manual-focusable--focused > .q-focus-helper {
    background: none !important;
    opacity: 0.3 !important;
  }

  &.q-manual-focusable--focused > .q-focus-helper,
  &--active {
    background-color: $selected-list-bg !important;
  }

  &.q-manual-focusable--focused > .q-focus-helper,
  &:hover,
  &--active {
    color: $primary;
  }
}
.q-field--dense .q-field__before,
.q-field--dense .q-field__prepend {
  padding: 0px 0px 0px 0px;
  height: auto;
  line-height: auto;
}
.q-field--dense .q-field__control,
.q-field--dense .q-field__marginal {
  height: 34px;
}
</style>

<style lang="scss">
.index-table {
  .q-table {
    width: 100%;
    table-layout: fixed;

    .q-expansion-item {
      .q-item {
        display: flex;
        align-items: center;
        padding: 0;
        height: 25px !important;
        min-height: 25px !important;
      }
      .q-item__section--avatar {
        min-width: 12px;
        max-width: 12px;
        margin-right: 8px;
      }

      .filter-values-container {
        .q-item {
          padding-left: 4px;

          .q-focus-helper {
            background: none !important;
          }
        }
      }
      .q-item-type {
        &:hover {
          .field_overlay {
            visibility: visible;

            .q-icon {
              opacity: 1;
            }
          }
        }
      }
    }

    .field-container {
      &:hover {
        .field_overlay {
          visibility: visible;

          .q-icon {
            opacity: 1;
          }
        }
      }
    }

    .field_list {
      &.selected {
        .q-expansion-item {
          background-color: rgba(89, 96, 178, 0.3);
        }
      }
    }
  }
}
</style>
