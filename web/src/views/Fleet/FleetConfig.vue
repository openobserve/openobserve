<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Fleet Management — Configuration Management: templates, push history, versioning. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import "./fleet.scss";
import { CONFIG_TEMPLATES } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");

const TYPE_LABEL: Record<string, string> = { otel: "OTel Collector", vector: "Vector", fluent: "Fluent Bit", prom: "Prometheus", beat: "Elastic Beat", custom: "Custom" };
const PUSH_HISTORY = [
  { ts: "2h ago", template: "OTel Collector — Kubernetes Full", agents: 312, result: "ok", dur: "1.2s" },
  { ts: "12h ago", template: "Winlogbeat — Security Audit", agents: 45, result: "warn", dur: "3.8s" },
  { ts: "1d ago", template: "OTel Collector — Kubernetes Full", agents: 308, result: "ok", dur: "1.1s" },
  { ts: "3d ago", template: "Fluent Bit — Syslog + Geo", agents: 72, result: "ok", dur: "0.9s" },
  { ts: "6d ago", template: "Prometheus — Infra Scrape", agents: 38, result: "ok", dur: "2.1s" },
  { ts: "1w ago", template: "Vector — Container Log Enrichment", agents: 88, result: "ok", dur: "1.4s" },
];
const selected = ref<typeof CONFIG_TEMPLATES[0] | null>(null);
</script>

<template>
  <div class="o2fleet" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Configuration</h1>
      <span class="badge">{{ CONFIG_TEMPLATES.length }} templates</span>
      <span class="sub">Centrally manage and push config to agents</span>
      <span class="spacer" />
      <button class="btn"><q-icon name="upload" size="15px" />Import YAML</button>
      <button class="btn primary"><q-icon name="add" size="15px" />New Template</button>
    </div>

    <div class="grid-2-1">
      <!-- Templates list -->
      <div class="card">
        <header>
          <h3>Config Templates</h3>
          <span class="muted">{{ CONFIG_TEMPLATES.reduce((s, c) => s + c.agentsDeployed, 0) }} agents under management</span>
        </header>
        <div class="cfg-list">
          <div
            v-for="c in CONFIG_TEMPLATES"
            :key="c.id"
            class="cfg-row"
            :style="selected?.id === c.id ? { background: 'var(--accent-weak)', borderLeft: '3px solid var(--accent)' } : {}"
            @click="selected = selected?.id === c.id ? null : c"
          >
            <div class="cfg-icon">{{ c.icon }}</div>
            <div style="flex:1;min-width:0">
              <div class="cfg-name">{{ c.name }}</div>
              <div class="cfg-meta">{{ c.description }}</div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
                <span class="agent-chip" :class="c.agentType">{{ TYPE_LABEL[c.agentType] }}</span>
                <span class="ver latest">{{ c.version }}</span>
                <span style="font-size:11px;color:var(--text-3)">{{ c.agentsDeployed }} agents · pushed {{ c.lastPushed }}</span>
              </div>
            </div>
            <div class="cfg-actions" @click.stop>
              <button class="cfg-btn">Push</button>
              <button class="cfg-btn">Edit</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Right column -->
      <div class="cols">
        <!-- Selected template detail -->
        <div v-if="selected" class="card">
          <header>
            <h3>{{ selected.name }}</h3>
            <button class="btn" style="height:24px;padding:0 8px;font-size:11px;margin-left:auto" @click="selected = null">✕</button>
          </header>
          <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;font-size:12.5px">
            <div style="display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Type</span><span class="agent-chip" :class="selected.agentType">{{ TYPE_LABEL[selected.agentType] }}</span></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Version</span><span class="ver latest">{{ selected.version }}</span></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Agents</span><b>{{ selected.agentsDeployed }}</b></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--text-2)">Last Push</span><span>{{ selected.lastPushed }}</span></div>
            </div>
            <div style="background:var(--surface-3);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:11.5px;font-family:monospace;color:var(--text-2);line-height:1.6">
              receivers:<br/>
              &nbsp;&nbsp;otlp:<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;protocols: { grpc: {}, http: {} }<br/>
              exporters:<br/>
              &nbsp;&nbsp;otlphttp:<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;endpoint: https://api.openobserve.ai<br/>
              processors: [batch, k8sattributes, pii_redact]
            </div>
            <button class="btn primary" style="width:100%;justify-content:center">
              <q-icon name="push_pin" size="15px" />Push to All Agents
            </button>
          </div>
        </div>

        <!-- Push history -->
        <div class="card">
          <header><h3>Push History</h3><span class="muted">Recent deployments</span></header>
          <div class="tablewrap">
            <table class="tbl">
              <thead><tr><th>When</th><th>Template</th><th>Agents</th><th>Result</th><th>Duration</th></tr></thead>
              <tbody>
                <tr v-for="h in PUSH_HISTORY" :key="h.ts">
                  <td class="mono" style="color:var(--text-3);white-space:nowrap">{{ h.ts }}</td>
                  <td><div class="name" style="font-size:12px;font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ h.template }}</div></td>
                  <td class="mono">{{ h.agents }}</td>
                  <td>
                    <span
                      class="ver"
                      :class="h.result === 'ok' ? 'latest' : 'outdated'"
                    >{{ h.result === 'ok' ? 'Success' : 'Partial' }}</span>
                  </td>
                  <td class="mono">{{ h.dur }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
