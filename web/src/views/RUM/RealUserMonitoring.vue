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
  <div class="tw:h-full tw:overflow-hidden tw:flex tw:flex-col">
    <template v-if="isLoading.length">
      <div
        class="tw:pb-4 tw:flex tw:items-center tw:justify-center tw:text-center tw:pt-1 tw:h-[calc(100vh-11.875rem)]"
      >
        <div>
          <OSpinner
            size="md"
            class="tw:mx-auto tw:block"
            data-test="rum-loading-indicator"
          />
          <div class="tw:text-center tw:w-full">
            {{ t("rum.loadingMsg") }}
          </div>
        </div>
      </div>
    </template>
    <template v-else-if="isRumEnabled || isSessionReplayEnabled">
      <div v-if="showTabs" class="tw:w-full tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default">
        <OTabs v-model="activeTab" align="left" @change="changeTab">
          <OTab
            v-for="tab in tabs"
            :key="tab.value"
            :name="tab.value"
            :label="tab.label"
          />
        </OTabs>
      </div>
      <router-view v-slot="{ Component }">
        <template v-if="$route.meta.keepAlive">
          <keep-alive
            class="tw:flex-1 tw:min-h-0 tw:flex tw:flex-col"
          >
            <component
              :is="Component"
              :isRumEnabled="isRumEnabled"
              :isSessionReplayEnabled="isSessionReplayEnabled"
            />
          </keep-alive>
        </template>
        <template v-else>
          <div class="tw:flex-1 tw:min-h-0 tw:flex tw:flex-col">
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
          <button type="button" class="rum-card" data-test="rum-empty-web-card" @click="getStarted">
            <span class="rum-card__icon rum-card__icon--blue">
              <OIcon name="devices" size="md" />
            </span>
            <span class="rum-card__body">
              <span class="rum-card__label">{{ t("rum.emptyState.webApp") }}</span>
              <span class="rum-card__sublabel">{{ t("rum.emptyState.webAppDesc") }}</span>
            </span>
            <OIcon name="chevron-right" size="sm" class="rum-card__chevron" />
          </button>

          <!-- Session Replay -->
          <button type="button" class="rum-card" data-test="rum-empty-session-card" @click="getStarted">
            <span class="rum-card__icon rum-card__icon--purple">
              <OIcon name="play-circle" size="md" />
            </span>
            <span class="rum-card__body">
              <span class="rum-card__label">{{ t("rum.emptyState.sessionReplay") }}</span>
              <span class="rum-card__sublabel">{{ t("rum.emptyState.sessionReplayDesc") }}</span>
            </span>
            <OIcon name="chevron-right" size="sm" class="rum-card__chevron" />
          </button>
        </template>

        <template #extra>
          <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:flex-wrap">
            <span class="tw:text-sm tw:font-semibold tw:text-text-secondary tw:mr-1">
              {{ t("rum.emptyState.learnMore") }}
            </span>
            <a
              class="rum-chip"
              href="https://openobserve.ai/frontend-monitoring/#quick-implementation"
              target="_blank"
              rel="noopener noreferrer"
              data-test="rum-empty-quickstart-btn"
            >
              <OIcon name="bolt" size="xs" class="tw:shrink-0" />
              {{ t("rum.emptyState.quickImpl") }}
            </a>
            <a
              class="rum-chip"
              href="https://openobserve.ai/blog/frontend-monitoring-basics/"
              target="_blank"
              rel="noopener noreferrer"
              data-test="rum-empty-blog-btn"
            >
              <OIcon name="menu-book" size="xs" class="tw:shrink-0" />
              {{ t("rum.emptyState.blogPost") }}
            </a>
          </div>
        </template>
      </OEmptyState>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onMounted,
  ref,
  watch,
  onUpdated,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import useSession from "@/composables/useSessionReplay";
import useErrorTracking from "@/composables/useErrorTracking";
import usePerformance from "@/composables/rum/usePerformance";

import { b64EncodeUnicode } from "@/utils/zincutils";
import { useI18n } from "vue-i18n";
import useRum from "@/composables/rum/useRum";
import useStreams from "@/composables/useStreams";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

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
    "SourceMaps",
  ];
  return routes.includes(router.currentRoute.value.name?.toString() || "");
});

const { t } = useI18n();
const isLoading = ref<boolean[]>([]);
const { sessionState } = useSession();
const { errorTrackingState } = useErrorTracking();
const { performanceState } = usePerformance();
const { rumState } = useRum();
const { getStream, getStreams } = useStreams();

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
    label: "Source Maps",
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
    activeTab.value =
      routeNameMapping[
        router.currentRoute.value.name?.toString() || "placeholder"
      ];
  } else {
    activeTab.value = "performance";
  }

  // This is temporary fix, as we have kept sessionViewer keep-alive as false.
  // So on routing to sessionViewer, this hook is called triggered and it routes to Session page again
  const ignoreRoutes = ["SessionViewer", "ErrorViewer"];

  if (!ignoreRoutes.includes(routeName.value as string))
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
        routeNameMapping[
          router.currentRoute.value.name?.toString() || "placeholder"
        ];
    } else {
      activeTab.value = "performance";
    }

    // This is temporary fix, as we have kept sessionViewer keep-alive as false.
    // So on routing to sessionViewer, this hook is called triggered and it routes to Session page again
    const ignoreRoutes = ["SessionViewer", "ErrorViewer"];

    if (!ignoreRoutes.includes(routeName.value as string))
      changeTab(activeTab.value);
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
  return new Promise(async (resolve) => {
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
        if (response?.name === "_sessionreplay")
          isSessionReplayEnabled.value = true;
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

const changeTab = (tab: string) => {
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
      query: getQueryParams(
        performanceState.data.datetime,
        errorTrackingState.data.editorValue,
      ),
    });
    return;
  }

  if (tab === "sessions") {
    router.push({
      name: "Sessions",
      query: getQueryParams(
        performanceState.data.datetime,
        sessionState.data.editorValue,
      ),
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
          performanceState.data.streams["_sessionreplay"]["schema"][
            field.name
          ] = field;
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
          performanceState.data.streams["_rumdata"]["schema"][field.name] =
            field;
        });
      })
      .finally(() => {
        resolve(true);
        isLoading.value.pop();
      });
  });
};
</script>

<style scoped>
.rum-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 19rem;
  max-width: 100%;
  min-height: 4rem;
  padding: 0.625rem 0.875rem 0.625rem 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-base);
  box-shadow: var(--shadow-sm);
  text-align: left;
  cursor: pointer;
  transition: color 150ms, background-color 150ms, border-color 150ms, box-shadow 150ms;
  outline: none;
}
.rum-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-primary-400);
  background: var(--color-tabs-hover-bg);
}
.rum-card:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}

.rum-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  transition: background-color 150ms, color 150ms;
}
.rum-card__icon--blue   { background: color-mix(in srgb, #3b82f6 12%, transparent); color: #3b82f6; }
.rum-card__icon--purple { background: color-mix(in srgb, #8b5cf6 12%, transparent); color: #8b5cf6; }
.rum-card:hover .rum-card__icon,
.rum-card:hover .rum-card__icon--blue,
.rum-card:hover .rum-card__icon--purple {
  background: var(--color-primary-600);
  color: #fff;
}

.rum-card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.rum-card__label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rum-card__sublabel {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}
.rum-card__chevron {
  flex-shrink: 0;
  color: var(--color-text-disabled);
  transition: transform 150ms, color 150ms;
}
.rum-card:hover .rum-card__chevron {
  transform: translateX(0.125rem);
  color: var(--color-primary-600);
}

.rum-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  padding: 0.25rem 0.75rem;
  font-size: var(--text-sm);
  font-weight: 500;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-panel);
  color: var(--color-text-secondary);
  text-decoration: none;
  cursor: pointer;
  transition: border-color 150ms, color 150ms, background-color 150ms;
  outline: none;
}
.rum-chip:hover {
  border-color: var(--color-primary-400);
  color: var(--color-primary-600);
  background: color-mix(in srgb, var(--color-primary-500) 6%, transparent);
}
</style>
