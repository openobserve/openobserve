<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Fleet Management — Command Center Overview. Mock data via ./mockData. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./fleet.scss";
import {
  KPIS, AGENT_TYPES_DIST, AGENTS, RECENT_EVENTS, HEALTH_METRICS,
  fmtBytes, fmtEps,
} from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");

const STATUS_COLORS: Record<string, string> = {
  ok: "var(--ok)", warn: "var(--warn)", err: "var(--err)", off: "var(--text-3)",
};
const STATUS_LABEL: Record<string, string> = {
  ok: "Active", warn: "Degraded", err: "Error", off: "Offline",
};
const TYPE_LABEL: Record<string, string> = {
  otel: "OTel Collector", vector: "Vector", fluent: "Fluent Bit",
  prom: "Prometheus", beat: "Elastic Beat", custom: "Custom",
};

const recentAgents = AGENTS.slice(0, 8);
const sparkBars = Array.from({ length: 28 }, (_, i) => {
  const v = 40 + Math.sin(i * 0.6) * 20 + (i % 4 === 0 ? 15 : 0);
  return { h: Math.round(v), hi: i >= 22 };
});
</script>

<template>
  <div class="o2fleet" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Fleet Overview</h1>
      <span class="badge">Enterprise</span>
      <span class="sub">All environments · real-time</span>
      <span class="spacer" />
      <button class="btn">
        <q-icon name="add" size="15px" /> Register Agent
      </button>
      <button class="btn primary">
        <q-icon name="push_pin" size="15px" /> Push Config
      </button>
    </div>

    <!-- KPI cards -->
    <div class="kpis">
      <div class="kpi" v-for="k in KPIS" :key="k.label">
        <div class="label">
          <span class="dot" :style="{ background: k.dot }" />{{ k.label }}
        </div>
        <div class="val num">{{ k.val }}</div>
        <div class="delta" :class="k.trend">{{ k.delta }}</div>
      </div>
    </div>

    <!-- Main grid row 1 -->
    <div class="grid-2-1" style="margin-bottom:12px">
      <!-- Agent fleet table -->
      <div class="card">
        <header>
          <h3>Agent Fleet</h3>
          <span class="spacer" />
          <span class="muted">1,284 total</span>
          <span class="link" style="margin-left:14px">View all →</span>
        </header>
        <div class="tablewrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Type</th>
                <th>Status</th>
                <th>EPS</th>
                <th>Throughput</th>
                <th>CPU</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in recentAgents" :key="a.id">
                <td>
                  <div class="name">{{ a.name }}</div>
                  <div class="sub mono">{{ a.region }} · {{ a.env }}</div>
                </td>
                <td>
                  <span class="agent-chip" :class="a.type">{{ TYPE_LABEL[a.type] }}</span>
                </td>
                <td>
                  <div style="display:flex;align-items:center;gap:7px">
                    <span class="status-ring" :class="a.status" />
                    <span :style="{ color: STATUS_COLORS[a.status], fontWeight: 600, fontSize: '12px' }">
                      {{ STATUS_LABEL[a.status] }}
                    </span>
                  </div>
                </td>
                <td class="mono">{{ a.eps ? fmtEps(a.eps) : '—' }}</td>
                <td class="mono">{{ a.bytesPerSec ? fmtBytes(a.bytesPerSec) : '—' }}</td>
                <td>
                  <div v-if="a.cpuPct" style="display:flex;align-items:center;gap:6px;min-width:60px">
                    <div class="bar" style="flex:1">
                      <i :style="{
                        width: a.cpuPct + '%',
                        background: a.cpuPct > 45 ? 'var(--warn)' : 'var(--accent)'
                      }" />
                    </div>
                    <span style="font-size:11.5px;min-width:28px;text-align:right">{{ a.cpuPct }}%</span>
                  </div>
                  <span v-else class="muted">—</span>
                </td>
                <td class="mono" style="color:var(--text-3);white-space:nowrap">{{ a.lastSeen }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Right column: distribution + health -->
      <div class="cols">
        <!-- Agent type distribution -->
        <div class="card">
          <header>
            <h3>By Agent Type</h3>
            <span class="link">Agents →</span>
          </header>
          <div style="padding:12px 16px">
            <div v-for="t in AGENT_TYPES_DIST" :key="t.key" style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                <span style="display:flex;align-items:center;gap:6px">
                  <span class="agent-chip" :class="t.key" style="padding:1px 7px;font-size:11px">{{ t.label }}</span>
                </span>
                <b class="num" style="font-size:12.5px">{{ t.count.toLocaleString() }}</b>
              </div>
              <div class="bar">
                <i :style="{ width: t.pct + '%', background: 'var(--accent)' }" />
              </div>
            </div>
          </div>
        </div>

        <!-- Fleet health -->
        <div class="card">
          <header><h3>Fleet Health</h3><span class="muted">Live</span></header>
          <div>
            <div v-for="h in HEALTH_METRICS" :key="h.label" class="health-row">
              <div class="health-label">{{ h.label }}</div>
              <div class="health-bar">
                <div class="bar">
                  <i :style="{ width: h.pct + '%', background: h.color }" />
                </div>
              </div>
              <div class="health-val" :style="{ color: h.color }">{{ h.pct }}%</div>
              <div class="muted" style="font-size:11.5px;min-width:80px;text-align:right">
                {{ h.ok.toLocaleString() }} / {{ h.total.toLocaleString() }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Row 2: throughput sparkline + events -->
    <div class="grid-2" style="margin-bottom:0">
      <!-- Events/sec sparkline -->
      <div class="card">
        <header>
          <h3>Data Throughput — Events/sec</h3>
          <span class="muted" style="margin-left:auto">Last 24h</span>
        </header>
        <div style="padding:16px 16px 12px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <span style="font-size:28px;font-weight:700;letter-spacing:-1.5px;color:var(--text)">4.21M</span>
            <span style="font-size:12px;color:var(--ok);font-weight:650">↑ +12.4% vs yesterday</span>
          </div>
          <div class="spark" style="height:48px;gap:3px">
            <div
              v-for="(b, i) in sparkBars"
              :key="i"
              class="spark-b"
              :class="{ hi: b.hi }"
              :style="{ height: b.h + '%', flex: '1', borderRadius: '3px 3px 0 0' }"
            />
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-3);margin-top:6px">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>now</span>
          </div>
        </div>
      </div>

      <!-- Recent events log -->
      <div class="card">
        <header>
          <h3>Recent Fleet Events</h3>
          <span class="link" style="margin-left:auto">All events →</span>
        </header>
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
