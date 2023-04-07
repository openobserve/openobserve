<!-- Copyright 2022 Zinc Labs Inc. and Contributors

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

<template>
  <div class="column index-menu">
    <div>
      <q-select
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
        filled
        borderless
        dense
        use-input
        hide-selected
        fill-input
        @filter="filterStreamFn"
      >
        <template #no-option>
          <q-item>
            <q-item-section> {{ t("search.noResult") }}</q-item-section>
          </q-item>
        </template>
      </q-select>
    </div>
    <div class="index-table q-mt-xs">
      <q-table
        v-model="searchObj.data.stream.selectedFields"
        :rows="searchObj.data.stream.selectedStreamFields"
        row-key="name"
        :filter="searchObj.data.stream.filterField"
        :filter-method="filterFieldFn"
        :pagination="{ rowsPerPage: 10000 }"
        hide-header
        hide-bottom
        :wrap-cells="searchObj.meta.resultGrid.wrapCells"
        class="field-table"
        id="fieldList"
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
              <q-expansion-item
                dense
                dense-toggle
                :label="props.row.name"
                @before-show="openFilterCreator(props.row.name)"
              >
                <template v-slot:header>
                  <div class="field-container" :title="props.row.name">
                    <div class="field_label">
                      {{ props.row.name }}
                    </div>
                    <div class="field_overlay" v-if="false">
                      <q-icon
                        v-if="false"
                        name="filter_alt"
                        style="margin-right: 0.375rem"
                        size="1rem"
                        @click.stop="openFilterCreator(props.row.name)"
                      />
                      <q-icon
                        :name="
                          'img:' + getImageURL('images/common/search_icon.svg')
                        "
                        style="margin-right: 0.375rem"
                        size="1rem"
                        @click="addToFilter(props.row.name)"
                      />
                      <q-icon
                        v-if="
                          !searchObj.data.stream.selectedFields.includes(
                            props.row.name
                          )
                        "
                        :name="
                          'img:' + getImageURL('images/common/add_icon.svg')
                        "
                        size="1rem"
                        @click="clickFieldFn(props.row, props.pageIndex)"
                      />
                      <q-icon
                        v-if="
                          searchObj.data.stream.selectedFields.includes(
                            props.row.name
                          )
                        "
                        :name="
                          'img:' + getImageURL('images/common/remove_icon.svg')
                        "
                        size="1rem"
                        @click="clickFieldFn(props.row, props.pageIndex)"
                      />
                    </div>
                  </div>
                </template>
                <q-card>
                  <q-card-section class="q-pl-md q-pr-sm q-py-xs">
                    <div class="filter-values-container">
                      <div v-show="!fieldValues[props.row.name]?.length">
                        No values present
                      </div>
                      <div
                        v-for="value in fieldValues[props.row.name]"
                        :key="value.key"
                      >
                        <q-list dense>
                          <q-item tag="label" class="q-pr-none">
                            <div
                              class="flex row wrap justify-between"
                              style="width: calc(100% - 44px)"
                            >
                              <div
                                :title="value.key"
                                class="ellipsis q-pr-xs"
                                style="width: calc(100% - 50px)"
                              >
                                {{ value.key }}
                              </div>
                              <div
                                :title="value.count"
                                class="ellipsis text-right q-pr-xs"
                                style="width: 50px"
                              >
                                {{ value.count }}
                              </div>
                            </div>
                            <div class="flex row">
                              <q-icon
                                :name="
                                  'img:' +
                                  getImageURL('images/common/add_icon.svg')
                                "
                                class="q-mr-xs"
                                size="1rem"
                                @click="
                                  addSearchTerm(
                                    `${props.row.name}='${value.key}'`
                                  )
                                "
                              />
                              <q-icon
                                :name="
                                  'img:' +
                                  getImageURL('images/common/remove_icon.svg')
                                "
                                size="1rem"
                                @click="
                                  addSearchTerm(
                                    `${props.row.name}!='${value.key}'`
                                  )
                                "
                              />
                            </div>
                          </q-item>
                        </q-list>
                      </div>
                    </div>
                  </q-card-section>
                </q-card>
              </q-expansion-item>
            </q-td>
          </q-tr>
        </template>
        <template #top-right>
          <q-input
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
import useLogs from "../../composables/useLogs";
import { getImageURL } from "../../utils/zincutils";
import FilterCreatorPopup from "@/components/shared/filter/FilterCreatorPopup.vue";
import streamService from "../../services/stream";
import { getConsumableDateTime } from "@/utils/commons";

interface Filter {
  fieldName: string;
  selectedValues: string[];
  selectedOperator: string;
}
export default defineComponent({
  name: "ComponentSearchIndexSelect",
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const { searchObj, updatedLocalLogFilterField } = useLogs();
    const streamOptions: any = ref(searchObj.data.stream.streamLists);
    const fieldValues: Ref<{
      [key: string | number]: { key: string; count: string }[] | [];
    }> = ref({});

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

    const openFilterCreator = (fieldName: string) => {
      // Make api call to get the field values
      console.log(fieldName);
      const timestamps = getConsumableDateTime(searchObj.data.datetime);
      const startISOTimestamp: any =
        new Date(timestamps.start_time.toISOString()).getTime() * 1000;
      const endISOTimestamp: any =
        new Date(timestamps.end_time.toISOString()).getTime() * 1000;
      console.log(startISOTimestamp, endISOTimestamp);
      try {
        streamService
          .fieldValues({
            org_identifier: store.state.selectedOrganization.identifier,
            stream_name: searchObj.data.stream.selectedStream.value,
            start_time: startISOTimestamp,
            end_time: endISOTimestamp,
            fields: [fieldName],
            size: 10,
          })
          .then((res: any) => {
            if (res.data.hits.length) {
              fieldValues.value[fieldName] = res.data.hits
                .find((field: any) => field.field === fieldName)
                .values.map((value: any) => {
                  return {
                    key: value.key,
                    count: formatNumberWithPrefix(value.num),
                  };
                });
            }
          });
      } catch (err) {
        console.log(err);
      }
    };

    function formatNumberWithPrefix(number: number) {
      if (number >= 1000000000) {
        return (number / 1000000000).toFixed(1) + "B";
      } else if (number >= 1000000) {
        return (number / 1000000).toFixed(1) + "M";
      } else if (number >= 1000) {
        return (number / 1000).toFixed(1) + "K";
      } else {
        return number.toString();
      }
    }

    const addSearchTerm = (term: string) => {
      // searchObj.meta.showDetailTab = false;
      searchObj.data.stream.addToFilter = term;
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
      openFilterCreator,
      addSearchTerm,
      fieldValues,
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
  .field-table {
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

    .field_overlay {
      position: absolute;
      height: 100%;
      right: 0;
      top: 0;
      background-color: #ffffff;
      border-radius: 6px;
      padding: 0 6px;
      visibility: hidden;
      display: flex;
      align-items: center;
      transition: all 0.3s linear;

      .q-icon {
        cursor: pointer;
        opacity: 0;
        transition: all 0.3s linear;
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
      &:hover {
        .field_overlay {
          box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.17);
          background-color: white;

          .field_icons {
            background-color: white;
          }
        }
      }
    }

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

.q-item {
  color: $dark-page;
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
        justify-content: space-between;
        padding-right: 4px;
      }
    }
  }
}
</style>
