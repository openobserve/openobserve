<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Fleet Management — Agent Inventory with filter, status and drill-down. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import "./fleet.scss";
import { AGENTS, fmtBytes, fmtEps, type AgentStatus, type AgentType } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");

const search = ref("");
const statusFilter = ref<AgentStatus | "all">("all");
const typeFilter = ref<AgentType | "all">("all");

const STATUS_LABEL: Record<string, string> = { ok: "Active", warn: "Degraded", err: "Error", off: "Offline" };
const STATUS_COLORS: Record<string, string> = { ok: "var(--ok)", warn: "var(--warn)", err: "var(--err)", off: "var(--text-3)" };
const TYPE_LABEL: Record<string, string> = { otel: "OTel Collector", vector: "Vector", fluent: "Fluent Bit", prom: "Prometheus", beat: "Elastic Beat", custom: "Custom" };
const VERSION_CLASS = (v: string, lv: string) => v === lv ? "latest" : "outdated";

const filtered = computed(() =>
  AGENTS.filter(a => {
    if (statusFilter.value !== "all" && a.status !== statusFilter.value) return false;
    if (typeFilter.value !== "all" && a.type !== typeFilter.value) return false;
    if (search.value && !a.name.toLowerCase().includes(search.value.toLowerCase()) &&
        !a.host.toLowerCase().includes(search.value.toLowerCase())) return false;
    return true;
  })
);

const statusCounts = computed(() => {
  const c = { ok: 0, warn: 0, err: 0, off: 0 };
  AGENTS.forEach(a => { (c as any)[a.status]++; });
  return c;
});

const selectedAgent = ref<typeof AGENTS[0] | null>(null);
</script>

<template>
  <div class="o2fleet" :class="{ dark: isDark }">
    <div class="pg-head">
      <h1>Agents</h1>
      <span class="badge">{{ AGENTS.length.toLocaleString() }} total</span>
      <span class="spacer" />
      <button class="btn"><q-icon name="download" size="15px" />Export CSV</button>
      <button class="btn primary"><q-icon name="add" size="15px" />Register Agent</button>
    </div>

    <!-- Status summary chips -->
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <button
        v-for="s in ['all', 'ok', 'warn', 'err', 'off']"
        :key="s"
        class="pill"
        style="cursor:pointer;gap:7px"
        :style="statusFilter === s ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
        @click="statusFilter = s as any"
      >
        <span v-if="s !== 'all'" class="status-ring" :class="s !== 'all' ? s : ''" />
        <span>{{ s === 'all' ? 'All' : STATUS_LABEL[s] }}</span>
        <b style="font-size:11px">{{ s === 'all' ? AGENTS.length : statusCounts[s as AgentStatus] }}</b>
      </button>
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="search-box">
        <q-icon name="search" size="15px" />
        <input v-model="search" placeholder="Search by name or host…" />
      </div>
      <select
        class="btn"
        v-model="typeFilter"
        style="min-width:160px;appearance:auto;padding:0 10px"
      >
        <option value="all">All Types</option>
        <option value="otel">OTel Collector</option>
        <option value="vector">Vector</option>
        <option value="fluent">Fluent Bit</option>
        <option value="prom">Prometheus</option>
        <option value="beat">Elastic Beat</option>
        <option value="custom">Custom</option>
      </select>
      <span class="spacer" />
      <button class="btn"><q-icon name="settings" size="15px" />Bulk Actions</button>
    </div>

    <!-- Main layout: table + detail panel -->
    <div style="display:flex;gap:12px;align-items:flex-start">
      <!-- Table -->
      <div class="card" style="flex:1;min-width:0">
        <div class="tablewrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Agent Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Version</th>
                <th>Region / Env</th>
                <th>EPS</th>
                <th>Throughput</th>
                <th>CPU / Mem</th>
                <th>Uptime</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="a in filtered"
                :key="a.id"
                style="cursor:pointer"
                :style="selectedAgent?.id === a.id ? { background: 'var(--accent-weak)' } : {}"
                @click="selectedAgent = selectedAgent?.id === a.id ? null : a"
              >
                <td>
                  <div class="name">{{ a.name }}</div>
                  <div class="sub mono">{{ a.host }}</div>
                </td>
                <td><span class="agent-chip" :class="a.type">{{ TYPE_LABEL[a.type] }}</span></td>
                <td>
                  <div style="display:flex;align-items:center;gap:7px">
                    <span class="status-ring" :class="a.status" />
                    <span :style="{ color: STATUS_COLORS[a.status], fontWeight: 600, fontSize: '12px' }">{{ STATUS_LABEL[a.status] }}</span>
                  </div>
                </td>
                <td>
                  <span class="ver" :class="VERSION_CLASS(a.version, a.latestVersion)">v{{ a.version }}</span>
                </td>
                <td>
                  <div class="name">{{ a.region }}</div>
                  <div class="sub">{{ a.env }}</div>
                </td>
                <td class="mono">{{ a.eps ? fmtEps(a.eps) : '—' }}</td>
                <td class="mono">{{ a.bytesPerSec ? fmtBytes(a.bytesPerSec) : '—' }}</td>
                <td>
                  <div v-if="a.cpuPct" style="font-size:12px">
                    CPU {{ a.cpuPct }}% · {{ a.memMb }}MB
                  </div>
                  <span v-else class="muted">—</span>
                </td>
                <td class="mono">{{ a.uptime }}</td>
                <td class="mono" style="color:var(--text-3)">{{ a.lastSeen }}</td>
              </tr>
              <tr v-if="!filtered.length">
                <td colspan="10" style="text-align:center;padding:32px;color:var(--text-3)">No agents match the current filter</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Detail side panel -->
      <Transition name="fleet-slide">
        <div
          v-if="selectedAgent"
          class="card"
          style="width:320px;flex-shrink:0;position:sticky;top:0"
        >
          <header style="display:flex;align-items:center;gap:8px">
            <span class="status-ring" :class="selectedAgent.status" />
            <h3 style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ selectedAgent.name }}</h3>
            <button class="btn" style="height:24px;padding:0 8px;font-size:11px" @click="selectedAgent = null">✕</button>
          </header>
          <div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px">
            <div>
              <span class="agent-chip" :class="selectedAgent.type" style="margin-right:6px">{{ TYPE_LABEL[selectedAgent.type] }}</span>
              <span class="ver" :class="VERSION_CLASS(selectedAgent.version, selectedAgent.latestVersion)">v{{ selectedAgent.version }}</span>
              <span v-if="selectedAgent.version !== selectedAgent.latestVersion" style="font-size:11px;color:var(--warn);margin-left:6px">→ v{{ selectedAgent.latestVersion }}</span>
            </div>

            <div style="display:flex;flex-direction:column;gap:6px;font-size:12.5px">
              <div style="display:flex;justify-content:space-between">
                <span style="color:var(--text-2)">Host</span>
                <span class="mono" style="font-size:11.5px">{{ selectedAgent.host }}</span>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="color:var(--text-2)">Region</span><span>{{ selectedAgent.region }}</span>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="color:var(--text-2)">Environment</span><span>{{ selectedAgent.env }}</span>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="color:var(--text-2)">Uptime</span><span>{{ selectedAgent.uptime }}</span>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="color:var(--text-2)">Last Seen</span><span>{{ selectedAgent.lastSeen }}</span>
              </div>
            </div>

            <div v-if="selectedAgent.eps" style="display:flex;flex-direction:column;gap:8px">
              <div style="font-size:11.5px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:0.3px">Throughput</div>
              <div style="display:flex;justify-content:space-between;font-size:13px">
                <span style="color:var(--text-2)">Events/sec</span><b>{{ fmtEps(selectedAgent.eps) }}</b>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:13px">
                <span style="color:var(--text-2)">Throughput</span><b>{{ fmtBytes(selectedAgent.bytesPerSec) }}</b>
              </div>
            </div>

            <div v-if="selectedAgent.cpuPct" style="display:flex;flex-direction:column;gap:8px">
              <div style="font-size:11.5px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:0.3px">Resources</div>
              <div>
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                  <span style="color:var(--text-2)">CPU</span><span>{{ selectedAgent.cpuPct }}%</span>
                </div>
                <div class="bar"><i :style="{ width: selectedAgent.cpuPct + '%', background: selectedAgent.cpuPct > 45 ? 'var(--warn)' : 'var(--accent)' }" /></div>
              </div>
              <div>
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                  <span style="color:var(--text-2)">Memory</span><span>{{ selectedAgent.memMb }} MB</span>
                </div>
                <div class="bar"><i :style="{ width: Math.min(selectedAgent.memMb / 10, 100) + '%', background: 'var(--info)' }" /></div>
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:6px">
              <div style="font-size:11.5px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:0.3px">Tags</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px">
                <span v-for="t in selectedAgent.tags" :key="t" class="ver">{{ t }}</span>
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:6px">
              <div style="font-size:11.5px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:0.3px">Pipelines</div>
              <div style="display:flex;flex-direction:column;gap:3px">
                <span v-for="p in selectedAgent.pipelines" :key="p" style="font-size:12px;color:var(--accent);font-family:monospace">{{ p }}</span>
              </div>
            </div>

            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn" style="flex:1">View Logs</button>
              <button class="btn" style="flex:1">Push Config</button>
            </div>
            <button class="btn primary" style="width:100%;justify-content:center">Upgrade Agent</button>
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
