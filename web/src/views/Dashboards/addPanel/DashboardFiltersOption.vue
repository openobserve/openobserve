<template>
  <div>
    <div
      v-if="
        !(
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery && dashboardPanelData.data.queryType == 'sql'
        )
      "
      style="display: flex; flex-direction: row"
      class="q-pl-md"
    >
      <div class="layout-name">{{ t("panel.filters") }}</div>
      <span class="layout-separator">:</span>
      <div
        class="axis-container droppable scroll row"
        data-test="dashboard-filter-layout"
      >
        <div>
          <q-btn-group
            class="axis-field q-mr-sm q-my-xs"
            v-for="(filteredItem, index) in dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.filter"
            :key="index"
          >
            <div v-if="filteredItem.filterType === 'group'">
              <Group
                :group="filteredItem"
                @add-condition="addConditionToGroup"
                @add-group="addGroupToGroup"
                @remove-group="() => removeGroup(index)"
              />
            </div>
            <div v-else>
              {{ filteredItem }}
              <div v-if="showSelect">
                <q-select
                  v-model="addLabel"
                  dense
                  filled
                  :options="filterOptions"
                />
              </div>
              <q-btn
                square
                icon-right="arrow_drop_down"
                no-caps
                dense
                :no-wrap="true"
                color="primary"
                size="sm"
                :label="computedLabel(filteredItem, index)"
                :data-test="`dashboard-filter-item-${filteredItem.column}`"
                class="q-pl-sm"
              >
                <q-menu
                  class="q-pa-md"
                  @show="(e) => loadFilterItem(filteredItem.column)"
                  :data-test="`dashboard-filter-item-${filteredItem.column}-menu`"
                >
                  <q-select
                    v-model="selectedSchemas[index]"
                    :options="schemaOptions"
                    label="FieldList"
                    dense
                    filled
                    style="width: 100%"
                    use-input
                    borderless
                    hide-selected
                    fill-input
                    emit-value
                    @filter="filterStreamFn"
                  />
                  <div style="height: 100%">
                    <div class="q-pa-xs" style="height: 100%">
                      <div class="q-gutter-xs" style="height: 100%">
                        <q-tabs
                          v-model="
                            dashboardPanelData.data.queries[
                              dashboardPanelData.layout.currentQueryIndex
                            ].fields.filter[index].type
                          "
                          dense
                        >
                          <q-tab
                            dense
                            name="list"
                            :label="t('common.list')"
                            style="width: auto"
                            data-test="dashboard-filter-list-tab"
                          ></q-tab>
                          <q-tab
                            dense
                            name="condition"
                            :label="t('common.condition')"
                            style="width: auto"
                            data-test="dashboard-filter-condition-tab"
                          ></q-tab>
                        </q-tabs>
                        <q-separator></q-separator>
                        <q-tab-panels
                          dense
                          v-model="
                            dashboardPanelData.data.queries[
                              dashboardPanelData.layout.currentQueryIndex
                            ].fields.filter[index].type
                          "
                          animated
                          style="height: 100%"
                        >
                          <q-tab-panel
                            data-test="dashboard-filter-condition-panel"
                            dense
                            name="condition"
                            class="q-pa-none"
                          >
                            <div class="flex column" style="height: 220px">
                              <q-select
                                dense
                                filled
                                v-model="
                                  dashboardPanelData.data.queries[
                                    dashboardPanelData.layout.currentQueryIndex
                                  ].fields.filter[index].operator
                                "
                                :options="options"
                                :label="t('common.operator')"
                                data-test="dashboard-filter-condition-dropdown"
                                style="width: 100%"
                                :rules="[(val) => !!val || 'Required']"
                              />
                              <CommonAutoComplete
                                v-if="
                                  !['Is Null', 'Is Not Null'].includes(
                                    dashboardPanelData.data.queries[
                                      dashboardPanelData.layout
                                        .currentQueryIndex
                                    ].fields?.filter[index]?.operator
                                  )
                                "
                                :label="t('common.value')"
                                v-model="
                                  dashboardPanelData.data.queries[
                                    dashboardPanelData.layout.currentQueryIndex
                                  ].fields.filter[index].value
                                "
                                :items="dashboardVariablesFilterItems(index)"
                                searchRegex="(?:^|[^$])\$?(\w+)"
                                :rules="[(val: any) => val?.length > 0 || 'Required']"
                              ></CommonAutoComplete>
                            </div>
                          </q-tab-panel>
                          <q-tab-panel
                            data-test="dashboard-filter-list-panel"
                            dense
                            name="list"
                            class="q-pa-none"
                          >
                            <q-select
                              dense
                              filled
                              v-model="
                                dashboardPanelData.data.queries[
                                  dashboardPanelData.layout.currentQueryIndex
                                ].fields.filter[index].values
                              "
                              data-test="dashboard-filter-list-dropdown"
                              :options="dashboardPanelData.meta.filterValue.find((it: any)=>it.column == filteredItem.column)?.value"
                              :label="t('common.selectFilter')"
                              multiple
                              emit-value
                              map-options
                              :rules="[
                                (val) =>
                                  val.length > 0 || 'At least 1 item required',
                              ]"
                            >
                              <template v-slot:selected>
                                {{
                                  dashboardPanelData.data.queries[
                                    dashboardPanelData.layout.currentQueryIndex
                                  ].fields.filter[index].values[0]?.length > 15
                                    ? dashboardPanelData.data.queries[
                                        dashboardPanelData.layout
                                          .currentQueryIndex
                                      ].fields.filter[
                                        index
                                      ].values[0]?.substring(0, 15) + "..."
                                    : dashboardPanelData.data.queries[
                                        dashboardPanelData.layout
                                          .currentQueryIndex
                                      ].fields.filter[index].values[0]
                                }}

                                {{
                                  dashboardPanelData.data.queries[
                                    dashboardPanelData.layout.currentQueryIndex
                                  ].fields.filter[index].values?.length > 1
                                    ? " +" +
                                      (dashboardPanelData.data.queries[
                                        dashboardPanelData.layout
                                          .currentQueryIndex
                                      ].fields.filter[index].values?.length -
                                        1)
                                    : ""
                                }}
                              </template>
                              <template
                                v-slot:option="{
                                  itemProps,
                                  opt,
                                  selected,
                                  toggleOption,
                                }"
                              >
                                <q-item v-bind="itemProps">
                                  <q-item-section side>
                                    <q-checkbox
                                      dense
                                      :model-value="selected"
                                      data-test="dashboard-filter-item-input"
                                      @update:model-value="toggleOption(opt)"
                                    ></q-checkbox>
                                  </q-item-section>
                                  <q-item-section>
                                    <SanitizedHtmlRenderer
                                      :html-content="opt"
                                    />
                                  </q-item-section>
                                </q-item>
                              </template>
                            </q-select>
                          </q-tab-panel>
                        </q-tab-panels>
                      </div>
                    </div>
                  </div>
                </q-menu>
              </q-btn>
              <q-btn
                size="xs"
                dense
                @click="removeFilterItem(filteredItem.column)"
                icon="close"
              />
            </div>
          </q-btn-group>
          <q-btn icon="add" color="primary" size="xs" round>
            <q-menu v-model="showAddMenu">
              <q-list>
                <q-item clickable @click="() => addFilter('condition')">
                  <q-item-section>{{
                    t("common.addCondition")
                  }}</q-item-section>
                </q-item>
                <q-item clickable @click="() => addFilter('group')">
                  <q-item-section>{{ t("common.addGroup") }}</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>
        <div
          class="text-caption text-weight-bold text-center q-py-xs q-mt-xs"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.filter < 1
          "
          style="
            width: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
          "
        >
          {{ t("dashboard.addFieldMessage") }}
        </div>
      </div>
      <div></div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import { useI18n } from "vue-i18n";
import CommonAutoComplete from "@/components/dashboards/addPanel/CommonAutoComplete.vue";
import SanitizedHtmlRenderer from "@/components/SanitizedHtmlRenderer.vue";
import Group from "./Group.vue";

export default defineComponent({
  name: "DashboardFiltersOption",
  components: {
    CommonAutoComplete,
    SanitizedHtmlRenderer,
    Group,
  },
  props: ["dashboardData"],

  setup(props) {
    const { dashboardPanelData, removeFilterItem, loadFilterItem } =
      useDashboardPanelData();
    const { t } = useI18n();
    const showAddMenu = ref(false);
    const showSelect = ref(false);
    const addLabel = ref("AND");
    const selectedSchemas = ref<any[]>([]);

    const addFilter = (filterType: string) => {
      showAddMenu.value = false;
      showSelect.value = true;
      const currentQuery =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ];

      if (filterType === "condition") {
        const defaultCondition = {
          type: "list",
          column: "_timestamp",
          filterType: "condition",
          operator: null,
          value: null,
          condition: addLabel.value,
          values: ["1721204004048867"],
        };
        currentQuery.fields.filter.push(defaultCondition);
      } else if (filterType === "group") {
        const defaultGroup = {
          filterType: "group",
          conditions: [],
        };
        currentQuery.fields.filter.push(defaultGroup);
      }
    };

    const addConditionToGroup = (group: any) => {
      group.conditions.push({
        type: "list",
        column: "_timestamp",
        filterType: "condition",
        operator: null,
        value: null,
        condition: addLabel.value,
        values: ["1721204004048867"],
      });
    };

    const addGroupToGroup = (group: any) => {
      group.conditions.push({
        filterType: "group",
        conditions: [],
      });
    };

    const dashboardVariablesFilterItems = computed(
      () => (index: number) =>
        (props.dashboardData?.variables?.list ?? []).map((it: any) => {
          let value;
          const operator =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.filter[index].operator;

          if (operator === "Contains" || operator === "Not Contains") {
            value = it.multiSelect
              ? "(" + "$" + "{" + it.name + "}" + ")"
              : "$" + it.name;
          } else {
            value = it.multiSelect
              ? "(" + "$" + "{" + it.name + "}" + ")"
              : "'" + "$" + it.name + "'";
          }

          return {
            label: it.name,
            value: value,
          };
        })
    );

    const schemaOptions = computed(() =>
      dashboardPanelData.meta.stream.selectedStreamFields.map((field: any) => ({
        label: field.name,
        value: field.name,
      }))
    );

    const filterStreamFn = (search: any, update: any) => {
      const needle = search.toLowerCase().trim();

      update(() => {
        return schemaOptions.value.filter((option: any) =>
          option.label.toLowerCase().includes(needle)
        );
      });
    };

    const computedLabel = (filteredItem: any, index: number) => {
      return selectedSchemas.value[index] === undefined
        ? filteredItem.column
        : selectedSchemas.value[index];
    };

    const removeGroup = (groupIndex: number) => {
      const currentQuery =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ];
      currentQuery.fields.filter.splice(groupIndex, 1);
    };

    watch(dashboardPanelData, () => {
      console.log(
        "dashboardPanelData",
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.filter
      );
    });
    return {
      t,
      dashboardPanelData,
      loadFilterItem,
      removeFilterItem,
      options: [
        "=",
        "<>",
        ">=",
        "<=",
        ">",
        "<",
        "IN",
        "Contains",
        "Not Contains",
        "Is Null",
        "Is Not Null",
      ],
      filterOptions: ["AND", "OR"],
      dashboardVariablesFilterItems,
      showAddMenu,
      showSelect,
      addFilter,
      addLabel,
      selectedSchemas,
      schemaOptions,
      filterStreamFn,
      computedLabel,
      addConditionToGroup,
      addGroupToGroup,
      removeGroup,
    };
  },
});
</script>

<style lang="scss" scoped>
.axis-field {
  overflow: hidden;
}
:deep(.axis-field div) {
  display: flex;
}

:deep(.axis-field .q-btn--rectangle) {
  border-radius: 0%;
}

:deep(.axis-field .q-btn:before) {
  border: 0px solid transparent;
}

.axis-container {
  flex: 1;
  width: 100%;
  text-align: center;
  // white-space: nowrap;
  overflow-x: auto;
}
.layout-separator {
  display: flex;
  align-items: center;
  margin-left: 2px;
  margin-right: 2px;
}
.layout-name {
  white-space: nowrap;
  min-width: 130px;
  display: flex;
  align-items: center;
}
.droppable {
  border-color: transparent;
  border-style: dashed;
  border-width: 2px;
}

.q-menu {
  box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(0.5rem);
  border-radius: 0px;

  .q-virtual-scroll__content {
    padding: 0.5rem;
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
</style>
