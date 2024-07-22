<template>
  <div class="group">
    <div class="group-conditions">
      <div
        v-for="(condition, index) in group.conditions"
        :key="index"
        class="condition-group"
      >
        <div v-if="condition.filterType === 'group'">
          <Group
            :group="condition"
            :group-index="index"
            :dashboard-variables-filter-items="dashboardVariablesFilterItems"
            :schema-options="schemaOptions"
            :load-filter-item="loadFilterItem"
            @add-condition="addConditionToGroup"
            @add-group="addGroupToGroup"
            @remove-group="removeGroupFromNested(index)"
            @logical-operator-change="emitLogicalOperatorChange"
          />
        </div>
        <div v-else>
          <AddCondition
            :condition="condition"
            :dashboard-variables-filter-items="dashboardVariablesFilterItems"
            :schema-options="schemaOptions"
            :load-filter-item="loadFilterItem"
            @remove-condition="removeConditionFromGroup(index)"
            @logical-operator-change="emitLogicalOperatorChange"
          />
        </div>
      </div>
      <q-btn icon="add" color="primary" size="xs" round class="add-btn">
        <q-menu v-model="showAddMenu">
          <q-list>
            <q-item clickable @click="emitAddCondition">
              <q-item-section>{{ t("common.addCondition") }}</q-item-section>
            </q-item>
            <q-item clickable @click="emitAddGroup">
              <q-item-section>{{ t("common.addGroup") }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
    </div>
  </div>
  <div class="group-header">
    <!-- <span>GROUP {{ groupIndex }}</span> -->
    <q-btn size="xs" dense @click="$emit('remove-group')" icon="close" />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import AddCondition from "./AddCondition.vue";

export default defineComponent({
  name: "Group",
  components: { AddCondition },
  props: {
    group: {
      type: Object,
      required: true,
    },
    groupIndex: {
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

    const emitAddCondition = () => {
      emit("add-condition", props.group);
      showAddMenu.value = false;
    };
    const filterOptions = ["AND", "OR"];
    const emitAddGroup = () => {
      emit("add-group", props.group);
      showAddMenu.value = false;
    };

    const removeConditionFromGroup = (index: number) => {
      props.group.conditions.splice(index, 1);
    };

    const removeGroupFromNested = (groupIndex: number) => {
      // Recursively remove all conditions in the nested group
      const nestedGroup = props.group.conditions[groupIndex];
      if (nestedGroup && nestedGroup.filterType === "group") {
        nestedGroup.conditions.forEach((condition: any, idx: number) => {
          if (condition.filterType === "group") {
            removeGroupFromNested(idx);
          }
        });
      }
      props.group.conditions.splice(groupIndex, 1);
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

<style lang="scss" scoped>
.group {
  border: 1px solid #ccc;
  padding: 10px;
  margin-bottom: 10px;
}
.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.group-conditions {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}
.condition-group {
  display: inline-block;
  margin-right: 10px;
}

.add-btn {
  height: 20px;
  width: 20px;
}
</style>
