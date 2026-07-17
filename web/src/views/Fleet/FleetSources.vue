<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Fleet Management — Data Sources catalog by category. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import "./fleet.scss";
import { DATA_SOURCES, fmtEps } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");

const categories = ["Cloud", "Kubernetes", "Databases", "Applications"];
const sourcesByCategory = (cat: string) => DATA_SOURCES.filter(s => s.category === cat);

const search = ref("");
const filteredBySearch = computed(() =>
  DATA_SOURCES.filter(s =>
    !search.value || s.name.toLowerCase().includes(search.value.toLowerCase())
  )
);
const filteredCategories = computed(() =>
  categories.filter(c => filteredBySearch.value.some(s => s.category === c))
);
const filteredSources = (cat: string) =>
  filteredBySearch.value.filter(s => s.category === cat);
</script>

<template>
  <div class="o2fleet" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Data Sources</h1>
      <span class="badge">{{ DATA_SOURCES.length }} integrations</span>
      <span class="sub">Configured agents → OpenObserve</span>
      <span class="spacer" />
      <button class="btn primary"><q-icon name="add" size="15px" />Add Source</button>
    </div>

    <!-- Summary KPIs -->
    <div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
      <div class="kpi" v-for="cat in categories" :key="cat">
        <div class="label"><span class="dot" style="background:var(--accent)" />{{ cat }}</div>
        <div class="val num">{{ sourcesByCategory(cat).length }}</div>
        <div class="delta up">
          {{ sourcesByCategory(cat).reduce((s, x) => s + x.connectedAgents, 0) }} agents connected
        </div>
      </div>
    </div>

    <!-- Search -->
    <div class="toolbar">
      <div class="search-box">
        <q-icon name="search" size="15px" />
        <input v-model="search" placeholder="Search integrations…" />
      </div>
    </div>

    <!-- Source cards by category -->
    <div v-for="cat in filteredCategories" :key="cat" style="margin-bottom:16px">
      <div class="card">
        <header><h3>{{ cat }}</h3><span class="muted">{{ filteredSources(cat).length }} integrations</span></header>
        <div class="src-grid">
          <div v-for="src in filteredSources(cat)" :key="src.name" class="src-card">
            <div class="src-ico">{{ src.icon }}</div>
            <div class="src-name">{{ src.name }}</div>
            <div class="src-meta">{{ src.description }}</div>
            <div style="display:flex;align-items:center;gap:8px;width:100%;margin-top:2px">
              <span class="src-count" :class="src.connectedAgents === 0 ? 'zero' : ''">
                {{ src.connectedAgents ? src.connectedAgents + ' agents' : 'Not configured' }}
              </span>
              <span v-if="src.eps" style="font-size:11px;color:var(--text-3)">{{ fmtEps(src.eps) }} eps</span>
            </div>
            <div style="font-size:11px;color:var(--text-3);margin-top:2px">
              <span style="font-weight:650">Protocol:</span> {{ src.protocol }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!filteredCategories.length" style="text-align:center;padding:48px;color:var(--text-3)">
      No integrations match "{{ search }}"
    </div>
  </div>
</template>
