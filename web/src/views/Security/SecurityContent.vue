<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — Content & Rules packs. Mock data. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { CONTENT_PACKS } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Content &amp; Rules</h1>
      <span class="sub">Curated, versioned detection &amp; parser packs</span>
      <span class="spacer" />
      <span class="btn"><q-icon name="cloud_download" size="15px" />Browse marketplace</span>
    </div>

    <div class="kpis k4">
      <div class="kpi"><div class="label">Installed packs</div><div class="val num">6</div><div class="delta flat">of 8</div></div>
      <div class="kpi"><div class="label">Total rules</div><div class="val num">4,032</div><div class="delta flat">from packs</div></div>
      <div class="kpi"><div class="label">Updates available</div><div class="val num">3</div><div class="delta up">review</div></div>
      <div class="kpi"><div class="label">Sigma-compatible</div><div class="val num">100%</div><div class="delta flat">compiled to SQL</div></div>
    </div>

    <div class="grid-cards">
      <div class="card pad" v-for="p in CONTENT_PACKS" :key="p.name">
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
          <div class="av" style="background:linear-gradient(135deg,#6d5ce0,#b14bd8)"><q-icon name="inventory_2" size="16px" /></div>
          <div style="flex:1">
            <div class="name">{{ p.name }}</div>
            <div class="submono">{{ p.rules.toLocaleString() }} rules · v{{ p.version }}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="chip">{{ p.category }}</span>
          <span v-if="p.update" class="chip accent">Update</span>
          <span class="spacer" style="flex:1" />
          <span v-if="p.installed" class="btn" style="height:28px">Installed</span>
          <span v-else class="btn primary" style="height:28px">Install</span>
        </div>
      </div>
    </div>
  </div>
</template>
