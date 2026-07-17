<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — SOC Overview. Mock data via ./mockData. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import {
  KPIS,
  DETECTIONS,
  ENTITIES,
  HEAT_TACTICS,
  sevLabel,
  cellCov,
  kindIcon,
} from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");
const orgName = computed(
  () => store.state.selectedOrganization?.identifier || "default",
);
const recent = DETECTIONS.slice(0, 7);
const topEnt = ENTITIES.slice(0, 4);
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Security Overview</h1>
      <span class="badge">SOC</span>
      <span class="sub">Last 24 hours · {{ orgName }}</span>
      <span class="spacer" />
      <span class="pill"><q-icon name="schedule" size="14px" /> Last 24h</span>
    </div>

    <div class="kpis">
      <div class="kpi" v-for="k in KPIS" :key="k.label">
        <div class="label">
          <span class="dot" :style="{ background: k.color }" />{{ k.label }}
        </div>
        <div class="val num">{{ k.val }}</div>
        <div class="delta" :class="k.trend">{{ k.delta }}</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <header>
          <h3>Recent detections</h3>
          <span class="link">Open triage queue →</span>
        </header>
        <div class="tablewrap">
          <table class="tbl">
            <thead>
              <tr><th>Detection</th><th>Severity</th><th>Source</th><th>Seen</th></tr>
            </thead>
            <tbody>
              <tr v-for="d in recent" :key="d.id">
                <td>
                  <div class="name">{{ d.name }}</div>
                  <div class="tag-tech">{{ d.tech }} · {{ d.techName }}</div>
                </td>
                <td><span class="sev" :class="d.sev">{{ sevLabel(d.sev) }}</span></td>
                <td class="mono">{{ d.source }}</td>
                <td class="mono">{{ d.fired }} ago</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="cols">
        <div class="card">
          <header><h3>Alert volume by severity</h3><span class="muted">24h</span></header>
          <div style="padding: 12px 14px">
            <div v-for="b in [
              { l: 'Critical', v: 7, m: 24, c: 'var(--sev-crit)' },
              { l: 'High', v: 16, m: 24, c: 'var(--sev-high)' },
              { l: 'Medium', v: 21, m: 24, c: 'var(--sev-med)' },
              { l: 'Low', v: 9, m: 24, c: 'var(--sev-low)' },
            ]" :key="b.l" style="margin-bottom: 12px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                <span class="muted">{{ b.l }}</span><b class="num">{{ b.v }}</b>
              </div>
              <div class="bar"><i :style="{ width: (b.v / b.m * 100) + '%', background: b.c }" /></div>
            </div>
          </div>
        </div>

        <div class="card">
          <header><h3>Top risky entities</h3><span class="link">All →</span></header>
          <div class="ent" v-for="e in topEnt" :key="e.name">
            <div class="ico"><q-icon :name="kindIcon(e.kind)" size="17px" /></div>
            <div>
              <div class="n">{{ e.name }}</div>
              <div class="m">{{ e.det }} detections · {{ e.meta }}</div>
            </div>
            <div class="right">
              <div class="risk-b">{{ e.risk }}</div>
              <div class="bar" style="width:70px;margin-top:4px"><i :style="{ width: e.risk + '%', background: e.color }" /></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card heat" style="margin-top:12px">
      <header>
        <h3>MITRE ATT&CK — detections mapped to techniques</h3>
        <span class="link">Full matrix →</span>
      </header>
      <div class="tactics">
        <div class="tactic" v-for="t in HEAT_TACTICS" :key="t.name">
          <h5 :title="t.name">{{ t.name }}</h5>
          <div class="cells">
            <div v-for="(c, i) in t.cells" :key="i" class="cell" :class="cellCov(c)" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
