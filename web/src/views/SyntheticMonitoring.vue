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
      <button class="syn-new-btn" @click="openCreate"><OIcon name="add" size="sm" />New Monitor</button>
    </div>

    <!-- FILTER BAR -->
    <div class="syn-filter-bar">
      <!-- View switcher -->
      <div class="syn-view-tabs">
        <button v-for="tab in tabs" :key="tab.key"
          class="syn-view-tab" :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key; currentPage = 1">
          {{ tab.label }}
        </button>
      </div>

      <div class="syn-filter-sep" />

      <!-- Status filter — only on All Monitors tab -->
      <template v-if="activeTab === 'monitors'">
        <button v-for="s in statusTabs" :key="s.filter"
          class="syn-pill" :class="{ 'syn-pill--active': statusFilter === s.filter }"
          @click="statusFilter = s.filter; currentPage = 1">
          <span v-if="s.filter !== 'all'" class="syn-pill-dot" :class="'sdot-' + s.filter.toLowerCase()" />
          {{ s.label }} <span class="syn-pill-count">{{ s.count }}</span>
        </button>
        <div class="syn-filter-sep" />
      </template>

      <!-- Search -->
      <template v-if="activeTab !== 'private'">
        <div class="syn-search-box">
          <OIcon name="search" size="sm" class="syn-search-icon" />
          <input v-if="activeTab === 'geo'" v-model="geoSearch" class="syn-search-input" placeholder="Filter monitors…" @input="geoPage=1" />
          <input v-else v-model="search" class="syn-search-input"
            :placeholder="activeTab === 'browser' ? 'Search browser tests...' : activeTab === 'api' ? 'Search API tests...' : 'Search monitors...'"
            @input="currentPage = 1" />
        </div>
      </template>

      <!-- Type + Location dropdowns -->
      <template v-if="activeTab === 'monitors'">
        <select v-model="typeFilter" class="syn-select" @change="currentPage = 1">
          <option v-for="o in typeOpts" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <select v-model="locationFilter" class="syn-select" @change="currentPage = 1">
          <option v-for="o in locationOpts" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </template>

      <div style="flex:1" />

      <template v-if="activeTab === 'private'">
        <button class="syn-new-btn" @click=""><OIcon name="add" size="sm" />Add Location</button>
      </template>

      <!-- Geo tab action buttons -->
      <template v-if="activeTab === 'geo'">
        <button class="geo-hdr-btn" :class="{ 'geo-hdr-btn--alert': geoIssues.length }" @click="showIssuesModal = true">
          <OIcon :name="geoIssues.length ? 'error' : 'check-circle'" size="xs"/>
          Active Issues
          <span v-if="geoIssues.length" class="geo-hdr-badge">{{ geoIssues.length }}</span>
        </button>
        <button class="geo-hdr-btn" @click="showHeatmapModal = true">
          <OIcon name="language" size="xs"/>
          Geo Map
        </button>
      </template>
    </div>

    <!-- ── ALL MONITORS ── -->
    <template v-if="activeTab === 'monitors'">
      <div class="syn-table-scroll">
        <table class="syn-table">
          <colgroup>
            <col v-for="col in columns" :key="col.key" :style="{ width: col.width + 'px' }" />
          </colgroup>
          <thead>
            <tr>
              <th v-for="col in columns" :key="col.key" class="syn-th" :class="col.align === 'right' ? 'right' : ''">
                <div class="th-inner">
                  <span>{{ col.label }}</span>
                  <div v-if="col.resizable" class="col-resize-handle" @mousedown="startResize($event, col)" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in pagedMonitors" :key="m.id" class="syn-row">
              <td class="syn-td td-center"><span class="dot" :class="'dot--' + m.status.toLowerCase()" /></td>
              <td class="syn-td">
                <div class="mon-name">{{ m.name }}</div>
                <div class="mon-url">{{ m.url }}</div>
              </td>
              <td class="syn-td"><span class="badge" :class="'badge--' + m.type.toLowerCase()">{{ m.type }}</span></td>
              <td class="syn-td">
                <div class="spark">
                  <span v-for="(tick,i) in m.history" :key="i"
                    class="spark-bar" :class="'spark--'+tick.status"
                    @mouseenter="showSparkTip($event, tick)"
                    @mouseleave="hideSparkTip"
                  />
                </div>
              </td>
              <td class="syn-td td-right"><span class="mono" :class="rtCls(m.responseTime)">{{ m.responseTime ?? '—' }}</span></td>
              <td class="syn-td td-right">
                <div class="uptime-row">
                  <div class="uptime-track"><div class="uptime-fill" :class="m.uptime>=99?'fill-g':m.uptime>=95?'fill-a':'fill-r'" :style="{ width: m.uptime+'%' }" /></div>
                  <span class="mono" :class="m.uptime>=99?'c-g':m.uptime>=95?'c-a':'c-r'" style="min-width:44px;text-align:right;font-size:12px">{{ m.uptime }}%</span>
                </div>
              </td>
              <td class="syn-td">
                <div class="locs-cell" @mouseenter="showLoc($event, m.locations)" @mouseleave="hideLoc">
                  <span class="loc-first">{{ m.locations[0] }}</span>
                  <span v-if="m.locations.length > 1" class="loc-badge">+{{ m.locations.length - 1 }}</span>
                </div>
              </td>
              <td class="syn-td td-muted">{{ m.interval }}</td>
              <td class="syn-td td-muted">{{ m.lastCheck }}</td>
              <td class="syn-td td-center" @click.stop>
                <div class="row-actions">
                  <button class="act-btn" title="Run now" @click.stop><OIcon name="play-arrow" size="sm" /></button>
                  <button class="act-btn" title="Edit" @click.stop="openEdit(m)"><OIcon name="edit" size="sm" /></button>
                  <button class="act-btn" title="Pause" @click.stop><OIcon name="pause" size="sm" /></button>
                  <button class="act-btn act-btn--del" title="Delete" @click.stop><OIcon name="delete" size="sm" /></button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="filteredMonitors.length === 0" class="syn-empty">
          <OIcon name="radar" size="xl" class="syn-empty-icon" />
          <div style="font-size:15px;font-weight:600">No monitors found</div>
          <div style="font-size:13px;color:var(--o2-tab-text-color)">Adjust filters or create your first monitor.</div>
          <button class="syn-new-btn" @click="openCreate"><OIcon name="add" size="sm" />Create monitor</button>
        </div>
      </div>

      <!-- PAGINATION FOOTER — matches Incidents page -->
      <div class="syn-footer">
        <div class="syn-footer-total">{{ filteredMonitors.length }} Monitors</div>
        <div style="flex:1" />
        <div class="syn-footer-right">
          <span class="syn-footer-info">Showing {{ pageStart + 1 }} - {{ pageEnd }} of {{ filteredMonitors.length }}</span>
          <span class="syn-footer-sep" />
          <span style="font-size:12px;color:var(--o2-tab-text-color);white-space:nowrap">Records per page</span>
          <select v-model="perPage" class="syn-select" style="width:64px" @change="currentPage=1">
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="25">25</option>
            <option :value="50">50</option>
          </select>
          <button class="pg-btn" :disabled="currentPage === 1" @click="currentPage=1"><OIcon name="first-page" size="sm" /></button>
          <button class="pg-btn" :disabled="currentPage === 1" @click="currentPage--"><OIcon name="chevron-left" size="sm" /></button>
          <button class="pg-btn" :disabled="currentPage === totalPages" @click="currentPage++"><OIcon name="chevron-right" size="sm" /></button>
          <button class="pg-btn" :disabled="currentPage === totalPages" @click="currentPage=totalPages"><OIcon name="last-page" size="sm" /></button>
        </div>
      </div>
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
                  <button class="act-btn" title="Run" @click.stop><OIcon name="play-arrow" size="sm" /></button>
                  <button class="act-btn" title="Edit" @click.stop="openEdit(m)"><OIcon name="edit" size="sm" /></button>
                  <button class="act-btn act-btn--del" title="Delete" @click.stop><OIcon name="delete" size="sm" /></button>
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
                  <button class="act-btn" title="Run" @click.stop><OIcon name="play-arrow" size="sm" /></button>
                  <button class="act-btn" title="Edit" @click.stop="openEdit(m)"><OIcon name="edit" size="sm" /></button>
                  <button class="act-btn act-btn--del" title="Delete" @click.stop><OIcon name="delete" size="sm" /></button>
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
          <div v-for="loc in privateLocations" :key="loc.id" class="pl-card">
            <div class="pl-card-header">
              <div style="display:flex;align-items:center;gap:8px">
                <span class="dot" :class="loc.status==='Online'?'dot--up':'dot--down'" style="width:8px;height:8px;box-shadow:none" />
                <span class="pl-card-title">{{ loc.name }}</span>
              </div>
              <div style="display:flex;align-items:center;gap:2px">
                <button class="act-btn" title="Edit"><OIcon name="edit" size="sm" /></button>
                <button class="act-btn act-btn--del" title="Remove"><OIcon name="delete" size="sm" /></button>
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
          </div>

          <div class="pl-card pl-card--add">
            <OIcon name="add-circle" size="lg" class="pl-icon-muted" />
            <div style="font-size:13px;font-weight:600;margin-top:10px">Add private location</div>
            <div style="font-size:11px;color:var(--o2-tab-text-color);margin-top:4px;text-align:center;line-height:1.5">Run checks from your servers, VPC, or on-premise network</div>
            <button class="syn-new-btn" style="margin-top:12px;font-size:11px;padding:4px 10px">Get started</button>
          </div>
        </div>

        <div class="pl-guide">
          <div class="pl-guide-header"><OIcon name="code" size="sm" class="pl-icon-primary" />Setting up a private location agent</div>
          <div class="pl-guide-steps">
            <div class="pl-guide-step">
              <div class="pl-step-num">1</div>
              <div class="pl-step-body">
                <div class="pl-step-title">Deploy the agent</div>
                <div class="pl-step-desc">Run the container on any machine in your network — Docker, Kubernetes, or native binary.</div>
                <div class="pl-code-block">
                  <div class="pl-code-label">Docker</div>
                  <pre class="pl-code">docker run -d \
  -e O2_PRIVATE_LOC_KEY=&lt;your_key&gt; \
  -e O2_ENDPOINT=https://your-openobserve-host \
  openobserve/syn-agent:latest</pre>
                  <button class="pl-copy-btn" title="Copy"><OIcon name="content-copy" size="xs" /></button>
                </div>
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

    <!-- ── GEO CHECKS ── -->
    <template v-else-if="activeTab === 'geo'">

      <!-- Matrix table -->
      <div class="syn-table-scroll">
        <table class="syn-table geo-matrix">
          <thead>
            <tr>
              <th class="syn-th geo-th--monitor">Monitor</th>
              <th v-for="loc in geoAllLocations" :key="loc.key"
                class="syn-th geo-th" :class="{ 'geo-th--compare': compareLocs.includes(loc.key) }"
                @click="toggleCompareLoc($event, loc.key)" style="cursor:pointer;user-select:none">
                <span class="geo-th-flag">{{ loc.flag }}</span> {{ loc.label }}
                <span v-if="compareLocs.includes(loc.key)" class="geo-th-badge">{{ compareLocs.indexOf(loc.key) + 1 }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in geoRows" :key="row.monitor.id"
              class="geo-row" :class="{ 'geo-row--active': selectedGeoRow?.monitor.id === row.monitor.id }"
              @click="toggleGeoRow(row)" style="cursor:pointer">
              <td class="syn-td geo-td--monitor">
                <div class="geo-mon-name">{{ row.monitor.name }}</div>
                <div class="geo-mon-url">{{ row.monitor.url }}</div>
                <span class="badge" :class="'badge--'+row.monitor.type.toLowerCase()" style="margin-top:3px">{{ row.monitor.type }}</span>
              </td>
              <td v-for="(c, ci) in row.cells" :key="ci"
                class="syn-td geo-cell" :class="'geo-cell--'+c.status" style="text-align:center">
                <template v-if="c.status !== 'none'">
                  <span class="geo-cell-dot" :class="'geo-cdot--'+c.status" />
                  <span class="geo-cell-ms">{{ c.ms !== null ? c.ms + 'ms' : 'Timeout' }}</span>
                </template>
                <span v-else class="geo-cell-dash">—</span>
              </td>
            </tr>
            <tr v-if="geoRows.length === 0">
              <td :colspan="geoAllLocations.length + 1" class="syn-td" style="text-align:center;padding:48px;color:var(--o2-tab-text-color);font-size:13px">No monitors match your search</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination footer -->
      <div class="syn-footer">
        <div class="syn-footer-total">{{ geoAllRows.length }} Monitors</div>
        <div style="flex:1" />
        <div class="syn-footer-right">
          <span class="syn-footer-info">Showing {{ geoPageStart + 1 }} - {{ geoPageEnd }} of {{ geoAllRows.length }}</span>
          <span class="syn-footer-sep" />
          <span style="font-size:12px;color:var(--o2-tab-text-color);white-space:nowrap">Records per page</span>
          <select v-model="geoPerPage" class="syn-select" style="width:64px" @change="geoPage=1">
            <option :value="10">10</option><option :value="20">20</option>
            <option :value="25">25</option><option :value="50">50</option>
          </select>
          <button class="pg-btn" :disabled="geoPage === 1" @click="geoPage=1"><OIcon name="first-page" size="sm" /></button>
          <button class="pg-btn" :disabled="geoPage === 1" @click="geoPage--"><OIcon name="chevron-left" size="sm" /></button>
          <button class="pg-btn" :disabled="geoPage === geoTotalPages" @click="geoPage++"><OIcon name="chevron-right" size="sm" /></button>
          <button class="pg-btn" :disabled="geoPage === geoTotalPages" @click="geoPage=geoTotalPages"><OIcon name="last-page" size="sm" /></button>
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

    <!-- Full Heatmap Modal -->
    <Teleport to="body">
      <transition name="gm">
        <div v-if="showHeatmapModal" class="geo-modal-overlay" @click.self="showHeatmapModal = false">
          <div class="geo-modal">
            <div class="geo-modal-hdr">
              <span class="geo-modal-title">Global Health Heatmap</span>
              <div class="geo-modal-legend">
                <span class="geo-leg-item"><span class="geo-leg-dot" style="background:#22c55e"/><span>Healthy</span></span>
                <span class="geo-leg-item"><span class="geo-leg-dot" style="background:#f59e0b"/><span>Degraded</span></span>
                <span class="geo-leg-item"><span class="geo-leg-dot" style="background:#ef4444"/><span>Down</span></span>
              </div>
              <button class="geo-modal-close" @click="showHeatmapModal = false"><OIcon name="close" size="sm"/></button>
            </div>
            <div class="geo-modal-body">
              <svg class="geo-modal-svg" viewBox="0 0 960 500" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <radialGradient v-for="stat in geoLocStats" :key="'mg-'+stat.key"
                    :id="'m'+geoGradId(stat.key)" cx="50%" cy="50%" r="50%">
                    <stop offset="0%"   :stop-color="stat.health==='up'?'#22c55e':stat.health==='down'?'#ef4444':'#f59e0b'" stop-opacity="0.65"/>
                    <stop offset="60%"  :stop-color="stat.health==='up'?'#22c55e':stat.health==='down'?'#ef4444':'#f59e0b'" stop-opacity="0.18"/>
                    <stop offset="100%" :stop-color="stat.health==='up'?'#22c55e':stat.health==='down'?'#ef4444':'#f59e0b'" stop-opacity="0"/>
                  </radialGradient>
                </defs>
                <!-- Ocean -->
                <rect width="960" height="500" class="geo-ocean"/>
                <!-- Latitude / longitude grid -->
                <g class="geo-graticule">
                  <line x1="0" y1="83" x2="960" y2="83"/>
                  <line x1="0" y1="167" x2="960" y2="167"/>
                  <line x1="0" y1="250" x2="960" y2="250"/>
                  <line x1="0" y1="333" x2="960" y2="333"/>
                  <line x1="0" y1="417" x2="960" y2="417"/>
                  <line x1="160" y1="0" x2="160" y2="500"/>
                  <line x1="320" y1="0" x2="320" y2="500"/>
                  <line x1="480" y1="0" x2="480" y2="500"/>
                  <line x1="640" y1="0" x2="640" y2="500"/>
                  <line x1="800" y1="0" x2="800" y2="500"/>
                </g>
                <!-- Continents — equirectangular: x=(lon+180)/360*960, y=(90-lat)/180*500 -->
                <g class="geo-land">
                  <!-- North America: clockwise from Bering Strait → Arctic → Atlantic → Gulf → Panama → Pacific → Alaska -->
                  <path d="M 32,67 L 64,53 L 107,56 L 187,47 L 240,61 L 307,69 L 333,106 L 339,119 L 315,128 L 293,133 L 283,136 L 280,153 L 264,167 L 267,178 L 261,172 L 243,169 L 221,172 L 224,197 L 248,192 L 245,203 L 253,211 L 259,217 L 267,228 L 269,228 L 253,222 L 237,211 L 227,206 L 216,203 L 203,197 L 187,186 L 168,161 L 155,147 L 149,128 L 147,114 L 117,92 L 85,86 L 72,92 L 53,97 L 40,83 Z"/>
                  <!-- Greenland -->
                  <path d="M 347,83 L 363,86 L 427,69 L 432,39 L 376,19 L 312,33 L 341,67 Z"/>
                  <!-- South America: clockwise from Venezuela → NE Brazil bulge → Cape Horn → Pacific coast → back -->
                  <path d="M 315,219 L 387,264 L 387,272 L 379,286 L 365,314 L 325,344 L 304,378 L 301,403 L 280,383 L 288,350 L 275,283 L 267,256 L 275,239 L 285,219 Z"/>
                  <!-- Iceland -->
                  <path d="M 416,72 L 419,67 L 432,67 L 445,69 L 443,75 L 427,75 Z"/>
                  <!-- UK (Great Britain) -->
                  <path d="M 467,111 L 469,106 L 472,103 L 467,89 L 475,92 L 480,103 L 483,108 Z"/>
                  <!-- Ireland -->
                  <path d="M 453,108 L 453,97 L 464,97 L 464,108 Z"/>
                  <!-- Europe: Portugal → Gibraltar → Mediterranean coast → Greece → Black Sea → Baltics → Norway → North Sea → back -->
                  <path d="M 456,144 L 467,150 L 480,143 L 493,131 L 508,125 L 528,136 L 539,150 L 552,139 L 557,136 L 560,122 L 568,122 L 560,83 L 528,53 L 501,92 L 491,103 L 469,117 L 456,131 Z"/>
                  <!-- Africa: Morocco → N coast → Horn → E coast → Cape → W coast → Gulf of Guinea → back -->
                  <path d="M 464,150 L 507,147 L 547,161 L 571,167 L 595,217 L 616,219 L 589,253 L 584,269 L 573,297 L 555,342 L 528,347 L 512,331 L 512,264 L 504,253 L 488,239 L 480,236 L 467,236 L 443,228 L 437,219 L 432,208 L 443,192 Z"/>
                  <!-- Arabian Peninsula -->
                  <path d="M 573,169 L 600,214 L 616,217 L 637,189 L 629,178 L 608,167 Z"/>
                  <!-- Asia + SE Asia peninsula: Istanbul → Siberia → Chukotka → Japan coast → Vietnam → Malay tip → Burma → India border → Iran → Turkey -->
                  <path d="M 557,136 L 589,133 L 613,139 L 627,111 L 653,83 L 667,47 L 747,47 L 853,50 L 931,72 L 915,86 L 909,106 L 832,131 L 821,153 L 805,161 L 784,189 L 771,219 L 757,244 L 747,225 L 739,203 L 723,189 L 661,186 L 645,181 L 632,183 L 608,167 L 576,147 Z"/>
                  <!-- India subcontinent -->
                  <path d="M 661,186 L 715,189 L 709,194 L 693,228 L 672,228 L 672,197 Z"/>
                  <!-- Borneo -->
                  <path d="M 787,236 L 797,231 L 797,256 L 787,261 L 768,261 Z"/>
                  <!-- Japan (Kyushu → Honshu → Hokkaido arc) -->
                  <path d="M 827,158 L 827,164 L 835,158 L 853,150 L 856,136 L 867,128 L 859,144 Z"/>
                  <!-- Australia: NW coast → Darwin → Gulf of Carpentaria → Queensland → Sydney → Melbourne → Bight → Perth → back -->
                  <path d="M 784,311 L 787,289 L 829,283 L 843,283 L 840,292 L 851,292 L 861,300 L 877,306 L 888,325 L 883,344 L 867,356 L 829,342 L 787,339 L 781,322 Z"/>
                  <!-- New Zealand North Island -->
                  <path d="M 944,350 L 955,356 L 949,364 L 944,364 Z"/>
                  <!-- New Zealand South Island -->
                  <path d="M 939,364 L 944,369 L 936,372 L 928,378 L 925,375 L 933,369 Z"/>
                </g>
                <!-- Heatmap radial blobs -->
                <g class="geo-heatmap">
                  <circle v-for="stat in geoLocStats" :key="'mh-'+stat.key"
                    :cx="geoMapPos[stat.key].x" :cy="geoMapPos[stat.key].y" r="195"
                    :fill="'url(#m' + geoGradId(stat.key) + ')'"/>
                </g>
                <!-- Location markers -->
                <g v-for="stat in geoLocStats" :key="'md-'+stat.key">
                  <circle :cx="geoMapPos[stat.key].x" :cy="geoMapPos[stat.key].y" r="20"
                    :style="{ fill: stat.health==='up'?'rgba(34,197,94,0.2)':stat.health==='down'?'rgba(239,68,68,0.2)':'rgba(245,158,11,0.2)' }"
                    :class="stat.health!=='up'?'geo-dot-pulse':''" class="geo-dot-ring"/>
                  <circle :cx="geoMapPos[stat.key].x" :cy="geoMapPos[stat.key].y" r="9"
                    :style="{ fill: stat.health==='up'?'#22c55e':stat.health==='down'?'#ef4444':'#f59e0b' }"
                    stroke="white" stroke-width="2.5"/>
                  <text :x="geoMapPos[stat.key].x" :y="geoMapPos[stat.key].y + 26" class="geo-dot-label geo-dot-label--lg" text-anchor="middle">{{ stat.flag }} {{ stat.label }}</text>
                  <text :x="geoMapPos[stat.key].x" :y="geoMapPos[stat.key].y + 40" class="geo-dot-sublabel" text-anchor="middle">{{ stat.uptime }}% uptime</text>
                </g>
              </svg>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- Active Issues Modal -->
    <Teleport to="body">
      <transition name="gm">
        <div v-if="showIssuesModal" class="geo-modal-overlay" @click.self="showIssuesModal = false">
          <div class="issues-modal">
            <div class="geo-modal-hdr">
              <OIcon :name="geoIssues.length ? 'error' : 'check-circle'" size="sm" :class="geoIssues.length ? 'c-r' : 'c-g'"/>
              <span class="geo-modal-title">Active Issues</span>
              <button class="geo-modal-close" @click="showIssuesModal = false"><OIcon name="close" size="sm"/></button>
            </div>
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
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- BACKDROP -->
    <transition name="bf">
      <div v-if="showDrawer" class="syn-backdrop" @click="showDrawer = false" />
    </transition>

    <!-- SLIDE-OVER DRAWER -->
    <div class="syn-drawer" :class="{ 'syn-drawer--open': showDrawer }">
      <div class="drw-header">
        <div>
          <div class="drw-title">{{ editTarget ? 'Edit Monitor' : 'New Monitor' }}</div>
          <div class="drw-sub">{{ editTarget ? editTarget.url : 'Configure a new synthetic check' }}</div>
        </div>
        <button class="drw-close-btn" @click="showDrawer = false"><OIcon name="close" size="sm" /></button>
      </div>
      <div class="drw-steps">
        <div v-for="(step, i) in steps" :key="step.key"
          class="drw-step" :class="{ 'drw-step--active': currentStep === step.key, 'drw-step--done': stepIdx > i }"
          @click="currentStep = step.key">
          <span class="step-num">
            <OIcon v-if="stepIdx > i" name="check" size="xs" /><template v-else>{{ i + 1 }}</template>
          </span>
          {{ step.label }}
        </div>
      </div>
      <div class="drw-body">
        <template v-if="currentStep === 'type'">
          <div class="drw-slabel">Choose monitor type</div>
          <div class="type-grid">
            <div v-for="t in monitorTypes" :key="t.value" class="type-card" :class="{ 'type-card--on': form.type === t.value }" @click="form.type = t.value">
              <div class="type-top"><OIcon :name="t.icon" size="md" :class="form.type===t.value?'type-icon--on':'type-icon--off'" /><OIcon v-if="form.type===t.value" name="check-circle" size="xs" class="type-check" /></div>
              <div class="type-name">{{ t.label }}</div>
              <div class="type-desc">{{ t.desc }}</div>
            </div>
          </div>
        </template>
        <template v-if="currentStep === 'configure'">
          <div class="drw-slabel">Basic configuration</div>
          <div class="fstack">
            <q-input v-model="form.name" label="Monitor name *" outlined dense />
            <div style="display:flex;gap:8px">
              <q-select v-if="['HTTP','API'].includes(form.type)" v-model="form.method" :options="['GET','POST','PUT','PATCH','DELETE','HEAD']" outlined dense label="Method" style="width:110px;flex-shrink:0" />
              <q-input v-model="form.url" label="URL *" outlined dense style="flex:1" placeholder="https://example.com/api/health" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <q-select v-model="form.interval" :options="intervalOpts" label="Check interval" outlined dense emit-value map-options />
              <q-input v-model.number="form.timeout" label="Timeout (ms)" type="number" outlined dense />
            </div>
            <q-expansion-item dense label="Request Headers" style="border:1px solid var(--o2-border-color);border-radius:8px">
              <div style="padding:10px;display:flex;flex-direction:column;gap:8px">
                <div v-for="(h, i) in form.headers" :key="i" style="display:flex;gap:8px;align-items:center">
                  <q-input v-model="h.key" dense outlined placeholder="Name" style="flex:1" />
                  <q-input v-model="h.value" dense outlined placeholder="Value" style="flex:1" />
                  <button class="drw-rm-btn" @click="form.headers.splice(i,1)"><OIcon name="close" size="xs" /></button>
                </div>
                <button class="drw-add-btn" @click="form.headers.push({key:'',value:''})"><OIcon name="add" size="xs" />Add header</button>
              </div>
            </q-expansion-item>
          </div>
        </template>
        <template v-if="currentStep === 'locations'">
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
        </template>
        <template v-if="currentStep === 'alerts'">
          <div class="drw-slabel">Assertions</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
            <div v-for="(a, i) in form.assertions" :key="i" style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--o2-border-color);border-radius:8px">
              <q-select v-model="a.type" :options="assertionTypes" dense outlined emit-value map-options style="flex:1" />
              <q-select v-model="a.operator" :options="['=','!=','<','>','contains','matches']" dense outlined style="width:100px" />
              <q-input v-model="a.value" dense outlined style="flex:1" placeholder="200" />
              <button class="drw-rm-btn" @click="form.assertions.splice(i,1)"><OIcon name="close" size="xs" /></button>
            </div>
            <button class="drw-add-btn" @click="form.assertions.push({type:'statusCode',operator:'=',value:'200'})"><OIcon name="add" size="xs" />Add assertion</button>
          </div>
          <div class="drw-slabel" style="margin-top:20px">Alert conditions</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;align-items:center;gap:8px;font-size:13px;flex-wrap:wrap">
              <span>Alert when failing from</span>
              <q-input v-model.number="form.alertThreshold" type="number" dense outlined style="width:60px" />
              <span>or more location(s)</span>
            </div>
            <q-toggle v-model="form.notifyOnRecovery" dense label="Notify on recovery" size="sm" />
            <q-toggle v-model="form.renotify" dense label="Re-notify every 30 min while failing" size="sm" />
          </div>
        </template>
      </div>
      <div class="drw-footer">
        <button class="drw-btn drw-btn--ghost" :disabled="stepIdx === 0" @click="prevStep">Back</button>
        <div style="display:flex;gap:8px">
          <button class="drw-btn drw-btn--ghost" @click="showDrawer = false">Cancel</button>
          <button v-if="stepIdx < steps.length - 1" class="drw-btn drw-btn--primary" @click="nextStep">Continue →</button>
          <button v-else class="drw-btn drw-btn--primary" @click="saveMonitor">{{ editTarget ? 'Save changes' : 'Create monitor' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const activeTab      = ref("monitors");
const statusFilter   = ref("all");
const typeFilter     = ref("all");
const locationFilter = ref("all");
const search         = ref("");
const showDrawer     = ref(false);
const editTarget     = ref<any>(null);
const currentStep    = ref("type");
const currentPage    = ref(1);
const perPage        = ref(20);

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
interface Col { key: string; label: string; width: number; resizable: boolean; align?: string }
const columns = ref<Col[]>([
  { key:"status",   label:"",                  width:36,  resizable:false },
  { key:"name",     label:"Monitor",           width:200, resizable:true },
  { key:"type",     label:"Type",              width:88,  resizable:true },
  { key:"history",  label:"Status · Last 24h", width:180, resizable:true },
  { key:"response", label:"Response",          width:90,  resizable:true, align:"right" },
  { key:"uptime",   label:"Uptime 7d",         width:130, resizable:true, align:"right" },
  { key:"locs",     label:"Locations",         width:120, resizable:true },
  { key:"interval", label:"Interval",          width:72,  resizable:true },
  { key:"lastCheck",label:"Last check",        width:90,  resizable:true },
  { key:"actions",  label:"",                  width:120, resizable:false },
]);

let resizeState: { col: Col; startX: number; startW: number } | null = null;
const startResize = (e: MouseEvent, col: Col) => {
  e.preventDefault();
  resizeState = { col, startX: e.clientX, startW: col.width };
  document.addEventListener("mousemove", onResize);
  document.addEventListener("mouseup", stopResize);
};
const onResize = (e: MouseEvent) => { if (!resizeState) return; resizeState.col.width = Math.max(60, resizeState.startW + (e.clientX - resizeState.startX)); };
const stopResize = () => { resizeState = null; document.removeEventListener("mousemove", onResize); document.removeEventListener("mouseup", stopResize); };
onUnmounted(() => {
  stopResize();
  if (locHideTimer) clearTimeout(locHideTimer);
  if (sparkHideTimer) clearTimeout(sparkHideTimer);
  if (mapTipTimer) clearTimeout(mapTipTimer);
});

// ── Geo Checks ────────────────────────────────────────────────────────
const geoSearch   = ref("");
const geoPage     = ref(1);
const geoPerPage  = ref(20);
const geoAllLocations = [
  { key:"US East",    label:"US East",    flag:"🇺🇸", city:"Virginia, USA"      },
  { key:"US West",    label:"US West",    flag:"🇺🇸", city:"Oregon, USA"        },
  { key:"EU West",    label:"EU West",    flag:"🇮🇪", city:"Dublin, Ireland"    },
  { key:"EU Central", label:"EU Central", flag:"🇩🇪", city:"Frankfurt, Germany" },
  { key:"AP SE",      label:"AP SE",      flag:"🇸🇬", city:"Singapore"          },
  { key:"AP NE",      label:"AP NE",      flag:"🇯🇵", city:"Tokyo, Japan"       },
];
const geoAllRows = computed(() => {
  const q = geoSearch.value.trim().toLowerCase();
  return monitors.value
    .filter(m => !q || m.name.toLowerCase().includes(q) || m.url.toLowerCase().includes(q))
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
const geoTotalPages = computed(() => Math.max(1, Math.ceil(geoAllRows.value.length / geoPerPage.value)));
const geoPageStart  = computed(() => (geoPage.value - 1) * geoPerPage.value);
const geoPageEnd    = computed(() => Math.min(geoPageStart.value + geoPerPage.value, geoAllRows.value.length));
const geoRows       = computed(() => geoAllRows.value.slice(geoPageStart.value, geoPageEnd.value));
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
const geoMapPos: Record<string, { x: number; y: number }> = {
  "US East":    { x: 278, y: 140 },
  "US West":    { x: 155, y: 120 },
  "EU West":    { x: 462, y: 90  },
  "EU Central": { x: 505, y: 98  },
  "AP SE":      { x: 758, y: 230 },
  "AP NE":      { x: 856, y: 138 },
};
const geoGradId = (key: string) => "hm-" + key.toLowerCase().replace(/\s+/g, "-");
const showHeatmapModal = ref(false);
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
const showMapTip = (e: MouseEvent, stat: any) => {
  if (mapTipTimer) { clearTimeout(mapTipTimer); mapTipTimer = null; }
  mapTip.value = { show: true, x: e.clientX + 14, y: e.clientY - 10, stat };
};
const hideMapTip = () => { mapTipTimer = setTimeout(() => { mapTip.value.show = false; }, 100); };

const selectedGeoRow = ref<{ monitor: any; cells: any[] } | null>(null);
const toggleGeoRow = (row: { monitor: any; cells: any[] }) => {
  selectedGeoRow.value = selectedGeoRow.value?.monitor.id === row.monitor.id ? null : row;
  compareLocs.value = [];
};
const geoBarMax = computed(() => {
  if (!selectedGeoRow.value) return 500;
  const vals = selectedGeoRow.value.cells.filter((c: any) => c.ms !== null).map((c: any) => c.ms as number);
  return vals.length ? Math.max(...vals, 100) : 500;
});

const dismissedAnomalies = ref<string[]>([]);
const geoAnomalies = computed(() => {
  const list: { key: string; level: "error" | "warn"; msg: string }[] = [];
  geoLocStats.value.forEach(s => {
    if (s.health === "down")
      list.push({ key: `${s.key}-down`, level: "error", msg: `${s.flag} ${s.label} — ${s.downCt} monitor${s.downCt > 1 ? "s" : ""} down` });
    else if (s.health === "deg")
      list.push({ key: `${s.key}-deg`, level: "warn", msg: `${s.flag} ${s.label} — ${s.degCt} monitor${s.degCt > 1 ? "s" : ""} degraded, avg response elevated` });
  });
  const multiDown = geoLocStats.value.filter(s => s.health === "down").length;
  if (multiDown >= 2) list.push({ key: "multi-region", level: "error", msg: `${multiDown} regions simultaneously affected — possible CDN or upstream incident` });
  return list.filter(a => !dismissedAnomalies.value.includes(a.key));
});

const compareLocs = ref<string[]>([]);
const toggleCompareLoc = (e: MouseEvent, key: string) => {
  e.stopPropagation();
  const idx = compareLocs.value.indexOf(key);
  if (idx >= 0) compareLocs.value.splice(idx, 1);
  else if (compareLocs.value.length < 2) compareLocs.value.push(key);
  else compareLocs.value = [compareLocs.value[1], key];
  selectedGeoRow.value = null;
};
const clearCompare = () => { compareLocs.value = []; };
const compareResult = computed(() => {
  if (compareLocs.value.length < 2) return null;
  const [kA, kB] = compareLocs.value;
  const liA = geoAllLocations.findIndex(l => l.key === kA);
  const liB = geoAllLocations.findIndex(l => l.key === kB);
  const sA = geoLocStats.value.find(s => s.key === kA)!;
  const sB = geoLocStats.value.find(s => s.key === kB)!;
  return {
    sA, sB,
    rows: geoAllRows.value
      .filter(r => r.cells[liA].status !== "none" || r.cells[liB].status !== "none")
      .map(r => ({ name: r.monitor.name, a: r.cells[liA], b: r.cells[liB] })),
  };
});

const tabs = [
  { key:"monitors", label:"All Monitors",     count:30   },
  { key:"browser",  label:"Browser Tests",    count:5    },
  { key:"api",      label:"API Tests",        count:6    },
  { key:"geo",      label:"Geo Checks",       count:null },
  { key:"private",  label:"Private Locations",count:null },
];
const steps = [
  { key:"type",      label:"Type" },
  { key:"configure", label:"Configure" },
  { key:"locations", label:"Locations" },
  { key:"alerts",    label:"Assertions & Alerts" },
];
const stepIdx  = computed(() => steps.findIndex(s => s.key === currentStep.value));
const nextStep = () => { if (stepIdx.value < steps.length-1) currentStep.value = steps[stepIdx.value+1].key; };
const prevStep = () => { if (stepIdx.value > 0) currentStep.value = steps[stepIdx.value-1].key; };

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

const totalPages  = computed(() => Math.max(1, Math.ceil(filteredMonitors.value.length / perPage.value)));
const pageStart   = computed(() => (currentPage.value - 1) * perPage.value);
const pageEnd     = computed(() => Math.min(currentPage.value * perPage.value, filteredMonitors.value.length));
const pagedMonitors = computed(() => filteredMonitors.value.slice(pageStart.value, pageEnd.value));

const pageButtons = computed(() => {
  const total = totalPages.value;
  const cur   = currentPage.value;
  if (total <= 7) return Array.from({length: total}, (_,i) => i+1);
  const pages: (number|string)[] = [1];
  if (cur > 3) pages.push("…");
  for (let i = Math.max(2, cur-1); i <= Math.min(total-1, cur+1); i++) pages.push(i);
  if (cur < total - 2) pages.push("…");
  pages.push(total);
  return pages;
});

const rtCls = (rt: string|null) => { if (!rt) return "c-r"; const v=parseFloat(rt); return v<300?"c-g":v<1000?"c-a":"c-r"; };
const toggleLoc  = (v: string) => { const i=form.value.locations.indexOf(v); if(i===-1)form.value.locations.push(v); else form.value.locations.splice(i,1); };
const openCreate  = () => { editTarget.value=null; form.value=defaultForm(); currentStep.value="type"; showDrawer.value=true; };
const openEdit    = (m: any) => { editTarget.value=m; form.value={...defaultForm(),name:m.name,url:m.url,type:m.type,interval:m.interval}; currentStep.value="configure"; showDrawer.value=true; };
const saveMonitor = () => { showDrawer.value=false; };
</script>

<style scoped>
/* ── ROOT — no hardcoded fallback colors; inherit dark/light from Quasar ── */
.syn-root { display:flex; flex-direction:column; height:100%; overflow:hidden; position:relative; }

/* ── PAGE HEADER ── */
.syn-page-header     { display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; background:var(--o2-card-background); }
.syn-page-title-wrap { display:flex; align-items:center; gap:12px; }
.syn-page-icon       { width:36px; height:36px; border-radius:9px; background:rgba(0,0,0,.07); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.body--dark .syn-page-icon { background:rgba(255,255,255,.1); }
.syn-title           { font-size:14px; font-weight:700; line-height:1.2; }
.syn-sub             { font-size:12px; color:var(--o2-tab-text-color); margin-top:1px; }

/* ── FILTER BAR ── */
.syn-filter-bar  { display:flex; align-items:center; gap:5px; padding:6px 14px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; background:var(--o2-card-background); }
.syn-filter-sep  { width:1px; height:18px; background:var(--o2-border-color); flex-shrink:0; margin:0 2px; }

.syn-view-tabs   { display:flex; align-items:center; border:1px solid var(--o2-border-color); border-radius:7px; overflow:hidden; flex-shrink:0; }
.syn-view-tab    { display:flex; align-items:center; padding:4px 11px; font-size:11.5px; font-weight:500; border:none; border-right:1px solid var(--o2-border-color); background:transparent; color:var(--o2-tab-text-color); cursor:pointer; white-space:nowrap; transition:background .12s; outline:none; }
.syn-view-tab:last-child { border-right:none; }
.syn-view-tab:hover  { background:rgba(128,128,128,.09); }
.syn-view-tab.active { background:rgba(0,0,0,.06); color:var(--q-primary); font-weight:700; }
.body--dark .syn-view-tab.active { background:rgba(255,255,255,.08); }

.syn-pill        { display:inline-flex; align-items:center; gap:4px; padding:3px 8px; font-size:11.5px; font-weight:500; border:none; border-radius:5px; background:transparent; color:var(--o2-tab-text-color); cursor:pointer; white-space:nowrap; transition:background .12s; outline:none; }
.syn-pill:hover      { background:rgba(128,128,128,.1); }
.syn-pill--active    { background:rgba(0,0,0,.06); color:inherit; font-weight:700; }
.body--dark .syn-pill--active { background:rgba(255,255,255,.1); }
.syn-pill-count      { font-size:11px; font-weight:700; }
.syn-pill-dot    { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
.sdot-up         { background:#22c55e; }
.sdot-degraded   { background:#f59e0b; }
.sdot-down       { background:#ef4444; }

.syn-search-box   { display:flex; align-items:center; gap:5px; padding:3px 9px; border:1px solid var(--o2-border-color); border-radius:6px; flex:1; min-width:120px; }
.syn-search-input { border:none; outline:none; background:transparent; font-size:12px; color:inherit; width:100%; }
.syn-select { padding:4px 6px; border:1px solid var(--o2-border-color); border-radius:6px; background:var(--o2-card-background); color:inherit; font-size:11.5px; outline:none; cursor:pointer; }

/* ── TABLE AREA — fills space, no hardcoded bg ── */
.syn-table-scroll { flex:1; overflow:auto; padding:12px 16px 0; }
.syn-table { border-collapse:collapse; border:1px solid var(--o2-border-color); border-radius:10px; overflow:hidden; background:var(--o2-card-background); width:100%; min-width:1000px; }
.syn-th  { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--o2-tab-text-color); padding:9px 14px; border-bottom:1px solid var(--o2-border-color); text-align:left; position:sticky; top:0; background:var(--o2-card-background); z-index:1; white-space:nowrap; overflow:hidden; }
.syn-th.right { text-align:right; }
.th-inner { display:flex; align-items:center; justify-content:space-between; gap:4px; user-select:none; }
.col-resize-handle { width:4px; height:14px; cursor:col-resize; border-radius:2px; background:var(--o2-border-color); flex-shrink:0; transition:background .12s; }
.col-resize-handle:hover { background:var(--q-primary); }
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

.badge { display:inline-block; padding:2px 7px; border-radius:4px; font-size:11px; font-weight:700; }
.badge--http    { background:#dbeafe; color:#1d4ed8; }
.badge--browser { background:#ede9fe; color:#7c3aed; }
.badge--api     { background:#d1fae5; color:#065f46; }
.badge--tcp     { background:#ffedd5; color:#c2410c; }
.badge--ping    { background:#f1f5f9; color:#475569; }
.badge--dns     { background:#fef9c3; color:#854d0e; }
.body--dark .badge--http    { background:#172554; color:#93c5fd; }
.body--dark .badge--browser { background:#2e1065; color:#c4b5fd; }
.body--dark .badge--api     { background:#052e16; color:#6ee7b7; }
.body--dark .badge--tcp     { background:#431407; color:#fdba74; }
.body--dark .badge--ping    { background:#1e293b; color:#94a3b8; }
.body--dark .badge--dns     { background:#1c1917; color:#fef08a; }

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
.uptime-track { width:44px; height:4px; border-radius:999px; background:var(--o2-border-color); overflow:hidden; flex-shrink:0; }
.uptime-fill  { height:100%; border-radius:999px; }
.fill-g { background:#22c55e; } .fill-a { background:#f59e0b; } .fill-r { background:#ef4444; }

.locs-cell  { display:flex; align-items:center; gap:5px; cursor:default; }
.loc-first  { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:70px; }
.loc-badge  { font-size:11px; font-weight:700; padding:1px 5px; background:rgba(128,128,128,.18); border-radius:4px; white-space:nowrap; flex-shrink:0; }

.loc-float-tip  { position:fixed; z-index:9999; background:#1e293b; color:#f1f5f9; border-radius:8px; padding:9px 13px; box-shadow:0 8px 24px rgba(0,0,0,.28); min-width:150px; pointer-events:none; }
.loc-float-item { display:flex; align-items:center; gap:7px; font-size:12px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,.07); }
.loc-float-item:last-child { border-bottom:none; }
.loc-float-dot  { width:6px; height:6px; border-radius:50%; background:#22c55e; flex-shrink:0; }

.syn-page-icon { color: var(--q-primary, #1976d2); }

.row-actions { display:flex; align-items:center; gap:2px; }
.act-btn { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border:none; border-radius:6px; background:transparent; cursor:pointer; padding:0; transition:background .12s; color:rgba(0,0,0,.5); }
.body--dark .act-btn { color:rgba(255,255,255,.55); }
.act-btn:hover { background:rgba(128,128,128,.12); color:var(--q-primary, #1976d2); }
.act-btn--del:hover { background:rgba(239,68,68,.1); color:#dc2626; }

.mono { font-family:monospace; font-size:13px; font-weight:600; }
.c-g  { color:#16a34a; } .c-a { color:#d97706; } .c-r { color:#dc2626; }

.syn-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:80px 0; }

/* ── PAGINATION FOOTER — matches Incidents ── */
.syn-footer       { display:flex; align-items:center; padding:9px 16px; border-top:1px solid var(--o2-border-color); flex-shrink:0; background:var(--o2-card-background); gap:12px; min-height:46px; }
.syn-footer-total { font-size:13px; font-weight:700; white-space:nowrap; }
.syn-footer-right { display:flex; align-items:center; gap:8px; }
.syn-footer-info  { font-size:12px; color:var(--o2-tab-text-color); white-space:nowrap; }
.syn-footer-sep   { width:1px; height:16px; background:var(--o2-border-color); flex-shrink:0; }

/* ── PRIVATE LOCATIONS ── */
.pl-root    { flex:1; overflow-y:auto; padding:16px 20px 24px; }
.pl-grid    { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px; margin-bottom:20px; }
.pl-card    { background:var(--o2-card-background); border:1px solid var(--o2-border-color); border-radius:10px; padding:18px; display:flex; flex-direction:column; gap:8px; }
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
.pl-step-num     { width:24px; height:24px; border-radius:50%; background:var(--q-primary); color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; flex-shrink:0; margin-top:1px; }
.pl-step-body    { flex:1; }
.pl-step-title   { font-size:13px; font-weight:700; margin-bottom:3px; }
.pl-step-desc    { font-size:12px; color:var(--o2-tab-text-color); line-height:1.5; }
.pl-code-block   { position:relative; margin-top:10px; background:rgba(128,128,128,.08); border:1px solid var(--o2-border-color); border-radius:8px; padding:10px 12px; }
.pl-code-label   { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--o2-tab-text-color); margin-bottom:5px; }
.pl-code         { font-family:monospace; font-size:12px; margin:0; line-height:1.65; white-space:pre-wrap; word-break:break-all; }
.pl-copy-btn     { position:absolute; top:10px; right:10px; display:flex; align-items:center; justify-content:center; width:24px; height:24px; border:1px solid var(--o2-border-color); border-radius:5px; background:var(--o2-card-background); cursor:pointer; color:var(--o2-tab-text-color); padding:0; }
.pl-copy-btn:hover { background:rgba(128,128,128,.12); }

/* ── BACKDROP & DRAWER ── */
.syn-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:2000; }
.bf-enter-active,.bf-leave-active { transition:opacity .22s; }
.bf-enter-from,.bf-leave-to { opacity:0; }

.syn-drawer       { position:fixed; top:0; right:0; width:540px; max-width:95vw; height:100vh; background:var(--o2-card-background); box-shadow:-6px 0 30px rgba(0,0,0,.2); z-index:2001; display:flex; flex-direction:column; transform:translateX(100%); transition:transform .25s cubic-bezier(.4,0,.2,1); }
.syn-drawer--open { transform:translateX(0); }
.drw-header { display:flex; align-items:flex-start; justify-content:space-between; padding:18px 22px 14px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; }
.drw-title  { font-size:15px; font-weight:700; }
.drw-sub    { font-size:12px; color:var(--o2-tab-text-color); margin-top:2px; }
.drw-steps  { display:flex; align-items:center; padding:0 22px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; overflow-x:auto; }
.drw-step   { display:flex; align-items:center; gap:7px; padding:10px 10px; font-size:12px; font-weight:500; color:var(--o2-tab-text-color); cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; white-space:nowrap; user-select:none; transition:color .12s; }
.drw-step--active { color:var(--q-primary); border-bottom-color:var(--q-primary); font-weight:600; }
.drw-step--done   { color:#16a34a; }
.step-num   { width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; background:rgba(128,128,128,.18); color:var(--o2-tab-text-color); flex-shrink:0; }
.drw-step--active .step-num { background:var(--q-primary); color:#fff; }
.drw-step--done   .step-num { background:#16a34a; color:#fff; }
.drw-body   { flex:1; overflow-y:auto; padding:18px 22px; }
.drw-slabel { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--o2-tab-text-color); margin-bottom:12px; }
.drw-footer { display:flex; align-items:center; justify-content:space-between; padding:12px 22px; border-top:1px solid var(--o2-border-color); flex-shrink:0; }

.type-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.type-card { border:1.5px solid var(--o2-border-color); border-radius:10px; padding:14px; cursor:pointer; transition:border-color .12s,background .12s; }
.type-card:hover  { border-color:var(--q-primary); }
.type-card--on    { border-color:var(--q-primary); background:color-mix(in srgb,var(--q-primary) 8%,transparent); }
.type-top  { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
.type-name { font-size:13px; font-weight:700; margin-bottom:3px; }
.type-desc { font-size:11px; color:var(--o2-tab-text-color); line-height:1.4; }

.fstack { display:flex; flex-direction:column; gap:12px; }
.loc-section-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--o2-tab-text-color); margin-bottom:8px; }
.loc-list   { display:flex; flex-direction:column; gap:6px; }
.loc-item   { display:flex; align-items:center; gap:12px; padding:10px 14px; border:1.5px solid var(--o2-border-color); border-radius:8px; cursor:pointer; transition:border-color .12s,background .12s; }
.loc-item:hover { border-color:var(--q-primary); }
.loc-item--on   { border-color:var(--q-primary); background:color-mix(in srgb,var(--q-primary) 6%,transparent); }
.loc-flag { font-size:18px; line-height:1; }

/* ── SHARED NATIVE BUTTONS ── */
.syn-new-btn {
  display:inline-flex; align-items:center; gap:5px;
  background:var(--q-primary, #1976d2); color:#fff;
  border:none; border-radius:6px; padding:6px 14px;
  font-size:13px; font-weight:500; cursor:pointer; white-space:nowrap;
  transition:opacity .12s;
}
.syn-new-btn:hover { opacity:.88; }

.pg-btn {
  display:inline-flex; align-items:center; justify-content:center;
  width:30px; height:30px; border:none; border-radius:6px;
  background:transparent; cursor:pointer; padding:0;
  color:var(--o2-tab-text-color); transition:background .12s;
}
.pg-btn:hover:not(:disabled) { background:rgba(128,128,128,.12); color:var(--q-primary,#1976d2); }
.pg-btn:disabled { opacity:.35; cursor:default; }

.drw-close-btn {
  display:inline-flex; align-items:center; justify-content:center;
  width:30px; height:30px; border:none; border-radius:6px;
  background:transparent; cursor:pointer; padding:0; flex-shrink:0;
  color:var(--o2-tab-text-color); transition:background .12s;
}
.drw-close-btn:hover { background:rgba(128,128,128,.12); }

.drw-rm-btn {
  display:inline-flex; align-items:center; justify-content:center;
  width:26px; height:26px; border:none; border-radius:5px;
  background:transparent; cursor:pointer; padding:0; flex-shrink:0;
  color:var(--o2-tab-text-color); transition:background .12s;
}
.drw-rm-btn:hover { background:rgba(239,68,68,.1); color:#dc2626; }

.drw-add-btn {
  display:inline-flex; align-items:center; gap:4px;
  background:transparent; border:none; cursor:pointer;
  font-size:12px; font-weight:500; color:var(--q-primary, #1976d2);
  padding:4px 2px; border-radius:4px;
}
.drw-add-btn:hover { opacity:.75; }

.drw-btn {
  display:inline-flex; align-items:center; justify-content:center;
  border:none; border-radius:6px; padding:7px 16px;
  font-size:13px; font-weight:500; cursor:pointer; white-space:nowrap;
  transition:opacity .12s, background .12s;
}
.drw-btn:disabled { opacity:.4; cursor:default; }
.drw-btn--primary { background:var(--q-primary, #1976d2); color:#fff; }
.drw-btn--primary:hover:not(:disabled) { opacity:.88; }
.drw-btn--ghost { background:transparent; color:var(--o2-tab-text-color); }
.drw-btn--ghost:hover:not(:disabled) { background:rgba(128,128,128,.1); }

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
.geo-hdr-btn { display:inline-flex; align-items:center; gap:6px; padding:6px 14px; font-size:12px; font-weight:600; border:1px solid var(--o2-border-color); border-radius:7px; background:var(--o2-card-background); color:var(--o2-tab-text-color); cursor:pointer; transition:background .12s, box-shadow .12s; white-space:nowrap; position:relative; }
.geo-hdr-btn:hover { background:rgba(128,128,128,.06); box-shadow:0 1px 4px rgba(0,0,0,.06); }
.geo-hdr-btn--alert { border-color:rgba(239,68,68,.4); color:#dc2626; }
.body--dark .geo-hdr-btn--alert { color:#f87171; border-color:rgba(239,68,68,.35); }
.geo-hdr-badge { display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; border-radius:9px; background:#ef4444; color:#fff; font-size:10px; font-weight:700; padding:0 4px; margin-left:2px; }

/* "View Full Heatmap" button overlay — no longer used, kept for safety */
.geo-fullmap-btn { display:none; }

/* SVG map styles */
.geo-ocean   { fill:#c2ddf0; }
.body--dark .geo-ocean { fill:#091e3a; }
.geo-graticule line { stroke:rgba(128,128,128,0.15); stroke-width:0.5; }
.geo-land path { fill:#cdd5ae; stroke:#9faa80; stroke-width:0.7; }
.body--dark .geo-land path { fill:#3b4d2f; stroke:#4e6640; stroke-width:0.7; }
.geo-heatmap { }
.geo-dot   { cursor:pointer; }
.geo-dot-ring { }
@keyframes geo-pulse { 0%,100%{ opacity:.22;transform:scale(1); } 50%{ opacity:.52;transform:scale(1.4); } }
.geo-dot-pulse { animation:geo-pulse 2.2s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
.geo-dot-label { font-size:9px; fill:var(--o2-tab-text-color); font-family:system-ui,sans-serif; pointer-events:none; }
.geo-dot-label--lg { font-size:10.5px; font-weight:600; }
.geo-dot-sublabel { font-size:8.5px; fill:var(--o2-tab-text-color); font-family:system-ui,sans-serif; pointer-events:none; opacity:.7; }

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
.geo-th-badge { display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; border-radius:50%; background:var(--q-primary,#1976d2); color:#fff; font-size:9px; font-weight:700; margin-left:4px; vertical-align:middle; }

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
.geo-modal-overlay { position:fixed; inset:0; z-index:1500; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; padding:24px; }
.geo-modal { background:var(--o2-card-background); border:1px solid var(--o2-border-color); border-radius:14px; width:min(1100px,94vw); max-height:90vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 60px rgba(0,0,0,.35); }
.geo-modal-hdr { display:flex; align-items:center; gap:12px; padding:14px 18px 12px; border-bottom:1px solid var(--o2-border-color); flex-shrink:0; }
.geo-modal-title { font-size:14px; font-weight:700; }
.geo-modal-legend { display:flex; align-items:center; gap:12px; margin-left:8px; flex:1; }
.geo-leg-item { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--o2-tab-text-color); }
.geo-leg-dot { display:inline-block; width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.geo-modal-close { margin-left:auto; background:none; border:none; cursor:pointer; color:var(--o2-tab-text-color); display:flex; opacity:.7; padding:4px; border-radius:4px; }
.geo-modal-close:hover { opacity:1; background:rgba(128,128,128,.1); }
.geo-modal-body { flex:1; overflow:hidden; padding:0; }
.geo-modal-svg { width:100%; height:100%; display:block; min-height:440px; }

/* Active Issues modal */
.issues-modal { background:var(--o2-card-background); border:1px solid var(--o2-border-color); border-radius:14px; width:min(520px,92vw); max-height:80vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 60px rgba(0,0,0,.35); }
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

/* Modal transition */
.gm-enter-active, .gm-leave-active { transition:opacity .18s ease; }
.gm-enter-active .geo-modal, .gm-leave-active .geo-modal,
.gm-enter-active .issues-modal, .gm-leave-active .issues-modal { transition:transform .18s ease, opacity .18s ease; }
.gm-enter-from, .gm-leave-to { opacity:0; }
.gm-enter-from .geo-modal, .gm-enter-from .issues-modal { transform:scale(.96) translateY(8px); }
.gm-leave-to .geo-modal, .gm-leave-to .issues-modal { transform:scale(.96) translateY(8px); opacity:0; }

/* ── ICON COLOR HELPERS ── */
.syn-search-icon { color:var(--o2-tab-text-color); flex-shrink:0; }
.syn-empty-icon  { color:var(--o2-tab-text-color); }
.pl-icon-muted   { color:var(--o2-tab-text-color); flex-shrink:0; }
.pl-icon-primary { color:var(--q-primary, #1976d2); flex-shrink:0; }
.type-icon--on   { color:var(--q-primary, #1976d2); }
.type-icon--off  { color:rgba(128,128,128,.7); }
.type-check      { color:var(--q-primary, #1976d2); flex-shrink:0; }
</style>
