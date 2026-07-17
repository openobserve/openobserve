<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — UEBA (User & Entity Behavior Analytics). Mock data. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import {
  UEBA_KPIS,
  UEBA_USERS,
  UEBA_ANOMALIES,
  UEBA_PEER,
  sevLabel,
} from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");

// tiny sparkline: map a number[] to an SVG polyline in a 64x20 box
const spark = (vals: number[]) => {
  const w = 64;
  const h = 20;
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals);
  const span = max - min || 1;
  return vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - 2 - ((v - min) / span) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>UEBA</h1>
      <span class="badge accent">Behavior Analytics</span>
      <span class="sub">Peer-relative baselines · RCF anomaly models per entity</span>
      <span class="spacer" />
      <span class="pill"><q-icon name="schedule" size="14px" />14-day baseline</span>
    </div>

    <div class="kpis">
      <div class="kpi" v-for="k in UEBA_KPIS" :key="k.label">
        <div class="label"><span class="dot" :style="{ background: k.color }" />{{ k.label }}</div>
        <div class="val num">{{ k.val }}</div>
        <div class="delta" :class="k.trend">{{ k.delta }}</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <header>
          <h3>Highest behavioral risk</h3>
          <span class="link">All entities →</span>
        </header>
        <div class="tablewrap">
          <table class="tbl">
            <thead>
              <tr><th>User</th><th>Risk</th><th>Trend</th><th>Peer group</th><th>Deviation</th><th>Top behavioral factor</th></tr>
            </thead>
            <tbody>
              <tr v-for="u in UEBA_USERS" :key="u.user">
                <td>
                  <div class="name">{{ u.user }}</div>
                  <div class="submono">{{ u.dept }}</div>
                </td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <b class="num" :style="{ color: u.risk >= 80 ? 'var(--sev-crit)' : u.risk >= 60 ? 'var(--sev-high)' : 'var(--sev-med)' }">{{ u.risk }}</b>
                    <div class="bar" style="width:44px"><i :style="{ width: u.risk + '%', background: u.risk >= 80 ? 'var(--sev-crit)' : u.risk >= 60 ? 'var(--sev-high)' : 'var(--sev-med)' }" /></div>
                  </div>
                </td>
                <td>
                  <svg width="64" height="20" style="display:block">
                    <polyline :points="spark(u.trend)" fill="none" stroke="var(--accent)" stroke-width="1.6" />
                  </svg>
                </td>
                <td><span class="chip">{{ u.peer }}</span></td>
                <td><span class="chip accent">{{ u.dev }}</span></td>
                <td class="muted" style="max-width:260px">{{ u.factor }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <header><h3>Anomaly types (24h)</h3><span class="link">Tune →</span></header>
        <div class="ent" v-for="a in UEBA_ANOMALIES" :key="a.type">
          <div class="ico"><q-icon :name="a.icon" size="16px" /></div>
          <div>
            <div class="n">{{ a.type }}</div>
            <div class="m"><span class="sev" :class="a.sev" style="padding:1px 6px">{{ sevLabel(a.sev) }}</span></div>
          </div>
          <div class="right"><b class="num" style="font-size:16px">{{ a.count }}</b></div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:12px">
      <header>
        <h3>Peer-group deviations</h3>
        <span class="link">How baselines work →</span>
      </header>
      <div class="tablewrap">
        <table class="tbl">
          <thead>
            <tr><th>User</th><th>Metric</th><th>User value</th><th>Peer median</th><th>Deviation</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="p in UEBA_PEER" :key="p.user + p.metric">
              <td class="mono">{{ p.user }}</td>
              <td>{{ p.metric }}</td>
              <td class="num name">{{ p.user_val }}</td>
              <td class="num muted">{{ p.peer_med }}</td>
              <td><span class="sev crit" style="padding:1px 7px">{{ p.factor }}</span></td>
              <td><span class="link" style="color:var(--accent);cursor:pointer">Investigate →</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
