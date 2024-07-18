<template>
  <div class="group">
    <div class="group-header">
      <!-- <span>GROUP {{ groupIndex }}</span> -->
      <q-btn size="xs" dense @click="$emit('remove-group')" icon="close" />
    </div>
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
            :filter-value-options="filterValueOptions"
            :schema-options="schemaOptions"
            :filter-options="filterOptions"
            :load-filter-item="loadFilterItem"
            @add-condition="addConditionToGroup"
            @add-group="addGroupToGroup"
            @remove-group="removeGroupFromNested"
          />
        </div>
        <div v-else>
          <AddCondition
            :condition="condition"
            :dashboard-variables-filter-items="dashboardVariablesFilterItems"
            :filter-value-options="filterValueOptions"
            :schema-options="schemaOptions"
            :filter-options="filterOptions"
            :load-filter-item="loadFilterItem"
            @remove-condition="removeConditionFromGroup(index)"
          />
        </div>
      </div>
      <q-btn icon="add" color="primary" size="xs" round>
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
    filterValueOptions: {
      type: Array,
      required: true,
    },
    schemaOptions: {
      type: Array,
      required: true,
    },
    filterOptions: {
      type: Array,
      required: true,
    },
    loadFilterItem: {
      type: Function,
      required: true,
    },
  },
  setup(props, { emit }) {
    const { t } = useI18n();
    const showAddMenu = ref(false);

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
      props.group.conditions.splice(groupIndex, 1);
    };

    const addConditionToGroup = (group: any) => {
      emit("add-condition", group);
    };

    const addGroupToGroup = (group: any) => {
      emit("add-group", group);
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
    };
  },
});
</script>

<style scoped>
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
  flex-direction: column;
}
.condition-group {
  margin-bottom: 10px;
}
</style>
