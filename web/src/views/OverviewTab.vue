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
    <!-- Header: title + last-fetched + refresh + time picker -->
    <div class="overview-header">
      <span class="overview-title">{{ t('overview.title') }}</span>
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
          :default-type="dateTimeType"
          :default-absolute-time="{ startTime: absoluteTime.startTime, endTime: absoluteTime.endTime }"
          :default-relative-time="relativeTime"
          @on:date-change="onDateChange"
        />
      </div>
    </div>

    <!-- Sections rendered top-to-bottom; each collapses when empty -->

    <!-- ACTIVE ANOMALIES -->
    <section v-if="anomalies.length > 0" class="ov-section">
      <div class="ov-section-label">{{ t('overview.activeAnomalies') }}</div>
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
            <div class="ov-row-title">{{ item.title }}</div>
            <div class="ov-row-desc">{{ item.description }}</div>
          </div>
          <span class="ov-investigate-wrap">
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
      class="ov-section"
    >
      <div class="ov-section-label">{{ t('overview.activeIncidents') }}</div>
      <div class="ov-rows">
        <div
          v-for="inc in incidents"
          :key="inc.id"
          class="ov-alert-row"
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
            <div class="ov-row-desc">
              {{ inc.alert_count }} alert{{ inc.alert_count !== 1 ? 's' : '' }} ·
              opened {{ relativeTime_(inc.first_alert_at) }}
              <span v-if="inc.assigned_to"> · {{ inc.assigned_to }}</span>
            </div>
          </div>
          <span class="ov-investigate-wrap">
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
      <div class="ov-section-label">{{ t('overview.services') }}</div>
      <div class="ov-service-grid">
        <div
          v-for="svc in services"
          :key="svc.id"
          class="ov-service-card"
          :class="serviceCardClass(svc)"
          @click="goToService(svc)"
        >
          <div class="ov-svc-header">
            <span class="ov-svc-name">{{ svc.label }}</span>
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
          <div class="ov-svc-flags">
            <span v-if="svc.errorFlag" class="ov-svc-flag ov-flag-error" :title="t('overview.elevatedErrorRate')">
              Error Rate {{ svc.error_rate.toFixed(1) }}%
            </span>
            <span v-if="svc.latencyFlag" class="ov-svc-flag ov-flag-latency" :title="`Latency elevated vs baseline (${svc.latencyMultiplier}x)`">
              Latency {{ svc.latencyMultiplier }}x
            </span>
          </div>
          <div class="ov-svc-req">
            <span class="ov-metric-label">{{ t('overview.reqPerSec') }}</span>
            <span class="ov-metric-value">{{ formatReqRate(svc.requests) }}</span>
          </div>
        </div>
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

    <!-- RECENT EVENTS (alert firing feed) -->
    <section v-if="recentEvents.length > 0" class="ov-section">
      <div class="ov-section-label">{{ t('overview.recentEvents') }}</div>
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
    <div
      v-if="!isLoading && anomalies.length === 0 && incidents.length === 0 && services.length === 0 && recentEvents.length === 0"
      class="ov-empty"
    >
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" class="ov-empty-icon">
        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="ov-empty-title">{{ t('overview.allClear') }}</div>
      <div class="ov-empty-desc">{{ t('overview.allClearDesc') }}</div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="isLoading" class="ov-skeleton-wrap">
      <div v-for="i in 3" :key="i" class="ov-skeleton-row"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
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
import ServiceGraphNodeSidePanel from "@/plugins/traces/ServiceGraphNodeSidePanel.vue";

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
    // Get all anomaly configs for this org
    const listRes = await anomalyService.list(orgId.value);
    const configs: any[] = listRes.data ?? [];
    if (!configs.length) {
      anomalies.value = [];
      return;
    }

    // Fetch history for each config in parallel, cap per-config at 20 hits
    const limitPerConfig = Math.min(20, Math.ceil(500 / configs.length));
    const results = await Promise.allSettled(
      configs.map((c) =>
        anomalyService.getHistory(
          orgId.value,
          c.id ?? c.anomaly_id,
          limitPerConfig,
        ),
      ),
    );

    const found: any[] = [];
    results.forEach((r, idx) => {
      if (r.status !== "fulfilled") return;
      const hits: any[] = r.value.data ?? [];
      const cfg = configs[idx];
      hits.forEach((h) => {
        // Only include hits within the selected time window (history API doesn't filter by time)
        const tsMs = h.timestamp ? Math.floor(h.timestamp / 1000) : 0;
        if (
          tsMs &&
          (tsMs < timeRange.value.startTime / 1000 ||
            tsMs > timeRange.value.endTime / 1000)
        )
          return;
        if ((h.anomaly_count ?? 0) > 0) {
          found.push({
            id: h.id ?? `anm-${cfg.id}-${tsMs}`,
            title: `Anomaly detected — ${cfg.name ?? cfg.alert_name ?? "unknown"}`,
            description: `Stream: ${cfg.stream_name ?? "unknown"} · ${h.anomaly_count} anomalous point(s)`,
            severity: "warning",
            alertName: cfg.name ?? cfg.alert_name,
            streamName: cfg.stream_name,
            ts: tsMs,
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
    anomalies.value = Array.from(deduped.values())
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 5);
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
  router.push({
    name: "alertHistory",
    query: { org_identifier: orgId.value },
  });
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

// ── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(loadAll);

watch(
  () => store.state.selectedOrganization?.identifier,
  (val, old) => {
    if (val && val !== old) loadAll();
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
  padding: 0.625rem;
  height: 100%;
  overflow-y: auto;
  color: var(--o2-text-primary);
}

/* ── Header ── */
.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.overview-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--o2-text-primary);
  letter-spacing: 0.01em;
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

.ov-section-label {
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--o2-text-muted);
  margin-bottom: 0.5rem;
  padding-left: 0.25rem;
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
    border-left: 0.1875em solid #ef4444;
    .ov-row-icon {
      color: #ef4444;
    }
  }

  &.ov-row-warning {
    border-left: 0.1875em solid #f59e0b;
    .ov-row-icon {
      color: #f59e0b;
    }
  }

  &.ov-row-info {
    border-left: 0.1875em solid #3b82f6;
    .ov-row-icon {
      color: #3b82f6;
    }
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
  border-radius: 0.375em;
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

.badge-blue {
  border: 0.0625em solid #1d4ed8;
}
.badge-green {
  border: 0.0625em solid #065f46;
}
.badge-yellow {
  border: 0.0625em solid #92400e;
}
.badge-pink {
  border: 0.0625em solid #9f1239;
}
.badge-purple {
  border: 0.0625em solid #7c3aed;
}
.badge-orange {
  border: 0.0625em solid #c2410c;
}
.badge-cyan {
  border: 0.0625em solid #0e7490;
}
.badge-indigo {
  border: 0.0625em solid #4f46e5;
}
.badge-teal {
  border: 0.0625em solid #0f766e;
}
.badge-red {
  border: 0.0625em solid #dc2626;
}
.badge-gray {
  border: 0.0625em solid #4b5563;
}
.badge-amber {
  border: 0.0625em solid #d97706;
}

body.body--dark {
  .badge-blue {
    border-color: #93c5fd;
  }
  .badge-green {
    border-color: #6ee7b7;
  }
  .badge-yellow {
    border-color: #fcd34d;
  }
  .badge-pink {
    border-color: #f9a8d4;
  }
  .badge-purple {
    border-color: #c4b5fd;
  }
  .badge-orange {
    border-color: #fdba74;
  }
  .badge-cyan {
    border-color: #67e8f9;
  }
  .badge-indigo {
    border-color: #a5b4fc;
  }
  .badge-teal {
    border-color: #5eead4;
  }
  .badge-red {
    border-color: #fca5a5;
  }
  .badge-gray {
    border-color: #9ca3af;
  }
  .badge-amber {
    border-color: #fcd34d;
  }

  .ov-flag-error {
    background: #401a1a;
    color: #f9cbcb;
    border-color: rgba(239, 68, 68, 0.35);
  }
  .ov-flag-latency {
    background: #402a10;
    color: #fcd34d;
    border-color: rgba(245, 158, 11, 0.35);
  }

  .ov-badge-firing {
    background: #401a1a;
    color: #fca5a5;
  }
  .ov-badge-error {
    background: #401f10;
    color: #fdba74;
  }
  .ov-badge-failed {
    background: #401a1a;
    color: #f9cbcb;
  }

  .ov-fail-count {
    color: #f9cbcb;
    background: #401a1a;
    border-color: rgba(239, 68, 68, 0.35);
  }
}

/* ── Severity badge ── */
.ov-severity-badge {
  display: inline-block;
  font-size: 0.625rem;
  font-weight: 700;
  padding: 0.1rem 0.35rem;
  border-radius: 0.2rem;
  letter-spacing: 0.04em;

  &.ov-sev-p1 {
    background: #fef2f2;
    color: #b91c1c;
    border: 0.0625em solid #fca5a5;
  }
  &.ov-sev-p2 {
    background: #fff7ed;
    color: #c2410c;
    border: 0.0625em solid #fdba74;
  }
  &.ov-sev-p3 {
    background: #fefce8;
    color: #a16207;
    border: 0.0625em solid #fde047;
  }
  &.ov-sev-p4 {
    background: #f0f9ff;
    color: #0369a1;
    border: 0.0625em solid #7dd3fc;
  }
}

/* Dark mode severity badges */
:root.body--dark {
  .ov-sev-p1 {
    background: rgba(239, 68, 68, 0.15);
    color: #fca5a5;
    border-color: rgba(239, 68, 68, 0.3);
  }
  .ov-sev-p2 {
    background: rgba(249, 115, 22, 0.15);
    color: #fdba74;
    border-color: rgba(249, 115, 22, 0.3);
  }
  .ov-sev-p3 {
    background: rgba(234, 179, 8, 0.15);
    color: #fde047;
    border-color: rgba(234, 179, 8, 0.3);
  }
  .ov-sev-p4 {
    background: rgba(59, 130, 246, 0.15);
    color: #7dd3fc;
    border-color: rgba(59, 130, 246, 0.3);
  }
}

/* ── Services grid ── */
.ov-service-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13.75em, 1fr));
  gap: 0.5rem;
}

.ov-service-card {
  padding: 0.75rem 0.875rem;
  border-radius: 0.375rem;
  border: 0.0625em solid var(--o2-border-color);
  background: var(--o2-card-bg-solid);
  transition: background 0.15s;

  &.ov-svc-degraded {
    border-left: 0.1875em solid #ef4444;
  }
  &.ov-svc-warn {
    border-left: 0.1875em solid #f59e0b;
  }
  &.ov-svc-healthy {
    border-left: 0.1875em solid #22c55e;
  }

  cursor: pointer;
  &:hover {
    background: var(--o2-hover-gray);
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
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  border: 0.0625em solid rgba(239, 68, 68, 0.25);
}

.ov-flag-latency {
  background: rgba(245, 158, 11, 0.12);
  color: #d97706;
  border: 0.0625em solid rgba(245, 158, 11, 0.25);
}

.ov-svc-req {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  margin-top: 0.375rem;
}

.ov-metric-label {
  font-size: 0.6875rem;
  color: var(--o2-text-muted);
}

.ov-metric-value {
  font-size: 0.875rem;
  font-weight: 600;
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
    background: rgba(239, 68, 68, 0.12);
    color: #ef4444;
  }
  &.ov-badge-error {
    background: rgba(249, 115, 22, 0.12);
    color: #c2410c;
  }
  &.ov-badge-failed {
    background: rgba(239, 68, 68, 0.18);
    color: #b91c1c;
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
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.1);
  border: 0.0625em solid rgba(239, 68, 68, 0.25);
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

/* ── Empty state ── */
.ov-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  color: var(--o2-text-muted);
}

.ov-empty-icon {
  opacity: 0.4;
}

.ov-empty-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--o2-text-primary);
}

.ov-empty-desc {
  font-size: 0.8125rem;
  text-align: center;
  max-width: 23.75em;
}

/* ── Loading skeleton ── */
.ov-skeleton-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

.ov-skeleton-row {
  height: 3.25em;
  border-radius: 0.375rem;
  background: linear-gradient(
    90deg,
    var(--o2-card-bg-solid) 0%,
    var(--o2-bg-gray) 50%,
    var(--o2-card-bg-solid) 100%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease infinite;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
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
