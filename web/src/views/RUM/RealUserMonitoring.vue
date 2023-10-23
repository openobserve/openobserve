<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div :style="{ height: 'calc(100vh - 57px)', overflow: 'hidden' }">
    <template v-if="isRumEnabled || isSessionReplayEnabled">
      <AppTabs
        :show="showTabs"
        :tabs="tabs"
        v-model:active-tab="activeTab"
        @update:active-tab="changeTab"
      />
      <RouterView
        :isRumEnabled="isRumEnabled"
        :isSessionReplayEnabled="isSessionReplayEnabled"
      />
    </template>
    <template v-else>
      <div class="q-pa-lg enable-rum">
        <div class="q-pb-lg">
          <div class="text-left text-h6 text-bold q-pb-md">
            Discover Real User Monitoring to Enhance Your User Experience
          </div>
          <div class="text-subtitle1">
            Real User Monitoring allows you to track and analyze the performance
            of your website or application from the perspective of real users.
            This means understanding how actual users experience your site,
            where they face slowdowns, which pages they frequently use, and
            more.
          </div>
          <div>
            <div></div>
          </div>
        </div>
        <q-btn
          class="bg-secondary rounded text-white"
          no-caps
          title="Get started with Real User Monitoring"
          @click="getStarted"
        >
          Get Started
          <q-icon name="arrow_forward" size="20px" class="q-ml-xs" />
        </q-btn>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import AppTabs from "@/components/common/AppTabs.vue";
import streamService from "@/services/stream";
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

const router = useRouter();
const store = useStore();
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

const isRumEnabled = ref<boolean>(false);
const isSessionReplayEnabled = ref<boolean>(false);

onMounted(async () => {
  await checkIfRumEnabled();
  if (!isRumEnabled.value && !isSessionReplayEnabled.value) return;

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

const checkIfRumEnabled = async () => {
  await nextTick();
  return new Promise((resolve) => {
    streamService
      .nameList(store.state.selectedOrganization.identifier, "logs", false)
      .then((response: any) => {
        response.data.list.forEach((stream: any) => {
          if (stream.name === "_rumdata") isRumEnabled.value = true;
          if (stream.name === "_sessionreplay")
            isSessionReplayEnabled.value = true;
        });
        resolve(true);
      })
      .finally(() => {
        resolve(true);
      });
  });
};

const changeTab = (tab: string) => {
  router.push({
    name: tab === "sessions" ? "Sessions" : "ErrorTracking",
  });
};

const getStarted = () => {
  router.push({
    name: "rumMonitoring",
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

.enable-rum {
  max-width: 1024px;
}
</style>
