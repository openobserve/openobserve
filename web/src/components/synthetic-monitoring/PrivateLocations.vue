// Copyright 2026 OpenObserve Inc.
<template>
  <div class="pl-root">
    <div class="pl-grid">
      <OCard v-for="loc in locations" :key="loc.id" class="pl-card">
        <div class="pl-card-header">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="dot" :class="loc.status === 'Online' ? 'dot--up' : 'dot--down'" />
            <span class="pl-card-title">{{ loc.name }}</span>
          </div>
          <div style="display:flex;align-items:center;gap:2px">
            <OButton variant="ghost" size="icon" title="Edit" data-test="private-locations-edit-btn"><OIcon name="edit" size="sm" /></OButton>
            <OButton variant="destructive" size="icon" title="Remove" data-test="private-locations-remove-btn"><OIcon name="delete" size="sm" /></OButton>
          </div>
        </div>
        <div class="pl-card-region"><OIcon name="location-on" size="xs" class="pl-icon-muted" />{{ loc.region }}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="pl-status-chip" :class="loc.status === 'Online' ? 'chip-g' : 'chip-r'">{{ loc.status }}</span>
          <span class="pl-ver">v{{ loc.version }}</span>
        </div>
        <div class="pl-divider" />
        <div class="pl-stats">
          <div class="pl-stat"><div class="pl-stat-val">{{ loc.monitors }}</div><div class="pl-stat-label">Monitors</div></div>
          <div class="pl-stat-sep" />
          <div class="pl-stat"><div class="pl-stat-val">{{ loc.workers }}</div><div class="pl-stat-label">Workers</div></div>
          <div class="pl-stat-sep" />
          <div class="pl-stat"><div class="pl-stat-val">{{ loc.checks }}</div><div class="pl-stat-label">Checks/min</div></div>
        </div>
        <div class="pl-last-seen"><OIcon name="schedule" size="xs" class="pl-icon-muted" />Last seen {{ loc.lastSeen }}</div>
      </OCard>

      <OCard class="pl-card pl-card--add" data-test="private-locations-add-card">
        <OIcon name="add-circle" size="lg" class="pl-icon-muted" />
        <div style="font-size:13px;font-weight:600;margin-top:10px">Add private location</div>
        <div style="font-size:11px;color:var(--o2-tab-text-color);margin-top:4px;text-align:center;line-height:1.5">Run checks from your servers, VPC, or on-premise network</div>
        <OButton variant="primary" size="sm" class="tw:mt-3" data-test="private-locations-get-started-btn">Get started</OButton>
      </OCard>
    </div>

    <div class="pl-guide">
      <div class="pl-guide-header"><OIcon name="code" size="sm" class="pl-icon-primary" />Setting up a private location agent</div>
      <div class="pl-guide-steps">
        <div class="pl-guide-step">
          <div class="pl-step-num">1</div>
          <div class="pl-step-body">
            <div class="pl-step-title">Deploy the agent</div>
            <div class="pl-step-desc">Run the container on any machine in your network — Docker, Kubernetes, or native binary.</div>
            <OCodeBlock :code="dockerInstallCmd" lang="bash" chrome="editor" filename="Docker" />
          </div>
        </div>
        <div class="pl-guide-step">
          <div class="pl-step-num">2</div>
          <div class="pl-step-body">
            <div class="pl-step-title">Register the location</div>
            <div class="pl-step-desc">Click <strong>Add Location</strong>, give it a name, and paste the API key printed by the agent on first start.</div>
          </div>
        </div>
        <div class="pl-guide-step">
          <div class="pl-step-num">3</div>
          <div class="pl-step-body">
            <div class="pl-step-title">Assign to monitors</div>
            <div class="pl-step-desc">Select this location when creating or editing any monitor. Checks will run from your own infrastructure.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OCard from '@/lib/core/Card/OCard.vue'
import OCodeBlock from '@/lib/core/Code/OCodeBlock.vue'

export interface PrivateLocation {
  id: number
  name: string
  region: string
  status: string
  monitors: number
  workers: number
  checks: number
  version: string
  lastSeen: string
}

defineProps<{
  locations: PrivateLocation[]
}>()

const dockerInstallCmd = `docker run -d \\
  -e O2_PRIVATE_LOC_KEY=<your_key> \\
  -e O2_ENDPOINT=https://your-openobserve-host \\
  openobserve/syn-agent:latest`
</script>

<style scoped>
.pl-root    { flex:1; overflow-y:auto; padding:16px 20px 24px; }
.pl-grid    { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px; margin-bottom:20px; }
.pl-card    { border:1px solid var(--o2-border-color); border-radius:10px; padding:18px; display:flex; flex-direction:column; gap:8px; }
.pl-card--add { border-style:dashed; align-items:center; justify-content:center; min-height:160px; cursor:pointer; text-align:center; transition:background .12s; }
.pl-card--add:hover { background:rgba(128,128,128,.06); }
.pl-card-header { display:flex; align-items:center; justify-content:space-between; }
.pl-card-title  { font-size:14px; font-weight:700; }
.pl-card-region { display:flex; align-items:center; gap:4px; font-size:12px; color:var(--o2-tab-text-color); }
.pl-status-chip { font-size:11px; font-weight:700; padding:2px 8px; border-radius:5px; }
.chip-g { background:#dcfce7; color:#15803d; }
.chip-r { background:#fee2e2; color:#dc2626; }
.body--dark .chip-g { background:#052e16; color:#4ade80; }
.body--dark .chip-r { background:#450a0a; color:#f87171; }
.pl-ver { font-size:11px; padding:2px 7px; background:rgba(128,128,128,.15); border-radius:4px; font-family:monospace; color:var(--o2-tab-text-color); }
.pl-divider { height:1px; background:var(--o2-border-color); }
.pl-stats   { display:grid; grid-template-columns:1fr auto 1fr auto 1fr; align-items:center; }
.pl-stat    { display:flex; flex-direction:column; gap:2px; }
.pl-stat-val   { font-size:17px; font-weight:800; line-height:1.1; }
.pl-stat-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--o2-tab-text-color); }
.pl-stat-sep   { width:1px; height:28px; background:var(--o2-border-color); margin:0 10px; }
.pl-last-seen  { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--o2-tab-text-color); }
.pl-guide        { background:var(--o2-card-background); border:1px solid var(--o2-border-color); border-radius:10px; padding:20px 22px; }
.pl-guide-header { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700; margin-bottom:18px; }
.pl-guide-steps  { display:flex; flex-direction:column; gap:18px; }
.pl-guide-step   { display:flex; gap:14px; }
.pl-step-num     { width:24px; height:24px; border-radius:50%; background:var(--o2-primary-color); color:var(--o2-text-inverse); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; flex-shrink:0; margin-top:1px; }
.pl-step-body    { flex:1; }
.pl-step-title   { font-size:13px; font-weight:700; margin-bottom:3px; }
.pl-step-desc    { font-size:12px; color:var(--o2-tab-text-color); line-height:1.5; }
.pl-icon-muted   { color:var(--o2-tab-text-color); flex-shrink:0; }
.pl-icon-primary { color:var(--o2-primary-color); flex-shrink:0; }
.dot       { display:inline-block; border-radius:50%; flex-shrink:0; width:8px; height:8px; box-shadow:none; }
.dot--up   { background:#22c55e; }
.dot--down { background:#ef4444; }
</style>
