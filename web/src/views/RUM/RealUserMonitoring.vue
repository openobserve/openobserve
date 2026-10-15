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
            <OTab
              v-for="tab in tabs"
              :key="tab.value"
              :name="tab.value"
              :label="tab.label"
              :data-test="`rum-tab-${tab.value.replace('_', '-')}`"
            />
          </OTabs>
        </template>
      </OPageHeader>
      <router-view v-slot="{ Component }">
        <!--
          ONE keep-alive, always rendered. It must NOT sit inside a v-if on
          $route.meta.keepAlive: <keep-alive> holds its cache in its OWN instance, so
          toggling the element destroys the cache along with it. Navigating
          Sessions -> SessionViewer (meta.keepAlive false) tore the whole thing down,
          and coming back built a fresh, empty one — which is why returning from a
          session detail page re-ran every query instead of showing the list already
          fetched. `include` decides what is retained; the element itself stays put.
        -->
        <div class="flex min-h-0 flex-1 flex-col">
          <keep-alive :include="CACHED_RUM_VIEWS">
            <component
              :is="Component"
              :isRumEnabled="isRumEnabled"
              :isSessionReplayEnabled="isSessionReplayEnabled"
            />
          </keep-alive>
        </div>
      </router-view>
    </template>
    <RumNoDataState v-else />
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
import { useI18nTyped } from "@/types/i18n";
import useStreams from "@/composables/useStreams";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import RumNoDataState from "@/components/rum/RumNoDataState.vue";

/**
 * COMPONENT names (not route names) that <keep-alive> retains — the RUM views whose
 * route sets `meta.keepAlive: true`. Keep the two in sync.
 *
 * Deliberately NOT derived from `$route.meta.keepAlive` at render time: that flag
 * describes the route being entered, and using it to conditionally render the
 * <keep-alive> element is what destroyed the cache on every visit to a detail page.
 *
 * SessionViewer and UploadSourceMaps are absent on purpose — both are keyed by a route
 * param, so a cached instance would be reused for a different id.
 */
const CACHED_RUM_VIEWS = [
  "AppSessions",
  "AppErrors",
  "ErrorViewer",
  "SourceMaps",
  "AppPerformance",
];

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

const { t } = useI18nTyped();
const isLoading = ref<boolean[]>([]);
const { sessionState } = useSession();
const { errorTrackingState } = useErrorTracking();
const { performanceState } = usePerformance();
const { getStream } = useStreams(t);

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

  // The awaits above can outlast a click elsewhere; redirecting now would undo it.
  if (!router.currentRoute.value.matched.some((r: { name?: unknown }) => r.name === "RUM")) return;

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

  if (ignoreRoutes.includes(routeName.value as string)) return;
  if (keepsOwnTimeRange()) return;
  changeTab(activeTab.value);
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

// Product analytics opens Sessions with its own range and filter; re-pushing the shared range would drop both.
const keepsOwnTimeRange = () => {
  const { name, query } = router.currentRoute.value;
  return name === "Sessions" && Boolean(query.period || (query.from && query.to));
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
