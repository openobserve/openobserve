// Copyright 2026 OpenObserve Inc.
<template>
  <ODrawer
    :open="monitor !== null"
    :width="97"
    :show-close="false"
    @update:open="(v) => { if (!v) emit('close') }"
  >
    <template v-if="monitor" #header>
      <div class="dp-hdr">
        <div class="dp-hdr-top">
          <span class="dot" :class="'dot--' + monitor.status.toLowerCase()" style="flex-shrink:0;margin-top:2px" />
          <div class="dp-hdr-titles">
            <div class="dp-title">{{ monitor.name }}</div>
            <div class="dp-url">{{ monitor.url }}</div>
          </div>
          <OButton variant="ghost" size="icon" data-test="monitor-detail-panel-close-btn" @click="emit('close')">
            <OIcon name="close" size="sm" />
          </OButton>
        </div>
        <div class="dp-badges">
          <OBadge :variant="monitorTypeBadgeVariant(monitor.type)" size="sm">{{ monitor.type }}</OBadge>
          <span class="dp-meta-chip">{{ monitor.interval }}</span>
          <span class="dp-meta-chip">{{ monitor.locations.length }} location{{ monitor.locations.length !== 1 ? 's' : '' }}</span>
          <span class="dp-meta-chip">Last: {{ monitor.lastCheck }}</span>
        </div>
      </div>
      <OTabs v-model="tab" class="dp-tabs">
        <OTab name="overview">Overview</OTab>
        <OTab name="logs">Logs <span class="dp-tab-ct">{{ panel?.logs.length }}</span></OTab>
        <OTab name="metrics">Metrics</OTab>
        <OTab name="traces">Traces <span class="dp-tab-ct">{{ panel?.traces.length }}</span></OTab>
      </OTabs>
    </template>

    <template v-if="panel">
      <OTabPanels v-model="tab" scroll="y" class="dp-body">

        <!-- ── OVERVIEW ── -->
        <OTabPanel name="overview">
          <div class="dp-ov-grid">
            <div class="dp-ov-col">
              <div class="dp-kpis">
                <div class="dp-kpi">
                  <div class="dp-kpi-val" :class="panel.monitor.uptime>=99?'c-g':panel.monitor.uptime>=95?'c-a':'c-r'">{{ panel.monitor.uptime }}%</div>
                  <div class="dp-kpi-lbl">Uptime 7d</div>
                </div>
                <div class="dp-kpi">
                  <div class="dp-kpi-val" :class="_rtMs(panel.monitor.responseTime)<600?'c-g':_rtMs(panel.monitor.responseTime)<1200?'c-a':'c-r'">
                    {{ panel.monitor.responseTime ?? '—' }}
                  </div>
                  <div class="dp-kpi-lbl">Avg Response</div>
                </div>
                <div class="dp-kpi"><div class="dp-kpi-val">288</div><div class="dp-kpi-lbl">Checks/day</div></div>
                <div class="dp-kpi">
                  <div class="dp-kpi-val" :class="panel.monitor.status==='Up'?'c-g':panel.monitor.status==='Down'?'c-r':'c-a'">{{ panel.monitor.status }}</div>
                  <div class="dp-kpi-lbl">Status</div>
                </div>
                <div class="dp-kpi">
                  <div class="dp-kpi-val">{{ panel.monitor.status==='Down' ? '~6m' : '0' }}</div>
                  <div class="dp-kpi-lbl">MTTR</div>
                </div>
                <div class="dp-kpi"><div class="dp-kpi-val">{{ panel.incidents.length }}</div><div class="dp-kpi-lbl">Incidents 30d</div></div>
                <div class="dp-kpi">
                  <div class="dp-kpi-val" :class="panel.monitor.uptime>=99?'c-g':'c-a'">{{ panel.monitor.uptime>=99?'✓':'~' }}</div>
                  <div class="dp-kpi-lbl">SLA 99.9%</div>
                </div>
                <div class="dp-kpi"><div class="dp-kpi-val c-g">87d</div><div class="dp-kpi-lbl">SSL Expiry</div></div>
              </div>

              <div class="dp-section">
                <div class="dp-section-title">Response Time · 24h</div>
                <div class="dp-chart24" style="height:80px">
                  <div v-for="(bar, bi) in panel.metricBars" :key="bi"
                    class="dp-bar24"
                    :class="bar.val===null?'dp-bar24--err':bar.val>1000?'dp-bar24--slow':bar.val>600?'dp-bar24--deg':'dp-bar24--ok'"
                    :style="{ height: bar.val ? Math.max(3, Math.round((bar.val/panel.metricMax)*76)) + 'px' : '76px' }"
                    :title="bar.val ? bar.hour+': '+bar.val+'ms' : bar.hour+': Timeout'"/>
                </div>
                <div class="dp-chart24-x"><span>24h ago</span><span>12h ago</span><span>Now</span></div>
              </div>

              <div class="dp-section">
                <div class="dp-section-title">Monitored Locations</div>
                <div class="dp-geo-list">
                  <div v-for="loc in panel.monitor.locations" :key="loc" class="dp-geo-row">
                    <span class="dp-geo-flag">📍</span>
                    <span class="dp-geo-loc">{{ loc }}</span>
                    <span class="geo-cell-dot geo-cdot--up" style="margin-left:auto;flex-shrink:0"/>
                    <span class="dp-geo-ms c-g">Active</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="dp-ov-col">
              <div class="dp-section">
                <div class="dp-section-title">Monitor Configuration</div>
                <div class="dp-cfg-table">
                  <div class="dp-cfg-row"><span class="dp-cfg-key">URL</span><span class="dp-cfg-val">{{ panel.monitor.url }}</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">Check type</span><span class="dp-cfg-val">{{ panel.monitor.type }}</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">HTTP method</span><span class="dp-cfg-val">GET</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">Interval</span><span class="dp-cfg-val">{{ panel.monitor.interval }}</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">Timeout</span><span class="dp-cfg-val">30 seconds</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">Expected status</span><span class="dp-cfg-val">200 OK</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">Follow redirects</span><span class="dp-cfg-val">Yes (max 5)</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">SSL validation</span><span class="dp-cfg-val">Enabled</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">Alert threshold</span><span class="dp-cfg-val">2 consecutive failures</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">Locations</span><span class="dp-cfg-val">{{ panel.monitor.locations.join(', ') }}</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">Last check</span><span class="dp-cfg-val">{{ panel.monitor.lastCheck }}</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">Monitor ID</span><span class="dp-cfg-val" style="font-family:ui-monospace,monospace">{{ panel.monitor.id }}</span></div>
                </div>
              </div>

              <div class="dp-section">
                <div class="dp-section-title">Recent Incidents · 30d</div>
                <div class="dp-incidents">
                  <div v-for="inc in panel.incidents" :key="inc.id" class="dp-incident-row" :class="'dp-inc--'+inc.type">
                    <span class="dp-inc-icon" :class="inc.type==='down'?'c-r':'c-a'">{{ inc.type==='down' ? '✗' : '⚠' }}</span>
                    <div class="dp-inc-body">
                      <div class="dp-inc-title">{{ inc.title }}</div>
                      <div class="dp-inc-meta">{{ inc.start }} · {{ inc.locs }}</div>
                      <div class="dp-inc-id">{{ inc.id }}</div>
                    </div>
                    <span class="dp-inc-dur" :class="inc.type==='down'?'c-r':'c-a'">{{ inc.dur }}</span>
                  </div>
                </div>
              </div>

              <div class="dp-section">
                <div class="dp-section-title">Availability · Last 30 days</div>
                <div class="dp-uptime-cal">
                  <div v-for="(day, di) in panel.uptimeCal" :key="di" class="dp-cal-day" :class="'dp-cal--'+day" :title="'Day '+(30-di)+': '+day"/>
                </div>
                <div class="dp-uptime-legend">
                  <span class="dp-cal-day dp-cal--ok" style="display:inline-block"/><span>Healthy</span>
                  <span class="dp-cal-day dp-cal--deg" style="display:inline-block"/><span>Degraded</span>
                  <span class="dp-cal-day dp-cal--down" style="display:inline-block"/><span>Outage</span>
                </div>
              </div>
            </div>
          </div>
        </OTabPanel>

        <!-- ── LOGS ── -->
        <OTabPanel name="logs">
          <div class="dp-log-filters">
            <OButton v-for="lv in ['ALL','ERROR','WARN','INFO','DEBUG']" :key="lv"
              :variant="dpLogFilter === lv ? 'primary' : 'ghost'"
              size="sm"
              :data-test="'monitor-detail-panel-log-filter-' + lv.toLowerCase()"
              @click="dpLogFilter = lv">
              {{ lv }}
              <span v-if="lv !== 'ALL' && dpLogCounts[lv]" class="dp-tab-ct">{{ dpLogCounts[lv] }}</span>
            </OButton>
            <span style="flex:1"/>
            <span class="dp-log-summary">{{ dpFilteredLogs.length }} entries · window: {{ panel.logs[0]?.time ?? '' }} UTC</span>
            <span class="dp-mocked-pill">mocked</span>
          </div>
          <div class="dp-log-list">
            <template v-for="(log, li) in dpFilteredLogs" :key="li">
              <div class="dp-log-row" :class="{ 'dp-log-row--has-stack': !!log.stack }">
                <span class="dp-log-time">{{ log.time }}</span>
                <span class="dp-log-lvl" :class="'dp-lvl--'+log.level.toLowerCase()">{{ log.level }}</span>
                <span class="dp-log-src">{{ log.logger }}</span>
                <span class="dp-log-msg">{{ log.msg }}</span>
              </div>
              <div v-if="log.stack" class="dp-log-stack">{{ log.stack }}</div>
            </template>
          </div>
        </OTabPanel>

        <!-- ── METRICS ── -->
        <OTabPanel name="metrics">
          <div class="dp-tab-info">
            Aggregated metrics from synthetic check executions — correlated with incident windows
            <span class="dp-mocked-pill">mocked</span>
          </div>
          <div class="dp-metrics-grid">
            <div class="dp-ov-col">
              <div class="dp-section">
                <div class="dp-section-title">Response Time P90 · 24h</div>
                <div class="dp-chart24" style="height:90px">
                  <div v-for="(bar, bi) in panel.metricBars" :key="bi"
                    class="dp-bar24"
                    :class="bar.val===null?'dp-bar24--err':bar.val>1000?'dp-bar24--slow':bar.val>600?'dp-bar24--deg':'dp-bar24--ok'"
                    :style="{ height: bar.val ? Math.max(3, Math.round((bar.val/panel.metricMax)*86)) + 'px' : '86px' }"
                    :title="bar.val ? bar.hour+': '+bar.val+'ms' : bar.hour+': Timeout'"/>
                </div>
                <div class="dp-chart24-x"><span>24h ago</span><span>12h ago</span><span>Now</span></div>
              </div>
              <div class="dp-section">
                <div class="dp-section-title">Latency Percentiles · last 1h</div>
                <div class="dp-pcts">
                  <div class="dp-pct-row"><span class="dp-pct-lbl">P50</span><div class="dp-pct-track"><div class="dp-pct-fill dp-pct-fill--ok" style="width:30%"/></div><span class="dp-pct-val">{{ Math.round(_rtMs(panel.monitor.responseTime)*0.55) }}ms</span></div>
                  <div class="dp-pct-row"><span class="dp-pct-lbl">P75</span><div class="dp-pct-track"><div class="dp-pct-fill dp-pct-fill--ok" style="width:50%"/></div><span class="dp-pct-val">{{ Math.round(_rtMs(panel.monitor.responseTime)*0.82) }}ms</span></div>
                  <div class="dp-pct-row"><span class="dp-pct-lbl">P90</span><div class="dp-pct-track"><div class="dp-pct-fill dp-pct-fill--deg" style="width:65%"/></div><span class="dp-pct-val">{{ panel.monitor.responseTime ?? '220ms' }}</span></div>
                  <div class="dp-pct-row"><span class="dp-pct-lbl">P95</span><div class="dp-pct-track"><div class="dp-pct-fill dp-pct-fill--deg" style="width:76%"/></div><span class="dp-pct-val">{{ Math.round(_rtMs(panel.monitor.responseTime)*1.4) }}ms</span></div>
                  <div class="dp-pct-row"><span class="dp-pct-lbl">P99</span><div class="dp-pct-track"><div class="dp-pct-fill dp-pct-fill--slow" style="width:88%"/></div><span class="dp-pct-val">{{ Math.round(_rtMs(panel.monitor.responseTime)*1.9) }}ms</span></div>
                </div>
              </div>
              <div class="dp-section">
                <div class="dp-section-title">Availability · Last 30 days</div>
                <div class="dp-uptime-cal">
                  <div v-for="(day, di) in panel.uptimeCal" :key="di" class="dp-cal-day" :class="'dp-cal--'+day" :title="'Day '+(30-di)+': '+day"/>
                </div>
                <div class="dp-uptime-legend">
                  <span class="dp-cal-day dp-cal--ok" style="display:inline-block"/><span>Up</span>
                  <span class="dp-cal-day dp-cal--deg" style="display:inline-block"/><span>Degraded</span>
                  <span class="dp-cal-day dp-cal--down" style="display:inline-block"/><span>Down</span>
                </div>
              </div>
            </div>
            <div class="dp-ov-col">
              <div class="dp-section">
                <div class="dp-section-title">Error Rate · 24h</div>
                <div class="dp-chart24" style="height:90px">
                  <div v-for="(val, bi) in panel.errorBars" :key="bi"
                    class="dp-bar24"
                    :class="val>0?'dp-bar24--err':'dp-bar24--zero'"
                    :style="{ height: val>0 ? Math.max(3, Math.round(val*86))+'px' : '3px' }"/>
                </div>
                <div class="dp-chart24-x"><span>24h ago</span><span>12h ago</span><span>Now</span></div>
              </div>
              <div class="dp-section">
                <div class="dp-section-title">By Location · last 24h</div>
                <table class="dp-loc-table">
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th style="text-align:right">Checks</th>
                      <th style="text-align:right">Avg</th>
                      <th style="text-align:right">P90</th>
                      <th style="text-align:right">P99</th>
                      <th style="text-align:right">Err%</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in panel.locBreakdown" :key="row.loc">
                      <td>{{ row.loc }}</td>
                      <td style="text-align:right">{{ row.checks }}</td>
                      <td style="text-align:right" :class="row.avg===null?'c-r':row.avg>600?'c-a':'c-g'">{{ row.avg !== null ? row.avg+'ms' : '—' }}</td>
                      <td style="text-align:right" :class="row.p90===null?'c-r':row.p90>800?'c-a':'c-g'">{{ row.p90 !== null ? row.p90+'ms' : '—' }}</td>
                      <td style="text-align:right" :class="row.p99===null?'c-r':row.p99>1500?'c-a':'c-g'">{{ row.p99 !== null ? row.p99+'ms' : '—' }}</td>
                      <td style="text-align:right" :class="row.errRate==='0.0%'?'c-g':row.errRate==='100%'?'c-r':'c-a'">{{ row.errRate }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="dp-section">
                <div class="dp-section-title">SLA Summary</div>
                <div class="dp-cfg-table">
                  <div class="dp-cfg-row"><span class="dp-cfg-key">SLA target</span><span class="dp-cfg-val">99.9% (8.7h downtime/yr)</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">Current uptime</span><span class="dp-cfg-val" :class="panel.monitor.uptime>=99.9?'c-g':'c-r'">{{ panel.monitor.uptime }}%</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">Downtime this month</span><span class="dp-cfg-val" :class="panel.monitor.status==='Down'?'c-r':'c-g'">{{ panel.monitor.status==='Down' ? '~6 min (ongoing)' : '8 min' }}</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">Incidents 30d</span><span class="dp-cfg-val">{{ panel.incidents.length }}</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">MTTR (avg)</span><span class="dp-cfg-val">~9 min</span></div>
                  <div class="dp-cfg-row"><span class="dp-cfg-key">MTTF (avg)</span><span class="dp-cfg-val">~7.2 days</span></div>
                </div>
              </div>
            </div>
          </div>
        </OTabPanel>

        <!-- ── TRACES ── -->
        <OTabPanel name="traces">
          <div class="dp-req-bar">
            <span class="dp-req-method">GET</span>
            <span class="dp-req-url">{{ panel.monitor.url }}</span>
            <span class="dp-req-badge" :class="panel.monitor.status==='Down'?'dp-req-badge--err':'dp-req-badge--ok'">
              {{ panel.monitor.status === 'Down' ? '503' : '200' }}
            </span>
            <span class="dp-req-dur">{{ panel.traces[0]?.dur >= 1000 ? (panel.traces[0].dur/1000).toFixed(1)+'s' : panel.traces[0]?.dur+'ms' }}</span>
          </div>
          <div class="dp-trace-meta">
            <span>Trace&nbsp;<b style="font-family:ui-monospace,monospace">{{ panel.monitor.id.toString(16).padStart(12,'0') }}af42</b></span>
            <span>14:32:01.100 UTC</span>
            <span>{{ panel.traces.length }} spans</span>
            <span :class="panel.monitor.status==='Down'?'c-r':'c-g'" style="font-weight:600">
              {{ panel.monitor.status === 'Down' ? '✗ Failed' : '✓ Success' }}
            </span>
            <span class="dp-mocked-pill" style="margin-left:auto">mocked</span>
          </div>
          <div class="dp-traces-panes">
            <div class="dp-waterfall-col">
              <div class="dp-wf-hdr">
                <span class="dp-wf-hdr-span">Span</span>
                <span class="dp-wf-hdr-bar">Timeline / Duration</span>
              </div>
              <div v-for="(span, si) in panel.traces" :key="si"
                class="dp-span-row" :class="{ 'dp-span-row--sel': dpSelectedSpan === span }"
                @click="dpSelectedSpan = dpSelectedSpan === span ? null : span">
                <div class="dp-span-label" :style="{ paddingLeft: span.depth * 14 + 6 + 'px' }">
                  <span v-if="span.depth > 0" class="dp-span-tree">└─</span>
                  <span class="dp-span-name" :title="span.name">{{ span.name }}</span>
                  <span v-if="span.status !== null" class="dp-span-code" :class="span.status>=400?'c-r':'c-g'">{{ span.status }}</span>
                </div>
                <div class="dp-span-bar-wrap">
                  <div class="dp-span-bar" :class="'dp-spanc--'+span.color"
                    :style="{ width: Math.max(2, Math.round((span.dur/panel.traces[0].dur)*100))+'%', marginLeft: Math.round((span.offset/panel.traces[0].dur)*100)+'%' }"/>
                  <span class="dp-span-dur">{{ span.dur >= 1000 ? (span.dur/1000).toFixed(1)+'s' : span.dur+'ms' }}</span>
                </div>
              </div>
            </div>
            <div class="dp-span-attr-col">
              <template v-if="dpSelectedSpan">
                <div class="dp-sd-name">{{ dpSelectedSpan.name }}</div>
                <div class="dp-sd-timing">
                  <div class="dp-sd-timing-item">
                    <span class="dp-sd-timing-val" :class="dpSelectedSpan.color==='err'?'c-r':dpSelectedSpan.color==='slow'?'c-a':'c-g'">
                      {{ dpSelectedSpan.dur >= 1000 ? (dpSelectedSpan.dur/1000).toFixed(1)+'s' : dpSelectedSpan.dur+'ms' }}
                    </span>
                    <span class="dp-sd-timing-lbl">Duration</span>
                  </div>
                  <div class="dp-sd-timing-item">
                    <span class="dp-sd-timing-val">+{{ dpSelectedSpan.offset }}ms</span>
                    <span class="dp-sd-timing-lbl">Start offset</span>
                  </div>
                  <div class="dp-sd-timing-item">
                    <span class="dp-sd-timing-val" :class="dpSelectedSpan.color==='err'?'c-r':dpSelectedSpan.color==='slow'?'c-a':'c-g'">
                      {{ dpSelectedSpan.color === 'err' ? 'Error' : dpSelectedSpan.color === 'slow' ? 'Slow' : 'OK' }}
                    </span>
                    <span class="dp-sd-timing-lbl">State</span>
                  </div>
                </div>
                <div class="dp-sd-attrs-title">Attributes</div>
                <div class="dp-sd-attrs">
                  <div v-for="([k,v]) in dpSelectedSpan.attrs" :key="k" class="dp-sd-attr-row">
                    <span class="dp-sd-attr-k">{{ k }}</span>
                    <span class="dp-sd-attr-v">{{ v }}</span>
                  </div>
                </div>
              </template>
              <div v-else class="dp-sd-empty">
                <div style="font-size:22px;margin-bottom:6px">↑</div>
                Click any span to inspect its attributes, timing, and metadata
              </div>
            </div>
          </div>
        </OTabPanel>

      </OTabPanels>
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import ODrawer from '@/lib/overlay/Drawer/ODrawer.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OTabPanels from '@/lib/navigation/Tabs/OTabPanels.vue'
import OTabPanel from '@/lib/navigation/Tabs/OTabPanel.vue'

interface LogEntry { time: string; level: string; logger: string; msg: string; stack?: string }
interface TraceSpan { name: string; dur: number; offset: number; depth: number; status: number | null; color: string; attrs: [string, string][] }
interface Incident  { type: 'down' | 'deg'; id: string; title: string; start: string; dur: string; locs: string }
interface LocRow    { loc: string; checks: number; avg: number | null; p90: number | null; p99: number | null; errRate: string }
interface PanelData {
  monitor: any
  logs: LogEntry[]
  metricBars: { hour: string; val: number | null }[]
  metricMax: number
  errorBars: number[]
  traces: TraceSpan[]
  incidents: Incident[]
  uptimeCal: ('ok' | 'deg' | 'down')[]
  locBreakdown: LocRow[]
}

const props = defineProps<{ monitor: any | null }>()
const emit  = defineEmits<{ close: [] }>()

const tab           = ref<'overview' | 'logs' | 'metrics' | 'traces'>('overview')
const dpLogFilter   = ref('ALL')
const dpSelectedSpan = ref<TraceSpan | null>(null)
const panel          = ref<PanelData | null>(null)

const monitorTypeBadgeVariant = (type: string): string => {
  const map: Record<string, string> = {
    HTTP: 'blue-soft', BROWSER: 'purple-soft', API: 'success-soft',
    TCP: 'orange-soft', PING: 'default-soft', DNS: 'amber-soft',
  }
  return map[type.toUpperCase()] ?? 'default-soft'
}

const _rtMs = (rt: any): number => {
  if (!rt) return 220
  const s = String(rt)
  if (s.endsWith('ms')) return parseFloat(s) || 220
  if (s.endsWith('s'))  return Math.round(parseFloat(s) * 1000) || 220
  return parseFloat(s) || 220
}

const _urlPath = (url: string) => { try { return new URL(url).pathname || '/' } catch { return '/' } }
const _urlHost = (url: string) => { try { return new URL(url).hostname }  catch { return url } }

const _genLogs = (m: any): LogEntry[] => {
  const isDown = m.status === 'Down', isDeg = m.status === 'Degraded'
  const ms   = _rtMs(m.responseTime)
  const path = _urlPath(m.url), host = _urlHost(m.url)
  if (isDown) return [
    { time: '14:32:01.423', level: 'ERROR', logger: 'synthetic.runner', msg: `TCP connection refused: ${m.url}`, stack: `Error: connect ECONNREFUSED 104.21.18.52:443\n  at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1141:16)\n  at SyntheticRunner.executeCheck (runner.js:142:9)\n  at async Runner.run (runner.js:98:5)` },
    { time: '14:32:01.100', level: 'ERROR', logger: 'http.client',      msg: 'Max retries exceeded (3/3) — alerting: monitor marked DOWN' },
    { time: '14:32:00.800', level: 'WARN',  logger: 'synthetic.runner', msg: 'Retry 3/3 — back-off 1000ms; previous error: ECONNREFUSED' },
    { time: '14:31:58.200', level: 'WARN',  logger: 'synthetic.runner', msg: 'Retry 2/3 — back-off 500ms; previous error: ECONNREFUSED' },
    { time: '14:31:57.100', level: 'WARN',  logger: 'synthetic.runner', msg: 'Retry 1/3 — back-off 200ms; previous error: ECONNREFUSED' },
    { time: '14:31:56.910', level: 'ERROR', logger: 'http.client',      msg: `HTTP 503 Service Unavailable — url=${m.url} latency=30004ms` },
    { time: '14:31:56.000', level: 'INFO',  logger: 'synthetic.runner', msg: `Health check initiated: GET ${path} — monitor_id=${m.id} location=US-West` },
    { time: '14:31:55.800', level: 'DEBUG', logger: 'dns.resolver',     msg: `DNS resolved ${host} → 104.21.18.52 in 4ms (ttl=300s cached=false)` },
    { time: '14:26:50.122', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 198ms [200 OK] content_match=true ssl_valid=true` },
    { time: '14:21:45.310', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 214ms [200 OK] content_match=true ssl_valid=true` },
    { time: '14:16:40.088', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 201ms [200 OK] content_match=true ssl_valid=true` },
    { time: '14:11:35.500', level: 'DEBUG', logger: 'tls.client',       msg: `TLS 1.3 resumed — cipher=AES_128_GCM_SHA256 session_id=a3f9b2 resumption_time=8ms` },
    { time: '14:11:35.200', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 188ms [200 OK] content_match=true ssl_valid=true` },
    { time: '14:06:30.500', level: 'DEBUG', logger: 'tls.client',       msg: `TLS 1.3 handshake — cipher=AES_128_GCM_SHA256 cert_expiry=2026-09-14 san_valid=true` },
    { time: '14:06:29.900', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 193ms [200 OK] content_match=true ssl_valid=true` },
  ]
  if (isDeg) return [
    { time: '14:32:01.312', level: 'WARN',  logger: 'synthetic.runner', msg: `Slow response: ${ms}ms (SLA threshold 800ms exceeded by ${ms - 800}ms)` },
    { time: '14:32:00.100', level: 'INFO',  logger: 'http.client',      msg: `Health check passed: 200 OK in ${m.responseTime} — body_match=true` },
    { time: '14:31:59.950', level: 'DEBUG', logger: 'http.timing',      msg: `dns=12ms tcp=18ms tls=28ms ttfb=${Math.round(ms * 0.72)}ms transfer=${Math.round(ms * 0.28)}ms total=${ms}ms` },
    { time: '14:31:59.900', level: 'DEBUG', logger: 'tls.client',       msg: `TLS 1.3 resumed — cipher=AES_128_GCM_SHA256 resumption_time=9ms` },
    { time: '14:27:00.001', level: 'WARN',  logger: 'synthetic.runner', msg: `Response time elevated: 1240ms (threshold: 800ms)` },
    { time: '14:26:59.500', level: 'INFO',  logger: 'http.client',      msg: `Health check passed: 200 OK in 1240ms` },
    { time: '14:22:00.210', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 920ms [200 OK] content_match=true` },
    { time: '14:17:00.085', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 340ms [200 OK] content_match=true` },
    { time: '14:12:00.500', level: 'DEBUG', logger: 'dns.resolver',     msg: `DNS resolved ${host} → 104.21.18.52 in 5ms (cached=true ttl_remaining=180s)` },
    { time: '14:12:00.100', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 280ms [200 OK] content_match=true` },
  ]
  return [
    { time: '14:32:01.100', level: 'INFO',  logger: 'synthetic.runner', msg: `Health check passed: 200 OK in ${m.responseTime ?? '198ms'} content_match=true ssl_valid=true` },
    { time: '14:31:59.900', level: 'DEBUG', logger: 'http.timing',      msg: `dns=${Math.round(ms*0.03)}ms tcp=${Math.round(ms*0.06)}ms tls=${Math.round(ms*0.10)}ms ttfb=${Math.round(ms*0.65)}ms transfer=${Math.round(ms*0.16)}ms` },
    { time: '14:31:59.800', level: 'DEBUG', logger: 'tls.client',       msg: `TLS 1.3 resumed — cipher=AES_128_GCM_SHA256 cert_expiry=2026-09-14 resumption_time=8ms` },
    { time: '14:27:00.200', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 198ms [200 OK] content_match=true ssl_valid=true` },
    { time: '14:22:00.100', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 214ms [200 OK] content_match=true ssl_valid=true` },
    { time: '14:17:00.050', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 189ms [200 OK] content_match=true ssl_valid=true` },
    { time: '14:12:00.080', level: 'DEBUG', logger: 'dns.resolver',     msg: `DNS resolved ${host} → 104.21.18.52 in 4ms (cached=true ttl_remaining=218s)` },
    { time: '14:12:00.050', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 201ms [200 OK] content_match=true ssl_valid=true` },
    { time: '14:07:00.030', level: 'DEBUG', logger: 'ssl.validator',    msg: `SSL cert valid — issuer="Let's Encrypt" expires=2026-09-14 SANs=[${host}]` },
    { time: '14:07:00.000', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 195ms [200 OK] content_match=true ssl_valid=true` },
    { time: '14:02:00.080', level: 'DEBUG', logger: 'http.timing',      msg: `dns=${Math.round(ms*0.03)}ms tcp=${Math.round(ms*0.06)}ms tls=${Math.round(ms*0.10)}ms total=${ms}ms` },
    { time: '14:02:00.000', level: 'INFO',  logger: 'synthetic.runner', msg: `Check passed — 193ms [200 OK] content_match=true ssl_valid=true` },
  ]
}

const _genBars = (m: any) => {
  const base = _rtMs(m.responseTime)
  const bars = []
  for (let i = 23; i >= 0; i--) {
    const h = `${String((new Date().getHours() - i + 24) % 24).padStart(2,'0')}:00`
    const noise = (((m.id * 7 + i * 13) % 60) - 30) / 100
    let val: number | null = Math.round(base * (1 + noise))
    if (m.status === 'Down' && i <= 1) val = null
    else if (m.status === 'Degraded' && i <= 2) val = Math.round(base * 2.8)
    bars.push({ hour: h, val })
  }
  return bars
}

const _genTraces = (m: any): TraceSpan[] => {
  const total = _rtMs(m.responseTime)
  const path  = _urlPath(m.url), host = _urlHost(m.url)
  if (m.status === 'Down') {
    const dns = 6, tcp = 18
    return [
      { name: `GET ${path}`, dur: 30004, offset: 0,        depth: 0, status: 503, color: 'err', attrs: [['http.method','GET'],['http.url',m.url],['http.flavor','1.1'],['net.peer.name',host],['error.type','ECONNREFUSED'],['retry.count','3'],['synthetic.monitor_id',String(m.id)]] },
      { name: 'dns.resolve',         dur: dns,   offset: 0,      depth: 1, status: null, color: 'ok',  attrs: [['dns.hostname',host],['dns.cached','false'],['dns.resolved_ip','104.21.18.52'],['dns.ttl','300'],['dns.query_type','A']] },
      { name: 'tcp.connect',         dur: tcp,   offset: dns,    depth: 1, status: null, color: 'ok',  attrs: [['net.peer.ip','104.21.18.52'],['net.peer.port','443'],['net.transport','tcp']] },
      { name: 'http.request',        dur: 29980, offset: dns+tcp,depth: 1, status: null, color: 'err', attrs: [['http.flavor','1.1'],['http.method','GET'],['http.path',path],['error','socket hang up']] },
      { name: 'socket.wait_timeout', dur: 29960, offset: dns+tcp+20, depth: 2, status: null, color: 'err', attrs: [['timeout_ms','30000'],['error.type','ETIMEDOUT'],['net.peer.ip','104.21.18.52']] },
    ]
  }
  const dns  = Math.round(total * 0.03)
  const tcp  = Math.round(total * 0.06)
  const tls  = Math.round(total * 0.10)
  const send = Math.round(total * 0.04)
  const rcv  = Math.round(total * 0.74)
  const parse = Math.round(total * 0.03)
  return [
    { name: `GET ${path}`,  dur: total, offset: 0,                    depth: 0, status: 200,  color: total>800?'slow':'ok', attrs: [['http.method','GET'],['http.url',m.url],['http.status_code','200'],['http.response_content_type','application/json'],['http.response_size','4.2 KB'],['synthetic.monitor_id',String(m.id)],['synthetic.location',m.locations?.[0]??'US East']] },
    { name: 'dns.resolve',  dur: dns,   offset: 0,                    depth: 1, status: null, color: 'ok',                  attrs: [['dns.hostname',host],['dns.cached','false'],['dns.resolved_ip','104.21.18.52'],['dns.ttl','300'],['dns.query_type','A']] },
    { name: 'tcp.connect',  dur: tcp,   offset: dns,                  depth: 1, status: null, color: 'ok',                  attrs: [['net.peer.ip','104.21.18.52'],['net.peer.port','443'],['net.transport','tcp'],['net.sock.family','inet']] },
    { name: 'tls.handshake',dur: tls,   offset: dns+tcp,              depth: 1, status: null, color: 'ok',                  attrs: [['tls.protocol_version','TLSv1.3'],['tls.cipher','AES_128_GCM_SHA256'],['tls.resumed','false'],['tls.cert_valid','true'],['tls.cert_expiry','2026-09-14']] },
    { name: 'http.send',    dur: send,  offset: dns+tcp+tls,          depth: 1, status: null, color: 'ok',                  attrs: [['http.method','GET'],['http.path',path],['http.host',host],['net.bytes_sent','342']] },
    { name: 'http.receive', dur: rcv,   offset: dns+tcp+tls+send,     depth: 1, status: null, color: total>800?'slow':'ok', attrs: [['http.status_code','200'],['http.status_text','OK'],['http.content_type','application/json'],['net.bytes_received','4296'],['http.ttfb',String(Math.round(rcv*0.85))+'ms']] },
    { name: 'content.parse',dur: parse, offset: dns+tcp+tls+send+rcv, depth: 2, status: null, color: 'ok',                  attrs: [['content.type','json'],['content.size_bytes','4296'],['content.assertions_passed','3'],['content.assertions_failed','0']] },
  ]
}

const _genIncidents = (m: any): Incident[] => {
  const isDown = m.status === 'Down', isDeg = m.status === 'Degraded'
  const id = (n: number) => 'INC-' + String(m.id * 7 + n).padStart(4, '0')
  const list: Incident[] = []
  if (isDown)        list.push({ type: 'down', id: id(1), title: 'Outage — TCP connection refused', start: 'Today 14:31', dur: 'Ongoing', locs: 'US West, AP NE' })
  if (isDown||isDeg) list.push({ type: 'deg',  id: id(2), title: 'Elevated response times (>800ms threshold)', start: 'Jun 17 09:14', dur: '23 min', locs: 'EU West' })
  list.push({ type: 'down', id: id(3), title: 'Scheduled maintenance — planned restart', start: 'Jun 12 02:00', dur: '8 min', locs: 'All locations' })
  list.push({ type: 'deg',  id: id(4), title: 'High TTFB — upstream database slow queries', start: 'Jun 8 15:42', dur: '11 min', locs: 'US East' })
  return list.slice(0, 4)
}

const _genUptimeCal = (m: any): ('ok' | 'deg' | 'down')[] =>
  Array.from({ length: 30 }, (_, i) => {
    const seed = (m.id * 11 + i * 7) % 100
    if (m.status === 'Down' && i === 29) return 'down'
    return seed > 97 ? 'down' : seed > 91 ? 'deg' : 'ok'
  })

const _genLocBreakdown = (m: any): LocRow[] =>
  (m.locations ?? ['US East']).map((loc: string, i: number) => {
    const seed = (m.id * 3 + loc.length * 5 + i) % 20
    const base = _rtMs(m.responseTime)
    const adj  = Math.round(base * (0.7 + seed / 50))
    const isErr    = m.status === 'Down' && (loc.toLowerCase().includes('west') || i === 0)
    const isDegLoc = !isErr && m.status === 'Degraded' && i % 2 === 0
    return { loc, checks: 288, avg: isErr ? null : adj, p90: isErr ? null : Math.round(adj * 1.4), p99: isErr ? null : Math.round(adj * 2.1), errRate: isErr ? '100%' : isDegLoc ? `${seed + 3}%` : '0.0%' }
  })

const dpFilteredLogs = computed(() => {
  if (!panel.value) return [] as LogEntry[]
  if (dpLogFilter.value === 'ALL') return panel.value.logs
  return panel.value.logs.filter((l: LogEntry) => l.level === dpLogFilter.value)
})

const dpLogCounts = computed(() => {
  if (!panel.value) return {} as Record<string, number>
  return panel.value.logs.reduce((acc: Record<string, number>, l: LogEntry) => {
    acc[l.level] = (acc[l.level] ?? 0) + 1; return acc
  }, {} as Record<string, number>)
})

watch(() => props.monitor, (m) => {
  if (!m) {
    panel.value = null
    return
  }
  tab.value = 'overview'
  dpLogFilter.value = 'ALL'
  dpSelectedSpan.value = null
  const bars   = _genBars(m)
  const maxVal = Math.max(...bars.filter((b: any) => b.val !== null).map((b: any) => b.val!), 100)
  const errBars = Array.from({ length: 24 }, (_, i) => {
    if (m.status === 'Down'     && i >= 22) return 1.0
    if (m.status === 'Degraded' && i >= 20) return ((m.id * 3 + i * 7) % 30) / 100
    return 0
  })
  panel.value = {
    monitor: m,
    logs:         _genLogs(m),
    metricBars:   bars, metricMax: maxVal,
    errorBars:    errBars,
    traces:       _genTraces(m),
    incidents:    _genIncidents(m),
    uptimeCal:    _genUptimeCal(m),
    locBreakdown: _genLocBreakdown(m),
  }
}, { immediate: true })
</script>

<style scoped>
/* header */
.dp-hdr { padding:16px 20px 12px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; }
.dp-hdr-top { display:flex; align-items:flex-start; gap:12px; margin-bottom:8px; }
.dp-hdr-titles { flex:1; min-width:0; }
.dp-title { font-size:15px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dp-url   { font-size:12px; color:var(--o2-tab-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
.dp-badges { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.dp-meta-chip { font-size:11px; color:var(--o2-tab-text-color); background:rgba(128,128,128,.1); border-radius:4px; padding:2px 8px; }
/* tabs sticky area in header */
.dp-tabs { border-bottom: none; }
/* tab count badge */
.dp-tab-ct { background:rgba(128,128,128,.15); border-radius:10px; font-size:10px; padding:1px 6px; font-weight:600; }
/* body */
.dp-body { flex:1; overflow-y:auto; overflow-x:hidden; padding:18px 20px; display:flex; flex-direction:column; gap:18px; }
/* two-column layout */
.dp-ov-grid    { display:grid; grid-template-columns:1fr 1fr; gap:22px; align-items:start; }
.dp-metrics-grid { display:grid; grid-template-columns:1fr 1fr; gap:22px; align-items:start; }
.dp-ov-col     { display:flex; flex-direction:column; gap:18px; }
/* KPIs */
.dp-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
.dp-kpi  { background:rgba(128,128,128,.06); border:1px solid var(--o2-border-color); border-radius:8px; padding:10px 12px; }
.dp-kpi-val { font-size:18px; font-weight:700; line-height:1.1; }
.dp-kpi-lbl { font-size:10px; color:var(--o2-tab-text-color); margin-top:4px; }
/* section */
.dp-section { display:flex; flex-direction:column; gap:8px; }
.dp-section-title { font-size:11px; font-weight:600; color:var(--o2-tab-text-color); text-transform:uppercase; letter-spacing:.05em; }
/* 24h bar chart */
.dp-chart24 { display:flex; align-items:flex-end; gap:2px; height:72px; background:rgba(128,128,128,.05); border-radius:6px; padding:4px 6px 0; }
.dp-bar24 { flex:1; border-radius:2px 2px 0 0; transition:height .3s; cursor:default; }
.dp-bar24--ok   { background:#22c55e; }
.dp-bar24--deg  { background:#f59e0b; }
.dp-bar24--slow { background:#f97316; }
.dp-bar24--err  { background:#ef4444; }
.dp-bar24--zero { background:rgba(128,128,128,.15); }
.dp-chart24-x { display:flex; justify-content:space-between; font-size:10px; color:var(--o2-tab-text-color); margin-top:2px; }
/* geo breakdown */
.dp-geo-list { display:flex; flex-direction:column; gap:0; border:1px solid var(--o2-border-color); border-radius:8px; overflow:hidden; }
.dp-geo-row { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--o2-border-color); font-size:12px; }
.dp-geo-row:last-child { border-bottom:none; }
.dp-geo-flag { font-size:14px; flex-shrink:0; }
.dp-geo-loc  { font-weight:600; font-size:12px; }
.dp-geo-ms   { font-size:12px; font-weight:600; margin-left:6px; }
.geo-cell-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
.geo-cdot--up { background:#22c55e; box-shadow:0 0 4px rgba(34,197,94,.6); }
/* config table */
.dp-cfg-table { display:flex; flex-direction:column; border:1px solid var(--o2-border-color); border-radius:8px; overflow:hidden; }
.dp-cfg-row { display:flex; gap:10px; padding:6px 12px; border-bottom:1px solid var(--o2-border-color); font-size:12px; }
.dp-cfg-row:last-child { border-bottom:none; }
.dp-cfg-key { min-width:130px; flex-shrink:0; color:var(--o2-tab-text-color); font-size:11px; }
.dp-cfg-val { font-weight:500; word-break:break-all; }
/* incidents */
.dp-incidents { display:flex; flex-direction:column; border:1px solid var(--o2-border-color); border-radius:8px; overflow:hidden; }
.dp-incident-row { display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border-bottom:1px solid var(--o2-border-color); font-size:12px; }
.dp-incident-row:last-child { border-bottom:none; }
.dp-inc--down { border-left:3px solid #ef4444; }
.dp-inc--deg  { border-left:3px solid #f59e0b; }
.dp-inc-icon  { font-size:15px; flex-shrink:0; font-weight:700; }
.dp-inc-body  { flex:1; min-width:0; }
.dp-inc-title { font-weight:600; margin-bottom:2px; }
.dp-inc-meta  { font-size:11px; color:var(--o2-tab-text-color); }
.dp-inc-id    { font-size:10px; color:var(--o2-tab-text-color); font-family:ui-monospace,monospace; margin-top:1px; }
.dp-inc-dur   { font-weight:700; font-size:12px; flex-shrink:0; white-space:nowrap; }
/* uptime calendar */
.dp-uptime-cal { display:flex; flex-wrap:wrap; gap:3px; }
.dp-cal-day { width:16px; height:16px; border-radius:3px; }
.dp-cal--ok   { background:#22c55e; }
.dp-cal--deg  { background:#f59e0b; }
.dp-cal--down { background:#ef4444; }
.dp-uptime-legend { display:flex; align-items:center; gap:8px; margin-top:4px; font-size:11px; color:var(--o2-tab-text-color); }
/* tab info bar */
.dp-tab-info { font-size:11px; color:var(--o2-tab-text-color); display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:7px 12px; background:rgba(128,128,128,.06); border-radius:6px; border:1px solid var(--o2-border-color); }
.dp-mocked-pill { background:rgba(139,92,246,.15); color:#7c3aed; font-size:10px; font-weight:700; padding:2px 7px; border-radius:10px; border:1px solid rgba(139,92,246,.25); white-space:nowrap; }
.body--dark .dp-mocked-pill { background:rgba(139,92,246,.2); color:#a78bfa; }
/* log filter bar */
.dp-log-filters { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.dp-log-summary { font-size:11px; color:var(--o2-tab-text-color); }
/* logs */
.dp-log-list { display:flex; flex-direction:column; gap:0; font-family:ui-monospace,monospace; border:1px solid var(--o2-border-color); border-radius:8px; overflow:hidden; }
.dp-log-row { display:flex; align-items:baseline; flex-wrap:nowrap; gap:8px; padding:6px 12px; border-bottom:1px solid var(--o2-border-color); font-size:11.5px; line-height:1.5; }
.dp-log-row:last-child { border-bottom:none; }
.dp-log-row:hover { background:rgba(128,128,128,.04); }
.dp-log-time { color:var(--o2-tab-text-color); flex-shrink:0; font-size:10.5px; }
.dp-log-lvl  { flex-shrink:0; font-weight:700; font-size:10px; min-width:40px; }
.dp-log-src  { flex-shrink:0; font-size:10px; color:var(--o2-tab-text-color); min-width:110px; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dp-lvl--error { color:#ef4444; }
.dp-lvl--warn  { color:#f59e0b; }
.dp-lvl--info  { color:#3b82f6; }
.dp-lvl--debug { color:var(--o2-tab-text-color); }
.dp-log-msg  { color:inherit; word-break:break-word; min-width:0; }
.dp-log-stack { font-family:ui-monospace,monospace; font-size:10.5px; white-space:pre; padding:6px 12px 8px 32px; background:rgba(239,68,68,.06); color:#ef4444; border-bottom:1px solid var(--o2-border-color); line-height:1.6; overflow-x:auto; }
/* metrics percentiles */
.dp-pcts { display:flex; flex-direction:column; gap:8px; }
.dp-pct-row { display:flex; align-items:center; gap:10px; font-size:12px; }
.dp-pct-lbl { width:30px; font-weight:600; color:var(--o2-tab-text-color); font-size:11px; }
.dp-pct-track { flex:1; height:7px; background:rgba(128,128,128,.15); border-radius:3px; overflow:hidden; }
.dp-pct-fill { height:100%; border-radius:3px; }
.dp-pct-fill--ok   { background:#22c55e; }
.dp-pct-fill--deg  { background:#f59e0b; }
.dp-pct-fill--slow { background:#ef4444; }
.dp-pct-val { font-weight:600; font-size:12px; min-width:58px; text-align:right; }
/* per-location table */
.dp-loc-table { width:100%; border-collapse:collapse; font-size:12px; border:1px solid var(--o2-border-color); border-radius:8px; overflow:hidden; }
.dp-loc-table th { text-align:left; padding:6px 10px; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--o2-tab-text-color); border-bottom:1px solid var(--o2-border-color); background:rgba(128,128,128,.05); }
.dp-loc-table td { padding:7px 10px; border-bottom:1px solid var(--o2-border-color); }
.dp-loc-table tr:last-child td { border-bottom:none; }
.dp-loc-table tr:hover td { background:rgba(128,128,128,.04); }
/* traces */
.dp-req-bar { display:flex; align-items:center; gap:10px; padding:10px 14px; background:rgba(128,128,128,.06); border:1px solid var(--o2-border-color); border-radius:8px; }
.dp-req-method { font-family:ui-monospace,monospace; font-size:12px; font-weight:700; color:var(--o2-primary-color); flex-shrink:0; }
.dp-req-url { font-family:ui-monospace,monospace; font-size:12px; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--o2-tab-text-color); }
.dp-req-badge { font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px; flex-shrink:0; }
.dp-req-badge--ok  { background:rgba(34,197,94,.15); color:#16a34a; }
.dp-req-badge--err { background:rgba(239,68,68,.15); color:#dc2626; }
.body--dark .dp-req-badge--ok  { background:rgba(34,197,94,.2);  color:#4ade80; }
.body--dark .dp-req-badge--err { background:rgba(239,68,68,.2);  color:#f87171; }
.dp-req-dur { font-size:12px; font-weight:700; flex-shrink:0; }
.dp-trace-meta { display:flex; gap:16px; flex-wrap:wrap; font-size:11px; color:var(--o2-tab-text-color); padding:6px 12px; background:rgba(128,128,128,.06); border-radius:6px; border:1px solid var(--o2-border-color); align-items:center; }
.dp-traces-panes { display:grid; grid-template-columns:55fr 45fr; gap:0; border:1px solid var(--o2-border-color); border-radius:8px; overflow:hidden; min-height:300px; }
.dp-waterfall-col { border-right:1px solid var(--o2-border-color); overflow:auto; }
.dp-wf-hdr { display:flex; align-items:center; gap:0; padding:6px 0; border-bottom:1px solid var(--o2-border-color); font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--o2-tab-text-color); background:rgba(128,128,128,.05); }
.dp-wf-hdr-span { width:210px; flex-shrink:0; padding:0 6px; }
.dp-wf-hdr-bar  { flex:1; padding:0 6px; }
.dp-span-row { display:flex; align-items:center; cursor:pointer; border-bottom:1px solid var(--o2-border-color); }
.dp-span-row:last-child { border-bottom:none; }
.dp-span-row:hover { background:rgba(128,128,128,.06); }
.dp-span-row--sel { background:color-mix(in srgb,var(--o2-primary-color) 8%,transparent) !important; }
.dp-span-label { width:210px; flex-shrink:0; display:flex; align-items:center; gap:4px; padding:6px 4px; overflow:hidden; }
.dp-span-tree { font-size:10px; color:var(--o2-tab-text-color); flex-shrink:0; }
.dp-span-name { font-size:11px; font-family:ui-monospace,monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dp-span-code { font-size:10px; font-weight:700; flex-shrink:0; margin-left:2px; }
.dp-span-bar-wrap { flex:1; display:flex; align-items:center; gap:6px; padding:6px 4px; min-width:0; overflow:hidden; }
.dp-span-bar { height:11px; border-radius:3px; flex-shrink:0; min-width:2px; }
.dp-spanc--ok   { background:rgba(34,197,94,.75); }
.dp-spanc--slow { background:rgba(249,115,22,.8); }
.dp-spanc--err  { background:rgba(239,68,68,.8); }
.dp-span-dur { font-size:10px; font-weight:600; color:var(--o2-tab-text-color); white-space:nowrap; }
/* span attribute panel */
.dp-span-attr-col { padding:14px 14px; overflow-y:auto; background:rgba(128,128,128,.025); }
.dp-sd-empty { font-size:12px; color:var(--o2-tab-text-color); text-align:center; padding:30px 16px; line-height:1.6; }
.dp-sd-name { font-size:13px; font-weight:700; font-family:ui-monospace,monospace; margin-bottom:10px; word-break:break-all; }
.dp-sd-timing { display:flex; gap:18px; margin-bottom:14px; flex-wrap:wrap; }
.dp-sd-timing-item { display:flex; flex-direction:column; gap:2px; }
.dp-sd-timing-val { font-size:18px; font-weight:700; line-height:1; }
.dp-sd-timing-lbl { font-size:10px; color:var(--o2-tab-text-color); margin-top:2px; }
.dp-sd-attrs-title { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--o2-tab-text-color); margin-bottom:6px; }
.dp-sd-attrs { display:flex; flex-direction:column; border:1px solid var(--o2-border-color); border-radius:6px; overflow:hidden; }
.dp-sd-attr-row { display:flex; align-items:baseline; gap:8px; padding:5px 8px; border-bottom:1px solid var(--o2-border-color); font-size:11px; }
.dp-sd-attr-row:last-child { border-bottom:none; }
.dp-sd-attr-k { min-width:130px; flex-shrink:0; color:var(--o2-tab-text-color); font-family:ui-monospace,monospace; font-size:10.5px; }
.dp-sd-attr-v { font-family:ui-monospace,monospace; word-break:break-all; font-size:11px; font-weight:500; }
/* color helpers */
.c-g  { color:#16a34a; } .body--dark .c-g { color:#4ade80; }
.c-a  { color:#d97706; } .body--dark .c-a { color:#fbbf24; }
.c-r  { color:#dc2626; } .body--dark .c-r { color:#f87171; }
/* status dot */
.dot         { display:inline-block; border-radius:50%; flex-shrink:0; }
.dot--up       { width:9px; height:9px; background:#22c55e; box-shadow:0 0 0 3px rgba(34,197,94,.15); }
.dot--degraded { width:9px; height:9px; background:#f59e0b; box-shadow:0 0 0 3px rgba(245,158,11,.15); }
.dot--down     { width:9px; height:9px; background:#ef4444; box-shadow:0 0 0 3px rgba(239,68,68,.15); }
</style>
