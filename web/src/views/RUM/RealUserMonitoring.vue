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
    <template v-if="isLoading.length">
      <div
        class="q-pb-lg flex items-center justify-center text-center"
        style="height: calc(100vh - 200px)"
      >
        <div>
          <q-spinner-hourglass
            color="primary"
            size="40px"
            style="margin: 0 auto; display: block"
          />
          <div class="text-center full-width">
            Hold on tight, we're loading RUM data.
          </div>
        </div>
      </div>
    </template>
    <template v-else-if="isRumEnabled || isSessionReplayEnabled">
      <AppTabs
        :show="showTabs"
        :tabs="tabs"
        v-model:active-tab="activeTab"
        @update:active-tab="changeTab"
      />
      <router-view v-slot="{ Component }">
        <template v-if="$route.meta.keepAlive">
          <keep-alive>
            <component
              :is="Component"
              :isRumEnabled="isRumEnabled"
              :isSessionReplayEnabled="isSessionReplayEnabled"
            />
          </keep-alive>
        </template>
        <template v-else>
          <component
            :is="Component"
            :isRumEnabled="isRumEnabled"
            :isSessionReplayEnabled="isSessionReplayEnabled"
          />
        </template>
      </router-view>
    </template>
    <template v-else>
      <div class="q-pa-lg enable-rum">
        <div class="q-pb-lg">
          <div class="text-left text-h6 text-bold q-pb-md">
            {{t("rum.aboutRUMTitle")}}
          </div>
          <div class="text-subtitle1">
            {{t("rum.aboutRUMMessage")}}
          </div>
          <div>
            <div></div>
          </div>
        </div>
        <q-btn
          class="bg-secondary rounded text-white"
          no-caps
          :title="t('rum.getStartedTitle')"
          @click="getStarted"
        >
          {{t("rum.getStartedLabel")}}
          <q-icon name="arrow_forward" size="20px"
class="q-ml-xs" />
        </q-btn>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import AppTabs from "@/components/common/AppTabs.vue";
import streamService from "@/services/stream";
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import useSession from "@/composables/useSessionReplay";
import useErrorTracking from "@/composables/useErrorTracking";
import usePerformance from "@/composables/rum/usePerformance";

import { b64EncodeUnicode } from "@/utils/zincutils";
import { useI18n } from "vue-i18n";

const route = useRoute();
const router = useRouter();
const store = useStore();
const showTabs = computed(() => {
  const routes = [
    "Sessions",
    "ErrorTracking",
    "RumPerformance",
    "rumPerformanceSummary",
    "rumPerformanceWebVitals",
    "rumPerformanceErrors",
    "rumPerformanceApis",
  ];
  return routes.includes(router.currentRoute.value.name?.toString() || "");
});

const { t } = useI18n();
const isLoading = ref<boolean[]>([]);
const { sessionState } = useSession();
const { errorTrackingState } = useErrorTracking();
const { performanceState } = usePerformance();

const activeTab = ref<string>("performance");
const tabs = [
  {
    label: t("rum.performance"),
    value: "performance",
  },
  {
    label: t("rum.sessions"),
    value: "sessions",
  },
  {
    label: t("rum.errorTracking"),
    value: "error_tracking",
  },
];

const isRumEnabled = ref<boolean>(false);
const isSessionReplayEnabled = ref<boolean>(false);

const routeName = computed(() => router.currentRoute.value.name);

onMounted(async () => {
  isLoading.value.push(true);

  await checkIfRumEnabled();

  isLoading.value.pop();

  if (!isRumEnabled.value && !isSessionReplayEnabled.value) return;

  const routeNameMapping: { [key: string]: string } = {
    SessionViewer: "sessions",
    ErrorTracking: "error_tracking",
    RumPerformance: "performance",
    ErrorViewer: "error_tracking",
    Sessions: "sessions",
    rumPerformanceSummary: "performance",
  };

  if (routeNameMapping[routeName.value?.toString() || "placeholder"]) {
    activeTab.value =
      routeNameMapping[
        router.currentRoute.value.name?.toString() || "placeholder"
      ];
  } else {
    activeTab.value = "performance";
  }

  // This is temporary fix, as we have kept sessionViewer keep-alive as false.
  // So on routing to sessionViewer, this hook is called triggered and it routes to Session page again
  const ignoreRoutes = ["SessionViewer"];

  if (!ignoreRoutes.includes(routeName.value as string))
    changeTab(activeTab.value);
});

onActivated(async () => {
  await checkIfRumEnabled();
});

watch(
  () => routeName.value,
  () => updateTabOnRouteChange()
);

const updateTabOnRouteChange = () => {
  const routeNameMapping: { [key: string]: string } = {
    SessionViewer: "sessions",
    ErrorTracking: "error_tracking",
    RumPerformance: "performance",
    Sessions: "sessions",
    rumPerformanceSummary: "performance",
    rumPerformanceWebVitals: "performance",
    rumPerformanceErrors: "performance",
    rumPerformanceApis: "performance",
  };
  const tab =
    routeNameMapping[
      router.currentRoute.value.name?.toString() || "placeholder"
    ];
  if (tab !== activeTab.value && tab !== undefined) {
    activeTab.value = tab;
  }
};

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

const getQueryParams = (dateTime: any, editorValue: string) => {
  const query: any = {};

  if (dateTime.valueType == "relative") {
    query["period"] = dateTime.relativeTimePeriod;
  } else {
    query["from"] = dateTime.startTime;
    query["to"] = dateTime.endTime;
  }

  if (editorValue) query["query"] = b64EncodeUnicode(editorValue);

  query["org_identifier"] = store.state.selectedOrganization.identifier;
  return query;
};

const changeTab = (tab: string) => {
  if (tab === "performance") {
    router.push({
      name: "rumPerformanceSummary",
      query: getQueryParams(performanceState.data.datetime, ""),
    });
    return;
  }

  if (tab === "error_tracking") {
    router.push({
      name: "ErrorTracking",
      query: getQueryParams(
        errorTrackingState.data.datetime,
        errorTrackingState.data.editorValue
      ),
    });
    return;
  }

  if (tab === "sessions") {
    router.push({
      name: "Sessions",
      query: getQueryParams(
        sessionState.data.datetime,
        sessionState.data.editorValue
      ),
    });
    return;
  }
};

const getStarted = () => {
  router.push({
    name: "frontendMonitoring",
    query: { org_identifier: store.state.selectedOrganization.identifier },
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
