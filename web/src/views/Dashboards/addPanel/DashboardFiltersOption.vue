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
                :group-index="index + 1"
                @add-condition="addConditionToGroup"
                @add-group="addGroupToGroup"
                @remove-group="() => removeGroup(index)"
                :schema-options="schemaOptions"
                :dashboard-variables-filter-items="
                  dashboardVariablesFilterItems(index)
                "
                :filter-value-options="filterValueOptions"
                :filter-options="filterOptions"
                :load-filter-item="loadFilterItem"
              />
            </div>
            <div v-else>
              <AddCondition
                :condition="filteredItem"
                :schema-options="schemaOptions"
                :dashboard-variables-filter-items="
                  dashboardVariablesFilterItems(index)
                "
                :filter-value-options="filterValueOptions"
                :filter-options="filterOptions"
                :load-filter-item="loadFilterItem"
                label="Condition"
                @remove-condition="removeFilterItem(filteredItem.column)"
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
import AddCondition from "./AddCondition.vue";

export default defineComponent({
  name: "DashboardFiltersOption",
  components: {
    CommonAutoComplete,
    SanitizedHtmlRenderer,
    Group,
    AddCondition,
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
          logicalOperator: addLabel.value,
          values: ["1721204004048867"],
        };
        currentQuery.fields?.filter.push(defaultCondition);
      } else if (filterType === "group") {
        const defaultGroup = {
          conditions: [],
          filterType: "group",
        };
        currentQuery.fields?.filter.push(defaultGroup);
      }
    };

    const addConditionToGroup = (group: any) => {
      group.conditions.push({
        type: "list",
        column: "_timestamp",
        filterType: "condition",
        operator: null,
        value: null,
        logicalOperator: addLabel.value,
        values: ["1721204004048867"],
      });
    };

    const addGroupToGroup = (group: any) => {
      group.conditions.push({
        conditions: [],
        filterType: "group",
      });
    };

    const removeGroup = (index: number) => {
      const currentQuery =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ];
      currentQuery.fields?.filter.splice(index, 1);
    };

    const dashboardVariablesFilterItems = (index: number) =>
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
      });

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

    const filterOptions: any = []; // Define your filter options array here
    const filterValueOptions: any = []; // Define your filter value options array here

    return {
      t,
      showAddMenu,
      showSelect,
      addLabel,
      selectedSchemas,
      dashboardPanelData,
      removeFilterItem,
      loadFilterItem,
      addFilter,
      addConditionToGroup,
      addGroupToGroup,
      removeGroup,
      dashboardVariablesFilterItems,
      schemaOptions,
      filterOptions,
      filterValueOptions,
    };
  },
});
</script>

<style lang="scss" scoped>
.layout-name {
  font-size: 14px;
  color: rgba(0, 0, 0, 0.87);
  margin-top: 10px;
}

.layout-separator {
  padding: 0 10px;
}

.axis-container {
  margin: 5px;
}
</style>
