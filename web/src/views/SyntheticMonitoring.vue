<template>
  <div class="syn-root">

    <!-- PAGE HEADER -->
    <div class="syn-page-header">
      <div class="syn-page-title-wrap">
        <div class="syn-page-icon">
          <OIcon name="radar" size="md" />
        </div>
        <div>
          <div class="syn-title">Synthetic Monitoring</div>
          <div class="syn-sub">Proactively monitor uptime, performance, and user journeys from global locations</div>
        </div>
      </div>
      <div class="syn-hdr-actions">
        <OButton variant="ghost" size="sm" :class="{ 'geo-hdr-btn--alert': geoIssues.length }" @click="showIssuesModal = true">
          <template #icon-left><OIcon :name="geoIssues.length ? 'error' : 'check-circle'" size="xs" /></template>
          Active Issues
          <span v-if="geoIssues.length" class="geo-hdr-badge">{{ geoIssues.length }}</span>
        </OButton>
        <OButton variant="ghost" size="sm" @click="showHeatmapModal = true">
          <template #icon-left><OIcon name="language" size="xs" /></template>
          Geo Map
        </OButton>
        <OButton variant="primary" @click="openCreate">
          <template #icon-left><OIcon name="add" size="sm" /></template>
          New Monitor
        </OButton>
      </div>
    </div>

    <!-- FILTER BAR -->
    <div class="syn-filter-bar">
      <!-- View switcher -->
      <OToggleGroup
        v-if="areMultiTypeTestEnabled"
        :model-value="activeTab"
        @update:model-value="(v) => { activeTab = v as string }"
      >
        <OToggleGroupItem v-for="tab in tabs" :key="tab.key" :value="tab.key" size="sm">
          {{ tab.label }}
        </OToggleGroupItem>
      </OToggleGroup>

      <div v-if="areMultiTypeTestEnabled" class="syn-filter-sep" />

      <!-- Status filter — only on All Monitors tab -->
      <template v-if="activeTab === 'monitors'">
        <OToggleGroup
          :model-value="statusFilter"
          @update:model-value="(v) => { statusFilter = v as string }"
        >
          <OToggleGroupItem v-for="s in statusTabs" :key="s.filter" :value="s.filter" size="sm">
            <span v-if="s.filter !== 'all'" class="syn-pill-dot" :class="'sdot-' + s.filter.toLowerCase()" />
            {{ s.label }} <span class="syn-pill-count">{{ s.count }}</span>
          </OToggleGroupItem>
        </OToggleGroup>
        <div class="syn-filter-sep" />
      </template>

      <!-- Search -->
      <template v-if="activeTab !== 'private'">
        <OSearchInput
          v-model="search"
          :placeholder="activeTab === 'browser' ? 'Search browser tests...' : activeTab === 'api' ? 'Search API tests...' : 'Search monitors...'"
        />
      </template>

      <!-- Type + Location dropdowns -->
      <template v-if="activeTab === 'monitors'">
        <OSelect
          v-if="areMultiTypeTestEnabled"
          v-model="typeFilter"
          :options="typeOpts"
          size="md"
          />
        <OSelect
          v-if="areMultiTypeTestEnabled"
          v-model="locationFilter"
          :options="locationOpts"
          size="md"
        />
      </template>

      <div style="flex:1" />

      <template v-if="activeTab === 'private'">
        <OButton variant="primary">
          <template #icon-left><OIcon name="add" size="sm" /></template>
          Add Location
        </OButton>
      </template>
    </div>

    <!-- ── MONITORS TABLE (All Monitors / Browser Tests / API Tests) ── -->
    <MonitorTable
      v-if="activeTab === 'monitors' || activeTab === 'browser' || activeTab === 'api'"
      :mode="monitorTableMode"
      :data="activeTab === 'browser' ? browserMonitors : activeTab === 'api' ? apiMonitors : filteredMonitors"
      :footer-title="activeTab === 'browser' ? 'Browser Tests' : activeTab === 'api' ? 'API Tests' : 'Monitors'"
      :empty-message="activeTab === 'browser' ? 'No browser tests found.' : activeTab === 'api' ? 'No API tests found.' : 'No monitors found. Adjust filters or create your first monitor.'"
      data-test="synthetic-monitoring-monitors-table"
      @row-click="(row) => activeTab === 'monitors' && openDetail(row)"
      @edit="openEdit"
    />

    <!-- ── PRIVATE LOCATIONS ── -->
    <PrivateLocations
      v-else-if="activeTab === 'private'"
      :locations="privateLocations"
      data-test="synthetic-monitoring-private-locations"
    />


    <!-- Map dot tooltip -->
    <Teleport to="body">
      <div v-if="mapTip.show && mapTip.stat"
        class="map-dot-tip"
        :style="{ left: mapTip.x + 'px', top: mapTip.y + 'px' }"
        @mouseenter="keepMapTip"
        @mouseleave="hideMapTip">
        <div class="stt-header">
          <span class="stt-time">{{ mapTip.stat.flag }} {{ mapTip.stat.label }}</span>
          <span class="stt-badge" :class="'stt-badge--'+mapTip.stat.health">
            {{ mapTip.stat.health === 'up' ? '✓ Healthy' : mapTip.stat.health === 'down' ? '✗ Outage' : '⚠ Degraded' }}
          </span>
        </div>
        <div class="stt-divider"/>
        <div class="map-tip-row"><span>Uptime</span><span class="map-tip-val">{{ mapTip.stat.uptime }}%</span></div>
        <div class="map-tip-row"><span>Monitors</span><span class="map-tip-val">{{ mapTip.stat.total }}</span></div>
        <div v-if="mapTip.stat.downCt" class="map-tip-row"><span>Down</span><span class="map-tip-val c-r">{{ mapTip.stat.downCt }}</span></div>
        <div v-if="mapTip.stat.degCt" class="map-tip-row"><span>Degraded</span><span class="map-tip-val c-a">{{ mapTip.stat.degCt }}</span></div>
        <div class="map-tip-row"><span>City</span><span class="map-tip-val">{{ mapTip.stat.city }}</span></div>
      </div>
    </Teleport>

    <!-- Detail Side Panel -->
    <MonitorDetailPanel
      :monitor="selectedMonitor"
      data-test="synthetic-monitoring-detail-panel"
      @close="closeDetail"
    />

    <!-- Full Heatmap Modal -->
    <ODialog v-model:open="showHeatmapModal" title="Global Health Heatmap" :width="94">
      <template #header-right>
        <div class="geo-modal-legend">
          <span class="geo-leg-item"><span class="geo-leg-dot geo-leg-dot--up" /><span>Healthy</span></span>
          <span class="geo-leg-item"><span class="geo-leg-dot geo-leg-dot--deg" /><span>Degraded</span></span>
          <span class="geo-leg-item"><span class="geo-leg-dot geo-leg-dot--dn" /><span>Down</span></span>
        </div>
      </template>
      <div class="geo-modal-body">
        <div ref="heatmapChartEl" class="geo-echarts-map"></div>
      </div>
    </ODialog>

    <!-- Active Issues Modal -->
    <ODialog v-model:open="showIssuesModal" size="sm">
      <template #header>
        <OIcon :name="geoIssues.length ? 'error' : 'check-circle'" size="sm" :class="geoIssues.length ? 'c-r' : 'c-g'"/>
        <span class="tw:text-base tw:font-semibold">Active Issues</span>
      </template>
      <div class="issues-body">
        <!-- All clear -->
        <template v-if="!geoIssues.length">
          <div class="issues-clear">
            <OIcon name="check-circle" size="lg" class="c-g"/>
            <div style="font-weight:600;margin-top:8px">All regions healthy</div>
            <div style="font-size:12px;color:var(--o2-tab-text-color);margin-top:4px">No active issues detected across all monitoring locations.</div>
          </div>
        </template>
        <!-- Issue rows -->
        <template v-else>
          <div v-if="geoLocStats.filter(s=>s.health!=='up').length >= 2" class="issues-banner">
            <OIcon name="warning-amber" size="sm"/> {{ geoLocStats.filter(s=>s.health!=='up').length }} regions simultaneously affected — possible CDN or upstream incident
          </div>
          <div class="issues-list">
            <div v-for="issue in geoIssues" :key="issue.key" class="issues-row" :class="'issues-row--'+issue.level">
              <div class="issues-row-left">
                <span class="issues-dot" :class="issue.level==='error'?'issues-dot--down':'issues-dot--deg'"/>
                <div>
                  <div class="issues-loc">{{ issue.stat.flag }} {{ issue.stat.label }}</div>
                  <div class="issues-city">{{ issue.stat.city }}</div>
                </div>
              </div>
              <div class="issues-row-right">
                <span class="issues-badge" :class="issue.level==='error'?'issues-badge--down':'issues-badge--deg'">
                  {{ issue.level==='error' ? issue.stat.downCt + ' down' : issue.stat.degCt + ' degraded' }}
                </span>
                <div class="issues-uptime" :class="issue.level==='error'?'c-r':'c-a'">{{ issue.stat.uptime }}% uptime</div>
                <div class="issues-total">{{ issue.stat.total }} monitors</div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </ODialog>

    <!-- DRAWER -->
    <MonitorFormDrawer
      v-model:open="showDrawer"
      :edit-target="editTarget"
      :online-private-locations="onlinePrivateLocations"
      data-test="synthetic-monitoring-monitor-form-drawer"
      @save="() => {}"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import * as echarts from "echarts";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import MonitorTable from "@/components/synthetic-monitoring/MonitorTable.vue";
import PrivateLocations, { type PrivateLocation } from '@/components/synthetic-monitoring/PrivateLocations.vue'
import MonitorDetailPanel from '@/components/synthetic-monitoring/MonitorDetailPanel.vue'
import MonitorFormDrawer from '@/components/synthetic-monitoring/MonitorFormDrawer.vue'

const router = useRouter();

const areMultiTypeTestEnabled = false;

const activeTab      = ref("monitors");
const monitorTableMode = computed(() => activeTab.value as 'monitors' | 'browser' | 'api');
const statusFilter   = ref("all");
const typeFilter     = ref("all");
const locationFilter = ref("all");
const search         = ref("");
const showDrawer     = ref(false);
const editTarget     = ref<any>(null);

onUnmounted(() => {
  if (mapTipTimer) clearTimeout(mapTipTimer);
  heatmapChart?.dispose();
});

// ── Geo Checks ────────────────────────────────────────────────────────
const geoAllLocations = [
  { key:"US East",    label:"US East",    flag:"🇺🇸", city:"Virginia, USA"      },
  { key:"US West",    label:"US West",    flag:"🇺🇸", city:"Oregon, USA"        },
  { key:"EU West",    label:"EU West",    flag:"🇮🇪", city:"Dublin, Ireland"    },
  { key:"EU Central", label:"EU Central", flag:"🇩🇪", city:"Frankfurt, Germany" },
  { key:"AP SE",      label:"AP SE",      flag:"🇸🇬", city:"Singapore"          },
  { key:"AP NE",      label:"AP NE",      flag:"🇯🇵", city:"Tokyo, Japan"       },
];
const geoAllRows = computed(() => {
  return monitors.value
    .map(m => {
      const cells = geoAllLocations.map((loc, li) => {
        const configured = m.locations.includes(loc.key);
        if (!configured) return { loc: loc.key, status: "none" as const, ms: null };
        const seed = (m.id * 11 + li * 17 + loc.key.charCodeAt(0)) % 97;
        let st: "up"|"down"|"deg";
        if (m.status === "Down")          st = "down";
        else if (m.status === "Degraded") st = seed % 4 === 0 ? "deg" : seed % 7 === 0 ? "down" : "up";
        else                              st = seed % 11 === 0 ? "deg" : "up";
        const ms = st === "down" ? null : 55 + seed * 4 + (st === "deg" ? 280 + seed * 2 : 0);
        return { loc: loc.key, status: st, ms };
      });
      return { monitor: m, cells };
    })
    .sort((a, b) => {
      const rank = (r: typeof a) => r.cells.some(c=>c.status==="down") ? 0 : r.cells.some(c=>c.status==="deg") ? 1 : 2;
      return rank(a) - rank(b);
    });
});
const geoLocStats = computed(() =>
  geoAllLocations.map((loc, li) => {
    const configured = geoAllRows.value.filter(r => r.cells[li].status !== "none");
    const downCt = configured.filter(r => r.cells[li].status === "down").length;
    const degCt  = configured.filter(r => r.cells[li].status === "deg").length;
    const upCt   = configured.filter(r => r.cells[li].status === "up").length;
    const total  = configured.length;
    const uptime = total ? +(((upCt + degCt * 0.5) / total) * 100).toFixed(1) : 100;
    const health: "up"|"down"|"deg" = downCt > 0 ? "down" : degCt > 0 ? "deg" : "up";
    return { ...loc, total, upCt, degCt, downCt, uptime, health };
  })
);

// ── Geo Map & Panels ───────────────────────────────────────────────────
const geoMapLonLat: Record<string, [number, number]> = {
  "US East":    [-77.0, 38.9],
  "US West":    [-122.4, 45.5],
  "EU West":    [-6.2, 53.3],
  "EU Central": [8.7, 50.1],
  "AP SE":      [103.8, 1.3],
  "AP NE":      [139.7, 35.7],
};

const showHeatmapModal = ref(false);
const heatmapChartEl = ref<HTMLElement | null>(null);
let heatmapChart: echarts.ECharts | null = null;
let worldGeoRegistered = false;

const getHeatmapOption = () => {
  const isDark = document.body.classList.contains("body--dark");
  const landColor   = isDark ? "#1d2f3f" : "#cdd5ae";
  const borderCol   = isDark ? "#2d4560" : "#9faa80";
  const oceanBg     = isDark ? "#0d1b2a" : "#c2ddf0";
  const labelColor  = isDark ? "#cbd5e1" : "#334155";
  return {
    backgroundColor: oceanBg,
    geo: {
      map: "world",
      roam: false,
      silent: true,
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      itemStyle: { areaColor: landColor, borderColor: borderCol, borderWidth: 0.5 },
      emphasis: { itemStyle: { areaColor: landColor }, label: { show: false } },
      select: { disabled: true },
    },
    tooltip: {
      trigger: "item",
      formatter: (params: any) => {
        if (!params.data) return "";
        const d = params.data;
        const col = d.health === "up" ? "#22c55e" : d.health === "down" ? "#ef4444" : "#f59e0b";
        const label = d.health === "up" ? "Healthy" : d.health === "down" ? "Outage" : "Degraded";
        return `<div style="font-size:12px;line-height:1.7"><b>${d.flag} ${d.name}</b><br/><span style="color:${col}">${label}</span><br/>Uptime: ${d.uptime}%<br/>Monitors: ${d.total}</div>`;
      },
      backgroundColor: isDark ? "#1e2d3d" : "#ffffff",
      borderColor:     isDark ? "#2d4560" : "#e2e8f0",
      textStyle: { color: labelColor },
    },
    series: [{
      type: "effectScatter",
      coordinateSystem: "geo",
      rippleEffect: { brushType: "stroke", scale: 3.5, period: 2.5 },
      symbolSize: (val: any, params: any) => Math.max(12, Math.min(26, 10 + (params.data.total ?? 0) * 0.7)),
      data: geoLocStats.value.map(s => ({
        name: s.label,
        value: [geoMapLonLat[s.key][0], geoMapLonLat[s.key][1]],
        health: s.health,
        uptime: s.uptime,
        total: s.total,
        flag: s.flag,
      })),
      itemStyle: {
        color: (params: any) => params.data.health === "up" ? "#22c55e" : params.data.health === "down" ? "#ef4444" : "#f59e0b",
        borderColor: "rgba(255,255,255,0.8)",
        borderWidth: 2,
        shadowBlur: 12,
        shadowColor: (params: any) => params.data.health === "up" ? "rgba(34,197,94,0.5)" : params.data.health === "down" ? "rgba(239,68,68,0.5)" : "rgba(245,158,11,0.5)",
      },
      label: {
        show: true,
        position: "bottom",
        distance: 8,
        formatter: (params: any) => `${params.data.flag} ${params.data.name}`,
        fontSize: 10,
        fontWeight: 600,
        color: labelColor,
        textBorderColor: isDark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.8)",
        textBorderWidth: 2,
      },
    }],
  };
};

const initHeatmapChart = async () => {
  await nextTick();
  if (!heatmapChartEl.value) return;
  if (!worldGeoRegistered) {
    const worldJson = await import("@/assets/dashboard/maps/map.json");
    echarts.registerMap("world", worldJson.default as any);
    worldGeoRegistered = true;
  }
  heatmapChart = echarts.init(heatmapChartEl.value);
  heatmapChart.setOption(getHeatmapOption());
  await nextTick();
  heatmapChart.resize();
};

watch(showHeatmapModal, (open) => {
  if (!open) {
    heatmapChart?.dispose();
    heatmapChart = null;
    return;
  }
  initHeatmapChart().catch((err) => {
    console.error('Failed to initialize heatmap chart:', err);
  });
});
const showIssuesModal  = ref(false);
const geoIssues = computed(() => {
  const list: { key: string; level: "error" | "warn"; stat: typeof geoLocStats.value[0] }[] = [];
  geoLocStats.value.forEach(s => {
    if (s.health === "down") list.push({ key: `${s.key}-down`, level: "error", stat: s });
    else if (s.health === "deg") list.push({ key: `${s.key}-deg`, level: "warn", stat: s });
  });
  return list;
});

const mapTip = ref({ show: false, x: 0, y: 0, stat: null as any });
let mapTipTimer: ReturnType<typeof setTimeout> | null = null;
const keepMapTip = () => { if (mapTipTimer) { clearTimeout(mapTipTimer); mapTipTimer = null; } };
const hideMapTip = () => { mapTipTimer = setTimeout(() => { mapTip.value.show = false; }, 100); };


// ── Detail Side Panel ──────────────────────────────────────────────────
const selectedMonitor = ref<any | null>(null);

const openDetail = (monitor: any) => {
  if (monitor.type === 'browser' || monitor.type === 'Browser') {
    router.push({ name: 'synthetic-detail', params: { id: monitor.id } });
    return;
  }
  selectedMonitor.value = monitor;
};
const closeDetail = () => { selectedMonitor.value = null; };


const tabs = [
  { key:"monitors", label:"All Monitors",     count:30   },
  { key:"browser",  label:"Browser Tests",    count:5    },
  { key:"api",      label:"API Tests",        count:6    },
  { key:"private",  label:"Private Locations",count:null },
];

const typeOpts = [
  { label:"All types", value:"all" },
  ...["HTTP","Browser","API","TCP","Ping","DNS"].map(v=>({ label:v, value:v })),
];
const locationOpts = [
  { label:"All locations", value:"all" },
  { label:"US East",      value:"US East" },{ label:"US West",    value:"US West" },
  { label:"EU West",      value:"EU West" },{ label:"EU Central", value:"EU Central" },{ label:"AP Southeast", value:"AP SE" },
];

// ── 30 mock monitors ──────────────────────────────────────────────────
interface HistoryTick {
  status: "up"|"down"|"deg";
  hour: string;
  nextHour: string;
  checks: { loc: string; ms: number|null; ok: boolean }[];
  avgMs: number|null;
}

const genHistory = (n: number, k: "up"|"down"|"deg", locs: string[]): HistoryTick[] => {
  const now = new Date();
  return Array.from({length: n}, (_, i) => {
    const hoursAgo = n - 1 - i;
    const d = new Date(now.getTime() - hoursAgo * 3_600_000);
    const hour     = `${String(d.getHours()).padStart(2,"0")}:00`;
    const nextHour = `${String((d.getHours() + 1) % 24).padStart(2,"0")}:00`;
    const st: "up"|"down"|"deg" = k==="up" ? "up"
      : k==="down" ? (i > n - 5 ? "down" : "up")
      : (i % 4 === 0 ? "deg" : "up");
    const checks = locs.map((loc, li) => {
      const seed = (i * 7 + li * 13 + loc.charCodeAt(0)) % 97;
      const ok = st !== "down";
      const ms = ok ? 60 + seed * 3 + (st === "deg" ? 180 + seed : 0) : null;
      return { loc, ms, ok };
    });
    const valid = checks.map(c => c.ms).filter((v): v is number => v !== null);
    const avgMs = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
    return { status: st, hour, nextHour, checks, avgMs };
  });
};

const monitors = ref([
  { id:1,  name:"Homepage",           url:"https://openobserve.ai",                  type:"HTTP",    interval:"1m",  status:"Up",       responseTime:"142ms", uptime:99.9, locations:["US East","EU West","AP SE"],                        lastCheck:"2s ago"   },
  { id:2,  name:"API Health",         url:"https://api.openobserve.ai/healthz",      type:"HTTP",    interval:"30s", status:"Up",       responseTime:"89ms",  uptime:100,  locations:["US East","US West","EU West","EU Central","AP SE"],  lastCheck:"1s ago"   },
  { id:3,  name:"Login Flow",         url:"https://openobserve.ai/login",            type:"Browser", interval:"5m",  status:"Degraded", responseTime:"1.8s",  uptime:98.1, locations:["US East","EU West"],                                lastCheck:"3m ago"   },
  { id:4,  name:"Checkout API",       url:"https://api.openobserve.ai/v1/checkout",  type:"API",     interval:"1m",  status:"Down",     responseTime:null,    uptime:95.3, locations:["US East","US West","EU West"],                      lastCheck:"1m ago"   },
  { id:5,  name:"Docs Site",          url:"https://openobserve.ai/docs",             type:"HTTP",    interval:"5m",  status:"Up",       responseTime:"234ms", uptime:99.7, locations:["US East","EU West"],                                lastCheck:"4m ago"   },
  { id:6,  name:"Ingest Endpoint",    url:"https://ingest.openobserve.ai",           type:"HTTP",    interval:"30s", status:"Up",       responseTime:"67ms",  uptime:100,  locations:["US East","US West","EU West","AP SE"],              lastCheck:"5s ago"   },
  { id:7,  name:"Auth Service",       url:"https://auth.openobserve.ai/token",       type:"API",     interval:"1m",  status:"Up",       responseTime:"110ms", uptime:99.8, locations:["US East","EU West","AP SE"],                        lastCheck:"45s ago"  },
  { id:8,  name:"Dashboard Load",     url:"https://openobserve.ai/web/dashboards",   type:"Browser", interval:"10m", status:"Degraded", responseTime:"3.2s",  uptime:97.4, locations:["US East"],                                          lastCheck:"9m ago"   },
  { id:9,  name:"Metrics API",        url:"https://api.openobserve.ai/v1/metrics",   type:"API",     interval:"1m",  status:"Up",       responseTime:"95ms",  uptime:99.5, locations:["US East","EU West"],                                lastCheck:"30s ago"  },
  { id:10, name:"DB TCP Probe",       url:"db.openobserve.ai:5432",                  type:"TCP",     interval:"1m",  status:"Up",       responseTime:"12ms",  uptime:100,  locations:["US East"],                                          lastCheck:"15s ago"  },
  { id:11, name:"CDN Latency",        url:"https://cdn.openobserve.ai",              type:"HTTP",    interval:"5m",  status:"Up",       responseTime:"31ms",  uptime:100,  locations:["US East","US West","EU West"],                      lastCheck:"4m ago"   },
  { id:12, name:"Search API",         url:"https://api.openobserve.ai/v1/search",    type:"API",     interval:"1m",  status:"Up",       responseTime:"203ms", uptime:99.2, locations:["US East","EU West"],                                lastCheck:"50s ago"  },
  { id:13, name:"Signup Flow",        url:"https://openobserve.ai/signup",           type:"Browser", interval:"10m", status:"Up",       responseTime:"2.1s",  uptime:99.6, locations:["US East","EU West"],                                lastCheck:"8m ago"   },
  { id:14, name:"Billing API",        url:"https://api.openobserve.ai/v1/billing",   type:"API",     interval:"2m",  status:"Degraded", responseTime:"820ms", uptime:96.7, locations:["US East"],                                          lastCheck:"1m ago"   },
  { id:15, name:"Status Page",        url:"https://status.openobserve.ai",           type:"HTTP",    interval:"1m",  status:"Up",       responseTime:"88ms",  uptime:99.9, locations:["US East","US West","EU West","AP SE"],              lastCheck:"30s ago"  },
  { id:16, name:"Redis Probe",        url:"cache.openobserve.ai:6379",               type:"TCP",     interval:"30s", status:"Up",       responseTime:"5ms",   uptime:100,  locations:["US East"],                                          lastCheck:"10s ago"  },
  { id:17, name:"Onboarding Flow",    url:"https://openobserve.ai/onboarding",       type:"Browser", interval:"15m", status:"Up",       responseTime:"1.4s",  uptime:99.1, locations:["US East","EU West"],                                lastCheck:"14m ago"  },
  { id:18, name:"Alert Webhook",      url:"https://alerts.openobserve.ai/webhook",   type:"HTTP",    interval:"5m",  status:"Up",       responseTime:"145ms", uptime:99.4, locations:["US East","EU Central"],                             lastCheck:"3m ago"   },
  { id:19, name:"DNS openobserve.ai", url:"openobserve.ai",                          type:"DNS",     interval:"5m",  status:"Up",       responseTime:"22ms",  uptime:100,  locations:["US East","EU West"],                                lastCheck:"4m ago"   },
  { id:20, name:"Alerts API",         url:"https://api.openobserve.ai/v1/alerts",    type:"API",     interval:"1m",  status:"Up",       responseTime:"77ms",  uptime:99.8, locations:["US East","EU West","AP SE"],                        lastCheck:"45s ago"  },
  { id:21, name:"Export API",         url:"https://api.openobserve.ai/v1/export",    type:"API",     interval:"5m",  status:"Down",     responseTime:null,    uptime:92.1, locations:["US East"],                                          lastCheck:"4m ago"   },
  { id:22, name:"Pricing Page",       url:"https://openobserve.ai/pricing",          type:"HTTP",    interval:"10m", status:"Up",       responseTime:"178ms", uptime:99.8, locations:["US East","EU West"],                                lastCheck:"8m ago"   },
  { id:23, name:"MQ Probe",           url:"mq.openobserve.ai:5672",                  type:"TCP",     interval:"1m",  status:"Up",       responseTime:"8ms",   uptime:100,  locations:["US East","EU Central"],                             lastCheck:"20s ago"  },
  { id:24, name:"Forgot Password",    url:"https://openobserve.ai/forgot-password",  type:"Browser", interval:"30m", status:"Up",       responseTime:"0.9s",  uptime:99.3, locations:["US East"],                                          lastCheck:"28m ago"  },
  { id:25, name:"DNS api. record",    url:"api.openobserve.ai",                      type:"DNS",     interval:"5m",  status:"Up",       responseTime:"18ms",  uptime:100,  locations:["US East","EU West"],                                lastCheck:"4m ago"   },
  { id:26, name:"Blog Site",          url:"https://openobserve.ai/blog",             type:"HTTP",    interval:"10m", status:"Up",       responseTime:"310ms", uptime:99.5, locations:["US East","EU West"],                                lastCheck:"9m ago"   },
  { id:27, name:"User API",           url:"https://api.openobserve.ai/v1/users",     type:"API",     interval:"1m",  status:"Up",       responseTime:"63ms",  uptime:99.9, locations:["US East","EU West","AP SE"],                        lastCheck:"55s ago"  },
  { id:28, name:"Settings Page",      url:"https://openobserve.ai/settings",         type:"Browser", interval:"30m", status:"Degraded", responseTime:"4.1s",  uptime:94.0, locations:["EU West"],                                          lastCheck:"29m ago"  },
  { id:29, name:"Ping GW1",           url:"gw1.openobserve.ai",                      type:"Ping",    interval:"1m",  status:"Up",       responseTime:"7ms",   uptime:100,  locations:["US East","EU West"],                                lastCheck:"1m ago"   },
  { id:30, name:"Ping GW2",           url:"gw2.openobserve.ai",                      type:"Ping",    interval:"1m",  status:"Up",       responseTime:"9ms",   uptime:100,  locations:["US East","AP SE"],                                  lastCheck:"50s ago"  },
].map(m => ({ ...m, history: genHistory(24, m.status==="Up"?"up":m.status==="Down"?"down":"deg", m.locations) })));

const browserMonitors = computed(() => monitors.value.filter(m=>m.type==="Browser").map(m=>({...m,steps:[3,7,4,5,4][m.id%5]})));
const apiMonitors     = computed(() => monitors.value.filter(m=>m.type==="API").map(m=>({...m,method:"GET",assertions:3})));

const privateLocations = ref<PrivateLocation[]>([
  { id:1, name:"Corp HQ",        region:"New York, US",  status:"Online",  monitors:12, workers:2, checks:36, version:"1.4.2", lastSeen:"5s ago" },
  { id:2, name:"EU Data Center", region:"Frankfurt, DE", status:"Online",  monitors:8,  workers:3, checks:24, version:"1.4.2", lastSeen:"2s ago" },
  { id:3, name:"APAC Office",    region:"Singapore",     status:"Offline", monitors:4,  workers:1, checks:0,  version:"1.3.9", lastSeen:"2h ago" },
]);
const onlinePrivateLocations = computed(() => privateLocations.value.filter(l=>l.status==="Online"));

const statusTabs = computed(() => {
  const ms = monitors.value;
  return [
    { filter:"all",      label:"All",      count:ms.length },
    { filter:"Up",       label:"Up",       count:ms.filter(m=>m.status==="Up").length },
    { filter:"Degraded", label:"Degraded", count:ms.filter(m=>m.status==="Degraded").length },
    { filter:"Down",     label:"Down",     count:ms.filter(m=>m.status==="Down").length },
  ];
});

const filteredMonitors = computed(() =>
  monitors.value.filter(m=>
    (statusFilter.value==="all"   || m.status===statusFilter.value) &&
    (typeFilter.value==="all"     || m.type===typeFilter.value) &&
    (locationFilter.value==="all" || m.locations.includes(locationFilter.value)) &&
    (!search.value || m.name.toLowerCase().includes(search.value.toLowerCase()) || m.url.toLowerCase().includes(search.value.toLowerCase()))
  )
);

const openCreate = () => { editTarget.value = null; showDrawer.value = true }
const openEdit   = (m: any) => { editTarget.value = m; showDrawer.value = true }
</script>

<style scoped>
/* ── ROOT — no hardcoded fallback colors; inherit dark/light from Quasar ── */
.syn-root { display:flex; flex-direction:column; height:100%; overflow:hidden; position:relative; }

/* ── PAGE HEADER ── */
.syn-page-header     { display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; background:var(--o2-card-background); }
.syn-hdr-actions     { display:flex; align-items:center; gap:10px; }
.syn-page-title-wrap { display:flex; align-items:center; gap:12px; }
.syn-page-icon       { width:36px; height:36px; border-radius:9px; background:rgba(0,0,0,.07); display:flex; align-items:center; justify-content:center; flex-shrink:0; color: var(--o2-primary-color); }
.body--dark .syn-page-icon { background:rgba(255,255,255,.1); }
.syn-title           { font-size:14px; font-weight:700; line-height:1.2; }
.syn-sub             { font-size:12px; color:var(--o2-tab-text-color); margin-top:1px; }

/* ── FILTER BAR ── */
.syn-filter-bar  { display:flex; align-items:center; gap:5px; padding:6px 14px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; background:var(--o2-card-background); }
.syn-filter-sep  { width:1px; height:18px; background:var(--o2-border-color); flex-shrink:0; margin:0 2px; }

.syn-pill-count      { font-size:11px; font-weight:700; }
.syn-pill-dot    { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
.sdot-up         { background:#22c55e; }
.sdot-degraded   { background:#f59e0b; }
.sdot-down       { background:#ef4444; }

/* ── COLOR HELPERS ── */
.c-g { color:#15803d; } .body--dark .c-g { color:#4ade80; }
.c-a { color:#d97706; } .body--dark .c-a { color:#fbbf24; }
.c-r { color:#dc2626; } .body--dark .c-r { color:#f87171; }

/* ── GEO MAP HEADER BUTTONS ── */
.geo-hdr-btn--alert { border-color:rgba(239,68,68,.4); color:#dc2626; }
.body--dark .geo-hdr-btn--alert { color:#f87171; border-color:rgba(239,68,68,.35); }
.geo-hdr-badge { display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; border-radius:9px; background:#ef4444; color:#fff; font-size:10px; font-weight:700; padding:0 4px; margin-left:2px; }

/* ── GEO HEATMAP MODAL ── */
.geo-echarts-map { width:100%; height:100%; }
.geo-modal-legend { display:flex; align-items:center; gap:12px; margin-left:8px; flex:1; }
.geo-leg-item { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--o2-tab-text-color); }
.geo-leg-dot { display:inline-block; width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.geo-leg-dot--up  { background: #22c55e; }
.geo-leg-dot--deg { background: #f59e0b; }
.geo-leg-dot--dn  { background: #ef4444; }
.geo-modal-body { flex:none; height:clamp(360px,46vw,540px); overflow:hidden; padding:0; }

/* ── MAP DOT FLOATING TOOLTIP ── */
.map-dot-tip { position:fixed; z-index:9999; padding:10px 12px; background:#1e293b; color:#f1f5f9; border-radius:9px; font-size:12px; min-width:170px; pointer-events:auto; box-shadow:0 8px 24px rgba(0,0,0,.35); }
.map-tip-row { display:flex; justify-content:space-between; gap:16px; margin-top:4px; font-size:11px; }
.map-tip-val { font-weight:600; }

/* ── ISSUES MODAL ── */
.issues-body { flex:1; overflow-y:auto; }
.issues-clear { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:48px 24px; text-align:center; }
.issues-banner { display:flex; align-items:center; gap:8px; margin:12px 16px 0; padding:8px 12px; background:rgba(245,158,11,.1); border-radius:8px; font-size:12px; color:#d97706; }
.body--dark .issues-banner { color:#fbbf24; background:rgba(245,158,11,.12); }
.issues-list { padding:8px 16px 16px; display:flex; flex-direction:column; gap:6px; }
.issues-row { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-radius:10px; border:1px solid var(--o2-border-color); }
.issues-row--error { background:rgba(239,68,68,.04); border-color:rgba(239,68,68,.2); }
.issues-row--warn  { background:rgba(245,158,11,.04); border-color:rgba(245,158,11,.2); }
.issues-row-left { display:flex; align-items:center; gap:10px; }
.issues-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
.issues-dot--down { background:#ef4444; box-shadow:0 0 6px rgba(239,68,68,.6); }
.issues-dot--deg  { background:#f59e0b; box-shadow:0 0 6px rgba(245,158,11,.6); }
.issues-loc  { font-size:13px; font-weight:600; }
.issues-city { font-size:11px; color:var(--o2-tab-text-color); margin-top:1px; }
.issues-row-right { display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
.issues-badge { font-size:10px; font-weight:700; padding:2px 8px; border-radius:5px; white-space:nowrap; }
.issues-badge--down { background:rgba(239,68,68,.12); color:#dc2626; }
.issues-badge--deg  { background:rgba(245,158,11,.12); color:#d97706; }
.body--dark .issues-badge--down { color:#f87171; }
.body--dark .issues-badge--deg  { color:#fbbf24; }
.issues-uptime { font-size:12px; font-weight:700; }
.issues-total  { font-size:10px; color:var(--o2-tab-text-color); }
</style>
