<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Detection rule catalog. Phase 0 lists real OpenObserve alerts tagged
     context_attributes.siem=true. Create/edit stores a Sigma YAML plus
     compiled SQL as the alert's query_condition.

     Sprint 3: replace mock list with GET /api/v2/{org}/alerts + siem filter. -->
<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import alertsService from "@/services/alerts";
import "@/views/Security/security.scss";

const store = useStore();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

// ── State ─────────────────────────────────────────────────────────────────────
const rules   = ref<any[]>([]);
const loading = ref(true);
const error   = ref("");
const filter  = ref("");
const showNew = ref(false);
const selected = ref<any | null>(null);
const activeTab = ref<"detail" | "sigma">("detail");

// ── Fetch real alerts tagged siem=true ────────────────────────────────────────
async function fetchRules() {
  if (!orgId.value) return;
  loading.value = true;
  error.value = "";
  try {
    const res = await alertsService.list(0, 1000, "name", false, "", orgId.value);
    const all: any[] = res.data?.list ?? [];
    // Include all scheduled/real-time alerts — show SIEM-tagged ones with badge
    rules.value = all;
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? "Failed to load detection rules";
  } finally {
    loading.value = false;
  }
}

onMounted(fetchRules);

const filtered = computed(() =>
  rules.value.filter((r: any) =>
    !filter.value || r.name.toLowerCase().includes(filter.value.toLowerCase()),
  ),
);

function isSiem(rule: any): boolean {
  return (
    rule.context_attributes?.siem === true ||
    rule.context_attributes?.siem === "true"
  );
}

function openDetail(rule: any) {
  selected.value = rule;
  activeTab.value = "detail";
}

async function toggleRule(rule: any) {
  // Optimistic toggle — Sprint 3: PUT /api/{org}/{stream}/alerts/{name} { enabled: !rule.enabled }
  rule.enabled = !rule.enabled;
}

function severityOf(rule: any): string {
  return rule.context_attributes?.severity ?? rule.severity ?? "medium";
}

function mitreOf(rule: any): string[] {
  return rule.context_attributes?.mitre_techniques ?? [];
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── New rule ──────────────────────────────────────────────────────────────────
const newSigma = ref(`title: My Detection Rule
status: experimental
description: |
  Detects ...
tags:
  - attack.t1078
  - attack.initial_access
logsource:
  product: okta
  service: systemlog
detection:
  selection:
    activity_name: Logon
    metadata.product.name: okta
  condition: selection
level: high`);

function saveSigma() {
  // Sprint 3: compile newSigma → SQL, POST /api/{org}/{stream}/alerts with context_attributes.siem=true
  showNew.value = false;
}
</script>

<template>
  <div class="sec-page" style="flex-direction:row;">
    <!-- Rule list -->
    <div class="det-list">
      <div class="sec-toolbar">
        <OIcon name="shield-alert-outline" size="sm" class="det-accent" />
        <span class="text-sm font-semibold">Detections</span>
        <div class="flex-1" />
        <button class="det-new-btn" @click="showNew = true">
          <OIcon name="add-circle" size="sm" />
          New Rule
        </button>
      </div>

      <div class="det-filter-bar">
        <input v-model="filter" class="det-search" placeholder="Search rules…" />
        <button class="det-refresh" @click="fetchRules">
          <OIcon name="restart-alt" size="sm" />
        </button>
      </div>

      <!-- Loading / error / empty -->
      <div v-if="loading" class="det-loading">
        <OIcon name="hourglass-empty" size="sm" />
        Loading detection rules…
      </div>
      <div v-else-if="error" class="det-error">
        <OIcon name="error-outline" size="sm" />
        {{ error }}
      </div>
      <div v-else-if="!rules.length" class="det-empty-state">
        <OIcon name="shield-alert-outline" size="lg" class="det-dim" />
        <div class="det-empty-title">No detection rules yet</div>
        <div class="det-empty-sub">
          Create a Sigma-based rule to start detecting threats. Rules are stored as
          OpenObserve scheduled alerts with SIEM context.
        </div>
        <button class="det-new-btn-lg" @click="showNew = true">
          <OIcon name="add-circle" size="sm" />
          Create First Rule
        </button>
      </div>

      <!-- Rules -->
      <div v-else class="det-rows">
        <div
          v-for="rule in filtered"
          :key="rule.uuid ?? rule.name"
          class="det-row"
          :class="{ 'det-row--active': selected?.uuid === rule.uuid || selected?.name === rule.name }"
          @click="openDetail(rule)"
        >
          <div class="det-row-head">
            <span :class="['sev-badge', 'sev-' + severityOf(rule)]">{{ severityOf(rule) }}</span>
            <span class="det-name">{{ rule.name }}</span>
            <span v-if="isSiem(rule)" class="det-siem-badge">SIEM</span>
          </div>
          <div class="det-row-meta">
            <span class="det-source">{{ rule.stream_name }}</span>
            <span v-for="t in mitreOf(rule)" :key="t" class="mitre-chip">{{ t }}</span>
          </div>
          <div class="det-row-foot">
            <button
              class="det-toggle"
              :class="rule.enabled ? 'det-toggle--on' : 'det-toggle--off'"
              @click.stop="toggleRule(rule)"
            >{{ rule.enabled ? "Enabled" : "Disabled" }}</button>
            <span class="det-time">{{ relTime(rule.updated_at ?? rule.created_at) }}</span>
          </div>
        </div>
        <div v-if="!filtered.length && filter" class="det-empty">
          No rules match "{{ filter }}"
        </div>
      </div>
    </div>

    <!-- Detail panel -->
    <div v-if="selected" class="det-detail">
      <div class="det-detail-head">
        <span :class="['sev-badge', 'sev-' + severityOf(selected)]">{{ severityOf(selected) }}</span>
        <span class="det-detail-title">{{ selected.name }}</span>
        <button class="det-close-btn" @click="selected = null">✕</button>
      </div>

      <div class="det-detail-tabs">
        <button
          v-for="tab in ['detail', 'sigma'] as const"
          :key="tab"
          class="det-tab"
          :class="{ 'det-tab--active': activeTab === tab }"
          @click="activeTab = tab"
        >{{ tab === "detail" ? "Details" : "Rule / Query" }}</button>
      </div>

      <div class="det-detail-body">
        <template v-if="activeTab === 'detail'">
          <div class="det-kv-grid">
            <div class="kv-row"><span class="kv-key">Stream</span><span class="kv-val mono">{{ selected.stream_name }}</span></div>
            <div class="kv-row"><span class="kv-key">Stream Type</span><span class="kv-val">{{ selected.stream_type }}</span></div>
            <div class="kv-row"><span class="kv-key">Enabled</span><span class="kv-val">{{ selected.enabled ? "Yes" : "No" }}</span></div>
            <div class="kv-row"><span class="kv-key">Type</span><span class="kv-val">{{ selected.is_real_time ? "Real-time" : "Scheduled" }}</span></div>
            <div class="kv-row" v-if="selected.cron_expr"><span class="kv-key">Schedule</span><span class="kv-val mono">{{ selected.cron_expr }}</span></div>
            <div class="kv-row" v-if="selected.query_condition?.sql">
              <span class="kv-key">SQL</span>
              <pre class="kv-pre">{{ selected.query_condition.sql }}</pre>
            </div>
            <div class="kv-row" v-if="mitreOf(selected).length">
              <span class="kv-key">MITRE</span>
              <span class="kv-val" style="display:flex;gap:4px;flex-wrap:wrap;">
                <span v-for="t in mitreOf(selected)" :key="t" class="mitre-chip">{{ t }}</span>
              </span>
            </div>
            <div class="kv-row" v-if="selected.context_attributes">
              <span class="kv-key">Context</span>
              <pre class="kv-pre">{{ JSON.stringify(selected.context_attributes, null, 2) }}</pre>
            </div>
          </div>
        </template>

        <template v-if="activeTab === 'sigma'">
          <div v-if="selected.context_attributes?.sigma_yaml">
            <pre class="sigma-block">{{ selected.context_attributes.sigma_yaml }}</pre>
          </div>
          <div v-else class="det-no-sigma">
            <OIcon name="info-outline" size="sm" />
            No Sigma YAML stored for this rule.
            Rules created outside the SIEM UI may not have Sigma metadata.
          </div>
        </template>
      </div>
    </div>

    <!-- Empty detail placeholder -->
    <div v-else-if="!loading && rules.length" class="det-no-select">
      <OIcon name="shield-alert-outline" size="xl" class="det-dim" />
      <div>Select a rule to view details</div>
    </div>

    <!-- New rule modal -->
    <div v-if="showNew" class="det-modal-backdrop" @click.self="showNew = false">
      <div class="det-modal">
        <div class="det-modal-head">
          <span class="font-semibold text-sm">New Detection Rule</span>
          <button @click="showNew = false" class="det-close-btn">✕</button>
        </div>
        <div class="det-modal-body">
          <p class="det-modal-hint">
            Paste a Sigma YAML rule. It will be compiled to SQL and stored as a
            scheduled OpenObserve alert with <code>context_attributes.siem=true</code>.
          </p>
          <textarea v-model="newSigma" class="sigma-editor" rows="18" spellcheck="false" />
        </div>
        <div class="det-modal-foot">
          <button class="det-cancel-btn" @click="showNew = false">Cancel</button>
          <button class="det-save-btn" @click="saveSigma">
            <OIcon name="play-arrow" size="sm" />
            Compile &amp; Save
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.det-accent { color: #6d5ce0; }
.dark .det-accent { color: #8b90e6; }

.det-list {
  width: 380px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dark .det-list { border-right-color: #232a37; }

.det-filter-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.06));
  flex-shrink: 0;
}
.dark .det-filter-bar { border-bottom-color: #1e2430; }

.det-search {
  flex: 1;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default, rgba(0,0,0,0.10));
  background: transparent;
  font-size: 12.5px;
  color: inherit;
  outline: none;
}
.dark .det-search { border-color: #2a3244; }

.det-refresh {
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  opacity: 0.5;
  padding: 4px;
  border-radius: 5px;
}
.det-refresh:hover { opacity: 1; background: rgba(0,0,0,0.06); }

.det-loading, .det-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 14px;
  font-size: 12.5px;
  opacity: 0.6;
}
.det-error { color: #dc2626; opacity: 1; }
.dark .det-error { color: #f87171; }

.det-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 20px;
  text-align: center;
}
.det-dim { opacity: 0.25; }
.det-empty-title { font-size: 14px; font-weight: 700; }
.det-empty-sub { font-size: 12px; opacity: 0.55; max-width: 300px; line-height: 1.5; }

.det-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 6px;
  background: #6d5ce0;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  border: none;
  cursor: pointer;
}
.det-new-btn:hover { background: #5b4dca; }

.det-new-btn-lg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: 8px;
  background: #6d5ce0;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  border: none;
  cursor: pointer;
  margin-top: 4px;
}
.det-new-btn-lg:hover { background: #5b4dca; }

.det-rows { flex: 1; overflow-y: auto; }

.det-row {
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.05));
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition: background 0.12s;
}
.det-row:hover { background: rgba(109,92,224,0.04); }
.det-row--active { background: rgba(109,92,224,0.09) !important; }
.dark .det-row { border-bottom-color: #1a2030; }
.dark .det-row:hover { background: rgba(139,144,230,0.06); }
.dark .det-row--active { background: rgba(139,144,230,0.11) !important; }

.det-row-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.det-name     { font-size: 12.5px; font-weight: 600; flex: 1; }

.det-siem-badge {
  font-size: 9.5px;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(109,92,224,0.12);
  color: #6d5ce0;
  letter-spacing: 0.3px;
}
.dark .det-siem-badge { background: rgba(139,144,230,0.16); color: #8b90e6; }

.det-row-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.det-source   { font-size: 11px; font-family: monospace; opacity: 0.5; }
.det-row-foot { display: flex; align-items: center; gap: 8px; }
.det-time     { font-size: 11px; opacity: 0.4; margin-left: auto; }

.det-toggle {
  font-size: 10.5px; font-weight: 700;
  padding: 2px 7px; border-radius: 4px; border: none; cursor: pointer;
}
.det-toggle--on  { background: rgba(22,163,74,0.12); color: #16a34a; }
.det-toggle--off { background: rgba(100,116,139,0.10); color: #64748b; }
.dark .det-toggle--on  { background: rgba(22,163,74,0.18); color: #4ade80; }
.dark .det-toggle--off { background: rgba(100,116,139,0.18); color: #94a3b8; }

.det-empty { padding: 20px; text-align: center; opacity: 0.4; font-size: 12.5px; }

/* Detail panel */
.det-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.det-no-select {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  opacity: 0.35;
  font-size: 13px;
}

.det-detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  flex-shrink: 0;
}
.dark .det-detail-head { border-bottom-color: #232a37; }

.det-detail-title { flex: 1; font-weight: 700; font-size: 13px; }
.det-close-btn { background: none; border: none; cursor: pointer; opacity: 0.5; color: inherit; font-size: 15px; line-height: 1; }
.det-close-btn:hover { opacity: 1; }

.det-detail-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  flex-shrink: 0;
}
.dark .det-detail-tabs { border-bottom-color: #232a37; }

.det-tab {
  padding: 8px 16px; font-size: 12px; font-weight: 600;
  border: none; background: none; cursor: pointer; color: inherit; opacity: 0.5;
  border-bottom: 2px solid transparent;
}
.det-tab--active { opacity: 1; border-bottom-color: #6d5ce0; }
.dark .det-tab--active { border-bottom-color: #8b90e6; }

.det-detail-body { flex: 1; overflow-y: auto; padding: 16px; }

.det-kv-grid { display: flex; flex-direction: column; gap: 10px; }
.kv-row { display: flex; gap: 12px; align-items: flex-start; }
.kv-key { font-size: 11px; font-weight: 700; opacity: 0.45; width: 90px; flex-shrink: 0; padding-top: 2px; }
.kv-val { font-size: 12.5px; }
.kv-val.mono { font-family: monospace; font-size: 12px; }
.kv-pre {
  font-family: monospace; font-size: 11.5px; line-height: 1.55;
  white-space: pre-wrap; word-break: break-all;
  background: rgba(0,0,0,0.03); border-radius: 6px; padding: 8px 10px;
  border: 1px solid rgba(0,0,0,0.06); margin: 0; flex: 1;
}
.dark .kv-pre { background: #0e1219; border-color: #1e2430; }

.sigma-block {
  font-family: monospace; font-size: 12px; line-height: 1.6;
  white-space: pre-wrap; background: rgba(0,0,0,0.03);
  border-radius: 8px; padding: 14px;
  border: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  margin: 0;
}
.dark .sigma-block { background: #0e1219; border-color: #232a37; }

.det-no-sigma {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 14px; font-size: 12.5px; opacity: 0.6; line-height: 1.5;
}

/* Modal */
.det-modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 9999;
}
.det-modal {
  width: 600px; max-height: 80vh;
  background: var(--color-surface-panel);
  border-radius: 12px; display: flex; flex-direction: column;
  overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.28);
}
.dark .det-modal { background: #151a23; }
.det-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
}
.dark .det-modal-head { border-bottom-color: #232a37; }
.det-modal-hint { font-size: 12px; opacity: 0.55; margin: 0 0 10px; line-height: 1.5; }
.det-modal-hint code { font-family: monospace; background: rgba(109,92,224,0.10); padding: 0 4px; border-radius: 3px; }
.det-modal-body { flex: 1; overflow-y: auto; padding: 16px 18px; }
.sigma-editor {
  width: 100%; font-family: monospace; font-size: 12.5px; line-height: 1.6;
  padding: 12px; border-radius: 8px;
  border: 1px solid var(--color-border-default, rgba(0,0,0,0.10));
  background: rgba(0,0,0,0.02); color: inherit; resize: vertical; outline: none;
}
.dark .sigma-editor { background: #0e1219; border-color: #232a37; }
.det-modal-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px; border-top: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
}
.dark .det-modal-foot { border-top-color: #232a37; }
.det-cancel-btn {
  padding: 7px 16px; border-radius: 7px;
  border: 1px solid var(--color-border-default, rgba(0,0,0,0.10));
  background: transparent; font-size: 13px; cursor: pointer; color: inherit;
}
.dark .det-cancel-btn { border-color: #2a3244; }
.det-save-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 18px; border-radius: 7px; background: #6d5ce0;
  color: #fff; font-size: 13px; font-weight: 700; border: none; cursor: pointer;
}
.det-save-btn:hover { background: #5b4dca; }
</style>
