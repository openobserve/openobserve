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
  <div class="px-page-edge text-text-body flex h-full flex-col gap-0 overflow-y-auto pt-2.5 pb-2.5">
    <!-- Header: refresh + time picker -->
    <div class="mb-4 flex justify-end">
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
          :default-absolute-time="{
            startTime: absoluteTime.startTime,
            endTime: absoluteTime.endTime,
          }"
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
      data-test="overview-incidents-section"
    >
      <div class="mb-2 flex items-center justify-between pl-1">
        <div class="text-text-heading text-sm font-medium tracking-[0.01em]">
          {{ t("overview.activeIncidents") }}
          <OTag type="countChip" value="warning">{{ incidentsTotal }}</OTag>
          <span
            v-if="incidentsTotal > incidents.length"
            class="text-text-secondary ml-2 align-middle text-xs font-normal"
            >{{ t("overview.showingOf", { shown: incidents.length, total: incidentsTotal }) }}</span
          >
        </div>
        <button
          class="text-primary-600 cursor-pointer border-none bg-none p-0 text-xs font-medium whitespace-nowrap opacity-80 transition-opacity duration-150 hover:underline hover:opacity-100"
          @click="goToIncidentList"
        >
          {{ t("overview.viewAll") }} →
        </button>
      </div>
      <div
        class="border-border-default rounded-default flex flex-col overflow-hidden border border-[0.0625em]"
      >
        <div
          v-for="inc in incidents"
          :key="inc.id"
          class="group bg-surface-base hover:bg-table-row-hover-bg border-b-border-default flex items-center gap-3 border-b-[0.0625em] border-l-[0.1875em] px-3.5 py-2.5 transition-[background] duration-150 last:border-b-0"
          :class="incidentRowClass(inc.severity)"
        >
          <span class="flex shrink-0 items-center" :class="incidentIconClass(inc.severity)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
              <path
                d="M12 8v4m0 4h.01"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <div class="min-w-0 flex-1">
            <div class="text-text-heading flex flex-wrap items-center gap-1 text-sm font-medium">
              <OTag type="severity" :value="(inc.severity || 'p4').toLowerCase()" />
              {{ inc.title || t("overview.untitledIncident") }}
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
          <div class="flex w-48 shrink-0 items-center gap-[0.3rem] whitespace-nowrap">
            <span class="text-text-secondary min-w-[4.5rem] text-xs">{{
              relativeTime_(inc.first_alert_at)
            }}</span>
            <span class="text-text-secondary text-xs">·</span>
            <span class="text-text-secondary text-xs font-normal"
              >{{ inc.alert_count }} alerts</span
            >
          </div>
          <span class="invisible shrink-0 whitespace-nowrap group-hover:visible">
            <OButton variant="ghost-primary" size="sm" @click="goToIncident(inc)">
              {{ t("overview.investigate") }}
            </OButton>
          </span>
        </div>
      </div>
    </section>
    <OverviewSkeleton
      v-else-if="isIncidentsEnabled && isSectionPending('incidents')"
      section="incidents"
    />

    <!-- SERVICES (enterprise only — needs service graph data) -->
    <section
      v-if="isEnterpriseOrCloud && services.length > 0"
      class="mb-5"
      data-test="overview-services-section"
    >
      <div class="mb-2 flex items-center justify-between pl-1">
        <div class="text-text-heading text-sm font-medium tracking-[0.01em]">
          {{ t("overview.services") }}
          <OTag type="countChip" value="warning">{{ services.length }}</OTag>
          <span
            v-if="servicePanelVisible && selectedService"
            class="text-text-secondary ml-1 text-xs font-normal"
          >
            — viewing
            <strong class="text-text-body font-semibold">{{
              selectedService.label ?? selectedService.id
            }}</strong>
          </span>
        </div>
        <button
          class="text-primary-600 cursor-pointer border-none bg-none p-0 text-xs font-medium whitespace-nowrap opacity-80 transition-opacity duration-150 hover:underline hover:opacity-100"
          @click="goToServiceGraph"
        >
          {{ t("overview.viewAll") }} →
        </button>
      </div>
      <div class="relative">
        <!-- Left fade + floating scroll control (only present when scrollable) -->
        <div
          class="from-surface-base pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center bg-linear-to-r to-transparent pr-8 transition-opacity duration-200"
          :class="svcScrollCanLeft ? 'opacity-100' : 'opacity-0'"
        >
          <button
            class="border-border-default bg-surface-base text-text-secondary hover:bg-table-row-hover-bg hover:text-text-body pointer-events-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-[0.0625em] shadow-[0_2px_6px_rgba(0,0,0,0.12)] transition-all duration-150 hover:shadow-[0_3px_8px_rgba(0,0,0,0.16)] active:shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
            :tabindex="svcScrollCanLeft ? 0 : -1"
            :aria-hidden="!svcScrollCanLeft"
            :aria-label="t('overview.scrollLeft')"
            @click="scrollServices(-1)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
        <div
          ref="svcGridRef"
          class="flex flex-row gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          @scroll="onSvcScroll"
        >
          <div
            v-for="svc in services"
            :key="svc.id"
            class="rounded-default border-border-default bg-surface-base max-w-40 min-w-40 shrink-0 grow-0 basis-40 cursor-pointer border border-[0.0625em] px-3.5 py-3 transition-[background-color,box-shadow,outline-color] duration-150"
            :class="[
              serviceCardClass(svc),
              selectedService?.id === svc.id && servicePanelVisible
                ? 'outline-primary-500 bg-[color-mix(in_srgb,var(--color-primary-500)_8%,var(--color-surface-base))] shadow-[0_0.125rem_0.5rem_color-mix(in_srgb,var(--color-primary-500)_22%,transparent)] outline-[0.125em] outline-offset-[-0.0625em] outline-solid'
                : 'hover:bg-table-row-hover-bg',
            ]"
            @click="openServicePanel(svc)"
          >
            <div class="mb-2 flex items-center justify-between">
              <span
                class="text-text-heading block min-w-0 flex-1 cursor-default overflow-hidden text-sm font-medium text-ellipsis whitespace-nowrap"
                :title="svc.label ?? svc.id"
                >{{ svc.label }}</span
              >
              <span class="ml-1 inline-flex shrink-0 items-center">
                <OButton
                  variant="ghost-muted"
                  size="icon"
                  :title="t('traces.servicesCatalog.viewTraces')"
                  @click="goToService(svc, $event)"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
                    <path
                      d="M12 16v-4m0-4h.01"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </OButton>
              </span>
            </div>
            <div class="mt-2 flex flex-col gap-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-2xs text-text-secondary font-semibold tracking-[0.04em]">{{
                  t("overview.colErrorRate")
                }}</span>
                <span
                  class="text-text-body text-sm font-medium"
                  :class="svc.errorFlag ? 'text-error-600' : ''"
                >
                  {{ svc.error_rate != null ? svc.error_rate.toFixed(1) + "%" : "—" }}
                </span>
              </div>
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-2xs text-text-secondary font-semibold tracking-[0.04em]">{{
                  t("overview.colLatency")
                }}</span>
                <span
                  class="text-text-body text-sm font-medium"
                  :class="svc.latencyFlag ? 'text-warning-700' : ''"
                >
                  {{ svc.latencyMultiplier ? svc.latencyMultiplier + "x" : "—" }}
                </span>
              </div>
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-2xs text-text-secondary font-semibold tracking-[0.04em]">{{
                  t("overview.colReqs")
                }}</span>
                <span class="text-text-body text-sm font-medium">{{
                  formatReqRate(svc.requests)
                }}</span>
              </div>
            </div>
          </div>
        </div>
        <!-- Right fade + floating scroll control (only present when scrollable) -->
        <div
          class="from-surface-base pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center justify-end bg-linear-to-l to-transparent pl-8 transition-opacity duration-200"
          :class="svcScrollCanRight ? 'opacity-100' : 'opacity-0'"
        >
          <button
            class="border-border-default bg-surface-base text-text-secondary hover:bg-table-row-hover-bg hover:text-text-body pointer-events-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-[0.0625em] shadow-[0_2px_6px_rgba(0,0,0,0.12)] transition-all duration-150 hover:shadow-[0_3px_8px_rgba(0,0,0,0.16)] active:shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
            :tabindex="svcScrollCanRight ? 0 : -1"
            :aria-hidden="!svcScrollCanRight"
            :aria-label="t('overview.scrollRight')"
            @click="scrollServices(1)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 18l6-6-6-6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </section>
    <OverviewSkeleton
      v-else-if="isEnterpriseOrCloud && isSectionPending('services')"
      section="services"
    />

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
    <section v-if="anomalies.length > 0" class="mb-5" data-test="overview-anomalies-section">
      <div class="mb-2 flex items-center justify-between pl-1">
        <div class="text-text-heading text-sm font-medium tracking-[0.01em]">
          {{ t("overview.activeAnomalies") }}
          <OTag type="countChip" value="warning">{{ anomalies.length }}</OTag>
        </div>
        <button
          class="text-primary-600 cursor-pointer border-none bg-none p-0 text-xs font-medium whitespace-nowrap opacity-80 transition-opacity duration-150 hover:underline hover:opacity-100"
          @click="goToAnomalies"
        >
          {{ t("overview.viewAll") }} →
        </button>
      </div>
      <div class="flex flex-col gap-1.5">
        <div
          v-for="item in anomalies"
          :key="item.id"
          class="group rounded-default border-border-default bg-surface-base hover:bg-table-row-hover-bg flex items-center gap-3 border border-[0.0625em] px-3.5 py-2.5 transition-[background] duration-150"
          :class="severityRowClass(item.severity)"
        >
          <span class="flex shrink-0 items-center" :class="severityIconClass(item.severity)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <div class="min-w-0 flex-1">
            <div
              class="text-text-heading flex flex-wrap items-center gap-1 [row-gap:0.25rem] text-sm font-medium"
            >
              {{ item.title }}
              <span class="text-text-secondary mx-[0.1rem] text-xs font-normal">·</span>
              <span class="text-text-secondary text-xs font-normal">{{ item.description }}</span>
            </div>
          </div>
          <span class="invisible shrink-0 whitespace-nowrap group-hover:visible">
            <OButton variant="ghost-primary" size="sm" @click="goToAlert(item)">
              {{ t("overview.investigate") }}
            </OButton>
          </span>
        </div>
      </div>
    </section>
    <OverviewSkeleton v-else-if="isSectionPending('anomalies')" section="anomalies" />

    <!-- RECENT EVENTS (alert firing feed) -->
    <section v-if="recentEvents.length > 0" class="mb-5" data-test="overview-recent-events-section">
      <div class="mb-2 flex items-center justify-between pl-1">
        <div class="text-text-heading text-sm font-medium tracking-[0.01em]">
          {{ t("overview.recentEvents") }}
          <OTag type="countChip" value="warning">{{ recentEvents.length }}</OTag>
        </div>
        <button
          class="text-primary-600 cursor-pointer border-none bg-none p-0 text-xs font-medium whitespace-nowrap opacity-80 transition-opacity duration-150 hover:underline hover:opacity-100"
          @click="goToAlertList"
        >
          {{ t("overview.viewAll") }} →
        </button>
      </div>
      <div
        class="border-border-default rounded-default bg-surface-base flex flex-col gap-0 overflow-hidden border border-[0.0625em]"
      >
        <div
          v-for="ev in recentEvents"
          :key="ev.id"
          class="border-b-border-default text-compact hover:bg-table-row-hover-bg flex items-center gap-3 border-b border-b-[0.0625em] px-3.5 py-2 transition-[background] duration-150 last:border-b-0"
        >
          <OTag type="eventStatus" :value="ev.typeLabel" class="shrink-0" />
          <span
            class="text-text-heading max-w-[12.5em] min-w-[7.5em] overflow-hidden font-medium text-ellipsis whitespace-nowrap"
            >{{ ev.service }}</span
          >
          <span class="text-text-secondary flex-1 truncate">{{ ev.description }}</span>
          <OTag
            v-if="ev.failCount > 1"
            type="countChip"
            value="error"
            class="shrink-0"
            :title="`Failed ${ev.failCount} times in this window`"
            >×{{ ev.failCount }}</OTag
          >
          <span class="text-text-secondary shrink-0 text-xs whitespace-nowrap">{{
            ev.timeAgo
          }}</span>
        </div>
      </div>
    </section>
    <OverviewSkeleton v-else-if="isSectionPending('recentEvents')" section="recentEvents" />

    <!-- Empty state — everything is healthy or no data yet -->
    <OEmptyState
      v-if="!isLoading && !hasAnyData"
      illustration="check"
      size="hero"
      :hide-action="true"
      data-test="overview-all-clear-empty-state"
    >
      <template #title>{{ t("overview.allClear") }}</template>
      <template #description>{{ t("overview.allClearDesc") }}</template>
      <template #actions>
        <!-- View alerts -->
        <button
          v-if="showAlertsCard"
          type="button"
          class="group rounded-default border-border-default bg-surface-base hover:border-primary-400 hover:bg-tabs-hover-bg relative flex min-h-16 max-w-72 min-w-0 flex-1 basis-56 cursor-pointer items-center gap-3 border py-2.5 pr-3.5 pl-3 text-left transition-[color,background-color,border-color,box-shadow] duration-150 outline-none hover:shadow-md focus-visible:shadow-[0_0_0_0.125rem_color-mix(in_srgb,var(--color-primary-500)_40%,transparent)]"
          data-test="overview-empty-alerts-card"
          @click="goToAlertList"
        >
          <span
            class="rounded-default bg-icon-chip-warning-bg text-icon-chip-warning-text group-hover:bg-primary-600 group-hover:text-text-inverse inline-flex h-10 w-10 shrink-0 items-center justify-center transition-[background-color,color] duration-150"
          >
            <OIcon name="notifications" size="md" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-text-heading truncate text-(length:--text-sm) font-semibold">{{
              t("overview.emptyActionAlerts")
            }}</span>
            <span class="text-text-secondary text-(length:--text-xs) leading-[1.4]">{{
              t("overview.emptyActionAlertsDesc")
            }}</span>
          </span>
          <OIcon
            name="chevron-right"
            size="sm"
            class="text-text-disabled group-hover:text-primary-600 shrink-0 transition-[transform,color] duration-150 group-hover:translate-x-0.5"
          />
        </button>
        <!-- Explore logs -->
        <button
          v-if="showLogsCard"
          type="button"
          class="group rounded-default border-border-default bg-surface-base hover:border-primary-400 hover:bg-tabs-hover-bg relative flex min-h-16 max-w-72 min-w-0 flex-1 basis-56 cursor-pointer items-center gap-3 border py-2.5 pr-3.5 pl-3 text-left transition-[color,background-color,border-color,box-shadow] duration-150 outline-none hover:shadow-md focus-visible:shadow-[0_0_0_0.125rem_color-mix(in_srgb,var(--color-primary-500)_40%,transparent)]"
          data-test="overview-empty-logs-card"
          @click="goToLogs"
        >
          <span
            class="rounded-default bg-status-info-bg text-status-info-text group-hover:bg-primary-600 group-hover:text-text-inverse inline-flex h-10 w-10 shrink-0 items-center justify-center transition-[background-color,color] duration-150"
          >
            <OIcon name="search" size="md" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-text-heading truncate text-(length:--text-sm) font-semibold">{{
              t("overview.emptyActionLogs")
            }}</span>
            <span class="text-text-secondary text-(length:--text-xs) leading-[1.4]">{{
              t("overview.emptyActionLogsDesc")
            }}</span>
          </span>
          <OIcon
            name="chevron-right"
            size="sm"
            class="text-text-disabled group-hover:text-primary-600 shrink-0 transition-[transform,color] duration-150 group-hover:translate-x-0.5"
          />
        </button>
        <!-- Explore traces -->
        <button
          v-if="showTracesCard"
          type="button"
          class="group rounded-default border-border-default bg-surface-base hover:border-primary-400 hover:bg-tabs-hover-bg relative flex min-h-16 max-w-72 min-w-0 flex-1 basis-56 cursor-pointer items-center gap-3 border py-2.5 pr-3.5 pl-3 text-left transition-[color,background-color,border-color,box-shadow] duration-150 outline-none hover:shadow-md focus-visible:shadow-[0_0_0_0.125rem_color-mix(in_srgb,var(--color-primary-500)_40%,transparent)]"
          data-test="overview-empty-traces-card"
          @click="goToTraces"
        >
          <span
            class="rounded-default bg-status-info-bg text-status-info-text group-hover:bg-primary-600 group-hover:text-text-inverse inline-flex h-10 w-10 shrink-0 items-center justify-center transition-[background-color,color] duration-150"
          >
            <OIcon name="account-tree" size="md" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-text-heading truncate text-(length:--text-sm) font-semibold">{{
              t("overview.emptyActionTraces")
            }}</span>
            <span class="text-text-secondary text-(length:--text-xs) leading-[1.4]">{{
              t("overview.emptyActionTracesDesc")
            }}</span>
          </span>
          <OIcon
            name="chevron-right"
            size="sm"
            class="text-text-disabled group-hover:text-primary-600 shrink-0 transition-[transform,color] duration-150 group-hover:translate-x-0.5"
          />
        </button>
      </template>
    </OEmptyState>

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
import { ref, reactive, computed, defineAsyncComponent, onMounted, watch, nextTick } from "vue";

// Module-level cache for anomaly history — survives re-renders, cleared on org change
const ANOMALY_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const _anomalyCache = new Map<
  string,
  { ts: number; startTime: number; endTime: number; data: any[] }
>();
import { useI18n } from "vue-i18n";
import { b64EncodeUnicode } from "@/utils/zincutils";
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
import OverviewSkeleton from "./OverviewSkeleton.vue";
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
  () => config.isEnterprise === "true" || config.isCloud === "true",
);
const isIncidentsEnabled = computed(
  () => isEnterpriseOrCloud.value && store.state.zoConfig?.incidents_enabled === true,
);

// ── Date / time picker ───────────────────────────────────────────────────────
const LS_TIME_KEY = "o2_overview_time";

function loadSavedTime() {
  try {
    const raw = localStorage.getItem(LS_TIME_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore: corrupt/absent saved time falls back to null */
  }
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
  },
);
const timeRange = ref(
  saved?.timeRange ?? {
    startTime: (now - 15 * 60 * 1000) * 1000,
    endTime: now * 1000,
  },
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

// True once any section has something to show. Gates the skeleton and the empty
// state so the three are mutually exclusive with the content: the skeleton is a
// first-load placeholder, not a refresh indicator (ORefreshButton already spins
// via :loading). Without this, refreshing with data on screen appends the
// skeleton *below* the rows instead of standing in for them.
const hasAnyData = computed(
  () =>
    anomalies.value.length > 0 ||
    incidents.value.length > 0 ||
    services.value.length > 0 ||
    recentEvents.value.length > 0,
);

/* Per-section load state. The four datasets are fetched concurrently and land at
   different times, so a single `isLoading` can't gate their placeholders: the
   first dataset to arrive would clear the skeleton for the three still in
   flight, and those would then pop in with no placeholder. Each section tracks
   its own request instead.

   `loaded` (has completed at least once) is what separates a first load from a
   refresh. A section shows its skeleton only while `loading && !loaded`, so:
     - first load  -> each section holds its own placeholder until ITS data lands
     - refresh     -> nothing flashes; ORefreshButton carries the loading state
     - empty result-> `loaded` stays true, so it never re-skeletons */
type SectionKey = "incidents" | "services" | "anomalies" | "recentEvents";
const sectionState = reactive<Record<SectionKey, { loading: boolean; loaded: boolean }>>({
  incidents: { loading: false, loaded: false },
  services: { loading: false, loaded: false },
  anomalies: { loading: false, loaded: false },
  recentEvents: { loading: false, loaded: false },
});

const isSectionPending = (key: SectionKey) =>
  sectionState[key].loading && !sectionState[key].loaded;

/* Wraps a loader with its section's state. The loaders swallow their own errors,
   and `finally` also covers the early `return` in the enterprise-gated ones, so
   a section can never be left stuck pending. */
const runSection = async (key: SectionKey, load: () => Promise<void>) => {
  sectionState[key].loading = true;
  try {
    await load();
  } finally {
    sectionState[key].loading = false;
    sectionState[key].loaded = true;
  }
};

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
const graphStream = ref(localStorage.getItem("serviceGraph_streamFilter") || "");
const selectedService = ref<any>(null);
const servicePanelVisible = ref(false);

// ── Data loading ─────────────────────────────────────────────────────────────
const orgId = computed(() => store.state.selectedOrganization?.identifier);

const loadAll = async () => {
  if (!orgId.value) return;
  isLoading.value = true;
  await Promise.allSettled([
    runSection("recentEvents", loadHistoryAndSplit),
    runSection("anomalies", loadAnomalies),
    runSection("incidents", loadIncidents),
    runSection("services", loadServiceGraph),
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
        configs.map((c) => anomalyService.getHistory(org, c.id ?? c.anomaly_id, limitPerConfig)),
      );
      rawHits = configs.map((cfg, idx) => ({
        cfg,
        hits:
          results[idx].status === "fulfilled"
            ? ((results[idx] as PromiseFulfilledResult<any>).value.data ?? [])
            : [],
      }));
    }

    const found: any[] = [];
    rawHits.forEach(({ cfg, hits }: { cfg: any; hits: any[] }) => {
      hits.forEach((h: any) => {
        const tsMs = h.timestamp ? Math.floor(h.timestamp / 1000) : 0;
        if (tsMs && (tsMs < startTime / 1000 || tsMs > endTime / 1000)) return;
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
  return map[status.toLowerCase()] ?? status.charAt(0).toUpperCase() + status.slice(1);
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
    ? "border-l-[0.1875em] border-l-error-600"
    : "border-l-[0.1875em] border-l-warning-600";

const severityIconClass = (severity: string) =>
  severity === "critical" ? "text-error-600" : "text-warning-600";

const incidentRowClass = (severity: string) => {
  const s = (severity ?? "").toLowerCase();
  if (s === "p1") return "border-l-error-600";
  if (s === "p2") return "border-l-warning-600";
  return "border-l-status-info-text";
};

const incidentIconClass = (severity: string) => {
  const s = (severity ?? "").toLowerCase();
  if (s === "p1") return "text-error-600";
  if (s === "p2") return "text-warning-600";
  return "text-status-info-text";
};

const severityBadgeClass = (sev: string): string => {
  const s = (sev || "p4").toLowerCase();
  if (s === "p1") return "bg-error-50 text-error-600 border border-[0.0625em] border-error-600";
  if (s === "p2")
    return "bg-warning-50 text-warning-700 border border-[0.0625em] border-warning-600";
  if (s === "p3")
    return "bg-warning-50 text-warning-700 border border-[0.0625em] border-warning-600";
  return "bg-status-info-bg text-status-info-text border border-[0.0625em] border-status-info-text";
};

const serviceCardClass = (svc: any) => {
  if (svc.errorFlag && svc.error_rate >= 5) return "border-l-[0.1875em] border-l-error-600";
  if (svc.errorFlag || svc.latencyFlag) return "border-l-[0.1875em] border-l-warning-600";
  return "border-l-[0.1875em] border-l-status-positive";
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
    org_identifier: orgId.value ?? "",
    tab: "spans",
    query: b64EncodeUnicode(filter) ?? "",
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

const openServicePanel = (svc: any) => {
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
  router.push({
    name: "alertList",
    query: { org_identifier: orgId.value, tab: "anomalyDetection" },
  });
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
