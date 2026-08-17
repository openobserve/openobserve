<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

// ── Props / emits ─────────────────────────────────────────────────────────────
const props = defineProps<{
  event: Record<string, any>;
  stream: string;
  shareUrl?: string;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "add-filter", field: string, value: string): void;
}>();

// ── Tabs ──────────────────────────────────────────────────────────────────────
const tabs = ["Summary", "OCSF", "MITRE", "Sigma", "Raw"] as const;
type Tab = typeof tabs[number];
const activeTab = ref<Tab>("Summary");

// ── Copy helper ───────────────────────────────────────────────────────────────
const copied = ref<string | null>(null);
function copy(text: string, key: string) {
  navigator.clipboard.writeText(text).then(() => {
    copied.value = key;
    setTimeout(() => { copied.value = null; }, 1600);
  });
}
const shareCopied = ref(false);
function copyShare() {
  if (!props.shareUrl) return;
  navigator.clipboard.writeText(props.shareUrl).then(() => {
    shareCopied.value = true;
    setTimeout(() => { shareCopied.value = false; }, 2000);
  });
}

// ── Timestamp ────────────────────────────────────────────────────────────────
function fmtTs(ts: any): string {
  if (!ts) return "—";
  const raw = Number(ts);
  const ms = raw > 1e13 ? raw / 1000 : raw;
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ── Severity ──────────────────────────────────────────────────────────────────
const SEV: Record<number, { label: string; color: string; bg: string }> = {
  5: { label: "Critical", color: "#dc2626", bg: "rgba(220,38,38,0.12)" },
  4: { label: "High",     color: "#ea580c", bg: "rgba(234,88,12,0.12)" },
  3: { label: "Medium",   color: "#ca8a04", bg: "rgba(202,138,4,0.12)" },
  2: { label: "Low",      color: "#2563eb", bg: "rgba(37,99,235,0.12)" },
  1: { label: "Info",     color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};
const sevInfo = computed(() => SEV[Number(props.event.severity_id)] ?? { label: "Unknown", color: "#6b7280", bg: "rgba(107,114,128,0.12)" });

// ── Sigma signals ─────────────────────────────────────────────────────────────
interface Signal { title: string; detail: string; level: "high" | "medium" | "low" }
function computeSignals(ev: Record<string, any>): Signal[] {
  const s: Signal[] = [];
  const v = (key: string) => String(ev[key] ?? ev[key.replace(/\./g, "_")] ?? "");
  const status = v("status_code") || v("status");
  if (/fail|denied|error|401|403|530/i.test(status))
    s.push({ title: "Auth / Access Failure", detail: `status: ${status}`, level: "high" });
  const port = Number(v("dst_endpoint.port") || v("dst_port"));
  if (port && ![80,443,22,21,25,53,3306,5432].includes(port))
    s.push({ title: "Non-Standard Destination Port", detail: `port ${port}`, level: "medium" });
  const LOLBAS = /\b(powershell|cmd\.exe|wscript|cscript|mshta|regsvr32|rundll32|certutil|bitsadmin|wmic|psexec|msiexec|odbcconf|msbuild|cmstp|regasm|installutil|mavinject|mmc|rpcping|dnscmd)\b/i;
  const proc = v("actor.process.name") || v("process_name") || v("process");
  if (LOLBAS.test(proc))
    s.push({ title: "LOLBAS Process Detected", detail: proc, level: "high" });
  const cmdline = v("actor.process.cmd_line") || v("cmdline") || v("command_line");
  if (/[A-Za-z0-9+/]{80,}={0,2}/.test(cmdline) || /base64/i.test(cmdline))
    s.push({ title: "Base64-Encoded Command", detail: cmdline.slice(0, 120), level: "high" });
  const user = v("actor.user.name") || v("user_name");
  if (/admin|root|system|sa\b|dba|svc_/i.test(user))
    s.push({ title: "Privileged Account Activity", detail: `user: ${user}`, level: "medium" });
  const srcIp = v("src_endpoint.ip") || v("src_ip");
  if (srcIp && !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1|fd)/.test(srcIp) && srcIp !== "")
    s.push({ title: "External Source IP", detail: srcIp, level: "low" });
  const domain = v("src_endpoint.hostname") || v("domain");
  if (domain && (domain.match(/\./g) ?? []).length > 5)
    s.push({ title: "Long DNS Subdomain (DGA?)", detail: domain, level: "medium" });
  return s;
}
const sigma = computed(() => computeSignals(props.event));

// ── Risk score ────────────────────────────────────────────────────────────────
const riskScore = computed(() => {
  const base: Record<number, number> = { 5: 90, 4: 70, 3: 45, 2: 20, 1: 5 };
  const b = base[Number(props.event.severity_id)] ?? 10;
  const bonus = sigma.value.filter((s) => s.level === "high").length * 8
    + sigma.value.filter((s) => s.level === "medium").length * 4
    + sigma.value.filter((s) => s.level === "low").length * 2;
  return Math.min(100, b + bonus);
});
const riskLabel = computed(() => riskScore.value >= 90 ? "Critical" : riskScore.value >= 70 ? "High" : riskScore.value >= 40 ? "Medium" : riskScore.value >= 20 ? "Low" : "Info");
const riskColor = computed(() => riskScore.value >= 90 ? "#dc2626" : riskScore.value >= 70 ? "#ea580c" : riskScore.value >= 40 ? "#ca8a04" : riskScore.value >= 20 ? "#2563eb" : "#6b7280");

// ── OCSF catalogue ────────────────────────────────────────────────────────────
const OCSF_CAT: Record<string, { name: string; category: string; description: string; risk: string }> = {
  "1001": { name: "File System Activity",     category: "System",      description: "File read/write/delete/rename activity on the local filesystem.", risk: "Lateral movement via data staging or exfiltration" },
  "2001": { name: "Process Activity",         category: "System",      description: "Process created, terminated, or injected.",                      risk: "Code execution, process injection, persistence" },
  "3001": { name: "Network Activity",         category: "Network",     description: "Network connection or traffic observed.",                        risk: "C2 communication, lateral movement, data exfiltration" },
  "3002": { name: "HTTP Activity",            category: "Application", description: "HTTP/S request or response.",                                    risk: "Web attack, phishing, malicious download" },
  "3005": { name: "DNS Activity",             category: "Network",     description: "DNS query or response.",                                         risk: "DNS tunneling, C2 beaconing, DGA" },
  "4001": { name: "Account Change",           category: "Identity",    description: "Account created, modified, or deleted.",                         risk: "Persistence via new account, privilege escalation" },
  "4002": { name: "Authentication",           category: "Identity",    description: "User login, logout, or failed authentication attempt.",          risk: "Credential stuffing, brute force, lateral movement" },
  "4003": { name: "Authorization",            category: "Identity",    description: "Access granted or denied to a resource.",                       risk: "Privilege abuse, unauthorized access" },
  "5001": { name: "Memory Activity",          category: "System",      description: "Memory read/write or injection into another process.",           risk: "Credential harvesting, code injection" },
};
const ocsfClass = computed(() => OCSF_CAT[String(props.event.class_uid ?? "")] ?? null);

// ── MITRE ATT&CK ─────────────────────────────────────────────────────────────
interface Technique { id: string; name: string; tactic: string; url: string }
const MITRE_MAP: Record<string, Technique[]> = {
  "4002": [
    { id: "T1078", name: "Valid Accounts",               tactic: "Initial Access",    url: "https://attack.mitre.org/techniques/T1078/" },
    { id: "T1110", name: "Brute Force",                  tactic: "Credential Access", url: "https://attack.mitre.org/techniques/T1110/" },
  ],
  "4001": [
    { id: "T1136", name: "Create Account",               tactic: "Persistence",       url: "https://attack.mitre.org/techniques/T1136/" },
    { id: "T1098", name: "Account Manipulation",         tactic: "Persistence",       url: "https://attack.mitre.org/techniques/T1098/" },
  ],
  "3001": [
    { id: "T1071", name: "Application Layer Protocol",   tactic: "C2",                url: "https://attack.mitre.org/techniques/T1071/" },
    { id: "T1041", name: "Exfil Over C2 Channel",        tactic: "Exfiltration",      url: "https://attack.mitre.org/techniques/T1041/" },
  ],
  "3005": [
    { id: "T1071.004", name: "DNS",                      tactic: "C2",                url: "https://attack.mitre.org/techniques/T1071/004/" },
    { id: "T1568",     name: "Dynamic Resolution",       tactic: "C2",                url: "https://attack.mitre.org/techniques/T1568/" },
  ],
  "2001": [
    { id: "T1059", name: "Command & Scripting",          tactic: "Execution",         url: "https://attack.mitre.org/techniques/T1059/" },
    { id: "T1055", name: "Process Injection",            tactic: "Defense Evasion",   url: "https://attack.mitre.org/techniques/T1055/" },
  ],
};
const mitreTechniques = computed(() => MITRE_MAP[String(props.event.class_uid)] ?? []);

// ── Flat field list ───────────────────────────────────────────────────────────
const eventFields = computed(() => {
  const flat: { key: string; value: string }[] = [];
  function walk(obj: Record<string, any>, prefix = "") {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) walk(v, key);
      else flat.push({ key, value: v != null ? String(v) : "" });
    }
  }
  walk(props.event);
  return flat;
});

const SUMMARY_KEYS = [
  "_timestamp","class_uid","class_name","activity_name","severity_id",
  "actor.user.name","actor.process.name","src_endpoint.ip","dst_endpoint.ip",
  "dst_endpoint.port","device.hostname","metadata.product.name","status_code","status","message",
];
const summaryRows = computed(() => {
  const shown = new Set<string>();
  const rows: { key: string; value: string }[] = [];
  for (const k of SUMMARY_KEYS) {
    const f = eventFields.value.find((f) => f.key === k);
    if (f && f.value) { rows.push(f); shown.add(k); }
  }
  for (const f of eventFields.value) {
    if (!shown.has(f.key) && f.value && rows.length < 30) rows.push(f);
  }
  return rows;
});

function prettyKey(k: string) {
  return k.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function sigClass(level: string) {
  return level === "high" ? "sig-high" : level === "medium" ? "sig-med" : "sig-low";
}
</script>

<template>
  <!-- Hosted inside an ODrawer overlay, which owns the panel's edge border. -->
  <div class="sdr-root bg-surface-panel flex flex-col h-full overflow-hidden">

    <!-- ── HEADER ──────────────────────────────────────────────────────────── -->
    <div class="sdr-header border-border-default border-b shrink-0">
      <!-- Top row -->
      <div class="flex items-center gap-3 px-4 pt-3 pb-2">
        <div class="sdr-sev-pill shrink-0" :style="{ color: sevInfo.color, background: sevInfo.bg }">
          {{ sevInfo.label }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-text-primary truncate text-sm font-semibold leading-tight">
            {{ event.class_name || event.activity_name || event.type_name || "Security Event" }}
          </div>
          <div class="text-text-tertiary text-xs mt-0.5 font-mono">{{ fmtTs(event._timestamp) }}</div>
        </div>
        <!-- Risk gauge -->
        <div class="sdr-risk-gauge shrink-0" :style="{ '--risk-c': riskColor }">
          <svg viewBox="0 0 36 36" class="sdr-risk-ring">
            <circle cx="18" cy="18" r="15.9155" fill="none" stroke="currentColor" stroke-width="2.8" opacity="0.12" />
            <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--risk-c)" stroke-width="2.8"
              :stroke-dasharray="`${riskScore} 100`" stroke-linecap="round" transform="rotate(-90 18 18)" />
          </svg>
          <div class="sdr-risk-label" :style="{ color: riskColor }">{{ riskScore }}</div>
        </div>
        <!-- Buttons -->
        <div class="flex items-center gap-1 shrink-0">
          <button v-if="shareUrl" class="sdr-icon-btn" :title="shareCopied ? 'Copied!' : 'Copy link'" @click="copyShare">
            <OIcon :name="shareCopied ? 'done' : 'link'" size="sm" />
          </button>
          <button class="sdr-icon-btn" title="Close" @click="emit('close')">
            <OIcon name="close" size="sm" />
          </button>
        </div>
      </div>

      <!-- Risk bar -->
      <div class="mx-4 mb-2">
        <div class="flex items-center justify-between text-xs mb-1">
          <span class="text-text-secondary font-medium">Risk Score</span>
          <span class="font-bold" :style="{ color: riskColor }">{{ riskLabel }} ({{ riskScore }}/100)</span>
        </div>
        <div class="sdr-risk-bar-track">
          <div class="sdr-risk-bar-fill" :style="{ width: `${riskScore}%`, background: riskColor }" />
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex gap-0 px-1 border-border-default border-t overflow-x-auto">
        <button v-for="tab in tabs" :key="tab" :class="['sdr-tab', { 'sdr-tab--active': activeTab === tab }]" @click="activeTab = tab">
          {{ tab }}
        </button>
      </div>
    </div>

    <!-- ── TAB BODY ─────────────────────────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto min-h-0">

      <!-- Summary -->
      <div v-if="activeTab === 'Summary'" class="p-4 flex flex-col gap-4">
        <div v-if="sigma.length" class="flex flex-col gap-1.5">
          <div class="sdr-section-label">Detection Signals</div>
          <div v-for="(sig, i) in sigma" :key="i" class="sdr-signal" :class="sigClass(sig.level)">
            <div class="flex items-center gap-2">
              <OIcon name="warning-amber" size="xs" class="shrink-0" />
              <span class="font-medium text-xs">{{ sig.title }}</span>
            </div>
            <div class="text-xs opacity-70 mt-0.5 ml-5 font-mono truncate">{{ sig.detail }}</div>
          </div>
        </div>
        <div class="flex flex-col gap-0">
          <div class="sdr-section-label mb-2">Event Fields</div>
          <div v-for="row in summaryRows" :key="row.key" class="sdr-kv-row group">
            <div class="sdr-kv-key" :title="row.key">{{ prettyKey(row.key) }}</div>
            <div class="sdr-kv-val-wrap">
              <span class="sdr-kv-val" :class="{ 'font-mono text-xs': row.key === '_timestamp' }" :title="row.value">
                {{ row.key === "_timestamp" ? fmtTs(row.value) : (row.value || "—") }}
              </span>
              <div class="sdr-kv-actions">
                <button class="sdr-kv-btn" @click="copy(row.value, row.key)">
                  <OIcon :name="copied === row.key ? 'done' : 'content-copy'" size="xs" />
                </button>
                <button v-if="row.value" class="sdr-kv-btn" @click="emit('add-filter', row.key, row.value)">
                  <OIcon name="filter-alt" size="xs" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- OCSF -->
      <div v-if="activeTab === 'OCSF'" class="p-4 flex flex-col gap-4">
        <template v-if="ocsfClass">
          <div class="sdr-ocsf-header">
            <div class="sdr-ocsf-badge">{{ event.class_uid }}</div>
            <div>
              <div class="text-text-primary text-sm font-semibold">{{ ocsfClass.name }}</div>
              <div class="text-text-secondary text-xs mt-0.5">{{ ocsfClass.category }}</div>
            </div>
          </div>
          <p class="text-text-secondary text-xs leading-5">{{ ocsfClass.description }}</p>
          <div class="sdr-ocsf-risk-row">
            <OIcon name="warning-amber" size="xs" class="text-orange-400 shrink-0 mt-0.5" />
            <span class="text-text-secondary text-xs">{{ ocsfClass.risk }}</span>
          </div>
        </template>
        <div v-else class="text-text-tertiary text-sm text-center py-8">
          No OCSF class mapping for class_uid <code class="font-mono">{{ event.class_uid ?? "(not set)" }}</code>
        </div>
        <div class="sdr-section-label mt-2">All Event Fields</div>
        <div class="flex flex-col gap-0">
          <div v-for="row in eventFields.filter(f => !f.key.startsWith('_') && f.value)" :key="row.key" class="sdr-kv-row group">
            <div class="sdr-kv-key font-mono text-xs" :title="row.key">{{ row.key }}</div>
            <div class="sdr-kv-val-wrap">
              <span class="sdr-kv-val font-mono text-xs" :title="row.value">{{ row.value }}</span>
              <div class="sdr-kv-actions">
                <button class="sdr-kv-btn" @click="copy(row.value, row.key)">
                  <OIcon :name="copied === row.key ? 'done' : 'content-copy'" size="xs" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- MITRE -->
      <div v-if="activeTab === 'MITRE'" class="p-4 flex flex-col gap-3">
        <template v-if="mitreTechniques.length">
          <div class="sdr-section-label mb-1">Associated ATT&amp;CK Techniques</div>
          <div v-for="t in mitreTechniques" :key="t.id" class="sdr-mitre-card">
            <div class="flex items-center gap-2 mb-2">
              <span class="sdr-mitre-id">{{ t.id }}</span>
              <span class="text-text-primary text-sm font-semibold">{{ t.name }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="sdr-mitre-tactic">{{ t.tactic }}</span>
              <a :href="t.url" target="_blank" class="sdr-mitre-link">attack.mitre.org ↗</a>
            </div>
          </div>
        </template>
        <div v-else class="text-text-tertiary text-sm text-center py-8">
          No MITRE mapping for class_uid <code class="font-mono">{{ event.class_uid ?? "(not set)" }}</code>
        </div>
      </div>

      <!-- Sigma -->
      <div v-if="activeTab === 'Sigma'" class="p-4 flex flex-col gap-3">
        <template v-if="sigma.length">
          <div class="sdr-section-label mb-1">Active Detection Signals ({{ sigma.length }})</div>
          <div v-for="(sig, i) in sigma" :key="i" class="sdr-sigma-card" :class="sigClass(sig.level)">
            <div class="flex items-center justify-between mb-1">
              <span class="text-text-primary font-semibold text-sm">{{ sig.title }}</span>
              <span class="sdr-sigma-lvl" :class="sigClass(sig.level)">{{ sig.level }}</span>
            </div>
            <div class="font-mono text-xs opacity-70 truncate">{{ sig.detail }}</div>
          </div>
        </template>
        <div v-else class="flex flex-col items-center justify-center py-12 gap-2">
          <OIcon name="check-circle-outline" size="xl" class="text-green-500 opacity-60" />
          <div class="text-text-primary text-sm font-medium">No signals detected</div>
          <div class="text-text-tertiary text-xs">This event matches no built-in detection patterns</div>
        </div>
      </div>

      <!-- Raw JSON -->
      <div v-if="activeTab === 'Raw'" class="p-4">
        <div class="flex items-center justify-between mb-2">
          <div class="sdr-section-label">Raw Event JSON</div>
          <button class="sdr-kv-btn flex items-center gap-1" @click="copy(JSON.stringify(event, null, 2), '__raw__')">
            <OIcon :name="copied === '__raw__' ? 'done' : 'content-copy'" size="xs" />
            <span class="text-xs">{{ copied === '__raw__' ? 'Copied!' : 'Copy all' }}</span>
          </button>
        </div>
        <pre class="sdr-raw-json">{{ JSON.stringify(event, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<style>
/* Drawer root */
/* Drawer must always be fully opaque — use explicit bg rather than relying
   on CSS token resolution which can differ between builds. */
.sdr-root { background: #f7f7f9; }
.dark .sdr-root { background: #181820; }

.sdr-header { background: #f0f0f4; }
.dark .sdr-header { background: #141418; }

.sdr-sev-pill {
  padding: 3px 10px; border-radius: 99px; font-size: 11px;
  font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; line-height: 1.5;
}

.sdr-risk-gauge { position: relative; width: 44px; height: 44px; flex-shrink: 0; }
.sdr-risk-ring { width: 100%; height: 100%; color: var(--color-border-default, #e5e7eb); }
.sdr-risk-label {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800; line-height: 1;
}

.sdr-risk-bar-track {
  height: 5px; border-radius: 99px; overflow: hidden;
  background: rgba(0,0,0,0.07);
}
.dark .sdr-risk-bar-track { background: rgba(255,255,255,0.08); }
.sdr-risk-bar-fill { height: 100%; border-radius: 99px; transition: width 0.4s ease; }

.sdr-icon-btn {
  width: 30px; height: 30px; border-radius: 6px; border: none; background: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--color-text-secondary, #6b7280); transition: background 0.1s, color 0.1s;
}
.sdr-icon-btn:hover { background: rgba(0,0,0,0.06); color: var(--color-text-primary, #111); }
.dark .sdr-icon-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }

.sdr-tab {
  padding: 8px 14px; border: none; background: none; cursor: pointer; white-space: nowrap;
  font-size: 12px; font-weight: 500; color: var(--color-text-secondary, #6b7280);
  border-bottom: 2px solid transparent; transition: color 0.1s, border-color 0.1s;
}
.sdr-tab:hover { color: var(--color-text-primary, #111); }
.dark .sdr-tab:hover { color: #fff; }
.sdr-tab--active { color: #6d5ce0 !important; border-bottom-color: #6d5ce0; }

.sdr-section-label {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--color-text-tertiary, #9ca3af);
}

.sdr-kv-row {
  display: flex; align-items: flex-start; gap: 8px; padding: 5px 0;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.05));
}
.sdr-kv-key {
  flex-shrink: 0; width: 136px; font-size: 11px; color: var(--color-text-tertiary, #9ca3af);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-top: 1px;
}
.sdr-kv-val-wrap { flex: 1; min-width: 0; display: flex; align-items: flex-start; gap: 4px; }
.sdr-kv-val {
  flex: 1; min-width: 0; font-size: 12px; color: var(--color-text-primary, #111);
  overflow-wrap: anywhere; word-break: break-all;
}
.dark .sdr-kv-val { color: #e5e7eb; }
.sdr-kv-actions { display: flex; gap: 2px; flex-shrink: 0; opacity: 0; transition: opacity 0.1s; }
.sdr-kv-row:hover .sdr-kv-actions { opacity: 1; }
.sdr-kv-btn {
  display: flex; align-items: center; padding: 2px 4px; border-radius: 4px;
  border: none; background: none; cursor: pointer; transition: background 0.1s;
  color: var(--color-text-tertiary, #9ca3af);
}
.sdr-kv-btn:hover { background: rgba(109,92,224,0.1); color: #6d5ce0; }

.sdr-signal {
  padding: 7px 10px; border-radius: 6px; border-left: 3px solid transparent;
}
.sig-high { background: rgba(220,38,38,0.07);  border-left-color: #dc2626; }
.sig-med  { background: rgba(202,138,4,0.07);  border-left-color: #ca8a04; }
.sig-low  { background: rgba(37,99,235,0.07);  border-left-color: #2563eb; }
.dark .sig-high { background: rgba(220,38,38,0.12); }
.dark .sig-med  { background: rgba(202,138,4,0.12); }
.dark .sig-low  { background: rgba(37,99,235,0.12); }

.sdr-sigma-card {
  padding: 12px 14px; border-radius: 8px; margin-bottom: 8px; border: 1px solid transparent;
}
.sdr-sigma-card.sig-high { background: rgba(220,38,38,0.06); border-color: rgba(220,38,38,0.2); }
.sdr-sigma-card.sig-med  { background: rgba(202,138,4,0.06); border-color: rgba(202,138,4,0.2); }
.sdr-sigma-card.sig-low  { background: rgba(37,99,235,0.06); border-color: rgba(37,99,235,0.18); }
.dark .sdr-sigma-card.sig-high { background: rgba(220,38,38,0.1);  border-color: rgba(220,38,38,0.3); }
.dark .sdr-sigma-card.sig-med  { background: rgba(202,138,4,0.1);  border-color: rgba(202,138,4,0.3); }
.dark .sdr-sigma-card.sig-low  { background: rgba(37,99,235,0.1);  border-color: rgba(37,99,235,0.25); }
.sdr-sigma-lvl {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  padding: 1px 6px; border-radius: 3px;
}
.sdr-sigma-lvl.sig-high { background: rgba(220,38,38,0.15); color: #dc2626; }
.sdr-sigma-lvl.sig-med  { background: rgba(202,138,4,0.15); color: #ca8a04; }
.sdr-sigma-lvl.sig-low  { background: rgba(37,99,235,0.15); color: #2563eb; }

.sdr-ocsf-header { display: flex; align-items: flex-start; gap: 12px; }
.sdr-ocsf-badge {
  padding: 4px 10px; border-radius: 6px; font-family: monospace; font-size: 13px; font-weight: 700;
  flex-shrink: 0; background: rgba(109,92,224,0.1); color: #6d5ce0;
}
.dark .sdr-ocsf-badge { background: rgba(109,92,224,0.2); color: #a78bfa; }
.sdr-ocsf-risk-row {
  display: flex; gap: 8px; align-items: flex-start; padding: 10px; border-radius: 6px;
  background: rgba(234,88,12,0.07); border: 1px solid rgba(234,88,12,0.15);
}

.sdr-mitre-card {
  padding: 12px 14px; border-radius: 8px; margin-bottom: 8px;
  border: 1px solid var(--color-border-default, rgba(0,0,0,0.07));
  background: rgba(0,0,0,0.015);
}
.dark .sdr-mitre-card { background: rgba(255,255,255,0.025); border-color: rgba(255,255,255,0.06); }
.sdr-mitre-id {
  padding: 2px 8px; border-radius: 4px; font-family: monospace; font-size: 11px; font-weight: 700;
  background: rgba(109,92,224,0.12); color: #6d5ce0;
}
.dark .sdr-mitre-id { background: rgba(109,92,224,0.22); color: #a78bfa; }
.sdr-mitre-tactic {
  display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 10px; font-weight: 600;
  background: rgba(0,0,0,0.05); color: var(--color-text-secondary, #6b7280);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.dark .sdr-mitre-tactic { background: rgba(255,255,255,0.07); }
.sdr-mitre-link { font-size: 11px; color: #6d5ce0; text-decoration: none; }
.sdr-mitre-link:hover { text-decoration: underline; }

.sdr-raw-json {
  font-size: 11px; font-family: monospace; line-height: 1.7; overflow-x: auto; white-space: pre;
  color: var(--color-text-primary, #111); padding: 12px 14px; border-radius: 8px;
  background: rgba(0,0,0,0.025); border: 1px solid var(--color-border-default, rgba(0,0,0,0.07));
}
.dark .sdr-raw-json { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.06); color: #e5e7eb; }
</style>
