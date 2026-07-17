<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — Detections rule catalog. Mock data. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { DETECTIONS, sevLabel } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");
const typeChip = (t: string) =>
  ({ scheduled: "Scheduled", streaming: "Streaming", correlation: "Correlation" } as any)[t] || t;
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Detections</h1>
      <span class="sub">Sigma & custom rules mapped to MITRE ATT&CK</span>
      <span class="spacer" />
      <span class="btn"><q-icon name="science" size="15px" />Backtest</span>
      <span class="btn primary"><q-icon name="add" size="15px" />New detection</span>
    </div>

    <div class="kpis k4">
      <div class="kpi"><div class="label">Enabled rules</div><div class="val num">312</div><div class="delta flat">of 1,240</div></div>
      <div class="kpi"><div class="label">Fired (24h)</div><div class="val num">1,880</div><div class="delta up">▲ 12%</div></div>
      <div class="kpi"><div class="label">Streaming</div><div class="val num">96</div><div class="delta flat">low-latency</div></div>
      <div class="kpi"><div class="label">Avg FP rate</div><div class="val num">4.1%</div><div class="delta down">▼ tuned</div></div>
    </div>

    <div class="toolbar">
      <span class="search-box"><q-icon name="search" size="15px" />Search rules…</span>
      <div class="seg"><span class="on">All</span><span>Enabled</span><span>Disabled</span><span>High-noise</span></div>
    </div>

    <div class="card">
      <div class="tablewrap">
        <table class="tbl">
          <thead>
            <tr><th>Detection</th><th>Technique</th><th>Severity</th><th>Type</th><th>Source</th><th>Last fired</th><th>Hits 24h</th><th>FP</th><th>Enabled</th></tr>
          </thead>
          <tbody>
            <tr v-for="d in DETECTIONS" :key="d.id">
              <td>
                <div class="name">{{ d.name }}</div>
                <div class="submono">{{ d.id }} · {{ d.tactic }}</div>
              </td>
              <td><span class="chip accent">{{ d.tech }}</span><div class="tag-tech" style="margin-top:2px">{{ d.techName }}</div></td>
              <td><span class="sev" :class="d.sev">{{ sevLabel(d.sev) }}</span></td>
              <td><span class="chip">{{ typeChip(d.type) }}</span></td>
              <td class="mono">{{ d.source }}</td>
              <td class="mono">{{ d.fired === '—' ? '—' : d.fired + ' ago' }}</td>
              <td class="num">{{ d.hits }}</td>
              <td><span class="status" :class="d.fp === 'low' ? 'closed' : d.fp === 'medium' ? 'triage' : 'new'">{{ d.fp }}</span></td>
              <td><div class="toggle" :class="{ on: d.enabled }"><i /></div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
