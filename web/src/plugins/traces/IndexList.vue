<!-- Copyright 2023 Zinc Labs Inc.

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
  <div class="column index-menu">
    <div class="index-table q-mt-xs">
      <q-table
        data-test="log-search-index-list-fields-table"
        v-model="searchObj.data.stream.selectedFields"
        :visible-columns="['name']"
        :rows="searchObj.data.stream.selectedStreamFields"
        row-key="name"
        :filter="searchObj.data.stream.filterField"
        :filter-method="filterFieldFn"
        :pagination="{ rowsPerPage: 10000 }"
        hide-header
        hide-bottom
        :wrap-cells="searchObj.meta.resultGrid.wrapCells"
        class="traces-field-table"
        id="tracesFieldList"
      >
        <template #body-cell-name="props">
          <q-tr :props="props">
            <q-td
              :props="props"
              class="field_list"
              :class="
                searchObj.data.stream.selectedFields.includes(props.row.name)
                  ? 'selected'
                  : ''
              "
            >
              <!-- TODO OK : Repeated code make seperate component to display field  -->
              <div
                v-if="props.row.ftsKey || !props.row.showValues"
                class="field-container flex content-center ellipsis q-pl-lg q-pr-sm"
                :title="props.row.name"
              >
                <div class="field_label ellipsis">
                  {{ props.row.name }}
                </div>
                <div
                  class="field_overlay"
                  :style="{
                    background:
                      store.state.theme === 'dark' ? '#414345' : '#d9d9d9',
                  }"
                >
                  <q-btn
                    :icon="outlinedAdd"
                    :data-test="`log-search-index-list-filter-${props.row.name}-field-btn`"
                    style="margin-right: 0.375rem"
                    size="0.4rem"
                    class="q-mr-sm"
                    @click.stop="addToFilter(`${props.row.name}=''`)"
                    round
                  />
                </div>
              </div>
              <div v-else>
                <template
                  v-if="
                    ['operation_name', 'service_name'].includes(props.row.name)
                  "
                >
                  <advanced-values-filter
                    :row="props.row"
                    @update:values="updateQueryFilter"
                  />
                </template>
                <template v-else-if="props.row.name === 'duration'">
                  <div class="q-mx-lg q-mt-sm">Duration</div>
                  <div class="q-mx-lg q-pb-xs" style="margin: 0px 36px">
                    <q-range
                      v-model="durationFilterValue"
                      :min="duration.min"
                      :max="duration.max"
                      :marker-labels="fnMarkerLabel"
                      markers
                      label
                      switch-label-side
                    />
                  </div>
                  <div
                    class="flex justify-between items-center q-px-lg q-mb-md"
                  >
                    <div class="flex column">
                      <label>Min (in ms)</label>
                      <input
                        type="number"
                        v-model="duration.min"
                        aria-label="min"
                        style="width: 100px"
                      />
                    </div>
                    <div class="flex column">
                      <label>Max (in ms)</label>
                      <input
                        type="number"
                        aria-label="max"
                        v-model="duration.max"
                        style="width: 100px"
                      />
                    </div>
                  </div>
                </template>
                <template v-else>
                  <basic-values-filter :row="props.row" />
                </template>
              </div>
            </q-td>
          </q-tr>
        </template>
        <template #top-right>
          <q-input
            data-test="log-search-index-list-field-search-input"
            v-model="searchObj.data.stream.filterField"
            data-cy="index-field-search-input"
            filled
            borderless
            dense
            clearable
            debounce="1"
            :placeholder="t('search.searchField')"
          >
            <template #prepend>
              <q-icon name="search" />
            </template>
          </q-input>
        </template>
      </q-table>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import useTraces from "../../composables/useTraces";
import { getImageURL } from "../../utils/zincutils";
import { outlinedAdd } from "@quasar/extras/material-icons-outlined";
import BasicValuesFilter from "./fields-sidebar/BasicValuesFilter.vue";
import AdvancedValuesFilter from "./fields-sidebar/AdvancedValuesFilter.vue";
import { computed } from "vue";
import { Parser } from "node-sql-parser";
import { f } from "msw/lib/SetupApi-8ab693f7";
import { cloneDeep, filter } from "lodash-es";
import { onMounted } from "vue";

export default defineComponent({
  name: "ComponentSearchIndexSelect",
  components: {
    BasicValuesFilter,
    AdvancedValuesFilter,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const { searchObj, updatedLocalLogFilterField } = useTraces();
    const streamOptions: any = ref(searchObj.data.stream.streamLists);
    const fieldValues: Ref<{
      [key: string | number]: {
        isLoading: boolean;
        values: { key: string; count: string }[];
      };
    }> = ref({});

    const duration = ref({
      min: 0,
      max: 100,
    });

    const durationFilterValue = ref({ min: 0, max: 50 });

    const filterStreamFn = (val: string, update: any) => {
      update(() => {
        streamOptions.value = searchObj.data.stream.streamLists;
        const needle = val.toLowerCase();
        streamOptions.value = streamOptions.value.filter(
          (v: any) => v.label.toLowerCase().indexOf(needle) > -1
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

    function clickFieldFn(row: { name: never }, pageIndex: number) {
      if (searchObj.data.stream.selectedFields.includes(row.name)) {
        searchObj.data.stream.selectedFields =
          searchObj.data.stream.selectedFields.filter(
            (v: any) => v !== row.name
          );
      } else {
        searchObj.data.stream.selectedFields.push(row.name);
      }
      searchObj.organizationIdetifier =
        store.state.selectedOrganization.identifier;
      updatedLocalLogFilterField();
    }

    const addSearchTerm = (term: string) => {
      // searchObj.meta.showDetailTab = false;
      searchObj.data.stream.addToFilter = term;
    };

    const fnMarkerLabel = computed(() => {
      const markers = [];
      const diffDuration = duration.value.max - duration.value.min;
      const step = diffDuration / 4;
      for (let i = 0; i < 5; i++) {
        markers.push({
          label: `${Math.round(duration.value.min + step * i)}ms`,
          value: duration.value.min + step * i,
        });
      }
      return markers;
    });

    const updateQueryFilter = (column, values) => {
      const filters = searchObj.data.stream.filters;
      const filterIndex = filters.findIndex(
        (f: any) => f.field_name === column
      );

      // const filters = searchObj.data.stream.filters;
      const parser = new Parser();

      const valuesString = values
        .map((value: string) => "'" + value + "'")
        .join(",");

      if (!filters.length) {
        searchObj.data.query += ` WHERE ${column} IN (${valuesString})`;
        searchObj.data.stream.filters.push({
          field_name: column,
          values,
          operator: "IN",
        });
        return;
      } else if (filters.length && filterIndex === -1) {
        searchObj.data.stream.filters.push({
          field_name: column,
          values,
          operator: "IN",
        });
        searchObj.data.query += ` AND ${column} IN (${valuesString})`;
        return;
      }

      if (filterIndex > -1) {
        searchObj.data.stream.filters[filterIndex].values = values;
      }

      const parsedQuery = parser.astify(searchObj.data.query);

      if (filters.length && filterIndex > -1 && values.length === 0) {
        parsedQuery.where = removeCondition(parsedQuery.where, column);
        searchObj.data.stream.filters = searchObj.data.stream.filters.filter(
          (f: any) => f.field_name !== column
        );
      } else {
        modifyWhereClause(parsedQuery?.where, column, values);
      }

      // Convert the AST back to SQL query
      let modifiedQuery = parser.sqlify(parsedQuery);

      if (modifiedQuery) searchObj.data.query = modifiedQuery;
    };

    const removeCondition = (node, fieldName): any => {
      if (!node) return null;

      if (node.type === "binary_expr") {
        if (node.left.column === fieldName) {
          // Return null to indicate this node should be removed
          return null;
        }
      }

      // Recurse through AND/OR expressions
      if (
        node.type === "binary_expr" &&
        (node.operator === "AND" || node.operator === "OR")
      ) {
        const left = removeCondition(node.left, fieldName);
        const right = removeCondition(node.right, fieldName);

        if (!left) return right;
        if (!right) return left;

        node.left = left;
        node.right = right;
      }

      return node;
    };

    const modifyWhereClause = (node, fieldName, newValue) => {
      if (!node) return;

      if (node.type === "binary_expr") {
        if (node.left.column === fieldName) {
          // Assuming the right side is a literal
          node.right.value = newValue.map((value: string) => {
            return {
              type: "single_quote_string",
              value: value,
            };
          });
        }
      }

      // Recurse through AND/OR expressions
      if (
        node.type === "binary_expr" &&
        (node.operator === "AND" || node.operator === "OR")
      ) {
        modifyWhereClause(node.left, fieldName, newValue);
        modifyWhereClause(node.right, fieldName, newValue);
      }
    };

    const restoreFiltersFromQuery = (node, filters) => {
      if (!node) return;
      if (node.type === "binary_expr") {
        if (node.left.column) {
          let values = [];
          console.log(node);
          if (node.operator === "IN") {
            values = node.right.value.map(
              (_value: { value: string }) => _value.value
            );
          }
          filters.push({
            field_name: node.left.column,
            values,
            operator: node.operator,
          });
        }
      }

      // Recurse through AND/OR expressions
      if (
        node.type === "binary_expr" &&
        (node.operator === "AND" || node.operator === "OR")
      ) {
        restoreFiltersFromQuery(node.left, filters);
        restoreFiltersFromQuery(node.right, filters);
      }
    };

    const restoreFilters = () => {
      const filters = searchObj.data.stream.filters;

      // const filters = searchObj.data.stream.filters;
      const parser = new Parser();
      const sql =
        "SELECT * FROM `default` WHERE `operation_name` IN ('GetUser', 'GetHobbies', 'GetHobbiesCall', '/') AND service_name IN ('otel1-gin-gonic')";

      const parsedQuery = parser.astify(sql);

      restoreFiltersFromQuery(parsedQuery.where, filters);

      console.log(cloneDeep(filters));
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
      getImageURL,
      filterStreamFn,
      addSearchTerm,
      fieldValues,
      outlinedAdd,
      durationFilterValue,
      fnMarkerLabel,
      duration,
      updateQueryFilter,
    };
  },
});
</script>

<style lang="scss" scoped>
.traces-field-table {
  height: calc(100vh - 144px) !important;
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
        background-color: rgba(89, 96, 178, 0.3);

        .field_icons {
          opacity: 0;
        }
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
        .q-expansion-item {
          background-color: rgba(89, 96, 178, 0.3);
        }

        .field_overlay {
          // background-color: #ffffff;
        }
      }
    }
  }
}
</style>
