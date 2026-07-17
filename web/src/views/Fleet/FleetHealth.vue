<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Fleet Management — Health: connectivity, data lag, error rates, alerting. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./fleet.scss";
import { HEALTH_METRICS, RECENT_EVENTS, fmtEps, fmtBytes } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");

const REGION_HEALTH = [
  { region: "us-east-1", total: 421, ok: 406, warn: 10, err: 5, eps: 1_840_000, lag: "0.2s" },
  { region: "us-west-2", total: 186, ok: 180, warn: 4, err: 2, eps: 640_000, lag: "0.3s" },
  { region: "europe-west1", total: 312, ok: 298, warn: 11, err: 3, eps: 980_000, lag: "0.4s" },
  { region: "eastus (Azure)", total: 144, ok: 133, warn: 9, err: 2, eps: 410_000, lag: "0.5s" },
  { region: "ap-southeast-1", total: 221, ok: 184, warn: 14, err: 23, eps: 330_000, lag: "1.1s" },
];

const ALERT_RULES = [
  { name: "Agent Offline > 5 min", severity: "err", firing: 35, description: "Agent last heartbeat > 5 minutes" },
  { name: "CPU > 70% for 10 min", severity: "warn", firing: 8, description: "Agent CPU sustained above 70%" },
  { name: "Events/sec dropped > 50%", severity: "err", firing: 3, description: "EPS delta > -50% vs 5m avg" },
  { name: "Config push failure", severity: "warn", firing: 2, description: "Template push returned non-200" },
  { name: "Version lag > 3 releases", severity: "warn", firing: 47, description: "Agent version more than 3 minor behind latest" },
];

const bars24h = Array.from({ length: 48 }, (_, i) => {
  const base = 90 + Math.sin(i * 0.4) * 6;
  const spike = (i === 14 || i === 38) ? -15 : 0;
  return Math.max(0, Math.round(base + spike));
});
</script>

<template>
  <div class="o2fleet" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Fleet Health</h1>
      <span class="badge">93.5% healthy</span>
      <span class="sub">Connectivity, data lag and error rates</span>
      <span class="spacer" />
      <button class="btn primary"><q-icon name="notifications" size="15px" />Manage Alerts</button>
    </div>

    <!-- Health KPIs -->
    <div class="kpis" style="margin-bottom:16px">
      <div class="kpi" v-for="h in HEALTH_METRICS" :key="h.label">
        <div class="label"><span class="dot" :style="{ background: h.color }" />{{ h.label }}</div>
        <div class="val num" :style="{ color: h.color }">{{ h.pct }}%</div>
        <div class="delta">{{ h.ok.toLocaleString() }} / {{ h.total.toLocaleString() }} agents</div>
      </div>
    </div>

    <!-- Row 1 -->
    <div class="grid-2" style="margin-bottom:12px">
      <!-- Availability sparkline -->
      <div class="card">
        <header>
          <h3>Fleet Availability — 30 min buckets</h3>
          <span class="muted" style="margin-left:auto">Last 24h</span>
        </header>
        <div style="padding:16px">
          <div style="display:flex;align-items:flex-end;gap:1px;height:60px">
            <div
              v-for="(v, i) in bars24h"
              :key="i"
              style="flex:1;border-radius:2px 2px 0 0;transition:height 0.3s"
              :style="{
                height: v + '%',
                background: v < 85 ? 'var(--err)' : v < 93 ? 'var(--warn)' : 'var(--ok)'
              }"
            />
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-3);margin-top:6px">
            <span>24h ago</span><span>18h</span><span>12h</span><span>6h</span><span>now</span>
          </div>
        </div>
      </div>

      <!-- Alert rules -->
      <div class="card">
        <header><h3>Active Alert Rules</h3><span class="muted">{{ ALERT_RULES.reduce((s, r) => s + r.firing, 0) }} firing</span></header>
        <div class="tablewrap">
          <table class="tbl">
            <thead><tr><th>Rule</th><th>Severity</th><th>Firing</th></tr></thead>
            <tbody>
              <tr v-for="r in ALERT_RULES" :key="r.name">
                <td>
                  <div class="name" style="font-size:12.5px">{{ r.name }}</div>
                  <div class="sub">{{ r.description }}</div>
                </td>
                <td>
                  <span
                    class="ver"
                    :class="r.severity === 'err' ? 'outdated' : ''"
                    :style="r.severity === 'warn' ? { color: 'var(--warn)', background: 'var(--warn-bg)' } : {}"
                  >{{ r.severity === 'err' ? 'Critical' : 'Warning' }}</span>
                </td>
                <td><b :style="{ color: r.firing > 20 ? 'var(--err)' : r.firing > 5 ? 'var(--warn)' : 'var(--ok)' }">{{ r.firing }}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Row 2 -->
    <div class="grid-2-1">
      <!-- Per-region health table -->
      <div class="card">
        <header><h3>Health by Region</h3></header>
        <div class="tablewrap">
          <table class="tbl">
            <thead><tr><th>Region</th><th>Agents</th><th>Active</th><th>Warn</th><th>Error</th><th>Events/sec</th><th>Avg Lag</th><th>Health</th></tr></thead>
            <tbody>
              <tr v-for="r in REGION_HEALTH" :key="r.region">
                <td class="name">{{ r.region }}</td>
                <td class="mono">{{ r.total }}</td>
                <td><span style="color:var(--ok);font-weight:650">{{ r.ok }}</span></td>
                <td><span :style="{ color: r.warn ? 'var(--warn)' : 'var(--text-3)', fontWeight: r.warn ? 650 : 400 }">{{ r.warn }}</span></td>
                <td><span :style="{ color: r.err ? 'var(--err)' : 'var(--text-3)', fontWeight: r.err ? 650 : 400 }">{{ r.err }}</span></td>
                <td class="mono">{{ fmtEps(r.eps) }}</td>
                <td class="mono" :style="{ color: parseFloat(r.lag) > 0.8 ? 'var(--warn)' : 'var(--text)' }">{{ r.lag }}</td>
                <td>
                  <div style="min-width:70px">
                    <div style="font-size:11.5px;text-align:right;margin-bottom:2px">{{ Math.round(r.ok / r.total * 100) }}%</div>
                    <div class="bar"><i :style="{ width: (r.ok / r.total * 100) + '%', background: r.err > 10 ? 'var(--err)' : r.warn > 10 ? 'var(--warn)' : 'var(--ok)' }" /></div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Recent events -->
      <div class="card">
        <header><h3>Recent Events</h3><span class="link" style="margin-left:auto">All →</span></header>
        <div class="ev-list">
          <div v-for="(ev, i) in RECENT_EVENTS" :key="i" class="ev-row">
            <span class="ev-dot" :class="ev.kind" />
            <span class="ev-time">{{ ev.time }}</span>
            <div>
              <div class="ev-msg">{{ ev.msg }}</div>
              <div class="ev-agent">{{ ev.agent }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
