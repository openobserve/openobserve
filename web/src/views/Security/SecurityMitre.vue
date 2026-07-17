<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — MITRE ATT&CK coverage matrix. Mock data. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { MITRE_MATRIX, cellCov } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>MITRE ATT&CK</h1>
      <span class="sub">Detection coverage across tactics & techniques</span>
      <span class="spacer" />
      <span class="pill"><q-icon name="square" size="12px" style="color:var(--sev-crit)" />Strong</span>
      <span class="pill"><q-icon name="square" size="12px" style="color:var(--sev-med)" />Partial</span>
      <span class="pill"><q-icon name="square" size="12px" style="color:var(--text-3)" />Gap</span>
    </div>

    <div class="kpis k4">
      <div class="kpi"><div class="label">Technique coverage</div><div class="val num">63%</div><div class="delta down">▲ 4% this week</div></div>
      <div class="kpi"><div class="label">Techniques covered</div><div class="val num">201</div><div class="delta flat">of 318</div></div>
      <div class="kpi"><div class="label">Detections mapped</div><div class="val num">312</div><div class="delta flat">rules</div></div>
      <div class="kpi"><div class="label">Coverage gaps</div><div class="val num">3</div><div class="delta up">no detections</div></div>
    </div>

    <div class="card pad">
      <div class="mitre-matrix">
        <div class="tactic-col" v-for="col in MITRE_MATRIX" :key="col.tactic">
          <h5 :title="col.tactic">{{ col.tactic }}</h5>
          <div
            class="tech-cell"
            :class="cellCov(t.cov)"
            v-for="t in col.techniques"
            :key="t.id"
            :title="`${t.id} ${t.name} — ${t.det} detections`"
          >
            <div>{{ t.name }}</div>
            <div class="t">{{ t.id }} · {{ t.det }} det</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
