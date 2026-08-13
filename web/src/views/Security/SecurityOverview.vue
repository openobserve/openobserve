<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import streamService from "@/services/stream";
import alertsService from "@/services/alerts";
import { formatEventCount, formatSizeFromMB } from "@/utils/formatters";

const store  = useStore();
const router = useRouter();
const orgId  = computed(() => store.state.selectedOrganization?.identifier ?? "");

// ── Time range ────────────────────────────────────────────────────────────────
const TIME_OPTS = [
  { label: "15m", value: 15 },
  { label: "1h",  value: 60 },
  { label: "24h", value: 1440 },
  { label: "7d",  value: 10080 },
] as const;
const selectedTime = ref<number>(1440);
function timeWindow() {
  const end = Date.now() * 1000;
  return { start: end - selectedTime.value * 60 * 1_000_000, end };
}
function onTimeChange(minutes: number) {
  selectedTime.value = minutes;
  refresh();
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────
const autoRefresh = ref(true);
const lastUpdated = ref<Date | null>(null);
let refreshTimer: ReturnType<typeof setInterval> | null = null;
function startTimer() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (autoRefresh.value) refreshTimer = setInterval(refresh, 60_000);
}
function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  startTimer();
}
function fmtLastUpdated() {
  if (!lastUpdated.value) return "—";
  return lastUpdated.value.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Data ──────────────────────────────────────────────────────────────────────
const streams    = ref<any[]>([]);
const alerts     = ref<any[]>([]);
const findings   = ref<any[]>([]);
const loading    = ref(false);

// ── SEC_RE for security stream detection ──────────────────────────────────────
const SEC_RE = /security|audit|siem|event|login|auth|access|cloudtrail|okta|firewall|vpc|cdc/i;

const secStreams = computed(() => streams.value.filter((s) => SEC_RE.test(s.name)));
const allStreams = computed(() => streams.value);

const enabledAlerts = computed(() => alerts.value.filter((a) => a.enabled));

// ── Findings by severity ──────────────────────────────────────────────────────
interface Finding { severity?: string; state?: string; triggered_at?: string; alert_name?: string; stream_name?: string }
const critical = computed(() => findings.value.filter((f: any) => /critical/i.test(f.severity ?? "")));
const high     = computed(() => findings.value.filter((f: any) => /high/i.test(f.severity ?? "") && !/critical/i.test(f.severity ?? "")));
const medium   = computed(() => findings.value.filter((f: any) => /medium/i.test(f.severity ?? "")));
const low      = computed(() => findings.value.filter((f: any) => /low/i.test(f.severity ?? "")));

// Recent high-priority findings for triage queue
const triagedFindings = computed(() =>
  [...findings.value]
    .sort((a: any, b: any) => (b.triggered_at ?? 0) - (a.triggered_at ?? 0))
    .slice(0, 10)
);

// ── Source health ─────────────────────────────────────────────────────────────
interface SourceRow { name: string; healthy: boolean; docCount: number }
const sourceHealth = computed<SourceRow[]>(() =>
  secStreams.value.map((s) => ({
    name: s.name,
    healthy: (s.stats?.doc_num ?? 0) > 0,
    docCount: s.stats?.doc_num ?? 0,
  }))
);
const silentSources = computed(() => sourceHealth.value.filter((s) => !s.healthy).length);

// ── KPI tiles ─────────────────────────────────────────────────────────────────
interface KPI { label: string; value: string | number; sub?: string; severity?: string; icon: string; route: string; loading?: boolean }
const kpis = computed<KPI[]>(() => [
  {
    label: "Critical Alerts",
    value: critical.value.length,
    sub: `${high.value.length} high`,
    severity: critical.value.length > 0 ? "critical" : undefined,
    icon: "warning-amber",
    route: "/security/alerts",
  },
  {
    label: "Active Detections",
    value: enabledAlerts.value.length,
    sub: `${alerts.value.length} total rules`,
    icon: "shield-alert-outline",
    route: "/security/detections",
  },
  {
    label: "Security Streams",
    value: secStreams.value.length,
    sub: silentSources.value > 0 ? `${silentSources.value} silent` : "all active",
    severity: silentSources.value > 0 ? "medium" : undefined,
    icon: "manage-search",
    route: "/security/events",
  },
  {
    label: "Alerts (24h)",
    value: findings.value.length,
    sub: `${medium.value.length} medium · ${low.value.length} low`,
    icon: "notifications-active",
    route: "/security/alerts",
  },
  {
    label: "Total Streams",
    value: allStreams.value.length,
    sub: "log sources monitored",
    icon: "data-plus-line",
    route: "/security/sources",
  },
]);

// ── Severity donut (simple CSS-rendered proportions) ─────────────────────────
const totalFindings = computed(() =>
  critical.value.length + high.value.length + medium.value.length + low.value.length
);
function sevPercent(n: number) {
  return totalFindings.value > 0 ? Math.round((n / totalFindings.value) * 100) : 0;
}

// ── Detection coverage gauge ─────────────────────────────────────────────────
// Semicircular arc of radius 50 → length π·50 ≈ 157; the fill is drawn by
// walking the dash offset back from the full arc.
const GAUGE_ARC = 157;
const coveragePct = computed(() =>
  alerts.value.length ? Math.round((enabledAlerts.value.length / alerts.value.length) * 100) : 0
);
const gaugeOffset = computed(() => GAUGE_ARC * (1 - coveragePct.value / 100));

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchStreams() {
  const res = await streamService.nameList(orgId.value, "logs", false);
  streams.value = res.data?.list ?? [];
}
async function fetchAlerts() {
  try {
    const res = await alertsService.list(0, 500, "name", false, "", orgId.value);
    alerts.value = res.data?.list ?? [];
  } catch { alerts.value = []; }
}
async function fetchFindings() {
  try {
    // alert_history endpoint — last N triggers
    const res = await alertsService.list(0, 200, "triggered_at", true, "", orgId.value);
    findings.value = res.data?.list ?? [];
  } catch { findings.value = []; }
}

async function refresh() {
  if (!orgId.value) return;
  loading.value = true;
  try {
    await Promise.all([fetchStreams(), fetchAlerts(), fetchFindings()]);
    lastUpdated.value = new Date();
  } finally { loading.value = false; }
}

onMounted(() => { refresh(); startTimer(); });
onUnmounted(() => { if (refreshTimer) clearInterval(refreshTimer); });

// ── Navigation ────────────────────────────────────────────────────────────────
function nav(path: string, query?: Record<string, string>) {
  router.push({ path, query: { org_identifier: orgId.value, ...query } });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Counts and sizes reuse the shared formatters so the numbers here read the same
// as on Home and the Streams page. `storage_size` is reported in MB.
function fmtCount(n?: number) { return formatEventCount(Number(n ?? 0)); }
function fmtSize(mb?: number) { return mb ? formatSizeFromMB(mb) : "—"; }
function fmtAge(ts?: string | number) {
  if (!ts) return "—";
  const ms = Date.now() - Number(ts) / 1000;
  if (ms < 60000) return "<1m";
  if (ms < 3600000) return Math.floor(ms / 60000) + "m";
  if (ms < 86400000) return Math.floor(ms / 3600000) + "h";
  return Math.floor(ms / 86400000) + "d";
}
function sevClass(sev?: string) {
  if (!sev) return "sev-info";
  const s = sev.toLowerCase();
  if (s.includes("critical")) return "sev-critical";
  if (s.includes("high"))     return "sev-high";
  if (s.includes("medium"))   return "sev-medium";
  if (s.includes("low"))      return "sev-low";
  return "sev-info";
}
</script>

<template>
  <div class="ov-root bg-surface-base">

    <!-- ── TOOLBAR ──────────────────────────────────────────────────────────── -->
    <div class="ov-toolbar border-border-default border-b">
      <OIcon name="bar-chart" size="sm" class="ov-purple shrink-0" />
      <span class="text-text-primary text-sm font-semibold">SOC Overview</span>
      <div class="flex-1 min-w-0" />

      <!-- Time range -->
      <div class="ov-time-group">
        <button
          v-for="t in TIME_OPTS" :key="t.value"
          :class="['ov-time-btn', { 'ov-time-btn--active': selectedTime === t.value }]"
          @click="onTimeChange(t.value)"
        >{{ t.label }}</button>
      </div>

      <!-- Auto-refresh -->
      <button class="ov-icon-btn" :title="autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'" @click="toggleAutoRefresh">
        <OIcon :name="autoRefresh ? 'sync' : 'sync-disabled'" size="sm" :class="autoRefresh ? 'ov-purple' : 'opacity-40'" />
      </button>
      <span class="text-text-tertiary text-xs shrink-0">{{ fmtLastUpdated() }}</span>

      <!-- Manual refresh -->
      <button class="ov-icon-btn" :title="'Refresh now'" :class="{ 'ov-spin': loading }" @click="refresh">
        <OIcon name="restart-alt" size="sm" />
      </button>
    </div>

    <!-- ── BODY ─────────────────────────────────────────────────────────────── -->
    <div class="ov-body">

      <!-- ── SECTION 1: KPI STRIP ──────────────────────────────────────────── -->
      <div class="ov-kpi-strip">
        <div
          v-for="kpi in kpis" :key="kpi.label"
          class="ov-kpi-card"
          :class="{ 'ov-kpi-card--critical': kpi.severity === 'critical', 'ov-kpi-card--medium': kpi.severity === 'medium' }"
          @click="nav(kpi.route)"
        >
          <div class="flex items-center justify-between mb-2">
            <div class="ov-kpi-ico" :class="{ 'ov-kpi-ico--red': kpi.severity === 'critical', 'ov-kpi-ico--orange': kpi.severity === 'medium' }">
              <OIcon :name="kpi.icon" size="sm" />
            </div>
            <OIcon name="arrow-forward" size="xs" class="opacity-20 group-hover:opacity-60 transition-opacity" />
          </div>
          <div class="ov-kpi-val" :class="{ 'ov-kpi-val--red': kpi.severity === 'critical', 'ov-kpi-val--orange': kpi.severity === 'medium' }">
            <span v-if="loading" class="ov-skeleton-inline" />
            <span v-else>{{ fmtCount(Number(kpi.value)) }}</span>
          </div>
          <div class="text-text-primary text-xs font-semibold mt-0.5">{{ kpi.label }}</div>
          <div class="text-text-tertiary text-xs mt-0.5">{{ kpi.sub }}</div>
        </div>
      </div>

      <!-- ── SECTION 2: THREAT ACTIVITY + SEVERITY BREAKDOWN ──────────────── -->
      <div class="ov-row-2">
        <!-- Alert severity breakdown -->
        <div class="ov-card ov-card--third">
          <div class="ov-card-hdr">
            <OIcon name="shield-alert-outline" size="xs" class="ov-purple" />
            <span>Alert Severity Breakdown</span>
            <div class="flex-1" />
            <button class="ov-link-btn" @click="nav('/security/alerts')">View all →</button>
          </div>
          <div class="ov-card-body">
            <div v-if="loading" class="ov-skeleton-rows"><div v-for="n in 5" :key="n" /></div>
            <template v-else-if="totalFindings > 0">
              <!-- Stacked bar -->
              <div class="ov-sev-bar mb-4">
                <div class="ov-sev-seg seg-critical" :style="{ flex: critical.length }" :title="`Critical: ${critical.length}`" />
                <div class="ov-sev-seg seg-high"     :style="{ flex: high.length }"     :title="`High: ${high.length}`" />
                <div class="ov-sev-seg seg-medium"   :style="{ flex: medium.length }"   :title="`Medium: ${medium.length}`" />
                <div class="ov-sev-seg seg-low"      :style="{ flex: low.length }"      :title="`Low: ${low.length}`" />
              </div>
              <!-- Legend rows -->
              <div class="ov-scroll-list">
                <div v-for="[label, count, cls] in [
                  ['Critical', critical.length, 'seg-critical'],
                  ['High',     high.length,     'seg-high'],
                  ['Medium',   medium.length,   'seg-medium'],
                  ['Low',      low.length,      'seg-low'],
                ]" :key="label" class="ov-list-item">
                  <div :class="['ov-sev-dot', cls]" />
                  <span class="text-text-secondary text-xs flex-1">{{ label }}</span>
                  <span class="text-text-primary text-xs font-bold tabular-nums">{{ count }}</span>
                  <span class="text-text-tertiary text-xs tabular-nums w-8 text-right">{{ sevPercent(count as number) }}%</span>
                </div>
              </div>
            </template>
            <div v-else class="ov-empty-state">
              <OIcon name="check-circle-outline" size="xl" class="ov-txt-green opacity-50" />
              <div class="text-text-secondary text-xs mt-2">No alerts in this window</div>
            </div>
          </div>
        </div>

        <!-- Detection rules health -->
        <div class="ov-card ov-card--third">
          <div class="ov-card-hdr">
            <OIcon name="notifications-active" size="xs" class="ov-purple" />
            <span>Detection Rules</span>
            <div class="flex-1" />
            <button class="ov-link-btn" @click="nav('/security/detections')">Manage →</button>
          </div>
          <div class="ov-card-body">
            <div v-if="loading" class="ov-skeleton-rows"><div v-for="n in 5" :key="n" /></div>
            <template v-else>
              <!-- Coverage gauge -->
              <div class="ov-gauge-block">
                <svg class="ov-gauge" viewBox="0 0 120 66" role="img" aria-label="Detection rule coverage">
                  <path class="ov-gauge-track" d="M 10 60 A 50 50 0 0 1 110 60" />
                  <path
                    class="ov-gauge-fill"
                    d="M 10 60 A 50 50 0 0 1 110 60"
                    :style="{ strokeDashoffset: gaugeOffset }"
                  />
                </svg>
                <div class="ov-gauge-center">
                  <div class="ov-gauge-val text-text-primary">{{ coveragePct }}%</div>
                  <div class="ov-gauge-cap text-text-tertiary">coverage</div>
                </div>
              </div>
              <div class="ov-gauge-legend">
                <div class="ov-gauge-stat">
                  <span class="ov-gauge-stat-val text-text-primary">{{ enabledAlerts.length }}</span>
                  <span class="ov-gauge-stat-cap text-text-tertiary">active</span>
                </div>
                <div class="ov-gauge-divider" />
                <div class="ov-gauge-stat">
                  <span class="ov-gauge-stat-val text-text-tertiary">{{ alerts.length }}</span>
                  <span class="ov-gauge-stat-cap text-text-tertiary">total rules</span>
                </div>
              </div>
              <!-- Rules list -->
              <div class="ov-scroll-list">
                <div v-for="rule in alerts" :key="rule.uuid ?? rule.name" class="ov-list-item">
                  <div :class="['ov-rule-dot', rule.enabled ? 'ov-rule-dot--on' : 'ov-rule-dot--off']" />
                  <span class="text-text-secondary text-xs truncate flex-1" :title="rule.name">{{ rule.name }}</span>
                  <span :class="['ov-badge-tiny', rule.enabled ? 'ov-badge-green' : 'ov-badge-gray']">
                    {{ rule.enabled ? "on" : "off" }}
                  </span>
                </div>
                <div v-if="!alerts.length" class="ov-empty-state">
                  <div class="text-text-tertiary text-xs">No detection rules configured</div>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Platform health -->
        <div class="ov-card ov-card--third">
          <div class="ov-card-hdr">
            <OIcon name="manage-search" size="xs" class="ov-purple" />
            <span>Log Source Health</span>
            <div class="flex-1" />
            <button class="ov-link-btn" @click="nav('/security/sources')">View →</button>
          </div>
          <div class="ov-card-body">
            <div v-if="loading" class="ov-skeleton-rows"><div v-for="n in 5" :key="n" /></div>
            <template v-else>
              <!-- Summary -->
              <div class="ov-gauge-legend">
                <div class="ov-gauge-stat">
                  <span class="ov-gauge-stat-val" :class="silentSources > 0 ? 'ov-txt-orange' : 'ov-txt-green'">
                    {{ sourceHealth.filter(s => s.healthy).length }}
                  </span>
                  <span class="ov-gauge-stat-cap text-text-tertiary">healthy</span>
                </div>
                <div class="ov-gauge-divider" />
                <div class="ov-gauge-stat">
                  <span class="ov-gauge-stat-val" :class="silentSources > 0 ? 'ov-txt-orange' : 'text-text-tertiary'">
                    {{ silentSources }}
                  </span>
                  <span class="ov-gauge-stat-cap text-text-tertiary">silent</span>
                </div>
                <div class="flex-1" />
                <div v-if="silentSources === 0" class="ov-txt-green text-xs font-semibold">All OK</div>
              </div>
              <!-- Source list -->
              <div class="ov-scroll-list">
                <div v-for="src in sourceHealth" :key="src.name" class="ov-list-item">
                  <div :class="['ov-health-dot', src.healthy ? 'ov-health-dot--ok' : 'ov-health-dot--warn']" />
                  <span class="text-text-secondary text-xs truncate flex-1" :title="src.name">{{ src.name }}</span>
                  <span class="text-text-tertiary text-xs tabular-nums">{{ fmtCount(src.docCount) }}</span>
                </div>
                <div v-if="!sourceHealth.length" class="ov-empty-state">
                  <div class="text-text-tertiary text-xs">No security streams yet</div>
                  <button class="ov-link-btn mt-1" @click="nav('/security/sources')">Set up sources →</button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- ── SECTION 3: TRIAGE QUEUE ────────────────────────────────────────── -->
      <div class="ov-card">
        <div class="ov-card-hdr">
          <OIcon name="warning-amber" size="xs" class="ov-purple" />
          <span>Triage Queue — Recent Alerts</span>
          <span v-if="!loading" class="ov-count-badge">{{ triagedFindings.length }}</span>
          <div class="flex-1" />
          <button class="ov-link-btn" @click="nav('/security/alerts')">Full queue →</button>
        </div>
        <div v-if="loading" class="p-4">
          <div v-for="n in 5" :key="n" class="ov-row-skeleton" />
        </div>
        <template v-else-if="triagedFindings.length">
          <!-- Column headers -->
          <div class="ov-triage-header">
            <div class="ov-triage-col-sev">Severity</div>
            <div class="ov-triage-col-name">Alert</div>
            <div class="ov-triage-col-stream">Stream</div>
            <div class="ov-triage-col-age">Age</div>
            <div class="ov-triage-col-state">State</div>
          </div>
          <div class="ov-table-scroll">
            <div
              v-for="f in triagedFindings" :key="f.triggered_at ?? f.alert_name"
              class="ov-triage-row"
              @click="nav('/security/alerts')"
            >
              <div class="ov-triage-col-sev">
                <span :class="['ov-sev-badge', sevClass(f.severity)]">{{ f.severity || "—" }}</span>
              </div>
              <div class="ov-triage-col-name text-text-primary text-xs truncate font-medium">{{ f.alert_name || f.name || "—" }}</div>
              <div class="ov-triage-col-stream text-text-tertiary text-xs truncate font-mono">{{ f.stream_name || "—" }}</div>
              <div class="ov-triage-col-age text-text-tertiary text-xs">{{ fmtAge(f.triggered_at) }}</div>
              <div class="ov-triage-col-state">
                <span class="ov-badge-tiny ov-badge-orange">{{ f.state || "open" }}</span>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="ov-empty-state py-8">
          <OIcon name="check-circle-outline" size="xl" class="ov-txt-green opacity-50" />
          <div class="text-text-secondary text-sm font-medium mt-2">Triage queue is clear</div>
          <div class="text-text-tertiary text-xs mt-1">No alerts fired in this time window</div>
        </div>
      </div>

      <!-- ── SECTION 4: STREAMS EXPLORER ──────────────────────────────────── -->
      <div class="ov-card">
        <div class="ov-card-hdr">
          <OIcon name="manage-search" size="xs" class="ov-purple" />
          <span>Security Log Streams</span>
          <span v-if="!loading" class="ov-count-badge">{{ secStreams.length }}</span>
          <div class="flex-1" />
          <button class="ov-link-btn" @click="nav('/security/events')">Explore events →</button>
        </div>
        <div v-if="loading" class="p-4">
          <div v-for="n in 4" :key="n" class="ov-row-skeleton" />
        </div>
        <template v-else-if="secStreams.length">
          <div class="ov-table-scroll">
            <div
              v-for="s in secStreams" :key="s.name"
              class="ov-stream-row"
              @click="nav('/security/events', { stream: s.name })"
            >
              <div :class="['ov-health-dot', (s.stats?.doc_num ?? 0) > 0 ? 'ov-health-dot--ok' : 'ov-health-dot--warn']" />
              <span class="text-text-primary text-xs font-medium truncate flex-1" :title="s.name">{{ s.name }}</span>
              <span class="ov-stream-count text-text-tertiary text-xs tabular-nums">{{ fmtCount(s.stats?.doc_num) }} events</span>
              <span class="ov-stream-size text-text-tertiary text-xs tabular-nums">{{ fmtSize(s.stats?.storage_size) }}</span>
              <OIcon name="arrow-forward" size="xs" class="text-text-tertiary opacity-30" />
            </div>
          </div>
        </template>
        <div v-else class="ov-empty-state py-8">
          <OIcon name="cloud-upload" size="xl" class="text-text-tertiary opacity-30" />
          <div class="text-text-primary text-sm font-medium mt-2">No security streams detected</div>
          <div class="text-text-tertiary text-xs mt-1 text-center max-w-xs">
            Ingest logs via Okta, CloudTrail, VPC Flow Logs, or syslog. Streams matching
            <code>security</code>, <code>audit</code>, <code>auth</code>, <code>siem</code> appear here automatically.
          </div>
          <button class="ov-setup-btn mt-3" @click="nav('/security/sources')">Set up data sources</button>
        </div>
      </div>

    </div>
  </div>
</template>

<style>
/* ── Root ────────────────────────────────────────────────────────────────── */
/* The page itself never scrolls — `.ov-body` is the single scroll owner, and each
   card scrolls its own list inside a fixed frame. */
.ov-root {
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ── Toolbar ─────────────────────────────────────────────────────────────── */
.ov-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  flex-shrink: 0;
  background: var(--color-surface-panel, #f8f8fa);
}
.dark .ov-toolbar { background: #181818; }

.ov-purple { color: #6d5ce0; }
.dark .ov-purple { color: #a78bfa; }

.ov-icon-btn {
  width: 28px; height: 28px; border-radius: 6px; border: none; background: none;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: var(--color-text-secondary, #6b7280); transition: background 0.1s;
}
.ov-icon-btn:hover { background: rgba(0,0,0,0.06); }
.dark .ov-icon-btn:hover { background: rgba(255,255,255,0.08); }

.ov-time-group { display: flex; gap: 2px; background: rgba(0,0,0,0.05); border-radius: 6px; padding: 2px; }
.dark .ov-time-group { background: rgba(255,255,255,0.05); }
.ov-time-btn {
  padding: 3px 10px; border-radius: 4px; border: none; background: none;
  font-size: 11px; font-weight: 600; cursor: pointer;
  color: var(--color-text-secondary, #6b7280); transition: background 0.1s, color 0.1s;
}
.ov-time-btn:hover { background: rgba(0,0,0,0.05); color: var(--color-text-primary, #111); }
.dark .ov-time-btn:hover { background: rgba(255,255,255,0.07); color: #fff; }
.ov-time-btn--active { background: white !important; color: #6d5ce0 !important; font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.dark .ov-time-btn--active { background: #2a2a3a !important; color: #a78bfa !important; }

/* ── Body ────────────────────────────────────────────────────────────────── */
.ov-body {
  flex: 1;
  min-height: 0;
  padding: 1rem 1rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow-y: auto;
}
/* Sections keep their natural height — without this the flex column shrinks the
   lower cards and clips their content. */
.ov-body > * { flex: 0 0 auto; }

/* ── KPI strip ───────────────────────────────────────────────────────────── */
/* auto-fit (not auto-fill) collapses the tracks the five tiles don't use, so the
   strip always spans the full width instead of trailing empty columns. */
.ov-kpi-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0.625rem;
}
.ov-kpi-card {
  padding: 14px 16px; border-radius: 10px; cursor: pointer; transition: box-shadow 0.15s, border-color 0.15s;
  border: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  background: var(--color-surface-panel, #fff);
}
.dark .ov-kpi-card { background: #1a1a2a; border-color: rgba(255,255,255,0.07); }
.ov-kpi-card:hover { box-shadow: 0 2px 14px rgba(109,92,224,0.12); border-color: rgba(109,92,224,0.3); }
.ov-kpi-card--critical { border-color: rgba(220,38,38,0.3) !important; }
.ov-kpi-card--medium   { border-color: rgba(234,88,12,0.25) !important; }

.ov-kpi-ico {
  width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
  background: rgba(109,92,224,0.1); color: #6d5ce0;
}
.ov-kpi-ico--red    { background: rgba(220,38,38,0.1); color: #dc2626; }
.ov-kpi-ico--orange { background: rgba(234,88,12,0.1); color: #ea580c; }
.dark .ov-kpi-ico { background: rgba(139,144,230,0.15); color: #a78bfa; }
.dark .ov-kpi-ico--red    { background: rgba(220,38,38,0.18); color: #f87171; }
.dark .ov-kpi-ico--orange { background: rgba(234,88,12,0.18); color: #fb923c; }

.ov-kpi-val { font-size: 28px; font-weight: 800; line-height: 1.1; color: var(--color-text-primary, #111); margin-top: 10px; }
.ov-kpi-val--red    { color: #dc2626; }
.ov-kpi-val--orange { color: #ea580c; }
.dark .ov-kpi-val { color: #f0f0f5; }
.dark .ov-kpi-val--red    { color: #f87171; }
.dark .ov-kpi-val--orange { color: #fb923c; }

.ov-skeleton-inline {
  display: inline-block; width: 40px; height: 28px; border-radius: 4px;
  background: rgba(0,0,0,0.06); animation: ov-pulse 1.4s ease-in-out infinite;
}
.dark .ov-skeleton-inline { background: rgba(255,255,255,0.06); }

/* ── 3-column row ────────────────────────────────────────────────────────── */
.ov-row-2 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 1100px) { .ov-row-2 { grid-template-columns: 1fr 1fr; } }
@media (max-width: 700px)  { .ov-row-2 { grid-template-columns: 1fr; } }

/* ── Card ────────────────────────────────────────────────────────────────── */
.ov-card {
  border-radius: 10px; overflow: hidden;
  border: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  background: var(--color-surface-panel, #fff);
}
.dark .ov-card { background: #1a1a2a; border-color: rgba(255,255,255,0.07); }

/* The three summary cards share one frame height so the row reads as a strip;
   overflow is handled by the list inside, never by the card growing. */
.ov-card--third {
  display: flex;
  flex-direction: column;
  height: 22rem;
  min-height: 0;
}

.ov-card-hdr {
  display: flex; align-items: center; gap: 6px; padding: 10px 14px;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.06));
  font-size: 12px; font-weight: 700; color: var(--color-text-primary, #111);
  background: rgba(0,0,0,0.015);
}
.dark .ov-card-hdr { background: rgba(255,255,255,0.02); border-bottom-color: rgba(255,255,255,0.05); color: #e5e7eb; }

.ov-card-hdr > span:first-of-type { white-space: nowrap; }

.ov-card-body {
  padding: 0.875rem;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.ov-card-body > .ov-empty-state,
.ov-card-body > .ov-skeleton-rows { flex: 1; justify-content: center; }

/* Lists inside a card scroll on their own so every row is reachable without the
   card growing past the frame. */
.ov-scroll-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding-right: 0.25rem;
}
.ov-list-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 1.25rem;
  flex: 0 0 auto;
}
.ov-scroll-list > .ov-empty-state { flex: 1; padding: 0.5rem; }

/* Full-width row tables (triage, streams) get a capped scroll area. */
.ov-table-scroll {
  max-height: 21rem;
  overflow-y: auto;
}

/* ── Coverage gauge ──────────────────────────────────────────────────────── */
.ov-gauge-block {
  position: relative;
  width: 100%;
  max-width: 11rem;
  margin: 0 auto 0.25rem;
  flex: 0 0 auto;
}
.ov-gauge { display: block; width: 100%; height: auto; overflow: visible; }
.ov-gauge-track,
.ov-gauge-fill {
  fill: none;
  stroke-width: 9;
  stroke-linecap: round;
}
.ov-gauge-track { stroke: rgba(0,0,0,0.08); }
.dark .ov-gauge-track { stroke: rgba(255,255,255,0.09); }
.ov-gauge-fill {
  stroke: #6d5ce0;
  stroke-dasharray: 157;
  transition: stroke-dashoffset 0.5s ease;
}
.dark .ov-gauge-fill { stroke: #a78bfa; }
.ov-gauge-center {
  position: absolute;
  inset-inline: 0;
  bottom: 0.25rem;
  text-align: center;
  pointer-events: none;
}
.ov-gauge-val { font-size: 1.5rem; font-weight: 800; line-height: 1.1; }
.ov-gauge-cap { font-size: 0.6875rem; }

.ov-gauge-legend {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-bottom: 0.75rem;
  margin-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.06));
  flex: 0 0 auto;
}
.dark .ov-gauge-legend { border-bottom-color: rgba(255,255,255,0.05); }
.ov-gauge-stat { display: flex; flex-direction: column; }
.ov-gauge-stat-val { font-size: 1.25rem; font-weight: 800; line-height: 1.2; }
.ov-gauge-stat-cap { font-size: 0.6875rem; }
.ov-gauge-divider {
  width: 1px;
  align-self: stretch;
  background: var(--color-border-default, rgba(0,0,0,0.08));
}
.dark .ov-gauge-divider { background: rgba(255,255,255,0.08); }

.ov-txt-green  { color: #16a34a !important; }
.ov-txt-orange { color: #ea580c !important; }
.dark .ov-txt-green  { color: #4ade80 !important; }
.dark .ov-txt-orange { color: #fb923c !important; }

.ov-link-btn {
  background: none; border: none; cursor: pointer; font-size: 11px; font-weight: 600;
  color: #6d5ce0; padding: 2px 6px; border-radius: 4px; transition: background 0.1s;
}
.ov-link-btn:hover { background: rgba(109,92,224,0.08); }
.dark .ov-link-btn { color: #a78bfa; }

/* ── Severity stacked bar ────────────────────────────────────────────────── */
.ov-sev-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; gap: 1px; }
.ov-sev-seg { min-width: 4px; border-radius: 2px; }
.seg-critical { background: #dc2626; }
.seg-high     { background: #ea580c; }
.seg-medium   { background: #ca8a04; }
.seg-low      { background: #2563eb; }

.ov-sev-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.ov-sev-dot.seg-critical { background: #dc2626; }
.ov-sev-dot.seg-high     { background: #ea580c; }
.ov-sev-dot.seg-medium   { background: #ca8a04; }
.ov-sev-dot.seg-low      { background: #2563eb; }

/* ── Detection rule dot ──────────────────────────────────────────────────── */
.ov-rule-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.ov-rule-dot--on  { background: #22c55e; }
.ov-rule-dot--off { background: rgba(107,114,128,0.4); }

/* ── Health dots ─────────────────────────────────────────────────────────── */
.ov-health-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.ov-health-dot--ok   { background: #22c55e; }
.ov-health-dot--warn { background: #f59e0b; animation: ov-pulse 2s ease-in-out infinite; }

/* ── Count badge ─────────────────────────────────────────────────────────── */
.ov-count-badge {
  padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 700;
  background: rgba(109,92,224,0.12); color: #6d5ce0;
}
.dark .ov-count-badge { background: rgba(167,139,250,0.15); color: #a78bfa; }

/* ── Triage table ────────────────────────────────────────────────────────── */
.ov-triage-header {
  display: flex; align-items: center; gap: 0;
  padding: 6px 14px;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--color-text-tertiary, #9ca3af);
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.06));
  background: rgba(0,0,0,0.01);
}
.dark .ov-triage-header { background: rgba(255,255,255,0.01); }
.ov-triage-row {
  display: flex; align-items: center; gap: 0;
  padding: 8px 14px; cursor: pointer;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.04));
  transition: background 0.08s;
}
.ov-triage-row:hover { background: rgba(109,92,224,0.04); }
.dark .ov-triage-row { border-bottom-color: rgba(255,255,255,0.03); }
.dark .ov-triage-row:hover { background: rgba(109,92,224,0.08); }
.ov-triage-row:last-child { border-bottom: none; }
.ov-triage-col-sev    { width: 76px; flex-shrink: 0; }
.ov-triage-col-name   { flex: 1; min-width: 0; padding-right: 12px; }
.ov-triage-col-stream { width: 140px; flex-shrink: 0; padding-right: 12px; }
.ov-triage-col-age    { width: 40px; flex-shrink: 0; padding-right: 12px; }
.ov-triage-col-state  { width: 60px; flex-shrink: 0; }

/* ── Severity badge ──────────────────────────────────────────────────────── */
.ov-sev-badge {
  display: inline-block; padding: 1px 6px; border-radius: 3px;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; line-height: 1.6;
}
.sev-critical { background: rgba(220,38,38,0.12); color: #dc2626; }
.sev-high     { background: rgba(234,88,12,0.12); color: #ea580c; }
.sev-medium   { background: rgba(202,138,4,0.12); color: #854d0e; }
.sev-low      { background: rgba(37,99,235,0.12); color: #2563eb; }
.sev-info     { background: rgba(107,114,128,0.1); color: #6b7280; }
.dark .sev-critical { background: rgba(220,38,38,0.2); color: #f87171; }
.dark .sev-high     { background: rgba(234,88,12,0.2); color: #fb923c; }
.dark .sev-medium   { background: rgba(202,138,4,0.2); color: #fcd34d; }
.dark .sev-low      { background: rgba(37,99,235,0.2); color: #60a5fa; }
.dark .sev-info     { background: rgba(107,114,128,0.15); color: #9ca3af; }

/* ── Small badges ────────────────────────────────────────────────────────── */
.ov-badge-tiny {
  padding: 1px 5px; border-radius: 3px; font-size: 10px; font-weight: 600;
}
.ov-badge-green  { background: rgba(22,163,74,0.12); color: #16a34a; }
.ov-badge-gray   { background: rgba(107,114,128,0.1); color: #6b7280; }
.ov-badge-orange { background: rgba(234,88,12,0.12); color: #ea580c; }
.dark .ov-badge-green  { background: rgba(74,222,128,0.15); color: #4ade80; }
.dark .ov-badge-gray   { background: rgba(107,114,128,0.15); color: #9ca3af; }
.dark .ov-badge-orange { background: rgba(251,146,60,0.15); color: #fb923c; }

/* ── Stream rows ─────────────────────────────────────────────────────────── */
.ov-stream-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 14px; cursor: pointer;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.04));
  transition: background 0.08s;
}
.ov-stream-row:hover { background: rgba(109,92,224,0.04); }
.dark .ov-stream-row { border-bottom-color: rgba(255,255,255,0.03); }
.dark .ov-stream-row:hover { background: rgba(109,92,224,0.08); }
.ov-stream-row:last-child { border-bottom: none; }
/* Fixed metric columns so counts and sizes line up down the list. */
.ov-stream-count, .ov-stream-size { flex-shrink: 0; text-align: right; }
.ov-stream-count { width: 7rem; }
.ov-stream-size  { width: 5.5rem; }

/* ── Empty / skeleton states ─────────────────────────────────────────────── */
.ov-empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 24px 16px; text-align: center;
}
.ov-skeleton-rows > * { height: 32px; border-radius: 4px; background: rgba(0,0,0,0.05); margin-bottom: 6px; animation: ov-pulse 1.4s ease-in-out infinite; }
.dark .ov-skeleton-rows > * { background: rgba(255,255,255,0.05); }
.ov-row-skeleton { height: 36px; border-radius: 4px; background: rgba(0,0,0,0.04); margin-bottom: 4px; animation: ov-pulse 1.4s ease-in-out infinite; }
.dark .ov-row-skeleton { background: rgba(255,255,255,0.04); }

.ov-setup-btn {
  padding: 6px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 600;
  background: rgba(109,92,224,0.1); color: #6d5ce0; transition: background 0.1s;
}
.ov-setup-btn:hover { background: rgba(109,92,224,0.18); }
.dark .ov-setup-btn { color: #a78bfa; background: rgba(167,139,250,0.12); }

/* ── Spin / pulse ────────────────────────────────────────────────────────── */
.ov-spin { animation: ov-rotate 1s linear infinite; }
@keyframes ov-rotate { to { transform: rotate(360deg); } }
@keyframes ov-pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.8; } }
</style>
