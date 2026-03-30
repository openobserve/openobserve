<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="column index-menu tw:p-[0.375rem]!">
    <q-select
      data-test="log-search-index-list-select-stream"
      v-model="searchObj.data.stream.selectedStream"
      :label="
        searchObj.data.stream.selectedStream.label
          ? ''
          : t('search.selectIndex')
      "
      :options="streamOptions"
      data-cy="index-dropdown"
      input-debounce="0"
      behavior="menu"
      borderless
      dense
      use-input
      hide-selected
      fill-input
      class="tw:mb-[0.375rem]"
      @filter="filterStreamFn"
      @update:model-value="onStreamChange"
    >
      <template #no-option>
        <q-item>
          <q-item-section> {{ t("search.noResult") }}</q-item-section>
        </q-item>
      </template>
    </q-select>
    <!-- <div
      class="tw:w-full tw:h-[1px] tw:bg-[var(--o2-border-color)] tw:mb-[0.375rem]"
    ></div> -->
    <div class="index-table tw:h-[calc(100%-2.725rem)]!">
      <q-table
        data-test="log-search-index-list-fields-table"
        :visible-columns="['name']"
        :rows="normalizedFieldList"
        row-key="name"
        :filter="searchObj.data.stream.filterField"
        :filter-method="filterFieldFn"
        :pagination="{ rowsPerPage: 10000 }"
        hide-header
        hide-bottom
        :wrap-cells="searchObj.meta.resultGrid.wrapCells"
        class="tw:w-full tw:h-full"
        id="tracesFieldList"
      >
        <template #body-cell-name="props">
          <q-tr :props="props" class="hover:tw:bg-[var(--o2-hover-accent)]!">
            <q-td
              :props="props"
              class="field_list tw:rounded"
              :class="
                props.row.enableVisibility &&
                searchObj.data.stream.selectedFields.includes(props.row.name)
                  ? 'selected'
                  : ''
              "
            >
              <FieldRow
                :field="props.row"
                :selected-fields="searchObj.data.stream.selectedFields"
                :timestamp-column="store.state.zoConfig.timestamp_column"
                :theme="store.state.theme"
                :show-quick-mode="false"
                :show-visibility-toggle="props.row.enableVisibility"
                @add-to-filter="addToFilter(`${props.row.name}=''`)"
                @toggle-field="toggleField"
              >
                <template #expansion="{ field }">
                  <basic-values-filter
                    :row="field"
                    :active-include-values="
                      activeIncludeFieldValues?.[props.row.name] ?? []
                    "
                    :active-exclude-values="
                      activeExcludeFieldValues?.[props.row.name] ?? []
                    "
                    :selected-fields="searchObj.data.stream.selectedFields"
                    :show-visibility-toggle="props.row.enableVisibility"
                    @toggle-field="toggleField"
                  />
                </template>
              </FieldRow>
            </q-td>
          </q-tr>
        </template>
        <template #top-right>
          <q-input
            v-show="searchObj.data.stream?.selectedStream?.value"
            data-test="log-search-index-list-field-search-input"
            v-model="searchObj.data.stream.filterField"
            data-cy="index-field-search-input"
            borderless
            dense
            clearable
            debounce="1"
            :placeholder="t('search.searchField')"
            class="tw:p-0 tw:pb-[0.375rem]"
          >
            <template #prepend>
              <q-icon name="search" />
            </template>
          </q-input>
          <q-tr
            v-if="searchObj.loadingStream"
            class="tw:flex tw:items-center tw:justify-center tw:w-full tw:pt-[2rem]"
          >
            <q-td colspan="100%" class="text-bold" style="opacity: 0.7">
              <div
                class="text-subtitle2 text-weight-bold tw:w-fit tw:mx-auto tw:my-0 tw:flex-col tw:justify-items-center"
              >
                <q-spinner-hourglass size="1.8rem" color="primary" />
                {{ t("traces.loadingStream") }}
              </div>
            </q-td>
          </q-tr>
        </template>
      </q-table>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useTraces, { DEFAULT_TRACE_COLUMNS } from "../../composables/useTraces";
import { getImageURL } from "../../utils/zincutils";
import BasicValuesFilter from "./fields-sidebar/BasicValuesFilter.vue";
import FieldRow from "@/components/common/FieldRow.vue";

export default defineComponent({
  name: "ComponentSearchIndexSelect",
  components: {
    BasicValuesFilter,
    FieldRow,
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

    const filterFieldFn = (rows: any, terms: any) => {
      var filtered = [];
      if (terms != "") {
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
      }
      return filtered;
    };

    const addToFilter = (field: any) => {
      searchObj.data.stream.addToFilter = field;
    };

    const addSearchTerm = (term: string) => {
      // searchObj.meta.showDetailTab = false;
      searchObj.data.stream.addToFilter = term;
    };

    const onStreamChange = (stream: any) => {
      searchObj.data.stream.selectedStream = stream;
      searchObj.data.query = "";
      searchObj.data.editorValue = "";
      searchObj.data.resultGrid.currentPage = 0;
      emit("update:changeStream");
    };

    const normalizedFieldList = computed(() =>
      (props.fieldList as any[]).map((f: any) => ({
        ...f,
        isSchemaField: true,
        enableVisibility: !TRACES_LOCKED_FIELD_NAMES.has(f.name),
      })),
    );

    // Column ID "status" maps to stream field "span_status" — the only mismatch.
    const TRACES_LOCKED_FIELD_NAMES = new Set(
      [...DEFAULT_TRACE_COLUMNS.traces].map((id) =>
        id === "status" ? "span_status" : id,
      ),
    );

    const isFieldEditable = (fieldName: string): boolean =>
      searchObj.meta.searchMode === "traces" &&
      !TRACES_LOCKED_FIELD_NAMES.has(fieldName);

    const toggleField = async (field: any) => {
      emit("update:selectedFields", field);
    };

    return {
      t,
      store,
      router,
      searchObj,
      streamOptions,
      filterFieldFn,
      addToFilter,
      getImageURL,
      filterStreamFn,
      addSearchTerm,
      fnMarkerLabel,
      duration,
      onStreamChange,
      showFtsFieldValues,
      normalizedFieldList,
      isFieldEditable,
      toggleField,
      TRACES_LOCKED_FIELD_NAMES,
    };
  },
});
</script>

<style lang="scss" scoped>
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
    // border: 1px solid rgba(0, 0, 0, 0.02);

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

      .q-icon {
        cursor: pointer;
        opacity: 0;
        margin: 0 1px;
      }
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

.q-item {
  // color: $dark-page;
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

          .q-icon {
            opacity: 1;
          }
        }
      }
    }

    .field_list {
      &.selected {
        background-color: rgba(89, 96, 178, 0.3);

        .field_overlay {
          // background-color: #ffffff;
        }
      }
    }
  }
}
</style>
