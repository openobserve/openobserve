<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — Alerts triage queue: findings from detections, full disposition workflow.
     Phase 1 UI. Wire to security_findings stream + finding_dispositions table. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { ALERTS, ALERT_DETAIL, sevLabel, cap } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");

// ── Reactive alert list with local state ──
const alerts = ref(ALERTS.map((a, i) => ({ ...a, selected: false, index: i })));

const statusTab = ref<"all" | "new" | "triage" | "open" | "closed">("all");
const filterText = ref("");

const filtered = computed(() => {
  let list = alerts.value;
  if (statusTab.value !== "all") list = list.filter(a => a.status === statusTab.value);
  if (filterText.value) {
    const q = filterText.value.toLowerCase();
    list = list.filter(a => a.rule.toLowerCase().includes(q) || a.entity.toLowerCase().includes(q) || a.tech.toLowerCase().includes(q));
  }
  return list;
});

const counts = computed(() => ({
  all:    alerts.value.length,
  new:    alerts.value.filter(a => a.status === "new").length,
  triage: alerts.value.filter(a => a.status === "triage").length,
  open:   alerts.value.filter(a => a.status === "open").length,
  closed: alerts.value.filter(a => a.status === "closed").length,
}));

// ── Bulk select ──
const allSelected = computed(() => filtered.value.length > 0 && filtered.value.every(a => a.selected));
const someSelected = computed(() => filtered.value.some(a => a.selected));
const selectedCount = computed(() => filtered.value.filter(a => a.selected).length);

function toggleAll() {
  const val = !allSelected.value;
  filtered.value.forEach(a => { a.selected = val; });
}
function toggleRow(a: typeof alerts.value[0]) { a.selected = !a.selected; }

// ── Bulk triage ──
const showBulkMenu = ref(false);
function bulkSetStatus(status: string) {
  filtered.value.filter(a => a.selected).forEach(a => { a.status = status as any; a.selected = false; });
  showBulkMenu.value = false;
}

// ── Detail drawer ──
const selectedAlert = ref<typeof alerts.value[0] | null>(null);
const dpTab = ref<"detail" | "evidence" | "timeline">("detail");
const disposition = ref<"" | "tp" | "fp" | "benign" | "dup">("");
const assignee = ref("—");
const showAddCase = ref(false);

function openDetail(a: typeof alerts.value[0]) {
  selectedAlert.value = a;
  dpTab.value = "detail";
  disposition.value = "";
}
function closeDetail() { selectedAlert.value = null; }

function setDisposition(d: typeof disposition.value) { disposition.value = d; }

function closeAlert() {
  if (selectedAlert.value) {
    selectedAlert.value.status = "closed";
    closeDetail();
  }
}

const alertDetail = computed(() =>
  selectedAlert.value ? (ALERT_DETAIL[selectedAlert.value.index] ?? null) : null
);

const ANALYST_OPTIONS = ["—", "a.khan", "m.rossi", "j.torres", "unassigned"];
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <!-- Page header -->
    <div class="pg-head">
      <h1>Alerts</h1>
      <span class="sub">Triage queue · findings from detections · Phase 1</span>
      <span class="spacer" />
      <!-- Bulk triage -->
      <div style="position:relative" v-if="someSelected">
        <button class="btn" @click="showBulkMenu = !showBulkMenu">
          <q-icon name="check-box" size="14px" />Bulk triage ({{ selectedCount }})
          <q-icon name="arrow-drop-down" size="14px" />
        </button>
        <Transition name="fade">
          <div v-if="showBulkMenu"
            style="position:absolute;top:calc(100%+4px);right:0;z-index:40;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);width:180px;overflow:hidden">
            <div v-for="s in ['triage','open','closed']" :key="s"
              @click="bulkSetStatus(s)"
              style="padding:10px 14px;cursor:pointer;font-size:12.5px;font-weight:650"
              :style="{ color: s === 'closed' ? 'var(--ok)' : s === 'triage' ? 'var(--sev-med)' : 'var(--sev-low)' }"
              class="hover-row">
              Set → {{ cap(s) }}
            </div>
          </div>
        </Transition>
      </div>
      <button class="btn primary" @click="showAddCase = true">
        <q-icon name="description" size="14px" />Add to case
      </button>
    </div>

    <!-- KPI strip -->
    <div class="kpis">
      <div class="kpi" v-for="(val, key, i) in { New: counts.new, 'In triage': counts.triage, Open: counts.open, 'Closed today': counts.closed, MTTR: '42m' }" :key="key">
        <div class="label">
          <span class="dot" :style="{ background: ['var(--sev-crit)','var(--sev-med)','var(--sev-low)','var(--ok)','var(--accent)'][i] }" />
          {{ key }}
        </div>
        <div class="val num">{{ val }}</div>
        <div class="delta" :class="i === 0 ? 'up' : i === 4 ? 'down' : 'flat'">
          {{ i === 0 ? '▲ 3' : i === 1 ? '2 analysts' : i === 2 ? 'unassigned' : i === 3 ? '▲ good' : '▼ 8m' }}
        </div>
      </div>
    </div>

    <!-- Toolbar: search + status tabs -->
    <div class="toolbar">
      <span class="search-box" style="flex:1;max-width:380px">
        <q-icon name="search" size="15px" />
        <input v-model="filterText"
          style="flex:1;border:none;outline:none;background:transparent;font-size:12.5px;color:var(--text)"
          placeholder="Filter by entity, rule, technique…" />
      </span>
      <div class="seg">
        <span v-for="s in ['all','new','triage','open','closed'] as const" :key="s"
          :class="{ on: statusTab === s }" @click="statusTab = s">
          {{ s === 'all' ? 'All' : cap(s) }}
          <span style="margin-left:4px;opacity:0.6">({{ counts[s] }})</span>
        </span>
      </div>
    </div>

    <!-- Table + drawer layout -->
    <div style="display:flex;gap:0;align-items:flex-start">
      <div class="card" :style="selectedAlert ? 'flex:1;min-width:0;border-right:none;border-radius:10px 0 0 10px' : 'flex:1'">
        <div class="tablewrap">
          <table class="tbl">
            <thead>
              <tr>
                <th style="width:36px">
                  <div class="cb" :class="{ on: allSelected }" @click="toggleAll" style="cursor:pointer" />
                </th>
                <th>Time</th>
                <th>Detection</th>
                <th>Severity</th>
                <th>Entity</th>
                <th>Technique</th>
                <th>Count</th>
                <th>Assignee</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="a in filtered" :key="a.index"
                style="cursor:pointer"
                :style="selectedAlert?.index === a.index ? { background: 'var(--accent-weak)' } : {}"
                @click="openDetail(a)"
              >
                <td @click.stop>
                  <div class="cb" :class="{ on: a.selected }" @click="toggleRow(a)" style="cursor:pointer" />
                </td>
                <td class="mono" style="white-space:nowrap">{{ a.time }}</td>
                <td>
                  <div class="name">{{ a.rule }}</div>
                </td>
                <td><span class="sev" :class="a.sev">{{ sevLabel(a.sev) }}</span></td>
                <td class="mono">{{ a.entity }}</td>
                <td><span class="chip accent">{{ a.tech }}</span></td>
                <td class="num">{{ a.count }}</td>
                <td class="mono">{{ a.assignee }}</td>
                <td><span class="status" :class="a.status">{{ cap(a.status) }}</span></td>
              </tr>
              <tr v-if="!filtered.length">
                <td colspan="9" style="text-align:center;padding:32px;color:var(--text-3)">No alerts match the current filter</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Detail drawer (inline) — inherits .detail-panel nested styles; inline styles override position/size from CSS -->
      <Transition name="dp-slide">
        <div v-if="selectedAlert" class="detail-panel"
          style="width:460px;flex-shrink:0;border-left:none;border-radius:0 10px 10px 0;max-height:calc(100vh - 200px);position:sticky;top:0;z-index:1;box-shadow:none">
          <!-- Header -->
          <div class="dp-header">
            <span class="sev" :class="selectedAlert.sev" style="flex-shrink:0">{{ sevLabel(selectedAlert.sev) }}</span>
            <h2 style="font-size:13px;line-height:1.3">{{ selectedAlert.rule }}</h2>
            <button class="btn" style="height:26px;padding:0 8px;font-size:11px;flex-shrink:0" @click="closeDetail">✕</button>
          </div>

          <!-- Finding ID + entity -->
          <div style="padding:10px 18px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span v-if="alertDetail" class="mono" style="font-size:11px;color:var(--text-3)">{{ alertDetail.findingUid }}</span>
            <span class="chip">{{ selectedAlert.tech }}</span>
            <span class="chip" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">{{ selectedAlert.entity }}</span>
            <span v-if="alertDetail" style="margin-left:auto;font-size:12px">
              Risk score: <b :style="{ color: alertDetail.riskScore >= 80 ? 'var(--sev-crit)' : alertDetail.riskScore >= 60 ? 'var(--sev-high)' : 'var(--sev-med)' }">{{ alertDetail.riskScore }}</b>
            </span>
          </div>

          <!-- Tabs -->
          <div class="dp-tabs">
            <span :class="{ on: dpTab === 'detail' }"   @click="dpTab = 'detail'">Detail</span>
            <span :class="{ on: dpTab === 'evidence' }" @click="dpTab = 'evidence'">
              Evidence
              <span v-if="alertDetail?.evidences?.length" style="margin-left:3px;opacity:0.6">({{ alertDetail.evidences.length }})</span>
            </span>
            <span :class="{ on: dpTab === 'timeline' }" @click="dpTab = 'timeline'">Timeline</span>
          </div>

          <!-- Body -->
          <div class="dp-body">
            <!-- Detail tab -->
            <template v-if="dpTab === 'detail'">
              <div v-if="alertDetail" class="dp-section">
                <div class="dp-section-head">Description</div>
                <p style="font-size:13px;color:var(--text-2);line-height:1.55;margin:0">{{ alertDetail.description }}</p>
              </div>
              <div class="dp-section">
                <div class="dp-section-head">Finding info</div>
                <div class="dp-kv">
                  <span class="dp-k">time</span>         <span class="dp-v">{{ selectedAlert.time }}</span>
                  <span class="dp-k">entity</span>       <span class="dp-v">{{ selectedAlert.entity }}</span>
                  <span class="dp-k">technique</span>    <span class="dp-v">{{ selectedAlert.tech }}</span>
                  <span class="dp-k">raw events</span>   <span class="dp-v">{{ selectedAlert.count }}</span>
                  <span class="dp-k">status</span>       <span class="dp-v"><span class="status" :class="selectedAlert.status">{{ cap(selectedAlert.status) }}</span></span>
                  <span class="dp-k">assignee</span>     <span class="dp-v">{{ selectedAlert.assignee }}</span>
                </div>
              </div>
              <!-- Disposition controls -->
              <div class="dp-section">
                <div class="dp-section-head">Disposition</div>
                <div class="disp-row">
                  <button class="disp-btn" :class="{ 'on-tp': disposition === 'tp' }"     @click="setDisposition('tp')">True Positive</button>
                  <button class="disp-btn" :class="{ 'on-fp': disposition === 'fp' }"     @click="setDisposition('fp')">False Positive</button>
                  <button class="disp-btn" :class="{ 'on-ben': disposition === 'benign' }" @click="setDisposition('benign')">Benign</button>
                  <button class="disp-btn" :class="{ 'on-dup': disposition === 'dup' }"   @click="setDisposition('dup')">Duplicate</button>
                </div>
                <div class="assignee-row">
                  <span style="font-size:12px;color:var(--text-2)">Assign to</span>
                  <select class="inline-sel" v-model="assignee" style="flex:1">
                    <option v-for="opt in ANALYST_OPTIONS" :key="opt" :value="opt">{{ opt }}</option>
                  </select>
                </div>
              </div>
            </template>

            <!-- Evidence tab -->
            <template v-else-if="dpTab === 'evidence'">
              <div v-if="alertDetail?.evidences?.length" class="evidence-list">
                <div v-for="(ev, i) in alertDetail.evidences" :key="i" class="ev-card">
                  <div class="ev-card-head" @click="$event.currentTarget.closest('.ev-card')!.classList.toggle('open')">
                    <span class="sev" :class="ev.sev">{{ sevLabel(ev.sev) }}</span>
                    <span class="mono" style="font-size:11.5px">{{ ev.time }}</span>
                    <span class="chip" style="font-size:11px">{{ ev.cls }}</span>
                    <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2)">{{ ev.msg }}</span>
                    <q-icon name="expand-more" size="14px" class="muted" />
                  </div>
                  <div class="ev-card-body">
                    <dl>
                      <dt>activity</dt>             <dd>{{ ev.act }}</dd>
                      <dt>actor.user.name</dt>      <dd>{{ ev.user }}</dd>
                      <dt>src_endpoint.ip</dt>      <dd>{{ ev.src }}</dd>
                      <dt>dst_endpoint.ip</dt>      <dd>{{ ev.dst }}</dd>
                      <dt>src_endpoint.geo</dt>     <dd>{{ ev.geo || '—' }}</dd>
                      <dt>metadata.product</dt>     <dd>{{ ev.product }}</dd>
                      <dt>status_id</dt>            <dd>{{ ev.status }}</dd>
                      <dt>message</dt>              <dd>{{ ev.msg }}</dd>
                    </dl>
                  </div>
                </div>
              </div>
              <div v-else style="text-align:center;padding:32px;color:var(--text-3);font-size:13px">
                No evidence events available for this alert in mock data
              </div>
            </template>

            <!-- Timeline tab -->
            <template v-else-if="dpTab === 'timeline'">
              <div v-if="alertDetail?.timeline?.length" class="timeline">
                <div class="tl-row" v-for="(t, i) in alertDetail.timeline" :key="i">
                  <span class="tl-dot" :class="t.dot" />
                  <span class="tl-time">{{ t.time }}</span>
                  <div>
                    <div class="tl-actor">{{ t.actor }}</div>
                    <div class="tl-msg">{{ t.msg }}</div>
                  </div>
                </div>
              </div>
              <div v-else style="text-align:center;padding:32px;color:var(--text-3);font-size:13px">
                No timeline events for this alert in mock data
              </div>
            </template>
          </div>

          <!-- Footer -->
          <div class="dp-footer">
            <button class="btn" style="flex:1;justify-content:center" @click="showAddCase = true">
              <q-icon name="description" size="13px" />Add to case
            </button>
            <button class="btn" style="flex:1;justify-content:center">
              <q-icon name="search" size="13px" />Investigate
            </button>
            <button class="btn primary" style="flex:1;justify-content:center" @click="closeAlert">
              <q-icon name="check" size="13px" />Close alert
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <!-- Add to case modal -->
    <Transition name="fade">
      <div v-if="showAddCase" class="modal-backdrop" @click.self="showAddCase = false">
        <div class="modal" style="max-width:460px">
          <div class="modal-head">
            <h3>Add to case</h3>
            <button class="btn" style="height:28px;padding:0 10px;font-size:12px;margin-left:auto" @click="showAddCase = false">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Select existing case</label>
              <select class="form-input">
                <option>CASE-2041 — Suspected account takeover — j.torres</option>
                <option>CASE-2039 — Possible ransomware staging on WIN-DC01</option>
                <option>CASE-2038 — Public S3 bucket exposure</option>
                <option>CASE-2035 — SSH brute force campaign</option>
                <option>CASE-2031 — Outbound C2 beaconing</option>
              </select>
            </div>
            <div style="text-align:center;font-size:12px;color:var(--text-3);margin:10px 0">— or —</div>
            <div class="form-group">
              <label>Create new case</label>
              <input class="form-input" placeholder="Case title…" />
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn" @click="showAddCase = false">Cancel</button>
            <button class="btn primary" @click="showAddCase = false">
              <q-icon name="check" size="14px" />Add to case
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.hover-row:hover { background: var(--surface-2); }
</style>
