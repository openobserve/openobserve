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
  <div class="overview-tab">
    <!-- Header: refresh + time picker -->
    <div class="overview-header">
      <div class="overview-header-right">
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
      class="ov-section"
    >
      <div class="ov-section-header">
        <div class="ov-section-label">
          {{ t('overview.activeIncidents') }}
          <span class="ov-count-badge">{{ incidentsTotal }}</span>
          <span v-if="incidentsTotal > incidents.length" class="ov-showing-hint">{{ t('overview.showingOf', { shown: incidents.length, total: incidentsTotal }) }}</span>
        </div>
        <button class="ov-view-all" @click="goToIncidentList">{{ t('overview.viewAll') }} →</button>
      </div>
      <div class="ov-table">
        <div
          v-for="inc in incidents"
          :key="inc.id"
          class="ov-alert-row ov-table-row"
          :class="incidentRowClass(inc.severity)"
        >
          <span class="ov-row-icon ov-icon-incident">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
              <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </span>
          <div class="ov-row-body">
            <div class="ov-row-title">
              <span class="ov-severity-badge" :class="`ov-sev-${(inc.severity || 'p4').toLowerCase()}`">
                {{ (inc.severity || 'P4').toUpperCase() }}
              </span>
              {{ inc.title || t('overview.untitledIncident') }}
              <template v-if="inc.group_values && Object.keys(inc.group_values).length > 0">
                <span
                  v-for="[key, val] in sortedDimensions(inc.group_values)"
                  :key="key"
                  class="dimension-badge"
                  :class="dimColorClass(key)"
                  :title="`${key}=${val}`"
                ><span>{{ shortDimKey(key) }}: {{ val }}</span></span>
              </template>
            </div>
          </div>
          <div class="ov-inc-meta">
            <span class="ov-inc-time">{{ relativeTime_(inc.first_alert_at) }}</span>
            <span class="ov-inc-sep">·</span>
            <span class="ov-inc-alerts">{{ inc.alert_count }} alerts</span>
          </div>
          <span class="ov-investigate-wrap ov-investigate-hover">
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
    <section v-if="isEnterpriseOrCloud && services.length > 0" class="ov-section">
      <div class="ov-section-header">
        <div class="ov-section-label">
          {{ t('overview.services') }}
          <span class="ov-count-badge">{{ services.length }}</span>
          <span v-if="servicePanelVisible && selectedService" class="ov-panel-context">
            — viewing <strong>{{ selectedService.label ?? selectedService.id }}</strong>
          </span>
        </div>
        <button class="ov-view-all" @click="goToServiceGraph">{{ t('overview.viewAll') }} →</button>
      </div>
      <div class="ov-service-scroll-wrap">
        <button
          class="ov-svc-arrow ov-svc-arrow-left"
          :disabled="!svcScrollCanLeft"
          @click="scrollServices(-1)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div ref="svcGridRef" class="ov-service-grid" @scroll="onSvcScroll">
        <div
          v-for="svc in services"
          :key="svc.id"
          class="ov-service-card"
          :class="[serviceCardClass(svc), { 'ov-svc-active': selectedService?.id === svc.id && servicePanelVisible }]"
          @click="goToService(svc)"
        >
          <div class="ov-svc-header">
            <span class="ov-svc-name" :title="svc.label ?? svc.id">{{ svc.label }}</span>
            <span class="ov-svc-info-wrap">
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
          <div class="ov-svc-metrics">
            <div class="ov-svc-metric-row">
              <span class="ov-metric-label">{{ t('overview.colErrorRate') }}</span>
              <span class="ov-metric-value" :class="svc.errorFlag ? 'ov-metric-error' : ''">
                {{ svc.error_rate != null ? svc.error_rate.toFixed(1) + '%' : '—' }}
              </span>
            </div>
            <div class="ov-svc-metric-row">
              <span class="ov-metric-label">{{ t('overview.colLatency') }}</span>
              <span class="ov-metric-value" :class="svc.latencyFlag ? 'ov-metric-warn' : ''">
                {{ svc.latencyMultiplier ? svc.latencyMultiplier + 'x' : '—' }}
              </span>
            </div>
            <div class="ov-svc-metric-row">
              <span class="ov-metric-label">{{ t('overview.colReqs') }}</span>
              <span class="ov-metric-value">{{ formatReqRate(svc.requests) }}</span>
            </div>
          </div>
        </div>
        </div>
        <button
          class="ov-svc-arrow ov-svc-arrow-right"
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
        class="ov-panel-backdrop"
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
    <section v-if="anomalies.length > 0" class="ov-section">
      <div class="ov-section-header">
        <div class="ov-section-label">
          {{ t('overview.activeAnomalies') }}
          <span class="ov-count-badge">{{ anomalies.length }}</span>
        </div>
        <button class="ov-view-all" @click="goToAnomalies">{{ t('overview.viewAll') }} →</button>
      </div>
      <div class="ov-rows">
        <div
          v-for="item in anomalies"
          :key="item.id"
          class="ov-alert-row"
          :class="severityRowClass(item.severity)"
        >
          <span class="ov-row-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <div class="ov-row-body">
            <div class="ov-row-title">
              {{ item.title }}
              <span class="ov-row-meta-sep">·</span>
              <span class="ov-row-meta">{{ item.description }}</span>
            </div>
          </div>
          <span class="ov-investigate-wrap ov-investigate-hover">
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
    <section v-if="recentEvents.length > 0" class="ov-section">
      <div class="ov-section-header">
        <div class="ov-section-label">
          {{ t('overview.recentEvents') }}
          <span class="ov-count-badge">{{ recentEvents.length }}</span>
        </div>
        <button class="ov-view-all" @click="goToAlertList">{{ t('overview.viewAll') }} →</button>
      </div>
      <div class="ov-event-list">
        <div
          v-for="ev in recentEvents"
          :key="ev.id"
          class="ov-event-row"
        >
          <span class="ov-event-type-badge" :class="ev.typeLabel === 'Failed' ? 'ov-badge-failed' : ev.typeLabel === 'Error' ? 'ov-badge-error' : 'ov-badge-firing'">
            {{ ev.typeLabel }}
          </span>
          <span class="ov-event-service">{{ ev.service }}</span>
          <span class="ov-event-desc">{{ ev.description }}</span>
          <span v-if="ev.failCount > 1" class="ov-fail-count" :title="`Failed ${ev.failCount} times in this window`">
            ×{{ ev.failCount }}
          </span>
          <span class="ov-event-time">{{ ev.timeAgo }}</span>
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
        <button type="button" class="ov-action-card" data-test="overview-empty-alerts-card" @click="goToAlertList">
          <span class="ov-action-card__icon ov-action-card__icon--orange">
            <OIcon name="notifications" size="md" />
          </span>
          <span class="ov-action-card__body">
            <span class="ov-action-card__label">{{ t('overview.emptyActionAlerts') }}</span>
            <span class="ov-action-card__sublabel">{{ t('overview.emptyActionAlertsDesc') }}</span>
          </span>
          <OIcon name="chevron-right" size="sm" class="ov-action-card__chevron" />
        </button>
        <!-- Explore logs -->
        <button type="button" class="ov-action-card" data-test="overview-empty-logs-card" @click="goToLogs">
          <span class="ov-action-card__icon ov-action-card__icon--blue">
            <OIcon name="search" size="md" />
          </span>
          <span class="ov-action-card__body">
            <span class="ov-action-card__label">{{ t('overview.emptyActionLogs') }}</span>
            <span class="ov-action-card__sublabel">{{ t('overview.emptyActionLogsDesc') }}</span>
          </span>
          <OIcon name="chevron-right" size="sm" class="ov-action-card__chevron" />
        </button>
        <!-- Explore traces -->
        <button type="button" class="ov-action-card" data-test="overview-empty-traces-card" @click="goToTraces">
          <span class="ov-action-card__icon ov-action-card__icon--purple">
            <OIcon name="account-tree" size="md" />
          </span>
          <span class="ov-action-card__body">
            <span class="ov-action-card__label">{{ t('overview.emptyActionTraces') }}</span>
            <span class="ov-action-card__sublabel">{{ t('overview.emptyActionTracesDesc') }}</span>
          </span>
          <OIcon name="chevron-right" size="sm" class="ov-action-card__chevron" />
        </button>
      </template>
    </OEmptyState>

    <!-- Loading skeleton (standard O2 wave shimmer) -->
    <div v-if="isLoading" class="ov-skeleton-wrap">
      <OSkeleton v-for="i in 3" :key="i" class="ov-skeleton-row" />
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

const DIM_COLOR_MAP: Record<string, string> = {
  deployment: "badge-blue",
  "k8s-deployment": "badge-blue",
  namespace: "badge-orange",
  "k8s-namespace": "badge-orange",
  env: "badge-green",
  environment: "badge-green",
  host: "badge-purple",
  hostname: "badge-purple",
  service: "badge-cyan",
  service_name: "badge-cyan",
  region: "badge-pink",
  zone: "badge-pink",
  cluster: "badge-indigo",
  "k8s-cluster": "badge-indigo",
  pod: "badge-teal",
  container: "badge-red",
  app: "badge-yellow",
  application: "badge-yellow",
};

const dimColorClass = (key: string): string => {
  if (DIM_COLOR_MAP[key]) return DIM_COLOR_MAP[key];
  const lower = key.toLowerCase();
  for (const [pattern, cls] of Object.entries(DIM_COLOR_MAP)) {
    if (lower.includes(pattern)) return cls;
  }
  return "badge-gray";
};

const severityRowClass = (severity: string) =>
  severity === "critical" ? "ov-row-critical" : "ov-row-warning";

const incidentRowClass = (severity: string) => {
  const s = (severity ?? "").toLowerCase();
  if (s === "p1") return "ov-row-critical";
  if (s === "p2") return "ov-row-warning";
  return "ov-row-info";
};

const serviceCardClass = (svc: any) => {
  if (svc.errorFlag && svc.error_rate >= 5) return "ov-svc-degraded";
  if (svc.errorFlag || svc.latencyFlag) return "ov-svc-warn";
  return "ov-svc-healthy";
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

<style scoped lang="scss">
.ov-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99; // just below the panel (z-index: 100)
  background: transparent;
}

.overview-tab {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0.625rem 0.875rem 0.625rem 0.625rem;
  height: 100%;
  overflow-y: auto;
  color: var(--o2-text-primary);
}

/* ── Header ── */
.overview-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1rem;
}

.overview-header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* ── Section ── */
.ov-section {
  margin-bottom: 1.25rem;
}

.ov-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  padding-left: 0.25rem;
}

.ov-section-label {
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--o2-text-primary);
}

.ov-panel-context {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--o2-text-muted);
  margin-left: 0.25rem;

  strong {
    font-weight: 600;
    color: var(--o2-text-primary);
  }
}

.ov-view-all {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--o2-primary-color);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s;
  opacity: 0.8;
  &:hover { opacity: 1; text-decoration: underline; }
}

/* ── Count badge ── */
.ov-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.3rem;
  border-radius: 0.625rem;
  font-size: 0.6875rem;
  font-weight: 600;
  background: var(--o2-status-warning-bg);
  color: var(--o2-status-warning-text);
  border: 0.0625em solid var(--o2-warning);
  margin-left: 0.375rem;
  vertical-align: middle;
}

/* ── Showing X of Y hint ── */
.ov-showing-hint {
  margin-left: 0.5rem;
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--o2-text-muted);
  vertical-align: middle;
}

/* ── Incidents table layout ── */
.ov-table {
  display: flex;
  flex-direction: column;
  border: 0.0625em solid var(--o2-border-color);
  border-radius: 0.375rem;
  overflow: hidden;
}

.ov-table-head {
  display: flex;
  align-items: center;
  padding: 0.375rem 0.875rem;
  background: var(--o2-hover-gray);
  border-bottom: 0.0625em solid var(--o2-border-color);
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--o2-text-muted);
}


.ov-table-row {
  border-radius: 0 !important;
  border-left-width: 0.1875em !important;
  border-top: none !important;
  border-right: none !important;
  border-bottom: 0.0625em solid var(--o2-border-color) !important;
  &:last-child { border-bottom: none !important; }
}

.ov-inc-meta {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 0.3rem;
  white-space: nowrap;
  width: 12rem;
}

.ov-inc-time {
  font-size: 0.75rem;
  color: var(--o2-text-muted);
  min-width: 4.5rem;
}

.ov-inc-sep {
  font-size: 0.75rem;
  color: var(--o2-text-muted);
}

.ov-inc-alerts {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--o2-text-primary);
}

/* ── Hover-only Investigate button ── */
.ov-investigate-hover {
  visibility: hidden;
}

.ov-alert-row:hover .ov-investigate-hover {
  visibility: visible;
}

/* ── Service card metric rows ── */
.ov-svc-metrics {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.5rem;
}

.ov-svc-metric-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.ov-metric-value.ov-metric-error {
  color: var(--o2-status-error-text) !important;
}

.ov-metric-value.ov-metric-warn {
  color: var(--o2-status-warning-text) !important;
}

/* ── Alert / Anomaly / Incident rows ── */
.ov-rows {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.ov-alert-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.875rem;
  border-radius: 0.375rem;
  border: 0.0625em solid var(--o2-border-color);
  background: var(--o2-card-bg-solid);
  transition: background 0.15s;

  &:hover {
    background: var(--o2-hover-gray);
  }

  &.ov-row-critical {
    border-left: 0.1875em solid var(--o2-negative);
    .ov-row-icon { color: var(--o2-negative); }
  }

  &.ov-row-warning {
    border-left: 0.1875em solid var(--o2-warning);
    .ov-row-icon { color: var(--o2-warning); }
  }

  &.ov-row-info {
    border-left: 0.1875em solid var(--o2-status-info-text);
    .ov-row-icon { color: var(--o2-status-info-text); }
  }
}

.ov-row-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.ov-row-body {
  flex: 1;
  min-width: 0;
}

.ov-row-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--o2-text-primary);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
  row-gap: 0.25rem;
}

.ov-row-desc {
  font-size: 0.75rem;
  color: var(--o2-text-muted);
  margin-top: 0.125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ov-row-meta-sep {
  font-size: 0.75rem;
  color: var(--o2-text-muted);
  font-weight: 400;
  margin: 0 0.1rem;
}

.ov-row-meta {
  font-size: 0.75rem;
  color: var(--o2-text-muted);
  font-weight: 400;
}

.ov-investigate-wrap {
  flex-shrink: 0;
  white-space: nowrap;
}

/* ── Dimension badges — exact match to IncidentList.vue ── */
.dimension-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.125em;
  padding: 0.125em 0.5em;
  border-radius: 0.75em;
  font-size: 0.6875em;
  font-weight: 600;
  margin: 0 0.125em;
  max-width: 11.25em;
  overflow: hidden;

  span {
    display: inline-block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.badge-blue   { border: 0.0625em solid var(--o2-status-info-text); }
.badge-green  { border: 0.0625em solid var(--o2-positive); }
.badge-yellow { border: 0.0625em solid var(--o2-warning); }
.badge-pink   { border: 0.0625em solid var(--o2-negative); }
.badge-purple { border: 0.0625em solid var(--o2-primary-color); }
.badge-orange { border: 0.0625em solid var(--o2-status-warning-text); }
.badge-cyan   { border: 0.0625em solid var(--o2-positive); }
.badge-indigo { border: 0.0625em solid var(--o2-theme-color); }
.badge-teal   { border: 0.0625em solid var(--o2-positive); }
.badge-red    { border: 0.0625em solid var(--o2-negative); }
.badge-gray   { border: 0.0625em solid var(--o2-border-color); }
.badge-amber  { border: 0.0625em solid var(--o2-warning); }

/* ── Severity badge ── */
.ov-severity-badge {
  display: inline-block;
  font-size: 0.625rem;
  font-weight: 700;
  padding: 0.1rem 0.35rem;
  border-radius: 0.2rem;
  letter-spacing: 0.04em;

  &.ov-sev-p1 {
    background: var(--o2-status-error-bg);
    color: var(--o2-status-error-text);
    border: 0.0625em solid var(--o2-negative);
  }
  &.ov-sev-p2 {
    background: var(--o2-status-warning-bg);
    color: var(--o2-status-warning-text);
    border: 0.0625em solid var(--o2-warning);
  }
  &.ov-sev-p3 {
    background: var(--o2-status-warning-bg);
    color: var(--o2-status-warning-text);
    border: 0.0625em solid var(--o2-warning);
  }
  &.ov-sev-p4 {
    background: var(--o2-status-info-bg);
    color: var(--o2-status-info-text);
    border: 0.0625em solid var(--o2-status-info-text);
  }
}

/* ── Services scroll wrapper ── */
.ov-service-scroll-wrap {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}

.ov-svc-arrow {
  flex-shrink: 0;
  width: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 0.0625em solid var(--o2-border-color);
  border-radius: 0.5rem;
  background: var(--o2-card-bg-solid);
  color: var(--o2-text-secondary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  transition: background 0.15s, color 0.15s, box-shadow 0.15s, transform 0.1s;

  svg { transition: transform 0.15s; }

  &:hover:not(:disabled) {
    background: var(--o2-hover-gray);
    color: var(--o2-text-primary);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
    transform: translateY(-1px);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  &:disabled {
    opacity: 0.25;
    cursor: not-allowed;
    box-shadow: none;
  }
}

/* ── Services grid ── */
.ov-service-grid {
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
  overflow-x: auto;
  flex: 1;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}

.ov-service-card {
  padding: 0.75rem 0.875rem;
  border-radius: 0.375rem;
  border: 0.0625em solid var(--o2-border-color);
  background: var(--o2-card-bg-solid);
  transition: background 0.15s;
  flex: 0 0 10rem;
  min-width: 10rem;
  max-width: 10rem;

  &.ov-svc-degraded {
    border-left: 0.1875em solid var(--o2-negative);
  }
  &.ov-svc-warn {
    border-left: 0.1875em solid var(--o2-warning);
  }
  &.ov-svc-healthy {
    border-left: 0.1875em solid var(--o2-positive);
  }

  cursor: pointer;
  &:hover {
    background: var(--o2-hover-gray);
  }

  &.ov-svc-active {
    background: var(--o2-hover-gray);
    outline: 0.125em solid var(--o2-primary-color);
    outline-offset: -0.0625em;
  }
}

.ov-svc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.ov-svc-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--o2-text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  cursor: default;
}

.ov-svc-info-wrap {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: 0.25rem;
}

.ov-svc-flags {
  display: flex;
  gap: 0.375rem;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 0.375rem;
}

.ov-svc-flag {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.4rem;
  border-radius: 0.2rem;
  white-space: nowrap;
}

.ov-flag-error {
  background: var(--o2-status-error-bg);
  color: var(--o2-status-error-text);
  border: 0.0625em solid var(--o2-negative);
}

.ov-flag-latency {
  background: var(--o2-status-warning-bg);
  color: var(--o2-status-warning-text);
  border: 0.0625em solid var(--o2-warning);
}

.ov-svc-req {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  margin-top: 0.375rem;
}

.ov-metric-label {
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--o2-text-muted);
}

.ov-metric-value {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--o2-text-primary);
}

/* ── Recent events list ── */
.ov-event-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 0.0625em solid var(--o2-border-color);
  border-radius: 0.375rem;
  overflow: hidden;
  background: var(--o2-card-bg-solid);
}

.ov-event-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.875rem;
  border-bottom: 0.0625em solid var(--o2-border-color);
  font-size: 0.8125rem;
  transition: background 0.15s;

  &:last-child {
    border-bottom: none;
  }
  &:hover {
    background: var(--o2-hover-gray);
  }
}

.ov-event-type-badge {
  flex-shrink: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0.15rem 0.4rem;
  border-radius: 0.2rem;
  letter-spacing: 0.03em;

  &.ov-badge-firing {
    background: var(--o2-status-error-bg);
    color: var(--o2-status-error-text);
  }
  &.ov-badge-error {
    background: var(--o2-status-warning-bg);
    color: var(--o2-status-warning-text);
  }
  &.ov-badge-failed {
    background: var(--o2-status-error-bg);
    color: var(--o2-status-error-text);
    font-weight: 700;
  }
}

.ov-event-service {
  font-weight: 500;
  color: var(--o2-text-primary);
  white-space: nowrap;
  min-width: 7.5em;
  max-width: 12.5em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ov-event-desc {
  flex: 1;
  color: var(--o2-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ov-fail-count {
  flex-shrink: 0;
  font-size: 0.6875rem;
  font-weight: 700;
  color: var(--o2-status-error-text);
  background: var(--o2-status-error-bg);
  border: 0.0625em solid var(--o2-negative);
  border-radius: 0.75rem;
  padding: 0.1rem 0.4rem;
  white-space: nowrap;
}

.ov-event-time {
  flex-shrink: 0;
  color: var(--o2-text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}

/* ── Empty state action cards ── */
.ov-action-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 16rem;
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
.ov-action-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-primary-400);
  background: var(--color-tabs-hover-bg);
}
.ov-action-card:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}

.ov-action-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  transition: background-color 150ms, color 150ms;
}
.ov-action-card__icon--blue   { background: var(--o2-status-info-bg);    color: var(--o2-status-info-text); }
.ov-action-card__icon--purple { background: var(--o2-status-info-bg);    color: var(--o2-status-info-text); }
.ov-action-card__icon--orange { background: var(--o2-status-warning-bg); color: var(--o2-status-warning-text); }
.ov-action-card:hover .ov-action-card__icon,
.ov-action-card:hover .ov-action-card__icon--blue,
.ov-action-card:hover .ov-action-card__icon--purple,
.ov-action-card:hover .ov-action-card__icon--orange {
  background: var(--o2-primary-color);
  color: var(--o2-primary-foreground);
}

.ov-action-card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.ov-action-card__label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ov-action-card__sublabel {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}
.ov-action-card__chevron {
  flex-shrink: 0;
  color: var(--color-text-disabled);
  transition: transform 150ms, color 150ms;
}
.ov-action-card:hover .ov-action-card__chevron {
  transform: translateX(0.125rem);
  color: var(--color-primary-600);
}

/* ── Loading skeleton ── */
.ov-skeleton-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

/* Height only — OSkeleton provides the surface, rounding and wave shimmer. */
.ov-skeleton-row {
  height: 3.25em;
}

/* ── Scrollbar ── */
.overview-tab::-webkit-scrollbar {
  width: 0.375em;
}
.overview-tab::-webkit-scrollbar-track {
  background: transparent;
}
.overview-tab::-webkit-scrollbar-thumb {
  background: var(--o2-border-color);
  border-radius: 0.1875em;
}
</style>
