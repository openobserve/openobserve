<template>
  <div class="syn-root">

    <!-- PAGE HEADER -->
    <div class="syn-page-header">
      <div class="syn-page-title-wrap">
        <div class="syn-page-icon">
          <OIcon name="radar" size="md" />
        </div>
        <div>
          <div class="syn-title">Synthetic Monitoring</div>
          <div class="syn-sub">Proactively monitor uptime, performance, and user journeys from global locations</div>
        </div>
      </div>
      <div class="syn-hdr-actions">
        <OButton variant="ghost" size="sm" :class="{ 'geo-hdr-btn--alert': geoIssues.length }" @click="showIssuesModal = true">
          <template #icon-left><OIcon :name="geoIssues.length ? 'error' : 'check-circle'" size="xs" /></template>
          Active Issues
          <span v-if="geoIssues.length" class="geo-hdr-badge">{{ geoIssues.length }}</span>
        </OButton>
        <OButton variant="ghost" size="sm" @click="showHeatmapModal = true">
          <template #icon-left><OIcon name="language" size="xs" /></template>
          Geo Map
        </OButton>
        <OButton variant="primary" @click="openCreate">
          <template #icon-left><OIcon name="add" size="sm" /></template>
          New Monitor
        </OButton>
      </div>
    </div>

    <!-- FILTER BAR -->
    <div class="syn-filter-bar">
      <!-- View switcher -->
      <OButtonGroup>
        <OButton v-for="tab in tabs" :key="tab.key"
          :variant="activeTab === tab.key ? 'primary' : 'ghost'"
          size="sm"
          @click="activeTab = tab.key">
          {{ tab.label }}
        </OButton>
      </OButtonGroup>

      <div class="syn-filter-sep" />

      <!-- Status filter — only on All Monitors tab -->
      <template v-if="activeTab === 'monitors'">
        <OButton v-for="s in statusTabs" :key="s.filter"
          :variant="statusFilter === s.filter ? 'primary' : 'ghost'"
          size="sm"
          @click="statusFilter = s.filter">
          <span v-if="s.filter !== 'all'" class="syn-pill-dot" :class="'sdot-' + s.filter.toLowerCase()" />
          {{ s.label }} <span class="syn-pill-count">{{ s.count }}</span>
        </OButton>
        <div class="syn-filter-sep" />
      </template>

      <!-- Search -->
      <template v-if="activeTab !== 'private'">
        <OSearchInput
          v-model="search"
          :placeholder="activeTab === 'browser' ? 'Search browser tests...' : activeTab === 'api' ? 'Search API tests...' : 'Search monitors...'"
        />
      </template>

      <!-- Type + Location dropdowns -->
      <template v-if="activeTab === 'monitors'">
        <OSelect
          v-model="typeFilter"
          :options="typeOpts"
          size="sm"
        />
        <OSelect
          v-model="locationFilter"
          :options="locationOpts"
          size="sm"
        />
      </template>

      <div style="flex:1" />

      <template v-if="activeTab === 'private'">
        <OButton variant="primary">
          <template #icon-left><OIcon name="add" size="sm" /></template>
          Add Location
        </OButton>
      </template>
    </div>

    <!-- ── ALL MONITORS ── -->
    <template v-if="activeTab === 'monitors'">
      <OTable
        :columns="monitorTableColumns"
        :data="filteredMonitors"
        pagination="client"
        :page-size="20"
        :page-size-options="[10, 20, 25, 50]"
        row-key="id"
        :show-global-filter="false"
        :enable-column-resize="true"
        footer-title="Monitors"
        empty-message="No monitors found. Adjust filters or create your first monitor."
        data-test="synthetic-monitoring-all-monitors-table"
        @row-click="(row) => openDetail(row)"
      >
        <!-- Status dot -->
        <template #cell-status="{ row }">
          <span class="dot" :class="'dot--' + (row as any).status.toLowerCase()" />
        </template>

        <!-- Name + URL -->
        <template #cell-name="{ row }">
          <div class="mon-name">{{ (row as any).name }}</div>
          <div class="mon-url">{{ (row as any).url }}</div>
        </template>

        <!-- Type badge -->
        <template #cell-type="{ row }">
          <OBadge :variant="monitorTypeBadgeVariant((row as any).type)" size="sm">{{ (row as any).type }}</OBadge>
        </template>

        <!-- History sparkbars -->
        <template #cell-history="{ row }">
          <div class="spark">
            <span
              v-for="(tick, i) in (row as any).history"
              :key="i"
              class="spark-bar"
              :class="'spark--' + tick.status"
              @mouseenter="showSparkTip($event, tick)"
              @mouseleave="hideSparkTip"
            />
          </div>
        </template>

        <!-- Response time -->
        <template #cell-responseTime="{ row }">
          <span class="mono" :class="rtCls((row as any).responseTime)">{{ (row as any).responseTime ?? '—' }}</span>
        </template>

        <!-- Uptime progress bar -->
        <template #cell-uptime="{ row }">
          <div class="uptime-row">
            <OProgressBar
              :value="(row as any).uptime / 100"
              :variant="(row as any).uptime >= 99 ? 'default' : (row as any).uptime >= 95 ? 'warning' : 'danger'"
              size="xs"
              class="tw:flex-1"
            />
            <span
              class="mono"
              :class="(row as any).uptime >= 99 ? 'c-g' : (row as any).uptime >= 95 ? 'c-a' : 'c-r'"
              style="min-width:44px;text-align:right;font-size:12px"
            >{{ (row as any).uptime }}%</span>
          </div>
        </template>

        <!-- Locations cell with tooltip -->
        <template #cell-locations="{ row }">
          <div class="locs-cell" @mouseenter="showLoc($event, (row as any).locations)" @mouseleave="hideLoc">
            <span class="loc-first">{{ (row as any).locations[0] }}</span>
            <span v-if="(row as any).locations.length > 1" class="loc-badge">+{{ (row as any).locations.length - 1 }}</span>
          </div>
        </template>

        <!-- Interval -->
        <template #cell-interval="{ row }">
          <span class="tw:text-secondary">{{ (row as any).interval }}</span>
        </template>

        <!-- Last check -->
        <template #cell-lastCheck="{ row }">
          <span class="tw:text-secondary">{{ (row as any).lastCheck }}</span>
        </template>

        <!-- Row actions -->
        <template #cell-actions="{ row }">
          <div class="row-actions" @click.stop>
            <OButton variant="ghost" size="icon" title="Run now" data-test="synthetic-monitoring-run-btn" @click.stop><OIcon name="play-arrow" size="sm" /></OButton>
            <OButton variant="ghost" size="icon" title="Edit" data-test="synthetic-monitoring-edit-btn" @click.stop="openEdit((row as any))"><OIcon name="edit" size="sm" /></OButton>
            <OButton variant="ghost" size="icon" title="Pause" data-test="synthetic-monitoring-pause-btn" @click.stop><OIcon name="pause" size="sm" /></OButton>
            <OButton variant="destructive" size="icon" title="Delete" data-test="synthetic-monitoring-delete-btn" @click.stop><OIcon name="delete" size="sm" /></OButton>
          </div>
        </template>
      </OTable>
    </template>

    <!-- ── BROWSER TESTS ── -->
    <template v-else-if="activeTab === 'browser'">
      <div class="syn-table-scroll">
        <table class="syn-table">
          <thead>
            <tr>
              <th class="syn-th" style="width:36px"></th>
              <th class="syn-th">Test name</th>
              <th class="syn-th" style="width:220px">URL</th>
              <th class="syn-th" style="width:72px">Steps</th>
              <th class="syn-th" style="width:190px">Status · Last 24h</th>
              <th class="syn-th right" style="width:110px">Page load</th>
              <th class="syn-th right" style="width:90px">Uptime 7d</th>
              <th class="syn-th" style="width:100px">Last run</th>
              <th class="syn-th" style="width:110px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in browserMonitors" :key="m.id" class="syn-row">
              <td class="syn-td td-center"><span class="dot" :class="'dot--'+m.status.toLowerCase()" /></td>
              <td class="syn-td"><div class="mon-name">{{ m.name }}</div></td>
              <td class="syn-td"><div class="mon-url">{{ m.url }}</div></td>
              <td class="syn-td td-muted">{{ m.steps }} steps</td>
              <td class="syn-td"><div class="spark"><span v-for="(t,i) in m.history" :key="i" class="spark-bar" :class="'spark--'+t.status" @mouseenter="showSparkTip($event, t)" @mouseleave="hideSparkTip" /></div></td>
              <td class="syn-td td-right"><span class="mono" :class="rtCls(m.responseTime)">{{ m.responseTime }}</span></td>
              <td class="syn-td td-right"><span class="mono" :class="m.uptime>=99?'c-g':m.uptime>=95?'c-a':'c-r'">{{ m.uptime }}%</span></td>
              <td class="syn-td td-muted">{{ m.lastCheck }}</td>
              <td class="syn-td td-center" @click.stop>
                <div class="row-actions">
                  <OButton variant="ghost" size="icon" title="Run" @click.stop><OIcon name="play-arrow" size="sm" /></OButton>
                  <OButton variant="ghost" size="icon" title="Edit" @click.stop="openEdit(m)"><OIcon name="edit" size="sm" /></OButton>
                  <OButton variant="destructive" size="icon" title="Delete" @click.stop><OIcon name="delete" size="sm" /></OButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="syn-footer">
        <div class="syn-footer-total">{{ browserMonitors.length }} Browser Tests</div>
        <div style="flex:1" />
        <div class="syn-footer-right">
          <span class="syn-footer-info">Showing 1 - {{ browserMonitors.length }} of {{ browserMonitors.length }}</span>
        </div>
      </div>
    </template>

    <!-- ── API TESTS ── -->
    <template v-else-if="activeTab === 'api'">
      <div class="syn-table-scroll">
        <table class="syn-table">
          <thead>
            <tr>
              <th class="syn-th" style="width:36px"></th>
              <th class="syn-th">Test name</th>
              <th class="syn-th" style="width:64px">Method</th>
              <th class="syn-th" style="width:240px">Endpoint</th>
              <th class="syn-th" style="width:90px">Assertions</th>
              <th class="syn-th" style="width:190px">Status · Last 24h</th>
              <th class="syn-th right" style="width:80px">P50</th>
              <th class="syn-th right" style="width:90px">Uptime 7d</th>
              <th class="syn-th" style="width:100px">Last run</th>
              <th class="syn-th" style="width:110px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in apiMonitors" :key="m.id" class="syn-row">
              <td class="syn-td td-center"><span class="dot" :class="'dot--'+m.status.toLowerCase()" /></td>
              <td class="syn-td"><div class="mon-name">{{ m.name }}</div></td>
              <td class="syn-td"><span class="http-method" :class="'method--'+m.method.toLowerCase()">{{ m.method }}</span></td>
              <td class="syn-td"><div class="mon-url">{{ m.url }}</div></td>
              <td class="syn-td td-muted">{{ m.assertions }} checks</td>
              <td class="syn-td"><div class="spark"><span v-for="(t,i) in m.history" :key="i" class="spark-bar" :class="'spark--'+t.status" @mouseenter="showSparkTip($event, t)" @mouseleave="hideSparkTip" /></div></td>
              <td class="syn-td td-right"><span class="mono" :class="rtCls(m.responseTime)">{{ m.responseTime ?? '—' }}</span></td>
              <td class="syn-td td-right"><span class="mono" :class="m.uptime>=99?'c-g':m.uptime>=95?'c-a':'c-r'">{{ m.uptime }}%</span></td>
              <td class="syn-td td-muted">{{ m.lastCheck }}</td>
              <td class="syn-td td-center" @click.stop>
                <div class="row-actions">
                  <OButton variant="ghost" size="icon" title="Run" @click.stop><OIcon name="play-arrow" size="sm" /></OButton>
                  <OButton variant="ghost" size="icon" title="Edit" @click.stop="openEdit(m)"><OIcon name="edit" size="sm" /></OButton>
                  <OButton variant="destructive" size="icon" title="Delete" @click.stop><OIcon name="delete" size="sm" /></OButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="syn-footer">
        <div class="syn-footer-total">{{ apiMonitors.length }} API Tests</div>
        <div style="flex:1" />
        <div class="syn-footer-right">
          <span class="syn-footer-info">Showing 1 - {{ apiMonitors.length }} of {{ apiMonitors.length }}</span>
        </div>
      </div>
    </template>

    <!-- ── PRIVATE LOCATIONS ── -->
    <template v-else-if="activeTab === 'private'">
      <div class="pl-root">
        <div class="pl-grid">
          <OCard v-for="loc in privateLocations" :key="loc.id" class="pl-card">
            <div class="pl-card-header">
              <div style="display:flex;align-items:center;gap:8px">
                <span class="dot" :class="loc.status==='Online'?'dot--up':'dot--down'" style="width:8px;height:8px;box-shadow:none" />
                <span class="pl-card-title">{{ loc.name }}</span>
              </div>
              <div style="display:flex;align-items:center;gap:2px">
                <OButton variant="ghost" size="icon" title="Edit"><OIcon name="edit" size="sm" /></OButton>
                <OButton variant="destructive" size="icon" title="Remove"><OIcon name="delete" size="sm" /></OButton>
              </div>
            </div>
            <div class="pl-card-region"><OIcon name="location-on" size="xs" class="pl-icon-muted" />{{ loc.region }}</div>
            <div style="display:flex;align-items:center;gap:6px">
              <span class="pl-status-chip" :class="loc.status==='Online'?'chip-g':'chip-r'">{{ loc.status }}</span>
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

          <OCard class="pl-card pl-card--add">
            <OIcon name="add-circle" size="lg" class="pl-icon-muted" />
            <div style="font-size:13px;font-weight:600;margin-top:10px">Add private location</div>
            <div style="font-size:11px;color:var(--o2-tab-text-color);margin-top:4px;text-align:center;line-height:1.5">Run checks from your servers, VPC, or on-premise network</div>
            <OButton variant="primary" size="sm" class="tw:mt-3">Get started</OButton>
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
                <OCodeBlock
                  :code="dockerInstallCmd"
                  lang="bash"
                  chrome="editor"
                  filename="Docker"
                />
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


    <!-- Floating locations tooltip -->
    <Teleport to="body">
      <div v-if="locTip.show" class="loc-float-tip" :style="{ left: locTip.x + 'px', top: locTip.y + 'px' }">
        <div v-for="l in locTip.locs" :key="l" class="loc-float-item"><span class="loc-float-dot" />{{ l }}</div>
      </div>
    </Teleport>

    <!-- Spark bar detail tooltip -->
    <Teleport to="body">
      <div v-if="sparkTip.show && sparkTip.tick"
        class="spark-tooltip"
        :style="{ left: sparkTip.x + 'px', top: sparkTip.y + 'px' }"
        @mouseenter="keepSparkTip"
        @mouseleave="hideSparkTip"
      >
        <div class="stt-header">
          <span class="stt-time">{{ sparkTip.tick.hour }} – {{ sparkTip.tick.nextHour }}</span>
          <span class="stt-badge" :class="'stt-badge--' + sparkTip.tick.status">
            {{ sparkTip.tick.status === 'up' ? '✓ Up' : sparkTip.tick.status === 'down' ? '✗ Down' : '⚠ Degraded' }}
          </span>
        </div>
        <div class="stt-divider" />
        <div class="stt-checks">
          <div v-for="c in sparkTip.tick.checks" :key="c.loc" class="stt-check">
            <span class="stt-dot" :class="c.ok ? 'stt-dot--up' : 'stt-dot--down'" />
            <span class="stt-loc">{{ c.loc }}</span>
            <span class="stt-ms">{{ c.ms !== null ? c.ms + 'ms' : 'Timeout' }}</span>
          </div>
        </div>
        <div v-if="sparkTip.tick.avgMs !== null" class="stt-avg">Avg · {{ sparkTip.tick.avgMs }}ms</div>
        <div class="stt-arrow" />
      </div>
    </Teleport>

    <!-- Map dot tooltip -->
    <Teleport to="body">
      <div v-if="mapTip.show && mapTip.stat"
        class="map-dot-tip"
        :style="{ left: mapTip.x + 'px', top: mapTip.y + 'px' }"
        @mouseenter="() => { if (mapTipTimer) { clearTimeout(mapTipTimer); mapTipTimer = null; } }"
        @mouseleave="hideMapTip">
        <div class="stt-header">
          <span class="stt-time">{{ mapTip.stat.flag }} {{ mapTip.stat.label }}</span>
          <span class="stt-badge" :class="'stt-badge--'+mapTip.stat.health">
            {{ mapTip.stat.health === 'up' ? '✓ Healthy' : mapTip.stat.health === 'down' ? '✗ Outage' : '⚠ Degraded' }}
          </span>
        </div>
        <div class="stt-divider"/>
        <div class="map-tip-row"><span>Uptime</span><span class="map-tip-val">{{ mapTip.stat.uptime }}%</span></div>
        <div class="map-tip-row"><span>Monitors</span><span class="map-tip-val">{{ mapTip.stat.total }}</span></div>
        <div v-if="mapTip.stat.downCt" class="map-tip-row"><span>Down</span><span class="map-tip-val c-r">{{ mapTip.stat.downCt }}</span></div>
        <div v-if="mapTip.stat.degCt" class="map-tip-row"><span>Degraded</span><span class="map-tip-val c-a">{{ mapTip.stat.degCt }}</span></div>
        <div class="map-tip-row"><span>City</span><span class="map-tip-val">{{ mapTip.stat.city }}</span></div>
      </div>
    </Teleport>

    <!-- Detail Side Panel -->
    <Teleport to="body">
      <transition name="dp">
        <div v-if="detailPanel?.show" class="dp-overlay" @click.self="closeDetail">
          <aside class="dp-panel">
            <!-- Header -->
            <div class="dp-hdr">
              <div class="dp-hdr-top">
                <span class="dot" :class="'dot--' + detailPanel.monitor.status.toLowerCase()" style="flex-shrink:0;margin-top:2px"/>
                <div class="dp-hdr-titles">
                  <div class="dp-title">{{ detailPanel.monitor.name }}</div>
                  <div class="dp-url">{{ detailPanel.monitor.url }}</div>
                </div>
                <OButton variant="ghost" size="icon" @click="closeDetail"><OIcon name="close" size="sm" /></OButton>
              </div>
              <div class="dp-badges">
                <OBadge :variant="monitorTypeBadgeVariant(detailPanel.monitor.type)" size="sm">{{ detailPanel.monitor.type }}</OBadge>
                <span class="dp-meta-chip">{{ detailPanel.monitor.interval }}</span>
                <span class="dp-meta-chip">{{ detailPanel.monitor.locations.length }} location{{ detailPanel.monitor.locations.length !== 1 ? 's' : '' }}</span>
                <span class="dp-meta-chip">Last: {{ detailPanel.monitor.lastCheck }}</span>
              </div>
            </div>
            <!-- Tabs -->
            <OTabs v-model="detailPanel.tab">
              <OTab name="overview">Overview</OTab>
              <OTab name="logs">Logs <span class="dp-tab-ct">{{ detailPanel.logs.length }}</span></OTab>
              <OTab name="metrics">Metrics</OTab>
              <OTab name="traces">Traces <span class="dp-tab-ct">{{ detailPanel.traces.length }}</span></OTab>
            </OTabs>
            <!-- Body -->
            <OTabPanels v-model="detailPanel.tab" scroll="y" class="dp-body">

              <!-- ── OVERVIEW ── -->
              <OTabPanel name="overview">
                <div class="dp-ov-grid">
                  <!-- Left column: KPIs + chart + locations -->
                  <div class="dp-ov-col">
                    <div class="dp-kpis">
                      <div class="dp-kpi">
                        <div class="dp-kpi-val" :class="detailPanel.monitor.uptime>=99?'c-g':detailPanel.monitor.uptime>=95?'c-a':'c-r'">{{ detailPanel.monitor.uptime }}%</div>
                        <div class="dp-kpi-lbl">Uptime 7d</div>
                      </div>
                      <div class="dp-kpi">
                        <div class="dp-kpi-val" :class="_rtMs(detailPanel.monitor.responseTime)<600?'c-g':_rtMs(detailPanel.monitor.responseTime)<1200?'c-a':'c-r'">
                          {{ detailPanel.monitor.responseTime ?? '—' }}
                        </div>
                        <div class="dp-kpi-lbl">Avg Response</div>
                      </div>
                      <div class="dp-kpi">
                        <div class="dp-kpi-val">288</div>
                        <div class="dp-kpi-lbl">Checks/day</div>
                      </div>
                      <div class="dp-kpi">
                        <div class="dp-kpi-val" :class="detailPanel.monitor.status==='Up'?'c-g':detailPanel.monitor.status==='Down'?'c-r':'c-a'">{{ detailPanel.monitor.status }}</div>
                        <div class="dp-kpi-lbl">Status</div>
                      </div>
                      <div class="dp-kpi">
                        <div class="dp-kpi-val">{{ detailPanel.monitor.status==='Down' ? '~6m' : '0' }}</div>
                        <div class="dp-kpi-lbl">MTTR</div>
                      </div>
                      <div class="dp-kpi">
                        <div class="dp-kpi-val">{{ detailPanel.incidents.length }}</div>
                        <div class="dp-kpi-lbl">Incidents 30d</div>
                      </div>
                      <div class="dp-kpi">
                        <div class="dp-kpi-val" :class="detailPanel.monitor.uptime>=99?'c-g':'c-a'">{{ detailPanel.monitor.uptime>=99?'✓':'~' }}</div>
                        <div class="dp-kpi-lbl">SLA 99.9%</div>
                      </div>
                      <div class="dp-kpi">
                        <div class="dp-kpi-val c-g">87d</div>
                        <div class="dp-kpi-lbl">SSL Expiry</div>
                      </div>
                    </div>

                    <div class="dp-section">
                      <div class="dp-section-title">Response Time · 24h</div>
                      <div class="dp-chart24" style="height:80px">
                        <div v-for="(bar, bi) in detailPanel.metricBars" :key="bi"
                          class="dp-bar24"
                          :class="bar.val===null?'dp-bar24--err':bar.val>1000?'dp-bar24--slow':bar.val>600?'dp-bar24--deg':'dp-bar24--ok'"
                          :style="{ height: bar.val ? Math.max(3, Math.round((bar.val/detailPanel.metricMax)*76)) + 'px' : '76px' }"
                          :title="bar.val ? bar.hour+': '+bar.val+'ms' : bar.hour+': Timeout'"/>
                      </div>
                      <div class="dp-chart24-x"><span>24h ago</span><span>12h ago</span><span>Now</span></div>
                    </div>

                    <div class="dp-section">
                      <div class="dp-section-title">Monitored Locations</div>
                      <div class="dp-geo-list">
                        <div v-for="loc in detailPanel.monitor.locations" :key="loc" class="dp-geo-row">
                          <span class="dp-geo-flag">📍</span>
                          <span class="dp-geo-loc">{{ loc }}</span>
                          <span class="geo-cell-dot geo-cdot--up" style="margin-left:auto;flex-shrink:0"/>
                          <span class="dp-geo-ms c-g">Active</span>
                        </div>
                      </div>
                    </div>

                  </div>

                  <!-- Right column: config + incidents + uptime cal -->
                  <div class="dp-ov-col">
                    <div class="dp-section">
                      <div class="dp-section-title">Monitor Configuration</div>
                      <div class="dp-cfg-table">
                        <div class="dp-cfg-row"><span class="dp-cfg-key">URL</span><span class="dp-cfg-val">{{ detailPanel.monitor.url }}</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">Check type</span><span class="dp-cfg-val">{{ detailPanel.monitor.type }}</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">HTTP method</span><span class="dp-cfg-val">GET</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">Interval</span><span class="dp-cfg-val">{{ detailPanel.monitor.interval }}</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">Timeout</span><span class="dp-cfg-val">30 seconds</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">Expected status</span><span class="dp-cfg-val">200 OK</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">Follow redirects</span><span class="dp-cfg-val">Yes (max 5)</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">SSL validation</span><span class="dp-cfg-val">Enabled</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">Alert threshold</span><span class="dp-cfg-val">2 consecutive failures</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">Locations</span><span class="dp-cfg-val">{{ detailPanel.monitor.locations.join(', ') }}</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">Last check</span><span class="dp-cfg-val">{{ detailPanel.monitor.lastCheck }}</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">Monitor ID</span><span class="dp-cfg-val" style="font-family:ui-monospace,monospace">{{ detailPanel.monitor.id }}</span></div>
                      </div>
                    </div>

                    <div class="dp-section">
                      <div class="dp-section-title">Recent Incidents · 30d</div>
                      <div class="dp-incidents">
                        <div v-for="inc in detailPanel.incidents" :key="inc.id"
                          class="dp-incident-row" :class="'dp-inc--'+inc.type">
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
                        <div v-for="(day, di) in detailPanel.uptimeCal" :key="di"
                          class="dp-cal-day" :class="'dp-cal--'+day"
                          :title="'Day '+(30-di)+': '+day"/>
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
                    @click="dpLogFilter = lv">
                    {{ lv }}
                    <span v-if="lv !== 'ALL' && dpLogCounts[lv]" class="dp-tab-ct">{{ dpLogCounts[lv] }}</span>
                  </OButton>
                  <span style="flex:1"/>
                  <span class="dp-log-summary">{{ dpFilteredLogs.length }} entries · window: {{ detailPanel.logs[0]?.time ?? '' }} UTC</span>
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
                  <!-- Left: charts + percentiles -->
                  <div class="dp-ov-col">
                    <div class="dp-section">
                      <div class="dp-section-title">Response Time P90 · 24h</div>
                      <div class="dp-chart24" style="height:90px">
                        <div v-for="(bar, bi) in detailPanel.metricBars" :key="bi"
                          class="dp-bar24"
                          :class="bar.val===null?'dp-bar24--err':bar.val>1000?'dp-bar24--slow':bar.val>600?'dp-bar24--deg':'dp-bar24--ok'"
                          :style="{ height: bar.val ? Math.max(3, Math.round((bar.val/detailPanel.metricMax)*86)) + 'px' : '86px' }"
                          :title="bar.val ? bar.hour+': '+bar.val+'ms' : bar.hour+': Timeout'"/>
                      </div>
                      <div class="dp-chart24-x"><span>24h ago</span><span>12h ago</span><span>Now</span></div>
                    </div>

                    <div class="dp-section">
                      <div class="dp-section-title">Latency Percentiles · last 1h</div>
                      <div class="dp-pcts">
                        <div class="dp-pct-row">
                          <span class="dp-pct-lbl">P50</span>
                          <div class="dp-pct-track"><div class="dp-pct-fill dp-pct-fill--ok" style="width:30%"/></div>
                          <span class="dp-pct-val">{{ Math.round(_rtMs(detailPanel.monitor.responseTime)*0.55) }}ms</span>
                        </div>
                        <div class="dp-pct-row">
                          <span class="dp-pct-lbl">P75</span>
                          <div class="dp-pct-track"><div class="dp-pct-fill dp-pct-fill--ok" style="width:50%"/></div>
                          <span class="dp-pct-val">{{ Math.round(_rtMs(detailPanel.monitor.responseTime)*0.82) }}ms</span>
                        </div>
                        <div class="dp-pct-row">
                          <span class="dp-pct-lbl">P90</span>
                          <div class="dp-pct-track"><div class="dp-pct-fill dp-pct-fill--deg" style="width:65%"/></div>
                          <span class="dp-pct-val">{{ detailPanel.monitor.responseTime ?? '220ms' }}</span>
                        </div>
                        <div class="dp-pct-row">
                          <span class="dp-pct-lbl">P95</span>
                          <div class="dp-pct-track"><div class="dp-pct-fill dp-pct-fill--deg" style="width:76%"/></div>
                          <span class="dp-pct-val">{{ Math.round(_rtMs(detailPanel.monitor.responseTime)*1.4) }}ms</span>
                        </div>
                        <div class="dp-pct-row">
                          <span class="dp-pct-lbl">P99</span>
                          <div class="dp-pct-track"><div class="dp-pct-fill dp-pct-fill--slow" style="width:88%"/></div>
                          <span class="dp-pct-val">{{ Math.round(_rtMs(detailPanel.monitor.responseTime)*1.9) }}ms</span>
                        </div>
                      </div>
                    </div>

                    <div class="dp-section">
                      <div class="dp-section-title">Availability · Last 30 days</div>
                      <div class="dp-uptime-cal">
                        <div v-for="(day, di) in detailPanel.uptimeCal" :key="di"
                          class="dp-cal-day" :class="'dp-cal--'+day"
                          :title="'Day '+(30-di)+': '+day"/>
                      </div>
                      <div class="dp-uptime-legend">
                        <span class="dp-cal-day dp-cal--ok" style="display:inline-block"/><span>Up</span>
                        <span class="dp-cal-day dp-cal--deg" style="display:inline-block"/><span>Degraded</span>
                        <span class="dp-cal-day dp-cal--down" style="display:inline-block"/><span>Down</span>
                      </div>
                    </div>
                  </div>

                  <!-- Right: error rate + per-location table -->
                  <div class="dp-ov-col">
                    <div class="dp-section">
                      <div class="dp-section-title">Error Rate · 24h</div>
                      <div class="dp-chart24" style="height:90px">
                        <div v-for="(val, bi) in detailPanel.errorBars" :key="bi"
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
                          <tr v-for="row in detailPanel.locBreakdown" :key="row.loc">
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
                        <div class="dp-cfg-row"><span class="dp-cfg-key">Current uptime</span><span class="dp-cfg-val" :class="detailPanel.monitor.uptime>=99.9?'c-g':'c-r'">{{ detailPanel.monitor.uptime }}%</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">Downtime this month</span><span class="dp-cfg-val" :class="detailPanel.monitor.status==='Down'?'c-r':'c-g'">{{ detailPanel.monitor.status==='Down' ? '~6 min (ongoing)' : '8 min' }}</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">Incidents 30d</span><span class="dp-cfg-val">{{ detailPanel.incidents.length }}</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">MTTR (avg)</span><span class="dp-cfg-val">~9 min</span></div>
                        <div class="dp-cfg-row"><span class="dp-cfg-key">MTTF (avg)</span><span class="dp-cfg-val">~7.2 days</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </OTabPanel>

              <!-- ── TRACES ── -->
              <OTabPanel name="traces">
                <!-- Request / response summary bar -->
                <div class="dp-req-bar">
                  <span class="dp-req-method">GET</span>
                  <span class="dp-req-url">{{ detailPanel.monitor.url }}</span>
                  <span class="dp-req-badge" :class="detailPanel.monitor.status==='Down'?'dp-req-badge--err':'dp-req-badge--ok'">
                    {{ detailPanel.monitor.status === 'Down' ? '503' : '200' }}
                  </span>
                  <span class="dp-req-dur">{{ detailPanel.traces[0]?.dur >= 1000 ? (detailPanel.traces[0].dur/1000).toFixed(1)+'s' : detailPanel.traces[0]?.dur+'ms' }}</span>
                </div>
                <div class="dp-trace-meta">
                  <span>Trace&nbsp;<b style="font-family:ui-monospace,monospace">{{ detailPanel.monitor.id.toString(16).padStart(12,'0') }}af42</b></span>
                  <span>14:32:01.100 UTC</span>
                  <span>{{ detailPanel.traces.length }} spans</span>
                  <span :class="detailPanel.monitor.status==='Down'?'c-r':'c-g'" style="font-weight:600">
                    {{ detailPanel.monitor.status === 'Down' ? '✗ Failed' : '✓ Success' }}
                  </span>
                  <span class="dp-mocked-pill" style="margin-left:auto">mocked</span>
                </div>
                <!-- Two-pane: waterfall + span attributes -->
                <div class="dp-traces-panes">
                  <div class="dp-waterfall-col">
                    <div class="dp-wf-hdr">
                      <span class="dp-wf-hdr-span">Span</span>
                      <span class="dp-wf-hdr-bar">Timeline / Duration</span>
                    </div>
                    <div v-for="(span, si) in detailPanel.traces" :key="si"
                      class="dp-span-row" :class="{ 'dp-span-row--sel': dpSelectedSpan === span }"
                      @click="dpSelectedSpan = dpSelectedSpan === span ? null : span">
                      <div class="dp-span-label" :style="{ paddingLeft: span.depth * 14 + 6 + 'px' }">
                        <span v-if="span.depth > 0" class="dp-span-tree">└─</span>
                        <span class="dp-span-name" :title="span.name">{{ span.name }}</span>
                        <span v-if="span.status !== null" class="dp-span-code" :class="span.status>=400?'c-r':'c-g'">{{ span.status }}</span>
                      </div>
                      <div class="dp-span-bar-wrap">
                        <div class="dp-span-bar" :class="'dp-spanc--'+span.color"
                          :style="{ width: Math.max(2, Math.round((span.dur/detailPanel.traces[0].dur)*100))+'%', marginLeft: Math.round((span.offset/detailPanel.traces[0].dur)*100)+'%' }"/>
                        <span class="dp-span-dur">{{ span.dur >= 1000 ? (span.dur/1000).toFixed(1)+'s' : span.dur+'ms' }}</span>
                      </div>
                    </div>
                  </div>
                  <!-- Span attributes panel -->
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
          </aside>
        </div>
      </transition>
    </Teleport>

    <!-- Full Heatmap Modal -->
    <ODialog v-model:open="showHeatmapModal" title="Global Health Heatmap" :width="94">
      <template #header-right>
        <div class="geo-modal-legend">
          <span class="geo-leg-item"><span class="geo-leg-dot geo-leg-dot--up" /><span>Healthy</span></span>
          <span class="geo-leg-item"><span class="geo-leg-dot geo-leg-dot--deg" /><span>Degraded</span></span>
          <span class="geo-leg-item"><span class="geo-leg-dot geo-leg-dot--dn" /><span>Down</span></span>
        </div>
      </template>
      <div class="geo-modal-body">
        <div ref="heatmapChartEl" class="geo-echarts-map"></div>
      </div>
    </ODialog>

    <!-- Active Issues Modal -->
    <ODialog v-model:open="showIssuesModal" size="sm">
      <template #header>
        <OIcon :name="geoIssues.length ? 'error' : 'check-circle'" size="sm" :class="geoIssues.length ? 'c-r' : 'c-g'"/>
        <span class="tw:text-base tw:font-semibold">Active Issues</span>
      </template>
      <div class="issues-body">
        <!-- All clear -->
        <template v-if="!geoIssues.length">
          <div class="issues-clear">
            <OIcon name="check-circle" size="lg" class="c-g"/>
            <div style="font-weight:600;margin-top:8px">All regions healthy</div>
            <div style="font-size:12px;color:var(--o2-tab-text-color);margin-top:4px">No active issues detected across all monitoring locations.</div>
          </div>
        </template>
        <!-- Issue rows -->
        <template v-else>
          <div v-if="geoLocStats.filter(s=>s.health!=='up').length >= 2" class="issues-banner">
            <OIcon name="warning-amber" size="sm"/> {{ geoLocStats.filter(s=>s.health!=='up').length }} regions simultaneously affected — possible CDN or upstream incident
          </div>
          <div class="issues-list">
            <div v-for="issue in geoIssues" :key="issue.key" class="issues-row" :class="'issues-row--'+issue.level">
              <div class="issues-row-left">
                <span class="issues-dot" :class="issue.level==='error'?'issues-dot--down':'issues-dot--deg'"/>
                <div>
                  <div class="issues-loc">{{ issue.stat.flag }} {{ issue.stat.label }}</div>
                  <div class="issues-city">{{ issue.stat.city }}</div>
                </div>
              </div>
              <div class="issues-row-right">
                <span class="issues-badge" :class="issue.level==='error'?'issues-badge--down':'issues-badge--deg'">
                  {{ issue.level==='error' ? issue.stat.downCt + ' down' : issue.stat.degCt + ' degraded' }}
                </span>
                <div class="issues-uptime" :class="issue.level==='error'?'c-r':'c-a'">{{ issue.stat.uptime }}% uptime</div>
                <div class="issues-total">{{ issue.stat.total }} monitors</div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </ODialog>

    <!-- DRAWER -->
    <ODrawer
      v-model:open="showDrawer"
      :title="editTarget ? 'Edit Monitor' : 'New Monitor'"
      :sub-title="editTarget ? editTarget.url : 'Configure a new synthetic check'"
      size="lg"
    >
      <template #footer>
        <div class="drw-footer">
          <OButton variant="ghost" :disabled="stepIdx === 0" @click="prevStep">Back</OButton>
          <div style="display:flex;gap:8px">
            <OButton variant="ghost" @click="showDrawer = false">Cancel</OButton>
            <OButton v-if="stepIdx < steps.length - 1" variant="primary" @click="nextStep">Continue →</OButton>
            <OButton v-else variant="primary" @click="saveMonitor">{{ editTarget ? 'Save changes' : 'Create monitor' }}</OButton>
          </div>
        </div>
      </template>

      <OStepper v-model="currentStep" :navigable="true">
        <OStep :name="0" title="Type" :done="stepIdx > 0">
          <div class="drw-slabel">Choose monitor type</div>
          <div class="type-grid">
            <div v-for="t in monitorTypes" :key="t.value" class="type-card" :class="{ 'type-card--on': form.type === t.value }" @click="form.type = t.value">
              <div class="type-top"><OIcon :name="t.icon" size="md" :class="form.type===t.value?'type-icon--on':'type-icon--off'" /><OIcon v-if="form.type===t.value" name="check-circle" size="xs" class="type-check" /></div>
              <div class="type-name">{{ t.label }}</div>
              <div class="type-desc">{{ t.desc }}</div>
            </div>
          </div>
        </OStep>
        <OStep :name="1" title="Configure" :done="stepIdx > 1">
          <div class="drw-slabel">Basic configuration</div>
          <div class="fstack">
            <OInput v-model="form.name" label="Monitor name *" />
            <div style="display:flex;gap:8px">
              <OSelect v-if="['HTTP','API'].includes(form.type)" v-model="form.method" label="Method" :options="['GET','POST','PUT','PATCH','DELETE','HEAD'].map(m => ({label: m, value: m}))" class="tw:w-[110px] tw:shrink-0" />
              <OInput v-model="form.url" label="URL *" placeholder="https://example.com/api/health" class="tw:flex-1" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <OSelect v-model="form.interval" label="Check interval" :options="intervalOpts" />
              <OInput v-model.number="form.timeout" label="Timeout (ms)" type="number" />
            </div>
            <OCollapsible title="Request Headers">
              <div class="tw:p-2.5 tw:flex tw:flex-col tw:gap-2">
                <div v-for="(h, i) in form.headers" :key="i" style="display:flex;gap:8px;align-items:center">
                  <OInput v-model="h.key" placeholder="Name" class="tw:flex-1" />
                  <OInput v-model="h.value" placeholder="Value" class="tw:flex-1" />
                  <OButton variant="ghost" size="sm" @click="form.headers.splice(i,1)"><OIcon name="close" size="xs" /></OButton>
                </div>
                <OButton variant="outline" size="sm" @click="form.headers.push({key:'',value:''})">
                  <template #icon-left><OIcon name="add" size="xs" /></template>
                  Add header
                </OButton>
              </div>
            </OCollapsible>
          </div>
        </OStep>
        <OStep :name="2" title="Locations" :done="stepIdx > 2">
          <div class="drw-slabel">Select check locations</div>
          <div style="font-size:12px;color:var(--o2-tab-text-color);margin-bottom:14px">Checks run simultaneously from all selected locations. Select at least one.</div>
          <div class="loc-section-label">Global locations</div>
          <div class="loc-list">
            <div v-for="loc in globalLocations" :key="loc.value" class="loc-item" :class="{ 'loc-item--on': form.locations.includes(loc.value) }" @click="toggleLoc(loc.value)">
              <div class="loc-flag">{{ loc.flag }}</div>
              <div style="flex:1"><div style="font-size:13px;font-weight:500">{{ loc.label }}</div><div style="font-size:11px;color:var(--o2-tab-text-color)">{{ loc.city }}</div></div>
              <OIcon v-if="form.locations.includes(loc.value)" name="check-circle" size="sm" class="type-check" /><div v-else style="width:16px" />
            </div>
          </div>
          <div v-if="onlinePrivateLocations.length">
            <div class="loc-section-label" style="margin-top:16px">Private locations</div>
            <div class="loc-list">
              <div v-for="loc in onlinePrivateLocations" :key="'pl-'+loc.id"
                class="loc-item" :class="{ 'loc-item--on': form.locations.includes('priv-'+loc.id) }" @click="toggleLoc('priv-'+loc.id)">
                <OIcon name="business" size="sm" :class="form.locations.includes('priv-'+loc.id)?'type-icon--on':'type-icon--off'" />
                <div style="flex:1"><div style="font-size:13px;font-weight:500">{{ loc.name }}</div><div style="font-size:11px;color:var(--o2-tab-text-color)">{{ loc.region }}</div></div>
                <OIcon v-if="form.locations.includes('priv-'+loc.id)" name="check-circle" size="sm" class="type-check" /><div v-else style="width:16px" />
              </div>
            </div>
          </div>
        </OStep>
        <OStep :name="3" title="Assertions & Alerts" :done="stepIdx > 3">
          <div class="drw-slabel">Assertions</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
            <div v-for="(a, i) in form.assertions" :key="i" style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--o2-border-color);border-radius:8px">
              <OSelect v-model="a.type" :options="assertionTypes" class="tw:flex-1" />
              <OSelect v-model="a.operator" :options="['=','!=','<','>','contains','matches'].map(o => ({label: o, value: o}))" class="tw:w-[100px]" />
              <OInput v-model="a.value" placeholder="200" class="tw:flex-1" />
              <OButton variant="ghost" size="sm" @click="form.assertions.splice(i,1)"><OIcon name="close" size="xs" /></OButton>
            </div>
            <OButton variant="outline" size="sm" @click="form.assertions.push({type:'statusCode',operator:'=',value:'200'})">
              <template #icon-left><OIcon name="add" size="xs" /></template>
              Add assertion
            </OButton>
          </div>
          <div class="drw-slabel" style="margin-top:20px">Alert conditions</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;align-items:center;gap:8px;font-size:13px;flex-wrap:wrap">
              <span>Alert when failing from</span>
              <OInput v-model.number="form.alertThreshold" type="number" class="tw:w-15" />
              <span>or more location(s)</span>
            </div>
            <OSwitch v-model="form.notifyOnRecovery" label="Notify on recovery" size="sm" />
            <OSwitch v-model="form.renotify" label="Re-notify every 30 min while failing" size="sm" />
          </div>
        </OStep>
      </OStepper>
    </ODrawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import * as echarts from "echarts";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";

const router = useRouter();

const monitorTypeBadgeVariant = (type: string): string => {
  const map: Record<string, string> = {
    HTTP: "blue-soft", BROWSER: "purple-soft", API: "success-soft",
    TCP: "orange-soft", PING: "default-soft", DNS: "amber-soft",
  };
  return map[type.toUpperCase()] ?? "default-soft";
};

const dockerInstallCmd = `docker run -d \\
  -e O2_PRIVATE_LOC_KEY=<your_key> \\
  -e O2_ENDPOINT=https://your-openobserve-host \\
  openobserve/syn-agent:latest`;

const activeTab      = ref("monitors");
const statusFilter   = ref("all");
const typeFilter     = ref("all");
const locationFilter = ref("all");
const search         = ref("");
const showDrawer     = ref(false);
const editTarget     = ref<any>(null);
const currentStep    = ref(0);

// ── Locations tooltip ──────────────────────────────────────────────────
const locTip = ref({ show: false, x: 0, y: 0, locs: [] as string[] });
let locHideTimer: ReturnType<typeof setTimeout> | null = null;
const showLoc = (e: MouseEvent, locs: string[]) => {
  if (locHideTimer) { clearTimeout(locHideTimer); locHideTimer = null; }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  locTip.value = { show: true, x: rect.left, y: rect.bottom + 6, locs };
};
const hideLoc = () => { locHideTimer = setTimeout(() => { locTip.value.show = false; }, 120); };

// ── Spark bar tooltip ──────────────────────────────────────────────────────
const sparkTip = ref({ show: false, x: 0, y: 0, tick: null as HistoryTick | null });
let sparkHideTimer: ReturnType<typeof setTimeout> | null = null;
const showSparkTip = (e: MouseEvent, tick: HistoryTick) => {
  if (sparkHideTimer) { clearTimeout(sparkHideTimer); sparkHideTimer = null; }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  sparkTip.value = { show: true, x: rect.left + rect.width / 2, y: rect.top - 10, tick };
};
const hideSparkTip = () => { sparkHideTimer = setTimeout(() => { sparkTip.value.show = false; }, 80); };
const keepSparkTip = () => { if (sparkHideTimer) { clearTimeout(sparkHideTimer); sparkHideTimer = null; } };

// ── Column resize ─────────────────────────────────────────────────────
const monitorTableColumns: OTableColumnDef[] = [
  {
    id: 'status',
    header: '',
    accessorKey: 'status',
    size: 36,
    minSize: 36,
    sortable: false,
    meta: { align: 'center', cellClass: 'tw:px-0' },
  },
  {
    id: 'name',
    header: 'Monitor',
    accessorKey: 'name',
    size: 200,
    minSize: 120,
    sortable: true,
    meta: { isName: true, flex: true },
  },
  {
    id: 'type',
    header: 'Type',
    accessorKey: 'type',
    size: 88,
    minSize: 72,
    sortable: true,
  },
  {
    id: 'history',
    header: 'Status · Last 24h',
    accessorKey: 'history',
    size: 180,
    minSize: 140,
    sortable: false,
  },
  {
    id: 'responseTime',
    header: 'Response',
    accessorKey: 'responseTime',
    size: 90,
    minSize: 72,
    sortable: true,
    meta: { align: 'right' },
  },
  {
    id: 'uptime',
    header: 'Uptime 7d',
    accessorKey: 'uptime',
    size: 130,
    minSize: 100,
    sortable: true,
    meta: { align: 'right' },
  },
  {
    id: 'locations',
    header: 'Locations',
    accessorKey: 'locations',
    size: 120,
    minSize: 90,
    sortable: false,
  },
  {
    id: 'interval',
    header: 'Interval',
    accessorKey: 'interval',
    size: 72,
    minSize: 60,
    sortable: false,
  },
  {
    id: 'lastCheck',
    header: 'Last check',
    accessorKey: 'lastCheck',
    size: 90,
    minSize: 72,
    sortable: false,
  },
  {
    id: 'actions',
    header: '',
    accessorKey: 'id',
    size: 120,
    minSize: 120,
    sortable: false,
    isAction: true,
  },
]

onUnmounted(() => {
  if (locHideTimer) clearTimeout(locHideTimer);
  if (sparkHideTimer) clearTimeout(sparkHideTimer);
  if (mapTipTimer) clearTimeout(mapTipTimer);
  heatmapChart?.dispose();
});

// ── Geo Checks ────────────────────────────────────────────────────────
const geoAllLocations = [
  { key:"US East",    label:"US East",    flag:"🇺🇸", city:"Virginia, USA"      },
  { key:"US West",    label:"US West",    flag:"🇺🇸", city:"Oregon, USA"        },
  { key:"EU West",    label:"EU West",    flag:"🇮🇪", city:"Dublin, Ireland"    },
  { key:"EU Central", label:"EU Central", flag:"🇩🇪", city:"Frankfurt, Germany" },
  { key:"AP SE",      label:"AP SE",      flag:"🇸🇬", city:"Singapore"          },
  { key:"AP NE",      label:"AP NE",      flag:"🇯🇵", city:"Tokyo, Japan"       },
];
const geoAllRows = computed(() => {
  return monitors.value
    .map(m => {
      const cells = geoAllLocations.map((loc, li) => {
        const configured = m.locations.includes(loc.key);
        if (!configured) return { loc: loc.key, status: "none" as const, ms: null };
        const seed = (m.id * 11 + li * 17 + loc.key.charCodeAt(0)) % 97;
        let st: "up"|"down"|"deg";
        if (m.status === "Down")          st = "down";
        else if (m.status === "Degraded") st = seed % 4 === 0 ? "deg" : seed % 7 === 0 ? "down" : "up";
        else                              st = seed % 11 === 0 ? "deg" : "up";
        const ms = st === "down" ? null : 55 + seed * 4 + (st === "deg" ? 280 + seed * 2 : 0);
        return { loc: loc.key, status: st, ms };
      });
      return { monitor: m, cells };
    })
    .sort((a, b) => {
      const rank = (r: typeof a) => r.cells.some(c=>c.status==="down") ? 0 : r.cells.some(c=>c.status==="deg") ? 1 : 2;
      return rank(a) - rank(b);
    });
});
const geoLocStats = computed(() =>
  geoAllLocations.map((loc, li) => {
    const configured = geoAllRows.value.filter(r => r.cells[li].status !== "none");
    const downCt = configured.filter(r => r.cells[li].status === "down").length;
    const degCt  = configured.filter(r => r.cells[li].status === "deg").length;
    const upCt   = configured.filter(r => r.cells[li].status === "up").length;
    const total  = configured.length;
    const uptime = total ? +(((upCt + degCt * 0.5) / total) * 100).toFixed(1) : 100;
    const health: "up"|"down"|"deg" = downCt > 0 ? "down" : degCt > 0 ? "deg" : "up";
    return { ...loc, total, upCt, degCt, downCt, uptime, health };
  })
);

// ── Geo Map & Panels ───────────────────────────────────────────────────
const geoMapLonLat: Record<string, [number, number]> = {
  "US East":    [-77.0, 38.9],
  "US West":    [-122.4, 45.5],
  "EU West":    [-6.2, 53.3],
  "EU Central": [8.7, 50.1],
  "AP SE":      [103.8, 1.3],
  "AP NE":      [139.7, 35.7],
};

const showHeatmapModal = ref(false);
const heatmapChartEl = ref<HTMLElement | null>(null);
let heatmapChart: echarts.ECharts | null = null;
let worldGeoRegistered = false;

const getHeatmapOption = () => {
  const isDark = document.body.classList.contains("body--dark");
  const landColor   = isDark ? "#1d2f3f" : "#cdd5ae";
  const borderCol   = isDark ? "#2d4560" : "#9faa80";
  const oceanBg     = isDark ? "#0d1b2a" : "#c2ddf0";
  const labelColor  = isDark ? "#cbd5e1" : "#334155";
  return {
    backgroundColor: oceanBg,
    geo: {
      map: "world",
      roam: false,
      silent: true,
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      itemStyle: { areaColor: landColor, borderColor: borderCol, borderWidth: 0.5 },
      emphasis: { itemStyle: { areaColor: landColor }, label: { show: false } },
      select: { disabled: true },
    },
    tooltip: {
      trigger: "item",
      formatter: (params: any) => {
        if (!params.data) return "";
        const d = params.data;
        const col = d.health === "up" ? "#22c55e" : d.health === "down" ? "#ef4444" : "#f59e0b";
        const label = d.health === "up" ? "Healthy" : d.health === "down" ? "Outage" : "Degraded";
        return `<div style="font-size:12px;line-height:1.7"><b>${d.flag} ${d.name}</b><br/><span style="color:${col}">${label}</span><br/>Uptime: ${d.uptime}%<br/>Monitors: ${d.total}</div>`;
      },
      backgroundColor: isDark ? "#1e2d3d" : "#ffffff",
      borderColor:     isDark ? "#2d4560" : "#e2e8f0",
      textStyle: { color: labelColor },
    },
    series: [{
      type: "effectScatter",
      coordinateSystem: "geo",
      rippleEffect: { brushType: "stroke", scale: 3.5, period: 2.5 },
      symbolSize: (val: any, params: any) => Math.max(12, Math.min(26, 10 + (params.data.total ?? 0) * 0.7)),
      data: geoLocStats.value.map(s => ({
        name: s.label,
        value: [geoMapLonLat[s.key][0], geoMapLonLat[s.key][1]],
        health: s.health,
        uptime: s.uptime,
        total: s.total,
        flag: s.flag,
      })),
      itemStyle: {
        color: (params: any) => params.data.health === "up" ? "#22c55e" : params.data.health === "down" ? "#ef4444" : "#f59e0b",
        borderColor: "rgba(255,255,255,0.8)",
        borderWidth: 2,
        shadowBlur: 12,
        shadowColor: (params: any) => params.data.health === "up" ? "rgba(34,197,94,0.5)" : params.data.health === "down" ? "rgba(239,68,68,0.5)" : "rgba(245,158,11,0.5)",
      },
      label: {
        show: true,
        position: "bottom",
        distance: 8,
        formatter: (params: any) => `${params.data.flag} ${params.data.name}`,
        fontSize: 10,
        fontWeight: 600,
        color: labelColor,
        textBorderColor: isDark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.8)",
        textBorderWidth: 2,
      },
    }],
  };
};

const initHeatmapChart = async () => {
  await nextTick();
  if (!heatmapChartEl.value) return;
  if (!worldGeoRegistered) {
    const worldJson = await import("@/assets/dashboard/maps/map.json");
    echarts.registerMap("world", worldJson.default as any);
    worldGeoRegistered = true;
  }
  heatmapChart = echarts.init(heatmapChartEl.value);
  heatmapChart.setOption(getHeatmapOption());
  await nextTick();
  heatmapChart.resize();
};

watch(showHeatmapModal, (open) => {
  if (!open) {
    heatmapChart?.dispose();
    heatmapChart = null;
    return;
  }
  initHeatmapChart().catch((err) => {
    console.error('Failed to initialize heatmap chart:', err);
  });
});
const showIssuesModal  = ref(false);
const geoIssues = computed(() => {
  const list: { key: string; level: "error" | "warn"; stat: typeof geoLocStats.value[0] }[] = [];
  geoLocStats.value.forEach(s => {
    if (s.health === "down") list.push({ key: `${s.key}-down`, level: "error", stat: s });
    else if (s.health === "deg") list.push({ key: `${s.key}-deg`, level: "warn", stat: s });
  });
  return list;
});

const mapTip = ref({ show: false, x: 0, y: 0, stat: null as any });
let mapTipTimer: ReturnType<typeof setTimeout> | null = null;
const hideMapTip = () => { mapTipTimer = setTimeout(() => { mapTip.value.show = false; }, 100); };


// ── Detail Side Panel ──────────────────────────────────────────────────
interface LogEntry { time: string; level: string; logger: string; msg: string; stack?: string }
interface TraceSpan { name: string; dur: number; offset: number; depth: number; status: number | null; color: string; attrs: [string, string][] }
interface Incident  { type: 'down' | 'deg'; id: string; title: string; start: string; dur: string; locs: string }
interface LocRow    { loc: string; checks: number; avg: number | null; p90: number | null; p99: number | null; errRate: string }
interface DetailPanel {
  show: boolean;
  tab: 'overview' | 'logs' | 'metrics' | 'traces';
  monitor: any;
  geoRow: { monitor: any; cells: any[] } | null;
  logs: LogEntry[];
  metricBars: { hour: string; val: number | null }[];
  metricMax: number;
  errorBars: number[];
  traces: TraceSpan[];
  incidents: Incident[];
  uptimeCal: ('ok' | 'deg' | 'down')[];
  locBreakdown: LocRow[];
}
const detailPanel    = ref<DetailPanel | null>(null);
const dpLogFilter    = ref('ALL');
const dpSelectedSpan = ref<TraceSpan | null>(null);

const dpFilteredLogs = computed(() => {
  if (!detailPanel.value) return [] as LogEntry[];
  if (dpLogFilter.value === 'ALL') return detailPanel.value.logs;
  return detailPanel.value.logs.filter((l: LogEntry) => l.level === dpLogFilter.value);
});
const dpLogCounts = computed(() => {
  if (!detailPanel.value) return {} as Record<string, number>;
  return detailPanel.value.logs.reduce((acc: Record<string, number>, l: LogEntry) => {
    acc[l.level] = (acc[l.level] ?? 0) + 1; return acc;
  }, {} as Record<string, number>);
});

const _urlPath = (url: string) => { try { return new URL(url).pathname || '/'; } catch { return '/'; } };
const _urlHost = (url: string) => { try { return new URL(url).hostname; }  catch { return url; } };

const _rtMs = (rt: any): number => {
  if (!rt) return 220;
  const s = String(rt);
  if (s.endsWith('ms')) return parseFloat(s) || 220;
  if (s.endsWith('s'))  return Math.round(parseFloat(s) * 1000) || 220;
  return parseFloat(s) || 220;
};

const _genLogs = (m: any): LogEntry[] => {
  const isDown = m.status === 'Down', isDeg = m.status === 'Degraded';
  const ms   = _rtMs(m.responseTime);
  const path = _urlPath(m.url), host = _urlHost(m.url);
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
  ];
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
  ];
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
  ];
};

const _genBars = (m: any) => {
  const base = _rtMs(m.responseTime);
  const bars = [];
  for (let i = 23; i >= 0; i--) {
    const h = `${String((new Date().getHours() - i + 24) % 24).padStart(2,'0')}:00`;
    const noise = (((m.id * 7 + i * 13) % 60) - 30) / 100;
    let val: number | null = Math.round(base * (1 + noise));
    if (m.status === 'Down' && i <= 1) val = null;
    else if (m.status === 'Degraded' && i <= 2) val = Math.round(base * 2.8);
    bars.push({ hour: h, val });
  }
  return bars;
};

const _genTraces = (m: any): TraceSpan[] => {
  const total = _rtMs(m.responseTime);
  const path  = _urlPath(m.url), host = _urlHost(m.url);
  if (m.status === 'Down') {
    const dns = 6, tcp = 18;
    return [
      { name: `GET ${path}`, dur: 30004, offset: 0,        depth: 0, status: 503, color: 'err', attrs: [['http.method','GET'],['http.url',m.url],['http.flavor','1.1'],['net.peer.name',host],['error.type','ECONNREFUSED'],['retry.count','3'],['synthetic.monitor_id',String(m.id)]] },
      { name: 'dns.resolve',         dur: dns,   offset: 0,      depth: 1, status: null, color: 'ok',  attrs: [['dns.hostname',host],['dns.cached','false'],['dns.resolved_ip','104.21.18.52'],['dns.ttl','300'],['dns.query_type','A']] },
      { name: 'tcp.connect',         dur: tcp,   offset: dns,    depth: 1, status: null, color: 'ok',  attrs: [['net.peer.ip','104.21.18.52'],['net.peer.port','443'],['net.transport','tcp']] },
      { name: 'http.request',        dur: 29980, offset: dns+tcp,depth: 1, status: null, color: 'err', attrs: [['http.flavor','1.1'],['http.method','GET'],['http.path',path],['error','socket hang up']] },
      { name: 'socket.wait_timeout', dur: 29960, offset: dns+tcp+20, depth: 2, status: null, color: 'err', attrs: [['timeout_ms','30000'],['error.type','ETIMEDOUT'],['net.peer.ip','104.21.18.52']] },
    ];
  }
  const dns  = Math.round(total * 0.03);
  const tcp  = Math.round(total * 0.06);
  const tls  = Math.round(total * 0.10);
  const send = Math.round(total * 0.04);
  const rcv  = Math.round(total * 0.74);
  const parse = Math.round(total * 0.03);
  return [
    { name: `GET ${path}`,  dur: total, offset: 0,                    depth: 0, status: 200,  color: total>800?'slow':'ok', attrs: [['http.method','GET'],['http.url',m.url],['http.status_code','200'],['http.response_content_type','application/json'],['http.response_size','4.2 KB'],['synthetic.monitor_id',String(m.id)],['synthetic.location',m.locations?.[0]??'US East']] },
    { name: 'dns.resolve',  dur: dns,   offset: 0,                    depth: 1, status: null, color: 'ok',                  attrs: [['dns.hostname',host],['dns.cached','false'],['dns.resolved_ip','104.21.18.52'],['dns.ttl','300'],['dns.query_type','A']] },
    { name: 'tcp.connect',  dur: tcp,   offset: dns,                  depth: 1, status: null, color: 'ok',                  attrs: [['net.peer.ip','104.21.18.52'],['net.peer.port','443'],['net.transport','tcp'],['net.sock.family','inet']] },
    { name: 'tls.handshake',dur: tls,   offset: dns+tcp,              depth: 1, status: null, color: 'ok',                  attrs: [['tls.protocol_version','TLSv1.3'],['tls.cipher','AES_128_GCM_SHA256'],['tls.resumed','false'],['tls.cert_valid','true'],['tls.cert_expiry','2026-09-14']] },
    { name: 'http.send',    dur: send,  offset: dns+tcp+tls,          depth: 1, status: null, color: 'ok',                  attrs: [['http.method','GET'],['http.path',path],['http.host',host],['net.bytes_sent','342']] },
    { name: 'http.receive', dur: rcv,   offset: dns+tcp+tls+send,     depth: 1, status: null, color: total>800?'slow':'ok', attrs: [['http.status_code','200'],['http.status_text','OK'],['http.content_type','application/json'],['net.bytes_received','4296'],['http.ttfb',String(Math.round(rcv*0.85))+'ms']] },
    { name: 'content.parse',dur: parse, offset: dns+tcp+tls+send+rcv, depth: 2, status: null, color: 'ok',                  attrs: [['content.type','json'],['content.size_bytes','4296'],['content.assertions_passed','3'],['content.assertions_failed','0']] },
  ];
};

const _genIncidents = (m: any): Incident[] => {
  const isDown = m.status === 'Down', isDeg = m.status === 'Degraded';
  const id = (n: number) => 'INC-' + String(m.id * 7 + n).padStart(4, '0');
  const list: Incident[] = [];
  if (isDown)         list.push({ type: 'down', id: id(1), title: 'Outage — TCP connection refused', start: 'Today 14:31', dur: 'Ongoing', locs: 'US West, AP NE' });
  if (isDown||isDeg)  list.push({ type: 'deg',  id: id(2), title: 'Elevated response times (>800ms threshold)', start: 'Jun 17 09:14', dur: '23 min', locs: 'EU West' });
  list.push({ type: 'down', id: id(3), title: 'Scheduled maintenance — planned restart', start: 'Jun 12 02:00', dur: '8 min', locs: 'All locations' });
  list.push({ type: 'deg',  id: id(4), title: 'High TTFB — upstream database slow queries', start: 'Jun 8 15:42', dur: '11 min', locs: 'US East' });
  return list.slice(0, 4);
};

const _genUptimeCal = (m: any): ('ok' | 'deg' | 'down')[] =>
  Array.from({ length: 30 }, (_, i) => {
    const seed = (m.id * 11 + i * 7) % 100;
    if (m.status === 'Down' && i === 29) return 'down';
    return seed > 97 ? 'down' : seed > 91 ? 'deg' : 'ok';
  });

const _genLocBreakdown = (m: any): LocRow[] =>
  (m.locations ?? ['US East']).map((loc: string, i: number) => {
    const seed = (m.id * 3 + loc.length * 5 + i) % 20;
    const base = _rtMs(m.responseTime);
    const adj  = Math.round(base * (0.7 + seed / 50));
    const isErr    = m.status === 'Down' && (loc.toLowerCase().includes('west') || i === 0);
    const isDegLoc = !isErr && m.status === 'Degraded' && i % 2 === 0;
    return { loc, checks: 288, avg: isErr ? null : adj, p90: isErr ? null : Math.round(adj * 1.4), p99: isErr ? null : Math.round(adj * 2.1), errRate: isErr ? '100%' : isDegLoc ? `${seed + 3}%` : '0.0%' };
  });

const openDetail = (monitor: any, geoRow: { monitor: any; cells: any[] } | null = null) => {
  if (monitor.type === 'browser' || monitor.type === 'Browser') {
    router.push({ name: 'synthetic-detail', params: { id: monitor.id } });
    return;
  }
  const bars   = _genBars(monitor);
  const maxVal = Math.max(...bars.filter((b: any) => b.val !== null).map((b: any) => b.val!), 100);
  const errBars = Array.from({ length: 24 }, (_, i) => {
    if (monitor.status === 'Down'     && i >= 22) return 1.0;
    if (monitor.status === 'Degraded' && i >= 20) return ((monitor.id * 3 + i * 7) % 30) / 100;
    return 0;
  });
  dpLogFilter.value    = 'ALL';
  dpSelectedSpan.value = null;
  detailPanel.value = {
    show: true, tab: 'overview', monitor, geoRow,
    logs:         _genLogs(monitor),
    metricBars:   bars, metricMax: maxVal,
    errorBars:    errBars,
    traces:       _genTraces(monitor),
    incidents:    _genIncidents(monitor),
    uptimeCal:    _genUptimeCal(monitor),
    locBreakdown: _genLocBreakdown(monitor),
  };
};
const closeDetail = () => {
  detailPanel.value    = null;
  dpLogFilter.value    = 'ALL';
  dpSelectedSpan.value = null;
};


const tabs = [
  { key:"monitors", label:"All Monitors",     count:30   },
  { key:"browser",  label:"Browser Tests",    count:5    },
  { key:"api",      label:"API Tests",        count:6    },
  { key:"private",  label:"Private Locations",count:null },
];
const steps = [
  { key: 0, label: "Type" },
  { key: 1, label: "Configure" },
  { key: 2, label: "Locations" },
  { key: 3, label: "Assertions & Alerts" },
];
const stepIdx  = computed(() => currentStep.value);
const nextStep = () => {
  if (currentStep.value === 0 && form.value.type === 'Browser') {
    router.push({ name: 'synthetic-new' });
    return;
  }
  if (currentStep.value < steps.length - 1) currentStep.value++;
};
const prevStep = () => { if (currentStep.value > 0) currentStep.value--; };

const defaultForm = () => ({
  type:"HTTP", name:"", url:"", method:"GET",
  interval:"1m", timeout:5000,
  locations:["us-east","eu-west"],
  headers:[] as {key:string;value:string}[],
  assertions:[{type:"statusCode",operator:"=",value:"200"}],
  alertThreshold:1, notifyOnRecovery:true, renotify:false,
});
const form = ref(defaultForm());

const monitorTypes = [
  { value:"HTTP",    label:"HTTP Check",     icon:"network-check",  desc:"Verify any HTTP/HTTPS endpoint response." },
  { value:"Browser", label:"Browser Test",   icon:"web",            desc:"Simulate user journeys in a real browser." },
  { value:"API",     label:"Multi-step API", icon:"webhook",        desc:"Chain multiple API calls end-to-end." },
  { value:"TCP",     label:"TCP Monitor",    icon:"lan",            desc:"Check raw TCP port connectivity." },
  { value:"Ping",    label:"ICMP Ping",      icon:"radar",          desc:"Verify host reachability via ICMP." },
  { value:"DNS",     label:"DNS Check",      icon:"dns",            desc:"Validate DNS records and resolution." },
];
const intervalOpts = [
  { label:"30 seconds", value:"30s" },{ label:"1 minute", value:"1m" },{ label:"5 minutes", value:"5m" },
  { label:"10 minutes", value:"10m" },{ label:"30 minutes", value:"30m" },{ label:"1 hour", value:"1h" },
];
const typeOpts = [
  { label:"All types", value:"all" },
  ...["HTTP","Browser","API","TCP","Ping","DNS"].map(v=>({ label:v, value:v })),
];
const locationOpts = [
  { label:"All locations", value:"all" },
  { label:"US East",      value:"US East" },{ label:"US West",    value:"US West" },
  { label:"EU West",      value:"EU West" },{ label:"EU Central", value:"EU Central" },{ label:"AP Southeast", value:"AP SE" },
];
const globalLocations = [
  { value:"us-east",    label:"US East",      city:"Virginia, USA",      flag:"🇺🇸" },
  { value:"us-west",    label:"US West",      city:"Oregon, USA",        flag:"🇺🇸" },
  { value:"eu-west",    label:"EU West",      city:"Dublin, Ireland",    flag:"🇮🇪" },
  { value:"eu-central", label:"EU Central",   city:"Frankfurt, Germany", flag:"🇩🇪" },
  { value:"ap-se",      label:"AP Southeast", city:"Singapore",          flag:"🇸🇬" },
  { value:"ap-ne",      label:"AP Northeast", city:"Tokyo, Japan",       flag:"🇯🇵" },
];
const assertionTypes = [
  { label:"Status code",        value:"statusCode" },
  { label:"Response time (ms)", value:"responseTime" },
  { label:"Body contains",      value:"bodyContains" },
  { label:"Header value",       value:"header" },
  { label:"JSON path",          value:"jsonPath" },
  { label:"Certificate TTL",    value:"certTTL" },
];

// ── 30 mock monitors ──────────────────────────────────────────────────
interface HistoryTick {
  status: "up"|"down"|"deg";
  hour: string;
  nextHour: string;
  checks: { loc: string; ms: number|null; ok: boolean }[];
  avgMs: number|null;
}

const genHistory = (n: number, k: "up"|"down"|"deg", locs: string[]): HistoryTick[] => {
  const now = new Date();
  return Array.from({length: n}, (_, i) => {
    const hoursAgo = n - 1 - i;
    const d = new Date(now.getTime() - hoursAgo * 3_600_000);
    const hour     = `${String(d.getHours()).padStart(2,"0")}:00`;
    const nextHour = `${String((d.getHours() + 1) % 24).padStart(2,"0")}:00`;
    const st: "up"|"down"|"deg" = k==="up" ? "up"
      : k==="down" ? (i > n - 5 ? "down" : "up")
      : (i % 4 === 0 ? "deg" : "up");
    const checks = locs.map((loc, li) => {
      const seed = (i * 7 + li * 13 + loc.charCodeAt(0)) % 97;
      const ok = st !== "down";
      const ms = ok ? 60 + seed * 3 + (st === "deg" ? 180 + seed : 0) : null;
      return { loc, ms, ok };
    });
    const valid = checks.map(c => c.ms).filter((v): v is number => v !== null);
    const avgMs = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
    return { status: st, hour, nextHour, checks, avgMs };
  });
};

const monitors = ref([
  { id:1,  name:"Homepage",           url:"https://openobserve.ai",                  type:"HTTP",    interval:"1m",  status:"Up",       responseTime:"142ms", uptime:99.9, locations:["US East","EU West","AP SE"],                        lastCheck:"2s ago"   },
  { id:2,  name:"API Health",         url:"https://api.openobserve.ai/healthz",      type:"HTTP",    interval:"30s", status:"Up",       responseTime:"89ms",  uptime:100,  locations:["US East","US West","EU West","EU Central","AP SE"],  lastCheck:"1s ago"   },
  { id:3,  name:"Login Flow",         url:"https://openobserve.ai/login",            type:"Browser", interval:"5m",  status:"Degraded", responseTime:"1.8s",  uptime:98.1, locations:["US East","EU West"],                                lastCheck:"3m ago"   },
  { id:4,  name:"Checkout API",       url:"https://api.openobserve.ai/v1/checkout",  type:"API",     interval:"1m",  status:"Down",     responseTime:null,    uptime:95.3, locations:["US East","US West","EU West"],                      lastCheck:"1m ago"   },
  { id:5,  name:"Docs Site",          url:"https://openobserve.ai/docs",             type:"HTTP",    interval:"5m",  status:"Up",       responseTime:"234ms", uptime:99.7, locations:["US East","EU West"],                                lastCheck:"4m ago"   },
  { id:6,  name:"Ingest Endpoint",    url:"https://ingest.openobserve.ai",           type:"HTTP",    interval:"30s", status:"Up",       responseTime:"67ms",  uptime:100,  locations:["US East","US West","EU West","AP SE"],              lastCheck:"5s ago"   },
  { id:7,  name:"Auth Service",       url:"https://auth.openobserve.ai/token",       type:"API",     interval:"1m",  status:"Up",       responseTime:"110ms", uptime:99.8, locations:["US East","EU West","AP SE"],                        lastCheck:"45s ago"  },
  { id:8,  name:"Dashboard Load",     url:"https://openobserve.ai/web/dashboards",   type:"Browser", interval:"10m", status:"Degraded", responseTime:"3.2s",  uptime:97.4, locations:["US East"],                                          lastCheck:"9m ago"   },
  { id:9,  name:"Metrics API",        url:"https://api.openobserve.ai/v1/metrics",   type:"API",     interval:"1m",  status:"Up",       responseTime:"95ms",  uptime:99.5, locations:["US East","EU West"],                                lastCheck:"30s ago"  },
  { id:10, name:"DB TCP Probe",       url:"db.openobserve.ai:5432",                  type:"TCP",     interval:"1m",  status:"Up",       responseTime:"12ms",  uptime:100,  locations:["US East"],                                          lastCheck:"15s ago"  },
  { id:11, name:"CDN Latency",        url:"https://cdn.openobserve.ai",              type:"HTTP",    interval:"5m",  status:"Up",       responseTime:"31ms",  uptime:100,  locations:["US East","US West","EU West"],                      lastCheck:"4m ago"   },
  { id:12, name:"Search API",         url:"https://api.openobserve.ai/v1/search",    type:"API",     interval:"1m",  status:"Up",       responseTime:"203ms", uptime:99.2, locations:["US East","EU West"],                                lastCheck:"50s ago"  },
  { id:13, name:"Signup Flow",        url:"https://openobserve.ai/signup",           type:"Browser", interval:"10m", status:"Up",       responseTime:"2.1s",  uptime:99.6, locations:["US East","EU West"],                                lastCheck:"8m ago"   },
  { id:14, name:"Billing API",        url:"https://api.openobserve.ai/v1/billing",   type:"API",     interval:"2m",  status:"Degraded", responseTime:"820ms", uptime:96.7, locations:["US East"],                                          lastCheck:"1m ago"   },
  { id:15, name:"Status Page",        url:"https://status.openobserve.ai",           type:"HTTP",    interval:"1m",  status:"Up",       responseTime:"88ms",  uptime:99.9, locations:["US East","US West","EU West","AP SE"],              lastCheck:"30s ago"  },
  { id:16, name:"Redis Probe",        url:"cache.openobserve.ai:6379",               type:"TCP",     interval:"30s", status:"Up",       responseTime:"5ms",   uptime:100,  locations:["US East"],                                          lastCheck:"10s ago"  },
  { id:17, name:"Onboarding Flow",    url:"https://openobserve.ai/onboarding",       type:"Browser", interval:"15m", status:"Up",       responseTime:"1.4s",  uptime:99.1, locations:["US East","EU West"],                                lastCheck:"14m ago"  },
  { id:18, name:"Alert Webhook",      url:"https://alerts.openobserve.ai/webhook",   type:"HTTP",    interval:"5m",  status:"Up",       responseTime:"145ms", uptime:99.4, locations:["US East","EU Central"],                             lastCheck:"3m ago"   },
  { id:19, name:"DNS openobserve.ai", url:"openobserve.ai",                          type:"DNS",     interval:"5m",  status:"Up",       responseTime:"22ms",  uptime:100,  locations:["US East","EU West"],                                lastCheck:"4m ago"   },
  { id:20, name:"Alerts API",         url:"https://api.openobserve.ai/v1/alerts",    type:"API",     interval:"1m",  status:"Up",       responseTime:"77ms",  uptime:99.8, locations:["US East","EU West","AP SE"],                        lastCheck:"45s ago"  },
  { id:21, name:"Export API",         url:"https://api.openobserve.ai/v1/export",    type:"API",     interval:"5m",  status:"Down",     responseTime:null,    uptime:92.1, locations:["US East"],                                          lastCheck:"4m ago"   },
  { id:22, name:"Pricing Page",       url:"https://openobserve.ai/pricing",          type:"HTTP",    interval:"10m", status:"Up",       responseTime:"178ms", uptime:99.8, locations:["US East","EU West"],                                lastCheck:"8m ago"   },
  { id:23, name:"MQ Probe",           url:"mq.openobserve.ai:5672",                  type:"TCP",     interval:"1m",  status:"Up",       responseTime:"8ms",   uptime:100,  locations:["US East","EU Central"],                             lastCheck:"20s ago"  },
  { id:24, name:"Forgot Password",    url:"https://openobserve.ai/forgot-password",  type:"Browser", interval:"30m", status:"Up",       responseTime:"0.9s",  uptime:99.3, locations:["US East"],                                          lastCheck:"28m ago"  },
  { id:25, name:"DNS api. record",    url:"api.openobserve.ai",                      type:"DNS",     interval:"5m",  status:"Up",       responseTime:"18ms",  uptime:100,  locations:["US East","EU West"],                                lastCheck:"4m ago"   },
  { id:26, name:"Blog Site",          url:"https://openobserve.ai/blog",             type:"HTTP",    interval:"10m", status:"Up",       responseTime:"310ms", uptime:99.5, locations:["US East","EU West"],                                lastCheck:"9m ago"   },
  { id:27, name:"User API",           url:"https://api.openobserve.ai/v1/users",     type:"API",     interval:"1m",  status:"Up",       responseTime:"63ms",  uptime:99.9, locations:["US East","EU West","AP SE"],                        lastCheck:"55s ago"  },
  { id:28, name:"Settings Page",      url:"https://openobserve.ai/settings",         type:"Browser", interval:"30m", status:"Degraded", responseTime:"4.1s",  uptime:94.0, locations:["EU West"],                                          lastCheck:"29m ago"  },
  { id:29, name:"Ping GW1",           url:"gw1.openobserve.ai",                      type:"Ping",    interval:"1m",  status:"Up",       responseTime:"7ms",   uptime:100,  locations:["US East","EU West"],                                lastCheck:"1m ago"   },
  { id:30, name:"Ping GW2",           url:"gw2.openobserve.ai",                      type:"Ping",    interval:"1m",  status:"Up",       responseTime:"9ms",   uptime:100,  locations:["US East","AP SE"],                                  lastCheck:"50s ago"  },
].map(m => ({ ...m, history: genHistory(24, m.status==="Up"?"up":m.status==="Down"?"down":"deg", m.locations) })));

const browserMonitors = computed(() => monitors.value.filter(m=>m.type==="Browser").map(m=>({...m,steps:[3,7,4,5,4][m.id%5]})));
const apiMonitors     = computed(() => monitors.value.filter(m=>m.type==="API").map(m=>({...m,method:"GET",assertions:3})));

const privateLocations = ref([
  { id:1, name:"Corp HQ",        region:"New York, US",  status:"Online",  monitors:12, workers:2, checks:36, version:"1.4.2", lastSeen:"5s ago" },
  { id:2, name:"EU Data Center", region:"Frankfurt, DE", status:"Online",  monitors:8,  workers:3, checks:24, version:"1.4.2", lastSeen:"2s ago" },
  { id:3, name:"APAC Office",    region:"Singapore",     status:"Offline", monitors:4,  workers:1, checks:0,  version:"1.3.9", lastSeen:"2h ago" },
]);
const onlinePrivateLocations = computed(() => privateLocations.value.filter(l=>l.status==="Online"));

const statusTabs = computed(() => {
  const ms = monitors.value;
  return [
    { filter:"all",      label:"All",      count:ms.length },
    { filter:"Up",       label:"Up",       count:ms.filter(m=>m.status==="Up").length },
    { filter:"Degraded", label:"Degraded", count:ms.filter(m=>m.status==="Degraded").length },
    { filter:"Down",     label:"Down",     count:ms.filter(m=>m.status==="Down").length },
  ];
});

const filteredMonitors = computed(() =>
  monitors.value.filter(m=>
    (statusFilter.value==="all"   || m.status===statusFilter.value) &&
    (typeFilter.value==="all"     || m.type===typeFilter.value) &&
    (locationFilter.value==="all" || m.locations.includes(locationFilter.value)) &&
    (!search.value || m.name.toLowerCase().includes(search.value.toLowerCase()) || m.url.toLowerCase().includes(search.value.toLowerCase()))
  )
);

const rtCls = (rt: string|null) => { if (!rt) return "c-r"; const v=parseFloat(rt); return v<300?"c-g":v<1000?"c-a":"c-r"; };
const toggleLoc  = (v: string) => { const i=form.value.locations.indexOf(v); if(i===-1)form.value.locations.push(v); else form.value.locations.splice(i,1); };
const openCreate  = () => { editTarget.value=null; form.value=defaultForm(); currentStep.value=0; showDrawer.value=true; };
const openEdit    = (m: any) => { editTarget.value=m; form.value={...defaultForm(),name:m.name,url:m.url,type:m.type,interval:m.interval}; currentStep.value=1; showDrawer.value=true; };
const saveMonitor = () => { showDrawer.value=false; };
</script>

<style scoped>
/* ── ROOT — no hardcoded fallback colors; inherit dark/light from Quasar ── */
.syn-root { display:flex; flex-direction:column; height:100%; overflow:hidden; position:relative; }

/* ── PAGE HEADER ── */
.syn-page-header     { display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; background:var(--o2-card-background); }
.syn-hdr-actions     { display:flex; align-items:center; gap:10px; }
.syn-page-title-wrap { display:flex; align-items:center; gap:12px; }
.syn-page-icon       { width:36px; height:36px; border-radius:9px; background:rgba(0,0,0,.07); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.body--dark .syn-page-icon { background:rgba(255,255,255,.1); }
.syn-title           { font-size:14px; font-weight:700; line-height:1.2; }
.syn-sub             { font-size:12px; color:var(--o2-tab-text-color); margin-top:1px; }

/* ── FILTER BAR ── */
.syn-filter-bar  { display:flex; align-items:center; gap:5px; padding:6px 14px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; background:var(--o2-card-background); }
.syn-filter-sep  { width:1px; height:18px; background:var(--o2-border-color); flex-shrink:0; margin:0 2px; }


.syn-pill-count      { font-size:11px; font-weight:700; }
.syn-pill-dot    { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
.sdot-up         { background:#22c55e; }
.sdot-degraded   { background:#f59e0b; }
.sdot-down       { background:#ef4444; }

/* ── TABLE AREA — fills space, no hardcoded bg ── */
.syn-table-scroll { flex:1; overflow:auto; padding:12px 16px 0; }
.syn-table { border-collapse:collapse; border:1px solid var(--o2-border-color); border-radius:10px; overflow:hidden; background:var(--o2-card-background); width:100%; min-width:1000px; }
.syn-th  { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--o2-tab-text-color); padding:9px 14px; border-bottom:1px solid var(--o2-border-color); text-align:left; position:sticky; top:0; background:var(--o2-card-background); z-index:1; white-space:nowrap; overflow:hidden; }
.syn-th.right { text-align:right; }
.syn-row { border-bottom:1px solid var(--o2-border-color); transition:background .1s; }
.syn-row:last-child { border-bottom:none; }
.syn-row:hover { background:rgba(128,128,128,.06); }
.syn-row:hover .row-actions { opacity:1 !important; }
.syn-td    { padding:10px 14px; vertical-align:middle; overflow:hidden; }
.td-center { text-align:center; }
.td-right  { text-align:right; }
.td-muted  { font-size:12px; color:var(--o2-tab-text-color); white-space:nowrap; }

.dot         { display:inline-block; border-radius:50%; flex-shrink:0; }
.dot--up       { width:9px; height:9px; background:#22c55e; box-shadow:0 0 0 3px rgba(34,197,94,.15); }
.dot--degraded { width:9px; height:9px; background:#f59e0b; box-shadow:0 0 0 3px rgba(245,158,11,.15); }
.dot--down     { width:9px; height:9px; background:#ef4444; box-shadow:0 0 0 3px rgba(239,68,68,.15); }

.mon-name { font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mon-url  { font-size:11px; font-family:monospace; color:var(--o2-tab-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }

.http-method    { display:inline-block; padding:2px 7px; border-radius:4px; font-size:11px; font-weight:700; font-family:monospace; }
.method--get    { background:#dbeafe; color:#1d4ed8; }
.method--post   { background:#d1fae5; color:#065f46; }
.method--put    { background:#ffedd5; color:#c2410c; }
.method--delete { background:#fee2e2; color:#991b1b; }
.body--dark .method--get    { background:#172554; color:#93c5fd; }
.body--dark .method--post   { background:#052e16; color:#6ee7b7; }
.body--dark .method--put    { background:#431407; color:#fdba74; }
.body--dark .method--delete { background:#450a0a; color:#fca5a5; }

.spark { display:flex; align-items:flex-end; gap:2px; height:20px; }
.spark-bar {
  width:7px; height:18px; border-radius:2px; flex-shrink:0; cursor:pointer;
  transition:height .1s, opacity .1s, filter .1s;
}
.spark-bar:hover { height:20px; filter:brightness(1.25); }
.spark:has(.spark-bar:hover) .spark-bar:not(:hover) { opacity:.45; }
.spark--up   { background:#22c55e; }
.spark--down { background:#ef4444; }
.spark--deg  { background:#f59e0b; }

/* ── Spark detail tooltip ── */
.spark-tooltip {
  position:fixed; z-index:10000;
  background:#1e293b; color:#f1f5f9;
  border-radius:9px; padding:10px 13px;
  box-shadow:0 10px 32px rgba(0,0,0,.4);
  min-width:210px; max-width:280px;
  pointer-events:auto;
  transform:translateX(-50%) translateY(-100%);
  font-size:12px;
}
.stt-header { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:7px; }
.stt-time   { font-size:11px; opacity:.65; white-space:nowrap; }
.stt-badge  { font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px; white-space:nowrap; }
.stt-badge--up   { background:rgba(34,197,94,.2);  color:#4ade80; }
.stt-badge--down { background:rgba(239,68,68,.2);  color:#f87171; }
.stt-badge--deg  { background:rgba(245,158,11,.2); color:#fbbf24; }
.stt-divider { height:1px; background:rgba(255,255,255,.08); margin-bottom:8px; }
.stt-checks  { display:flex; flex-direction:column; gap:5px; margin-bottom:8px; }
.stt-check   { display:flex; align-items:center; gap:7px; }
.stt-dot     { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
.stt-dot--up   { background:#22c55e; box-shadow:0 0 5px rgba(34,197,94,.5); }
.stt-dot--down { background:#ef4444; box-shadow:0 0 5px rgba(239,68,68,.5); }
.stt-loc     { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stt-ms      { font-size:11px; color:rgba(241,245,249,.55); white-space:nowrap; font-family:monospace; }
.stt-avg     { font-size:11px; color:rgba(241,245,249,.5); border-top:1px solid rgba(255,255,255,.08); padding-top:6px; font-family:monospace; }
.stt-arrow   {
  position:absolute; bottom:-7px; left:50%; transform:translateX(-50%);
  width:0; height:0;
  border-left:7px solid transparent;
  border-right:7px solid transparent;
  border-top:7px solid #1e293b;
}

.uptime-row   { display:flex; align-items:center; justify-content:flex-end; gap:8px; }

.locs-cell  { display:flex; align-items:center; gap:5px; cursor:default; }
.loc-first  { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:70px; }
.loc-badge  { font-size:11px; font-weight:700; padding:1px 5px; background:rgba(128,128,128,.18); border-radius:4px; white-space:nowrap; flex-shrink:0; }

.loc-float-tip  { position:fixed; z-index:9999; background:#1e293b; color:#f1f5f9; border-radius:8px; padding:9px 13px; box-shadow:0 8px 24px rgba(0,0,0,.28); min-width:150px; pointer-events:none; }
.loc-float-item { display:flex; align-items:center; gap:7px; font-size:12px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,.07); }
.loc-float-item:last-child { border-bottom:none; }
.loc-float-dot  { width:6px; height:6px; border-radius:50%; background:#22c55e; flex-shrink:0; }

.syn-page-icon { color: var(--o2-primary-color); }

.row-actions { display:flex; align-items:center; gap:2px; }

.mono { font-family:monospace; font-size:13px; font-weight:600; }
.c-g  { color:#16a34a; } .c-a { color:#d97706; } .c-r { color:#dc2626; }

/* ── PAGINATION FOOTER — matches Incidents ── */
.syn-footer       { display:flex; align-items:center; padding:9px 16px; border-top:1px solid var(--o2-border-color); flex-shrink:0; background:var(--o2-card-background); gap:12px; min-height:46px; }
.syn-footer-total { font-size:13px; font-weight:700; white-space:nowrap; }
.syn-footer-right { display:flex; align-items:center; gap:8px; }
.syn-footer-info  { font-size:12px; color:var(--o2-tab-text-color); white-space:nowrap; }
.syn-footer-sep   { width:1px; height:16px; background:var(--o2-border-color); flex-shrink:0; }

/* ── PRIVATE LOCATIONS ── */
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
/* ── DRAWER ── */
.drw-slabel { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--o2-tab-text-color); margin-bottom:12px; }
.drw-footer { display:flex; align-items:center; justify-content:space-between; padding:12px 22px; border-top:1px solid var(--o2-border-color); flex-shrink:0; }

.type-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.type-card { border:1.5px solid var(--o2-border-color); border-radius:10px; padding:14px; cursor:pointer; transition:border-color .12s,background .12s; }
.type-card:hover  { border-color:var(--o2-primary-color); }
.type-card--on    { border-color:var(--o2-primary-color); background:color-mix(in srgb,var(--o2-primary-color) 8%,transparent); }
.type-top  { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
.type-name { font-size:13px; font-weight:700; margin-bottom:3px; }
.type-desc { font-size:11px; color:var(--o2-tab-text-color); line-height:1.4; }

.fstack { display:flex; flex-direction:column; gap:12px; }
.loc-section-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--o2-tab-text-color); margin-bottom:8px; }
.loc-list   { display:flex; flex-direction:column; gap:6px; }
.loc-item   { display:flex; align-items:center; gap:12px; padding:10px 14px; border:1.5px solid var(--o2-border-color); border-radius:8px; cursor:pointer; transition:border-color .12s,background .12s; }
.loc-item:hover { border-color:var(--o2-primary-color); }
.loc-item--on   { border-color:var(--o2-primary-color); background:color-mix(in srgb,var(--o2-primary-color) 6%,transparent); }
.loc-flag { font-size:18px; line-height:1; }

/* ── GEO CHECKS ── */

/* Anomaly strip */
.geo-anomaly-strip { display:flex; flex-direction:column; gap:4px; padding:8px 16px 0; flex-shrink:0; }
.geo-anomaly-item  { display:flex; align-items:center; gap:8px; border-radius:7px; padding:6px 10px; font-size:12px; }
.geo-anomaly--error { background:rgba(239,68,68,.10); color:#dc2626; }
.geo-anomaly--warn  { background:rgba(245,158,11,.10); color:#d97706; }
.body--dark .geo-anomaly--error { color:#f87171; }
.body--dark .geo-anomaly--warn  { color:#fbbf24; }
.geo-anomaly-msg  { flex:1; }
.geo-anomaly-icon { flex-shrink:0; }
.geo-anomaly-x    { background:none; border:none; cursor:pointer; padding:2px; opacity:.6; color:inherit; display:flex; border-radius:4px; }
.geo-anomaly-x:hover { opacity:1; }

/* Upper: map + right panel */
.geo-upper    { display:flex; gap:12px; padding:8px 16px 0; flex-shrink:0; height:220px; }
.geo-map-wrap { flex:1; min-width:0; border:1px solid var(--o2-border-color); border-radius:10px; overflow:hidden; background:var(--o2-card-background); position:relative; }
.geo-world-map { width:100%; height:100%; display:block; }

/* Filter bar geo buttons */
.geo-hdr-btn--alert { border-color:rgba(239,68,68,.4); color:#dc2626; }
.body--dark .geo-hdr-btn--alert { color:#f87171; border-color:rgba(239,68,68,.35); }
.geo-hdr-badge { display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; border-radius:9px; background:#ef4444; color:#fff; font-size:10px; font-weight:700; padding:0 4px; margin-left:2px; }

/* "View Full Heatmap" button overlay — no longer used, kept for safety */
.geo-fullmap-btn { display:none; }

/* ECharts map container */
.geo-echarts-map { width:100%; height:100%; }

/* Right panel */
.geo-right-panel { width:256px; flex-shrink:0; border:1px solid var(--o2-border-color); border-radius:10px; background:var(--o2-card-background); display:flex; flex-direction:column; overflow:hidden; }
.geo-panel-header { display:flex; align-items:center; gap:6px; padding:9px 12px 8px; font-size:12px; font-weight:600; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; }
.geo-panel-placeholder { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:16px; }

/* Bar chart */
.geo-bar-subtitle { font-size:10px; color:var(--o2-tab-text-color); padding:6px 12px 2px; text-transform:uppercase; letter-spacing:.04em; flex-shrink:0; }
.geo-bars  { flex:1; overflow-y:auto; padding:4px 12px 8px; display:flex; flex-direction:column; gap:7px; }
.geo-bar-row { display:flex; align-items:center; gap:6px; }
.geo-bar-loc { font-size:10px; width:60px; flex-shrink:0; white-space:nowrap; }
.geo-bar-track { flex:1; height:7px; background:rgba(128,128,128,0.12); border-radius:4px; overflow:hidden; }
.geo-bar-fill { height:100%; border-radius:4px; transition:width .35s ease; }
.geo-fill-g { background:#22c55e; }
.geo-fill-a { background:#f59e0b; }
.geo-fill-r { background:#ef4444; }
.geo-bar-val { font-size:11px; font-family:monospace; font-weight:600; width:54px; text-align:right; flex-shrink:0; }

/* Color helpers */
.c-g { color:#15803d; } .body--dark .c-g { color:#4ade80; }
.c-a { color:#d97706; } .body--dark .c-a { color:#fbbf24; }
.c-r { color:#dc2626; } .body--dark .c-r { color:#f87171; }

/* Compare panel */
.geo-compare-summary { display:flex; align-items:stretch; padding:8px 12px 6px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; }
.geo-compare-col  { flex:1; text-align:center; }
.geo-compare-loc  { font-size:10px; color:var(--o2-tab-text-color); margin-bottom:2px; }
.geo-compare-pct  { font-size:20px; font-weight:800; line-height:1; }
.geo-compare-sub  { font-size:9px; color:var(--o2-tab-text-color); margin-top:2px; }
.geo-compare-sep  { width:1px; background:var(--o2-border-color); margin:0 8px; }
.geo-compare-rows { flex:1; overflow-y:auto; padding:4px 12px 8px; display:flex; flex-direction:column; gap:3px; }
.geo-compare-row  { display:flex; align-items:center; gap:5px; font-size:11px; padding:3px 0; border-bottom:1px solid rgba(128,128,128,.07); }
.geo-compare-mon  { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--o2-tab-text-color); }
.geo-compare-val  { font-family:monospace; font-weight:600; font-size:11px; }

/* Matrix table */
.geo-matrix { min-width:900px; }
.geo-th--monitor { width:220px; }
.geo-th { text-align:center; transition:background .12s; }
.geo-th-flag { font-size:14px; }
.geo-th--compare { background:rgba(25,118,210,.08) !important; }
.body--dark .geo-th--compare { background:rgba(99,179,237,.1) !important; }
.geo-th-badge { display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; border-radius:50%; background:var(--o2-primary-color); color:#fff; font-size:9px; font-weight:700; margin-left:4px; vertical-align:middle; }

.geo-mon-name { font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px; }
.geo-mon-url  { font-size:11px; color:var(--o2-tab-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px; margin-top:2px; }

.geo-row:hover .syn-td { background:rgba(128,128,128,.04); }
.geo-row--active .syn-td { background:rgba(25,118,210,.05) !important; }
.body--dark .geo-row--active .syn-td { background:rgba(99,179,237,.07) !important; }

.geo-cell { transition:background .12s; }
.geo-cell--up   { background:rgba(34,197,94,.06); }
.geo-cell--down { background:rgba(239,68,68,.08); }
.geo-cell--deg  { background:rgba(245,158,11,.08); }
.geo-cell > * { display:inline-flex; align-items:center; gap:5px; }

.geo-cell-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
.geo-cdot--up   { background:#22c55e; box-shadow:0 0 4px rgba(34,197,94,.6); }
.geo-cdot--down { background:#ef4444; box-shadow:0 0 4px rgba(239,68,68,.6); }
.geo-cdot--deg  { background:#f59e0b; box-shadow:0 0 4px rgba(245,158,11,.6); }
.geo-cell-ms  { font-size:12px; font-family:monospace; font-weight:600; }
.geo-cell--up   .geo-cell-ms { color:#15803d; }
.geo-cell--down .geo-cell-ms { color:#dc2626; }
.geo-cell--deg  .geo-cell-ms { color:#d97706; }
.body--dark .geo-cell--up   .geo-cell-ms { color:#4ade80; }
.body--dark .geo-cell--down .geo-cell-ms { color:#f87171; }
.body--dark .geo-cell--deg  .geo-cell-ms { color:#fbbf24; }
.geo-cell-dash { font-size:14px; color:rgba(128,128,128,.35); }

/* Map dot floating tooltip */
.map-dot-tip { position:fixed; z-index:9999; padding:10px 12px; background:#1e293b; color:#f1f5f9; border-radius:9px; font-size:12px; min-width:170px; pointer-events:auto; box-shadow:0 8px 24px rgba(0,0,0,.35); }
.map-tip-row { display:flex; justify-content:space-between; gap:16px; margin-top:4px; font-size:11px; }
.map-tip-val { font-weight:600; }

/* ── MODALS ── */
.geo-modal-legend { display:flex; align-items:center; gap:12px; margin-left:8px; flex:1; }
.geo-leg-item { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--o2-tab-text-color); }
.geo-leg-dot { display:inline-block; width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.geo-leg-dot--up  { background: #22c55e; }
.geo-leg-dot--deg { background: #f59e0b; }
.geo-leg-dot--dn  { background: #ef4444; }
.geo-modal-body { flex:none; height:clamp(360px,46vw,540px); overflow:hidden; padding:0; }
.issues-body { flex:1; overflow-y:auto; }
.issues-clear { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:48px 24px; text-align:center; }
.issues-banner { display:flex; align-items:center; gap:8px; margin:12px 16px 0; padding:8px 12px; background:rgba(245,158,11,.1); border-radius:8px; font-size:12px; color:#d97706; }
.body--dark .issues-banner { color:#fbbf24; background:rgba(245,158,11,.12); }
.issues-list { padding:8px 16px 16px; display:flex; flex-direction:column; gap:6px; }
.issues-row { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-radius:10px; border:1px solid var(--o2-border-color); }
.issues-row--error { background:rgba(239,68,68,.04); border-color:rgba(239,68,68,.2); }
.issues-row--warn  { background:rgba(245,158,11,.04); border-color:rgba(245,158,11,.2); }
.issues-row-left { display:flex; align-items:center; gap:10px; }
.issues-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
.issues-dot--down { background:#ef4444; box-shadow:0 0 6px rgba(239,68,68,.6); }
.issues-dot--deg  { background:#f59e0b; box-shadow:0 0 6px rgba(245,158,11,.6); }
.issues-loc  { font-size:13px; font-weight:600; }
.issues-city { font-size:11px; color:var(--o2-tab-text-color); margin-top:1px; }
.issues-row-right { display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
.issues-badge { font-size:10px; font-weight:700; padding:2px 8px; border-radius:5px; white-space:nowrap; }
.issues-badge--down { background:rgba(239,68,68,.12); color:#dc2626; }
.issues-badge--deg  { background:rgba(245,158,11,.12); color:#d97706; }
.body--dark .issues-badge--down { color:#f87171; }
.body--dark .issues-badge--deg  { color:#fbbf24; }
.issues-uptime { font-size:12px; font-weight:700; }
.issues-total  { font-size:10px; color:var(--o2-tab-text-color); }


/* ── ICON COLOR HELPERS ── */
.pl-icon-muted   { color:var(--o2-tab-text-color); flex-shrink:0; }
.pl-icon-primary { color:var(--o2-primary-color); flex-shrink:0; }
.type-icon--on   { color:var(--o2-primary-color); }
.type-icon--off  { color:rgba(128,128,128,.7); }
.type-check      { color:var(--o2-primary-color); flex-shrink:0; }

/* ── Detail Side Panel ──────────────────────────────────────────────── */
.dp-overlay { position:fixed; inset:0; z-index:1400; background:rgba(0,0,0,.38); display:flex; justify-content:flex-end; }
.dp-panel { width:min(1040px,97vw); height:100%; background:var(--o2-card-background); border-left:1px solid var(--o2-border-color); display:flex; flex-direction:column; overflow:hidden; box-shadow:-16px 0 50px rgba(0,0,0,.22); }

/* transitions */
.dp-enter-active .dp-panel { transition:transform .26s cubic-bezier(.25,.46,.45,.94); }
.dp-enter-from .dp-panel   { transform:translateX(100%); }
.dp-leave-active .dp-panel { transition:transform .2s ease-in; }
.dp-leave-to .dp-panel     { transform:translateX(100%); }
.dp-enter-active, .dp-leave-active { transition:background .22s; }
.dp-enter-from, .dp-leave-to       { background:transparent !important; }

/* header */
.dp-hdr { padding:16px 20px 12px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; }
.dp-hdr-top { display:flex; align-items:flex-start; gap:12px; margin-bottom:8px; }
.dp-hdr-titles { flex:1; min-width:0; }
.dp-title { font-size:15px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dp-url   { font-size:12px; color:var(--o2-tab-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
.dp-badges { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.dp-meta-chip { font-size:11px; color:var(--o2-tab-text-color); background:rgba(128,128,128,.1); border-radius:4px; padding:2px 8px; }

/* tabs */
.dp-tab-ct { background:rgba(128,128,128,.15); border-radius:10px; font-size:10px; padding:1px 6px; font-weight:600; }

/* body */
.dp-body { flex:1; overflow-y:auto; overflow-x:hidden; padding:18px 20px; display:flex; flex-direction:column; gap:18px; }

/* two-column layout for overview & metrics */
.dp-ov-grid    { display:grid; grid-template-columns:1fr 1fr; gap:22px; align-items:start; }
.dp-metrics-grid { display:grid; grid-template-columns:1fr 1fr; gap:22px; align-items:start; }
.dp-ov-col     { display:flex; flex-direction:column; gap:18px; }

/* KPIs — 4 col on wide panel, 4 col on left col */
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
.dp-geo-row--none { opacity:.45; }
.dp-geo-flag { font-size:14px; flex-shrink:0; }
.dp-geo-info { display:flex; flex-direction:column; min-width:0; }
.dp-geo-loc  { font-weight:600; font-size:12px; }
.dp-geo-city { font-size:10px; color:var(--o2-tab-text-color); }
.dp-geo-ms   { font-size:12px; font-weight:600; margin-left:6px; }

/* monitor config table */
.dp-cfg-table { display:flex; flex-direction:column; border:1px solid var(--o2-border-color); border-radius:8px; overflow:hidden; }
.dp-cfg-row { display:flex; gap:10px; padding:6px 12px; border-bottom:1px solid var(--o2-border-color); font-size:12px; }
.dp-cfg-row:last-child { border-bottom:none; }
.dp-cfg-key { min-width:130px; flex-shrink:0; color:var(--o2-tab-text-color); font-size:11px; }
.dp-cfg-val { font-weight:500; word-break:break-all; }

/* incident list */
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

/* two-pane traces layout */
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
</style>
