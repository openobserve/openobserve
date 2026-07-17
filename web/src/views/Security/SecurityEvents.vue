<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — Explore Events (normalized OCSF events). Mock data. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { EVENTS, sevLabel } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");
const expanded = ref<number | null>(0);
const toggle = (i: number) => (expanded.value = expanded.value === i ? null : i);
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Explore Events</h1>
      <span class="badge accent">OCSF</span>
      <span class="sub">Normalized security events</span>
    </div>

    <div class="toolbar">
      <span class="search-box" style="flex:1">
        <q-icon name="search" size="15px" />
        activity_name = "Logon" AND severity_id >= 4
      </span>
      <span class="btn"><q-icon name="filter_list" size="15px" />Fields</span>
      <span class="pill"><q-icon name="schedule" size="14px" />Last 1h</span>
      <span class="btn primary">Run</span>
    </div>

    <div class="kpis k4">
      <div class="kpi"><div class="label">Matched events</div><div class="val num">18,204</div><div class="delta flat">in 1h</div></div>
      <div class="kpi"><div class="label">Unique users</div><div class="val num">312</div><div class="delta flat">across 9 sources</div></div>
      <div class="kpi"><div class="label">Critical</div><div class="val num" style="color:var(--sev-crit)">42</div><div class="delta up">▲ spike 10:40</div></div>
      <div class="kpi"><div class="label">Sources</div><div class="val num">9</div><div class="delta flat">all OCSF-mapped</div></div>
    </div>

    <div class="card">
      <header><h3>Events</h3><span class="link">Add columns · Save query</span></header>
      <div class="tablewrap">
        <table class="tbl">
          <thead>
            <tr><th style="width:30px"></th><th>Time</th><th>Class</th><th>Activity</th><th>Sev</th><th>User</th><th>Source IP</th><th>Product</th><th>Message</th></tr>
          </thead>
          <tbody>
            <template v-for="(e, i) in EVENTS" :key="i">
              <tr @click="toggle(i)" style="cursor:pointer">
                <td><q-icon :name="expanded === i ? 'expand_more' : 'chevron_right'" size="16px" class="muted" /></td>
                <td class="mono">{{ e.time }}</td>
                <td><span class="chip">{{ e.cls }}</span></td>
                <td class="mono">{{ e.act }}</td>
                <td><span class="sev" :class="e.sev">{{ sevLabel(e.sev) }}</span></td>
                <td class="mono">{{ e.user }}</td>
                <td class="mono">{{ e.src }}</td>
                <td class="mono">{{ e.product }}</td>
                <td style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ e.msg }}</td>
              </tr>
              <tr v-if="expanded === i">
                <td colspan="9" style="padding:0">
                  <dl class="kv">
                    <dt>metadata.product</dt><dd>{{ e.product }}</dd>
                    <dt>class_name</dt><dd>{{ e.cls }}</dd>
                    <dt>activity_name</dt><dd>{{ e.act }}</dd>
                    <dt>actor.user.name</dt><dd>{{ e.user }}</dd>
                    <dt>src_endpoint.ip</dt><dd>{{ e.src }}</dd>
                    <dt>dst_endpoint</dt><dd>{{ e.dst }}</dd>
                    <dt>device.hostname</dt><dd>{{ e.device }}</dd>
                    <dt>src_endpoint.location</dt><dd>{{ e.geo }}</dd>
                    <dt>mfa</dt><dd>{{ e.mfa }}</dd>
                    <dt>status</dt><dd>{{ e.result }}</dd>
                    <dt>message</dt><dd>{{ e.msg }}</dd>
                  </dl>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
