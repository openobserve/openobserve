<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — Alerts triage queue. Mock data. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { ALERTS, sevLabel, cap } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Alerts</h1>
      <span class="sub">Triage queue · findings from detections</span>
      <span class="spacer" />
      <span class="btn"><q-icon name="done_all" size="15px" />Bulk triage</span>
      <span class="btn primary"><q-icon name="folder" size="15px" />Add to case</span>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="label"><span class="dot" style="background:var(--sev-crit)" />New</div><div class="val num">7</div><div class="delta up">▲ 3</div></div>
      <div class="kpi"><div class="label"><span class="dot" style="background:var(--sev-med)" />In triage</div><div class="val num">14</div><div class="delta flat">2 analysts</div></div>
      <div class="kpi"><div class="label"><span class="dot" style="background:var(--sev-low)" />Open</div><div class="val num">23</div><div class="delta flat">unassigned</div></div>
      <div class="kpi"><div class="label"><span class="dot" style="background:var(--ok)" />Closed today</div><div class="val num">31</div><div class="delta down">▲ good</div></div>
      <div class="kpi"><div class="label"><span class="dot" style="background:var(--accent)" />MTTR</div><div class="val num">42m</div><div class="delta down">▼ 8m</div></div>
    </div>

    <div class="toolbar">
      <span class="search-box"><q-icon name="search" size="15px" />Filter by entity, rule, technique…</span>
      <div class="seg"><span class="on">All</span><span>New</span><span>Triage</span><span>Open</span><span>Closed</span></div>
    </div>

    <div class="card">
      <div class="tablewrap">
        <table class="tbl">
          <thead>
            <tr><th style="width:26px"></th><th>Time</th><th>Detection</th><th>Severity</th><th>Entity</th><th>Technique</th><th>Count</th><th>Assignee</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr v-for="(a, i) in ALERTS" :key="i">
              <td><div class="toggle" style="width:16px;height:16px"><i style="width:12px;height:12px" /></div></td>
              <td class="mono">{{ a.time }}</td>
              <td class="name">{{ a.rule }}</td>
              <td><span class="sev" :class="a.sev">{{ sevLabel(a.sev) }}</span></td>
              <td class="mono">{{ a.entity }}</td>
              <td><span class="chip accent">{{ a.tech }}</span></td>
              <td class="num">{{ a.count }}</td>
              <td class="mono">{{ a.assignee }}</td>
              <td><span class="status" :class="a.status">{{ cap(a.status) }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
