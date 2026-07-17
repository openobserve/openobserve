<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — Threat Intel (IOCs + feeds). Mock data. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { IOCS, FEEDS, cap } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");
const iocIcon = (t: string) =>
  t.includes("ip") ? "lan" : t === "domain" ? "public" : t === "url" ? "link" : "tag";
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Threat Intel</h1>
      <span class="sub">Indicators of compromise & feeds · enrichment on ingest</span>
      <span class="spacer" />
      <span class="btn"><q-icon name="sync" size="15px" />Sync feeds</span>
      <span class="btn primary"><q-icon name="add" size="15px" />Add indicator</span>
    </div>

    <div class="kpis k4">
      <div class="kpi"><div class="label">Indicators</div><div class="val num">330,965</div><div class="delta flat">across 5 feeds</div></div>
      <div class="kpi"><div class="label">Matches (24h)</div><div class="val num">14</div><div class="delta up">▲ 6</div></div>
      <div class="kpi"><div class="label">Active feeds</div><div class="val num">5</div><div class="delta flat">3 healthy</div></div>
      <div class="kpi"><div class="label">Avg confidence</div><div class="val num">84%</div><div class="delta flat">high-fidelity</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <header><h3>Recent IOC matches</h3><span class="link">All indicators →</span></header>
        <div class="tablewrap">
          <table class="tbl">
            <thead><tr><th>Indicator</th><th>Type</th><th>Threat</th><th>Feed</th><th>Conf</th><th>Matches</th></tr></thead>
            <tbody>
              <tr v-for="i in IOCS" :key="i.value">
                <td><q-icon :name="iocIcon(i.type)" size="14px" class="muted" /> <span class="mono">{{ i.value }}</span></td>
                <td><span class="chip">{{ i.type }}</span></td>
                <td>{{ i.threat }}</td>
                <td class="mono">{{ i.feed }}</td>
                <td class="num">{{ i.conf }}%</td>
                <td><span :class="i.matches ? 'status new' : 'muted'">{{ i.matches }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <header><h3>Feeds</h3><span class="link">Manage →</span></header>
        <div class="ent" v-for="f in FEEDS" :key="f.name">
          <div class="ico"><q-icon name="rss_feed" size="17px" /></div>
          <div>
            <div class="n">{{ f.name }}</div>
            <div class="m">{{ f.type }} · {{ f.indicators.toLocaleString() }} indicators</div>
          </div>
          <div class="right">
            <span class="status" :class="f.status">{{ cap(f.status) }}</span>
            <div class="m">{{ f.sync }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
