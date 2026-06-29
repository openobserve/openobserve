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
  <div>
    <div class="tw:flex tw:flex-col tw:h-full">
      <DashboardHeader :title="title" backButton @back="close">
      </DashboardHeader>

      <div class="scrollable-content">
        <OForm
          greedy
          id="add-setting-variable-form"
          :form="form"
          class="tw:px-0.5"
        >
          <div class="tw:mt-3">
            <div class="tw:mb-3">
              <OFormSelect
                name="scope"
                :helpText="t('dashboard.variableScopeHelp')"
                :options="scopeOptions"
                :label="t('dashboard.selectVariableScope')"
                data-test="dashboard-variable-scope-select"
              />
            </div>

            <!-- Tab selection section - shown only when scope is tabs or panels -->
            <div
              v-if="
                variableData.scope === 'tabs' || variableData.scope === 'panels'
              "
              class="tw:mt-3 tw:mb-3"
            >
              <OFormSelect
                name="selectedTabs"
                help-text="Variables will be available only in the selected tabs."
                :options="tabsOptions"
                label="Select tabs"
                multiple
                searchable
                @update:model-value="updatePanels()"
                data-test="dashboard-variable-tabs-select"
              />
            </div>

            <!-- Panel selection section - shown only when scope is panels -->
            <div
              v-if="
                variableData.scope === 'panels' &&
                (selectedTabs.length > 0 || isFromAddPanel)
              "
              class="tw:mt-3"
            >
              <OFormSelect
                name="selectedPanels"
                help-text="Variables will be available only in the selected panels."
                :options="groupedPanelsOptions"
                label="Select panels"
                multiple
                searchable
                class="tw:mb-3"
                data-test="dashboard-variable-panels-select"
              />
            </div>
          </div>
          <div class="tw:flex tw:flex-col">
            <div>
              <OFormSelect
                name="type"
                class="showLabelOnTop"
                :options="variableTypes"
                :label="t('dashboard.typeOfVariable')"
                data-test="dashboard-variable-type-select"
              />
            </div>
            <div class="tw:text-base tw:font-bold tw:mt-4">
              {{ t("dashboard.addGeneralSettings") }}
            </div>
            <div class="tw:flex tw:gap-4 tw:mt-3">
              <div class="tw:flex-1 tw:flex tw:flex-col">
                <OFormInput
                  name="name"
                  :label="t('dashboard.nameOfVariable')"
                  required
                  data-test="dashboard-variable-name"
                />
              </div>
              <div class="tw:flex-1 tw:flex tw:flex-col">
                <OFormInput
                  name="label"
                  :label="t('dashboard.labelOfVariable')"
                  data-test="dashboard-variable-label"
                />
              </div>
            </div>
            <div
              class="tw:flex tw:justify-between tw:w-full tw:text-base tw:font-bold tw:mt-4"
              v-if="variableData.type !== 'dynamic_filters'"
            >
              <span>{{ t("dashboard.extraOptions") }}</span>
              <div
                v-if="variableData.type == 'custom' && variableData.multiSelect"
              ></div>
            </div>
            <div v-if="variableData.type == 'query_values'">
              <div class="tw:flex tw:gap-x-4 tw:items-end">
                <OFormSelect
                  name="query_data.stream_type"
                  :label="t('dashboard.selectStreamType')"
                  required
                  :options="streamTypeOptions"
                  class="tw:flex-1"
                  @update:model-value="streamTypeUpdated()"
                  data-test="dashboard-variable-stream-type-select"
                />
                <OFormSelect
                  name="query_data.stream"
                  :label="t('dashboard.selectIndex')"
                  required
                  :options="mergedStreamOptionsWithLabel"
                  labelKey="_displayLabel"
                  valueKey="name"
                  searchable
                  class="tw:flex-1"
                  @update:model-value="streamUpdated()"
                  data-test="dashboard-variable-stream-select"
                >
                  <template #tooltip>
                    <OTooltip max-width="250px">
                      <template #content>
                        {{ t('dashboard.streamSelectTooltip') }}
                      </template>
                    </OTooltip>
                  </template>
                </OFormSelect>
              </div>
              <div class="tw:flex tw:mt-4">
                <OFormSelect
                  name="query_data.field"
                  :label="t('dashboard.selectField')"
                  required
                  :options="mergedFieldOptionsWithLabel"
                  labelKey="_displayLabel"
                  valueKey="name"
                  searchable
                  class="tw:flex-1"
                  data-test="dashboard-variable-field-select"
                >
                  <template #tooltip>
                    <OTooltip max-width="250px">
                      <template #content>
                        {{ t('dashboard.fieldSelectTooltip') }}
                      </template>
                    </OTooltip>
                  </template>
                </OFormSelect>
              </div>
              <div class="tw:mt-4">
                <OFormInput
                  name="query_data.max_record_size"
                  type="number"
                  :label="t('dashboard.DefaultSize')"
                  data-test="dashboard-variable-max-record-size"
                >
                  <template #tooltip
                    ><OTooltip :content="t('dashboard.maxRecordSize')"
                  /></template>
                </OFormInput>
              </div>
              <div class="tw:mt-4">
                <div class="tw:flex tw:flex-row tw:items-center tw:gap-1.5">
                  <div
                    data-test="dashboard-query-values-filter"
                    class="tw:text-base tw:font-bold"
                  >
                    Filters
                  </div>
                  <OTooltip max-width="250px">
                    <OIcon
                      size="sm"
                      name="info-outline"
                      data-test="dashboard-variables-setting-filter-info"
                      class="tw:cursor-help"
                    />
                    <template #content>
                      {{ t('dashboard.filterInfoTooltip') }}
                      <span class="bg-highlight">$variableName</span>.
                    </template>
                  </OTooltip>
                </div>
                <div>
                  <div
                    class="tw:flex tw:flex-row tw:items-center tw:gap-x-2 tw:mb-4 tw:w-full tw:min-w-0"
                    v-for="(filter, index) in variableData.query_data.filter"
                    :key="index"
                  >
                    <OFormSelect
                      :name="`query_data.filter[${index}].name`"
                      :options="data.currentFieldsList"
                      labelKey="name"
                      valueKey="name"
                      searchable
                      :placeholder="filter.name ? '' : 'Select Field'"
                      :title="filter.name || undefined"
                      @update:model-value="filterUpdated(index, $event)"
                      data-test="dashboard-query-values-filter-name-selector"
                      class="tw:flex-[2] tw:min-w-0"
                    >
                      <template #empty>
                        <span class="tw:italic tw:text-gray-400"
                          >{{ t('dashboard.noDataFound') }}</span
                        >
                      </template>
                    </OFormSelect>
                    <OFormSelect
                      :name="`query_data.filter[${index}].operator`"
                      class="operator tw:flex-[1.5] tw:min-w-0"
                      data-test="dashboard-query-values-filter-operator-selector"
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
                    <OFormCombobox
                      v-if="
                        !['Is Null', 'Is Not Null'].includes(filter.operator)
                      "
                      :name="`query_data.filter[${index}].value`"
                      :items="dashboardVariablesFilterItems"
                      search-regex="(?:^|[^$])\$?(\w+)"
                      :debounce="1000"
                      class="tw:flex-[2] tw:min-w-0"
                      placeholder="Enter Value"
                      :data-test="`dashboard-query-values-filter-value-selector-${index}`"
                    />
                    <OButton
                      variant="ghost"
                      size="icon"
                      class="tw:flex-shrink-0"
                      @click="removeFilter(index)"
                      :data-test="`dashboard-variable-adhoc-close-${index}`"
                      icon-left="close"
                    >
                    </OButton>
                  </div>
                </div>
                <div>
                  <OButton
                    variant="outline"
                    size="sm"
                    @click="addFilter"
                    data-test="dashboard-add-filter-btn"
                    icon-left="add"
                  >
                    {{ t('dashboard.addFilter') }}
                  </OButton>
                </div>

                <!-- show error if filter has cycle -->
                <div v-show="filterCycleError" style="color: red" data-test="dashboard-variable-cycle-error">
                  {{ filterCycleError }}
                </div>
              </div>
            </div>
          </div>
          <div class="textbox" v-if="['constant'].includes(variableData.type)">
            <OFormInput
              name="value"
              :label="t('dashboard.ValueOfVariable')"
              required
              data-test="dashboard-variable-constant-value"
            />
          </div>
          <div class="textbox" v-if="['textbox'].includes(variableData.type)">
            <OFormInput
              name="value"
              :label="t('dashboard.DefaultValue')"
              data-test="dashboard-variable-textbox-default-value"
            />
          </div>
          <div v-if="variableData.type == 'custom'">
            <div class="tw:flex">
              <div class="tw:w-6"></div>
              <div class="tw:flex-1 tw:font-semibold tw:text-gray-500">
                {{ t('common.label') }}
              </div>
              <div class="tw:flex-1 tw:font-semibold tw:text-gray-500">
                {{ t('common.value') }}
              </div>
              <div class="tw:w-12 tw:flex tw:items-center tw:justify-center">
                <span v-if="!variableData.multiSelect"> Default </span>
                <OCheckbox
                  v-if="variableData.multiSelect"
                  v-model="customSelectAllModel"
                  data-test="dashboard-custom-variable-select-all-checkbox"
                  @click="onCustomSelectAllClick"
                >
                  <template #tooltip
                    ><OTooltip :content="t('dashboard.defaultSelectAll')"
                  /></template>
                </OCheckbox>
              </div>
              <div class="tw:w-6"></div>
            </div>
            <div
              v-for="(option, index) in variableData.options"
              :key="index"
              class="tw:flex"
            >
              <span class="tw:pt-3.5 tw:w-6">{{ index + 1 }}</span>
              <OFormInput
                :name="`options[${index}].label`"
                class="tw:flex-1 tw:mr-2"
                :data-test="`dashboard-custom-variable-${index}-label`"
                :placeholder="'Label ' + (index + 1)"
              />
              <OFormInput
                :name="`options[${index}].value`"
                class="tw:flex-1 tw:mr-2"
                :data-test="`dashboard-custom-variable-${index}-value`"
                :placeholder="'Value ' + (index + 1)"
              />
              <div class="tw:flex tw:w-12 tw:item-center tw:justify-center">
                <OFormCheckbox
                  :name="`options[${index}].selected`"
                  :data-test="`dashboard-custom-variable-${index}-checkbox`"
                  @click="onCheckboxClick(index)"
                />
              </div>
              <div>
                <OButton
                  variant="ghost"
                  size="icon"
                  :disabled="variableData?.options?.length === 1"
                  @click="removeField(index)"
                  :data-test="`dashboard-custom-variable-${index}-remove`"
                  icon-left="cancel"
                >
                </OButton>
              </div>
            </div>
            <div class="tw:flex tw:flex-col">
              <OButton
                variant="outline"
                size="sm"
                class="tw:mt-3 tw:w-fit"
                @click="addField()"
                data-test="dashboard-add-option-btn"
                icon-left="add"
              >
                {{ t('dashboard.addOption') }}
              </OButton>
            </div>
          </div>
          <!-- multiselect toggle for query values and custom variables-->
          <div
            v-if="['query_values', 'custom'].includes(variableData.type)"
            class="tw:mt-4"
          >
            <OFormSwitch
              name="multiSelect"
              :label="t('dashboard.multiSelect')"
              data-test="dashboard-query_values-show_multiple_values"
              size="lg"
            />
          </div>
          <!-- default value for multi select variables -->
          <!-- it can be first value or all values -->
          <div v-if="['query_values'].includes(variableData.type)">
            <div class="button-group multi-select-default-value-toggle">
              <div class="multi-select-default-value">{{ t('dashboard.byDefaultSelect') }}</div>
              <OFormToggleGroup name="selectAllValueForMultiSelect">
                <OToggleGroupItem
                  value="first"
                  size="sm"
                  data-test="dashboard-multi-select-default-value-toggle-first-value"
                  >{{ t('dashboard.firstValue') }}</OToggleGroupItem
                >
                <OToggleGroupItem
                  value="all"
                  size="sm"
                  data-test="dashboard-multi-select-default-value-toggle-all-values"
                  >{{ t('dashboard.allValues') }}</OToggleGroupItem
                >
                <OToggleGroupItem
                  value="custom"
                  size="sm"
                  data-test="dashboard-multi-select-default-value-toggle-custom"
                  >{{ t('dashboard.customValue') }}</OToggleGroupItem
                >
              </OFormToggleGroup>
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
                class="tw:mt-3"
                style="flex-wrap: wrap"
              >
                <div class="tw:flex tw:mr-2" style="width: 50%">
                  <OFormInput
                    :name="`customMultiSelectValue[${index}]`"
                    placeholder="Enter value"
                    :data-test="`dashboard-variable-custom-value-${index}`"
                  />
                  <OButton
                    v-if="variableData.multiSelect"
                    variant="ghost"
                    size="icon"
                    @click="removeCustomValue(index)"
                    :data-test="`dashboard-variable-custom-close-${index}`"
                    icon-left="close"
                  >
                  </OButton>
                </div>
              </div>

              <div
                v-if="variableData.multiSelect"
                class="tw:flex"
                style="width: 50%"
              >
                <OButton
                  variant="outline"
                  size="sm"
                  class="tw:mt-3"
                  @click="addCustomValue"
                  data-test="dashboard-add-custom-value-btn"
                  icon-left="add"
                >
                </OButton>
              </div>
            </div>
          </div>
          <!-- hide on dashboard toggle -->
          <div class="tw:mt-4">
            <OFormSwitch
              name="hideOnDashboard"
              :label="t('dashboard.hideOnDashboard')"
              data-test="dashboard-variable-hide_on_dashboard"
              size="lg"
            />
          </div>

          <!-- escape single quotes toggle -->
          <div class="tw:mt-4">
            <OFormSwitch
              name="escapeSingleQuotes"
              :label="t('dashboard.escapeSingleQuotes')"
              data-test="dashboard-variable-escape-single-quotes"
              size="lg"
            >
              <template #tooltip>
                <OTooltip max-width="300px">
                  <template #content>
                    {{ t('dashboard.escapeSingleQuotesTooltip') }}
                  </template>
                </OTooltip>
              </template>
            </OFormSwitch>
          </div>
        </OForm>
      </div>
      <div class="sticky-footer">
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="isSavingVariable"
          @click="close"
          data-test="dashboard-variable-cancel-btn"
          >{{ t("dashboard.cancel") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm-action"
          type="submit"
          form="add-setting-variable-form"
          :loading="isSavingVariable"
          data-test="dashboard-variable-save-btn"
          >{{ t("dashboard.save") }}</OButton
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
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import {
  makeAddSettingVariableSchema,
  type AddSettingVariableForm,
} from "./AddSettingVariable.schema";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useStreams from "@/composables/useStreams";
import {
  buildVariablesDependencyGraph,
  isGraphHasCycle,
} from "@/utils/dashboard/variables/variablesDependencyUtils";
import { getScopeType } from "@/utils/dashboard/variables/variablesScopeUtils";
import OFormCombobox from "@/lib/forms/Combobox/OFormCombobox.vue";
import useNotifications from "@/composables/useNotifications";

export default defineComponent({
  name: "AddSettingVariable",
  props: ["variableName", "dashboardVariablesList", "isFromAddPanel"],
  components: {
    DashboardHeader,
    OFormCombobox,
    OButton,
    OFormToggleGroup,
    OToggleGroupItem,
    OForm,
    OFormSelect,
    OFormInput,
    OFormSwitch,
    OFormCheckbox,
    OCheckbox,
    OTooltip,
    OIcon,
  },
  emits: ["close", "save"],
  setup(props, { emit }) {
    // Store dashboard data
    const dashboardData = ref<any>({ tabs: [] });

    // ── OForm owner wiring (rule ②/③: the form is the SOLE source, no mirror) ──
    // Every field is name=-owned inside <OForm>, but the v-if/v-for live in THIS
    // component's render scope (the owner), so it creates the form with useOForm
    // and reads it reactively with form.useStore — ONE source of truth, no copy.
    // `variableData` is a thin getter-VIEW over the form values (so the existing
    // read-sites keep working without a mirror); every write goes through
    // setFormField / form push/remove / form.reset. selectedTabs/selectedPanels
    // are top-level form fields read here for the scope v-if + panel pruning.
    const addSettingVariableDefaults = (): AddSettingVariableForm => ({
      scope: "global",
      selectedTabs: [],
      selectedPanels: [],
      type: "query_values",
      name: "",
      label: "",
      query_data: {
        stream_type: "",
        stream: "",
        field: "",
        max_record_size: null,
        filter: [],
      },
      value: "",
      options: [{ label: "", value: "", selected: true }],
      multiSelect: false,
      hideOnDashboard: false,
      selectAllValueForMultiSelect: "first",
      customMultiSelectValue: [],
      escapeSingleQuotes: false,
    });
    const addSettingVariableSchema = makeAddSettingVariableSchema();
    const form = useOForm<AddSettingVariableForm>({
      defaultValues: addSettingVariableDefaults(),
      schema: addSettingVariableSchema,
      // forward to the onSubmit defined below (avoids a TDZ ref at setup time)
      onSubmit: (value) => onSubmit(value),
    });

    // Programmatic writes (cascades, edit-prefill, scope resets, array add/remove)
    // all go through the single form — never by mutating a mirror.
    const setFormField = (name: string, val: unknown) =>
      form.setFieldValue(name, val);
    const formPush = (name: string, val: unknown) =>
      form.pushFieldValue(name, val);
    const formRemove = (name: string, index: number) =>
      form.removeFieldValue(name, index);

    // Reactive READS of the form values (rule ③: form.useStore, NOT a local copy).
    const formValues = form.useStore((s: any) => s.values);
    const selectedTabs = form.useStore((s: any) => s.values?.selectedTabs ?? []);
    const selectedPanels = form.useStore(
      (s: any) => s.values?.selectedPanels ?? [],
    );
    // Two-way FACADE over the form (rule ③: NO stored copy) — every existing
    // `variableData.x` read delegates to form.useStore and every top-level write
    // delegates to form.setFieldValue, so the form stays the single source of
    // truth. (Nested writes must use setFormField with a dotted path.)
    const fieldView = (key: string) => ({
      get: () => formValues.value?.[key],
      set: (v: unknown) => form.setFieldValue(key, v),
      enumerable: true,
    });
    const variableData: any = Object.defineProperties(
      {},
      {
        scope: fieldView("scope"),
        type: fieldView("type"),
        name: fieldView("name"),
        label: fieldView("label"),
        value: fieldView("value"),
        query_data: {
          get: () => formValues.value?.query_data ?? {},
          set: (v: unknown) => form.setFieldValue("query_data", v),
          enumerable: true,
        },
        options: {
          get: () => formValues.value?.options ?? [],
          set: (v: unknown) => form.setFieldValue("options", v),
          enumerable: true,
        },
        multiSelect: fieldView("multiSelect"),
        hideOnDashboard: fieldView("hideOnDashboard"),
        selectAllValueForMultiSelect: fieldView("selectAllValueForMultiSelect"),
        customMultiSelectValue: {
          get: () => formValues.value?.customMultiSelectValue ?? [],
          set: (v: unknown) => form.setFieldValue("customMultiSelectValue", v),
          enumerable: true,
        },
        escapeSingleQuotes: fieldView("escapeSingleQuotes"),
      },
    );
    // Form-driven Save spinner for the footer (outside <OForm>, linked by
    // form-id). isSubmitting resets even if the save throws.
    const isSavingVariable = form.useStore((s: any) => s.isSubmitting);


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
          const panelOptions: any[] = [{ label: tab.name, isTab: true }];

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
    const title = ref(t("dashboard.newVariable"));
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

    const filterCycleError: any = ref("");

    // select all values as default value for custom typed variable
    const customSelectAllModel: any = ref(false);

    const scopeOptions = computed(() => [
      { label: "Global", value: "global" },
      { label: "Selected Tabs", value: "tabs" },
      { label: "Selected Panels", value: "panels" },
    ]);

    const streamTypeOptions = computed(() =>
      data.streamType.map((t: string) => ({ label: t, value: t })),
    );

    const handleCustomSelectAll = () => {
      // if all values are selected, then check customSelectAllModel = true
      if (variableData.options.every((option: any) => option.selected)) {
        customSelectAllModel.value = true;
      } else {
        customSelectAllModel.value = false;
      }
    };

    const addFilter = () => {
      formPush("query_data.filter", {
        name: undefined,
        operator: "=",
        value: "",
      });
    };
    // Defaults (multiSelect / hideOnDashboard / selectAllValueForMultiSelect /
    // escapeSingleQuotes) are seeded by the schema defaults — no manual init.

    const filterUpdated = (index: number, value: any) => {
      setFormField(`query_data.filter[${index}].name`, value);
    };

    const removeFilter = (index: any) => {
      formRemove("query_data.filter", index);
    };

    const editMode = ref(false);

    watch(
      () => variableData?.query_data?.max_record_size,
      (newVal) => {
        if (newVal === "") {
          setFormField("query_data.max_record_size", null);
        }
      },
    );

    // watch for filter changes and clear value for Is Null / Is Not Null operators
    watch(
      () => variableData?.query_data?.filter,
      (newValue) => {
        if (newValue && newValue.length > 0) {
          newValue.forEach((filter: any, i: number) => {
            if (
              ["Is Null", "Is Not Null"].includes(filter.operator) &&
              filter.value
            ) {
              setFormField(`query_data.filter[${i}].value`, "");
            }
          });
        }
      },
      { deep: true },
    );

    // Map a saved variable (API shape, with tabs/panels) onto the form shape
    // (selectedTabs/selectedPanels + the scalar/array fields).
    const mapVariableToForm = (variable: any): AddSettingVariableForm => {
      const scope =
        variable.panels?.length > 0
          ? "panels"
          : variable.tabs?.length > 0
            ? "tabs"
            : "global";
      const options =
        variable.type === "custom"
          ? (variable.options ?? []).map((o: any) => ({
              ...o,
              selected: o.selected ?? false,
            }))
          : (variable.options ?? []);
      return {
        scope,
        selectedTabs: variable.tabs ? [...variable.tabs] : [],
        selectedPanels: variable.panels ? [...variable.panels] : [],
        type: variable.type ?? "query_values",
        name: variable.name ?? "",
        label: variable.label ?? "",
        query_data: {
          stream_type: variable.query_data?.stream_type ?? "",
          stream: variable.query_data?.stream ?? "",
          field: variable.query_data?.field ?? "",
          max_record_size: variable.query_data?.max_record_size ?? null,
          filter: variable.query_data?.filter ?? [],
        },
        value: variable.value ?? "",
        options,
        multiSelect: variable.multiSelect ?? false,
        hideOnDashboard: variable.hideOnDashboard ?? false,
        selectAllValueForMultiSelect:
          variable.selectAllValueForMultiSelect ?? "first",
        customMultiSelectValue: variable.customMultiSelectValue ?? [],
        escapeSingleQuotes: variable.escapeSingleQuotes ?? false,
      };
    };

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
          title.value = t("dashboard.editVariable");

          const variablesList = data.variables?.list || [];
          const variable = variablesList.find(
            (v: any) => v.name === props.variableName,
          );

          if (variable) {
            // Edit-prefill arrives async — seed the form via reset (rule ②:
            // form is the source; the read-only projection picks it up).
            await nextTick();
            form.reset(mapVariableToForm(variable));

            // Reflect "all selected" in the bare select-all checkbox (UI only).
            if (
              variable.type === "custom" &&
              (variable.options ?? []).length > 0 &&
              (variable.options ?? []).every((o: any) => o.selected === true)
            ) {
              customSelectAllModel.value = true;
            }

            if ((variable.panels?.length ?? 0) > 0) {
              nextTick(() => updatePanels());
            }
          }
        } else {
          editMode.value = false;
          // type defaults to "query_values" via :default-values.

          // Set default scope and selections when creating from Add Panel.
          if (props.isFromAddPanel) {
            const currentTabId = route.query.tab as string;
            const currentPanelId = route.query.panelId as string;
            await nextTick();
            setFormField("scope", "panels");
            if (currentTabId) setFormField("selectedTabs", [currentTabId]);
            setFormField(
              "selectedPanels",
              currentPanelId ? [currentPanelId] : ["current_panel"],
            );
            nextTick(() => updatePanels());
          }
        }
      } catch (error) {
        showErrorNotification("Failed to load dashboard data");
      }
    });

    // Modify the watch on scope — reset tab/panel selections via the form.
    watch(
      () => variableData.scope,
      (newScope) => {
        if (newScope === "global") {
          setFormField("selectedTabs", []);
          setFormField("selectedPanels", []);
        } else if (newScope === "tabs") {
          setFormField("selectedPanels", []);
        } else if (newScope === "panels" && selectedTabs.value.length > 0) {
          nextTick(() => {
            updatePanels();
          });
        }
      },
    );

    // Modify updatePanels function — prune the panel selection via the form.
    const updatePanels = () => {
      if (variableData.scope === "panels" && selectedTabs.value.length > 0) {
        const validPanelIds = dashboardData.value.tabs
          .filter((tab: any) => selectedTabs.value.includes(tab.tabId))
          .flatMap((tab: any) =>
            (tab.panels || []).map((panel: any) => panel.id),
          );

        // Keep only valid panels from the current selection
        // Also preserve "current_panel" if it exists (used when creating from Add Panel)
        const pruned = selectedPanels.value.filter(
          (id: any) => validPanelIds.includes(id) || id === "current_panel",
        );
        setFormField("selectedPanels", pruned);
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
          // query_data always exists via the schema defaults (no manual init).

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
                // Check if stream is a variable reference (contains $)
                const isVariableReference =
                  variableData.query_data.stream?.includes("$") ||
                  variableData.query_data.stream?.includes("{{");

                if (isVariableReference) {
                  // Don't fetch schema for variable references - field list will be empty
                  data.currentFieldsList = [];
                } else {
                  // get schema of that field using getstream (only for real streams)
                  const fieldWithSchema: any = await getStream(
                    variableData?.query_data?.stream,
                    variableData.query_data.stream_type,
                    true,
                  );

                  // assign the schema
                  data.currentFieldsList = fieldWithSchema?.schema ?? [];
                }
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
            // Check if the error is for a variable reference (should be suppressed)
            const isVariableReference =
              variableData?.query_data?.stream?.includes("$") ||
              variableData?.query_data?.stream?.includes("{{");

            if (!isVariableReference) {
              // Only show error if it's NOT a variable reference
              showErrorNotification(error ?? "Failed to get stream fields", {
                timeout: 2000,
              });
            }
          }
        }
      },
    );

    const addField = () => {
      // add new field for options
      formPush("options", {
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
      formRemove("options", index);

      // if all values are selected, then check customSelectAllModel = true
      handleCustomSelectAll();
    };

    // The validated @submit payload, captured for the useLoading save wrapper.
    let submitValue: AddSettingVariableForm | null = null;

    // Build the saved variable from the validated form value (rule ②): map
    // selectedTabs/selectedPanels → tabs/panels, drop query_data for non-query
    // types, reset multi-select config for non-list types.
    const buildVariablePayload = (value: AddSettingVariableForm): any => {
      const v: any = JSON.parse(JSON.stringify(value));
      if (v.scope === "global") {
        v.tabs = [];
        v.panels = [];
      } else if (v.scope === "tabs") {
        v.tabs = [...(v.selectedTabs ?? [])];
        v.panels = [];
      } else if (v.scope === "panels") {
        v.tabs = [...(v.selectedTabs ?? [])];
        const panels = [...(v.selectedPanels ?? [])];
        const currentPanelIndex = panels.indexOf("current_panel");
        if (currentPanelIndex !== -1 && route.query.panelId) {
          panels[currentPanelIndex] = route.query.panelId as string;
        }
        v.panels = panels;
      }
      delete v.selectedTabs;
      delete v.selectedPanels;

      if (v.type !== "query_values") delete v.query_data;
      if (v.type !== "query_values" && v.type !== "custom") {
        v.multiSelect = false;
        v.selectAllValueForMultiSelect = "";
        v.customMultiSelectValue = [];
      }
      return v;
    };

    const saveVariableApiCall = useLoading(async () => {
      if (!submitValue) return;
      await saveData(buildVariablePayload(submitValue));
    });

    const saveData = async (payload: any) => {
      const dashId = route.query.dashboard + "";

      // If called from Add Panel, emit the variable data instead of saving to DB
      if (props.isFromAddPanel) {
        emit("save", {
          variableData: payload,
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
            payload,
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
            payload,
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

          // Update the variable data in the list (use a plain snapshot of the
          // current form values — variableData is a getter view, not a clone).
          variablesData[variableIndex] = JSON.parse(
            JSON.stringify(form.state.values),
          );
        }
        // else, it's a new variable.
        else {
          variablesData.push(JSON.parse(JSON.stringify(form.state.values)));
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

    // @submit fires ONLY after the Zod schema passes — including the per-row
    // rules for the form-owned filter[]/options[] arrays (name/operator/value
    // and label/value, restoring §4 #6/#7). Here we only run the cross-field
    // checks that can't be expressed in Zod, then save.
    const onSubmit = async (value: AddSettingVariableForm) => {
      // The validated value is the source of truth (rule ②); stash it for the
      // save wrapper.
      submitValue = value;

      // When in AddPanel mode, check for duplicate variable names client-side
      // (dashboard settings relies on the server returning a 409 for this)
      if (props.isFromAddPanel && props.dashboardVariablesList) {
        const isDuplicate = props.dashboardVariablesList.some(
          (v: any) => v.name === value.name && v.name !== props.variableName,
        );
        if (isDuplicate) {
          showErrorNotification(`Variable with same name already exists.`);
          return;
        }
      }

      // check if filter has cycle
      if (await isFilterHasCycle()) {
        // filter has cycle, so show error and return
        return;
      }

      // for custom, check at least one option is selected as default value
      if (
        value.type === "custom" &&
        (value.options ?? []).every((option: any) => !option.selected)
      ) {
        showErrorNotification("Select at least one default option");
        return;
      }

      // above conditions passed, so remove filter cycle error
      filterCycleError.value = "";

      // save the variable — awaited so OForm's isSubmitting (→ the footer Save
      // spinner) spans the whole save.
      await saveVariableApiCall.execute().catch((err: any) => {
        showErrorNotification(
          err?.message ??
            (editMode.value
              ? "Variable update failed"
              : "Variable creation failed"),
        );
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
      // reset the stream and field (cross-field setFieldValue)
      setFormField("query_data.stream", "");
      setFormField("query_data.field", "");

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
      try {
        // Check if stream is a variable reference FIRST (contains $)
        const isVariableReference =
          variableData.query_data.stream?.includes("$") ||
          variableData.query_data.stream?.includes("{{");

        if (isVariableReference) {
          // Don't reset field if it already has a value (editing mode)
          if (!variableData.query_data.field) {
            setFormField("query_data.field", "");
          }
          // Don't fetch schema for variable references
          data.currentFieldsList = [];
          return;
        }

        // Only reset field list if NOT a variable reference
        setFormField("query_data.field", "");

        // if stream type and stream exists and NOT a variable
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
        // Only show error if it's not a variable reference
        const isVariableReference =
          variableData.query_data.stream?.includes("$") ||
          variableData.query_data.stream?.includes("{{");

        if (!isVariableReference) {
          showErrorNotification(error ?? "Failed to get stream fields", {
            timeout: 2000,
          });
        }
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

    // Merged stream options: variables + streams for q-select
    const mergedStreamOptions = computed(() => {
      const variableItems = dashboardVariablesFilterItems.value.map(
        (v: any) => ({ name: v.value }),
      );
      return [...variableItems, ...(data.streams || [])];
    });
    // Add display labels: append "(variable)" for $-prefixed or {{-prefixed option names
    const mergedStreamOptionsWithLabel = computed(() =>
      mergedStreamOptions.value.map((o: any) => ({
        ...o,
        _displayLabel:
          o.name?.startsWith("$") || o.name?.startsWith("{{")
            ? `${o.name} (variable)`
            : o.name,
      })),
    );

    // Merged field options: variables + fields for OSelect
    const mergedFieldOptions = computed(() => {
      const variableItems = dashboardVariablesFilterItems.value.map(
        (v: any) => ({ name: v.value }),
      );
      return [...variableItems, ...(data.currentFieldsList || [])];
    });

    const mergedFieldOptionsWithLabel = computed(() =>
      mergedFieldOptions.value.map((o: any) => ({
        ...o,
        _displayLabel:
          o.name?.startsWith("$") || o.name?.startsWith("{{")
            ? `${o.name} (variable)`
            : o.name,
      })),
    );

    // Add new custom value to the array
    const addCustomValue = () => {
      formPush("customMultiSelectValue", "");
    };

    // Remove a custom value from the array by index
    const removeCustomValue = (index: number) => {
      formRemove("customMultiSelectValue", index);
    };

    // watch on multi select value change — single-select keeps only the first
    // option selected (cross-field setFieldValue per row).
    watch(
      () => variableData?.multiSelect,
      (newVal) => {
        if (!newVal && Array.isArray(variableData?.options)) {
          variableData.options.forEach((_o: any, index: number) => {
            setFormField(`options[${index}].selected`, index === 0);
          });
        }
      },
    );

    watch(
      () => variableData.selectAllValueForMultiSelect,
      (newVal) => {
        if (newVal != "custom") {
          setFormField("customMultiSelectValue", []);
        }
      },
    );

    const onCheckboxClick = (index: any) => {
      if (!variableData.multiSelect) {
        variableData.options.forEach((_o: any, i: number) => {
          setFormField(`options[${i}].selected`, i === index);
        });
      }

      // if all values are selected, then check customSelectAllModel = true
      handleCustomSelectAll();
    };

    const onCustomSelectAllClick = () => {
      const selectAll = !!customSelectAllModel.value;
      variableData.options.forEach((_o: any, i: number) => {
        setFormField(`options[${i}].selected`, selectAll);
      });
    };

    return {
      form,
      variableData,
      isSavingVariable,
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
      addFilter,
      removeFilter,
      filterUpdated,
      filterCycleError,
      dashboardVariablesFilterItems,
      mergedStreamOptionsWithLabel,
      mergedFieldOptionsWithLabel,
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
      streamTypeOptions,
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
  padding-inline: 3px;
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

.theme-dark {
  .sticky-footer {
    border-top: 1px solid #333;
    box-shadow: rgb(20, 20, 20) 0px -4px 7px 0px;
  }

  .multi-select-default-value {
    color: #999;
  }

  .scrollable-content {
    &::-webkit-scrollbar-thumb {
      background: #4b5563;
    }
    scrollbar-color: #4b5563 transparent;
  }
}
</style>
