<template>
  <div :style="{ height: 'calc(100vh - 57px)', overflow: 'hidden' }">
    <div v-if="showTabs" class="flex items-center rum-tabs">
      <div v-for="tab in tabs" :key="tab.value" class="cursor-pointer">
        <div
          class="q-px-lg q-py-sm rum-tab text-center"
          :class="activeTab === tab.value ? 'active' : ''"
          @click="changeTab(tab.value)"
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
  const routes = ["Sessions", "ErrorTracking", "Dashboard"];
  return routes.includes(router.currentRoute.value.name);
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
];

onMounted(() => {
  const routes = ["SessionViewer", "ErrorTracking", "Dashboard", "ErrorViewer"];
  const routeNameMapping = {
    SessionViewer: "sessions",
    ErrorTracking: "error_tracking",
    Dashboard: "dashboard",
    ErrorViewer: "error_tracking",
  };
  console.log(router.currentRoute.value.name);
  if (routes.includes(router.currentRoute.value.name)) {
    activeTab.value = routeNameMapping[router.currentRoute.value.name];
  } else {
    router.push({
      name: "Sessions",
    });
  }
});

const changeTab = (tab: string) => {
  activeTab.value = tab;
  router.push({
    name: tab === "sessions" ? "Sessions" : "ErrorTracking",
  });
};
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
