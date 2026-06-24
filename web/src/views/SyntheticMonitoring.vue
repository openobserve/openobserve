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
    <ODrawer
      v-model:open="showDrawer"
      :title="editTarget ? 'Edit Monitor' : 'New Monitor'"
      :sub-title="editTarget ? editTarget.url : 'Configure a new synthetic check'"
      size="lg"
    >
      <template #footer>
        <div class="drw-footer">
          <OButton variant="ghost" :disabled="stepIdx === 0" @click="prevStep">Back</OButton>
          <div style="display:flex;gap:8px">
            <OButton variant="ghost" @click="showDrawer = false">Cancel</OButton>
            <OButton v-if="stepIdx < steps.length - 1" variant="primary" @click="nextStep">Continue →</OButton>
            <OButton v-else variant="primary" @click="saveMonitor">{{ editTarget ? 'Save changes' : 'Create monitor' }}</OButton>
          </div>
        </div>
      </template>

      <OStepper v-model="currentStep" :navigable="true">
        <OStep :name="0" title="Type" :done="stepIdx > 0">
          <div class="drw-slabel">Choose monitor type</div>
          <div class="type-grid">
            <div v-for="t in monitorTypes" :key="t.value" class="type-card" :class="{ 'type-card--on': form.type === t.value }" @click="form.type = t.value">
              <div class="type-top"><OIcon :name="t.icon" size="md" :class="form.type===t.value?'type-icon--on':'type-icon--off'" /><OIcon v-if="form.type===t.value" name="check-circle" size="xs" class="type-check" /></div>
              <div class="type-name">{{ t.label }}</div>
              <div class="type-desc">{{ t.desc }}</div>
            </div>
          </div>
        </OStep>
        <OStep :name="1" title="Configure" :done="stepIdx > 1">
          <div class="drw-slabel">Basic configuration</div>
          <div class="fstack">
            <OInput v-model="form.name" label="Monitor name *" />
            <div style="display:flex;gap:8px">
              <OSelect v-if="['HTTP','API'].includes(form.type)" v-model="form.method" label="Method" :options="['GET','POST','PUT','PATCH','DELETE','HEAD'].map(m => ({label: m, value: m}))" class="tw:w-[110px] tw:shrink-0" />
              <OInput v-model="form.url" label="URL *" placeholder="https://example.com/api/health" class="tw:flex-1" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <OSelect v-model="form.interval" label="Check interval" :options="intervalOpts" />
              <OInput v-model.number="form.timeout" label="Timeout (ms)" type="number" />
            </div>
            <OCollapsible title="Request Headers">
              <div class="tw:p-2.5 tw:flex tw:flex-col tw:gap-2">
                <div v-for="(h, i) in form.headers" :key="i" style="display:flex;gap:8px;align-items:center">
                  <OInput v-model="h.key" placeholder="Name" class="tw:flex-1" />
                  <OInput v-model="h.value" placeholder="Value" class="tw:flex-1" />
                  <OButton variant="ghost" size="sm" @click="form.headers.splice(i,1)"><OIcon name="close" size="xs" /></OButton>
                </div>
                <OButton variant="outline" size="sm" @click="form.headers.push({key:'',value:''})">
                  <template #icon-left><OIcon name="add" size="xs" /></template>
                  Add header
                </OButton>
              </div>
            </OCollapsible>
          </div>
        </OStep>
        <OStep :name="2" title="Locations" :done="stepIdx > 2">
          <div class="drw-slabel">Select check locations</div>
          <div style="font-size:12px;color:var(--o2-tab-text-color);margin-bottom:14px">Checks run simultaneously from all selected locations. Select at least one.</div>
          <div class="loc-section-label">Global locations</div>
          <div class="loc-list">
            <div v-for="loc in globalLocations" :key="loc.value" class="loc-item" :class="{ 'loc-item--on': form.locations.includes(loc.value) }" @click="toggleLoc(loc.value)">
              <div class="loc-flag">{{ loc.flag }}</div>
              <div style="flex:1"><div style="font-size:13px;font-weight:500">{{ loc.label }}</div><div style="font-size:11px;color:var(--o2-tab-text-color)">{{ loc.city }}</div></div>
              <OIcon v-if="form.locations.includes(loc.value)" name="check-circle" size="sm" class="type-check" /><div v-else style="width:16px" />
            </div>
          </div>
          <div v-if="onlinePrivateLocations.length">
            <div class="loc-section-label" style="margin-top:16px">Private locations</div>
            <div class="loc-list">
              <div v-for="loc in onlinePrivateLocations" :key="'pl-'+loc.id"
                class="loc-item" :class="{ 'loc-item--on': form.locations.includes('priv-'+loc.id) }" @click="toggleLoc('priv-'+loc.id)">
                <OIcon name="business" size="sm" :class="form.locations.includes('priv-'+loc.id)?'type-icon--on':'type-icon--off'" />
                <div style="flex:1"><div style="font-size:13px;font-weight:500">{{ loc.name }}</div><div style="font-size:11px;color:var(--o2-tab-text-color)">{{ loc.region }}</div></div>
                <OIcon v-if="form.locations.includes('priv-'+loc.id)" name="check-circle" size="sm" class="type-check" /><div v-else style="width:16px" />
              </div>
            </div>
          </div>
        </OStep>
        <OStep :name="3" title="Assertions & Alerts" :done="stepIdx > 3">
          <div class="drw-slabel">Assertions</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
            <div v-for="(a, i) in form.assertions" :key="i" style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--o2-border-color);border-radius:8px">
              <OSelect v-model="a.type" :options="assertionTypes" class="tw:flex-1" />
              <OSelect v-model="a.operator" :options="['=','!=','<','>','contains','matches'].map(o => ({label: o, value: o}))" class="tw:w-[100px]" />
              <OInput v-model="a.value" placeholder="200" class="tw:flex-1" />
              <OButton variant="ghost" size="sm" @click="form.assertions.splice(i,1)"><OIcon name="close" size="xs" /></OButton>
            </div>
            <OButton variant="outline" size="sm" @click="form.assertions.push({type:'statusCode',operator:'=',value:'200'})">
              <template #icon-left><OIcon name="add" size="xs" /></template>
              Add assertion
            </OButton>
          </div>
          <div class="drw-slabel" style="margin-top:20px">Alert conditions</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;align-items:center;gap:8px;font-size:13px;flex-wrap:wrap">
              <span>Alert when failing from</span>
              <OInput v-model.number="form.alertThreshold" type="number" class="tw:w-15" />
              <span>or more location(s)</span>
            </div>
            <OSwitch v-model="form.notifyOnRecovery" label="Notify on recovery" size="sm" />
            <OSwitch v-model="form.renotify" label="Re-notify every 30 min while failing" size="sm" />
          </div>
        </OStep>
      </OStepper>
    </ODrawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import * as echarts from "echarts";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import MonitorTable from "@/components/synthetic-monitoring/MonitorTable.vue";
import PrivateLocations, { type PrivateLocation } from '@/components/synthetic-monitoring/PrivateLocations.vue'
import MonitorDetailPanel from '@/components/synthetic-monitoring/MonitorDetailPanel.vue'

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
const currentStep    = ref(0);

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
const steps = [
  { key: 0, label: "Type" },
  { key: 1, label: "Configure" },
  { key: 2, label: "Locations" },
  { key: 3, label: "Assertions & Alerts" },
];
const stepIdx  = computed(() => currentStep.value);
const nextStep = () => {
  if (currentStep.value === 0 && form.value.type === 'Browser') {
    router.push({ name: 'synthetic-new' });
    return;
  }
  if (currentStep.value < steps.length - 1) currentStep.value++;
};
const prevStep = () => { if (currentStep.value > 0) currentStep.value--; };

const defaultForm = () => ({
  type:"HTTP", name:"", url:"", method:"GET",
  interval:"1m", timeout:5000,
  locations:["us-east","eu-west"],
  headers:[] as {key:string;value:string}[],
  assertions:[{type:"statusCode",operator:"=",value:"200"}],
  alertThreshold:1, notifyOnRecovery:true, renotify:false,
});
const form = ref(defaultForm());

const monitorTypes = [
  { value:"HTTP",    label:"HTTP Check",     icon:"network-check",  desc:"Verify any HTTP/HTTPS endpoint response." },
  { value:"Browser", label:"Browser Test",   icon:"web",            desc:"Simulate user journeys in a real browser." },
  { value:"API",     label:"Multi-step API", icon:"webhook",        desc:"Chain multiple API calls end-to-end." },
  { value:"TCP",     label:"TCP Monitor",    icon:"lan",            desc:"Check raw TCP port connectivity." },
  { value:"Ping",    label:"ICMP Ping",      icon:"radar",          desc:"Verify host reachability via ICMP." },
  { value:"DNS",     label:"DNS Check",      icon:"dns",            desc:"Validate DNS records and resolution." },
];
const intervalOpts = [
  { label:"30 seconds", value:"30s" },{ label:"1 minute", value:"1m" },{ label:"5 minutes", value:"5m" },
  { label:"10 minutes", value:"10m" },{ label:"30 minutes", value:"30m" },{ label:"1 hour", value:"1h" },
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
const globalLocations = [
  { value:"us-east",    label:"US East",      city:"Virginia, USA",      flag:"🇺🇸" },
  { value:"us-west",    label:"US West",      city:"Oregon, USA",        flag:"🇺🇸" },
  { value:"eu-west",    label:"EU West",      city:"Dublin, Ireland",    flag:"🇮🇪" },
  { value:"eu-central", label:"EU Central",   city:"Frankfurt, Germany", flag:"🇩🇪" },
  { value:"ap-se",      label:"AP Southeast", city:"Singapore",          flag:"🇸🇬" },
  { value:"ap-ne",      label:"AP Northeast", city:"Tokyo, Japan",       flag:"🇯🇵" },
];
const assertionTypes = [
  { label:"Status code",        value:"statusCode" },
  { label:"Response time (ms)", value:"responseTime" },
  { label:"Body contains",      value:"bodyContains" },
  { label:"Header value",       value:"header" },
  { label:"JSON path",          value:"jsonPath" },
  { label:"Certificate TTL",    value:"certTTL" },
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

const toggleLoc  = (v: string) => { const i=form.value.locations.indexOf(v); if(i===-1)form.value.locations.push(v); else form.value.locations.splice(i,1); };
const openCreate  = () => { editTarget.value=null; form.value=defaultForm(); currentStep.value=0; showDrawer.value=true; };
const openEdit    = (m: any) => { editTarget.value=m; form.value={...defaultForm(),name:m.name,url:m.url,type:m.type,interval:m.interval}; currentStep.value=1; showDrawer.value=true; };
const saveMonitor = () => { showDrawer.value=false; };
</script>

<style scoped>
/* ── ROOT — no hardcoded fallback colors; inherit dark/light from Quasar ── */
.syn-root { display:flex; flex-direction:column; height:100%; overflow:hidden; position:relative; }

/* ── PAGE HEADER ── */
.syn-page-header     { display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; background:var(--o2-card-background); }
.syn-hdr-actions     { display:flex; align-items:center; gap:10px; }
.syn-page-title-wrap { display:flex; align-items:center; gap:12px; }
.syn-page-icon       { width:36px; height:36px; border-radius:9px; background:rgba(0,0,0,.07); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
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

.syn-page-icon { color: var(--o2-primary-color); }

.mono { font-family:monospace; font-size:13px; font-weight:600; }
.c-g  { color:#16a34a; } .c-a { color:#d97706; } .c-r { color:#dc2626; }

/* ── DRAWER ── */
.drw-slabel { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--o2-tab-text-color); margin-bottom:12px; }
.drw-footer { display:flex; align-items:center; justify-content:space-between; padding:12px 22px; border-top:1px solid var(--o2-border-color); flex-shrink:0; }

.type-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.type-card { border:1.5px solid var(--o2-border-color); border-radius:10px; padding:14px; cursor:pointer; transition:border-color .12s,background .12s; }
.type-card:hover  { border-color:var(--o2-primary-color); }
.type-card--on    { border-color:var(--o2-primary-color); background:color-mix(in srgb,var(--o2-primary-color) 8%,transparent); }
.type-top  { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
.type-name { font-size:13px; font-weight:700; margin-bottom:3px; }
.type-desc { font-size:11px; color:var(--o2-tab-text-color); line-height:1.4; }

.fstack { display:flex; flex-direction:column; gap:12px; }
.loc-section-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--o2-tab-text-color); margin-bottom:8px; }
.loc-list   { display:flex; flex-direction:column; gap:6px; }
.loc-item   { display:flex; align-items:center; gap:12px; padding:10px 14px; border:1.5px solid var(--o2-border-color); border-radius:8px; cursor:pointer; transition:border-color .12s,background .12s; }
.loc-item:hover { border-color:var(--o2-primary-color); }
.loc-item--on   { border-color:var(--o2-primary-color); background:color-mix(in srgb,var(--o2-primary-color) 6%,transparent); }
.loc-flag { font-size:18px; line-height:1; }

/* ── GEO CHECKS ── */

/* Anomaly strip */
.geo-anomaly-strip { display:flex; flex-direction:column; gap:4px; padding:8px 16px 0; flex-shrink:0; }
.geo-anomaly-item  { display:flex; align-items:center; gap:8px; border-radius:7px; padding:6px 10px; font-size:12px; }
.geo-anomaly--error { background:rgba(239,68,68,.10); color:#dc2626; }
.geo-anomaly--warn  { background:rgba(245,158,11,.10); color:#d97706; }
.body--dark .geo-anomaly--error { color:#f87171; }
.body--dark .geo-anomaly--warn  { color:#fbbf24; }
.geo-anomaly-msg  { flex:1; }
.geo-anomaly-icon { flex-shrink:0; }
.geo-anomaly-x    { background:none; border:none; cursor:pointer; padding:2px; opacity:.6; color:inherit; display:flex; border-radius:4px; }
.geo-anomaly-x:hover { opacity:1; }

/* Upper: map + right panel */
.geo-upper    { display:flex; gap:12px; padding:8px 16px 0; flex-shrink:0; height:220px; }
.geo-map-wrap { flex:1; min-width:0; border:1px solid var(--o2-border-color); border-radius:10px; overflow:hidden; background:var(--o2-card-background); position:relative; }
.geo-world-map { width:100%; height:100%; display:block; }

/* Filter bar geo buttons */
.geo-hdr-btn--alert { border-color:rgba(239,68,68,.4); color:#dc2626; }
.body--dark .geo-hdr-btn--alert { color:#f87171; border-color:rgba(239,68,68,.35); }
.geo-hdr-badge { display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; border-radius:9px; background:#ef4444; color:#fff; font-size:10px; font-weight:700; padding:0 4px; margin-left:2px; }

/* "View Full Heatmap" button overlay — no longer used, kept for safety */
.geo-fullmap-btn { display:none; }

/* ECharts map container */
.geo-echarts-map { width:100%; height:100%; }

/* Right panel */
.geo-right-panel { width:256px; flex-shrink:0; border:1px solid var(--o2-border-color); border-radius:10px; background:var(--o2-card-background); display:flex; flex-direction:column; overflow:hidden; }
.geo-panel-header { display:flex; align-items:center; gap:6px; padding:9px 12px 8px; font-size:12px; font-weight:600; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; }
.geo-panel-placeholder { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:16px; }

/* Bar chart */
.geo-bar-subtitle { font-size:10px; color:var(--o2-tab-text-color); padding:6px 12px 2px; text-transform:uppercase; letter-spacing:.04em; flex-shrink:0; }
.geo-bars  { flex:1; overflow-y:auto; padding:4px 12px 8px; display:flex; flex-direction:column; gap:7px; }
.geo-bar-row { display:flex; align-items:center; gap:6px; }
.geo-bar-loc { font-size:10px; width:60px; flex-shrink:0; white-space:nowrap; }
.geo-bar-track { flex:1; height:7px; background:rgba(128,128,128,0.12); border-radius:4px; overflow:hidden; }
.geo-bar-fill { height:100%; border-radius:4px; transition:width .35s ease; }
.geo-fill-g { background:#22c55e; }
.geo-fill-a { background:#f59e0b; }
.geo-fill-r { background:#ef4444; }
.geo-bar-val { font-size:11px; font-family:monospace; font-weight:600; width:54px; text-align:right; flex-shrink:0; }

/* Color helpers */
.c-g { color:#15803d; } .body--dark .c-g { color:#4ade80; }
.c-a { color:#d97706; } .body--dark .c-a { color:#fbbf24; }
.c-r { color:#dc2626; } .body--dark .c-r { color:#f87171; }

/* Compare panel */
.geo-compare-summary { display:flex; align-items:stretch; padding:8px 12px 6px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; }
.geo-compare-col  { flex:1; text-align:center; }
.geo-compare-loc  { font-size:10px; color:var(--o2-tab-text-color); margin-bottom:2px; }
.geo-compare-pct  { font-size:20px; font-weight:800; line-height:1; }
.geo-compare-sub  { font-size:9px; color:var(--o2-tab-text-color); margin-top:2px; }
.geo-compare-sep  { width:1px; background:var(--o2-border-color); margin:0 8px; }
.geo-compare-rows { flex:1; overflow-y:auto; padding:4px 12px 8px; display:flex; flex-direction:column; gap:3px; }
.geo-compare-row  { display:flex; align-items:center; gap:5px; font-size:11px; padding:3px 0; border-bottom:1px solid rgba(128,128,128,.07); }
.geo-compare-mon  { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--o2-tab-text-color); }
.geo-compare-val  { font-family:monospace; font-weight:600; font-size:11px; }

/* Matrix table */
.geo-matrix { min-width:900px; }
.geo-th--monitor { width:220px; }
.geo-th { text-align:center; transition:background .12s; }
.geo-th-flag { font-size:14px; }
.geo-th--compare { background:rgba(25,118,210,.08) !important; }
.body--dark .geo-th--compare { background:rgba(99,179,237,.1) !important; }
.geo-th-badge { display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; border-radius:50%; background:var(--o2-primary-color); color:#fff; font-size:9px; font-weight:700; margin-left:4px; vertical-align:middle; }

.geo-mon-name { font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px; }
.geo-mon-url  { font-size:11px; color:var(--o2-tab-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px; margin-top:2px; }

.geo-row:hover .syn-td { background:rgba(128,128,128,.04); }
.geo-row--active .syn-td { background:rgba(25,118,210,.05) !important; }
.body--dark .geo-row--active .syn-td { background:rgba(99,179,237,.07) !important; }

.geo-cell { transition:background .12s; }
.geo-cell--up   { background:rgba(34,197,94,.06); }
.geo-cell--down { background:rgba(239,68,68,.08); }
.geo-cell--deg  { background:rgba(245,158,11,.08); }
.geo-cell > * { display:inline-flex; align-items:center; gap:5px; }

.geo-cell-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
.geo-cdot--up   { background:#22c55e; box-shadow:0 0 4px rgba(34,197,94,.6); }
.geo-cdot--down { background:#ef4444; box-shadow:0 0 4px rgba(239,68,68,.6); }
.geo-cdot--deg  { background:#f59e0b; box-shadow:0 0 4px rgba(245,158,11,.6); }
.geo-cell-ms  { font-size:12px; font-family:monospace; font-weight:600; }
.geo-cell--up   .geo-cell-ms { color:#15803d; }
.geo-cell--down .geo-cell-ms { color:#dc2626; }
.geo-cell--deg  .geo-cell-ms { color:#d97706; }
.body--dark .geo-cell--up   .geo-cell-ms { color:#4ade80; }
.body--dark .geo-cell--down .geo-cell-ms { color:#f87171; }
.body--dark .geo-cell--deg  .geo-cell-ms { color:#fbbf24; }
.geo-cell-dash { font-size:14px; color:rgba(128,128,128,.35); }

/* Map dot floating tooltip */
.map-dot-tip { position:fixed; z-index:9999; padding:10px 12px; background:#1e293b; color:#f1f5f9; border-radius:9px; font-size:12px; min-width:170px; pointer-events:auto; box-shadow:0 8px 24px rgba(0,0,0,.35); }
.map-tip-row { display:flex; justify-content:space-between; gap:16px; margin-top:4px; font-size:11px; }
.map-tip-val { font-weight:600; }

/* ── MODALS ── */
.geo-modal-legend { display:flex; align-items:center; gap:12px; margin-left:8px; flex:1; }
.geo-leg-item { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--o2-tab-text-color); }
.geo-leg-dot { display:inline-block; width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.geo-leg-dot--up  { background: #22c55e; }
.geo-leg-dot--deg { background: #f59e0b; }
.geo-leg-dot--dn  { background: #ef4444; }
.geo-modal-body { flex:none; height:clamp(360px,46vw,540px); overflow:hidden; padding:0; }
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


/* ── ICON COLOR HELPERS ── */
.type-icon--on   { color:var(--o2-primary-color); }
.type-icon--off  { color:rgba(128,128,128,.7); }
.type-check      { color:var(--o2-primary-color); flex-shrink:0; }
</style>
