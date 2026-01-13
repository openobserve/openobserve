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
  <div>
    <div class="column full-height">
      <DashboardHeader :title="title" backButton @back="close">
      </DashboardHeader>

      <div class="scrollable-content">
        <q-form greedy ref="addVariableForm" @submit="onSubmit">
          <div class="q-mt-md">
            <div class="q-mb-md">
              <q-select
                hint="Variables will be applied to all tabs and panels if global is selected."
                v-model="variableData.scope"
                :options="scopeOptions"
                label="Select variable scope"
                outlined
                dense
                emit-value
                map-options
                filled
                input-debounce="0"
                behavior="menu"
                use-input
                class="showLabelOnTop"
                popup-no-route-dismiss
                popup-content-style="z-index: 10001"
                data-test="dashboard-variable-scope-select"
              />
            </div>

            <!-- Tab selection section - shown only when scope is tabs or panels -->
            <div
              v-if="
                variableData.scope === 'tabs' || variableData.scope === 'panels'
              "
              class="q-mt-md q-mb-md"
            >
              <q-select
                hint="Variables will be available only in the selected tabs."
                v-model="selectedTabs"
                :options="tabsOptions"
                label="Select tabs"
                multiple
                stack-label
                outlined
                dense
                emit-value
                map-options
                @update:model-value="updatePanels"
                filled
                input-debounce="0"
                behavior="menu"
                use-input
                class="showLabelOnTop"
                popup-no-route-dismiss
                popup-content-style="z-index: 10001"
                data-test="dashboard-variable-tabs-select"
                :rules="[
                  (val: any) =>
                    (variableData.scope !== 'tabs' &&
                      variableData.scope !== 'panels') ||
                    (val && val.length > 0) ||
                    'At least one tab is required',
                ]"
              >
                <template v-slot:option="{ opt, selected, toggleOption }">
                  <q-item
                    v-if="opt.isTab"
                    class="bg-grey-3 text-bold text-dark"
                    style="pointer-events: none"
                  >
                    <q-item-section>{{ opt.label }}</q-item-section>
                  </q-item>
                  <q-item v-else v-ripple clickable @click="toggleOption(opt)">
                    <q-item-section side>
                      <q-checkbox
                        :model-value="selected"
                        @update:model-value="() => toggleOption(opt)"
                        dense
                        class="q-ma-none"
                        :data-test="`dashboard-variable-assign-tabs-${opt.value}`"
                      />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label>{{ opt.label }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </template>
              </q-select>
            </div>

            <!-- Panel selection section - shown only when scope is panels -->
            <div
              v-if="
                variableData.scope === 'panels' &&
                (selectedTabs.length > 0 || isFromAddPanel)
              "
              class="q-mt-md"
            >
              <q-select
                hint="Variables will be available only in the selected panels."
                v-model="selectedPanels"
                :options="groupedPanelsOptions"
                label="Select panels"
                stack-label
                multiple
                filled
                outlined
                dense
                input-debounce="0"
                behavior="menu"
                use-input
                class="showLabelOnTop q-mb-md"
                popup-no-route-dismiss
                popup-content-style="z-index: 10001"
                emit-value
                map-options
                data-test="dashboard-variable-panels-select"
                :rules="[
                  (val: any) =>
                    variableData.scope !== 'panels' ||
                    (val && val.length > 0) ||
                    'At least one panel is required',
                ]"
              >
                <template v-slot:option="{ opt, selected, toggleOption }">
                  <!-- Tab separator -->
                  <q-item
                    v-if="opt.isTab"
                    class="bg-grey-3 text-bold text-dark"
                    style="pointer-events: none"
                  >
                    <q-item-section>{{ opt.label }}</q-item-section>
                  </q-item>
                  <!-- Panel options (including Current Panel) -->
                  <q-item v-else v-ripple clickable @click="toggleOption(opt)">
                    <q-item-section side>
                      <q-checkbox
                        :model-value="selected"
                        @update:model-value="() => toggleOption(opt)"
                        dense
                        class="q-ma-none"
                        :data-test="`dashboard-variable-assign-panels-${opt.value}`"
                      />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label
                        :class="
                          opt.isCurrentPanel
                            ? 'text-primary text-weight-bold'
                            : ''
                        "
                      >
                        {{ opt.label }}
                      </q-item-label>
                    </q-item-section>
                  </q-item>
                </template>
              </q-select>
            </div>
          </div>
          <div class="col">
            <div>
              <q-select
                class="showLabelOnTop"
                stack-label
                input-debounce="0"
                dense
                v-model="variableData.type"
                :options="variableTypes"
                :label="t('dashboard.typeOfVariable')"
                option-value="value"
                map-options
                emit-value
                data-test="dashboard-variable-type-select"
                borderless
                hide-bottom-space
              ></q-select>
            </div>
            <div class="text-body1 text-bold q-mt-sm">
              {{ t("dashboard.addGeneralSettings") }}
            </div>
            <div class="row">
              <div class="textbox col">
                <q-input
                  v-model="variableData.name"
                  class="showLabelOnTop q-mr-sm"
                  :label="t('dashboard.nameOfVariable') + ' *'"
                  dense
                  borderless
                  hide-bottom-space
                  stack-label
                  :rules="[
                    (val: any) => !!val.trim() || 'Field is required!',
                    (val: any) =>
                      /^[a-zA-Z0-9_-]*$/.test(val) ||
                      'Only letters, numbers, hyphens (-), and underscores (_) are allowed.',
                  ]"
                  data-test="dashboard-variable-name"
                ></q-input>
              </div>
              <div class="textbox col">
                <q-input
                  v-model="variableData.label"
                  class="showLabelOnTop"
                  :label="t('dashboard.labelOfVariable')"
                  dense
                  stack-label
                  data-test="dashboard-variable-label"
                  borderless
                  hide-bottom-space
                ></q-input>
              </div>
            </div>
            <div
              class="tw:flex tw:justify-between tw:w-full text-body1 text-bold q-mt-sm"
              v-if="variableData.type !== 'dynamic_filters'"
            >
              <span>{{ t("dashboard.extraOptions") }}</span>
              <div
                v-if="variableData.type == 'custom' && variableData.multiSelect"
              ></div>
            </div>
            <div v-if="variableData.type == 'query_values'">
              <div class="row">
                <q-select
                  v-model="variableData.query_data.stream_type"
                  :label="t('dashboard.selectStreamType') + ' *'"
                  :options="data.streamType"
                  input-debounce="0"
                  behavior="menu"
                  hide-bottom-space
                  borderless
                  dense
                  stack-label
                  class="showLabelOnTop col no-case q-mr-sm"
                  @update:model-value="streamTypeUpdated"
                  :rules="[(val: any) => !!val || 'Field is required!']"
                  data-test="dashboard-variable-stream-type-select"
                ></q-select>
                <q-select
                  v-model="variableData.query_data.stream"
                  :label="t('dashboard.selectIndex') + ' *'"
                  :options="streamsFilteredOptions"
                  input-debounce="0"
                  behavior="menu"
                  use-input
                  borderless
                  hide-bottom-space
                  dense
                  stack-label
                  @filter="streamsFilterFn"
                  @update:model-value="streamUpdated"
                  option-value="name"
                  option-label="name"
                  emit-value
                  class="showLabelOnTop col no-case"
                  :rules="[(val: any) => !!val || 'Field is required!']"
                  data-test="dashboard-variable-stream-select"
                >
                </q-select>
              </div>
              <q-select
                v-model="variableData.query_data.field"
                :label="t('dashboard.selectField') + ' *'"
                stack-label
                use-input
                borderless
                dense
                hide-selected
                fill-input
                behavior="menu"
                input-debounce="0"
                :options="fieldsFilteredOptions"
                @filter="fieldsFilterFn"
                class="showLabelOnTop no-case"
                option-value="name"
                option-label="name"
                emit-value
                :rules="[(val: any) => !!val || 'Field is required!']"
                data-test="dashboard-variable-field-select"
              >
              </q-select>
              <div>
                <q-input
                  class="showLabelOnTop"
                  type="number"
                  v-model.number="variableData.query_data.max_record_size"
                  :label="t('dashboard.DefaultSize')"
                  dense
                  stack-label
                  data-test="dashboard-variable-max-record-size"
                  borderless
                  hide-bottom-space
                >
                  <q-btn
                    padding="xs"
                    round
                    flat
                    class="q-ml-sm"
                    no-caps
                    icon="info"
                    data-test="dashboard-variable-max-record-size-info"
                  >
                    <q-tooltip>{{ t("dashboard.maxRecordSize") }}</q-tooltip>
                  </q-btn>
                </q-input>
              </div>
              <div>
                <div class="flex flex-row">
                  <div
                    data-test="dashboard-query-values-filter"
                    class="text-body1 text-bold q-mt-lg"
                  >
                    Filters
                  </div>
                  <q-icon
                    class=""
                    style="margin-top: 25px; margin-left: 5px"
                    size="20px"
                    name="info_outline"
                    data-test="dashboard-variables-setting-filter-info"
                  >
                    <q-tooltip style="width: 250px">
                      In filters, you can use the value of another variable to
                      filter the current variable's value. This can be done by
                      using the other variable's name. For example:
                      <span class="bg-highlight">$variableName</span>.
                    </q-tooltip>
                  </q-icon>
                </div>
                <div class="row items-center" style="width: 100%">
                  <div
                    class="row no-wrap items-start q-mb-xs"
                    style="width: 100%"
                    v-for="(filter, index) in variableData.query_data.filter"
                    :key="index"
                  >
                    <q-select
                      emit-value
                      dense
                      hide-selected
                      fill-input
                      v-model="filter.name"
                      :display-value="filter.name ? filter.name : ''"
                      :options="fieldsFilteredOptions"
                      input-debounce="0"
                      behavior="menu"
                      @update:model-value="filterUpdated(index, $event)"
                      use-input
                      stack-label
                      option-label="name"
                      data-test="dashboard-query-values-filter-name-selector"
                      @filter="fieldsFilterFn"
                      :placeholder="filter.name ? '' : 'Select Field'"
                      class="col no-case q-ml-sm"
                      :rules="[
                        (val: any) => !!val.trim() || 'Field is required!',
                      ]"
                      style="max-width: 41%; width: 41%; flex-shrink: 0"
                      ><q-tooltip v-if="filter.name">
                        {{ filter.name }}
                      </q-tooltip>
                      <template v-slot:no-option>
                        <q-item>
                          <q-item-section class="text-italic text-grey"
                            >No Data Found</q-item-section
                          >
                        </q-item>
                      </template>
                    </q-select>
                    <q-select
                      dense
                      v-model="filter.operator"
                      :display-value="filter.operator ? filter.operator : ''"
                      style="width: 18%; flex-shrink: 0"
                      class="operator"
                      data-test="dashboard-query-values-filter-operator-selector"
                      :rules="[
                        (val: any) => !!val.trim() || 'Field is required!',
                      ]"
                      :options="[
                        '=',
                        '!=',
                        '>=',
                        '<=',
                        '>',
                        '<',
                        'IN',
                        'NOT IN',
                        'str_match',
                        'str_match_ignore_case',
                        'match_all',
                        're_match',
                        're_not_match',
                        'Contains',
                        'Not Contains',
                        'Starts With',
                        'Ends With',
                        'Is Null',
                        'Is Not Null',
                      ]"
                    />
                    <CommonAutoComplete
                      v-if="
                        !['Is Null', 'Is Not Null'].includes(filter.operator)
                      "
                      v-model="filter.value"
                      :items="dashboardVariablesFilterItems"
                      searchRegex="(?:^|[^$])\$?(\w+)"
                      :rules="[(val: any) => val?.length > 0 || 'Required']"
                      debounce="1000"
                      style="
                        margin-top: none !important;
                        width: 41% !important;
                        padding-bottom: 0px !important;
                        flex-shrink: 0;
                      "
                      placeholder="Enter Value"
                    ></CommonAutoComplete>
                    <q-btn
                      size="sm"
                      padding="12px 5px"
                      style="margin-bottom: 20px; flex-shrink: 0"
                      flat
                      dense
                      @click="removeFilter(index)"
                      icon="close"
                      :data-test="`dashboard-variable-adhoc-close-${index}`"
                    />
                  </div>
                </div>
                <div>
                  <q-btn
                    no-caps
                    icon="add"
                    no-outline
                    class="q-mt-sm el-border"
                    @click="addFilter"
                    data-test="dashboard-add-filter-btn"
                  >
                    Add Filter
                  </q-btn>
                </div>

                <!-- show error if filter has cycle -->
                <div v-show="filterCycleError" style="color: red">
                  {{ filterCycleError }}
                </div>
              </div>
            </div>
          </div>
          <div class="textbox" v-if="['constant'].includes(variableData.type)">
            <q-input
              class="showLabelOnTop"
              v-model="variableData.value"
              :label="t('dashboard.ValueOfVariable') + ' *'"
              data-test="dashboard-variable-constant-value"
              dense
              stack-label
              :rules="[(val: any) => !!val.trim() || 'Field is required!']"
            ></q-input>
          </div>
          <div class="textbox" v-if="['textbox'].includes(variableData.type)">
            <q-input
              class="showLabelOnTop"
              v-model="variableData.value"
              :label="t('dashboard.DefaultValue')"
              data-test="dashboard-variable-textbox-default-value"
              dense
              stack-label
              borderless
              hide-bottom-space
            ></q-input>
          </div>
          <div v-if="variableData.type == 'custom'">
            <div class="tw:flex">
              <div class="tw:w-6"></div>
              <div class="tw:flex-1 tw:font-semibold tw:text-gray-500">
                Label
              </div>
              <div class="tw:flex-1 tw:font-semibold tw:text-gray-500">
                Value
              </div>
              <div class="tw:w-12 tw:flex tw:flex-col tw:items-center">
                <span v-if="!variableData.multiSelect"> Default </span>
                <q-checkbox
                  v-if="variableData.multiSelect"
                  dense
                  v-model="customSelectAllModel"
                  data-test="dashboard-custom-variable-select-all-checkbox"
                  @click="onCustomSelectAllClick"
                  class="tw:ml-[0.4rem]"
                >
                  <q-tooltip anchor="top middle" self="bottom middle">
                    Default - Select All
                  </q-tooltip>
                </q-checkbox>
              </div>
              <div class="tw:w-[2.62rem]"></div>
            </div>
            <div
              v-for="(option, index) in variableData.options"
              :key="index"
              class="row"
            >
              <span class="tw:pt-3.5 tw:w-6">{{ index + 1 }}</span>
              <q-input
                dense
                filled
                outlined
                :rules="[(val: any) => !!val.trim() || 'Field is required!']"
                class="col textbox q-mr-sm"
                v-model="variableData.options[index].label"
                :data-test="`dashboard-custom-variable-${index}-label`"
                :placeholder="'Label ' + (index + 1)"
                name="label"
              />
              <q-input
                dense
                borderless
                hide-bottom-space
                :rules="[(val: any) => !!val.trim() || 'Field is required!']"
                class="col textbox q-mr-sm"
                v-model="variableData.options[index].value"
                :data-test="`dashboard-custom-variable-${index}-value`"
                :placeholder="'Value ' + (index + 1)"
                name="value"
              />
              <div class="tw:flex tw:w-12 tw:item-center tw:justify-center">
                <q-checkbox
                  dense
                  v-model="variableData.options[index].selected"
                  :data-test="`dashboard-custom-variable-${index}-checkbox`"
                  @click="onCheckboxClick(index)"
                  class="q-mb-lg"
                />
              </div>
              <div>
                <q-btn
                  flat
                  round
                  :disable="variableData?.options?.length === 1"
                  @click="removeField(index)"
                  :data-test="`dashboard-custom-variable-${index}-remove`"
                  icon="cancel"
                />
              </div>
            </div>
            <div class="flex flex-col">
              <q-btn
                no-caps
                icon="add"
                no-outline
                class="q-mt-md el-border"
                @click="addField()"
                >Add Option</q-btn
              >
            </div>
          </div>
          <!-- multiselect toggle for query values and custom variables-->
          <div
            v-if="['query_values', 'custom'].includes(variableData.type)"
            class="q-mt-md"
          >
            <q-toggle
              v-model="variableData.multiSelect"
              :label="t('dashboard.multiSelect')"
              data-test="dashboard-query_values-show_multiple_values"
              class="tw:h-[36px] -tw:ml-3 o2-toggle-button-lg"
              size="lg"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-toggle-button-lg-dark'
                  : 'o2-toggle-button-lg-light'
              "
            />
          </div>
          <!-- default value for multi select variables -->
          <!-- it can be first value or all values -->
          <div v-if="['query_values'].includes(variableData.type)">
            <div class="button-group multi-select-default-value-toggle">
              <div class="multi-select-default-value">By Default Select:</div>
              <div class="row">
                <div>
                  <button
                    data-test="dashboard-multi-select-default-value-toggle-first-value"
                    :class="
                      variableData.selectAllValueForMultiSelect === 'first'
                        ? 'selected'
                        : ''
                    "
                    class="button button-left"
                    type="button"
                    @click="variableData.selectAllValueForMultiSelect = 'first'"
                  >
                    First value
                  </button>
                </div>

                <div>
                  <button
                    data-test="dashboard-multi-select-default-value-toggle-all-values"
                    :class="
                      variableData.selectAllValueForMultiSelect === 'all'
                        ? 'selected'
                        : ''
                    "
                    type="button"
                    class="button button-middle"
                    @click="variableData.selectAllValueForMultiSelect = 'all'"
                  >
                    All values
                  </button>
                </div>

                <div>
                  <button
                    data-test="dashboard-multi-select-default-value-toggle-custom"
                    :class="
                      variableData.selectAllValueForMultiSelect === 'custom'
                        ? 'selected'
                        : ''
                    "
                    type="button"
                    class="button button-right"
                    @click="
                      variableData.selectAllValueForMultiSelect = 'custom'
                    "
                  >
                    Custom
                  </button>
                </div>
              </div>
            </div>
            <!-- if selectAllValueForMultiSelect is custom then show this input -->
            <div
              v-if="
                variableData.selectAllValueForMultiSelect === 'custom' &&
                variableData.type === 'query_values'
              "
            >
              <div
                v-for="(value, index) in variableData.multiSelect
                  ? variableData.customMultiSelectValue
                  : [variableData.customMultiSelectValue[0]]"
                :key="index"
                class="q-mt-md"
                style="flex-wrap: wrap"
              >
                <div class="flex q-mr-sm" style="width: 50%">
                  <q-input
                    dense
                    stack-label
                    class="col textbox showLabelOnTop"
                    v-model="variableData.customMultiSelectValue[index]"
                    name="value"
                    placeholder="Enter value"
                    :data-test="`dashboard-variable-custom-value-${index}`"
                    borderless
                    hide-bottom-space
                  />
                  <q-btn
                    v-if="variableData.multiSelect"
                    size="sm"
                    padding="12px 5px"
                    flat
                    dense
                    @click="removeCustomValue(index)"
                    icon="close"
                    :data-test="`dashboard-variable-custom-close-${index}`"
                  />
                </div>
              </div>

              <div
                v-if="variableData.multiSelect"
                class="flex"
                style="width: 50%"
              >
                <q-btn
                  no-caps
                  icon="add"
                  no-outline
                  class="q-mt-md el-border"
                  @click="addCustomValue"
                  data-test="dashboard-add-custom-value-btn"
                >
                </q-btn>
              </div>
            </div>
          </div>
          <!-- hide on dashboard toggle -->
          <div class="q-mt-md">
            <q-toggle
              v-model="variableData.hideOnDashboard"
              :label="t('dashboard.hideOnDashboard')"
              data-test="dashboard-variable-hide_on_dashboard"
              class="tw:h-[36px] -tw:ml-3 o2-toggle-button-lg"
              size="lg"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-toggle-button-lg-dark'
                  : 'o2-toggle-button-lg-light'
              "
            />
          </div>

          <!-- escape single quotes toggle -->
          <div>
            <div class="row items-center all-pointer-events">
              <q-toggle
                v-model="variableData.escapeSingleQuotes"
                :label="t('dashboard.escapeSingleQuotes')"
                class="tw:h-[36px] -tw:ml-3 o2-toggle-button-lg"
                size="lg"
                :class="
                  store.state.theme === 'dark'
                    ? 'o2-toggle-button-lg-dark'
                    : 'o2-toggle-button-lg-light'
                "
              />
              <div>
                <q-icon
                  class="q-ml-xs"
                  size="20px"
                  name="info"
                  data-test="dashboard-config-limit-info"
                />
                <q-tooltip
                  class="bg-grey-8"
                  anchor="top middle"
                  self="bottom middle"
                >
                  If enabled, single quotes will be escaped in the query. For
                  example, a value like `O'Reilly` will be replaced as
                  `O''Reilly`.
                </q-tooltip>
              </div>
            </div>
          </div>
        </q-form>
      </div>
      <div class="sticky-footer">
        <q-btn
          :label="t('dashboard.cancel')"
          class="o2-secondary-button tw:h-[36px]"
          :class="
            store.state.theme === 'dark'
              ? 'o2-secondary-button-dark'
              : 'o2-secondary-button-light'
          "
          flat
          @click="close"
          data-test="dashboard-variable-cancel-btn"
        />
        <q-btn
          type="submit"
          :loading="saveVariableApiCall.isLoading.value"
          class="o2-primary-button tw:h-[36px] q-ml-md"
          :class="
            store.state.theme === 'dark'
              ? 'o2-primary-button-dark'
              : 'o2-primary-button-light'
          "
          flat
          @click="addVariableForm?.submit()"
          data-test="dashboard-variable-save-btn"
          >Save</q-btn
        >
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  reactive,
  onMounted,
  onActivated,
  watch,
  toRef,
  toRaw,
  type Ref,
  computed,
  nextTick,
} from "vue";
import { useI18n } from "vue-i18n";
import { useSelectAutoComplete } from "../../../composables/useSelectAutocomplete";
import { useStore } from "vuex";
import {
  addVariable,
  getDashboard,
  updateVariable,
} from "../../../utils/commons";
import { useRoute } from "vue-router";
import { useLoading } from "../../../composables/useLoading";
import DashboardHeader from "./common/DashboardHeader.vue";
import useStreams from "@/composables/useStreams";
import {
  buildVariablesDependencyGraph,
  isGraphHasCycle,
} from "@/utils/dashboard/variables/variablesDependencyUtils";
import { getScopeType } from "@/utils/dashboard/variables/variablesScopeUtils";
import CommonAutoComplete from "@/components/dashboards/addPanel/CommonAutoComplete.vue";
import useNotifications from "@/composables/useNotifications";

export default defineComponent({
  name: "AddSettingVariable",
  props: ["variableName", "dashboardVariablesList", "isFromAddPanel"],
  components: { DashboardHeader, CommonAutoComplete },
  emits: ["close", "save"],
  setup(props, { emit }) {
    // Store dashboard data
    const dashboardData = ref<any>({ tabs: [] });

    // Store selected tabs and panels
    const selectedTabs = ref<string[]>([]);
    const selectedPanels = ref<string[]>([]);

    // Format tabs for selection from dashboard data
    const tabsOptions = computed(() =>
      dashboardData.value.tabs.map((tab: any) => ({
        label: tab.name,
        value: tab.tabId,
      })),
    );

    // Compute grouped panels options with tabs as separators
    const groupedPanelsOptions = computed(() => {
      // Check if we're editing an existing panel (panelId exists in route)
      const isEditingPanel = !!route.query.panelId;

      // If called from Add Panel and no tabs selected, show Current Panel at the top without grouping
      // But only if NOT editing an existing panel
      if (
        props.isFromAddPanel &&
        selectedTabs.value.length === 0 &&
        !isEditingPanel
      ) {
        return [
          {
            label: "Current Panel",
            value: "current_panel",
            isCurrentPanel: true,
          },
        ];
      }

      // Add existing panels grouped by tabs
      const options = dashboardData.value.tabs
        .filter((tab: any) => selectedTabs.value.includes(tab.tabId))
        .flatMap((tab: any) => {
          const panelOptions = [{ label: tab.name, isTab: true }];

          // Add "Current Panel" option first if from Add Panel
          // But only if NOT editing an existing panel
          if (props.isFromAddPanel && !isEditingPanel) {
            panelOptions.push({
              label: "Current Panel",
              value: "current_panel",
              isCurrentPanel: true,
            });
          }

          // Add existing panels from this tab
          panelOptions.push(
            ...(tab.panels || []).map((panel: any) => ({
              label: panel.title,
              value: panel.id,
            })),
          );

          return panelOptions;
        });

      return options;
    });
    const { t } = useI18n();
    const store = useStore();
    const addVariableForm: Ref<any> = ref(null);
    const data: any = reactive({
      schemaResponse: [],
      streamType: [
        "logs",
        "metrics",
        "traces",
        "enrichment_tables",
        "metadata",
      ],
      streams: [],
      currentFieldsList: [],

      // selected values
      selectedStreamFields: [],
    });
    const route = useRoute();
    const title = ref("Add Variable");
    const { getStreams, getStream } = useStreams();
    const {
      showErrorNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();
    // const model = ref(null)
    // const filteredStreams = ref([]);
    const variableTypes = ref([
      {
        label: t("dashboard.queryValues"),
        value: "query_values",
      },
      {
        label: t("dashboard.constant"),
        value: "constant",
      },
      {
        label: t("dashboard.textbox"),
        value: "textbox",
      },
      {
        label: t("dashboard.custom"),
        value: "custom",
      },
    ]);

    const variableData: any = reactive({
      name: "",
      label: "",
      type: "",
      query_data: {
        stream_type: "",
        stream: "",
        field: "",
        max_record_size: null,
        filter: [],
      },
      value: "",
      options: [
        {
          label: "",
          value: "",
          selected: true,
        },
      ],
      multiSelect: false,
      hideOnDashboard: false,
      selectAllValueForMultiSelect: "first",
      customMultiSelectValue: [],
      escapeSingleQuotes: false,
      // Add these properties for tab/panel binding
      scope: "global", // Can be 'global', 'tabs', or 'panels'
      tabs: [], // Store selected tab IDs
      panels: [], // Store selected panel IDs
    });

    const filterCycleError: any = ref("");

    // select all values as default value for custom typed variable
    const customSelectAllModel: any = ref(false);

    const scopeOptions = computed(() => [
      { label: "Global", value: "global" },
      { label: "Selected Tabs", value: "tabs" },
      { label: "Selected Panels", value: "panels" },
    ]);

    const handleCustomSelectAll = () => {
      // if all values are selected, then check customSelectAllModel = true
      if (variableData.options.every((option: any) => option.selected)) {
        customSelectAllModel.value = true;
      } else {
        customSelectAllModel.value = false;
      }
    };

    const addFilter = () => {
      if (!variableData.query_data.filter) {
        variableData.query_data.filter = [];
      }
      variableData.query_data.filter.push({
        name: "",
        operator: "=",
        value: "",
      });
    };
    // by default, use multiSelect as false
    if (!variableData.multiSelect) {
      variableData.multiSelect = false;
    }

    // by default, use hideOnDashboard as false
    if (!variableData.hideOnDashboard) {
      variableData.hideOnDashboard = false;
    }

    // by default, use selectAllValueForMultiSelect as 'first'
    if (!variableData.selectAllValueForMultiSelect) {
      variableData.selectAllValueForMultiSelect = "first";
    }

    // by default, use escapeSingleQuotes as false
    if (!variableData.escapeSingleQuotes) {
      variableData.escapeSingleQuotes = false;
    }

    const filterUpdated = (index: number, filter: any) => {
      variableData.query_data.filter[index].name = filter.name;
    };

    const removeFilter = (index: any) => {
      variableData.query_data.filter.splice(index, 1);
    };

    const editMode = ref(false);

    watch(
      () => variableData?.query_data?.max_record_size,
      (newVal, oldVal) => {
        if (newVal === "") {
          variableData.query_data.max_record_size = null;
        }
      },
    );

    // watch for filter changes and set default value for Is Null and Is Not Null operators
    watch(
      () => variableData?.query_data?.filter,
      (newValue) => {
        if (newValue && newValue.length > 0) {
          newValue.forEach((filter: any) => {
            if (["Is Null", "Is Not Null"].includes(filter.operator)) {
              filter.value = "";
            }
          });
        }
      },
      { deep: true },
    );

    onMounted(async () => {
      try {
        const data = await getDashboard(
          store,
          route.query.dashboard,
          route.query.folder,
        );

        dashboardData.value = data;

        if (props.variableName) {
          editMode.value = true;
          title.value = "Edit Variable";

          const variablesList = data.variables?.list || [];
          const variable = variablesList.find(
            (v: any) => v.name === props.variableName,
          );

          if (variable) {
            // First, set the basic variable data
            Object.assign(variableData, JSON.parse(JSON.stringify(variable)));

            // Set scope type correctly
            if (variable.panels?.length > 0) {
              variableData.scope = "panels";
            } else if (variable.tabs?.length > 0) {
              variableData.scope = "tabs";
            } else {
              variableData.scope = "global";
            }

            // Set initial values synchronously
            selectedTabs.value = variable.tabs ? [...variable.tabs] : [];
            selectedPanels.value = variable.panels ? [...variable.panels] : [];

            // Force update panel options
            nextTick(() => {
              if (variableData.scope === "panels") {
                updatePanels();
              }
            });
          }
          // for already created variable, need to add selected fields
          // check if variable type is custom
          if (variable?.type === "custom") {
            //  loop on on options, and assign selected = false if selected key is not found
            variable.options.forEach((option: any) => {
              if (option.selected === undefined || option.selected === null) {
                option.selected = false;
              }
            });

            // for custom, check if all are selected
            const allSelected = variable.options.every(
              (option: any) => option.selected === true,
            );
            if (allSelected) {
              customSelectAllModel.value = true;
            }
          }

          // Assign edit data to variableData
          Object.assign(variableData, variable);
        } else {
          // default variable type will be query_values
          variableData.type = "query_values";
          editMode.value = false;

          // Set default scope and selections when creating from Add Panel
          if (props.isFromAddPanel) {
            // Get current tab and panel from route
            const currentTabId = route.query.tab as string;
            const currentPanelId = route.query.panelId as string;

            // Set default scope to "panels"
            variableData.scope = "panels";

            // Set default tab selection to current tab
            if (currentTabId) {
              selectedTabs.value = [currentTabId];
            }

            // Set default panel selection
            // If editing an existing panel, select the actual panel ID
            // If creating a new panel, select "current_panel"
            if (currentPanelId) {
              selectedPanels.value = [currentPanelId];
            } else {
              selectedPanels.value = ["current_panel"];
            }

            // Force update panel options
            nextTick(() => {
              updatePanels();
            });
          }
        }
      } catch (error) {
        showErrorNotification("Failed to load dashboard data");
      }
    });

    // Modify the watch on scope
    watch(
      () => variableData.scope,
      (newScope) => {
        if (newScope === "global") {
          selectedTabs.value = [];
          selectedPanels.value = [];
        } else if (newScope === "tabs") {
          selectedPanels.value = [];
        } else if (newScope === "panels" && selectedTabs.value.length > 0) {
          nextTick(() => {
            updatePanels();
          });
        }
      },
      { immediate: true },
    );

    // Modify updatePanels function
    const updatePanels = () => {
      if (variableData.scope === "panels" && selectedTabs.value.length > 0) {
        const validPanelIds = dashboardData.value.tabs
          .filter((tab: any) => selectedTabs.value.includes(tab.tabId))
          .flatMap((tab: any) =>
            (tab.panels || []).map((panel: any) => panel.id),
          );

        // Keep only valid panels from the current selection
        // Also preserve "current_panel" if it exists (used when creating from Add Panel)
        selectedPanels.value = selectedPanels.value.filter(
          (id: any) => validPanelIds.includes(id) || id === "current_panel",
        );
      }
    };

    // Add a watch for selectedTabs
    watch(
      selectedTabs,
      (newTabs) => {
        if (variableData.scope === "panels") {
          nextTick(() => {
            updatePanels();
          });
        }
      },
      { deep: true },
    );

    // check if type is query_values then get stream list and field list
    watch(
      () => [variableData.type],
      async () => {
        if (variableData.type == "query_values") {
          // add query_data object if not have
          if (!variableData?.query_data) {
            variableData.query_data = {
              stream_type: "",
              stream: "",
              field: "",
              max_record_size: null,
            };
          }

          // if variable type is query_values
          // need to get the stream list
          // and followed by the field list
          try {
            // if stream type is exists
            if (variableData?.query_data?.stream_type) {
              // get all streams from current stream type
              const streamList: any = await getStreams(
                variableData?.query_data?.stream_type,
                false,
              );
              data.streams = streamList.list ?? [];

              // if stream type and stream is exists
              if (variableData?.query_data?.stream) {
                // get schema of that field using getstream
                const fieldWithSchema: any = await getStream(
                  variableData?.query_data?.stream,
                  variableData.query_data.stream_type,
                  true,
                );

                // assign the schema
                data.currentFieldsList = fieldWithSchema?.schema ?? [];
              } else {
                // reset field list array
                data.currentFieldsList = [];
              }
            } else {
              // reset stream and field list
              data.streams = [];
              data.currentFieldsList = [];
            }
          } catch (error: any) {
            showErrorNotification(error ?? "Failed to get stream fields", {
              timeout: 2000,
            });
          }
        }
      },
    );

    const addField = () => {
      // add new field for options
      variableData.options.push({
        label: "",
        value: "",
        selected: false,
      });

      // if all values are selected, then check customSelectAllModel = true
      handleCustomSelectAll();
    };

    const removeField = (index: any) => {
      if (variableData?.options?.length === 1) {
        return;
      }
      variableData.options.splice(index, 1);

      // if all values are selected, then check customSelectAllModel = true
      handleCustomSelectAll();
    };

    const saveVariableApiCall = useLoading(async () => await saveData());

    const saveData = async () => {
      const dashId = route.query.dashboard + "";

      // remove query_data if type is not query_values
      if (variableData.type !== "query_values") {
        delete variableData["query_data"];
      }

      // reset multi select config if type is not query_values or custom
      if (
        variableData.type !== "query_values" &&
        variableData.type !== "custom"
      ) {
        variableData.multiSelect = false;
        variableData.selectAllValueForMultiSelect = "";
        variableData.customMultiSelectValue = [];
      }
      // Set tabs and panels based on the selected scope
      if (variableData.scope === "global") {
        variableData.tabs = [];
        variableData.panels = [];
      } else if (variableData.scope === "tabs") {
        variableData.tabs = [...selectedTabs.value];
        variableData.panels = [];
      } else if (variableData.scope === "panels") {
        variableData.tabs = [...selectedTabs.value];

        // Keep "current_panel" in the panels array - it will be replaced with actual panel ID when panel is saved
        // Only replace it now if we're editing an existing panel (route.query.panelId exists)
        const panels = [...selectedPanels.value];
        const currentPanelIndex = panels.indexOf("current_panel");
        if (currentPanelIndex !== -1 && route.query.panelId) {
          // We're editing an existing panel, replace "current_panel" with actual panel ID
          panels[currentPanelIndex] = route.query.panelId as string;
        }
        // If no panelId in route, keep "current_panel" - it will be updated when panel is saved

        variableData.panels = panels;
      }

      // If called from Add Panel, emit the variable data instead of saving to DB
      if (props.isFromAddPanel) {
        emit("save", {
          variableData: toRaw(variableData),
          isEdit: editMode.value,
          oldVariableName: props.variableName,
        });
        return;
      }

      // Original logic: save to database via API
      if (editMode.value) {
        try {
          await updateVariable(
            store,
            dashId,
            props.variableName,
            toRaw(variableData),
            route.query.folder ?? "default",
          );
          emit("save");
        } catch (error: any) {
          if (error?.response?.status === 409) {
            showConfictErrorNotificationWithRefreshBtn(
              error?.response?.data?.message ??
                error?.message ??
                "Variable update failed",
            );
          } else {
            showErrorNotification(error.message ?? "Variable update failed", {
              timeout: 2000,
            });
          }
        }
      } else {
        try {
          await addVariable(
            store,
            dashId,
            variableData,
            route.query.folder ?? "default",
          );
          emit("save");
        } catch (error: any) {
          if (error?.response?.status === 409) {
            showConfictErrorNotificationWithRefreshBtn(
              error?.response?.data?.message ??
                error?.message ??
                "Variable creation failed",
            );
          } else {
            showErrorNotification(error.message ?? "Variable creation failed", {
              timeout: 2000,
            });
          }
        }
      }
    };

    // check if filter has cycle
    const isFilterHasCycle = async () => {
      try {
        // need all variables to check for cycle
        // get all variables data.
        let variablesData: any = JSON.parse(
          JSON.stringify(
            await getDashboard(
              store,
              route.query.dashboard,
              route.query.folder,
            ),
          ),
        )?.variables?.list;

        // current updated variable data need to merge/update in above variablesData.
        // temporary update variable list
        // if edit mode, then update the variable data
        if (editMode.value) {
          //if name already exists
          const variableIndex = variablesData.findIndex(
            (variable: any) => variable.name == props.variableName,
          );

          // Update the variable data in the list
          variablesData[variableIndex] = variableData;
        }
        // else, it's a new variable.
        else {
          variablesData.push(variableData);
        }

        // now, need to check whether filter has cycle or not
        // key: variable name
        // value: { parentVariables: list of parent variable names, childVariables: list of child variable names }
        let variablesDependencyGraph: any =
          buildVariablesDependencyGraph(variablesData);

        // if graph has cycle, it will return the cycle path
        // else it will return null
        const hasCycle = isGraphHasCycle(variablesDependencyGraph);
        if (hasCycle) {
          // filter has cycle, so show error and return
          filterCycleError.value = `Variables has cycle: ${hasCycle.join(
            "->",
          )} -> ${hasCycle[0]}`;
          return true;
        }

        // above conditions passed, so remove filter cycle error and return false
        filterCycleError.value = "";
        return false;
      } catch (err: any) {
        showErrorNotification(
          err?.message ??
            (editMode.value
              ? "Variable update failed"
              : "Variable creation failed"),
        );
        return true;
      }
    };

    const onSubmit = () => {
      // first, validate form values
      addVariableForm.value.validate().then(async (valid: any) => {
        if (!valid) {
          return false;
        }

        // check if filter has cycle
        if (await isFilterHasCycle()) {
          // filter has cycle, so show error and return
          return false;
        }

        // for custom, check at least one option is selected as default value
        if (
          variableData.type === "custom" &&
          variableData.options.every((option: any) => !option.selected)
        ) {
          showErrorNotification("Select at least one default option");
          return false;
        }

        // above conditions passed, so remove filter cycle error
        filterCycleError.value = "";

        // save the variable
        saveVariableApiCall.execute().catch((err: any) => {
          showErrorNotification(
            err?.message ??
              (editMode.value
                ? "Variable update failed"
                : "Variable creation failed"),
          );
        });
      });
    };

    // select filters
    const {
      filterFn: streamsFilterFn,
      filteredOptions: streamsFilteredOptions,
    } = useSelectAutoComplete(toRef(data, "streams"), "name");
    const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } =
      useSelectAutoComplete(toRef(data, "currentFieldsList"), "name");

    const streamTypeUpdated = async () => {
      // reset the stream and field
      variableData.query_data.stream = "";
      variableData.query_data.field = "";

      // if stream type is exists
      if (variableData.query_data.stream_type) {
        // get all streams from current stream type
        const streamList: any = await getStreams(
          variableData?.query_data?.stream_type,
          false,
        );

        // assign the stream list
        data.streams = streamList.list ?? [];
      } else {
        // reset stream list
        data.streams = [];
      }
    };

    const streamUpdated = async () => {
      // reset field list value
      variableData.query_data.field = "";

      try {
        // if stream type and stream is exists
        if (
          variableData.query_data.stream &&
          variableData.query_data.stream_type
        ) {
          // get schema of that field using getstream
          const fieldWithSchema: any = await getStream(
            variableData?.query_data?.stream,
            variableData.query_data.stream_type,
            true,
          );

          // assign the schema
          data.currentFieldsList = fieldWithSchema?.schema ?? [];
        } else {
          // reset field list
          data.currentFieldsList = [];
        }
      } catch (error: any) {
        showErrorNotification(error ?? "Failed to get stream fields", {
          timeout: 2000,
        });
      }
    };

    const close = () => {
      emit("close");
    };

    const dashboardVariablesFilterItems = computed(() => {
      // Get current variable's scope context
      const currentVarScope = variableData.scope || "global";
      const currentTabs = selectedTabs.value || [];
      const currentPanels = selectedPanels.value || [];

      // Filter variables based on visibility rules:
      // - Global variable: can see global only
      // - Tab variable: can see global + tab (same tab)
      // - Panel variable: can see global + tab (parent tab) + panel (same panel)
      const filteredVars = props.dashboardVariablesList.filter((v: any) => {
        // Exclude the current variable itself
        if (v.name === variableData.name) return false;

        const scopeType = getScopeType(v);

        // Global variables are always visible
        if (scopeType === "global") {
          return true;
        }

        // If current variable is global, it can only see other global variables
        if (currentVarScope === "global") {
          return false;
        }

        // Tab-scoped variables
        if (scopeType === "tabs") {
          if (currentVarScope === "tabs") {
            // Tab variables can see tab variables from the same tab
            const hasCommonTab = currentTabs.some((tab: string) =>
              v.tabs?.includes(tab),
            );
            return hasCommonTab;
          }

          if (currentVarScope === "panels") {
            // Panel variables can see tab variables from their parent tab
            const hasCommonTab = currentTabs.some((tab: string) =>
              v.tabs?.includes(tab),
            );
            return hasCommonTab;
          }
        }

        // Panel-scoped variables
        if (scopeType === "panels") {
          if (currentVarScope === "tabs") {
            // Tab variables cannot see panel variables (child level)
            return false;
          }

          if (currentVarScope === "panels") {
            // Panel variables can see panel variables from the same panel
            const hasCommonPanel = currentPanels.some((panel: string) =>
              v.panels?.includes(panel),
            );
            return hasCommonPanel;
          }
        }

        return false;
      });

      return filteredVars.map((it: any) => ({
        label: it.name,
        value: "$" + it.name,
      }));
    });

    // Add new custom value to the array
    const addCustomValue = () => {
      variableData.customMultiSelectValue.push("");
    };

    // Remove a custom value from the array by index
    const removeCustomValue = (index: number) => {
      variableData.customMultiSelectValue.splice(index, 1);
    };

    // watch on multi select value change
    watch(
      () => variableData?.multiSelect,
      (newVal) => {
        if (!newVal) {
          if (Array.isArray(variableData?.options)) {
            variableData.options.forEach((option: any, index: any) => {
              if (variableData.options[index]) {
                variableData.options[index].selected = false;
              }
            });

            if (variableData.options.length > 0 && variableData.options[0]) {
              variableData.options[0].selected = true;
            }
          }
        }
      },
    );

    watch(
      () => variableData.selectAllValueForMultiSelect,
      (newVal, oldVal) => {
        if (newVal != "custom") {
          variableData.customMultiSelectValue = [];
        }
      },
    );

    const onCheckboxClick = (index: any) => {
      if (!variableData.multiSelect) {
        variableData.options.forEach((option: any, i: any) => {
          variableData.options[i].selected = i === index;
        });
      }

      // if all values are selected, then check customSelectAllModel = true
      handleCustomSelectAll();
    };

    const onCustomSelectAllClick = () => {
      if (customSelectAllModel.value) {
        variableData.options.forEach((option: any) => {
          option.selected = true;
        });
      } else {
        variableData.options.forEach((option: any) => {
          option.selected = false;
        });
      }
    };

    return {
      variableData,
      store,
      t,
      data,
      streamsFilterFn,
      fieldsFilterFn,
      streamsFilteredOptions,
      fieldsFilteredOptions,
      variableTypes,
      streamTypeUpdated,
      streamUpdated,
      onActivated,
      removeField,
      addField,
      saveData,
      saveVariableApiCall,
      close,
      title,
      onSubmit,
      addVariableForm,
      addFilter,
      removeFilter,
      filterUpdated,
      filterCycleError,
      dashboardVariablesFilterItems,
      addCustomValue,
      removeCustomValue,
      onCheckboxClick,
      customSelectAllModel,
      onCustomSelectAllClick,
      selectedTabs,
      updatePanels,
      selectedPanels,
      tabsOptions,
      groupedPanelsOptions,
      scopeOptions,
      editMode,
    };
  },
});
</script>

<style lang="scss" scoped>
:deep(.no-case .q-field__native > :first-child) {
  text-transform: none !important;
}

// .textbox {
//   margin-top: 5px;
//   margin-bottom: 5px;
// }

.theme-dark .bg-highlight {
  background-color: #747474;
}

.theme-light .bg-highlight {
  background-color: #e7e6e6;
}

.multi-select-default-value-toggle {
  .button-group {
    border: 1px solid gray !important;
    border-radius: 9px;
  }

  .button {
    display: block;
    cursor: pointer;
    background-color: #f0eaea;
    border: none;
    font-size: 12px;
    padding: 6px 4px;
    color: black;
  }

  .button-left {
    border-top-left-radius: 4px;
    border-bottom-left-radius: 4px;
    color: black;
  }

  .button-right {
    border-top-right-radius: 4px;
    border-bottom-right-radius: 4px;
    color: black;
  }
  .selected {
    background-color: var(--q-primary) !important;
    color: white;
  }
}
.multi-select-default-value {
  margin-top: 5px;
  margin-bottom: 5px;
  font-size: 14px;
  font-weight: 600;
  color: #666666;
}

.q-field--with-bottom {
  padding-bottom: 0 !important;
}
.scrollable-content {
  overflow-y: auto;
  max-height: calc(100vh - 190px);
  &::-webkit-scrollbar {
    width: 6px;
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 4px;
  }
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
.sticky-footer {
  position: sticky;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 12px 0 8px 0;
  display: flex;
  justify-content: center;
  gap: 16px;
  z-index: 10;
  border-top: 1px solid #eee;
  box-shadow: rgb(240, 240, 240) 0px -4px 7px 0px;
}
</style>
