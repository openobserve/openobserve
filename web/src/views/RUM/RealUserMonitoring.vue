<template>
  <div :style="{ height: 'calc(100vh - 57px)', overflow: 'hidden' }">
    <div v-if="showTabs" class="flex items-center rum-tabs">
      <div v-for="tab in tabs" :key="tab.value" class="cursor-pointer">
        <div
          class="q-px-lg q-py-sm rum-tab text-center"
          :class="activeTab === tab.value ? 'active' : ''"
          @click="() => (activeTab = tab.value)"
        >
          {{ tab.label }}
        </div>
      </div>
      <q-separator class="full-width" />
    </div>
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const showTabs = computed(() => {
  return router.currentRoute.value.name === "Sessions";
});
const activeTab = ref<string>("sessions");
const tabs = [
  {
    label: "Sessions",
    value: "sessions",
  },
  {
    label: "Error Tracking",
    value: "error_tracking",
  },
  {
    label: "Dashboard",
    value: "dashboard",
  },

  onMounted(() => {
    console.log(router.currentRoute.value.name);

    if (router.currentRoute.value.name === "SessionViewer") {
      activeTab.value = "sessions";
    } else {
      router.push({
        name: "Sessions",
      });
    }
  }),
];
</script>

<style scoped lang="scss">
.rum-tabs {
  .rum-tab {
    border-bottom: 2px solid transparent;
    width: 140px;
  }
  .active {
    border-bottom: 2px solid $primary;
  }
}
</style>
