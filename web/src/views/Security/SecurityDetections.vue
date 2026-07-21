<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — Detections: rule catalog, enable/disable, detail panel, New Detection modal.
     Phase 1 UI. Wire to /api/{org}/alerts endpoints for real CRUD. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { DETECTIONS, DETECTION_DETAIL, sevLabel } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");

// ── Reactive detection list ──
const rules = ref(DETECTIONS.map(d => ({ ...d })));

const search  = ref("");
const tabFilter = ref<"all" | "enabled" | "disabled" | "noise">("all");

const filtered = computed(() => {
  let list = rules.value;
  if (search.value) {
    const q = search.value.toLowerCase();
    list = list.filter(d => d.name.toLowerCase().includes(q) || d.tech.toLowerCase().includes(q) || d.tactic.toLowerCase().includes(q));
  }
  if (tabFilter.value === "enabled")  list = list.filter(d => d.enabled);
  if (tabFilter.value === "disabled") list = list.filter(d => !d.enabled);
  if (tabFilter.value === "noise")    list = list.filter(d => d.fp === "high" || d.hits === 0);
  return list;
});

const counts = computed(() => ({
  all:      rules.value.length,
  enabled:  rules.value.filter(d => d.enabled).length,
  disabled: rules.value.filter(d => !d.enabled).length,
  noise:    rules.value.filter(d => d.fp === "high" || d.hits === 0).length,
}));

function toggleRule(d: typeof rules.value[0]) { d.enabled = !d.enabled; }

const TYPE_CLASS: Record<string, string> = { scheduled: "", streaming: "accent", correlation: "" };

// ── Detail side panel ──
const selectedRule = ref<typeof DETECTIONS[0] | null>(null);
const dpTab = ref<"overview" | "sql" | "sigma" | "backtest">("overview");

function openDetail(d: typeof DETECTIONS[0]) {
  selectedRule.value = d;
  dpTab.value = "overview";
}
function closeDetail() { selectedRule.value = null; }

const ruleDetail = computed(() =>
  selectedRule.value ? (DETECTION_DETAIL[selectedRule.value.id] ?? null) : null
);

// ── New Detection modal ──
const showNewModal = ref(false);
const newTab = ref<"sigma" | "sql">("sigma");
const sigmaYaml = ref(`title: My New Detection
id: rule-custom-001
status: experimental
description: Detect suspicious activity
logsource:
  category: authentication
detection:
  selection:
    class_name: Authentication
    status_id: 0
  condition: selection
level: high
tags:
  - attack.credential_access`);
const sqlQuery = ref(`SELECT _timestamp, actor.user.name, src_endpoint.ip, device.hostname
FROM security_events
WHERE class_name = 'Authentication'
  AND status_id = 0
  AND severity_id >= 4
  AND _timestamp >= NOW() - INTERVAL '5 minutes'`);
const newSev = ref("high");
const newType = ref("scheduled");
const newEnabled = ref(false);
const isCompiling = ref(false);
const compiledSql = ref("");

function compile() {
  isCompiling.value = true;
  setTimeout(() => {
    compiledSql.value = `SELECT _timestamp, actor.user.name, src_endpoint.ip\nFROM security_events\nWHERE class_name = 'Authentication'\n  AND status_id = 0\n  AND severity_id >= 4`;
    isCompiling.value = false;
  }, 800);
}

// ── Backtest modal ──
const showBacktest = ref(false);
const btFrom = ref("2026-06-15");
const btTo   = ref("2026-07-15");
const btRunning = ref(false);
const btResult = ref<{ fires: number; samples: any[] } | null>(null);

function runBacktest() {
  btRunning.value = true;
  btResult.value  = null;
  setTimeout(() => {
    btResult.value = ruleDetail.value?.backtest ?? { fires: 3, period: `${btFrom.value} – ${btTo.value}`, samples: [] };
    btRunning.value = false;
  }, 1200);
}
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <!-- Page header -->
    <div class="pg-head">
      <h1>Detections</h1>
      <span class="sub">Sigma & custom rules mapped to MITRE ATT&CK · Phase 1</span>
      <span class="spacer" />
      <button class="btn" @click="showBacktest = true">
        <q-icon name="analytics" size="14px" />Backtest
      </button>
      <button class="btn primary" @click="showNewModal = true">
        <q-icon name="add" size="14px" />New detection
      </button>
    </div>

    <!-- KPI strip -->
    <div class="kpis k4">
      <div class="kpi">
        <div class="label">Enabled rules</div>
        <div class="val num">{{ counts.enabled }}</div>
        <div class="delta flat">of {{ counts.all }} total</div>
      </div>
      <div class="kpi">
        <div class="label">Fired (24h)</div>
        <div class="val num">1,880</div>
        <div class="delta up">▲ 12%</div>
      </div>
      <div class="kpi">
        <div class="label">Streaming</div>
        <div class="val num">{{ rules.filter(d => d.type === 'streaming' && d.enabled).length }}</div>
        <div class="delta flat">low-latency</div>
      </div>
      <div class="kpi">
        <div class="label">Avg FP rate</div>
        <div class="val num">4.1%</div>
        <div class="delta down">▼ tuned</div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
      <span class="search-box" style="flex:1;max-width:340px">
        <q-icon name="search" size="15px" />
        <input v-model="search" style="flex:1;border:none;outline:none;background:transparent;font-size:12.5px;color:var(--text)" placeholder="Search rules, technique, tactic…" />
      </span>
      <div class="seg">
        <span v-for="t in ['all','enabled','disabled','noise'] as const" :key="t"
          :class="{ on: tabFilter === t }" @click="tabFilter = t">
          {{ t === 'noise' ? 'High-noise' : t.charAt(0).toUpperCase() + t.slice(1) }}
          <span style="margin-left:4px;opacity:0.6">({{ counts[t] }})</span>
        </span>
      </div>
    </div>

    <!-- Layout: table + detail panel -->
    <div style="display:flex;gap:0;align-items:flex-start">
      <div class="card" :style="selectedRule ? 'flex:1;min-width:0;border-right:none;border-radius:10px 0 0 10px' : 'flex:1'">
        <div class="tablewrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Detection</th>
                <th>Technique</th>
                <th>Severity</th>
                <th>Type</th>
                <th>Source</th>
                <th>Last fired</th>
                <th>Hits 24h</th>
                <th>FP</th>
                <th>Health</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="d in filtered" :key="d.id"
                style="cursor:pointer"
                :style="selectedRule?.id === d.id ? { background: 'var(--accent-weak)' } : {}"
                @click="openDetail(d)"
              >
                <td>
                  <div class="name">{{ d.name }}</div>
                  <div class="submono">{{ d.id }} · {{ d.tactic }}</div>
                </td>
                <td>
                  <span class="chip accent">{{ d.tech }}</span>
                  <div class="tag-tech" style="margin-top:2px">{{ d.techName }}</div>
                </td>
                <td><span class="sev" :class="d.sev">{{ sevLabel(d.sev) }}</span></td>
                <td><span class="chip" :class="TYPE_CLASS[d.type]">{{ d.type }}</span></td>
                <td class="mono">{{ d.source }}</td>
                <td class="mono">{{ d.fired === '—' ? '—' : d.fired + ' ago' }}</td>
                <td class="num" :style="d.hits === 0 && d.enabled ? 'color:var(--sev-info)' : ''">{{ d.hits }}</td>
                <td>
                  <span class="status" :class="d.fp === 'low' ? 'closed' : d.fp === 'medium' ? 'triage' : 'new'">
                    {{ d.fp }}
                  </span>
                </td>
                <td>
                  <!-- Health: warn if no TP in 90d (hits=0 + enabled), good otherwise -->
                  <span v-if="d.hits === 0 && d.enabled" style="font-size:11px;color:var(--sev-info)" title="No fires in 90d — review rule">
                    <q-icon name="warning" size="13px" /> stale
                  </span>
                  <span v-else-if="d.fp === 'high'" style="font-size:11px;color:var(--sev-med)">
                    <q-icon name="warning-amber" size="13px" /> noisy
                  </span>
                  <span v-else style="font-size:11px;color:var(--ok)">
                    <q-icon name="check-circle" size="13px" /> ok
                  </span>
                </td>
                <td @click.stop>
                  <div class="toggle" :class="{ on: d.enabled }" @click="toggleRule(d)"><i /></div>
                </td>
              </tr>
              <tr v-if="!filtered.length">
                <td colspan="10" style="text-align:center;padding:32px;color:var(--text-3)">No detections match the current filter</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Detail side panel (inline, not full-screen) -->
      <Transition name="dp-slide">
        <div v-if="selectedRule"
          style="width:440px;flex-shrink:0;background:var(--surface);border:1px solid var(--border);border-left:none;border-radius:0 10px 10px 0;display:flex;flex-direction:column;overflow:hidden;max-height:calc(100vh - 180px);position:sticky;top:0">
          <!-- Header -->
          <div class="dp-header">
            <span class="sev" :class="selectedRule.sev" style="flex-shrink:0">{{ sevLabel(selectedRule.sev) }}</span>
            <h2 style="font-size:13px;line-height:1.3">{{ selectedRule.name }}</h2>
            <button class="btn" style="height:26px;padding:0 8px;font-size:11px;flex-shrink:0" @click="closeDetail">✕</button>
          </div>
          <!-- Tabs -->
          <div class="dp-tabs">
            <span v-for="t in ['overview','sql','sigma','backtest']" :key="t"
              :class="{ on: dpTab === t }" @click="dpTab = (t as any)">
              {{ t.charAt(0).toUpperCase() + t.slice(1) }}
            </span>
          </div>
          <!-- Body -->
          <div class="dp-body">
            <!-- Overview tab -->
            <template v-if="dpTab === 'overview'">
              <div class="dp-section">
                <div class="dp-section-head">Rule info</div>
                <div class="dp-kv">
                  <span class="dp-k">id</span>           <span class="dp-v">{{ selectedRule.id }}</span>
                  <span class="dp-k">tactic</span>       <span class="dp-v">{{ selectedRule.tactic }}</span>
                  <span class="dp-k">technique</span>    <span class="dp-v">{{ selectedRule.tech }} · {{ selectedRule.techName }}</span>
                  <span class="dp-k">type</span>         <span class="dp-v">{{ selectedRule.type }}</span>
                  <span class="dp-k">source</span>       <span class="dp-v">{{ selectedRule.source }}</span>
                  <span class="dp-k">last fired</span>   <span class="dp-v">{{ selectedRule.fired === '—' ? 'never' : selectedRule.fired + ' ago' }}</span>
                  <span class="dp-k">24h hits</span>     <span class="dp-v">{{ selectedRule.hits }}</span>
                  <span class="dp-k">FP rate</span>      <span class="dp-v">{{ selectedRule.fp }}</span>
                </div>
              </div>
              <div v-if="ruleDetail" class="dp-section">
                <div class="dp-section-head">Description</div>
                <p style="font-size:13px;color:var(--text-2);line-height:1.55;margin:0">{{ ruleDetail.description }}</p>
              </div>
              <div v-if="!ruleDetail" class="dp-section">
                <div class="dp-section-head">Description</div>
                <p style="font-size:13px;color:var(--text-2);line-height:1.55;margin:0">Detection rule targeting {{ selectedRule.techName }} ({{ selectedRule.tech }}) under {{ selectedRule.tactic }}.</p>
              </div>
            </template>

            <!-- SQL tab -->
            <template v-else-if="dpTab === 'sql'">
              <div class="dp-section">
                <div class="dp-section-head" style="margin-bottom:8px">Compiled SQL query</div>
                <div v-if="ruleDetail" class="dp-sql">{{ ruleDetail.sql }}</div>
                <div v-else class="dp-sql" style="color:var(--text-3)">-- SQL query not available for this rule in mock data</div>
              </div>
              <div class="dp-section">
                <div class="dp-section-head">Stream</div>
                <span class="chip accent">security_events</span>
                <span style="font-size:12px;color:var(--text-3);margin-left:8px">schedule: every 5 min</span>
              </div>
            </template>

            <!-- Sigma tab -->
            <template v-else-if="dpTab === 'sigma'">
              <div class="dp-section">
                <div class="dp-section-head" style="margin-bottom:8px">Sigma rule source</div>
                <div v-if="ruleDetail" class="dp-sql">{{ ruleDetail.sigma }}</div>
                <div v-else class="dp-sql" style="color:var(--text-3)">-- Sigma YAML not available for this rule in mock data</div>
              </div>
            </template>

            <!-- Backtest tab -->
            <template v-else-if="dpTab === 'backtest'">
              <div class="dp-section">
                <div class="dp-section-head">Date range</div>
                <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
                  <input class="form-input" type="date" v-model="btFrom" style="flex:1" />
                  <span style="color:var(--text-3)">→</span>
                  <input class="form-input" type="date" v-model="btTo" style="flex:1" />
                </div>
                <button class="btn primary" style="margin-top:10px;width:100%;justify-content:center" @click="runBacktest">
                  <span v-if="btRunning"><q-icon name="progress-activity" size="14px" /> Running…</span>
                  <span v-else><q-icon name="analytics" size="14px" />Run backtest</span>
                </button>
              </div>
              <div v-if="btResult" class="dp-section">
                <div class="dp-section-head">Results</div>
                <div style="font-size:22px;font-weight:700;margin-bottom:4px">{{ btResult.fires }} fires</div>
                <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">{{ btResult.period }}</div>
                <div v-if="btResult.samples?.length">
                  <div class="dp-section-head">Sample matches</div>
                  <div v-for="(s, i) in btResult.samples" :key="i"
                    style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
                    <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                      <span class="mono">{{ s.time }}</span>
                      <span class="status" :class="s.status === 'TP' ? 'closed' : 'triage'">{{ s.status }}</span>
                    </div>
                    <div style="color:var(--text-2)">{{ s.user || s.host }} {{ s.countries || s.cmd || '' }}</div>
                  </div>
                </div>
              </div>
            </template>
          </div>
          <!-- Footer actions -->
          <div class="dp-footer">
            <button class="btn" style="flex:1;justify-content:center" @click="dpTab = 'backtest'">
              <q-icon name="analytics" size="13px" />Backtest
            </button>
            <button class="btn" style="flex:1;justify-content:center">
              <q-icon name="edit" size="13px" />Edit rule
            </button>
            <button class="btn primary" style="flex:1;justify-content:center" @click="toggleRule(rules.find(r => r.id === selectedRule!.id)!)">
              {{ selectedRule.enabled ? 'Disable' : 'Enable' }}
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <!-- New Detection modal -->
    <Transition name="fade">
      <div v-if="showNewModal" class="modal-backdrop" @click.self="showNewModal = false">
        <div class="modal">
          <div class="modal-head">
            <h3>New Detection</h3>
            <div style="display:flex;gap:6px;margin-left:auto;align-items:center">
              <select class="inline-sel" v-model="newSev">
                <option value="crit">Critical</option>
                <option value="high">High</option>
                <option value="med">Medium</option>
                <option value="low">Low</option>
              </select>
              <select class="inline-sel" v-model="newType">
                <option value="scheduled">Scheduled</option>
                <option value="streaming">Streaming</option>
                <option value="correlation">Correlation</option>
              </select>
              <button class="btn" style="height:28px;padding:0 10px;font-size:12px" @click="showNewModal = false">✕</button>
            </div>
          </div>
          <div class="modal-body">
            <div class="modal-tabs">
              <span class="modal-tab" :class="{ on: newTab === 'sigma' }" @click="newTab = 'sigma'">Sigma YAML</span>
              <span class="modal-tab" :class="{ on: newTab === 'sql' }" @click="newTab = 'sql'">SQL</span>
            </div>

            <template v-if="newTab === 'sigma'">
              <div class="form-group">
                <label>Sigma rule</label>
                <textarea class="form-input" v-model="sigmaYaml" rows="14" />
              </div>
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
                <button class="btn" @click="compile" style="flex:0 0 auto">
                  <span v-if="isCompiling"><q-icon name="progress-activity" size="14px" />Compiling…</span>
                  <span v-else><q-icon name="code" size="14px" />Compile → SQL</span>
                </button>
                <span style="font-size:12px;color:var(--text-3)">Sigma YAML is compiled to SQL and registered as an OpenObserve alert</span>
              </div>
              <div v-if="compiledSql" class="form-group">
                <label>Compiled SQL preview</label>
                <div class="code-preview">{{ compiledSql }}</div>
              </div>
            </template>

            <template v-else>
              <div class="form-group">
                <label>SQL query (runs against security_events)</label>
                <textarea class="form-input" v-model="sqlQuery" rows="8" />
              </div>
              <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">
                Query must return rows to fire the detection. Use <span class="chip accent" style="font-size:11px">osm.*</span> aliases or full OCSF paths.
                Time window is controlled by the schedule/stream config.
              </div>
            </template>

            <div class="form-group">
              <label style="display:flex;align-items:center;gap:10px">
                <div class="toggle" :class="{ on: newEnabled }" @click="newEnabled = !newEnabled" style="flex-shrink:0"><i /></div>
                Enable immediately after save
              </label>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn" @click="showNewModal = false">Cancel</button>
            <button class="btn" @click="showNewModal = false">Save as draft</button>
            <button class="btn primary" @click="showNewModal = false">
              <q-icon name="check" size="14px" />Save & {{ newEnabled ? 'enable' : 'keep disabled' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Standalone Backtest modal (from header button) -->
    <Transition name="fade">
      <div v-if="showBacktest" class="modal-backdrop" @click.self="showBacktest = false">
        <div class="modal" style="max-width:520px">
          <div class="modal-head">
            <h3>Backtest a detection</h3>
            <button class="btn" style="height:28px;padding:0 10px;font-size:12px;margin-left:auto" @click="showBacktest = false">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Select rule</label>
              <select class="form-input">
                <option v-for="d in rules.filter(r => r.enabled)" :key="d.id" :value="d.id">{{ d.name }}</option>
              </select>
            </div>
            <div style="display:flex;gap:10px">
              <div class="form-group" style="flex:1">
                <label>From</label>
                <input class="form-input" type="date" v-model="btFrom" />
              </div>
              <div class="form-group" style="flex:1">
                <label>To</label>
                <input class="form-input" type="date" v-model="btTo" />
              </div>
            </div>
            <div v-if="btResult" style="margin-top:6px">
              <div style="font-size:22px;font-weight:700;margin-bottom:4px">{{ btResult.fires }} fires</div>
              <div style="font-size:12px;color:var(--text-3)">{{ btResult.period }}</div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn" @click="showBacktest = false">Cancel</button>
            <button class="btn primary" @click="runBacktest">
              <span v-if="btRunning"><q-icon name="progress-activity" size="14px" />Running…</span>
              <span v-else><q-icon name="analytics" size="14px" />Run backtest</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
