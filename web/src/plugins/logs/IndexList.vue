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
  <div
    class="column logs-index-menu full-height"
    :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'"
  >
    <div>
      <q-select
        ref="streamSelect"
        data-test="log-search-index-list-select-stream"
        v-model="searchObj.data.stream.selectedStream"
        :options="streamOptions"
        data-cy="index-dropdown"
        :placeholder="placeHolderText"
        input-debounce="0"
        behavior="menu"
        filled
        borderless
        dense
        use-input
        multiple
        emit-value
        map-options
        @filter="filterStreamFn"
        @update:model-value="handleMultiStreamSelection"
        :title="searchObj.data.stream.selectedStream.join(',')"
      >
        <template #no-option>
          <q-item>
            <q-item-section> {{ t("search.noResult") }}</q-item-section>
          </q-item>
        </template>
        <template v-slot:option="{ itemProps, opt, selected, toggleOption }">
          <q-item style="cursor: pointer">
            <q-item-section @click="handleSingleStreamSelect(opt)">
              <q-item-label v-html="opt.label" />
            </q-item-section>
            <q-item-section side>
              <q-toggle
                :data-test="`log-search-index-list-stream-toggle-${opt.label}`"
                :model-value="selected"
                size="20px"
                @update:model-value="toggleOption(opt.value)"
              />
            </q-item-section>
          </q-item>
        </template>
      </q-select>
    </div>
    <div
      v-if="
        (!searchObj.data.stream.selectedStreamFields ||
          searchObj.data.stream.selectedStreamFields.length == 0) &&
        searchObj.loading == false
      "
      class="index-table q-mt-xs"
    >
      <h3
        data-test="logs-search-no-field-found-text"
        class="text-center col-10 q-mx-none"
      >
        <q-icon name="info" color="primary" size="xs" /> No field found in
        selected stream.
      </h3>
    </div>
    <div v-else class="index-table q-mt-xs">
      <q-table
        data-test="log-search-index-list-fields-table"
        v-model="sortedStreamFields"
        :visible-columns="['name']"
        :rows="streamFieldsRows"
        :row-key="
          (row: any) => searchObj.data.stream.selectedStream[0] + row.name
        "
        :filter="searchObj.data.stream.filterField"
        :filter-method="filterFieldFn"
        v-model:pagination="pagination"
        hide-header
        :wrap-cells="searchObj.meta.resultGrid.wrapCells"
        class="field-table full-height"
        :class="{ 'loading-fields': searchObj.loadingStream }"
        id="fieldList"
        :rows-per-page-options="[]"
      >
        <template #body-cell-name="props">
          <q-tr
            :props="props"
            v-if="
              props.row.label &&
              (showOnlyInterestingFields
                ? searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                    props.row.group
                  ]
                : true)
            "
            @click="
              searchObj.data.stream.expandGroupRows[props.row.group] =
                !searchObj.data.stream.expandGroupRows[props.row.group]
            "
            class="cursor-pointer text-bold"
          >
            <q-td
              class="field_list field-group-header"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'bg-grey-3'
              "
            >
              {{ props.row.name }} ({{
                showOnlyInterestingFields
                  ? searchObj.data.stream
                      .interestingExpandedGroupRowsFieldCount[props.row.group]
                  : searchObj.data.stream.expandGroupRowsFieldCount[
                      props.row.group
                    ]
              }})
              <q-icon
                v-if="
                  searchObj.data.stream.expandGroupRowsFieldCount[
                    props.row.group
                  ] > 0
                "
                :name="
                  searchObj.data.stream.expandGroupRows[props.row.group]
                    ? 'expand_less'
                    : 'expand_more'
                "
                size="20px"
                class="float-right q-mt-xs"
              ></q-icon>
            </q-td>
          </q-tr>
          <q-tr
            :props="props"
            v-else-if="
              !showOnlyInterestingFields ||
              (showOnlyInterestingFields &&
                props.row.isInterestingField &&
                searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                  props.row.group
                ])
            "
            v-show="searchObj.data.stream.expandGroupRows[props.row.group]"
          >
            <q-td
              :props="props"
              class="field_list"
              :class="
                searchObj.data.stream.selectedFields.includes(props.row.name)
                  ? 'selected'
                  : ''
              "
            >
              <!-- TODO OK : Repeated code make separate component to display field  -->
              <div
                v-if="
                  props.row.ftsKey ||
                  !props.row.isSchemaField ||
                  !props.row.showValues
                "
                class="field-container flex content-center ellipsis q-pl-lg full-width"
                :title="props.row.name"
              >
                <div
                  class="field_label full-width"
                  :data-test="`logs-field-list-item-${props.row.name}`"
                >
                  <div
                    class="ellipsis"
                    style="max-width: 90% !important; display: inline-block"
                  >
                    {{ props.row.name }}
                  </div>
                  <span class="float-right">
                    <q-icon
                      :data-test="`log-search-index-list-interesting-${props.row.name}-field-btn`"
                      v-if="
                        searchObj.meta.quickMode &&
                        props.row.name !== store.state.zoConfig.timestamp_column
                      "
                      :name="
                        props.row.isInterestingField ? 'info' : 'info_outline'
                      "
                      :class="
                        store.state.theme === 'dark' ? '' : 'light-dimmed'
                      "
                      style="margin-right: 0.375rem"
                      size="1.1rem"
                      :title="
                        props.row.isInterestingField
                          ? 'Remove from interesting fields'
                          : 'Add to interesting fields'
                      "
                    />
                  </span>
                </div>
                <div class="field_overlay" v-if="props.row.name !== store.state.zoConfig.timestamp_column">
                  <q-btn
                    v-if="
                      props.row.isSchemaField &&
                      props.row.name != store.state.zoConfig.timestamp_column
                    "
                    :icon="outlinedAdd"
                    :data-test="`log-search-index-list-filter-${props.row.name}-field-btn`"
                    style="margin-right: 0.375rem"
                    size="0.4rem"
                    class="q-mr-sm"
                    @click.stop="addToFilter(`${props.row.name}=''`)"
                    round
                  />
                  <q-icon
                    :data-test="`log-search-index-list-add-${props.row.name}-field-btn`"
                    v-if="
                      !searchObj.data.stream.selectedFields.includes(
                        props.row.name,
                      ) && props.row.name !== store.state.zoConfig.timestamp_column
                    "
                    :name="outlinedVisibility"
                    style="margin-right: 0.375rem"
                    size="1.1rem"
                    title="Add field to table"
                    @click.stop="clickFieldFn(props.row, props.pageIndex)"
                  />
                  <q-icon
                    :data-test="`log-search-index-list-remove-${props.row.name}-field-btn`"
                    v-if="
                      searchObj.data.stream.selectedFields.includes(
                        props.row.name,
                      )
                    "
                    :name="outlinedVisibilityOff"
                    style="margin-right: 0.375rem"
                    size="1.1rem"
                    title="Remove field from table"
                    @click.stop="clickFieldFn(props.row, props.pageIndex)"
                  />
                  <q-icon
                    :data-test="`log-search-index-list-interesting-${props.row.name}-field-btn`"
                    v-if="
                      searchObj.meta.quickMode &&
                      props.row.name !== store.state.zoConfig.timestamp_column
                    "
                    :name="
                      props.row.isInterestingField ? 'info' : 'info_outline'
                    "
                    size="1.1rem"
                    :title="
                      props.row.isInterestingField
                        ? 'Remove from interesting fields'
                        : 'Add to interesting fields'
                    "
                    @click.stop="
                      addToInterestingFieldList(
                        props.row,
                        props.row.isInterestingField,
                      )
                    "
                  />
                </div>
              </div>
              <q-expansion-item
                v-else
                dense
                switch-toggle-side
                :label="props.row.name"
                expand-icon-class="field-expansion-icon"
                expand-icon="
                  expand_more
                "
                expanded-icon="
                  expand_less
                "
                @before-show="
                  (event: any) => openFilterCreator(event, props.row)
                "
                @before-hide="(event: any) => cancelFilterCreator(props.row)"
              >
                <template v-slot:header>
                  <div
                    class="flex content-center ellipsis full-width"
                    :title="props.row.name"
                    :data-test="`log-search-expand-${props.row.name}-field-btn`"
                  >
                    <div
                      class="field_label full-width"
                      :data-test="`logs-field-list-item-${props.row.name}`"
                    >
                      <div
                        class="ellipsis"
                        style="max-width: 90% !important; display: inline-block"
                      >
                        {{ props.row.name }}
                      </div>
                      <span class="float-right">
                        <q-icon
                          :data-test="`log-search-index-list-interesting-${props.row.name}-field-btn`"
                          v-if="searchObj.meta.quickMode"
                          :name="
                            props.row.isInterestingField
                              ? 'info'
                              : 'info_outline'
                          "
                          :class="
                            store.state.theme === 'dark' ? '' : 'light-dimmed'
                          "
                          style="margin-right: 0.375rem"
                          size="1.1rem"
                          :title="
                            props.row.isInterestingField
                              ? 'Remove from interesting fields'
                              : 'Add to interesting fields'
                          "
                        />
                      </span>
                    </div>
                    <div class="field_overlay">
                      <q-btn
                        v-if="props.row.isSchemaField"
                        :data-test="`log-search-index-list-filter-${props.row.name}-field-btn`"
                        :icon="outlinedAdd"
                        style="margin-right: 0.375rem"
                        size="0.4rem"
                        class="q-mr-sm"
                        @click.stop="addToFilter(`${props.row.name}=''`)"
                        round
                      />
                      <q-icon
                        :data-test="`log-search-index-list-add-${props.row.name}-field-btn`"
                        v-if="
                          !searchObj.data.stream.selectedFields.includes(
                            props.row.name,
                          )
                        "
                        :name="outlinedVisibility"
                        style="margin-right: 0.375rem"
                        size="1.1rem"
                        title="Add field to table"
                        @click.stop="clickFieldFn(props.row, props.pageIndex)"
                      />
                      <q-icon
                        :data-test="`log-search-index-list-remove-${props.row.name}-field-btn`"
                        v-if="
                          searchObj.data.stream.selectedFields.includes(
                            props.row.name,
                          )
                        "
                        :name="outlinedVisibilityOff"
                        style="margin-right: 0.375rem"
                        title="Remove field from table"
                        size="1.1rem"
                        @click.stop="clickFieldFn(props.row, props.pageIndex)"
                      />
                      <q-icon
                        :data-test="`log-search-index-list-interesting-${props.row.name}-field-btn`"
                        v-if="searchObj.meta.quickMode"
                        :name="
                          props.row.isInterestingField ? 'info' : 'info_outline'
                        "
                        size="1.1rem"
                        :title="
                          props.row.isInterestingField
                            ? 'Remove from interesting fields'
                            : 'Add to interesting fields'
                        "
                        @click.stop="
                          addToInterestingFieldList(
                            props.row,
                            props.row.isInterestingField,
                          )
                        "
                      />
                    </div>
                  </div>
                </template>
                <q-card>
                  <q-card-section class="q-pl-md q-pr-xs q-py-xs">
                    <div class="filter-values-container">
                      <div
                        v-show="fieldValues[props.row.name]?.isLoading"
                        class="q-pl-md q-py-xs"
                        style="height: 60px"
                      >
                        <q-inner-loading
                          size="xs"
                          :showing="fieldValues[props.row.name]?.isLoading"
                          label="Fetching values..."
                          label-style="font-size: 1.1em"
                        />
                      </div>
                      <div
                        v-show="
                          !fieldValues[props.row.name]?.values?.length &&
                          !fieldValues[props.row.name]?.isLoading
                        "
                        class="q-pl-md q-py-xs text-subtitle2"
                      >
                        {{
                          fieldValues[props.row.name]?.errMsg ||
                          "No values found"
                        }}
                      </div>
                      <div
                        v-for="value in fieldValues[props.row.name]?.values ||
                        []"
                        :key="value.key"
                      >
                        <q-list dense>
                          <q-item
                            tag="label"
                            class="q-pr-none"
                            :data-test="`logs-search-subfield-add-${props.row.name}-${value.key}`"
                          >
                            <div
                              class="flex row wrap justify-between"
                              :style="
                                searchObj.data.stream.selectedStream.length ==
                                props.row.streams.length
                                  ? 'width: calc(100% - 42px)'
                                  : 'width: calc(100% - 0px)'
                              "
                            >
                              <div
                                :title="value.key"
                                class="ellipsis q-pr-xs"
                                style="width: calc(100% - 50px)"
                              >
                                {{ value.key }}
                              </div>
                              <div
                                :title="value.count.toString()"
                                class="ellipsis text-right q-pr-sm"
                                style="display: contents"
                                :style="
                                  searchObj.data.stream.selectedStream.length ==
                                  props.row.streams.length
                                    ? 'width: 50px'
                                    : ''
                                "
                              >
                                {{ formatLargeNumber(value.count) }}
                              </div>
                            </div>
                            <div
                              v-if="
                                searchObj.data.stream.selectedStream.length ==
                                props.row.streams.length
                              "
                              class="flex row"
                              :class="
                                store.state.theme === 'dark'
                                  ? 'text-white'
                                  : 'text-black'
                              "
                            >
                              <q-btn
                                class="q-mr-xs"
                                size="6px"
                                @click="
                                  addSearchTerm(
                                    props.row.name,
                                    value.key,
                                    'include',
                                  )
                                "
                                title="Include Term"
                                round
                                :data-test="`log-search-subfield-list-equal-${props.row.name}-field-btn`"
                              >
                                <q-icon>
                                  <EqualIcon></EqualIcon>
                                </q-icon>
                              </q-btn>
                              <q-btn
                                size="6px"
                                @click="
                                  addSearchTerm(
                                    props.row.name,
                                    value.key,
                                    'exclude',
                                  )
                                "
                                title="Exclude Term"
                                round
                                :data-test="`log-search-subfield-list-not-equal-${props.row.name}-field-btn`"
                              >
                                <q-icon>
                                  <NotEqualIcon></NotEqualIcon>
                                </q-icon>
                              </q-btn>
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
          <q-tr v-if="searchObj.loadingStream == true">
            <q-td colspan="100%" class="text-bold" style="opacity: 0.7">
              <div class="text-subtitle2 text-weight-bold">
                <q-spinner-hourglass size="20px" />
                {{ t("confirmDialog.loading") }}
              </div>
            </q-td>
          </q-tr>
        </template>
        <template v-slot:pagination="scope">
          <div v-if="showUserDefinedSchemaToggle">
            <q-btn-toggle
              no-caps
              v-model="searchObj.meta.useUserDefinedSchemas"
              data-test="logs-page-field-list-user-defined-schema-toggle"
              class="schema-field-toggle q-mr-xs"
              toggle-color="primary"
              bordered
              size="8px"
              color="white"
              text-color="primary"
              @update:model-value="toggleSchema"
              :options="userDefinedSchemaBtnGroupOption"
            >
              <template v-slot:user_defined_slot>
                <div data-test="logs-user-defined-fields-btn">
                  <q-icon name="person"></q-icon>
                  <q-icon name="schema"></q-icon>
                  <q-tooltip
                    data-test="logs-page-fields-list-user-defined-fields-warning-tooltip"
                    anchor="center right"
                    self="center left"
                    max-width="300px"
                    class="text-body2"
                  >
                    <span class="text-bold" color="white">{{
                      t("search.userDefinedSchemaLabel")
                    }}</span>
                  </q-tooltip>
                </div>
              </template>
              <template v-slot:all_fields_slot>
                <div data-test="logs-all-fields-btn">
                  <q-icon name="schema"></q-icon>
                  <q-tooltip
                    data-test="logs-page-fields-list-all-fields-warning-tooltip"
                    anchor="center right"
                    self="center left"
                    max-width="300px"
                    class="text-body2"
                  >
                    <span class="text-bold" color="white">{{
                      t("search.allFieldsLabel")
                    }}</span>
                    <q-separator color="white" class="q-mt-xs q-mb-xs" />
                    {{ t("search.allFieldsWarningMsg") }}
                  </q-tooltip>
                </div>
              </template>
              <template
                v-slot:interesting_fields_slot
                v-if="searchObj.meta.quickMode"
              >
                <div data-test="logs-interesting-fields-btn">
                  <q-icon name="info" />
                  <q-icon name="schema"></q-icon>
                  <q-tooltip
                    anchor="center right"
                    self="center left"
                    max-width="300px"
                    class="text-body2"
                  >
                    <span class="text-bold" color="white">{{
                      t("search.showOnlyInterestingFields")
                    }}</span>
                  </q-tooltip>
                </div>
              </template>
            </q-btn-toggle>
          </div>
          <div v-else-if="searchObj.meta.quickMode">
            <q-btn-toggle
              no-caps
              v-model="showOnlyInterestingFields"
              data-test="logs-page-field-list-user-defined-schema-toggle"
              class="schema-field-toggle q-mr-xs"
              toggle-color="primary"
              bordered
              size="8px"
              color="white"
              text-color="primary"
              :options="selectedFieldsBtnGroupOption"
              @update:model-value="toggleInterestingFields"
            >
              <template v-slot:all_fields_slot>
                <div data-test="logs-all-fields-btn">
                  <q-icon name="schema"></q-icon>
                  <q-tooltip
                    data-test="logs-page-fields-list-all-fields-warning-tooltip"
                    anchor="center right"
                    self="center left"
                    max-width="300px"
                    class="text-body2"
                  >
                    <span class="text-bold" color="white">{{
                      t("search.allFieldsLabel")
                    }}</span>
                    <q-separator color="white" class="q-mt-xs q-mb-xs" />
                    {{ t("search.allFieldsWarningMsg") }}
                  </q-tooltip>
                </div>
              </template>
              <template
                v-slot:interesting_fields_slot
                v-if="searchObj.meta.quickMode"
              >
                <div data-test="logs-interesting-fields-btn">
                  <q-icon name="info" />
                  <q-icon name="schema"></q-icon>
                  <q-tooltip
                    anchor="center right"
                    self="center left"
                    max-width="300px"
                    class="text-body2"
                  >
                    <span class="text-bold" color="white">{{
                      t("search.showOnlyInterestingFields")
                    }}</span>
                  </q-tooltip>
                </div>
              </template>
            </q-btn-toggle>
          </div>
          <div class="col"></div>
          <div class="tw-flex tw-items-center tw-justify-end tw-gap-2">
            <div v-if="scope.pagesNumber > 1" class="field-list-pagination">
              <q-tooltip
                data-test="logs-page-fields-list-pagination-tooltip"
                anchor="center left"
                self="center right"
                max-width="300px"
                class="text-body2"
              >
                Total Fields:
                {{
                  searchObj.data.stream.selectedStream.length > 1
                    ? searchObj.data.stream.selectedStreamFields.length -
                      (searchObj.data.stream.selectedStream.length + 1)
                    : searchObj.data.stream.selectedStreamFields.length
                }}
              </q-tooltip>

              <!-- First page button -->
              <q-btn
                data-test="logs-page-fields-list-pagination-firstpage-button"
                icon="fast_rewind"
                color="primary"
                flat
                :disable="scope.isFirstPage"
                @click="scope.firstPage"
                class="pagination-nav-btn"
                aria-label="First page"
              />

              <!-- Page number buttons (3 at a time) -->
              <template v-for="page in getPageNumbers(scope.pagination.page, scope.pagesNumber)" :key="page">
                <q-btn
                  flat
                  :data-test="`logs-page-fields-list-pagination-page-${page}-button`"
                  :class="[
                    'pagination-page-btn',
                    scope.pagination.page === page ? 'pagination-page-active' : ''
                  ]"
                  @click="setPage(page)"
                  >{{ page }}</q-btn
                >
              </template>

              <!-- Last page button -->
              <q-btn
                data-test="logs-page-fields-list-pagination-lastpage-button"
                icon="fast_forward"
                color="primary"
                flat
                :disable="scope.isLastPage"
                @click="scope.lastPage"
                class="pagination-nav-btn"
                aria-label="Last page"
              />
            </div>
            <div class="field-list-reset">
              <q-icon
                name="restart_alt"
                data-test="logs-page-fields-list-reset-icon"
                class="cursor-pointer reset-icon"
                @click="resetSelectedFileds"
              />
              <q-tooltip
                data-test="logs-page-fields-list-reset-tooltip"
                anchor="center left"
                self="center right"
                max-width="300px"
                class="text-body2"
              >
                <span class="text-bold" color="white">{{
                  t("search.resetFields")
                }}</span>
              </q-tooltip>
            </div>
          </div>
        </template>
      </q-table>
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
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import useLogs from "../../composables/useLogs";
import {
  b64EncodeUnicode,
  getImageURL,
  convertTimeFromMicroToMilli,
  formatLargeNumber,
  useLocalInterestingFields,
  generateTraceContext,
  isWebSocketEnabled,
  isStreamingEnabled,
  b64EncodeStandard,
  addSpacesToOperators,
  deepCopy,
} from "../../utils/zincutils";
import streamService from "../../services/stream";
import {
  outlinedAdd,
  outlinedVisibility,
  outlinedVisibilityOff,
} from "@quasar/extras/material-icons-outlined";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep } from "lodash-es";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import searchService from "@/services/search";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { useSearchBar } from "@/composables/useLogs/useSearchBar";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { searchState } from "@/composables/useLogs/searchState";
import { useStreamFields } from "@/composables/useLogs/useStreamFields";

interface Filter {
  fieldName: string;
  selectedValues: string[];
  selectedOperator: string;
}
export default defineComponent({
  name: "ComponentSearchIndexSelect",
  components: { EqualIcon, NotEqualIcon },
  emits: ["setInterestingFieldInSQLQuery"],
  methods: {
    handleMultiStreamSelection() {
      // Clear the filter input when streams change
      //we will first check if qselect is there or not and then call the method
      //we will use the quasar next tick to ensure that the dom is updated before we call the method
      //we will also us the quasar's updateInputValue method to clear the input value
      this.$nextTick(() => {
        const indexListSelectField = this.$refs.streamSelect;
        if (indexListSelectField && indexListSelectField.updateInputValue) {
          indexListSelectField.updateInputValue("");
        }
      });
      this.onStreamChange("");
    },
    handleSingleStreamSelect(opt: any) {
      if (this.searchObj.data.stream.selectedStream.indexOf(opt.value) == -1) {
        this.searchObj.data.stream.selectedFields = [];
      }
      this.searchObj.data.stream.selectedStream = [opt.value];
      // Clear the filter input when single stream is selected
      //we will first check if qselect is there or not and then call the method
      //we will use the quasar next tick to ensure that the dom is updated before we call the method
      //we will also us the quasar's updateInputValue method to clear the input value
      this.$nextTick(() => {
        const indexListSelectField = this.$refs.streamSelect;
        if (indexListSelectField && indexListSelectField.updateInputValue) {
          indexListSelectField.updateInputValue("");
        }
      });
      this.onStreamChange("");
    },
  },
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const {
      reorderSelectedFields,
      getFilterExpressionByFieldType,
      extractValueQuery,
    } = useLogs();

    const { filterHitsColumns, extractFields } = useStreamFields();

    const { searchObj, streamSchemaFieldsIndexMapping } = searchState();

    const { onStreamChange, handleQueryData } = useSearchBar();
    const { validateFilterForMultiStream } = useSearchStream();

    const {fnParsedSQL, fnUnparsedSQL, updatedLocalLogFilterField} = logsUtils();

    const {
      fetchQueryDataWithWebSocket,
      sendSearchMessageBasedOnRequestId,
      cancelSearchQueryBasedOnRequestId,
    } = useSearchWebSocket();

    const { fetchQueryDataWithHttpStream } = useHttpStreaming();

    const traceIdMapper = ref<{ [key: string]: string[] }>({});

    const showOnlyInterestingFields = ref(false);

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
      };
    }> = ref({});

    const openedFilterFields = ref<string[]>([]);

    // New state to store field values with stream context
    const streamFieldValues: Ref<{
      [key: string]: {
        [stream: string]: {
          values: { key: string; count: number }[];
        };
      };
    }> = ref({});

    const streamTypes = [
      { label: t("search.logs"), value: "logs" },
      { label: t("search.enrichmentTables"), value: "enrichment_tables" },
    ];

    const showUserDefinedSchemaToggle = computed(() => {
      return (
        store.state.zoConfig.user_defined_schemas_enabled &&
        searchObj.meta.hasUserDefinedSchemas
      );
    });

    const streamList = computed(() => {
      return searchObj.data.stream.streamLists;
    });

    const checkSelectedFields = computed(() => {
      return (
        searchObj.data.stream.selectedFields &&
        searchObj.data.stream.selectedFields.length > 0
      );
    });

    watch(
      () => streamList.value,
      () => {
        if (streamOptions.value.length === 0) {
          streamOptions.value = streamList.value;
        }
      },
      {
        deep: true,
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
            searchObj.meta.useUserDefinedSchemas = "user_defined_schema";
          }
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

    const filterStreamFn = (val: string, update: any) => {
      update(() => {
        streamOptions.value = streamList.value;
        const needle = val.toLowerCase();
        streamOptions.value = streamOptions.value.filter(
          (v: any) => v.label.toLowerCase().indexOf(needle) > -1,
        );
      });
    };

    const selectedStream = ref("");

    // if interesting field is enabled, then set default tab as interesting fields
    // otherwise set default tab as user defined schema
    // store.state.zoConfig.interesting_field_enabled was set as interesting fields was getting set by default with _timestamp field
    function setDefaultFieldTab() {
      if (store.state.zoConfig.log_page_default_field_list === "uds") {
        searchObj.meta.useUserDefinedSchemas = "user_defined_schema";
        showOnlyInterestingFields.value = false;
      } else {
        searchObj.meta.useUserDefinedSchemas = "interesting_fields";
        showOnlyInterestingFields.value = true;
      }
    }

    const filterFieldFn = (rows: any, terms: any) => {
      var filtered = [];
      var includedFields: any = [];
      if (terms != "") {
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (
            rows[i]["name"].toLowerCase().includes(terms) &&
            includedFields.indexOf(rows[i]["name"]) == -1
          ) {
            filtered.push(rows[i]);
            includedFields.push(rows[i]["name"]);
          }
        }
      }
      return filtered;
    };

    const addToFilter = (field: any) => {
      searchObj.data.stream.addToFilter = field;
    };

    function clickFieldFn(row: { name: never }, pageIndex: number) {
      let selectedFields = reorderSelectedFields();

      if (selectedFields.includes(row.name)) {
        selectedFields = selectedFields.filter((v: any) => v !== row.name);
      } else {
        selectedFields.push(row.name);
      }

      searchObj.data.stream.selectedFields = selectedFields;

      searchObj.organizationIdentifier =
        store.state.selectedOrganization.identifier;
      updatedLocalLogFilterField();
      filterHitsColumns();
    }

    function resetSelectedFileds() {
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
      if (ftsKey) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      try {
        //maintaing  the opened fields
        openedFilterFields.value.push(name);
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

        fieldValues.value[name] = {
          isLoading: true,
          values: [],
          errMsg: "",
        };
        if (whereClause.trim() != "") {
          // validateFilterForMultiStream function called to get missingStreamMultiStreamFilter
          const validationFlag = validateFilterForMultiStream();
          if (!validationFlag) {
            fieldValues.value[name]["isLoading"] = false;
            fieldValues.value[name]["errMsg"] =
              "Filter is not valid for selected streams.";
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

            // Implement websocket based field values, check getQueryData in useLogs for websocket enabled
            if (
              isWebSocketEnabled(store.state) ||
              isStreamingEnabled(store.state)
            ) {
              fetchValuesWithWebsocket({
                fields: [name],
                size: 10,
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
                sql:
                  b64EncodeUnicode(
                    query_context.replace("[INDEX_NAME]", selectedStream),
                  ) || "",
              });
              continue;
            }

            //TODO : add comments for this in future
            //for future reference
            //values api using partition based api
            let queryToBeSent = query_context.replace(
              "[INDEX_NAME]",
              selectedStream,
            );

            const response = await getValuesPartition(
              startISOTimestamp,
              endISOTimestamp,
              name,
              queryToBeSent,
            );
            const partitions: any = response?.data.partitions || [];

            for (const partition of partitions) {
              try {
                //check if the field is opened because sometimes
                // user might close the field before all the subsequent requests are completed
                if (!openedFilterFields.value.includes(name)) {
                  return;
                }

                const res: any = await streamService.fieldValues({
                  org_identifier: store.state.selectedOrganization.identifier,
                  stream_name: selectedStream,
                  start_time: partition[0],
                  end_time: partition[1],
                  fields: [name],
                  size: 10,
                  query_context: b64EncodeUnicode(queryToBeSent) || "",
                  query_fn: query_fn,
                  action_id,
                  type: searchObj.data.stream.streamType,
                  clusters:
                    Object.hasOwn(searchObj.meta, "clusters") &&
                    searchObj.meta.clusters.length > 0
                      ? searchObj.meta.clusters.join(",")
                      : "",
                  traceparent: generateTraceContext().traceId,
                });

                if (res.data.hits.length) {
                  res.data.hits.forEach((item: any) => {
                    item.values.forEach((subItem: any) => {
                      const index = fieldValues.value[name]["values"].findIndex(
                        (value: any) => value.key === subItem.zo_sql_key,
                      );
                      if (index !== -1) {
                        fieldValues.value[name]["values"][index].count +=
                          parseInt(subItem.zo_sql_num);
                      } else {
                        fieldValues.value[name]["values"].push({
                          key: subItem.zo_sql_key,
                          count: parseInt(subItem.zo_sql_num),
                        });
                      }
                    });
                  });

                  if (fieldValues.value[name]["values"].length > 10) {
                    fieldValues.value[name]["values"].sort(
                      (a, b) => b.count - a.count,
                    );
                    fieldValues.value[name]["values"] = fieldValues.value[name][
                      "values"
                    ].slice(0, 10);
                  }
                }
              } catch (err: any) {
                console.error("Failed to fetch field values:", err);
                fieldValues.value[name].errMsg = "Failed to fetch field values";
              } finally {
                countTotal--;
                if (countTotal <= 0) {
                  fieldValues.value[name].isLoading = false;
                }
              }
            }
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
        $q.notify({
          type: "negative",
          message: "Error while fetching field values",
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
        $q.notify({
          type: "negative",
          message: "Failed to generate filter expression",
        });
      }
    };
    //   const query = searchObj.meta.sqlMode
    //     ? `SELECT * FROM "${searchObj.data.stream.selectedStream.value}"`
    //     : "";

    //   searchObj.data.editorValue = query;
    //   searchObj.data.query = query;

    //   handleQueryData();
    // };

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

    const pagination = ref({
      page: 1,
      rowsPerPage: 25,
    });

    const toggleSchema = async () => {
      // Reset pagination to page 1 before resetting fields
      pagination.value.page = 1;

      const isInterestingFields =
        searchObj.meta.useUserDefinedSchemas === "interesting_fields";

      if (isInterestingFields) {
        showOnlyInterestingFields.value = true;
      } else {
        showOnlyInterestingFields.value = false;
      }

      await resetFields();
    };

    const toggleInterestingFields = () => {
      // Reset pagination to page 1 before resetting fields
      pagination.value.page = 1;

      resetFields();
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
        ? "Select Stream"
        : "";
    });

    // ----- WebSocket Implementation -----

    const fetchValuesWithWebsocket = (payload: any) => {
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
      if (isWebSocketEnabled(store.state)) {
        fetchQueryDataWithWebSocket(payload, {
          open: sendSearchMessage,
          close: handleSearchClose,
          error: handleSearchError,
          message: handleSearchResponse,
          reset: handleSearchReset,
        }) as string;
        return;
      }

      if (isStreamingEnabled(store.state)) {
        fetchQueryDataWithHttpStream(payload, {
          data: handleSearchResponse,
          error: handleSearchError,
          complete: handleSearchClose,
          reset: handleSearchReset,
        });
        return;
      }
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
            message:
              "WebSocket connection terminated unexpectedly. Please check your network and try again",
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
          "Failed to fetch field values";
      }

      removeTraceId(request.queryReq.fields[0], request.traceId);
    };

    const handleSearchResponse = (payload: any, response: any) => {
      const fieldName = payload?.queryReq?.fields[0];
      const streamName = payload?.queryReq?.stream_name;

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
          };
        }

        // Initialize stream-specific values if not exists
        if (!streamFieldValues.value[fieldName]) {
          streamFieldValues.value[fieldName] = {};
        }

        streamFieldValues.value[fieldName][streamName] = {
          values: [],
        };

        // Process the results
        if (response.content.results.hits.length) {
          // Store stream-specific values
          const streamValues: { key: string; count: number }[] = [];

          response.content.results.hits.forEach((item: any) => {
            item.values.forEach((subItem: any) => {
              streamValues.push({
                key: subItem.zo_sql_key,
                count: parseInt(subItem.zo_sql_num),
              });
            });
          });

          // Update stream-specific values
          streamFieldValues.value[fieldName][streamName].values = streamValues;

          // Aggregate values across all streams
          const aggregatedValues: { [key: string]: number } = {};

          // Collect all values from all streams
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

          // Convert aggregated values to array and sort
          const aggregatedArray = Object.keys(aggregatedValues).map((key) => ({
            key,
            count: aggregatedValues[key],
          }));

          // Sort by count in descending order
          aggregatedArray.sort((a, b) => b.count - a.count);

          // Take top 10
          fieldValues.value[fieldName].values = aggregatedArray.slice(0, 10);
        }

        // Mark as not loading
        fieldValues.value[fieldName].isLoading = false;
      } catch (error) {
        console.error("Failed to fetch field values:", error);
        fieldValues.value[fieldName].errMsg = "Failed to fetch field values";
        fieldValues.value[fieldName].isLoading = false;
      }
    };

    const handleSearchReset = (data: any) => {
      const fieldName = data.payload.queryReq.fields[0];

      // Reset the main fieldValues state
      fieldValues.value[fieldName] = {
        values: [],
        isLoading: true,
        errMsg: "",
      };

      // Reset the streamFieldValues state for this field
      if (streamFieldValues.value[fieldName]) {
        streamFieldValues.value[fieldName] = {};
      }

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
      //if it is websocker based then cancel the trace id
      //else cancel the further value api calls using the openedFilterFields
      if (isWebSocketEnabled(store.state)) {
        cancelTraceId(row.name);
      } else {
        cancelValueApi(row.name);
      }
    };

    const cancelTraceId = (field: string) => {
      const traceIds = traceIdMapper.value[field];
      if (traceIds) {
        traceIds.forEach((traceId) => {
          cancelSearchQueryBasedOnRequestId({
            trace_id: traceId,
            org_id: store?.state?.selectedOrganization?.identifier,
          });
        });
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
        fieldValues.value[name].errMsg = "Failed to fetch field values";
      }
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
      getImageURL,
      filterStreamFn,
      openFilterCreator,
      addSearchTerm,
      fieldValues,
      streamTypes,
      outlinedAdd,
      outlinedVisibilityOff,
      outlinedVisibility,
      handleQueryData,
      onStreamChange,
      addToInterestingFieldList,
      extractFields,
      userDefinedSchemaBtnGroupOption,
      selectedFieldsBtnGroupOption,
      pagination,
      toggleSchema,
      toggleInterestingFields,
      streamFieldsRows: computed(() => {
        let expandKeys = Object.keys(
          searchObj.data.stream.expandGroupRows,
        ).reverse();

        const expandGroupRowsFieldCount = showOnlyInterestingFields.value
          ? searchObj.data.stream.interestingExpandedGroupRowsFieldCount
          : searchObj.data.stream.expandGroupRowsFieldCount;

        let startIndex = 0;
        // Iterate over the keys in reverse order
        let selectedStreamFields = cloneDeep(
          showOnlyInterestingFields.value
            ? searchObj.data.stream.selectedInterestingStreamFields
            : searchObj.data.stream.selectedStreamFields,
        );
        let count = 0;
        for (let key of expandKeys) {
          if (
            searchObj.data.stream.expandGroupRows[key] == false &&
            selectedStreamFields != undefined &&
            selectedStreamFields?.length > 0
          ) {
            startIndex =
              selectedStreamFields.length - expandGroupRowsFieldCount[key];
            if (startIndex > 0) {
              // console.log("startIndex", startIndex);
              // console.log("count", count);
              // console.log("selectedStreamFields", selectedStreamFields.length);
              // console.log(searchObj.data.stream.expandGroupRowsFieldCount[key]);
              // console.log("========");
              selectedStreamFields.splice(
                startIndex - count,
                expandGroupRowsFieldCount[key],
              );
            }
          } else {
            count += expandGroupRowsFieldCount[key];
          }
          count++;
        }
        // console.log(JSON.parse(JSON.stringify(selectedStreamFields)));
        return selectedStreamFields;
      }),
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
      hasUserDefinedSchemas,
      setPage,
    };
  },
});
</script>

<style scoped lang="scss"></style>
