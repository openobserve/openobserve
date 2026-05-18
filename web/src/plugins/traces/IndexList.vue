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
  <div class="column index-menu tw:p-[0.375rem]!">
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
      class="tw:mb-[0.375rem]"
      @search="onStreamSearch"
      @update:model-value="onStreamChange"
    >
        <template #empty>
          <div class="q-pa-sm">{{ t("search.noResult") }}</div>
        </template>
    </OSelect>
    <div
      class="index-table tw:h-[calc(100%-2.725rem)]!"
      data-test="log-search-index-list-fields-table"
    >
      <FieldList
        :fields="normalizedFieldList"
        :search="searchObj.data.stream.filterField"
        :loading="searchObj.loadingStream"
        :theme="store.state.theme"
        @update:search="searchObj.data.stream.filterField = $event"
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
              <basic-values-filter
                :row="field"
                :active-include-values="activeIncludeFieldValues?.[field.name] ?? []"
                :active-exclude-values="activeExcludeFieldValues?.[field.name] ?? []"
                :selected-fields="searchObj.data.stream.selectedFields"
                :show-visibility-toggle="row.enableVisibility"
                @toggle-field="toggleField"
              />
            </template>
          </FieldRow>
        </template>

        <template #loading>
          <div
            class="tw:flex tw:items-center tw:justify-center tw:w-full tw:pt-[2rem]"
          >
            <div
              class="text-subtitle2 text-weight-bold tw:w-fit tw:mx-auto tw:my-0 tw:flex-col tw:justify-items-center"
            >
              <OSpinner size="sm" />
              {{ t("traces.loadingStream") }}
            </div>
          </div>
        </template>
      </FieldList>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useTraces, { DEFAULT_TRACE_COLUMNS } from "../../composables/useTraces";
import { getImageURL } from "../../utils/zincutils";
import BasicValuesFilter from "./fields-sidebar/BasicValuesFilter.vue";
import FieldRow from "@/components/common/FieldRow.vue";
import FieldList from "@/components/common/FieldList.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

export default defineComponent({
  name: "ComponentSearchIndexSelect",
  components: {
    BasicValuesFilter,
    FieldRow,
    OButton,
    OSelect,
    OInput,
    OSpinner,
    OIcon,
    FieldList,
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

      .OIcon {
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
  table {
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

            .OIcon {
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

          .OIcon {
            opacity: 1;
          }
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
