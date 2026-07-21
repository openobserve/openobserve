<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Security (SIEM) — Explore Events: SQL hunt over security_events (OCSF). Phase 1 UI.
     Data: mocked. Wire to _search POST /api/{org}/security_events/_search in Phase 1. -->
<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { useStore } from "vuex";
import "./security.scss";
import { EVENTS, OSM_FIELDS, SAVED_QUERIES, sevLabel } from "./mockData";

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");

// ── Query bar ──
const query    = ref("osm.product = 'okta' AND activity_name = 'Logon' AND severity_id >= 4");
const timeRange = ref("1h");
const isRunning = ref(false);
const showOsmPicker  = ref(false);
const showSavedDrop  = ref(false);
const osmSearch      = ref("");
const showSaveModal  = ref(false);
const saveName       = ref("");

const osmGroups = computed(() => {
  const q = osmSearch.value.toLowerCase();
  const filtered = q ? OSM_FIELDS.filter(f => f.alias.includes(q) || f.path.includes(q) || f.desc.toLowerCase().includes(q)) : OSM_FIELDS;
  const groups: Record<string, typeof OSM_FIELDS> = {};
  filtered.forEach(f => { (groups[f.group] = groups[f.group] || []).push(f); });
  return groups;
});

function insertField(alias: string) {
  query.value += (query.value ? " AND " : "") + alias;
  showOsmPicker.value = false;
}

function loadSaved(sq: typeof SAVED_QUERIES[0]) {
  query.value = sq.query;
  showSavedDrop.value = false;
}

function runQuery() {
  isRunning.value = true;
  setTimeout(() => { isRunning.value = false; }, 600);
}

function closeDropdowns(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (!t.closest(".osm-picker")) showOsmPicker.value = false;
  if (!t.closest(".saved-picker")) showSavedDrop.value = false;
}
onMounted(() => document.addEventListener("click", closeDropdowns));
onBeforeUnmount(() => document.removeEventListener("click", closeDropdowns));

// ── Events table ──
const expanded = ref<number | null>(null);
const toggle   = (i: number) => (expanded.value = expanded.value === i ? null : i);

// KPI numbers derived from mock events
const critCount  = computed(() => EVENTS.filter(e => e.sev === "crit").length);
const srcCount   = computed(() => new Set(EVENTS.map(e => e.product)).size);
const userCount  = computed(() => new Set(EVENTS.map(e => e.user).filter(Boolean)).size);
</script>

<template>
  <div class="o2sec" :class="{ dark: isDark }">
    <!-- Page header -->
    <div class="pg-head">
      <h1>Explore Events</h1>
      <span class="badge accent">OCSF · security_events</span>
      <span class="sub">Hunt over normalized events · Phase 1 (mock)</span>
      <span class="spacer" />
      <!-- Saved queries -->
      <div class="saved-picker" style="position:relative">
        <button class="btn" @click.stop="showSavedDrop = !showSavedDrop; showOsmPicker = false">
          <q-icon name="bookmark" size="14px" />Saved queries
          <q-icon name="arrow_drop_down" size="14px" />
        </button>
        <Transition name="fade">
          <div v-if="showSavedDrop" class="saved-drop">
            <div class="sq-row" v-for="sq in SAVED_QUERIES" :key="sq.id" @click="loadSaved(sq)">
              <div class="sq-name">{{ sq.name }}</div>
              <div class="sq-query">{{ sq.query }}</div>
              <div style="font-size:11px;color:var(--text-3);margin-top:2px">{{ sq.author }} · {{ sq.created }}</div>
            </div>
          </div>
        </Transition>
      </div>
      <button class="btn" @click="showSaveModal = true">
        <q-icon name="save" size="14px" />Save query
      </button>
    </div>

    <!-- Query bar -->
    <div class="query-bar">
      <!-- OSM field picker -->
      <div class="osm-picker">
        <button class="btn" style="white-space:nowrap" @click.stop="showOsmPicker = !showOsmPicker; showSavedDrop = false">
          <q-icon name="data-plus-line" size="14px" />Fields
        </button>
        <Transition name="fade">
          <div v-if="showOsmPicker" class="osm-drop">
            <div class="osm-search">
              <q-icon name="search" size="14px" />
              <input v-model="osmSearch" placeholder="Search OSM fields…" @click.stop />
            </div>
            <template v-for="(fields, group) in osmGroups" :key="group">
              <div class="osm-group-head">{{ group }}</div>
              <div class="osm-field" v-for="f in fields" :key="f.alias" @click="insertField(f.alias)">
                <span class="osm-alias">{{ f.alias }}</span>
                <span class="osm-path">{{ f.path }}</span>
              </div>
            </template>
            <div v-if="!Object.keys(osmGroups).length" style="padding:12px;color:var(--text-3);text-align:center;font-size:12px">No fields match</div>
          </div>
        </Transition>
      </div>

      <!-- SQL input -->
      <div class="query-input-wrap">
        <textarea
          class="query-input"
          v-model="query"
          rows="1"
          spellcheck="false"
          placeholder="SQL: SELECT * FROM security_events WHERE osm.sev >= 4 …"
          @keydown.ctrl.enter="runQuery"
          @keydown.meta.enter="runQuery"
        />
      </div>

      <!-- Time range -->
      <select class="time-select" v-model="timeRange">
        <option value="15m">Last 15m</option>
        <option value="1h">Last 1h</option>
        <option value="24h">Last 24h</option>
        <option value="7d">Last 7d</option>
        <option value="30d">Last 30d</option>
        <option value="90d">Last 90d</option>
        <option value="custom">Custom…</option>
      </select>

      <!-- Run -->
      <button class="btn primary" @click="runQuery" style="white-space:nowrap;min-width:64px">
        <span v-if="isRunning">
          <q-icon name="progress-activity" size="14px" class="spin" />
        </span>
        <span v-else><q-icon name="play-arrow" size="14px" />Run</span>
      </button>
    </div>

    <!-- KPI strip -->
    <div class="kpis k4" style="margin-bottom:14px">
      <div class="kpi">
        <div class="label">Matched events</div>
        <div class="val num">{{ EVENTS.length.toLocaleString() }}</div>
        <div class="delta flat">in {{ timeRange }}</div>
      </div>
      <div class="kpi">
        <div class="label">Unique users</div>
        <div class="val num">{{ userCount }}</div>
        <div class="delta flat">across {{ srcCount }} sources</div>
      </div>
      <div class="kpi">
        <div class="label">Critical</div>
        <div class="val num" style="color:var(--sev-crit)">{{ critCount }}</div>
        <div class="delta up">▲ spike 10:40</div>
      </div>
      <div class="kpi">
        <div class="label">Sources</div>
        <div class="val num">{{ srcCount }}</div>
        <div class="delta flat">all OCSF-mapped</div>
      </div>
    </div>

    <!-- Events table -->
    <div class="card">
      <header>
        <h3>Events</h3>
        <span class="muted" style="font-size:12px">security_events stream · OCSF normalized</span>
        <span class="spacer" />
        <button class="btn" style="height:26px;font-size:11.5px">
          <q-icon name="add" size="13px" />Add to case
        </button>
      </header>
      <div class="tablewrap">
        <table class="tbl">
          <thead>
            <tr>
              <th style="width:28px"></th>
              <th>_timestamp</th>
              <th>class</th>
              <th>activity</th>
              <th>sev</th>
              <th>actor.user.name</th>
              <th>src_endpoint.ip</th>
              <th>dst_endpoint.ip</th>
              <th>metadata.product</th>
              <th>device.hostname</th>
              <th>status</th>
              <th>message</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(e, i) in EVENTS" :key="i">
              <tr @click="toggle(i)" style="cursor:pointer" :style="expanded === i ? { background: 'var(--surface-2)' } : {}">
                <td>
                  <q-icon :name="expanded === i ? 'expand-more' : 'chevron-right'" size="15px" class="muted" />
                </td>
                <td class="mono" style="white-space:nowrap">{{ e.time }}</td>
                <td><span class="chip">{{ e.cls }}</span></td>
                <td class="mono">{{ e.act }}</td>
                <td><span class="sev" :class="e.sev">{{ sevLabel(e.sev) }}</span></td>
                <td class="mono">{{ e.user || '—' }}</td>
                <td class="mono">{{ e.src || '—' }}</td>
                <td class="mono">{{ e.dst || '—' }}</td>
                <td class="mono">{{ e.product }}</td>
                <td class="mono">{{ e.device || '—' }}</td>
                <td>
                  <span class="status" :class="e.result === 'blocked' ? 'closed' : e.result === 'success' ? 'enabled' : ''">
                    {{ e.result }}
                  </span>
                </td>
                <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2);font-size:12px">{{ e.msg }}</td>
              </tr>
              <!-- Expanded OCSF detail -->
              <tr v-if="expanded === i">
                <td colspan="12" style="padding:0">
                  <div style="display:flex;gap:0;background:var(--surface-2);border-top:1px solid var(--border)">
                    <!-- Left: full KV -->
                    <dl class="kv" style="flex:1.5;padding:14px 18px">
                      <dt>_timestamp</dt>         <dd>{{ e.time }}</dd>
                      <dt>class_name</dt>         <dd>{{ e.cls }}</dd>
                      <dt>activity_name</dt>       <dd>{{ e.act }}</dd>
                      <dt>severity_id</dt>         <dd>{{ { crit:5,high:4,med:3,low:2,info:1 }[e.sev as string] ?? '—' }} ({{ e.sev }})</dd>
                      <dt>actor.user.name</dt>     <dd>{{ e.user || '—' }}</dd>
                      <dt>src_endpoint.ip</dt>     <dd>{{ e.src }}</dd>
                      <dt>src_endpoint.location</dt><dd>{{ e.geo || '—' }}</dd>
                      <dt>dst_endpoint.ip</dt>     <dd>{{ e.dst }}</dd>
                      <dt>device.hostname</dt>     <dd>{{ e.device || '—' }}</dd>
                      <dt>metadata.product.name</dt><dd>{{ e.product }}</dd>
                      <dt>auth_protocol</dt>       <dd>{{ e.mfa || '—' }}</dd>
                      <dt>status_id</dt>           <dd>{{ e.result === 'success' ? '1 (Success)' : e.result === 'blocked' ? '2 (Failure)' : '—' }}</dd>
                      <dt>message</dt>             <dd>{{ e.msg }}</dd>
                    </dl>
                    <!-- Right: quick actions -->
                    <div style="flex-shrink:0;padding:14px 16px;display:flex;flex-direction:column;gap:8px;border-left:1px solid var(--border);min-width:160px">
                      <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.4px">Actions</div>
                      <button class="btn" style="height:28px;font-size:12px;justify-content:flex-start">
                        <q-icon name="search" size="13px" />Pivot on user
                      </button>
                      <button class="btn" style="height:28px;font-size:12px;justify-content:flex-start">
                        <q-icon name="language" size="13px" />Lookup IP
                      </button>
                      <button class="btn" style="height:28px;font-size:12px;justify-content:flex-start">
                        <q-icon name="shield" size="13px" />IOC check
                      </button>
                      <button class="btn" style="height:28px;font-size:12px;justify-content:flex-start">
                        <q-icon name="description" size="13px" />Add to case
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <div style="padding:10px 14px;display:flex;align-items:center;gap:10px;border-top:1px solid var(--border);font-size:12px;color:var(--text-3)">
        <span>Showing {{ EVENTS.length }} of ~18,204 results</span>
        <span class="spacer" />
        <button class="btn" style="height:26px;font-size:11.5px">Load more</button>
        <button class="btn" style="height:26px;font-size:11.5px">
          <q-icon name="download" size="13px" />Export CSV
        </button>
      </div>
    </div>

    <!-- Save query modal -->
    <Transition name="fade">
      <div v-if="showSaveModal" class="modal-backdrop" @click.self="showSaveModal = false">
        <div class="modal" style="max-width:460px">
          <div class="modal-head">
            <h3>Save query</h3>
            <button class="btn" style="height:28px;padding:0 10px;font-size:12px;margin-left:auto" @click="showSaveModal = false">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Name</label>
              <input class="form-input" v-model="saveName" placeholder="e.g. Impossible travel (Okta)" />
            </div>
            <div class="form-group">
              <label>Query</label>
              <textarea class="form-input" :value="query" rows="4" readonly />
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn" @click="showSaveModal = false">Cancel</button>
            <button class="btn primary" @click="showSaveModal = false">Save</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
