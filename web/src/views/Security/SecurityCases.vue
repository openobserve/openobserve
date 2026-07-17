<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — Cases (investigation workspace). Mock data. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { CASES, sevLabel, cap } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Cases</h1>
      <span class="sub">Investigations · alerts, events, entities and timeline</span>
      <span class="spacer" />
      <span class="btn primary"><q-icon name="add" size="15px" />New case</span>
    </div>

    <div class="kpis k4">
      <div class="kpi"><div class="label">Open</div><div class="val num">6</div><div class="delta flat">2 critical</div></div>
      <div class="kpi"><div class="label">In progress</div><div class="val num">3</div><div class="delta flat">assigned</div></div>
      <div class="kpi"><div class="label">Resolved (7d)</div><div class="val num">28</div><div class="delta down">▲</div></div>
      <div class="kpi"><div class="label">Median time to close</div><div class="val num">4.2h</div><div class="delta down">▼ 40m</div></div>
    </div>

    <div class="card">
      <div class="tablewrap">
        <table class="tbl">
          <thead>
            <tr><th>Case</th><th>Severity</th><th>Status</th><th>Alerts</th><th>Assignee</th><th>Tags</th><th>Created</th><th>Updated</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in CASES" :key="c.id">
              <td>
                <div class="name">{{ c.title }}</div>
                <div class="submono">{{ c.id }}</div>
              </td>
              <td><span class="sev" :class="c.sev">{{ sevLabel(c.sev) }}</span></td>
              <td><span class="status" :class="c.status">{{ cap(c.status) }}</span></td>
              <td class="num">{{ c.alerts }}</td>
              <td class="mono">{{ c.assignee }}</td>
              <td><div class="chips"><span class="chip" v-for="t in c.tags" :key="t">{{ t }}</span></div></td>
              <td class="mono">{{ c.created }}</td>
              <td class="mono">{{ c.updated }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
