<template>
  <div
    data-test="dashboard-group"
    :style="`--group-index: ${groupNestedIndex};`"
    class="flex p-0 rounded-default bg-[color-mix(in_srgb,var(--color-brand-indigo)_calc(12%*var(--group-index)),transparent)]"
    :class="groupNestedIndex > 0 ? 'pl-1.25' : 'pl-0'"
  >
    <div class="flex flex-row flex-wrap items-center" data-test="dashboard-group-conditions">
      <div
        v-for="(condition, index) in group.conditions"
        :key="index"
        class="inline-flex items-center mr-2.5 min-h-8.75 gap-2"
        data-test="dashboard-group-condition-group"
      >
        <Group
          v-if="condition.filterType === 'group'"
          :group="condition"
          :group-nested-index="groupNestedIndex + 1"
          :group-index="index"
          :dashboard-variables-filter-items="dashboardVariablesFilterItems"
          :schema-options="schemaOptions"
          :load-filter-item="loadFilterItem"
          :dashboard-panel-data="dashboardPanelData"
          @add-condition="addConditionToGroup"
          @add-group="addGroupToGroup"
          @remove-group="removeGroupFromNested(index)"
          @logical-operator-change="emitLogicalOperatorChange"
        />
        <AddCondition
          v-else-if="condition.filterType === 'condition'"
          :condition="condition"
          :dashboard-variables-filter-items="dashboardVariablesFilterItems"
          :schema-options="schemaOptions"
          :load-filter-item="loadFilterItem"
          :dashboard-panel-data="dashboardPanelData"
          @remove-condition="removeConditionFromGroup(index)"
          @logical-operator-change="emitLogicalOperatorChange"
          :condition-index="index"
        />
      </div>
      <ODropdown v-model:open="showAddMenu">
        <template #trigger>
          <OButton
            variant="primary"
            size="icon-xs-circle"
            data-test="dashboard-add-condition-add"
            icon-left="add"
          />
        </template>
        <ODropdownItem
          data-test="dashboard-add-group-add-condition"
          @select="emitAddCondition"
        >
          {{ t("common.addCondition") }}
        </ODropdownItem>
        <ODropdownItem
          data-test="dashboard-add-group-add-group"
          @select="emitAddGroup"
        >
          {{ t("common.addGroup") }}
        </ODropdownItem>
      </ODropdown>
    </div>
    <div v-if="groupNestedIndex !== 0" class="border-l border-border-default flex justify-between items-center">
      <OButton
        variant="ghost"
        size="icon"
        @click="$emit('remove-group')"
        data-test="dashboard-add-group-remove"
        icon-left="close"
      >
      </OButton>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useI18n } from "vue-i18n";
import AddCondition from "./AddCondition.vue";

export default defineComponent({
  name: "Group",
  components: { AddCondition, OButton, ODropdown, ODropdownItem },
  props: {
    group: {
      type: Object,
      required: true,
    },
    // For identifying the index of that group in the current conditions array
    groupIndex: {
      type: Number,
      required: true,
    },
    // For identifying the index of the nested position of that group
    groupNestedIndex: {
      type: Number,
      required: true,
    },
    dashboardVariablesFilterItems: {
      type: Array,
      required: true,
    },
    schemaOptions: {
      type: Array,
      required: true,
    },
    loadFilterItem: {
      type: Function,
      required: true,
    },
    dashboardPanelData: {
      type: Object,
      required: true,
    },
  },
  emits: [
    "add-condition",
    "add-group",
    "remove-group",
    "logical-operator-change",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();
    const showAddMenu = ref(false);
    const filterOptions = ["AND", "OR"];

    const emitAddCondition = () => {
      emit("add-condition", props.group);
      showAddMenu.value = false;
    };

    const emitAddGroup = () => {
      emit("add-group", props.group);
      showAddMenu.value = false;
    };

    const removeConditionFromGroup = (index: number) => {
      props.group.conditions.splice(index, 1);
    };

    const removeGroupFromNested = (groupIndex: number) => {
      const removeGroup = (conditions: any[], index: number) => {
        const nestedGroup = conditions[index];
        if (nestedGroup && nestedGroup.filterType === "group") {
          // Create a copy of the conditions array to avoid modifying it while iterating
          const nestedConditions = [...nestedGroup.conditions];
          nestedConditions.forEach((condition: any, idx: number) => {
            if (condition.filterType === "group") {
              removeGroup(nestedGroup.conditions, idx);
            }
          });
        }
        conditions.splice(index, 1);
      };

      removeGroup(props.group.conditions, groupIndex);
    };

    const addConditionToGroup = (group: any) => {
      emit("add-condition", group);
    };

    const addGroupToGroup = (group: any) => {
      emit("add-group", group);
    };
    const emitLogicalOperatorChange = (newOperator: string) => {
      emit("logical-operator-change", newOperator);
    };
    return {
      t,
      showAddMenu,
      emitAddCondition,
      emitAddGroup,
      removeConditionFromGroup,
      removeGroupFromNested,
      addConditionToGroup,
      addGroupToGroup,
      emitLogicalOperatorChange,
      filterOptions,
    };
  },
});
</script>
