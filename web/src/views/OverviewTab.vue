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
  <div class="overview-tab tw:flex tw:flex-col tw:gap-0 tw:p-[0.625rem] tw:h-full tw:overflow-y-auto tw:text-(--o2-text-primary)">
    <!-- Header: title + last-fetched + refresh + time picker -->
    <div class="tw:flex tw:items-center tw:justify-between tw:mb-4">
      <span class="tw:text-base tw:font-semibold tw:text-(--o2-text-primary) tw:tracking-[0.01em]">{{ t('overview.title') }}</span>
      <div class="tw:flex tw:items-center tw:gap-2">
        <ORefreshButton
          :last-run-at="lastFetched ? lastFetched.getTime() : null"
          :loading="isLoading"
          :disabled="isLoading"
          @click="loadAll"
        />
        <DateTime
          ref="dateTimeRef"
          auto-apply
          menu-align="end"
          :default-type="dateTimeType"
          :default-absolute-time="{ startTime: absoluteTime.startTime, endTime: absoluteTime.endTime }"
          :default-relative-time="relativeTime"
          @on:date-change="onDateChange"
        />
      </div>
    </div>

    <!-- Sections rendered top-to-bottom; each collapses when empty -->

    <!-- ACTIVE ANOMALIES -->
    <section v-if="anomalies.length > 0" class="tw:mb-5">
      <div class="tw:text-[0.8125rem] tw:font-semibold tw:tracking-[0.01em] tw:text-(--o2-text-muted) tw:mb-2 tw:pl-1">{{ t('overview.activeAnomalies') }}</div>
      <div class="tw:flex tw:flex-col tw:gap-[0.375rem]">
        <div
          v-for="item in anomalies"
          :key="item.id"
          class="tw:flex tw:items-center tw:gap-3 tw:py-[0.625rem] tw:px-[0.875rem] tw:rounded-md tw:border tw:border-(--o2-border-color) tw:bg-(--o2-card-bg-solid) tw:transition-[background] tw:duration-[150ms] tw:hover:bg-(--o2-hover-gray)"
          :class="severityRowClass(item.severity)"
        >
          <span class="tw:shrink-0 tw:flex tw:items-center" :class="severityIconClass(item.severity)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <div class="tw:flex-1 tw:min-w-0">
            <div class="tw:text-sm tw:font-medium tw:text-(--o2-text-primary) tw:flex tw:items-center tw:flex-wrap tw:gap-1">{{ item.title }}</div>
            <div class="tw:text-xs tw:text-(--o2-text-muted) tw:mt-[0.125rem] tw:truncate">{{ item.description }}</div>
          </div>
          <span class="tw:shrink-0 tw:whitespace-nowrap">
            <OButton
              variant="ghost-primary"
              size="sm"
              @click="goToAlert(item)"
            >
              {{ t("overview.investigate") }}
            </OButton>
          </span>
        </div>
      </div>
    </section>

    <!-- ACTIVE INCIDENTS (enterprise / cloud only) -->
    <section
      v-if="isIncidentsEnabled && incidents.length > 0"
      class="tw:mb-5"
    >
      <div class="tw:text-[0.8125rem] tw:font-semibold tw:tracking-[0.01em] tw:text-(--o2-text-muted) tw:mb-2 tw:pl-1">{{ t('overview.activeIncidents') }}</div>
      <div class="tw:flex tw:flex-col tw:gap-[0.375rem]">
        <div
          v-for="inc in incidents"
          :key="inc.id"
          class="tw:flex tw:items-center tw:gap-3 tw:py-[0.625rem] tw:px-[0.875rem] tw:rounded-md tw:border tw:border-(--o2-border-color) tw:bg-(--o2-card-bg-solid) tw:transition-[background] tw:duration-[150ms] tw:hover:bg-(--o2-hover-gray)"
          :class="incidentRowClass(inc.severity)"
        >
          <span class="tw:shrink-0 tw:flex tw:items-center" :class="incidentIconClass(inc.severity)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
              <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </span>
          <div class="tw:flex-1 tw:min-w-0">
            <div class="tw:text-sm tw:font-medium tw:text-(--o2-text-primary) tw:flex tw:items-center tw:flex-wrap tw:gap-1">
              <span class="tw:inline-block tw:text-[0.625rem] tw:font-bold tw:py-[0.1rem] tw:px-[0.35rem] tw:rounded-[0.2rem] tw:tracking-[0.04em]" :class="severityBadgeClass(inc.severity)">
                {{ (inc.severity || 'P4').toUpperCase() }}
              </span>
              {{ inc.title || t('overview.untitledIncident') }}
              <template v-if="inc.group_values && Object.keys(inc.group_values).length > 0">
                <span
                  v-for="[key, val] in sortedDimensions(inc.group_values)"
                  :key="key"
                  class="tw:inline-flex tw:items-center tw:gap-[0.125em] tw:py-[0.125em] tw:px-[0.5em] tw:rounded-[0.375em] tw:text-[0.6875em] tw:font-semibold tw:mx-[0.125em] tw:max-w-[11.25em] tw:overflow-hidden"
                  :class="dimColorClass(key)"
                  :title="`${key}=${val}`"
                ><span class="tw:inline-block tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ shortDimKey(key) }}: {{ val }}</span></span>
              </template>
            </div>
            <div class="tw:text-xs tw:text-(--o2-text-muted) tw:mt-[0.125rem] tw:truncate">
              {{ inc.alert_count }} alert{{ inc.alert_count !== 1 ? 's' : '' }} ·
              opened {{ relativeTime_(inc.first_alert_at) }}
              <span v-if="inc.assigned_to"> · {{ inc.assigned_to }}</span>
            </div>
          </div>
          <span class="tw:shrink-0 tw:whitespace-nowrap">
            <OButton
              variant="ghost-primary"
              size="sm"
              @click="goToIncident(inc)"
            >
              {{ t("overview.investigate") }}
            </OButton>
          </span>
        </div>
      </div>
    </section>

    <!-- SERVICES (enterprise only — needs service graph data) -->
    <section v-if="isEnterpriseOrCloud && services.length > 0" class="tw:mb-5">
      <div class="tw:text-[0.8125rem] tw:font-semibold tw:tracking-[0.01em] tw:text-(--o2-text-muted) tw:mb-2 tw:pl-1">{{ t('overview.services') }}</div>
      <div class="tw:grid tw:gap-2" style="grid-template-columns: repeat(auto-fill, minmax(13.75em, 1fr))">
        <div
          v-for="svc in services"
          :key="svc.id"
          class="tw:py-3 tw:px-[0.875rem] tw:rounded-md tw:border tw:border-(--o2-border-color) tw:bg-(--o2-card-bg-solid) tw:transition-[background] tw:duration-[150ms] tw:cursor-pointer tw:hover:bg-(--o2-hover-gray)"
          :class="serviceCardClass(svc)"
          @click="goToService(svc)"
        >
          <div class="tw:flex tw:items-center tw:justify-between tw:mb-2">
            <span class="tw:text-sm tw:font-medium tw:text-(--o2-text-primary) tw:flex-1 tw:min-w-0 tw:truncate">{{ svc.label }}</span>
            <span class="tw:inline-flex tw:items-center tw:shrink-0 tw:ml-1">
              <OButton
                variant="ghost-muted"
                size="icon"
                :title="t('overview.viewLatencyCharts')"
                @click="openServicePanel(svc, $event)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                  <path d="M12 16v-4m0-4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </OButton>
            </span>
          </div>
          <div class="tw:flex tw:gap-[0.375rem] tw:items-center tw:flex-wrap tw:mb-[0.375rem]">
            <span v-if="svc.errorFlag" class="tw:text-[0.625rem] tw:font-bold tw:tracking-[0.04em] tw:py-[0.15rem] tw:px-[0.4rem] tw:rounded-[0.2rem] tw:whitespace-nowrap tw:bg-[rgba(239,68,68,0.12)] tw:text-[#ef4444] tw:border tw:border-[rgba(239,68,68,0.25)] tw:dark:bg-[#401a1a] tw:dark:text-[#f9cbcb] tw:dark:border-[rgba(239,68,68,0.35)]" :title="t('overview.elevatedErrorRate')">
              Error Rate {{ svc.error_rate.toFixed(1) }}%
            </span>
            <span v-if="svc.latencyFlag" class="tw:text-[0.625rem] tw:font-bold tw:tracking-[0.04em] tw:py-[0.15rem] tw:px-[0.4rem] tw:rounded-[0.2rem] tw:whitespace-nowrap tw:bg-[rgba(245,158,11,0.12)] tw:text-[#d97706] tw:border tw:border-[rgba(245,158,11,0.25)] tw:dark:bg-[#402a10] tw:dark:text-[#fcd34d] tw:dark:border-[rgba(245,158,11,0.35)]" :title="`Latency elevated vs baseline (${svc.latencyMultiplier}x)`">
              Latency {{ svc.latencyMultiplier }}x
            </span>
          </div>
          <div class="tw:flex tw:items-baseline tw:gap-[0.35rem] tw:mt-[0.375rem]">
            <span class="tw:text-[0.6875rem] tw:text-(--o2-text-muted)">{{ t('overview.reqPerSec') }}</span>
            <span class="tw:text-sm tw:font-semibold tw:text-(--o2-text-primary)">{{ formatReqRate(svc.requests) }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Service node side panel (latency / RED charts) -->
    <template v-if="isEnterpriseOrCloud && selectedService">
      <div
        v-if="servicePanelVisible"
        class="ov-panel-backdrop tw:fixed tw:inset-0 tw:z-[99] tw:bg-transparent"
        @click="closeServicePanel"
      />
      <ServiceGraphNodeSidePanel
        :selected-node="selectedService"
        :graph-data="graphData"
        :time-range="timeRange"
        :visible="servicePanelVisible"
        :stream-filter="selectedService?.stream_name ?? graphStream"
        @close="closeServicePanel"
        @view-traces="goToService(selectedService)"
      />
    </template>

    <!-- RECENT EVENTS (alert firing feed) -->
    <section v-if="recentEvents.length > 0" class="tw:mb-5">
      <div class="tw:text-[0.8125rem] tw:font-semibold tw:tracking-[0.01em] tw:text-(--o2-text-muted) tw:mb-2 tw:pl-1">{{ t('overview.recentEvents') }}</div>
      <div class="tw:flex tw:flex-col tw:gap-0 tw:border tw:border-(--o2-border-color) tw:rounded-md tw:overflow-hidden tw:bg-(--o2-card-bg-solid)">
        <div
          v-for="ev in recentEvents"
          :key="ev.id"
          class="ov-event-row tw:flex tw:items-center tw:gap-3 tw:py-2 tw:px-[0.875rem] tw:border-b tw:border-b-(--o2-border-color) tw:text-[0.8125rem] tw:transition-[background] tw:duration-[150ms] tw:hover:bg-(--o2-hover-gray)"
        >
          <span class="tw:shrink-0 tw:text-[0.6875rem] tw:font-semibold tw:py-[0.15rem] tw:px-[0.4rem] tw:rounded-[0.2rem] tw:tracking-[0.03em]" :class="ev.typeLabel === 'Failed' ? 'tw:bg-[rgba(239,68,68,0.18)] tw:text-[#b91c1c] tw:font-bold tw:dark:bg-[#401a1a] tw:dark:text-[#f9cbcb]' : ev.typeLabel === 'Error' ? 'tw:bg-[rgba(249,115,22,0.12)] tw:text-[#c2410c] tw:dark:bg-[#401f10] tw:dark:text-[#fdba74]' : 'tw:bg-[rgba(239,68,68,0.12)] tw:text-[#ef4444] tw:dark:bg-[#401a1a] tw:dark:text-[#fca5a5]'">
            {{ ev.typeLabel }}
          </span>
          <span class="tw:font-medium tw:text-(--o2-text-primary) tw:whitespace-nowrap tw:min-w-[7.5em] tw:max-w-[12.5em] tw:overflow-hidden tw:text-ellipsis">{{ ev.service }}</span>
          <span class="tw:flex-1 tw:text-(--o2-text-muted) tw:truncate">{{ ev.description }}</span>
          <span v-if="ev.failCount > 1" class="tw:shrink-0 tw:text-[0.6875rem] tw:font-bold tw:text-[#b91c1c] tw:bg-[rgba(239,68,68,0.1)] tw:border tw:border-[rgba(239,68,68,0.25)] tw:rounded-full tw:py-[0.1rem] tw:px-[0.4rem] tw:whitespace-nowrap tw:dark:text-[#f9cbcb] tw:dark:bg-[#401a1a] tw:dark:border-[rgba(239,68,68,0.35)]" :title="`Failed ${ev.failCount} times in this window`">
            ×{{ ev.failCount }}
          </span>
          <span class="tw:shrink-0 tw:text-(--o2-text-muted) tw:text-xs tw:whitespace-nowrap">{{ ev.timeAgo }}</span>
        </div>
      </div>
    </section>

    <!-- Empty state — everything is healthy or no data yet -->
    <OEmptyState
      v-if="!isLoading && anomalies.length === 0 && incidents.length === 0 && services.length === 0 && recentEvents.length === 0"
      illustration="check"
      size="hero"
      :hide-action="true"
      data-test="overview-all-clear-empty-state"
    >
      <template #title>{{ t('overview.allClear') }}</template>
      <template #description>{{ t('overview.allClearDesc') }}</template>
      <template #actions>
        <!-- View alerts -->
        <button type="button" class="ov-action-card tw:group tw:relative tw:flex tw:items-center tw:gap-3 tw:w-64 tw:max-w-full tw:min-h-16 tw:py-[0.625rem] tw:pr-[0.875rem] tw:pl-3 tw:rounded-xl tw:border tw:border-(--color-border-default) tw:bg-(--color-surface-base) tw:shadow-(--shadow-sm) tw:text-left tw:cursor-pointer tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150 tw:outline-none tw:hover:shadow-(--shadow-md) tw:hover:border-(--color-primary-400) tw:hover:bg-(--color-tabs-hover-bg)" data-test="overview-empty-alerts-card" @click="goToAlertList">
          <span class="tw:inline-flex tw:items-center tw:justify-center tw:shrink-0 tw:w-10 tw:h-10 tw:rounded-lg tw:transition-[background-color,color] tw:duration-150 tw:bg-[color-mix(in_srgb,#f59e0b_12%,transparent)] tw:text-[#d97706] tw:group-hover:bg-(--color-primary-600) tw:group-hover:text-white">
            <OIcon name="notifications" size="md" />
          </span>
          <span class="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-[0.125rem]">
            <span class="tw:text-(--text-sm) tw:font-semibold tw:text-(--color-text-primary) tw:truncate">{{ t('overview.emptyActionAlerts') }}</span>
            <span class="tw:text-(--text-xs) tw:text-(--color-text-secondary) tw:leading-[1.4]">{{ t('overview.emptyActionAlertsDesc') }}</span>
          </span>
          <OIcon name="chevron-right" size="sm" class="tw:shrink-0 tw:text-(--color-text-disabled) tw:transition-[transform,color] tw:duration-150 tw:group-hover:translate-x-[0.125rem] tw:group-hover:text-(--color-primary-600)" />
        </button>
        <!-- Explore logs -->
        <button type="button" class="ov-action-card tw:group tw:relative tw:flex tw:items-center tw:gap-3 tw:w-64 tw:max-w-full tw:min-h-16 tw:py-[0.625rem] tw:pr-[0.875rem] tw:pl-3 tw:rounded-xl tw:border tw:border-(--color-border-default) tw:bg-(--color-surface-base) tw:shadow-(--shadow-sm) tw:text-left tw:cursor-pointer tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150 tw:outline-none tw:hover:shadow-(--shadow-md) tw:hover:border-(--color-primary-400) tw:hover:bg-(--color-tabs-hover-bg)" data-test="overview-empty-logs-card" @click="goToLogs">
          <span class="tw:inline-flex tw:items-center tw:justify-center tw:shrink-0 tw:w-10 tw:h-10 tw:rounded-lg tw:transition-[background-color,color] tw:duration-150 tw:bg-[color-mix(in_srgb,#3b82f6_12%,transparent)] tw:text-[#3b82f6] tw:group-hover:bg-(--color-primary-600) tw:group-hover:text-white">
            <OIcon name="search" size="md" />
          </span>
          <span class="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-[0.125rem]">
            <span class="tw:text-(--text-sm) tw:font-semibold tw:text-(--color-text-primary) tw:truncate">{{ t('overview.emptyActionLogs') }}</span>
            <span class="tw:text-(--text-xs) tw:text-(--color-text-secondary) tw:leading-[1.4]">{{ t('overview.emptyActionLogsDesc') }}</span>
          </span>
          <OIcon name="chevron-right" size="sm" class="tw:shrink-0 tw:text-(--color-text-disabled) tw:transition-[transform,color] tw:duration-150 tw:group-hover:translate-x-[0.125rem] tw:group-hover:text-(--color-primary-600)" />
        </button>
        <!-- Explore traces -->
        <button type="button" class="ov-action-card tw:group tw:relative tw:flex tw:items-center tw:gap-3 tw:w-64 tw:max-w-full tw:min-h-16 tw:py-[0.625rem] tw:pr-[0.875rem] tw:pl-3 tw:rounded-xl tw:border tw:border-(--color-border-default) tw:bg-(--color-surface-base) tw:shadow-(--shadow-sm) tw:text-left tw:cursor-pointer tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150 tw:outline-none tw:hover:shadow-(--shadow-md) tw:hover:border-(--color-primary-400) tw:hover:bg-(--color-tabs-hover-bg)" data-test="overview-empty-traces-card" @click="goToTraces">
          <span class="tw:inline-flex tw:items-center tw:justify-center tw:shrink-0 tw:w-10 tw:h-10 tw:rounded-lg tw:transition-[background-color,color] tw:duration-150 tw:bg-[color-mix(in_srgb,#8b5cf6_12%,transparent)] tw:text-[#8b5cf6] tw:group-hover:bg-(--color-primary-600) tw:group-hover:text-white">
            <OIcon name="account-tree" size="md" />
          </span>
          <span class="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-[0.125rem]">
            <span class="tw:text-(--text-sm) tw:font-semibold tw:text-(--color-text-primary) tw:truncate">{{ t('overview.emptyActionTraces') }}</span>
            <span class="tw:text-(--text-xs) tw:text-(--color-text-secondary) tw:leading-[1.4]">{{ t('overview.emptyActionTracesDesc') }}</span>
          </span>
          <OIcon name="chevron-right" size="sm" class="tw:shrink-0 tw:text-(--color-text-disabled) tw:transition-[transform,color] tw:duration-150 tw:group-hover:translate-x-[0.125rem] tw:group-hover:text-(--color-primary-600)" />
        </button>
      </template>
    </OEmptyState>

    <!-- Loading skeleton (standard O2 wave shimmer) -->
    <div v-if="isLoading" class="tw:flex tw:flex-col tw:gap-2 tw:py-2 tw:px-0">
      <OSkeleton v-for="i in 3" :key="i" class="tw:h-[3.25em]" />
    </div>

    <!-- Alert History Drawer — opened from anomaly Investigate button -->
    <AlertHistoryDrawer
      v-model:open="showAlertHistoryDrawer"
      :alert-details="selectedAlertForHistory"
      :alert-id="selectedAlertIdForHistory"
      alert-type="anomaly_detection"
      data-test="overview-alert-history-drawer"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineAsyncComponent, onMounted, watch } from "vue";

// Module-level cache for anomaly history — survives re-renders, cleared on org change
const ANOMALY_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const _anomalyCache = new Map<
  string,
  { ts: number; startTime: number; endTime: number; data: any[] }
>();
import { useI18n } from "vue-i18n";
import { b64EncodeUnicode, getImageURL } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import alertsService from "@/services/alerts";
import anomalyService from "@/services/anomaly_detection";
import incidentsService from "@/services/incidents";
import serviceGraphService from "@/services/service_graph";
import config from "@/aws-exports";
import DateTime from "@/components/DateTime.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ServiceGraphNodeSidePanel from "@/plugins/traces/ServiceGraphNodeSidePanel.vue";
const AlertHistoryDrawer = defineAsyncComponent(
  () => import("@/components/alerts/AlertHistoryDrawer.vue"),
);

const { t } = useI18n();
const store = useStore();
const router = useRouter();

// ── Feature flags ────────────────────────────────────────────────────────────
const isEnterpriseOrCloud = computed(
  () => config.isEnterprise === "true" || config.isCloud === "true"
);
const isIncidentsEnabled = computed(
  () =>
    isEnterpriseOrCloud.value &&
    store.state.zoConfig?.incidents_enabled === true
);

// ── Date / time picker ───────────────────────────────────────────────────────
const LS_TIME_KEY = "o2_overview_time";

function loadSavedTime() {
  try {
    const raw = localStorage.getItem(LS_TIME_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

const saved = loadSavedTime();
const now = Date.now();
const dateTimeRef = ref<any>(null);
const dateTimeType = ref(saved?.type ?? "relative");
const relativeTime = ref(saved?.relative ?? "15m");
const absoluteTime = ref(
  saved?.absolute ?? {
    startTime: (now - 15 * 60 * 1000) * 1000,
    endTime: now * 1000,
  }
);
const timeRange = ref(
  saved?.timeRange ?? {
    startTime: (now - 15 * 60 * 1000) * 1000,
    endTime: now * 1000,
  }
);

const onDateChange = (value: any) => {
  timeRange.value = {
    startTime: value.startTime,
    endTime: value.endTime,
  };
  if (value.relativeTimePeriod) {
    dateTimeType.value = "relative";
    relativeTime.value = value.relativeTimePeriod;
  } else {
    dateTimeType.value = "absolute";
    absoluteTime.value = { startTime: value.startTime, endTime: value.endTime };
  }
  localStorage.setItem(
    LS_TIME_KEY,
    JSON.stringify({
      type: dateTimeType.value,
      relative: relativeTime.value,
      absolute: absoluteTime.value,
      timeRange: timeRange.value,
    }),
  );
  loadAll();
};

// ── State ────────────────────────────────────────────────────────────────────
const isLoading = ref(false);
const lastFetched = ref<Date | null>(null);
const anomalies = ref<any[]>([]);
const incidents = ref<any[]>([]);
const services = ref<any[]>([]);
const recentEvents = ref<any[]>([]);

// Alert history drawer state
const showAlertHistoryDrawer = ref(false);
const selectedAlertForHistory = ref<any>(null);
const selectedAlertIdForHistory = ref("");

// Service graph raw data + panel state
const graphData = ref<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
const graphStream = ref(
  localStorage.getItem("serviceGraph_streamFilter") || "",
);
const selectedService = ref<any>(null);
const servicePanelVisible = ref(false);

// ── Data loading ─────────────────────────────────────────────────────────────
const orgId = computed(() => store.state.selectedOrganization?.identifier);

const loadAll = async () => {
  if (!orgId.value) return;
  isLoading.value = true;
  await Promise.allSettled([
    loadHistoryAndSplit(),
    loadAnomalies(),
    loadIncidents(),
    loadServiceGraph(),
  ]);
  isLoading.value = false;
  lastFetched.value = new Date();
};

// Dedicated anomaly loader — uses anomaly_detection service for reliable results
const loadAnomalies = async () => {
  try {
    const org = orgId.value;
    const { startTime, endTime } = timeRange.value;
    const cacheKey = org;
    const cached = _anomalyCache.get(cacheKey);

    let rawHits: Array<{ cfg: any; hits: any[] }>;

    if (
      cached &&
      Date.now() - cached.ts < ANOMALY_CACHE_TTL_MS &&
      cached.startTime === startTime &&
      cached.endTime === endTime
    ) {
      // Serve from cache — no network calls
      anomalies.value = cached.data;
      return;
    }

    // Fire list first; only fetch history if configs exist
    try {
      const listRes = await anomalyService.list(org);
      const configs: any[] = listRes.data ?? [];
      if (!configs.length) {
        anomalies.value = [];
        _anomalyCache.set(cacheKey, { ts: Date.now(), startTime, endTime, data: [] });
        return;
      }
      const configById = new Map(configs.map((c: any) => [c.id ?? c.anomaly_id, c]));
      console.log("[OverviewTab] fetching bulk anomaly history", { org, configs: configs.length });
      const bulkRes = await anomalyService.getAllHistory(org, 20);
      console.log("[OverviewTab] bulk anomaly history response", bulkRes.data);
      const bulkConfigs: any[] = bulkRes.data?.configs ?? [];
      // Merge bulk history hits with config metadata
      rawHits = bulkConfigs.map((entry: any) => ({
        cfg: configById.get(entry.cfg?.id) ?? entry.cfg,
        hits: entry.hits ?? [],
      }));
    } catch {
      // Bulk endpoint not available — fall back to per-config requests
      const listRes = await anomalyService.list(org);
      const configs: any[] = listRes.data ?? [];
      if (!configs.length) {
        anomalies.value = [];
        _anomalyCache.set(cacheKey, { ts: Date.now(), startTime, endTime, data: [] });
        return;
      }
      const limitPerConfig = Math.min(20, Math.ceil(500 / configs.length));
      const results = await Promise.allSettled(
        configs.map((c) =>
          anomalyService.getHistory(org, c.id ?? c.anomaly_id, limitPerConfig),
        ),
      );
      rawHits = configs.map((cfg, idx) => ({
        cfg,
        hits:
          results[idx].status === "fulfilled"
            ? (results[idx] as PromiseFulfilledResult<any>).value.data ?? []
            : [],
      }));
    }

    const found: any[] = [];
    rawHits.forEach(({ cfg, hits }: { cfg: any; hits: any[] }) => {
      hits.forEach((h: any) => {
        const tsMs = h.timestamp ? Math.floor(h.timestamp / 1000) : 0;
        if (
          tsMs &&
          (tsMs < startTime / 1000 || tsMs > endTime / 1000)
        )
          return;
        if ((h.anomaly_count ?? 0) > 0) {
          found.push({
            id: h.id ?? `anm-${cfg?.id}-${tsMs}`,
            title: `Anomaly detected — ${cfg?.name ?? cfg?.alert_name ?? h.alert_name ?? "unknown"}`,
            description: `Stream: ${cfg?.stream_name ?? h.stream_name ?? "unknown"} · ${h.anomaly_count} anomalous point(s)`,
            severity: "warning",
            alertName: cfg?.name ?? cfg?.alert_name ?? h.alert_name,
            streamName: cfg?.stream_name ?? h.stream_name,
            ts: tsMs,
            alertId: cfg?.id ?? cfg?.anomaly_id ?? h.anomaly_id ?? "",
            alertConfig: cfg ?? null,
          });
        }
      });
    });

    // Dedup by alertName, keep most recent, sort newest first
    const deduped = new Map<string, any>();
    found.forEach((a) => {
      const key = a.alertName ?? a.id;
      const ex = deduped.get(key);
      if (!ex || a.ts > ex.ts) deduped.set(key, a);
    });
    const result = Array.from(deduped.values())
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 5);

    _anomalyCache.set(cacheKey, { ts: Date.now(), startTime, endTime, data: result });
    anomalies.value = result;
  } catch {
    anomalies.value = [];
  }
};

// Alert trigger history feeds recentEvents only
const loadHistoryAndSplit = async () => {
  try {
    const res = await alertsService.getHistory(orgId.value, {
      start_time: timeRange.value.startTime.toString(),
      end_time: timeRange.value.endTime.toString(),
      from: 0,
      size: 500,
      sort_by: "timestamp",
      sort_order: "desc",
    });
    const hits: any[] = res.data?.hits ?? [];

    // Recent events: firing/error shown per-occurrence; failed deduped by alert_name with count
    const firingHits = hits
      .filter((h) => ["firing", "error"].includes(h.status?.toLowerCase()))
      .slice(0, 10)
      .map((h, idx) => ({
        id: h.id ?? `ev-${idx}`,
        typeLabel: formatStatus(h.status),
        service: h.stream_name ?? "—",
        description: h.alert_name ?? "",
        timeAgo: relativeTime_(h.timestamp),
        failCount: 0,
      }));

    // Dedup failed: one row per alert_name, most recent timestamp, total count
    const failedMap = new Map<string, any>();
    hits
      .filter((h) => h.status?.toLowerCase() === "failed")
      .forEach((h) => {
        const key = h.alert_name ?? h.id ?? "unknown";
        const existing = failedMap.get(key);
        if (!existing || h.timestamp > existing.rawTs) {
          failedMap.set(key, {
            id: `fail-${key}`,
            typeLabel: "Failed",
            service: h.stream_name ?? "—",
            description: h.alert_name ?? "",
            timeAgo: relativeTime_(h.timestamp),
            rawTs: h.timestamp,
            failCount: (existing?.failCount ?? 0) + 1,
          });
        } else {
          existing.failCount += 1;
        }
      });

    recentEvents.value = [...firingHits, ...Array.from(failedMap.values())]
      .sort((a, b) => (b.rawTs ?? 0) - (a.rawTs ?? 0))
      .slice(0, 15);
  } catch {
    recentEvents.value = [];
  }
};

const loadIncidents = async () => {
  if (!isIncidentsEnabled.value) return;
  try {
    const res = await incidentsService.list(orgId.value, "open", 10, 0);
    incidents.value = res.data?.incidents ?? [];
  } catch {
    incidents.value = [];
  }
};

const loadServiceGraph = async () => {
  if (!isEnterpriseOrCloud.value) return;
  try {
    graphStream.value = "all";

    const res = await serviceGraphService.getCurrentTopology(orgId.value, {
      startTime: timeRange.value.startTime,
      endTime: timeRange.value.endTime,
    });
    const nodes: any[] = res.data?.nodes ?? [];
    const edges: any[] = res.data?.edges ?? [];
    graphData.value = { nodes, edges };

    // Build per-node latency flag from incoming edges that have a baseline
    // Flag if p99 > 2x baseline_p99 (meaningful degradation, not noise)
    const latencyByNode = new Map<string, { multiplier: number }>();
    for (const edge of edges) {
      const baseline = edge.baseline_p99_latency_ns;
      const current = edge.p99_latency_ns;
      if (baseline && baseline > 0 && current > 0) {
        const mult = current / baseline;
        if (mult >= 2) {
          const existing = latencyByNode.get(edge.to);
          if (!existing || mult > existing.multiplier) {
            latencyByNode.set(edge.to, { multiplier: mult });
          }
        }
      }
    }

    services.value = nodes
      .map((node) => {
        const latInfo = latencyByNode.get(node.id);
        const errorFlag = (node.error_rate ?? 0) >= 1;
        const latencyFlag = !!latInfo;
        return {
          ...node,
          errorFlag,
          latencyFlag,
          latencyMultiplier: latInfo ? latInfo.multiplier.toFixed(1) : null,
        };
      })
      // Show only services with at least one flag, then healthy ones after
      .sort((a, b) => {
        const aScore = (a.errorFlag ? 2 : 0) + (a.latencyFlag ? 1 : 0);
        const bScore = (b.errorFlag ? 2 : 0) + (b.latencyFlag ? 1 : 0);
        if (bScore !== aScore) return bScore - aScore;
        const errDiff = (b.error_rate ?? 0) - (a.error_rate ?? 0);
        if (errDiff !== 0) return errDiff;
        return a.id.localeCompare(b.id);
      })
      .slice(0, 9);
  } catch {
    services.value = [];
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const formatStatus = (status: string) => {
  if (!status) return "Event";
  const map: Record<string, string> = {
    firing: "Firing",
    error: "Error",
    failed: "Failed",
    anomaly: "Anomaly",
  };
  return (
    map[status.toLowerCase()] ??
    status.charAt(0).toUpperCase() + status.slice(1)
  );
};

const relativeTime_ = (tsMicros: number): string => {
  if (!tsMicros) return "—";
  const diffMs = Date.now() - Math.floor(tsMicros / 1000);
  if (diffMs < 60_000) return `${Math.round(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h ago`;
  return `${Math.round(diffMs / 86_400_000)}d ago`;
};

const formatReqRate = (reqs: number) => {
  if (!reqs && reqs !== 0) return "—";
  if (reqs >= 1000) return `${(reqs / 1000).toFixed(1)}k`;
  return String(reqs);
};

const sortedDimensions = (dims: Record<string, string>): [string, string][] =>
  Object.keys(dims)
    .sort()
    .map((k) => [k, dims[k]]);

// Shorten verbose k8s-style keys for display: "k8s-namespace" → "namespace"
const shortDimKey = (key: string): string =>
  key.replace(/^k8s-/, "").replace(/^kubernetes[_-]/, "");

// Full Tailwind class strings per named color — must be complete strings for Tailwind to scan them
const DIM_BORDER_CLASSES = {
  blue:   "tw:border-[0.0625em] tw:border-[#1d4ed8] tw:dark:border-[#93c5fd]",
  orange: "tw:border-[0.0625em] tw:border-[#c2410c] tw:dark:border-[#fdba74]",
  green:  "tw:border-[0.0625em] tw:border-[#065f46] tw:dark:border-[#6ee7b7]",
  purple: "tw:border-[0.0625em] tw:border-[#7c3aed] tw:dark:border-[#c4b5fd]",
  cyan:   "tw:border-[0.0625em] tw:border-[#0e7490] tw:dark:border-[#67e8f9]",
  pink:   "tw:border-[0.0625em] tw:border-[#9f1239] tw:dark:border-[#f9a8d4]",
  indigo: "tw:border-[0.0625em] tw:border-[#4f46e5] tw:dark:border-[#a5b4fc]",
  teal:   "tw:border-[0.0625em] tw:border-[#0f766e] tw:dark:border-[#5eead4]",
  red:    "tw:border-[0.0625em] tw:border-[#dc2626] tw:dark:border-[#fca5a5]",
  amber:  "tw:border-[0.0625em] tw:border-[#92400e] tw:dark:border-[#fcd34d]",
  gray:   "tw:border-[0.0625em] tw:border-[#4b5563] tw:dark:border-[#9ca3af]",
} as const;

type DimColor = keyof typeof DIM_BORDER_CLASSES;

// Dimension key → named color (aliases share the same color name)
const DIM_COLOR_KEY: Record<string, DimColor> = {
  deployment:       "blue",
  "k8s-deployment": "blue",
  namespace:        "orange",
  "k8s-namespace":  "orange",
  env:              "green",
  environment:      "green",
  host:             "purple",
  hostname:         "purple",
  service:          "cyan",
  service_name:     "cyan",
  region:           "pink",
  zone:             "pink",
  cluster:          "indigo",
  "k8s-cluster":    "indigo",
  pod:              "teal",
  container:        "red",
  app:              "amber",
  application:      "amber",
};

const dimColorClass = (key: string): string => {
  const colorKey = DIM_COLOR_KEY[key]
    ?? (Object.entries(DIM_COLOR_KEY).find(([k]) => key.toLowerCase().includes(k))?.[1] as DimColor | undefined)
    ?? "gray";
  return DIM_BORDER_CLASSES[colorKey];
};

const severityRowClass = (severity: string) =>
  severity === "critical" ? "tw:border-l-[0.1875em] tw:border-l-[#ef4444]" : "tw:border-l-[0.1875em] tw:border-l-[#f59e0b]";

const severityIconClass = (severity: string) =>
  severity === "critical" ? "tw:text-[#ef4444]" : "tw:text-[#f59e0b]";

const incidentRowClass = (severity: string) => {
  const s = (severity ?? "").toLowerCase();
  if (s === "p1") return "tw:border-l-[0.1875em] tw:border-l-[#ef4444]";
  if (s === "p2") return "tw:border-l-[0.1875em] tw:border-l-[#f59e0b]";
  return "tw:border-l-[0.1875em] tw:border-l-[#3b82f6]";
};

const incidentIconClass = (severity: string) => {
  const s = (severity ?? "").toLowerCase();
  if (s === "p1") return "tw:text-[#ef4444]";
  if (s === "p2") return "tw:text-[#f59e0b]";
  return "tw:text-[#3b82f6]";
};

const severityBadgeClass = (sev: string): string => {
  const s = (sev || "p4").toLowerCase();
  if (s === "p1") return "tw:bg-[#fef2f2] tw:text-[#b91c1c] tw:border-[0.0625em] tw:border-[#fca5a5] tw:dark:bg-[rgba(239,68,68,0.15)] tw:dark:text-[#fca5a5] tw:dark:border-[rgba(239,68,68,0.3)]";
  if (s === "p2") return "tw:bg-[#fff7ed] tw:text-[#c2410c] tw:border-[0.0625em] tw:border-[#fdba74] tw:dark:bg-[rgba(249,115,22,0.15)] tw:dark:text-[#fdba74] tw:dark:border-[rgba(249,115,22,0.3)]";
  if (s === "p3") return "tw:bg-[#fefce8] tw:text-[#a16207] tw:border-[0.0625em] tw:border-[#fde047] tw:dark:bg-[rgba(234,179,8,0.15)] tw:dark:text-[#fde047] tw:dark:border-[rgba(234,179,8,0.3)]";
  return "tw:bg-[#f0f9ff] tw:text-[#0369a1] tw:border-[0.0625em] tw:border-[#7dd3fc] tw:dark:bg-[rgba(59,130,246,0.15)] tw:dark:text-[#7dd3fc] tw:dark:border-[rgba(59,130,246,0.3)]";
};

const serviceCardClass = (svc: any) => {
  if (svc.errorFlag && svc.error_rate >= 5) return "tw:border-l-[0.1875em] tw:border-l-[#ef4444]";
  if (svc.errorFlag || svc.latencyFlag) return "tw:border-l-[0.1875em] tw:border-l-[#f59e0b]";
  return "tw:border-l-[0.1875em] tw:border-l-[#22c55e]";
};

// ── Navigation ───────────────────────────────────────────────────────────────
const goToAlert = (item: any) => {
  selectedAlertForHistory.value = item.alertConfig ?? { name: item.alertName };
  selectedAlertIdForHistory.value = item.alertId ?? "";
  showAlertHistoryDrawer.value = true;
};

const goToService = (svc: any) => {
  let filter = `service_name = '${svc.label ?? svc.id}'`;
  if (svc.errorFlag) filter += ` AND span_status = 'ERROR'`;

  const query: Record<string, string> = {
    org_identifier: orgId.value,
    tab: "spans",
    query: b64EncodeUnicode(filter),
    stream: svc.stream_name ?? graphStream.value,
  };

  if (dateTimeType.value === "relative") {
    query.period = relativeTime.value;
  } else {
    query.from = timeRange.value.startTime.toString();
    query.to = timeRange.value.endTime.toString();
  }

  router.push({ name: "traces", query });
};

const openServicePanel = (svc: any, e: MouseEvent) => {
  e.stopPropagation(); // don't also trigger goToService
  selectedService.value = svc;
  servicePanelVisible.value = true;
};

const closeServicePanel = () => {
  servicePanelVisible.value = false;
  selectedService.value = null;
};

const goToIncident = (inc: any) => {
  router.push({
    name: "incidentDetail",
    params: { id: inc.id },
    query: { org_identifier: orgId.value },
  });
};

const goToAlertList = () => {
  router.push({ name: "alertList", query: { org_identifier: orgId.value } });
};

const goToLogs = () => {
  router.push({ name: "logs", query: { org_identifier: orgId.value } });
};

const goToTraces = () => {
  router.push({ name: "traces", query: { org_identifier: orgId.value } });
};

// ── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(loadAll);

watch(
  () => store.state.selectedOrganization?.identifier,
  (val, old) => {
    if (val && val !== old) {
      _anomalyCache.delete(old ?? "");
      loadAll();
    }
  },
);

// zoConfig loads asynchronously after mount — retry incidents when it becomes available
watch(isIncidentsEnabled, (enabled) => {
  if (enabled && incidents.value.length === 0) loadIncidents();
});
</script>

<style>
.ov-event-row:last-child {
  border-bottom: none;
}
.ov-action-card:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}
.overview-tab::-webkit-scrollbar { width: 0.375em; }
.overview-tab::-webkit-scrollbar-track { background: transparent; }
.overview-tab::-webkit-scrollbar-thumb { background: var(--o2-border-color); border-radius: 0.1875em; }
</style>
