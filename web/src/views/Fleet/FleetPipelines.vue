<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Fleet Management — Processing Pipelines: routing, transforms and destinations. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import "./fleet.scss";
import { PIPELINES, fmtEps } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");

const STATUS_COLORS: Record<string, string> = { ok: "var(--ok)", warn: "var(--warn)", err: "var(--err)", off: "var(--text-3)" };
const STATUS_LABEL: Record<string, string> = { ok: "Running", warn: "Degraded", err: "Error", off: "Stopped" };

const selected = ref<typeof PIPELINES[0] | null>(null);
</script>

<template>
  <div class="o2fleet" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Pipelines</h1>
      <span class="badge">{{ PIPELINES.length }} pipelines</span>
      <span class="sub">Routing, transformation and fan-out rules</span>
      <span class="spacer" />
      <button class="btn"><q-icon name="upload" size="15px" />Import</button>
      <button class="btn primary"><q-icon name="add" size="15px" />New Pipeline</button>
    </div>

    <!-- Summary stats -->
    <div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
      <div class="kpi">
        <div class="label"><span class="dot" style="background:var(--ok)" />Running</div>
        <div class="val num">{{ PIPELINES.filter(p => p.status === 'ok').length }}</div>
      </div>
      <div class="kpi">
        <div class="label"><span class="dot" style="background:var(--warn)" />Degraded</div>
        <div class="val num">{{ PIPELINES.filter(p => p.status === 'warn').length }}</div>
      </div>
      <div class="kpi">
        <div class="label"><span class="dot" style="background:var(--err)" />Error</div>
        <div class="val num">{{ PIPELINES.filter(p => p.status === 'err').length }}</div>
      </div>
      <div class="kpi">
        <div class="label"><span class="dot" style="background:var(--accent)" />Total EPS</div>
        <div class="val num">{{ fmtEps(PIPELINES.reduce((s, p) => s + p.eps, 0)) }}</div>
        <div class="delta up">across all pipelines</div>
      </div>
    </div>

    <div style="display:flex;gap:12px;align-items:flex-start">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">
        <div
          v-for="p in PIPELINES"
          :key="p.id"
          class="card"
          style="cursor:pointer"
          :style="selected?.id === p.id ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-weak)' } : {}"
          @click="selected = selected?.id === p.id ? null : p"
        >
          <div style="padding:16px 18px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
              <span class="status-ring" :class="p.status" />
              <span style="font-weight:700;font-size:14px">{{ p.name }}</span>
              <span :style="{ color: STATUS_COLORS[p.status], fontWeight: 650, fontSize: '12px' }">{{ STATUS_LABEL[p.status] }}</span>
              <span class="spacer" />
              <span style="font-size:12px;color:var(--text-3)">{{ p.agentCount }} agents · modified {{ p.lastModified }}</span>
            </div>

            <!-- Pipeline flow diagram -->
            <div class="pipe-flow" style="flex-wrap:wrap;margin-bottom:12px">
              <div class="pipe-node" style="background:var(--info-bg);border-color:color-mix(in srgb,var(--info) 30%,transparent);color:var(--info)">
                <q-icon name="input" size="13px" style="margin-right:4px" />{{ p.input }}
              </div>
              <span class="pipe-arrow">→</span>
              <template v-for="(t, ti) in p.transforms" :key="ti">
                <div class="pipe-node">{{ t }}</div>
                <span class="pipe-arrow">→</span>
              </template>
              <div class="pipe-node" style="background:var(--accent-weak);border-color:color-mix(in srgb,var(--accent) 30%,transparent);color:var(--accent)">
                <q-icon name="output" size="13px" style="margin-right:4px" />{{ p.output }}
              </div>
            </div>

            <div style="display:flex;align-items:center;gap:20px;font-size:12.5px">
              <div>
                <span style="color:var(--text-3)">Events/sec</span>
                <b style="margin-left:8px">{{ p.eps ? fmtEps(p.eps) : '—' }}</b>
              </div>
              <div>
                <span style="color:var(--text-3)">Transforms</span>
                <b style="margin-left:8px">{{ p.transforms.length }}</b>
              </div>
              <div>
                <span style="color:var(--text-3)">Agents</span>
                <b style="margin-left:8px">{{ p.agentCount }}</b>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Detail -->
      <Transition name="fleet-slide">
        <div v-if="selected" class="card" style="width:300px;flex-shrink:0;position:sticky;top:0">
          <header>
            <span class="status-ring" :class="selected.status" />
            <h3 style="flex:1;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ selected.name }}</h3>
            <button class="btn" style="height:24px;padding:0 8px;font-size:11px" @click="selected = null">✕</button>
          </header>
          <div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px;font-size:12.5px">
            <div>
              <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:6px">Input</div>
              <div class="pipe-node" style="display:inline-block">{{ selected.input }}</div>
            </div>
            <div>
              <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:6px">Transforms ({{ selected.transforms.length }})</div>
              <div style="display:flex;flex-direction:column;gap:4px">
                <div v-for="t in selected.transforms" :key="t" class="pipe-node" style="font-size:12px">{{ t }}</div>
              </div>
            </div>
            <div>
              <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:6px">Output</div>
              <div class="pipe-node" style="display:inline-block;color:var(--accent)">{{ selected.output }}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">EPS</span><b>{{ selected.eps ? fmtEps(selected.eps) : '—' }}</b></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Agents using</span><b>{{ selected.agentCount }}</b></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Last modified</span><span>{{ selected.lastModified }}</span></div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn" style="flex:1;justify-content:center">View YAML</button>
              <button class="btn" style="flex:1;justify-content:center">Clone</button>
            </div>
            <button class="btn primary" style="width:100%;justify-content:center">Edit Pipeline</button>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.fleet-slide-enter-active, .fleet-slide-leave-active { transition: all 0.2s ease; }
.fleet-slide-enter-from, .fleet-slide-leave-to { opacity: 0; transform: translateX(20px); }
</style>
