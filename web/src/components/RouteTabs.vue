<template>
  <q-tabs
    :data-test="dataTest"
    v-model="activeTab"
    indicator-color="transparent"
    inline-label
    :vertical="direction === 'vertical'"
    @update:model-value="handleTabChange"
  >
    <template v-for="tab in (tabs as any)" :key="tab.name">
      <q-route-tab
        :data-test="tab.dataTest"
        :name="tab.name"
        :to="tab.to"
        :label="tab.label"
        :content-class="tab.class"
      />
    </template>
  </q-tabs>
</template>

<script setup lang="ts">
import { nextTick } from "vue";
import { ref, watch } from "vue";

const props = defineProps({
  tabs: {
    type: Array,
    required: true,
  },
  activeTab: {
    type: String,
    required: true,
  },
  dataTest: {
    type: String,
    required: true,
  },
  direction: {
    type: String,
    default: "vertical",
  },
});

const emits = defineEmits(["update:activeTab"]);

const activeTab = ref(props.activeTab);

const setActiveTab = async (value: string) => {
  await nextTick();
  activeTab.value = value;
};

const handleTabChange = (tab: string) => {
  activeTab.value = tab;
  emits("update:activeTab", tab);
};

defineExpose({
  setActiveTab,
});
</script>
