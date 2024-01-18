<template>
  <div class="column full-height">
    <DashboardHeader :title="t('dashboard.tabSettingsTitle')" />
    <div>
      <draggable v-model="list" :element="'ul'" :options="dragOptions">
        <li v-for="(item, index) in list" :key="index">{{ item }}</li>
      </draggable>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import { useI18n } from "vue-i18n";
import DashboardHeader from "./common/DashboardHeader.vue";

export default defineComponent({
  name: "TabsSettings",
  components: {
    draggable: VueDraggableNext,
    DashboardHeader,
  },
  setup() {
    const list = ref(["Item 1", "Item 2", "Item 3", "Item 4"]);
    const { t } = useI18n();
    const dragOptions = ref({
      animation: 200,
    });

    return {
      list,
      dragOptions,
      t,
    };
  },
});
</script>

<style></style>
