<template>
  <div class="group">
    <div class="group-header">
      <span>{{ t("common.group") }}</span>
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
            @add-condition="() => $emit('add-condition', condition)"
            @add-group="() => $emit('add-group', condition)"
            @remove-group="() => group.conditions.splice(index, 1)"
          />
        </div>
        <div v-else>
          {{ condition }}
          <q-btn
            size="xs"
            dense
            @click="group.conditions.splice(index, 1)"
            icon="close"
          />
        </div>
      </div>
      <q-btn icon="add" color="primary" size="xs" round>
        <q-menu v-model="showAddMenu">
          <q-list>
            <q-item clickable @click="$emit('add-condition', group)">
              <q-item-section>{{ t("common.addCondition") }}</q-item-section>
            </q-item>
            <q-item clickable @click="$emit('add-group', group)">
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

export default defineComponent({
  name: "Group",
  props: ["group"],
  setup() {
    const { t } = useI18n();
    const showAddMenu = ref(false);

    return {
      t,
      showAddMenu,
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
}
.group-conditions {
  margin-top: 10px;
}
.condition-group {
  display: flex;
  align-items: center;
}
</style>
