<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — Compliance posture. Mock data. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { COMPLIANCE } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Compliance</h1>
      <span class="sub">Control posture mapped to detections & queries</span>
      <span class="spacer" />
      <span class="btn"><q-icon name="download" size="15px" />Export report</span>
    </div>

    <div class="kpis k4">
      <div class="kpi"><div class="label">Frameworks</div><div class="val num">6</div><div class="delta flat">monitored</div></div>
      <div class="kpi"><div class="label">Avg posture</div><div class="val num">80%</div><div class="delta down">▲ 3%</div></div>
      <div class="kpi"><div class="label">Failing controls</div><div class="val num">631</div><div class="delta up">across frameworks</div></div>
      <div class="kpi"><div class="label">Evidence collected</div><div class="val num">100%</div><div class="delta flat">automated</div></div>
    </div>

    <div class="grid-cards">
      <div class="card pad" v-for="c in COMPLIANCE" :key="c.framework">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="name" style="font-size:14px">{{ c.framework }}</div>
          <div class="risk-b" :style="{ color: c.color }">{{ c.score }}%</div>
        </div>
        <div class="meter" style="margin-bottom:12px">
          <div class="track"><i :style="{ width: c.score + '%', background: c.color }" /></div>
        </div>
        <div style="display:flex;gap:16px;font-size:12px">
          <span><span class="status pass">{{ c.pass }}</span> <span class="muted">passing</span></span>
          <span><span class="status fail">{{ c.failing }}</span> <span class="muted">failing</span></span>
          <span class="muted" style="margin-left:auto">{{ c.total }} controls</span>
        </div>
      </div>
    </div>
  </div>
</template>
