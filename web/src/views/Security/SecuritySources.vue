<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — Data Sources / collectors. Mock data. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { DATA_SOURCES, cap } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Data Sources</h1>
      <span class="sub">Collectors & integrations · normalized to OCSF</span>
      <span class="spacer" />
      <span class="btn primary"><q-icon name="add" size="15px" />Add data source</span>
    </div>

    <div class="kpis k4">
      <div class="kpi"><div class="label">Connected sources</div><div class="val num">9</div><div class="delta flat">8 healthy</div></div>
      <div class="kpi"><div class="label">Total EPS</div><div class="val num">48.2k</div><div class="delta flat">events/sec</div></div>
      <div class="kpi"><div class="label">OCSF mapped</div><div class="val num">89%</div><div class="delta down">8 of 9</div></div>
      <div class="kpi"><div class="label">Needs attention</div><div class="val num">1</div><div class="delta up">Palo Alto stale</div></div>
    </div>

    <div class="card">
      <div class="tablewrap">
        <table class="tbl">
          <thead>
            <tr><th>Source</th><th>Type</th><th>Events/sec</th><th>Last event</th><th>OCSF</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="s in DATA_SOURCES" :key="s.name">
              <td class="name">{{ s.name }}</td>
              <td><span class="chip">{{ s.type }}</span></td>
              <td class="num">{{ s.eps }}</td>
              <td class="mono">{{ s.last }}</td>
              <td>
                <span v-if="s.ocsf" class="status pass">mapped</span>
                <span v-else class="status fail">unmapped</span>
              </td>
              <td><span class="status" :class="s.status">{{ cap(s.status) }}</span></td>
              <td><span class="link" style="color:var(--accent);cursor:pointer">Configure →</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
