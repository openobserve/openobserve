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
  <div class="overview-tab flex flex-col gap-0 pt-[0.625rem] pr-[0.875rem] pb-[0.625rem] pl-[0.625rem] h-full overflow-y-auto text-(--color-text-heading)">
    <!-- Header: refresh + time picker -->
    <div class="flex justify-end mb-4">
      <div class="flex items-center gap-2">
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

    <!-- ACTIVE INCIDENTS (enterprise / cloud only) -->
    <section
      v-if="isIncidentsEnabled && incidents.length > 0"
      class="mb-5"
    >
      <div class="flex items-center justify-between mb-2 pl-1">
        <div class="text-sm font-medium tracking-[0.01em] text-(--color-text-heading)">
          {{ t('overview.activeIncidents') }}
          <OTag type="countChip" value="warning">{{ incidentsTotal }}</OTag>
          <span v-if="incidentsTotal > incidents.length" class="ml-2 text-xs font-normal text-(--color-text-muted) align-middle">{{ t('overview.showingOf', { shown: incidents.length, total: incidentsTotal }) }}</span>
        </div>
        <button class="text-xs font-medium text-(--color-primary-600) bg-none border-none p-0 cursor-pointer whitespace-nowrap transition-opacity duration-150 opacity-80 hover:opacity-100 hover:underline" @click="goToIncidentList">{{ t('overview.viewAll') }} →</button>
      </div>
      <div class="flex flex-col border border-[0.0625em] border-(--color-border-default) rounded-[0.375rem] overflow-hidden">
        <div
          v-for="inc in incidents"
          :key="inc.id"
          class="ov-alert-row ov-table-row flex items-center gap-3 py-[0.625rem] px-[0.875rem] bg-(--color-surface-base) transition-[background] duration-150 hover:bg-(--color-table-row-hover-bg)"
          :class="incidentRowClass(inc.severity)"
        >
          <span class="shrink-0 flex items-center" :class="incidentIconClass(inc.severity)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
              <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-(--color-text-heading) flex items-center flex-wrap gap-1">
              <OTag type="severity" :value="(inc.severity || 'p4').toLowerCase()" />
              {{ inc.title || t('overview.untitledIncident') }}
              <template v-if="inc.group_values && Object.keys(inc.group_values).length > 0">
                <ODimensionChip
                  v-for="[key, val] in sortedDimensions(inc.group_values)"
                  :key="key"
                  :dim-key="key"
                  :key-label="shortDimKey(key)"
                  :value="val"
                  :tooltip="true"
                />
              </template>
            </div>
          </div>
          <div class="flex items-center shrink-0 gap-[0.3rem] whitespace-nowrap w-48">
            <span class="text-xs text-(--color-text-muted) min-w-[4.5rem]">{{ relativeTime_(inc.first_alert_at) }}</span>
            <span class="text-xs text-(--color-text-muted)">·</span>
            <span class="text-xs font-normal text-(--color-text-secondary)">{{ inc.alert_count }} alerts</span>
          </div>
          <span class="ov-investigate-hover shrink-0 whitespace-nowrap">
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
    <section v-if="isEnterpriseOrCloud && services.length > 0" class="mb-5">
      <div class="flex items-center justify-between mb-2 pl-1">
        <div class="text-sm font-medium tracking-[0.01em] text-(--color-text-heading)">
          {{ t('overview.services') }}
          <OTag type="countChip" value="warning">{{ services.length }}</OTag>
          <span v-if="servicePanelVisible && selectedService" class="text-xs font-normal text-(--color-text-muted) ml-1">
            — viewing <strong class="font-semibold text-(--color-text-heading)">{{ selectedService.label ?? selectedService.id }}</strong>
          </span>
        </div>
        <button class="text-xs font-medium text-(--color-primary-600) bg-none border-none p-0 cursor-pointer whitespace-nowrap transition-opacity duration-150 opacity-80 hover:opacity-100 hover:underline" @click="goToServiceGraph">{{ t('overview.viewAll') }} →</button>
      </div>
      <div class="flex items-stretch gap-2">
        <button
          class="shrink-0 w-6 flex items-center justify-center cursor-pointer border border-[0.0625em] border-(--color-border-default) rounded-lg bg-(--color-surface-base) text-(--color-text-secondary) shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-all duration-150 hover:not-disabled:bg-(--color-table-row-hover-bg) hover:not-disabled:text-(--color-text-heading) hover:not-disabled:shadow-[0_2px_6px_rgba(0,0,0,0.12)] hover:not-disabled:-translate-y-px active:not-disabled:translate-y-0 active:not-disabled:shadow-[0_1px_2px_rgba(0,0,0,0.08)] disabled:opacity-25 disabled:cursor-not-allowed disabled:shadow-none"
          :disabled="!svcScrollCanLeft"
          @click="scrollServices(-1)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div ref="svcGridRef" class="ov-service-grid flex flex-row gap-2 overflow-x-auto flex-1 [scrollbar-width:none]" @scroll="onSvcScroll">
        <div
          v-for="svc in services"
          :key="svc.id"
          class="py-3 px-[0.875rem] rounded-[0.375rem] border border-[0.0625em] border-(--color-border-default) bg-(--color-surface-base) transition-[background] duration-150 basis-40 grow-0 shrink-0 min-w-40 max-w-40 cursor-pointer hover:bg-(--color-table-row-hover-bg)"
          :class="[serviceCardClass(svc), { 'bg-(--color-table-row-hover-bg) outline outline-[0.125em] outline-(--color-primary-600) [outline-offset:-0.0625em]': selectedService?.id === svc.id && servicePanelVisible }]"
          @click="openServicePanel(svc)"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-(--color-text-heading) flex-1 min-w-0 block overflow-hidden text-ellipsis whitespace-nowrap cursor-default" :title="svc.label ?? svc.id">{{ svc.label }}</span>
            <span class="inline-flex items-center shrink-0 ml-1">
              <OButton
                variant="ghost-muted"
                size="icon"
                :title="t('traces.servicesCatalog.viewTraces')"
                @click="goToService(svc, $event)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                  <path d="M12 16v-4m0-4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </OButton>
            </span>
          </div>
          <div class="flex flex-col gap-1 mt-2">
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-[0.6875rem] font-semibold tracking-[0.04em] text-(--color-text-secondary)">{{ t('overview.colErrorRate') }}</span>
              <span class="text-sm font-medium text-(--color-text-body)" :class="svc.errorFlag ? 'text-(--color-error-600)' : ''">
                {{ svc.error_rate != null ? svc.error_rate.toFixed(1) + '%' : '—' }}
              </span>
            </div>
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-[0.6875rem] font-semibold tracking-[0.04em] text-(--color-text-secondary)">{{ t('overview.colLatency') }}</span>
              <span class="text-sm font-medium text-(--color-text-body)" :class="svc.latencyFlag ? 'text-(--color-warning-700)' : ''">
                {{ svc.latencyMultiplier ? svc.latencyMultiplier + 'x' : '—' }}
              </span>
            </div>
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-[0.6875rem] font-semibold tracking-[0.04em] text-(--color-text-secondary)">{{ t('overview.colReqs') }}</span>
              <span class="text-sm font-medium text-(--color-text-body)">{{ formatReqRate(svc.requests) }}</span>
            </div>
          </div>
        </div>
        </div>
        <button
          class="shrink-0 w-6 flex items-center justify-center cursor-pointer border border-[0.0625em] border-(--color-border-default) rounded-lg bg-(--color-surface-base) text-(--color-text-secondary) shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-all duration-150 hover:not-disabled:bg-(--color-table-row-hover-bg) hover:not-disabled:text-(--color-text-heading) hover:not-disabled:shadow-[0_2px_6px_rgba(0,0,0,0.12)] hover:not-disabled:-translate-y-px active:not-disabled:translate-y-0 active:not-disabled:shadow-[0_1px_2px_rgba(0,0,0,0.08)] disabled:opacity-25 disabled:cursor-not-allowed disabled:shadow-none"
          :disabled="!svcScrollCanRight"
          @click="scrollServices(1)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </section>

    <!-- Service node side panel (latency / RED charts) -->
    <template v-if="isEnterpriseOrCloud && selectedService">
      <div
        v-if="servicePanelVisible"
        class="fixed inset-0 z-[99] bg-transparent"
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

    <!-- ACTIVE ANOMALIES -->
    <section v-if="anomalies.length > 0" class="mb-5">
      <div class="flex items-center justify-between mb-2 pl-1">
        <div class="text-sm font-medium tracking-[0.01em] text-(--color-text-heading)">
          {{ t('overview.activeAnomalies') }}
          <OTag type="countChip" value="warning">{{ anomalies.length }}</OTag>
        </div>
        <button class="text-xs font-medium text-(--color-primary-600) bg-none border-none p-0 cursor-pointer whitespace-nowrap transition-opacity duration-150 opacity-80 hover:opacity-100 hover:underline" @click="goToAnomalies">{{ t('overview.viewAll') }} →</button>
      </div>
      <div class="flex flex-col gap-[0.375rem]">
        <div
          v-for="item in anomalies"
          :key="item.id"
          class="ov-alert-row flex items-center gap-3 py-[0.625rem] px-[0.875rem] rounded-[0.375rem] border border-[0.0625em] border-(--color-border-default) bg-(--color-surface-base) transition-[background] duration-150 hover:bg-(--color-table-row-hover-bg)"
          :class="severityRowClass(item.severity)"
        >
          <span class="shrink-0 flex items-center" :class="severityIconClass(item.severity)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-(--color-text-heading) flex items-center flex-wrap gap-1 [row-gap:0.25rem]">
              {{ item.title }}
              <span class="text-xs text-(--color-text-muted) font-normal mx-[0.1rem]">·</span>
              <span class="text-xs text-(--color-text-muted) font-normal">{{ item.description }}</span>
            </div>
          </div>
          <span class="ov-investigate-hover shrink-0 whitespace-nowrap">
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

    <!-- RECENT EVENTS (alert firing feed) -->
    <section v-if="recentEvents.length > 0" class="mb-5">
      <div class="flex items-center justify-between mb-2 pl-1">
        <div class="text-sm font-medium tracking-[0.01em] text-(--color-text-heading)">
          {{ t('overview.recentEvents') }}
          <OTag type="countChip" value="warning">{{ recentEvents.length }}</OTag>
        </div>
        <button class="text-xs font-medium text-(--color-primary-600) bg-none border-none p-0 cursor-pointer whitespace-nowrap transition-opacity duration-150 opacity-80 hover:opacity-100 hover:underline" @click="goToAlertList">{{ t('overview.viewAll') }} →</button>
      </div>
      <div class="flex flex-col gap-0 border border-[0.0625em] border-(--color-border-default) rounded-[0.375rem] overflow-hidden bg-(--color-surface-base)">
        <div
          v-for="ev in recentEvents"
          :key="ev.id"
          class="ov-event-row flex items-center gap-3 py-2 px-[0.875rem] border-b border-b-[0.0625em] border-b-(--color-border-default) text-[0.8125rem] transition-[background] duration-150 hover:bg-(--color-table-row-hover-bg)"
        >
          <OTag type="eventStatus" :value="ev.typeLabel" class="shrink-0" />
          <span class="font-medium text-(--color-text-heading) whitespace-nowrap min-w-[7.5em] max-w-[12.5em] overflow-hidden text-ellipsis">{{ ev.service }}</span>
          <span class="flex-1 text-(--color-text-muted) truncate">{{ ev.description }}</span>
          <OTag
            v-if="ev.failCount > 1"
            type="countChip"
            value="error"
            class="shrink-0"
            :title="`Failed ${ev.failCount} times in this window`"
          >×{{ ev.failCount }}</OTag>
          <span class="shrink-0 text-(--color-text-muted) text-xs whitespace-nowrap">{{ ev.timeAgo }}</span>
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
        <button v-if="showAlertsCard" type="button" class="ov-action-card group relative flex items-center gap-3 flex-1 basis-56 min-w-0 max-w-72 min-h-16 py-[0.625rem] pr-[0.875rem] pl-3 rounded-xl border border-(--color-border-default) bg-(--color-surface-base) shadow-(--shadow-sm) text-left cursor-pointer transition-[color,background-color,border-color,box-shadow] duration-150 outline-none hover:shadow-(--shadow-md) hover:border-(--color-primary-400) hover:bg-(--color-tabs-hover-bg)" data-test="overview-empty-alerts-card" @click="goToAlertList">
          <span class="inline-flex items-center justify-center shrink-0 w-10 h-10 rounded-lg transition-[background-color,color] duration-150 bg-(--color-warning-50) text-(--color-warning-700) group-hover:bg-(--color-primary-600) group-hover:text-(--color-text-inverse)">
            <OIcon name="notifications" size="md" />
          </span>
          <span class="flex-1 min-w-0 flex flex-col gap-[0.125rem]">
            <span class="text-(length:--text-sm) font-semibold text-(--color-text-primary) truncate">{{ t('overview.emptyActionAlerts') }}</span>
            <span class="text-(length:--text-xs) text-(--color-text-secondary) leading-[1.4]">{{ t('overview.emptyActionAlertsDesc') }}</span>
          </span>
          <OIcon name="chevron-right" size="sm" class="shrink-0 text-(--color-text-disabled) transition-[transform,color] duration-150 group-hover:translate-x-[0.125rem] group-hover:text-(--color-primary-600)" />
        </button>
        <!-- Explore logs -->
        <button v-if="showLogsCard" type="button" class="ov-action-card group relative flex items-center gap-3 flex-1 basis-56 min-w-0 max-w-72 min-h-16 py-[0.625rem] pr-[0.875rem] pl-3 rounded-xl border border-(--color-border-default) bg-(--color-surface-base) shadow-(--shadow-sm) text-left cursor-pointer transition-[color,background-color,border-color,box-shadow] duration-150 outline-none hover:shadow-(--shadow-md) hover:border-(--color-primary-400) hover:bg-(--color-tabs-hover-bg)" data-test="overview-empty-logs-card" @click="goToLogs">
          <span class="inline-flex items-center justify-center shrink-0 w-10 h-10 rounded-lg transition-[background-color,color] duration-150 bg-(--color-info-50) text-(--color-info-700) group-hover:bg-(--color-primary-600) group-hover:text-(--color-text-inverse)">
            <OIcon name="search" size="md" />
          </span>
          <span class="flex-1 min-w-0 flex flex-col gap-[0.125rem]">
            <span class="text-(length:--text-sm) font-semibold text-(--color-text-primary) truncate">{{ t('overview.emptyActionLogs') }}</span>
            <span class="text-(length:--text-xs) text-(--color-text-secondary) leading-[1.4]">{{ t('overview.emptyActionLogsDesc') }}</span>
          </span>
          <OIcon name="chevron-right" size="sm" class="shrink-0 text-(--color-text-disabled) transition-[transform,color] duration-150 group-hover:translate-x-[0.125rem] group-hover:text-(--color-primary-600)" />
        </button>
        <!-- Explore traces -->
        <button v-if="showTracesCard" type="button" class="ov-action-card group relative flex items-center gap-3 flex-1 basis-56 min-w-0 max-w-72 min-h-16 py-[0.625rem] pr-[0.875rem] pl-3 rounded-xl border border-(--color-border-default) bg-(--color-surface-base) shadow-(--shadow-sm) text-left cursor-pointer transition-[color,background-color,border-color,box-shadow] duration-150 outline-none hover:shadow-(--shadow-md) hover:border-(--color-primary-400) hover:bg-(--color-tabs-hover-bg)" data-test="overview-empty-traces-card" @click="goToTraces">
          <span class="inline-flex items-center justify-center shrink-0 w-10 h-10 rounded-lg transition-[background-color,color] duration-150 bg-(--color-info-50) text-(--color-info-700) group-hover:bg-(--color-primary-600) group-hover:text-(--color-text-inverse)">
            <OIcon name="account-tree" size="md" />
          </span>
          <span class="flex-1 min-w-0 flex flex-col gap-[0.125rem]">
            <span class="text-(length:--text-sm) font-semibold text-(--color-text-primary) truncate">{{ t('overview.emptyActionTraces') }}</span>
            <span class="text-(length:--text-xs) text-(--color-text-secondary) leading-[1.4]">{{ t('overview.emptyActionTracesDesc') }}</span>
          </span>
          <OIcon name="chevron-right" size="sm" class="shrink-0 text-(--color-text-disabled) transition-[transform,color] duration-150 group-hover:translate-x-[0.125rem] group-hover:text-(--color-primary-600)" />
        </button>
      </template>
    </OEmptyState>

    <!-- Loading skeleton (standard O2 wave shimmer) -->
    <div v-if="isLoading" class="flex flex-col gap-2 py-2 px-0">
      <OSkeleton v-for="i in 3" :key="i" class="h-[3.25em]" />
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
import { ref, computed, defineAsyncComponent, onMounted, watch, nextTick } from "vue";

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
import OTag from "@/lib/core/Badge/OTag.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
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
const incidentsTotal = ref(0);
const services = ref<any[]>([]);
const recentEvents = ref<any[]>([]);

// Alert history drawer state
const showAlertHistoryDrawer = ref(false);
const selectedAlertForHistory = ref<any>(null);
const selectedAlertIdForHistory = ref("");

// Service grid scroll
const svcGridRef = ref<HTMLElement | null>(null);
const svcScrollCanLeft = ref(false);
const svcScrollCanRight = ref(false);

const onSvcScroll = () => {
  const el = svcGridRef.value;
  if (!el) return;
  svcScrollCanLeft.value = el.scrollLeft > 0;
  svcScrollCanRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
};

const scrollServices = (dir: 1 | -1) => {
  const el = svcGridRef.value;
  if (!el) return;
  el.scrollBy({ left: dir * (11 * 16 + 8), behavior: "smooth" });
};

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
      const bulkRes = await anomalyService.getAllHistory(org, 20);
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
      .slice(0, 3);

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
      .slice(0, 5)
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
      .slice(0, 5);
  } catch {
    recentEvents.value = [];
  }
};

const loadIncidents = async () => {
  if (!isIncidentsEnabled.value) return;
  try {
    const res = await incidentsService.list(orgId.value, "open", 4, 0);
    incidents.value = res.data?.incidents ?? [];
    incidentsTotal.value = res.data?.total ?? incidents.value.length;
  } catch {
    incidents.value = [];
    incidentsTotal.value = 0;
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
      .slice(0, 12);
    await nextTick();
    onSvcScroll();
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

const severityRowClass = (severity: string) =>
  severity === "critical"
    ? "border-l-[0.1875em] border-l-(--color-error-600)"
    : "border-l-[0.1875em] border-l-(--color-warning-600)";

const severityIconClass = (severity: string) =>
  severity === "critical" ? "text-(--color-error-600)" : "text-(--color-warning-600)";

const incidentRowClass = (severity: string) => {
  const s = (severity ?? "").toLowerCase();
  if (s === "p1") return "border-l-(--color-error-600)";
  if (s === "p2") return "border-l-(--color-warning-600)";
  return "border-l-(--color-info-700)";
};

const incidentIconClass = (severity: string) => {
  const s = (severity ?? "").toLowerCase();
  if (s === "p1") return "text-(--color-error-600)";
  if (s === "p2") return "text-(--color-warning-600)";
  return "text-(--color-info-700)";
};

const severityBadgeClass = (sev: string): string => {
  const s = (sev || "p4").toLowerCase();
  if (s === "p1") return "bg-(--color-error-50) text-(--color-error-600) border border-[0.0625em] border-(--color-error-600)";
  if (s === "p2") return "bg-(--color-warning-50) text-(--color-warning-700) border border-[0.0625em] border-(--color-warning-600)";
  if (s === "p3") return "bg-(--color-warning-50) text-(--color-warning-700) border border-[0.0625em] border-(--color-warning-600)";
  return "bg-(--color-info-50) text-(--color-info-700) border border-[0.0625em] border-(--color-info-700)";
};

const serviceCardClass = (svc: any) => {
  if (svc.errorFlag && svc.error_rate >= 5) return "border-l-[0.1875em] border-l-(--color-error-600)";
  if (svc.errorFlag || svc.latencyFlag) return "border-l-[0.1875em] border-l-(--color-warning-600)";
  return "border-l-[0.1875em] border-l-(--color-success-600)";
};

// ── Navigation ───────────────────────────────────────────────────────────────
const goToAlert = (item: any) => {
  selectedAlertForHistory.value = item.alertConfig ?? { name: item.alertName };
  selectedAlertIdForHistory.value = item.alertId ?? "";
  showAlertHistoryDrawer.value = true;
};

const goToService = (svc: any, e?: MouseEvent) => {
  // Fired from the per-card info-icon button — stop it bubbling to the card
  // click (which opens the latency/info side panel).
  e?.stopPropagation();
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

const openServicePanel = (svc: any, _e?: MouseEvent) => {
  // The card's own click handler (behaviour swapped with the info icon):
  // clicking the card body opens the latency/info side panel.
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

// Reuses the same signal the left-nav flyout uses to decide whether a section
// is reachable at all (navGroups.ts) — a route only exists on the router when
// its feature/RBAC gate allows it, so `hasRoute` keeps this empty state from
// ever offering a card the user has no way to actually land on.
const showAlertsCard = computed(() => router.hasRoute("alertList"));
const showLogsCard = computed(() => router.hasRoute("logs"));
const showTracesCard = computed(() => router.hasRoute("traces"));

const goToAlertList = () => {
  router.push({ name: "alertList", query: { org_identifier: orgId.value } });
};

const goToIncidentList = () => {
  router.push({ name: "incidentList", query: { org_identifier: orgId.value, status: "open" } });
};

const goToAnomalies = () => {
  router.push({ name: "alertList", query: { org_identifier: orgId.value, tab: "anomalyDetection" } });
};

const goToLogs = () => {
  router.push({ name: "logs", query: { org_identifier: orgId.value } });
};

const goToTraces = () => {
  router.push({ name: "traces", query: { org_identifier: orgId.value } });
};

const goToServiceGraph = () => {
  const query: Record<string, string> = {
    org_identifier: orgId.value,
    tab: "service-graph",
  };
  if (dateTimeType.value === "relative") {
    query.period = relativeTime.value;
  } else {
    query.from = timeRange.value.startTime.toString();
    query.to = timeRange.value.endTime.toString();
  }
  router.push({ name: "traces", query });
};

const goToAlertHistory = () => {
  router.push({ name: "alertHistory", query: { org_identifier: orgId.value } });
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
/* Incidents table rows — !important overrides to beat the shared .ov-alert-row
   base border/radius, plus :last-child border removal. Not cleanly inlineable. */
.ov-table-row {
  border-radius: 0 !important;
  border-left-width: 0.1875em !important;
  border-top: none !important;
  border-right: none !important;
  border-bottom: 0.0625em solid var(--color-border-default) !important;
}
.ov-table-row:last-child {
  border-bottom: none !important;
}

/* Hover-only Investigate button — visible only when the parent row is hovered.
   Descendant/combinator selector cannot be inlined. */
.ov-investigate-hover {
  visibility: hidden;
}
.ov-alert-row:hover .ov-investigate-hover {
  visibility: visible;
}

/* Recent-events last row border removal — structural pseudo-class. */
.ov-event-row:last-child {
  border-bottom: none;
}

/* Empty-state action card focus ring — :focus-visible pseudo-class. */
.ov-action-card:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}

/* Hide the horizontal scrollbar on the services grid — pseudo-element. */
.ov-service-grid::-webkit-scrollbar { display: none; }

/* Overview scrollbar styling — pseudo-elements. */
.overview-tab::-webkit-scrollbar { width: 0.375em; }
.overview-tab::-webkit-scrollbar-track { background: transparent; }
.overview-tab::-webkit-scrollbar-thumb { background: var(--color-border-default); border-radius: 0.1875em; }
</style>
