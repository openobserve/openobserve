<template>
  <OTabs
    :data-test="dataTest"
    v-model="activeTab"
    :orientation="direction === 'vertical' ? 'vertical' : 'horizontal'"
    @update:model-value="handleTabChange"
  >
    <template v-for="tab in (tabs as any)" :key="tab.name">
      <ORouteTab
        :data-test="tab.dataTest"
        :name="tab.name"
        :to="tab.to"
        :label="tab.label"
      />
    </template>
  </OTabs>
</template>

<script setup lang="ts">
import ORouteTab from '@/lib/navigation/Tabs/ORouteTab.vue'
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
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
