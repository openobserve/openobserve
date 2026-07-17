<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — Entities (hosts, users, assets) with risk. Mock data. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { ENTITIES, kindIcon } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Entities</h1>
      <span class="sub">Hosts, users, assets · rolling risk scores</span>
      <span class="spacer" />
      <span class="btn"><q-icon name="upload" size="15px" />Import assets</span>
    </div>

    <div class="kpis k4">
      <div class="kpi"><div class="label">Tracked entities</div><div class="val num">4,182</div><div class="delta flat">hosts + users + assets</div></div>
      <div class="kpi"><div class="label">High risk (≥70)</div><div class="val num">18</div><div class="delta up">▲ 5</div></div>
      <div class="kpi"><div class="label">Crown jewels</div><div class="val num">42</div><div class="delta flat">tagged critical</div></div>
      <div class="kpi"><div class="label">New (24h)</div><div class="val num">7</div><div class="delta flat">first seen</div></div>
    </div>

    <div class="toolbar">
      <span class="search-box"><q-icon name="search" size="15px" />Search entities…</span>
      <div class="seg"><span class="on">All</span><span>Hosts</span><span>Users</span><span>IPs</span><span>Assets</span></div>
    </div>

    <div class="card">
      <div class="tablewrap">
        <table class="tbl">
          <thead>
            <tr><th>Entity</th><th>Type</th><th>Risk</th><th>Detections</th><th>Details</th><th>Tags</th><th>First seen</th><th>Last seen</th></tr>
          </thead>
          <tbody>
            <tr v-for="e in ENTITIES" :key="e.name">
              <td><q-icon :name="kindIcon(e.kind)" size="15px" class="muted" /> <span class="name">{{ e.name }}</span></td>
              <td><span class="chip">{{ e.kind }}</span></td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <b class="num" :style="{ color: e.color }">{{ e.risk }}</b>
                  <div class="bar" style="width:60px"><i :style="{ width: e.risk + '%', background: e.color }" /></div>
                </div>
              </td>
              <td class="num">{{ e.det }}</td>
              <td class="muted">{{ e.meta }}</td>
              <td><div class="chips"><span class="chip" v-for="t in e.tags" :key="t">{{ t }}</span></div></td>
              <td class="mono">{{ e.first }}</td>
              <td class="mono">{{ e.last }} ago</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
