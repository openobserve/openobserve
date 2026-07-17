<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Fleet Management — Collector Groups: managed fleets with auto-scale, HA config. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import "./fleet.scss";
import { fmtBytes, fmtEps } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");

interface CollectorGroup {
  id: string;
  name: string;
  type: "otel" | "vector" | "fluent" | "prom";
  region: string;
  env: string;
  replicas: number;
  maxReplicas: number;
  eps: number;
  bytesPerSec: number;
  cpuAvg: number;
  status: "ok" | "warn" | "err";
  ha: boolean;
  autoScale: boolean;
  namespace: string;
  chart: string;
  chartVer: string;
  lastDeploy: string;
}

const GROUPS: CollectorGroup[] = [
  { id: "cg1", name: "otel-prod-us-east", type: "otel", region: "us-east-1", env: "prod", replicas: 8, maxReplicas: 20, eps: 412000, bytesPerSec: 38_200_000, cpuAvg: 28, status: "ok", ha: true, autoScale: true, namespace: "observability", chart: "opentelemetry-collector", chartVer: "0.121.0", lastDeploy: "2h ago" },
  { id: "cg2", name: "otel-prod-eu-west", type: "otel", region: "europe-west1", env: "prod", replicas: 5, maxReplicas: 12, eps: 210000, bytesPerSec: 19_400_000, cpuAvg: 31, status: "ok", ha: true, autoScale: true, namespace: "observability", chart: "opentelemetry-collector", chartVer: "0.121.0", lastDeploy: "2h ago" },
  { id: "cg3", name: "vector-staging-us", type: "vector", region: "us-west-2", env: "staging", replicas: 2, maxReplicas: 6, eps: 28000, bytesPerSec: 2_400_000, cpuAvg: 18, status: "ok", ha: false, autoScale: false, namespace: "observability", chart: "vector", chartVer: "0.43.1", lastDeploy: "1d ago" },
  { id: "cg4", name: "fluent-prod-k8s-global", type: "fluent", region: "multi", env: "prod", replicas: 104, maxReplicas: 200, eps: 128000, bytesPerSec: 11_200_000, cpuAvg: 17, status: "ok", ha: true, autoScale: true, namespace: "logging", chart: "fluent-bit", chartVer: "3.3.4", lastDeploy: "5d ago" },
  { id: "cg5", name: "prom-infra-scrape", type: "prom", region: "us-east-1", env: "prod", replicas: 3, maxReplicas: 6, eps: 0, bytesPerSec: 4_100_000, cpuAvg: 42, status: "warn", ha: true, autoScale: false, namespace: "monitoring", chart: "prometheus", chartVer: "2.55.0", lastDeploy: "6d ago" },
];

const TYPE_LABEL: Record<string, string> = { otel: "OTel Collector", vector: "Vector", fluent: "Fluent Bit", prom: "Prometheus" };
const STATUS_COLORS: Record<string, string> = { ok: "var(--ok)", warn: "var(--warn)", err: "var(--err)" };
const STATUS_LABEL: Record<string, string> = { ok: "Healthy", warn: "Degraded", err: "Error" };

const selected = ref<CollectorGroup | null>(null);
</script>

<template>
  <div class="o2fleet" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Collector Groups</h1>
      <span class="badge">{{ GROUPS.length }} groups · {{ GROUPS.reduce((s, g) => s + g.replicas, 0) }} replicas</span>
      <span class="spacer" />
      <button class="btn"><q-icon name="upload" size="15px" />Deploy Helm Chart</button>
      <button class="btn primary"><q-icon name="add" size="15px" />New Group</button>
    </div>

    <div style="display:flex;gap:12px;align-items:flex-start">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">
        <div
          v-for="g in GROUPS"
          :key="g.id"
          class="card"
          style="cursor:pointer"
          :style="selected?.id === g.id ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-weak)' } : {}"
          @click="selected = selected?.id === g.id ? null : g"
        >
          <div style="padding:16px 18px;display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center">
            <!-- Left: name + type -->
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <span class="status-ring" :class="g.status" />
                <span style="font-weight:700;font-size:14px">{{ g.name }}</span>
                <span class="agent-chip" :class="g.type">{{ TYPE_LABEL[g.type] }}</span>
              </div>
              <div style="font-size:12px;color:var(--text-3)">
                {{ g.namespace }} · {{ g.region }} · {{ g.env }}
                <span v-if="g.ha" style="margin-left:8px;color:var(--ok);font-weight:650">HA</span>
                <span v-if="g.autoScale" style="margin-left:8px;color:var(--info);font-weight:650">AutoScale</span>
              </div>
            </div>

            <!-- Middle: metrics -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center">
              <div>
                <div style="font-size:11px;color:var(--text-3);margin-bottom:2px">Replicas</div>
                <div style="font-weight:700;font-size:15px">{{ g.replicas }} <span style="font-size:11px;color:var(--text-3);font-weight:400">/ {{ g.maxReplicas }}</span></div>
                <div class="bar" style="margin-top:4px"><i :style="{ width: (g.replicas / g.maxReplicas * 100) + '%', background: 'var(--accent)' }" /></div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-3);margin-bottom:2px">Events/sec</div>
                <div style="font-weight:700;font-size:15px">{{ g.eps ? fmtEps(g.eps) : '—' }}</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-3);margin-bottom:2px">Throughput</div>
                <div style="font-weight:700;font-size:15px">{{ fmtBytes(g.bytesPerSec) }}</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-3);margin-bottom:2px">CPU avg</div>
                <div :style="{ fontWeight: 700, fontSize: '15px', color: g.cpuAvg > 40 ? 'var(--warn)' : 'var(--text)' }">{{ g.cpuAvg }}%</div>
              </div>
            </div>

            <!-- Right: status + actions -->
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
              <span :style="{ color: STATUS_COLORS[g.status], fontWeight: 650, fontSize: '12.5px' }">{{ STATUS_LABEL[g.status] }}</span>
              <div style="font-size:11.5px;color:var(--text-3)">{{ g.chart }} v{{ g.chartVer }}</div>
              <div style="font-size:11px;color:var(--text-3)">Deployed {{ g.lastDeploy }}</div>
            </div>
          </div>

          <!-- Scale bar -->
          <div v-if="g.autoScale" style="margin:0 18px 14px;font-size:11px;color:var(--text-3)">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px">
              <span>Scaling utilization</span>
              <span>{{ Math.round(g.replicas / g.maxReplicas * 100) }}% of max</span>
            </div>
            <div class="bar" style="height:6px">
              <i :style="{ width: (g.replicas / g.maxReplicas * 100) + '%', background: 'var(--accent)' }" />
            </div>
          </div>
        </div>
      </div>

      <!-- Detail pane -->
      <Transition name="fleet-slide">
        <div v-if="selected" class="card" style="width:300px;flex-shrink:0;position:sticky;top:0">
          <header>
            <span class="status-ring" :class="selected.status" />
            <h3 style="flex:1;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ selected.name }}</h3>
            <button class="btn" style="height:24px;padding:0 8px;font-size:11px" @click="selected = null">✕</button>
          </header>
          <div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px;font-size:12.5px">
            <div style="display:flex;flex-direction:column;gap:7px">
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Type</span><span class="agent-chip" :class="selected.type">{{ TYPE_LABEL[selected.type] }}</span></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Helm Chart</span><span class="ver">{{ selected.chart }}</span></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Version</span><span class="ver latest">v{{ selected.chartVer }}</span></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Namespace</span><span class="mono">{{ selected.namespace }}</span></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Region</span><span>{{ selected.region }}</span></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">HA Mode</span><span :style="{ color: selected.ha ? 'var(--ok)' : 'var(--text-3)', fontWeight: 650 }">{{ selected.ha ? 'Enabled' : 'Disabled' }}</span></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Auto-Scale</span><span :style="{ color: selected.autoScale ? 'var(--info)' : 'var(--text-3)', fontWeight: 650 }">{{ selected.autoScale ? 'On' : 'Off' }}</span></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Last Deploy</span><span>{{ selected.lastDeploy }}</span></div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn" style="flex:1;justify-content:center">Scale</button>
              <button class="btn" style="flex:1;justify-content:center">Logs</button>
            </div>
            <button class="btn primary" style="width:100%;justify-content:center">Edit Config</button>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.fleet-slide-enter-active, .fleet-slide-leave-active { transition: all 0.2s ease; }
.fleet-slide-enter-from, .fleet-slide-leave-to { opacity: 0; transform: translateX(20px); }
</style>
