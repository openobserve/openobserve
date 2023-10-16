<template>
  <div :style="{ height: 'calc(100vh - 57px)', overflow: 'hidden' }">
    <AppTabs
      :show="showTabs"
      :tabs="tabs"
      v-model:active-tab="activeTab"
      @update:active-tab="changeTab"
    />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import AppTabs from "@/components/common/AppTabs.vue";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const showTabs = computed(() => {
  const routes = ["Sessions", "ErrorTracking", "Dashboard"];
  return routes.includes(router.currentRoute.value.name?.toString() || "");
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
];

onMounted(() => {
  const routes = ["SessionViewer", "ErrorTracking", "Dashboard", "ErrorViewer"];
  const routeNameMapping: { [key: string]: string } = {
    SessionViewer: "sessions",
    ErrorTracking: "error_tracking",
    Dashboard: "dashboard",
    ErrorViewer: "error_tracking",
  };

  if (routes.includes(router.currentRoute.value.name?.toString() || "")) {
    activeTab.value =
      routeNameMapping[
        router.currentRoute.value.name?.toString() || "placeholder"
      ];
  } else {
    router.push({
      name: "Sessions",
    });
  }
});

const changeTab = (tab: string) => {
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
