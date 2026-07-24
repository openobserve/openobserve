<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <template v-if="isLoading.length">
      <div class="flex h-[calc(100vh-11.875rem)] items-center justify-center pt-1 pb-4 text-center">
        <div>
          <OSpinner size="md" class="mx-auto block" data-test="rum-loading-indicator" />
          <div class="w-full text-center">
            {{ t("rum.loadingMsg") }}
          </div>
        </div>
      </div>
    </template>
    <template v-else-if="isRumEnabled || isSessionReplayEnabled">
      <OPageHeader
        v-if="showTabs"
        :title="t('rum.title')"
        :subtitle="t('rum.subtitle')"
        icon="devices"
        tabs-below
        class="shrink-0"
      >
        <template #tabs>
          <OTabs v-model="activeTab" align="left" @change="changeTab">
            <OTab v-for="tab in tabs" :key="tab.value" :name="tab.value" :label="tab.label" />
          </OTabs>
        </template>
      </OPageHeader>
      <router-view v-slot="{ Component }">
        <template v-if="$route.meta.keepAlive">
          <keep-alive class="flex min-h-0 flex-1 flex-col">
            <component
              :is="Component"
              :isRumEnabled="isRumEnabled"
              :isSessionReplayEnabled="isSessionReplayEnabled"
            />
          </keep-alive>
        </template>
        <template v-else>
          <div class="flex min-h-0 flex-1 flex-col">
            <component
              :is="Component"
              :isRumEnabled="isRumEnabled"
              :isSessionReplayEnabled="isSessionReplayEnabled"
            />
          </div>
        </template>
      </router-view>
    </template>
    <template v-else>
      <OEmptyState illustration="radar" size="hero" :hide-action="true">
        <template #title>{{ t("rum.emptyState.title") }}</template>
        <template #description><span v-html="t('rum.emptyState.description')" /></template>

        <template #actions>
          <!-- Instrument a web app -->
          <EmptyStateIngestionCard
            icon="devices"
            :label="t('rum.emptyState.webApp')"
            :sublabel="t('rum.emptyState.webAppDesc')"
            icon-variant="blue"
            data-test="rum-empty-web-card"
            @click="getStarted"
          />

          <!-- Session Replay -->
          <EmptyStateIngestionCard
            icon="play-circle"
            :label="t('rum.emptyState.sessionReplay')"
            :sublabel="t('rum.emptyState.sessionReplayDesc')"
            icon-variant="purple"
            data-test="rum-empty-session-card"
            @click="getStarted"
          />
        </template>

        <template #extra>
          <div class="flex flex-wrap items-center justify-center gap-2">
            <span class="text-text-secondary mr-1 text-sm font-semibold">
              {{ t("rum.emptyState.learnMore") }}
            </span>
            <EmptyStateIngestionChip
              icon="bolt"
              href="https://openobserve.ai/frontend-monitoring/#quick-implementation"
              data-test="rum-empty-quickstart-btn"
              >{{ t("rum.emptyState.quickImpl") }}</EmptyStateIngestionChip
            >
            <EmptyStateIngestionChip
              icon="menu-book"
              href="https://openobserve.ai/blog/frontend-monitoring-basics/"
              data-test="rum-empty-blog-btn"
              >{{ t("rum.emptyState.blogPost") }}</EmptyStateIngestionChip
            >
          </div>
        </template>
      </OEmptyState>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, ref, watch, onUpdated } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import useSession from "@/composables/useSessionReplay";
import useErrorTracking from "@/composables/useErrorTracking";
import usePerformance from "@/composables/rum/usePerformance";

import { b64EncodeUnicode } from "@/utils/zincutils";
import { useI18n } from "vue-i18n";
import useStreams from "@/composables/useStreams";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateIngestionCard from "@/lib/core/EmptyState/EmptyStateIngestionCard.vue";
import EmptyStateIngestionChip from "@/lib/core/EmptyState/EmptyStateIngestionChip.vue";

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
    "SourceMaps",
  ];
  return routes.includes(router.currentRoute.value.name?.toString() || "");
});

const { t } = useI18n();
const isLoading = ref<boolean[]>([]);
const { sessionState } = useSession();
const { errorTrackingState } = useErrorTracking();
const { performanceState } = usePerformance();
const { getStream } = useStreams();

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
  {
    label: t("rum.sourceMaps"),
    value: "source_maps",
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

  await getSchema();

  const routeNameMapping: { [key: string]: string } = {
    SessionViewer: "sessions",
    ErrorTracking: "error_tracking",
    RumPerformance: "performance",
    ErrorViewer: "error_tracking",
    Sessions: "sessions",
    rumPerformanceSummary: "performance",
    SourceMaps: "source_maps",
  };

  if (routeNameMapping[routeName.value?.toString() || "placeholder"]) {
    activeTab.value = routeNameMapping[router.currentRoute.value.name?.toString() || "placeholder"];
  } else {
    activeTab.value = "performance";
  }

  // This is temporary fix, as we have kept sessionViewer keep-alive as false.
  // So on routing to sessionViewer, this hook is called triggered and it routes to Session page again
  const ignoreRoutes = ["SessionViewer", "ErrorViewer", "UploadSourceMaps"];

  if (!ignoreRoutes.includes(routeName.value as string)) changeTab(activeTab.value);
});

onUpdated(async () => {
  if (routeName.value === "RUM") {
    const routeNameMapping: { [key: string]: string } = {
      SessionViewer: "sessions",
      ErrorTracking: "error_tracking",
      RumPerformance: "performance",
      ErrorViewer: "error_tracking",
      Sessions: "sessions",
      rumPerformanceSummary: "performance",
      SourceMaps: "source_maps",
    };

    if (routeNameMapping[routeName.value?.toString() || "placeholder"]) {
      activeTab.value =
        routeNameMapping[router.currentRoute.value.name?.toString() || "placeholder"];
    } else {
      activeTab.value = "performance";
    }

    // This is temporary fix, as we have kept sessionViewer keep-alive as false.
    // So on routing to sessionViewer, this hook is called triggered and it routes to Session page again
    const ignoreRoutes = ["SessionViewer", "ErrorViewer", "UploadSourceMaps"];

    if (!ignoreRoutes.includes(routeName.value as string)) changeTab(activeTab.value);
  }
});

onActivated(async () => {
  await checkIfRumEnabled();
});

watch(
  () => routeName.value,
  () => updateTabOnRouteChange(),
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
    SourceMaps: "source_maps",
  };
  const tab = routeNameMapping[router.currentRoute.value.name?.toString() || "placeholder"];
  if (tab !== activeTab.value && tab !== undefined) {
    activeTab.value = tab;
  }
};

const checkIfRumEnabled = async () => {
  await nextTick();
  return new Promise((resolve) => {
    getStream("_rumdata", "logs", false)
      .then((response: any) => {
        if (response?.name === "_rumdata") isRumEnabled.value = true;
        else isRumEnabled.value = false;
      })
      .finally(() => {
        resolve(true);
      })
      .catch(() => {
        isRumEnabled.value = false;
      });

    getStream("_sessionreplay", "logs", false)
      .then((response: any) => {
        if (response?.name === "_sessionreplay") isSessionReplayEnabled.value = true;
        else isSessionReplayEnabled.value = false;
      })
      .finally(() => {
        resolve(true);
      })
      .catch(() => {
        isSessionReplayEnabled.value = false;
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

const changeTab = (tab: string | number) => {
  if (tab === "performance") {
    router.push({
      name: "rumPerformanceSummary",
      query: {
        ...getQueryParams(performanceState.data.datetime, ""),
        org_identifier: store.state.selectedOrganization.identifier,
      },
    });
    return;
  }

  if (tab === "error_tracking") {
    router.push({
      name: "ErrorTracking",
      query: getQueryParams(performanceState.data.datetime, errorTrackingState.data.editorValue),
    });
    return;
  }

  if (tab === "sessions") {
    router.push({
      name: "Sessions",
      query: getQueryParams(performanceState.data.datetime, sessionState.data.editorValue),
    });
    return;
  }

  if (tab === "source_maps") {
    router.push({
      name: "SourceMaps",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
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

const getSchema = async () => {
  return new Promise((resolve) => {
    getSessionReplayFields().finally(() => {
      getRumDataFields().finally(() => {
        resolve(true);
      });
    });
  });
};

const getSessionReplayFields = () => {
  isLoading.value.push(true);
  return new Promise((resolve) => {
    getStream("_sessionreplay", "logs", true)
      .then((stream) => {
        performanceState.data.streams["_sessionreplay"] = {
          schema: {},
          name: "_sessionreplay",
        };
        stream.schema.forEach((field: any) => {
          performanceState.data.streams["_sessionreplay"]["schema"][field.name] = field;
        });
      })
      .finally(() => {
        resolve(true);
        isLoading.value.pop();
      });
  });
};

const getRumDataFields = () => {
  isLoading.value.push(true);
  return new Promise((resolve) => {
    getStream("_rumdata", "logs", true)
      .then((stream) => {
        performanceState.data.streams["_rumdata"] = {
          schema: {},
          name: "_rumdata",
        };
        stream.schema.forEach((field: any) => {
          performanceState.data.streams["_rumdata"]["schema"][field.name] = field;
        });
      })
      .finally(() => {
        resolve(true);
        isLoading.value.pop();
      });
  });
};
</script>
