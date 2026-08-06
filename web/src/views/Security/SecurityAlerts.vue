<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Security Alerts — finding triage queue.
     Sprint 4: replace mock with GET /api/{org}/alert_history filtered to SIEM alerts. -->
<script setup lang="ts">
import { ref, computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { ALERTS, ALERT_DETAIL, sevLabel, cap, type Alert, type AlertStatus, type Disposition } from "./mockData";
import "@/views/Security/security.scss";

const alerts = ref(ALERTS.map((a, i) => ({ ...a, selected: false, index: i })));

// ── Filter / tabs ────────────────────────────────────────────────────────────
const statusTab  = ref<"open" | "ack" | "closed" | "all">("open");
const filterText = ref("");

const filtered = computed(() =>
  alerts.value.filter(a => {
    if (statusTab.value !== "all" && a.status !== statusTab.value) return false;
    if (filterText.value) {
      const q = filterText.value.toLowerCase();
      return a.ruleName.toLowerCase().includes(q) || a.user.includes(q) || a.src.includes(q);
    }
    return true;
  }),
);

const counts = computed(() => ({
  open:   alerts.value.filter(a => a.status === "open").length,
  ack:    alerts.value.filter(a => a.status === "ack").length,
  closed: alerts.value.filter(a => a.status === "closed").length,
  all:    alerts.value.length,
}));

// ── Bulk triage ──────────────────────────────────────────────────────────────
const selectedIds = computed(() => alerts.value.filter(a => a.selected).map(a => a.id));

function bulkSetStatus(status: AlertStatus) {
  alerts.value.forEach(a => { if (a.selected) { a.status = status; a.selected = false; } });
  // Sprint 4: PUT /api/{org}/alerts/{uuid} for each
}

function toggleAll() {
  const f = filtered.value;
  const allOn = f.every(a => a.selected);
  f.forEach(a => { a.selected = !allOn; });
}

// ── Detail drawer ────────────────────────────────────────────────────────────
const selectedAlert = ref<(typeof alerts.value[0]) | null>(null);
const dpTab = ref<"detail" | "evidence" | "timeline">("detail");

function openAlert(a: typeof alerts.value[0]) {
  selectedAlert.value = a;
  dpTab.value = "detail";
}

// ── Disposition ──────────────────────────────────────────────────────────────
function setDisposition(disp: Disposition) {
  if (!selectedAlert.value) return;
  selectedAlert.value.disposition = disp;
  selectedAlert.value.status = "closed";
  // Sprint 4: PUT /api/{org}/alerts/{uuid} with disposition label
}

// ── Add to case modal ────────────────────────────────────────────────────────
const showCaseModal = ref(false);
const caseTitle     = ref("");

function createCase() {
  if (!selectedAlert.value || !caseTitle.value.trim()) return;
  selectedAlert.value.caseId = `c-${Date.now()}`;
  showCaseModal.value = false;
  caseTitle.value = "";
  // Sprint 5: POST /api/{org}/alert_incidents
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function severityClass(sev: string) { return `sev-${sev}`; }
function statusClass(status: string) { return `status-${status}`; }

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function detailFields(alert: typeof alerts.value[0]): Record<string, string> {
  return ALERT_DETAIL[alert.id] ?? {
    "actor.user.name":       alert.user,
    "src_endpoint.ip":       alert.src,
    "device.hostname":       alert.host,
    "_timestamp":            alert.triggeredAt,
  };
}
</script>

<template>
  <div class="sec-page" style="flex-direction:row;">
    <!-- Alert list -->
    <div class="al-list">
      <!-- Toolbar -->
      <div class="sec-toolbar">
        <OIcon name="notifications-active" size="sm" style="color:#ea580c" />
        <span class="text-sm font-semibold">Alert Triage</span>
        <div class="flex-1" />
        <template v-if="selectedIds.length">
          <button class="al-bulk-btn al-bulk-ack" @click="bulkSetStatus('ack')">Acknowledge</button>
          <button class="al-bulk-btn al-bulk-close" @click="bulkSetStatus('closed')">Close</button>
        </template>
      </div>

      <!-- Status tabs -->
      <div class="al-tabs">
        <button
          v-for="tab in ['open','ack','closed','all'] as const"
          :key="tab"
          class="al-tab"
          :class="{ 'al-tab--active': statusTab === tab }"
          @click="statusTab = tab"
        >
          {{ cap(tab) }}
          <span class="al-tab-count">{{ counts[tab] }}</span>
        </button>
      </div>

      <!-- Filter bar -->
      <div class="al-filter-bar">
        <input v-model="filterText" class="al-filter-input" placeholder="Search rule, user, IP…" />
        <label class="al-select-all" @click="toggleAll">
          <input type="checkbox" :checked="filtered.every(a=>a.selected)" style="pointer-events:none;" />
          All
        </label>
      </div>

      <!-- Alert rows -->
      <div class="al-rows">
        <div
          v-for="alert in filtered"
          :key="alert.id"
          class="al-row"
          :class="{ 'al-row--active': selectedAlert?.id === alert.id }"
          @click="openAlert(alert)"
        >
          <input
            type="checkbox"
            v-model="alert.selected"
            @click.stop
            class="al-check"
          />
          <div class="al-row-body">
            <div class="al-row-top">
              <span :class="['sev-badge', severityClass(alert.severity)]">{{ alert.severity }}</span>
              <span class="al-rule">{{ alert.ruleName }}</span>
            </div>
            <div class="al-row-meta">
              <span class="al-mono">{{ alert.user }}</span>
              <span class="al-sep">·</span>
              <span class="al-mono">{{ alert.src }}</span>
              <div class="flex-1" />
              <span :class="['status-badge', statusClass(alert.status)]">{{ cap(alert.status) }}</span>
              <span v-if="alert.disposition" :class="['status-badge', 'status-' + alert.disposition]">{{ alert.disposition.toUpperCase() }}</span>
            </div>
            <div class="al-row-foot">
              <span v-for="t in alert.mitre" :key="t" class="mitre-chip">{{ t }}</span>
              <div class="flex-1" />
              <span class="al-time">{{ relTime(alert.triggeredAt) }}</span>
            </div>
          </div>
        </div>

        <div v-if="!filtered.length" class="al-empty">
          <OIcon name="check-circle" size="xl" style="display:block;margin:0 auto 8px;opacity:0.3;" />
          No alerts match this view
        </div>
      </div>
    </div>

    <!-- Detail panel -->
    <div v-if="selectedAlert" class="detail-panel" style="position:sticky;width:460px;">
      <!-- Header -->
      <div class="dp-header">
        <span :class="['sev-badge', severityClass(selectedAlert.severity)]">{{ sevLabel(selectedAlert.severity) }}</span>
        <span class="dp-title">{{ selectedAlert.ruleName }}</span>
        <button class="dp-close" @click="selectedAlert = null">✕</button>
      </div>

      <!-- Disposition buttons -->
      <div class="dp-dispositions">
        <button class="on-tp"  :class="{ active: selectedAlert.disposition==='tp' }"  @click="setDisposition('tp')">True Positive</button>
        <button class="on-fp"  :class="{ active: selectedAlert.disposition==='fp' }"  @click="setDisposition('fp')">False Positive</button>
        <button class="on-ben" :class="{ active: selectedAlert.disposition==='benign' }" @click="setDisposition('benign')">Benign</button>
        <button class="on-dup" :class="{ active: selectedAlert.disposition==='duplicate' }" @click="setDisposition('duplicate')">Duplicate</button>
      </div>

      <!-- Tabs -->
      <div class="dp-tabs">
        <button v-for="tab in ['detail','evidence','timeline'] as const" :key="tab"
          class="dp-tab" :class="{ 'dp-tab--active': dpTab === tab }" @click="dpTab = tab">
          {{ cap(tab) }}
        </button>
      </div>

      <!-- Body -->
      <div class="dp-body">
        <!-- Detail -->
        <template v-if="dpTab === 'detail'">
          <div class="dp-kv-grid">
            <div v-for="(val, key) in detailFields(selectedAlert)" :key="key" class="dp-kv-row">
              <span class="dp-kv-key">{{ key }}</span>
              <span class="dp-kv-val">{{ val }}</span>
            </div>
          </div>
        </template>

        <!-- Evidence (OCSF fields) -->
        <template v-if="dpTab === 'evidence'">
          <div class="ev-card">
            <div class="ev-card-head">Authentication Event</div>
            <div class="dp-kv-grid">
              <div v-for="(val, key) in detailFields(selectedAlert)" :key="key" class="dp-kv-row">
                <span class="dp-kv-key">{{ key }}</span>
                <span class="dp-kv-val">{{ val }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- Timeline -->
        <template v-if="dpTab === 'timeline'">
          <div class="tl-row">
            <div class="tl-dot tl-dot--alert" />
            <div class="tl-content">
              <span class="tl-time">{{ relTime(selectedAlert.triggeredAt) }}</span>
              <span class="tl-text">Alert triggered by <strong>{{ selectedAlert.ruleName }}</strong></span>
            </div>
          </div>
          <div class="tl-row">
            <div class="tl-dot" />
            <div class="tl-content">
              <span class="tl-time">{{ relTime(selectedAlert.triggeredAt) }}</span>
              <span class="tl-text">Login from <strong>{{ selectedAlert.src }}</strong> (unusual location)</span>
            </div>
          </div>
        </template>
      </div>

      <!-- Footer -->
      <div class="dp-footer">
        <template v-if="!selectedAlert.caseId">
          <button class="dp-case-btn" @click="showCaseModal = true">
            <OIcon name="folder-open" size="sm" />
            Open Case
          </button>
        </template>
        <template v-else>
          <span class="dp-case-link">Case: {{ selectedAlert.caseId }}</span>
        </template>
      </div>
    </div>

    <!-- Add to case modal -->
    <div v-if="showCaseModal" class="det-modal-backdrop" @click.self="showCaseModal = false">
      <div class="det-modal" style="width:420px;">
        <div class="det-modal-head">
          <span class="font-semibold text-sm">Open Case</span>
          <button @click="showCaseModal = false" style="background:none;border:none;cursor:pointer;opacity:0.6;font-size:16px;color:inherit;line-height:1;">✕</button>
        </div>
        <div class="det-modal-body">
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px;">Case Title</label>
          <input v-model="caseTitle" class="al-filter-input" placeholder="Suspicious Okta logins — J. Torres" style="width:100%;" />
        </div>
        <div class="det-modal-foot">
          <button class="det-cancel-btn" @click="showCaseModal = false">Cancel</button>
          <button class="det-save-btn" @click="createCase">Create Case</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* Alert list */
.al-list {
  width: 480px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dark .al-list { border-right-color: #232a37; }

.al-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  flex-shrink: 0;
}
.dark .al-tabs { border-bottom-color: #232a37; }

.al-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  opacity: 0.55;
  border-bottom: 2px solid transparent;
}
.al-tab--active { opacity: 1; border-bottom-color: #6d5ce0; }
.dark .al-tab--active { border-bottom-color: #8b90e6; }

.al-tab-count {
  font-size: 10.5px;
  font-weight: 700;
  background: rgba(0,0,0,0.07);
  padding: 1px 5px;
  border-radius: 10px;
}
.dark .al-tab-count { background: rgba(255,255,255,0.10); }

.al-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.06));
  flex-shrink: 0;
}
.dark .al-filter-bar { border-bottom-color: #1e2430; }

.al-filter-input {
  flex: 1;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default, rgba(0,0,0,0.10));
  background: transparent;
  font-size: 12.5px;
  color: inherit;
  outline: none;
}
.dark .al-filter-input { border-color: #2a3244; }

.al-select-all {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  cursor: pointer;
  user-select: none;
  opacity: 0.6;
}

.al-rows { flex: 1; overflow-y: auto; }

.al-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.05));
  cursor: pointer;
  transition: background 0.12s;
}
.al-row:hover { background: rgba(109,92,224,0.04); }
.al-row--active { background: rgba(109,92,224,0.08) !important; }
.dark .al-row { border-bottom-color: #1a2030; }
.dark .al-row:hover { background: rgba(139,144,230,0.06); }
.dark .al-row--active { background: rgba(139,144,230,0.10) !important; }

.al-check { margin-top: 3px; flex-shrink: 0; }

.al-row-body { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.al-row-top  { display: flex; align-items: center; gap: 7px; }
.al-rule     { font-size: 12.5px; font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.al-row-meta { display: flex; align-items: center; gap: 5px; }
.al-mono     { font-family: monospace; font-size: 11px; opacity: 0.7; }
.al-sep      { opacity: 0.3; }
.al-row-foot { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.al-time     { font-size: 11px; opacity: 0.4; }
.al-empty    { padding: 28px; text-align: center; opacity: 0.4; font-size: 12.5px; }

.al-bulk-btn {
  padding: 4px 10px;
  border-radius: 5px;
  font-size: 11.5px;
  font-weight: 700;
  border: none;
  cursor: pointer;
}
.al-bulk-ack   { background: rgba(109,92,224,0.12); color: #6d5ce0; }
.al-bulk-close { background: rgba(100,116,139,0.10); color: #64748b; }
.dark .al-bulk-ack   { background: rgba(139,144,230,0.16); color: #8b90e6; }
.dark .al-bulk-close { background: rgba(100,116,139,0.18); color: #94a3b8; }

/* Detail panel */
.detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  flex-shrink: 0;
}
.dark .dp-header { border-bottom-color: #232a37; }

.dp-title { flex: 1; font-weight: 700; font-size: 13px; }

.dp-close {
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.5;
  color: inherit;
}
.dp-close:hover { opacity: 1; }

.dp-dispositions {
  display: flex;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.06));
  flex-shrink: 0;
  flex-wrap: wrap;
}
.dark .dp-dispositions { border-bottom-color: #1e2430; }

.on-tp, .on-fp, .on-ben, .on-dup {
  padding: 4px 10px;
  border-radius: 5px;
  font-size: 11.5px;
  font-weight: 700;
  border: 1px solid;
  cursor: pointer;
  transition: all 0.12s;
}
.on-tp  { border-color: #dc2626; color: #dc2626; background: transparent; }
.on-fp  { border-color: #16a34a; color: #16a34a; background: transparent; }
.on-ben { border-color: #3b82f6; color: #3b82f6; background: transparent; }
.on-dup { border-color: #ca8a04; color: #ca8a04; background: transparent; }
.on-tp.active  { background: rgba(220,38,38,0.12); }
.on-fp.active  { background: rgba(22,163,74,0.12); }
.on-ben.active { background: rgba(59,130,246,0.10); }
.on-dup.active { background: rgba(202,138,4,0.12); }

.dp-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  flex-shrink: 0;
}
.dark .dp-tabs { border-bottom-color: #232a37; }

.dp-tab {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  opacity: 0.5;
  border-bottom: 2px solid transparent;
}
.dp-tab--active { opacity: 1; border-bottom-color: #6d5ce0; }
.dark .dp-tab--active { border-bottom-color: #8b90e6; }

.dp-body { flex: 1; overflow-y: auto; padding: 14px 16px; }

.dp-kv-grid { display: flex; flex-direction: column; gap: 8px; }
.dp-kv-row  { display: flex; gap: 10px; align-items: flex-start; }
.dp-kv-key  { font-size: 10.5px; font-weight: 700; opacity: 0.4; width: 180px; flex-shrink: 0; padding-top: 2px; font-family: monospace; }
.dp-kv-val  { font-size: 12px; font-family: monospace; word-break: break-all; }

.ev-card {
  border: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 10px;
}
.dark .ev-card { border-color: #232a37; }

.ev-card-head {
  padding: 7px 12px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(0,0,0,0.03);
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.06));
}
.dark .ev-card-head { background: rgba(255,255,255,0.03); border-bottom-color: #1e2430; }

.ev-card .dp-kv-grid { padding: 10px 12px; }

.tl-row {
  display: flex;
  gap: 12px;
  padding: 8px 0;
  position: relative;
}

.tl-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(109,92,224,0.3);
  flex-shrink: 0;
  margin-top: 5px;
}
.tl-dot--alert { background: #ea580c; }

.tl-content { display: flex; flex-direction: column; gap: 2px; }
.tl-time { font-size: 10.5px; opacity: 0.4; }
.tl-text { font-size: 12.5px; }

.dp-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.dark .dp-footer { border-top-color: #232a37; }

.dp-case-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 7px;
  border: 1px solid var(--color-border-default, rgba(0,0,0,0.12));
  background: transparent;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  color: inherit;
}
.dark .dp-case-btn { border-color: #2a3244; }
.dp-case-btn:hover { background: rgba(109,92,224,0.06); }

.dp-case-link {
  font-size: 12px;
  opacity: 0.6;
  font-family: monospace;
}

/* Reuse det-modal styles from SecurityDetections */
.det-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.det-modal {
  width: 600px;
  max-height: 80vh;
  background: var(--color-surface-panel);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,0.28);
}
.dark .det-modal { background: #151a23; }
.det-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
}
.dark .det-modal-head { border-bottom-color: #232a37; }
.det-modal-body { flex: 1; overflow-y: auto; padding: 16px 18px; }
.det-modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
}
.dark .det-modal-foot { border-top-color: #232a37; }
.det-cancel-btn {
  padding: 7px 16px;
  border-radius: 7px;
  border: 1px solid var(--color-border-default, rgba(0,0,0,0.10));
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  color: inherit;
}
.dark .det-cancel-btn { border-color: #2a3244; }
.det-save-btn {
  padding: 7px 18px;
  border-radius: 7px;
  background: #6d5ce0;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  border: none;
  cursor: pointer;
}
.det-save-btn:hover { background: #5b4dca; }
</style>
