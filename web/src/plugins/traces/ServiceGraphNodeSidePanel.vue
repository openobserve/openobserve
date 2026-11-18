<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <ODrawer
    bleed
    :open="visible"
    :width="60"
    :seamless="true"
    :modal="false"
    :portal-target="containerEl"
    :title="selectedNode?.name || selectedNode?.label || selectedNode?.id"
    title-data-test="service-graph-side-panel-title"
    data-test="service-graph-side-panel"
    @update:open="
      (v) => {
        if (!v) handleClose();
      }
    "
  >
    <template #header-right>
      <div class="flex items-center gap-2">
        <!-- Agent nodes: show which env/version variant this node represents. -->
        <OAgentBadges
          v-if="selectedNode?.service_type === 'agent'"
          :env="agentEnvVersion.env"
          :version="agentEnvVersion.version"
          data-test="service-graph-node-agent-badges"
        />
        <span class="text-text-secondary text-xs">{{ t("serviceVersions.panel.health") }}</span>
        <span
          v-if="selectedNode?.health_withheld"
          class="text-text-muted"
          data-test="service-health-none"
          >{{ raw("—") }}<OTooltip :content="t('serviceVersions.catalog.healthNoTraffic')"
        /></span>
        <OTag
          v-else
          type="serviceStatus"
          :value="serviceHealth.status"
          data-test="service-health-badge"
          >{{ serviceHealth.text }}</OTag
        >
        <AiEntryButton v-bind="serviceDoor" :appearance="mdUp ? 'button' : 'toolbar-icon'" />
        <ODropdown side="bottom" align="start">
          <template #trigger>
            <OButton
              variant="outline"
              size="sm"
              data-test="service-graph-node-panel-view-related-btn"
            >
              {{ t("traces.serviceGraphNodeSidePanel.viewRelated") }}
              <OIcon name="arrow-drop-down" size="sm" />
            </OButton>
          </template>
          <ODropdownItem
            :disabled="logsLocked || correlationLocked"
            :focusable-unavailable="logsLocked || correlationLocked"
            :icon-left="logsLocked || correlationLocked ? 'lock' : undefined"
            :description="
              logsLocked ? logsLockedReason : correlationLocked ? correlationLockedReason : null
            "
            @select="viewRelatedLogs"
            data-test="service-graph-node-panel-view-related-logs-btn"
            >{{ t("traces.serviceGraphNodeSidePanel.logs") }}</ODropdownItem
          >
          <ODropdownItem
            :disabled="tracesLocked"
            :focusable-unavailable="tracesLocked"
            :icon-left="tracesLocked ? 'lock' : undefined"
            :description="tracesLocked ? tracesLockedReason : null"
            @select="viewRelatedTraces"
            data-test="service-graph-node-panel-view-related-traces-btn"
            >{{ t("traces.serviceGraphNodeSidePanel.traces") }}</ODropdownItem
          >
          <!-- FR-7's missing direction: service → the databases it queries.
               Database Monitoring already accepts a `service` scope; this is
               the entry point that sets it. Hidden when the feature is off. -->
          <ODropdownItem
            v-if="dbmEnabled || dbmLocked"
            :disabled="dbmLocked"
            :focusable-unavailable="dbmLocked"
            :icon-left="dbmLocked ? 'lock' : undefined"
            :description="dbmLocked ? dbmLockedReason : null"
            @select="viewRelatedDatabases"
            data-test="service-graph-node-panel-view-related-databases-btn"
            >{{ t("traces.serviceGraphNodeSidePanel.databases") }}</ODropdownItem
          >
        </ODropdown>
      </div>
    </template>

    <!-- Content Scrollable Area -->
    <!-- No horizontal padding here: sections that need an inset (charts, chip row, tab labels)
           add px-page-edge themselves, so dividers and tables can bleed to the edges naturally. -->
    <div
      class="panel-content bg-surface-base dark:bg-graph-panel-scrim flex-1 overflow-x-hidden overflow-y-auto py-2.5"
    >
      <!-- Own line, held from first paint: the title can't squeeze the chips, and chips that land later move nothing. -->
      <div
        v-if="versionsEnabled && !isInferred"
        class="px-page-edge flex min-h-8 min-w-0 flex-nowrap items-center gap-2 overflow-hidden pb-2"
        data-test="svcver-panel-identity"
      >
        <OTruncatedText
          v-if="identityNotReported || identityAbsent"
          class="text-text-secondary min-w-0 text-xs"
          data-test="svcver-panel-identity-not-reported"
          >{{ t("serviceVersions.panel.identityNotReported") }}</OTruncatedText
        >
        <template v-else-if="headerIdentity">
          <span v-if="!placeWithoutSpans" class="flex min-w-0 shrink"
            ><ServiceEnvChip :identity="headerIdentity" :service="headerIdentity.service_name"
          /></span>
          <span class="flex min-w-0 shrink">
            <ODimensionChip
              v-if="pickedPlace"
              dim-key="where"
              :key-label="t('serviceVersions.compare.whereChip')"
              :value="whereText(headerIdentity.where_key, headerIdentity.where, t)"
              :value-tooltip="false"
              removable
              :remove-label="t('serviceVersions.panel.clearPlace')"
              remove-data-test="svcver-panel-place-clear"
              data-test="svcver-panel-place"
              @remove="clearPickedPlace" /><ServiceScopeChip
              v-else
              facet="where"
              :where-key="headerIdentity.where_key"
              :place="headerIdentity.where"
          /></span>
          <span v-if="!placeWithoutSpans" class="flex min-w-0 shrink"
            ><ServiceScopeChip facet="version" :value="headerVersion"
          /></span>
        </template>
        <OSkeleton
          v-else-if="panelVersions.isLoading.value"
          type="text"
          class="h-3.5 w-64!"
          data-test="svcver-panel-identity-loading"
        />
      </div>
      <ul
        v-if="dependencies.length > 0"
        class="px-page-edge border-border-default mb-2 flex flex-col gap-1 border-b pb-2"
        :aria-label="t('assistant.entry.dependencies')"
        data-test="service-graph-node-panel-dependencies"
      >
        <li
          v-for="dep in dependencies"
          :key="dep.key"
          class="text-text-body flex items-center gap-2 text-sm"
        >
          <OTruncatedText class="min-w-0 flex-1">{{ dep.name }}</OTruncatedText>
          <AiEntryButton v-bind="dependencyDoor(dep)" appearance="toolbar-icon" />
        </li>
      </ul>
      <!-- RED Charts Section -->
      <div
        v-if="streamFilter !== 'all'"
        class="panel-section red-charts-section mb-0! flex flex-col p-0"
        data-test="service-graph-side-panel-red-charts"
      >
        <!-- DataZoom filter chips + View in Traces button -->
        <div
          v-if="filterChips.length"
          class="px-page-edge flex flex-wrap items-center gap-2 py-[0.3rem]"
          data-test="service-graph-side-panel-filter-chips"
        >
          <!-- Filter chip pills -->
          <div
            v-for="chip in filterChips"
            :key="chip.key"
            class="rounded-default border-border-default text-2xs text-text-body inline-flex items-center gap-1 border px-2 py-[0.325rem] leading-none"
            :data-test="`service-graph-filter-chip-${chip.key}`"
            :class="chip.type === 'duration' ? 'text-latency-p95' : 'text-status-error-text'"
          >
            <!-- Duration chip icon -->
            <OIcon
              v-if="chip.type === 'duration'"
              name="schedule"
              size="xs"
              class="text-latency-p95"
            />
            <!-- Error chip icon -->
            <OIcon
              v-else-if="chip.type === 'error'"
              name="warning"
              size="xs"
              class="text-status-error-text"
            />
            <span
              :class="chip.type === 'duration' ? 'text-latency-p95' : 'text-status-error-text'"
              >{{ chip.label }}</span
            >
            <OButton
              :aria-label="t('common.remove')"
              variant="ghost"
              size="icon-chip"
              class="ms-0.5"
              :data-test="`service-graph-filter-chip-remove-${chip.key}`"
              @click="removeLocalRangeFilter(chip.key)"
            >
              <OIcon name="close" size="xs" />
            </OButton>
          </div>

          <!-- Spacer -->
          <div class="flex-1" />

          <!-- View in Traces button -->
          <OTooltip v-if="tracesLocked" :content="tracesLockedReason">
            <span class="inline-flex">
              <OButton
                variant="ghost-primary"
                size="sm"
                disabled
                data-test="service-graph-side-panel-view-in-traces-btn"
              >
                <template #icon-left>
                  <OIcon name="lock" class="text-icon-locked" size="xs" />
                </template>
                {{ t("traces.serviceGraphNodeSidePanel.viewTraces") }}
              </OButton>
            </span>
          </OTooltip>
          <OButton
            v-else
            variant="ghost-primary"
            size="sm"
            data-test="service-graph-side-panel-view-in-traces-btn"
            @click="viewInTraces"
          >
            <template #icon-left>
              <OIcon name="search" size="xs" />
            </template>
            {{ t("traces.serviceGraphNodeSidePanel.viewTraces") }}
          </OButton>
        </div>
        <OBanner
          v-if="whereUnscopedNotice"
          variant="warning"
          dense
          class="mx-page-edge"
          data-test="svcver-panel-where-unscoped"
          >{{ whereUnscopedNotice }}</OBanner
        >
        <!-- Holds the grid's final height (10 rows of 17px plus padding) until the dashboard is built; an empty one shows add-panel copy. -->
        <div class="charts-wrapper min-h-[11.75rem] w-full py-0!">
          <div
            v-if="!dashboardData?.tabs"
            class="px-page-edge grid h-47 grid-cols-3 gap-2.5 py-2.5"
            aria-busy="true"
            data-test="service-graph-side-panel-red-charts-loading"
          >
            <OSkeleton v-for="n in 3" :key="n" type="rect" class="h-full w-full!" />
          </div>
          <div v-else class="charts-container w-full">
            <RenderDashboardCharts
              ref="dashboardChartsRef"
              :viewOnly="true"
              :frame="false"
              :dashboardData="markedDashboardData"
              :currentTimeObj="currentTimeObj"
              :allowAlertCreation="false"
              searchType="dashboards"
              @updated:dataZoom="onDataZoom"
            />
          </div>
        </div>
      </div>

      <!-- Reserved for every service from first paint, so deploys that load later or a new place never move the tabs. -->
      <div
        v-if="versionsEnabled && !isInferred && streamFilter !== 'all'"
        class="px-page-edge flex min-h-6 flex-wrap items-center gap-2"
        data-test="svcver-marker-legend"
      >
        <OButton
          v-if="markerQuery.isError.value"
          variant="ghost"
          size="chip"
          icon-left="refresh"
          class="text-text-secondary"
          data-test="svcver-marker-retry"
          @click="markerQuery.refetch()"
          >{{ t("serviceVersions.rum.markers.unavailable") }}</OButton
        >
        <span
          v-else-if="placeWithoutSpans"
          class="text-text-secondary text-xs"
          data-test="svcver-place-no-spans"
          >{{ placeNoSpansText }}</span
        >
        <span
          v-else-if="markerQuery.isSuccess.value"
          class="text-text-secondary text-xs"
          data-test="svcver-marker-label"
          >{{
            markerQuery.data.value?.deploys?.length
              ? t("serviceVersions.panel.deploysInRange")
              : t("serviceVersions.panel.noDeploysInRange")
          }}</span
        >
        <OButton
          v-for="marker in markerQuery.isError.value ? [] : markerQuery.data.value?.deploys || []"
          :key="marker.deploy_key"
          variant="ghost"
          size="chip"
          :data-test="`svcver-marker-${marker.deploy_key}`"
          @click="
            compareDrawer.open({
              service: selectedNode?.name || selectedNode?.label || selectedNode?.id,
              where: marker.where_key,
              a: marker.version,
              deployKey: marker.deploy_key,
              fromPanel: true,
            })
          "
          >{{ marker.kind === "rollback" ? "↶ " : "" }}{{ deployBuildLabel(marker, t) }}</OButton
        >
      </div>
      <!-- Full-bleed divider: panel has no horizontal padding, so w-full reaches both edges -->
      <OSeparator v-if="streamFilter !== 'all'" class="my-1.5!" />
      <!-- Tabs: Operations / Nodes / Pods -->
      <template v-if="streamFilter !== 'all'">
        <!-- Row spans full width so the bottom border bleeds; px-page-edge keeps the tab labels inset -->
        <div
          class="border-b-card-glass-border px-page-edge mb-0 flex min-h-9 items-end border-b"
          data-test="service-graph-node-panel-tabs-row"
        >
          <!-- Discovered tabs land between fixed ones, so the row waits to render every tab at once. -->
          <div
            v-if="!resourceTabsSettled"
            class="flex h-8 flex-1 items-center gap-5"
            aria-busy="true"
            data-test="service-graph-node-panel-tabs-skeleton"
          >
            <OSkeleton
              v-for="width in ['w-20!', 'w-16!', 'w-18!']"
              :key="width"
              type="text"
              :class="['h-3.5', width]"
            />
          </div>
          <OTabs
            v-else
            :model-value="activeTab"
            @update:model-value="onTabChange"
            dense
            align="left"
            class="w-[calc(100%-2rem)]! flex-1 font-bold"
            data-test="service-graph-node-panel-tabs"
          >
            <OTab
              name="operations"
              :label="t('traces.serviceGraphNodeSidePanel.operations')"
              class="capitalize"
              data-test="service-graph-node-panel-tab-operations"
            />
            <!-- Agent behavior (loops/failures) — only for agent nodes;
                   locked without an Enterprise/Cloud edition. See Agent
                   Signals design §4b. -->
            <OTab
              v-if="isAgentBehaviorContext"
              name="behavior"
              :label="t('aiObservability.behavior.node.tabLabel')"
              :suffix-icon="behaviorLocked ? 'lock' : undefined"
              :tooltip="aiObsLocked ? aiObsLockedReason : undefined"
              class="capitalize"
              data-test="service-graph-node-panel-tab-behavior"
            />
            <OTab
              v-for="cfg in activeResourceTabConfigs"
              :key="cfg.id"
              :name="cfg.id"
              :label="cfg.label"
              class="capitalize"
              :data-test="`service-graph-node-panel-tab-${cfg.id}`"
            />
            <OTab
              v-if="!isInferred"
              name="metrics"
              :label="t('traces.serviceGraphNodeSidePanel.metrics')"
              :suffix-icon="correlationLocked ? 'lock' : undefined"
              :tooltip="correlationLocked ? correlationLockedReason : undefined"
              class="capitalize"
              data-test="service-graph-node-panel-tab-metrics"
            />
            <OTab
              v-if="!isInferred"
              name="versions"
              :suffix-icon="!versionsEnabled ? 'lock' : undefined"
              data-test="svcver-versions-tab"
              ><span>{{ t("serviceVersions.panel.versions") }}</span
              ><OTag
                v-if="versionsEnabled && versionCount"
                type="countChip"
                :value="activeTab === 'versions' ? 'primary' : 'neutral'"
                data-test="svcver-versions-count"
                >{{ versionCount }}</OTag
              ></OTab
            >
          </OTabs>

          <!-- Resource tabs dropdown — shows/hides individual OTEL resource tabs -->
          <!-- Hidden for inferred services (they have fixed tabs from the registry) -->
          <div v-if="!isInferred" class="size-8 shrink-0">
            <ODropdown
              v-if="resourceTabsSettled && availableResourceTabConfigs.length > 0"
              side="bottom"
              align="end"
            >
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  data-test="service-graph-node-panel-workload-fields-btn"
                >
                  <OIcon name="tune" size="sm" />
                  <OTooltip :content="t('common.resources')" />
                </OButton>
              </template>
              <div class="min-w-48!" data-test="service-graph-node-panel-workload-fields-menu">
                <template v-for="env in detectedEnvironments" :key="env.key">
                  <div
                    class="text-muted-foreground px-3 py-1.5! pb-0 text-xs tracking-wide uppercase"
                  >
                    {{ env.label }}
                  </div>
                  <ODropdownItem
                    v-for="cfg in availableResourceTabConfigs.filter(
                      (c) => c.environment === env.key,
                    )"
                    :key="cfg.id"
                    :data-test="`service-graph-node-panel-workload-field-${cfg.id}`"
                    class="h-7.5! min-h-7.5! px-[0.325rem]!"
                    @select="
                      (e) => {
                        e.preventDefault();
                        toggleWorkloadField(cfg.id);
                      }
                    "
                  >
                    <template #icon-left>
                      <span @click.stop>
                        <OCheckbox
                          :model-value="selectedWorkloadFields.includes(cfg.id)"
                          size="xs"
                          @update:model-value="toggleWorkloadField(cfg.id)"
                        />
                      </span>
                    </template>
                    <span class="text-xs">
                      {{ cfg.label }}
                      <OTooltip :content="raw(cfg.groupField)" />
                    </span>
                  </ODropdownItem>
                </template>
              </div>
            </ODropdown>
          </div>
        </div>
        <OTabPanels v-model="activeTab" animated>
          <OTabPanel name="versions"
            ><ServiceVersionsTab
              :service="selectedNode?.name || selectedNode?.label || selectedNode?.id || ''"
              v-model:auto-pick="versionsAutoPick"
              :header-shows-scope="!identityNotReported"
              @scope="(scope) => (versionsTabScope = scope)"
          /></OTabPanel>
          <!-- Operations Tab -->
          <OTabPanel
            name="operations"
            class="panel-section mb-0! p-0!"
            data-test="service-graph-side-panel-recent-operations"
          >
            <div
              v-if="recentOperations.length === 0 && !loadingOperations"
              class="text-text-secondary flex flex-col items-center justify-center py-16 text-center text-sm"
            >
              {{ t("traces.serviceGraphNodeSidePanel.noOperationsFound") }}
            </div>
            <div
              v-else-if="recentOperations.length > 0 || loadingOperations"
              class="svc-panel-table overflow-hidden"
              data-test="service-graph-side-panel-operations-table"
            >
              <OTable
                :columns="operationsTableColumns"
                :data="sortedOperationsTableRows"
                sorting="server"
                :sort-by="sortBy || DEFAULT_SORT_BY"
                :sort-order="sortBy ? sortOrderProp : 'desc'"
                :loading="loadingOperations"
                :loading-reset-key="selectedNode?.id"
                :default-columns="false"
                :row-height="38"
                :show-global-filter="false"
                :fill-height="false"
                pagination="none"
                @sort-change="(p: any) => handleSortChange(p.column)"
                v-on="
                  tracesLocked
                    ? {}
                    : {
                        rowClick: (row: any) =>
                          navigateToTraces({
                            operationName: row.operation,
                            callerService: isInferred ? row.caller : undefined,
                          }),
                      }
                "
              >
                <template #cell-errors="{ row }">
                  <span :class="row.errors > 0 ? 'text-status-negative font-semibold' : ''">{{
                    row.errors
                  }}</span>
                </template>
                <template #cell-p99="{ row }">
                  <ServiceCatalogBarCell
                    :value="row.p99"
                    :max="rowMaxes(sortedOperationsTableRows, ['p99']).p99"
                    :label="raw(formatOperationLatency(row.p99))"
                    variant="warning"
                    align="right"
                    inline
                  />
                </template>
                <template #cell-p95="{ row }">
                  <ServiceCatalogBarCell
                    :value="row.p95"
                    :max="rowMaxes(sortedOperationsTableRows, ['p95']).p95"
                    :label="raw(formatOperationLatency(row.p95))"
                    align="right"
                    inline
                  />
                </template>
                <template #cell-p75="{ row }">
                  <ServiceCatalogBarCell
                    :value="row.p75"
                    :max="rowMaxes(sortedOperationsTableRows, ['p75']).p75"
                    :label="raw(formatOperationLatency(row.p75))"
                    align="right"
                    inline
                  />
                </template>
                <template #cell-hover-actions="{ row, column, active }">
                  <span v-if="active && tracesLocked" class="inline-flex" @click.stop>
                    <OButton
                      variant="ghost"
                      size="icon"
                      disabled
                      :aria-label="t('traces.serviceGraphNodeSidePanel.viewInTraces')"
                      data-test="service-graph-side-panel-view-traces-btn"
                    >
                      <OIcon name="lock" class="text-icon-locked" size="sm" />
                    </OButton>
                    <OTooltip :content="tracesLockedReason" />
                  </span>
                  <OButton
                    v-else-if="active"
                    variant="ghost"
                    size="icon"
                    data-test="service-graph-side-panel-view-traces-btn"
                    @click.stop="
                      navigateToTraces({
                        operationName: row.operation,
                        callerService: isInferred ? row.caller : undefined,
                        errorsOnly: column.id === 'errors',
                        minDurationMicros: isDurationColumn(column.id)
                          ? (row as Record<string, any>)[column.id]
                          : undefined,
                      })
                    "
                  >
                    <OIcon name="search" size="xs" />
                    <OTooltip :content="t('traces.serviceGraphNodeSidePanel.viewInTraces')" />
                  </OButton>
                </template>
                <template #empty>
                  <div
                    class="text-text-secondary flex flex-col items-center justify-center py-16 text-center text-sm"
                  >
                    {{ t("traces.serviceGraphNodeSidePanel.noOperationsFound") }}
                  </div>
                </template>
              </OTable>
            </div>
          </OTabPanel>

          <!-- Behavior Tab (agent nodes, enterprise) -->
          <OTabPanel
            v-if="showBehaviorTab"
            name="behavior"
            class="panel-section mb-0! p-0!"
            data-test="service-graph-side-panel-behavior"
          >
            <LicenseDeniedState
              v-if="aiObsLocked"
              :features="['ai_observability']"
              data-test="service-graph-side-panel-behavior-license-denied"
            />
            <AgentNodeBehaviorTab
              v-else
              :agent-name="behaviorAgentName"
              :source-stream="streamFilter"
              :start-time="timeRange.startTime"
              :end-time="timeRange.endTime"
              :agent-scope="agentScope"
            />
          </OTabPanel>

          <!-- Nodes Tab -->
          <!-- Dynamic OTEL resource tabs (Pods, Nodes, Hosts, Containers, Functions, ECS Tasks…) -->
          <OTabPanel
            v-for="cfg in activeResourceTabConfigs"
            :key="cfg.id"
            :name="cfg.id"
            class="panel-section mb-3 p-0!"
            :data-test="`service-graph-side-panel-${cfg.id}`"
          >
            <div
              v-if="resourceTabError[cfg.id]"
              role="alert"
              class="text-status-error-text flex flex-col items-center gap-3 py-6 text-center text-sm"
              :data-test="`service-graph-side-panel-${cfg.id}-error`"
            >
              <span>{{ resourceTabError[cfg.id] }}</span>
              <OButton
                variant="ghost-primary"
                size="sm"
                :data-test="`service-graph-side-panel-${cfg.id}-retry-btn`"
                @click="fetchResourceData(cfg)"
                >{{ t("traces.serviceGraphNodeSidePanel.retry") }}</OButton
              >
            </div>
            <div
              v-else-if="!resourceTabData[cfg.id]?.length && !resourceTabPending(cfg.id)"
              class="text-text-secondary flex flex-col items-center justify-center py-16 text-center text-sm"
            >
              {{ resourceEmptyText(cfg) }}
            </div>
            <div
              v-else-if="resourceTabData[cfg.id]?.length > 0 || resourceTabPending(cfg.id)"
              class="svc-panel-table overflow-hidden"
              :data-test="`service-graph-side-panel-${cfg.id}-table`"
            >
              <OTable
                :columns="buildEntityTableColumns(cfg.colId, cfg.colLabel)"
                :data="sortResourceRows(buildResourceTableRows(cfg))"
                sorting="server"
                :sort-by="sortBy || DEFAULT_SORT_BY"
                :sort-order="sortBy ? sortOrderProp : 'desc'"
                :loading="resourceTabPending(cfg.id)"
                :default-columns="false"
                :row-height="38"
                :show-global-filter="false"
                :fill-height="false"
                pagination="none"
                @sort-change="(p: any) => handleSortChange(p.column)"
                v-on="
                  tracesLocked
                    ? {}
                    : {
                        rowClick: (row: any) =>
                          navigateToTraces({
                            resourceFilter: cfg.fields
                              ? { fields: cfg.fields, value: row[cfg.colId] }
                              : { field: cfg.groupField, value: row[cfg.colId] },
                          }),
                      }
                "
              >
                <template #cell-hover-actions="{ row, column, active }">
                  <span v-if="active && tracesLocked" class="inline-flex" @click.stop>
                    <OButton
                      variant="ghost"
                      size="icon"
                      disabled
                      :aria-label="t('traces.serviceGraphNodeSidePanel.viewInTraces')"
                      :data-test="`service-graph-side-panel-${cfg.id}-view-traces-btn`"
                    >
                      <OIcon name="lock" class="text-icon-locked" size="sm" />
                    </OButton>
                    <OTooltip :content="tracesLockedReason" />
                  </span>
                  <OButton
                    v-else-if="active"
                    variant="ghost"
                    size="icon"
                    :data-test="`service-graph-side-panel-${cfg.id}-view-traces-btn`"
                    @click.stop="
                      navigateToTraces({
                        resourceFilter: cfg.fields
                          ? { fields: cfg.fields, value: row[cfg.colId] }
                          : { field: cfg.groupField, value: row[cfg.colId] },
                        errorsOnly: column.id === 'errors',
                        minDurationMicros: isDurationColumn(column.id) ? row[column.id] : undefined,
                      })
                    "
                  >
                    <OIcon name="search" size="xs" />
                    <OTooltip :content="t('traces.serviceGraphNodeSidePanel.viewInTraces')" />
                  </OButton>
                </template>
                <template #cell-errors="{ row }">
                  <span :class="row.errors > 0 ? 'text-status-negative font-semibold' : ''">{{
                    row.errors
                  }}</span>
                </template>
                <template #cell-p99="{ row }">
                  <ServiceCatalogBarCell
                    :value="row.p99"
                    :max="rowMaxes(sortResourceRows(buildResourceTableRows(cfg)), ['p99']).p99"
                    :label="raw(formatOperationLatency(row.p99))"
                    variant="warning"
                    align="right"
                    inline
                  />
                </template>
                <template #cell-p95="{ row }">
                  <ServiceCatalogBarCell
                    :value="row.p95"
                    :max="rowMaxes(sortResourceRows(buildResourceTableRows(cfg)), ['p95']).p95"
                    :label="raw(formatOperationLatency(row.p95))"
                    align="right"
                    inline
                  />
                </template>
                <template #cell-p75="{ row }">
                  <ServiceCatalogBarCell
                    :value="row.p75"
                    :max="rowMaxes(sortResourceRows(buildResourceTableRows(cfg)), ['p75']).p75"
                    :label="raw(formatOperationLatency(row.p75))"
                    align="right"
                    inline
                  />
                </template>
                <template #empty>
                  <div
                    class="text-text-secondary flex flex-col items-center justify-center py-16 text-center text-sm"
                  >
                    {{ resourceEmptyText(cfg) }}
                  </div>
                </template>
              </OTable>
            </div>
          </OTabPanel>

          <!-- Metrics Tab -->
          <OTabPanel
            v-if="!isInferred"
            name="metrics"
            class="panel-section mb-0! h-full! p-0!"
            data-test="service-graph-side-panel-metrics"
          >
            <LicenseDeniedState
              v-if="correlationLocked"
              :features="['correlation']"
              data-test="service-graph-side-panel-metrics-license-denied"
            />
            <!-- Loading state — shimmer skeletons standing in for the metric charts -->
            <div
              v-else-if="metricsCorrelationLoading || !metricsCorrelationLoaded"
              class="px-page-edge flex flex-col gap-3 py-4"
              data-test="service-graph-side-panel-metrics-loading"
            >
              <OSkeleton type="text" class="h-4 w-40!" />
              <OSkeleton type="rect" class="h-40 w-full!" />
              <OSkeleton type="rect" class="h-40 w-full!" />
            </div>

            <!-- Error state -->
            <div
              v-else-if="metricsCorrelationError"
              role="alert"
              class="text-status-error-text flex flex-col items-center gap-3 py-6 text-center text-sm"
              data-test="service-graph-side-panel-metrics-error"
            >
              <span>{{ metricsCorrelationError }}</span>
              <OButton
                variant="ghost-primary"
                size="sm"
                data-test="service-graph-side-panel-metrics-retry-btn"
                @click="fetchMetricsCorrelation(true)"
                >{{ t("traces.serviceGraphNodeSidePanel.retry") }}</OButton
              >
            </div>

            <!-- Metrics dashboard -->
            <TelemetryCorrelationDashboard
              v-else-if="metricsCorrelationData"
              mode="embedded-tabs"
              external-active-tab="metrics"
              :service-name="metricsCorrelationData.serviceName"
              :matched-dimensions="metricsCorrelationData.matchedDimensions"
              :additional-dimensions="metricsCorrelationData.additionalDimensions"
              :matched-set-id="metricsCorrelationData.matchedSetId"
              :chip-dimensions="metricsCorrelationData.chipDimensions"
              :source-event="metricsCorrelationData.sourceEvent"
              :metric-streams="metricsCorrelationData.metricStreams"
              :log-streams="metricsCorrelationData.logStreams"
              :trace-streams="metricsCorrelationData.traceStreams"
              :source-stream="streamFilter"
              source-type="traces"
              :time-range="telemetryTimeRange"
              :hide-dimension-filters="true"
              :metric-group-definitions="metricGroupResources"
              :panelHeight="12"
              :panelWidth="96"
              data-test="service-graph-side-panel-metrics-dashboard"
            />

            <!-- Empty state — standard OEmptyState -->
            <OEmptyState
              v-else-if="metricsCorrelationLoaded"
              size="inline"
              icon="insights"
              :title="t('traces.serviceGraphNodeSidePanel.noMetricsAvailable')"
              hide-action
              class="py-16"
              data-test="service-graph-side-panel-metrics-empty"
            />
          </OTabPanel>
        </OTabPanels>
      </template>
    </div>
  </ODrawer>

  <!-- Telemetry Correlation Dialog (reuses the same component as "show related" on logs page) -->
  <TelemetryCorrelationDashboard
    v-if="showTelemetryDialog && correlationData"
    mode="dialog"
    :service-name="correlationData.serviceName"
    :matched-dimensions="correlationData.matchedDimensions"
    :additional-dimensions="correlationData.additionalDimensions"
    :matched-set-id="correlationData.matchedSetId"
    :chip-dimensions="correlationData.chipDimensions"
    :log-streams="correlationData.logStreams"
    :metric-streams="correlationData.metricStreams"
    :trace-streams="correlationData.traceStreams"
    :time-range="telemetryTimeRange"
    :metric-group-definitions="metricGroupResources"
    @close="showTelemetryDialog = false"
  />
</template>

<script lang="ts">
import { useLoadedOrg } from "@/utils/assistant/doorBinding";
import {
  isOutsideK8s,
  versionImageLabel,
  versionPlaces,
  whereSentence,
  whereText,
} from "@/utils/serviceVersionsCopy";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";
import { useLockedAffordance } from "@/composables/useLockedAffordance";
import { useLicenseLock } from "@/composables/useFeatureLock";
import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";
import { defineComponent, computed, ref, watch, defineAsyncComponent, type PropType } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import ServiceVersionsTab from "@/enterprise/components/ServiceVersions/ServiceVersionsTab.vue";
import ServiceEnvChip from "@/components/shared/ServiceEnvChip.vue";
import ServiceScopeChip from "@/components/shared/ServiceScopeChip.vue";
import config from "@/aws-exports";
import { useQuery } from "@tanstack/vue-query";
import { deploysQuery, versionsQuery } from "@/services/service_versions.queries";
import {
  deployBuildLabel,
  deployMarkers,
} from "@/enterprise/components/ServiceVersions/deployMarkers";
import { useVersionCompareDrawer } from "@/enterprise/composables/useVersionCompareDrawer";
import { useServicePanelRoute } from "./composables/useServicePanelRoute";
import { streamTraceRows } from "@/plugins/correlation/correlationStream";
import useStreams from "@/composables/useStreams";
import {
  correlate as correlateStreams,
  getSemanticGroups,
  getDimensionAnalytics,
  type FieldAlias,
  type FoundGroup,
  buildChipDimensionsFromFilters,
} from "@/services/service_streams";
import { ENV_SEGMENTS, groupEnvKey } from "@/utils/serviceStreamEnvs";
import { buildStreamFilterCondition } from "@/utils/telemetryCorrelation";
import { serviceNamesSql } from "@/utils/serviceCount";
import {
  escapeSingleQuotes,
  deepCopy,
  formatTimeWithSuffix,
  b64EncodeUnicode,
} from "@/utils/zincutils";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import metrics from "./metrics/metrics.json";
import { chartInterval } from "./metrics/latencyHeatmap";
import {
  type MetricGroupDefinition,
  K8S_METRIC_GROUP_DEFINITIONS,
} from "@/utils/metrics/metricGrouping";
import { buildWorkloadChipDimensions } from "@/composables/useMetricSubjectButtons";
import { genAiAgentsQuery } from "@/services/gen-ai-agent-mapping.queries";
import { queryClient } from "@/composables/query/queryClient";
import OAgentBadges from "@/components/shared/OAgentBadges.vue";
import { normalizeSeverity } from "@/utils/sourceEventSeverity";
import { serviceHealthFromErrorRate, serviceNodeErrorRate } from "@/utils/traces/serviceHealth";
import DeployedCode from "@/components/icons/DeployedCode.vue";
import { gt, useI18nTyped, raw, type I18nText, type I18nKey } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ServiceCatalogBarCell from "./components/ServiceCatalogBarCell.vue";

const TelemetryCorrelationDashboard = defineAsyncComponent(
  () => import("@/plugins/correlation/TelemetryCorrelationDashboard.vue"),
);

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

const OTable = defineAsyncComponent(() => import("@/lib/core/Table/OTable.vue"));

// Agent-scoped behavior signals shown on agent nodes (enterprise). Async so the
// enterprise chunk only loads when an agent node's Behavior tab is opened.
const AgentNodeBehaviorTab = defineAsyncComponent(
  () => import("@/enterprise/views/AIObservability/AgentNodeBehaviorTab.vue"),
);

// ---------------------------------------------------------------------------
// OTEL Resource Tab Configuration
// ---------------------------------------------------------------------------
// Resource tabs are derived dynamically from getDimensionAnalytics (org-wide).
//
// Priority logic:
//   - If any ENV_SEGMENTS groups (k8s / aws / azure / gcp) are present in the
//     current stream schema → show ONLY those platform-specific tabs.
//   - Otherwise → show generic fallbacks (host, container, faas, process, cloud).
//
// Within the shown set, DEFAULT_GROUP_IDS determines which tabs are pre-selected.
// ---------------------------------------------------------------------------

export interface ResourceTabConfig {
  id: string; // unique tab name (= FoundGroup.group_id)
  label: I18nText; // display label
  groupField: string; // SQL GROUP BY field (= FoundGroup.aliases["traces"])
  colLabel: I18nText; // header of the first column (entity name)
  colId: string; // row property key for the entity name column
  environment: string; // env key derived from group_id first segment
  isDefault: boolean; // pre-selected when the environment is first detected
  /** Fallback field chain for inferred service tabs. When set, the GROUP BY
   *  expression is COALESCE(NULLIF(fields[0], ''), NULLIF(fields[1], ''), …).
   *  When absent, groupField is used directly (existing OTEL resource tabs). */
  fields?: string[];
}

// ---------------------------------------------------------------------------
// Inferred Service Tabs — one entry per dependency type, with field fallback
// chains that generate COALESCE expressions for both SELECT/GROUP BY and
// the downstream filter clause.
// ---------------------------------------------------------------------------
/**
 * Describes a resource tab rendered for an inferred service in the node detail panel.
 *
 * Each tab exposes a group of related span attributes (e.g. host info, database names)
 * organised as a table. Because OTel semantic conventions have evolved across
 * generations, a single conceptual attribute may map to several field names
 * (e.g. host → `server_address`, `net_peer_name`, `net_peer_ip`, `network_peer_address`).
 *
 * The `fields` array defines a **fallback chain** — the first field found in the
 * stream schema is used as both the GROUP BY column and the link target for View
 * Traces drill-down. If multiple fields exist, they are assembled into a
 * `COALESCE(NULLIF(f1, ''), NULLIF(f2, ''), ...)` expression so that rows with
 * different generations of the same attribute still aggregate together.
 */
export interface InferredServiceTab {
  /** Unique tab identifier, e.g. "hosts", "databases", "queries" */
  id: string;
  /** Pre-resolved label — only for names that read the same in every language. */
  label?: I18nText;
  /** Preferred over `label`. This registry is module-scope so it cannot call
   *  t(); the mapper in setup() resolves the key. */
  labelKey?: I18nKey;
  /** Key for the column header shown in the resource table, e.g. "Host",
   *  "Database", "DB Operation". A key, not text: this registry is module-scope
   *  so it cannot call t() — the mapper in setup() resolves it, like `labelKey`. */
  colLabelKey: I18nKey;
  /**
   * Fallback-ordered field names for the attribute column, evaluated against the
   * stream schema at runtime. The first field present in the schema wins as the
   * primary GROUP BY column; additional matching fields contribute to a COALESCE
   * expression for unified aggregation.
   */
  fields: string[];
}

/**
 * Registry of inferred-service resource tabs, keyed by `service_type`.
 *
 * Each entry defines the resource breakdowns available for that service type.
 * At runtime, tabs are filtered against the target stream's schema so that
 * only tabs whose `fields` intersect the schema are shown to the user.
 *
 * OTel semantic convention coverage:
 * | Service Type | Tabs          | Attribute Generations                                     |
 * |-------------|---------------|-----------------------------------------------------------|
 * | database    | Hosts         | server_address, net_peer_*, network_peer_address          |
 * |             | Databases     | db_namespace, db_name (stabilised OTel DB)                |
 * |             | Queries       | db_operations (OTel DB operations)                        |
 * | queue       | Hosts         | server_address, net_peer_*, network_peer_address          |
 * |             | Destinations  | messaging_destination_name, messaging_destination         |
 * | rpc         | Hosts         | server_address, net_peer_*, network_peer_address          |
 * |             | RPC Services  | rpc_service, rpc_method                                   |
 * | http        | Hosts         | server_address, net_peer_*, network_peer_address          |
 *
 * When adding a new dependency type, add its entry here — the panel will
 * automatically render the appropriate resource tabs.
 */
const INFERRED_SERVICE_TABS: Record<string, InferredServiceTab[]> = {
  database: [
    {
      id: "hosts",
      labelKey: "traces.serviceGraphNodeSidePanel.tabHosts",
      colLabelKey: "traces.serviceGraphNodeSidePanel.colHost",
      fields: ["server_address", "net_peer_name", "net_peer_ip", "network_peer_address"],
    },
    {
      id: "databases",
      labelKey: "traces.serviceGraphNodeSidePanel.tabDatabases",
      colLabelKey: "traces.serviceGraphNodeSidePanel.colDatabase",
      fields: ["db_namespace", "db_name"],
    },
    {
      id: "queries",
      labelKey: "traces.serviceGraphNodeSidePanel.tabQueries",
      colLabelKey: "traces.serviceGraphNodeSidePanel.colDbOperation",
      fields: ["db_operations"],
    },
  ],
  queue: [
    {
      id: "hosts",
      labelKey: "traces.serviceGraphNodeSidePanel.tabHosts",
      colLabelKey: "traces.serviceGraphNodeSidePanel.colHost",
      fields: ["server_address", "net_peer_name", "net_peer_ip", "network_peer_address"],
    },
    {
      id: "destinations",
      labelKey: "traces.serviceGraphNodeSidePanel.tabDestinations",
      colLabelKey: "traces.serviceGraphNodeSidePanel.colDestination",
      fields: ["messaging_destination_name", "messaging_destination"],
    },
  ],
  rpc: [
    {
      id: "hosts",
      labelKey: "traces.serviceGraphNodeSidePanel.tabHosts",
      colLabelKey: "traces.serviceGraphNodeSidePanel.colHost",
      fields: ["server_address", "net_peer_name", "net_peer_ip", "network_peer_address"],
    },
    {
      id: "rpc_services",
      labelKey: "traces.serviceGraphNodeSidePanel.tabRpcServices",
      colLabelKey: "traces.serviceGraphNodeSidePanel.colRpcService",
      fields: ["rpc_service"],
    },
  ],
  external: [
    {
      id: "hosts",
      labelKey: "traces.serviceGraphNodeSidePanel.tabHosts",
      colLabelKey: "traces.serviceGraphNodeSidePanel.colHost",
      fields: ["server_address", "net_peer_name", "net_peer_ip", "network_peer_address"],
    },
    {
      id: "urls",
      labelKey: "traces.serviceGraphNodeSidePanel.tabUrls",
      colLabelKey: "traces.serviceGraphNodeSidePanel.colUrl",
      fields: ["http_url", "url_full"],
    },
  ],
};

/** Build a COALESCE expression from a fallback field chain.
 *  e.g. ["server_address", "net_peer_name"]
 *    → "COALESCE(NULLIF(server_address, ''), NULLIF(net_peer_name, ''))" */
const buildCoalesceExpr = (fields: string[]): string =>
  fields.map((f) => `NULLIF(${f}, '')`).join(", ");

/** Build a WHERE clause fragment to exclude rows where all fallback fields are null.
 *  e.g. ["server_address", "net_peer_name"]
 *    → "(server_address IS NOT NULL OR net_peer_name IS NOT NULL)" */
const buildNullCheck = (fields: string[]): string =>
  fields.map((f) => `${f} IS NOT NULL`).join(" OR ");

export interface ResourceRow {
  name: string;
  requestCount: number;
  errorCount: number;
  p50Latency: number;
  p75Latency: number;
  p95Latency: number;
  p99Latency: number;
}

// OTEL semantic field names (OpenObserve format: service_ prefix, dots → underscores)
// that are pre-selected by default when their environment is detected.
// Keyed on the actual stream field, not on the internal group_id, so this stays
// in sync with OTEL semantic conventions regardless of backend group_id naming.
const DEFAULT_GROUP_FIELDS = new Set([
  "o2_service_version",
  // Kubernetes
  "service_k8s_pod_name",
  "service_k8s_node_name",
  // Host
  "service_host_name",
  // Container
  "service_container_name",
  // Serverless (FaaS)
  "service_faas_name",
  // AWS ECS
  "service_aws_ecs_task_arn",
  "service_aws_ecs_container_name",
  // Cloud
  "service_cloud_region",
  // Process / runtime
  "service_process_runtime_name",
  "service_process_runtime_version",
  // Service identity
  "service_service_namespace",
  "service_service_version",
]);

// Generic environment display labels for non-primary-platform segments.
const DURATION_P95_PANEL_ID = "Panel_ServiceDurationP95";
// Dashboard grids are 192 columns wide, so three RED charts take a third each.
const RED_CHART_WIDTH = 64;
// Busiest first, as the catalog lists services.
const DEFAULT_SORT_BY = "requests";

// Primary platform labels (k8s/aws/azure/gcp) come from the shared ENV_SEGMENTS.
const GENERIC_ENV_LABELS: Record<string, string> = {
  get host() {
    return gt("traces.serviceGraphNodeSidePanel.envHost");
  },
  get container() {
    return gt("traces.serviceGraphNodeSidePanel.envContainer");
  },
  get faas() {
    return gt("traces.serviceGraphNodeSidePanel.envServerless");
  },
  get process() {
    return gt("traces.serviceGraphNodeSidePanel.envRuntime");
  },
  get cloud() {
    return gt("traces.serviceGraphNodeSidePanel.envCloud");
  },
};

/** Gets a display label for any environment key, platform or generic. */
const envLabel = (envKey: string): string =>
  Object.values(ENV_SEGMENTS).find((e) => e.key === envKey)?.label ??
  GENERIC_ENV_LABELS[envKey] ??
  envKey;

/** Builds the Duration p95 RED chart from the Rate panel, so it shares its style and trace search. */
const durationP95Panel = (ratePanel: any, title: string) => {
  const panel = deepCopy(ratePanel);
  panel.id = DURATION_P95_PANEL_ID;
  panel.title = title;
  panel.config.unit = "milliseconds";
  panel.config.unit_custom = "";
  panel.config.decimals = 0;
  // p95 comes from the same authorized trace search as Rate and Errors, never from a rollup.
  panel.queries[0].query =
    "SELECT histogram(_timestamp, '[INTERVAL]') AS time_bucket, approx_percentile_cont(duration, 0.95) / 1000.0 AS p95_duration FROM [STREAM_NAME] [WHERE_CLAUSE] GROUP BY time_bucket ORDER BY time_bucket ASC";
  panel.queries[0].fields.y = panel.queries[0].fields.y.map((field: any) => ({
    ...field,
    alias: "p95_duration",
    column: "p95_duration",
  }));
  return panel;
};

export default defineComponent({
  name: "ServiceGraphNodeSidePanel",
  components: {
    ServiceVersionsTab,
    ServiceEnvChip,
    ServiceScopeChip,
    OTag,
    OTruncatedText,
    OSeparator,
    OSkeleton,
    ODimensionChip,
    OEmptyState,
    OTabs,
    OTab,
    OTabPanels,
    OTabPanel,
    OButton,
    OBanner,
    ODropdown,
    ODropdownItem,
    ODrawer,
    TelemetryCorrelationDashboard,
    LicenseDeniedState,
    OTable,
    RenderDashboardCharts,
    OTooltip,
    OCheckbox,
    OIcon,
    ServiceCatalogBarCell,
    AgentNodeBehaviorTab,
    OAgentBadges,
    AiEntryButton: defineAsyncComponent(
      () => import("@/components/ai-assistant/entry/AiEntryButton.vue"),
    ),
  },
  props: {
    selectedNode: {
      type: Object as PropType<any>,
      required: true,
    },
    graphData: {
      type: Object as PropType<{ nodes: any[]; edges: any[] }>,
      required: true,
    },
    timeRange: {
      type: Object as PropType<{ startTime: number; endTime: number }>,
      required: true,
    },
    visible: {
      type: Boolean,
      required: true,
    },
    streamFilter: {
      type: String,
      required: true,
    },
    containerEl: {
      type: Object as PropType<HTMLElement | null>,
      default: null,
    },
    agentScope: {
      type: Object as PropType<{
        name: string;
        env: string | null;
        version: string | null;
      } | null>,
      default: null,
    },
  },
  emits: ["close", "view-traces"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18nTyped();

    // The selection card's door: the service with its inbound and outbound calls over the window.
    const loadedOrg = useLoadedOrg(
      () => props.graphData,
      () => store.state.selectedOrganization?.identifier ?? "",
    );
    const { mdUp } = useBreakpoint();
    const serviceDoor = computed(() => {
      const node = props.selectedNode ?? {};
      const id = node.id;
      const sum = (edges: any[]) => edges.reduce((n, e) => n + (e.total_requests || 0), 0);
      const inbound = sum(props.graphData.edges.filter((e: any) => e.to === id));
      const outbound = sum(props.graphData.edges.filter((e: any) => e.from === id));
      return {
        verb: "explain" as const,
        entryKind: "object_verb" as const,
        boundOrg: loadedOrg.value,
        objectKind: "service_edge" as const,
        label: t("assistant.entry.explainService"),
        tooltip: t("assistant.entry.tooltip.explainService"),
        dataTest: "ai-entry-service-edge-explain" as const,
        build: async () =>
          (await import("@/utils/assistant/prompts")).buildServiceEdgePrompt({
            org: store.state.selectedOrganization?.identifier ?? "",
            source: String(node.name || node.label || id || ""),
            inbound,
            outbound,
            range: {
              from: Math.round(props.timeRange.startTime / 1000),
              to: Math.round(props.timeRange.endTime / 1000),
            },
            timeZone: store.state.timezone || "UTC",
          }),
      };
    });
    // Each edge touching the selected node, so every dependency has its own named door.
    const dependencies = computed(() => {
      const id = props.selectedNode?.id;
      if (id === undefined) return [];
      const nameOf = (nodeId: unknown) => {
        const node = props.graphData.nodes?.find((n: any) => n.id === nodeId);
        return String(node?.name || node?.label || nodeId || "");
      };
      return (props.graphData.edges ?? [])
        .filter((e: any) => e.from != null && (e.from === id || e.to === id) && e.from !== e.to)
        .map((e: any) => {
          const source = nameOf(e.from);
          const target = nameOf(e.to);
          return {
            key: `${e.from}->${e.to}`,
            name: `${source} → ${target}`,
            source,
            target,
            edge: e,
          };
        });
    });
    const dependencyDoor = (dep: { name: string; source: string; target: string; edge: any }) => ({
      verb: "explain" as const,
      entryKind: "object_verb" as const,
      boundOrg: loadedOrg.value,
      objectKind: "service_edge" as const,
      label: t("assistant.entry.explainDependencyNamed", { name: dep.name }),
      tooltip: t("assistant.entry.tooltip.explainEdge"),
      dataTest: "ai-entry-service-edge-explain" as const,
      build: async () => {
        const requests = Number(dep.edge.total_requests) || 0;
        const failed = Number(dep.edge.failed_requests) || 0;
        const p95 = Number(dep.edge.p95_latency_ns) || 0;
        return (await import("@/utils/assistant/prompts")).buildServiceEdgePrompt({
          org: store.state.selectedOrganization?.identifier ?? "",
          source: dep.source,
          target: dep.target,
          requests,
          ...(requests > 0 && { errorRate: failed / requests }),
          ...(p95 > 0 && { p95Ms: p95 / 1e6 }),
          range: {
            from: Math.round(props.timeRange.startTime / 1000),
            to: Math.round(props.timeRange.endTime / 1000),
          },
          timeZone: store.state.timezone || "UTC",
        });
      },
    });
    const router = useRouter();
    const versionPanel = useServicePanelRoute();
    const routeOwnsNode = computed(() => versionPanel.owns(props.selectedNode));
    const versionsEnabled = config.isEnterprise === "true" || config.isCloud === "true";
    const compareDrawer = useVersionCompareDrawer();
    const markerQuery = useQuery(
      computed(() => ({
        ...deploysQuery(
          store.state.selectedOrganization?.identifier || "",
          store.state.userInfo?.email || "",
          {
            service:
              props.selectedNode?.name || props.selectedNode?.label || props.selectedNode?.id || "",
            where: versionPanel.state.value.where || undefined,
            start_time: props.timeRange.startTime,
            end_time: props.timeRange.endTime,
          },
        ),
        enabled:
          versionsEnabled &&
          props.visible &&
          Boolean(props.selectedNode) &&
          !props.selectedNode?.service_type,
      })),
    );

    const panelVersions = useQuery(
      computed(() => ({
        ...versionsQuery(
          store.state.selectedOrganization?.identifier || "",
          store.state.userInfo?.email || "",
          {
            service:
              props.selectedNode?.name || props.selectedNode?.label || props.selectedNode?.id || "",
            where: versionPanel.state.value.where || undefined,
            include_inactive: true,
            limit: 10000,
          },
        ),
        enabled:
          versionsEnabled &&
          props.visible &&
          Boolean(store.state.selectedOrganization?.identifier) &&
          Boolean(props.selectedNode) &&
          !props.selectedNode?.service_type,
      })),
    );
    // The tab's own pick labels the header and count only; spans never take it, since unstamped spans match no place.
    const versionsTabScope = ref({ service: "", where: "" });
    const versionsAutoPick = ref<{ owner: string; where: string }>();
    const versionsWhere = computed(() => {
      const node = props.selectedNode;
      const name = node?.name || node?.label || node?.id || "";
      return (
        versionPanel.state.value.where ||
        (versionsTabScope.value.service === name ? versionsTabScope.value.where : "")
      );
    });
    // A row with no version text records unstamped spans, not a version.
    const scopedVersions = computed(() =>
      (panelVersions.data.value?.versions || []).filter(
        (row) => row.version && row.where_key === versionsWhere.value,
      ),
    );
    // Before the tab picks, the count takes the place it will open on, so the badge does not wait for the tab.
    const countWhere = computed(
      () =>
        versionsWhere.value ||
        (versionPlaces(panelVersions.data.value?.versions || [], t)[0]?.key ?? ""),
    );
    const versionCount = computed(
      () =>
        (panelVersions.data.value?.versions || []).filter(
          (row) => row.version && row.where_key === countWhere.value,
        ).length,
    );
    const versionedIdentity = computed(
      () =>
        [...scopedVersions.value]
          .filter((row) => row.version && !row.restricted)
          .sort(
            (a, b) =>
              Number(b.active) - Number(a.active) ||
              (b.deploys?.[0]?.at || b.first_seen) - (a.deploys?.[0]?.at || a.first_seen),
          )[0],
    );
    // Unversioned spans can still name an env or place, so the header shows those; only spans with neither say none is reported.
    const unversionedIdentity = computed(() =>
      (panelVersions.data.value?.versions || []).find(
        (row) =>
          !row.version &&
          !row.restricted &&
          row.where_key === countWhere.value &&
          ((Boolean(row.env) && !row.no_env) || !isOutsideK8s(row.where_key, row.where)),
      ),
    );
    const headerIdentity = computed(
      () => versionedIdentity.value ?? (versionCount.value ? undefined : unversionedIdentity.value),
    );
    const headerVersion = computed(() =>
      versionedIdentity.value
        ? versionImageLabel(
            versionedIdentity.value.version,
            versionedIdentity.value.image,
            versionedIdentity.value.version_images,
            t,
          )
        : t("serviceVersions.catalog.noVersion"),
    );

    // A place the user picked in Versions scopes the whole panel, so the header shows it with a way back.
    const pickedPlace = computed(() => {
      const where = versionPanel.state.value.where;
      return (
        routeOwnsNode.value && Boolean(where) && where !== (props.selectedNode?.where_key || "")
      );
    });
    // A catalog row without a place has spans that report no version, so the header says so, as its row does.
    const identityNotReported = computed(
      () =>
        !pickedPlace.value &&
        Object.prototype.hasOwnProperty.call(props.selectedNode ?? {}, "where_key") &&
        !props.selectedNode?.where_key,
    );
    // A place whose spans carry no version once loaded says so, as the badge-less Versions tab does.
    const identityAbsent = computed(
      () =>
        !pickedPlace.value &&
        panelVersions.isSuccess.value &&
        versionCount.value === 0 &&
        !unversionedIdentity.value,
    );
    const clearPickedPlace = () =>
      versionPanel.update(props.selectedNode?.where_key || "", activeTab.value);
    // A link without a place opens the row the catalog shows, so it takes that row's place, as a click would.
    watch(
      () => [routeOwnsNode.value, versionPanel.state.value.whereSet, props.selectedNode] as const,
      ([owns, whereSet, node]) => {
        if (owns && !whereSet && !node?.service_type && node?.where_key)
          void versionPanel.update(node.where_key, versionPanel.state.value.tab);
      },
      { immediate: true },
    );

    const { getStream } = useStreams(t);

    // RED Charts State
    const dashboardData = ref<any>({});
    const markedDashboardData = computed(() => {
      if (!dashboardData.value?.tabs) return dashboardData.value;
      return {
        ...dashboardData.value,
        tabs: dashboardData.value.tabs.map((tab: any) => ({
          ...tab,
          panels: tab.panels.map((panel: any) => ({
            ...panel,
            config: {
              ...panel.config,
              chart_mark_lines: deployMarkers(
                markerQuery.isError.value ? [] : markerQuery.data.value?.deploys || [],
                panel.title === "Errors"
                  ? "error_rate"
                  : panel.title === "Rate"
                    ? "requests"
                    : "p95",
                store.state.timezone || "UTC",
                t,
              ),
              chart_mark_line_click: (marker: {
                version: string;
                where: string;
                deployKey?: string;
              }) =>
                compareDrawer.open({
                  service:
                    props.selectedNode?.name ||
                    props.selectedNode?.label ||
                    props.selectedNode?.id ||
                    "",
                  where: marker.where,
                  a: marker.version,
                  deployKey: marker.deployKey,
                  fromPanel: true,
                }),
            },
          })),
        })),
      };
    });

    // Local datazoom filter map (keyed by panelId)
    const localRangeFilters = ref<
      Map<
        string,
        {
          panelTitle: string;
          start: number | null;
          end: number | null;
          timeStart: number | null;
          timeEnd: number | null;
        }
      >
    >(new Map());
    // Reactivity trigger for Map changes (Vue 3 doesn't track Map.set() automatically)
    const rangeFiltersVersion = ref(0);
    const selectedTimeObj = ref({
      start_time: new Date(props.timeRange.startTime),
      end_time: new Date(props.timeRange.endTime),
    });

    const currentTimeObj = ref({
      __global: {
        start_time: new Date(props.timeRange.startTime),
        end_time: new Date(props.timeRange.endTime),
      },
    });

    // Returns the escaped service name value for use in SQL WHERE clauses
    const buildServiceName = (): string => {
      if (!props.selectedNode) return "";
      const name = props.selectedNode.name || props.selectedNode.label || props.selectedNode.id;
      return escapeSingleQuotes(name);
    };
    // A catalog row folds a service's spellings, so its span reads match each one the row carries.
    const spanServiceNames = (): string[] => {
      const node = props.selectedNode;
      const spellings = node?.service_type ? undefined : node?.service_names;
      return spellings?.length ? spellings : [node?.name || node?.label || node?.id || ""];
    };

    // Shared cache of stream schema field names — populated by resolveStreamSchema,
    // consumed by serviceNameField (model column resolution), resolveWorkloadFields
    // and inferredTabConfigs. Declared here (ahead of serviceNameField) so the
    // computed can read it without a temporal-dead-zone error at mount.
    const streamFieldSet = ref<Set<string>>(new Set());
    const schemaResolved = ref(false);
    const schemaFailed = ref(false);
    // Bumped on every schema reset so a read that settles after a stream, node or org change is dropped.
    let schemaGeneration = 0;

    /**
     * Returns the SQL expression for the node's identity column, used in WHERE
     * clauses (`{expr} = 'name'`). A node falls into one of three families, keyed
     * by `service_type`:
     *
     * - **Instrumented service** (`service_type` absent) → `service_name`.
     * - **Inferred dependency** (`database`/`queue`/`rpc`/`external`) → discovered
     *   from span peer attributes, keyed by `infer_service_name`.
     * - **GenAI entity** (`agent`/`tool`/`model`) → derived from `gen_ai_*` columns.
     *   `agent`/`tool` have a single column. `model` may land in either
     *   `gen_ai_request_model` or `gen_ai_response_model` depending on the vendor
     *   (Langfuse/OpenInference populate only response), so it resolves to a
     *   COALESCE over whichever of the two the stream schema actually has —
     *   referencing a missing column is a hard "field not found" error.
     *
     * All call sites use this only as `WHERE {expr} = '...'`, so a COALESCE(...)
     * expression is valid everywhere it is interpolated.
     */
    const GENAI_NAME_FIELD: Record<string, string> = {
      agent: "gen_ai_agent_name",
      tool: "gen_ai_tool_name",
    };

    // Depth of the parent-chain climb used to attribute a tool/model span to its
    // OWNING agent. Must match the backend (processor.rs AGENT_INHERIT_DEPTH):
    // the agent name usually lives on an ANCESTOR span (real Google ADK nests
    // generate_content(agent)→chat→execute_tool), not on the tool/LLM span
    // itself, so the caller shown in this panel must climb the same way the graph
    // edge does — otherwise the panel says the app called the tool while the
    // graph correctly says the agent did.
    const AGENT_INHERIT_DEPTH = 4;

    // The nearest-ancestor-agent-or-service caller expression + chained ancestor
    // LEFT JOINs, aliased to child `c` (p1 on c, p2 on p1, …). Mirrors query-4.
    const genAiCallerClimb = (streamName: string) => {
      const parts = ["c.gen_ai_agent_name"];
      for (let k = 1; k <= AGENT_INHERIT_DEPTH; k++) parts.push(`p${k}.gen_ai_agent_name`);
      parts.push("c.service_name");
      const callerExpr = `COALESCE(${parts.join(", ")})`;
      const joins = Array.from({ length: AGENT_INHERIT_DEPTH }, (_, i) => {
        const k = i + 1;
        const prev = k === 1 ? "c" : `p${k - 1}`;
        return `LEFT JOIN "${streamName}" AS p${k} ON ${prev}.reference_parent_span_id = p${k}.span_id AND ${prev}.trace_id = p${k}.trace_id`;
      }).join(" ");
      return { callerExpr, joins };
    };

    /**
     * The node's identity column expression, with every column prefixed by
     * `alias` (e.g. `"c."` inside a self-join, `""` for a single-table query).
     * The prefix is applied AT CONSTRUCTION from the known column names — callers
     * never post-process the string, so there is no place for a column name to
     * be missed. See `serviceNameField` for the family rules.
     */
    const identityField = (alias = ""): string => {
      const st = props.selectedNode?.service_type;
      if (!st) return `${alias}service_name`;
      if (st === "model") {
        // Prefer request.model, fall back to response.model; only include a
        // column the schema has. If neither is known yet (schema unresolved),
        // default to request.model — the query re-runs reactively once the
        // schema fetch settles.
        const fs = streamFieldSet.value;
        const hasReq = fs.has("gen_ai_request_model");
        const hasResp = fs.has("gen_ai_response_model");
        if (hasReq && hasResp)
          return `COALESCE(${alias}gen_ai_request_model, ${alias}gen_ai_response_model)`;
        if (hasResp && !hasReq) return `${alias}gen_ai_response_model`;
        return `${alias}gen_ai_request_model`;
      }
      return `${alias}${GENAI_NAME_FIELD[st] ?? "infer_service_name"}`;
    };

    // Single-table identity expression (unaliased) — used everywhere the query
    // is a plain `FROM "{stream}"` with no join.
    const serviceNameField = computed(() => identityField());

    const hasCatalogServiceIdentity = computed(
      () =>
        Boolean(props.selectedNode?.service_type) &&
        Object.prototype.hasOwnProperty.call(props.selectedNode ?? {}, "service_system"),
    );

    // The route's where is the opened row's or a user pick, empty meaning every place; without versions no route is written.
    const selectedPanelWhere = computed<string>(() => {
      if (routeOwnsNode.value) return versionPanel.state.value.where;
      return props.selectedNode?.service_type ? "" : props.selectedNode?.where_key || "";
    });
    // null holds source queries until the schema settles; an unread schema drops the where, since an absent column 400s.
    const panelWhereKey = computed<string | null>(() => {
      const where = selectedPanelWhere.value;
      if (!where) return "";
      if (schemaResolved.value) return streamFieldSet.value.has("o2_service_where") ? where : "";
      return schemaFailed.value ? "" : null;
    });
    // The read context (org, stream, range, scope) whose operations came back empty.
    const opsEmptyFor = ref<string | null>(null);
    // A registry place can have no spans in this stream; saying so beats charts that look broken, and the header claims nothing.
    const placeWithoutSpans = computed(
      () => pickedPlace.value && Boolean(panelWhereKey.value) && opsEmptyFor.value === opsContext(),
    );
    const placeNoSpansText = computed(() =>
      whereSentence(
        {
          in: "serviceVersions.panel.placeNoSpans",
          outside: "serviceVersions.panel.placeNoSpansOutside",
        },
        selectedPanelWhere.value,
        headerIdentity.value?.where,
        {},
        t,
      ),
    );
    const whereUnscopedNotice = computed(() =>
      schemaFailed.value && selectedPanelWhere.value
        ? whereSentence(
            {
              in: "serviceVersions.panel.whereUnscoped",
              outside: "serviceVersions.panel.whereUnscopedOutside",
            },
            selectedPanelWhere.value,
            null,
            {},
            t,
          )
        : "",
    );

    const serviceFilter = (alias = ""): string => {
      let filter = serviceNamesSql(identityField(alias), spanServiceNames());
      if (panelWhereKey.value)
        filter += ` AND ${alias}o2_service_where = '${escapeSingleQuotes(panelWhereKey.value)}'`;
      if (!hasCatalogServiceIdentity.value) return filter;

      filter += ` AND ${alias}infer_service_type = '${escapeSingleQuotes(props.selectedNode.service_type)}'`;
      const serviceSystem = props.selectedNode.service_system;
      if (serviceSystem) {
        return `${filter} AND ${alias}infer_service_system = '${escapeSingleQuotes(serviceSystem)}'`;
      }
      return `${filter} AND (${alias}infer_service_system IS NULL OR ${alias}infer_service_system = '')`;
    };

    const opsContext = () =>
      JSON.stringify([
        store.state.selectedOrganization?.identifier,
        props.streamFilter,
        props.timeRange.startTime,
        props.timeRange.endTime,
        serviceFilter(),
      ]);

    const loadDashboard = () => {
      if (!props.selectedNode || props.streamFilter === "all") {
        dashboardData.value = {};
        return;
      }

      const streamName = props.streamFilter;

      selectedTimeObj.value = {
        start_time: new Date(props.timeRange.startTime),
        end_time: new Date(props.timeRange.endTime),
      };

      currentTimeObj.value = {
        __global: {
          start_time: new Date(props.timeRange.startTime),
          end_time: new Date(props.timeRange.endTime),
        },
      };

      const convertedDashboard = convertDashboardSchemaVersion(deepCopy(metrics));
      const catalogServiceFilter = serviceFilter();
      const interval = chartInterval(props.timeRange.startTime, props.timeRange.endTime);
      const redPanels = convertedDashboard.tabs[0].panels;
      redPanels.push(durationP95Panel(redPanels[0], t("serviceVersions.panel.durationP95")));

      convertedDashboard.tabs[0].panels.forEach((panel: any, index: number) => {
        let whereClause: string;

        // Errors count with FILTER over every span, so a bucket with spans and no errors plots 0, not a gap.
        whereClause = `WHERE ${catalogServiceFilter}`;

        panel.layout.h = 10;
        panel.layout.w = RED_CHART_WIDTH;
        panel.layout.x = index * RED_CHART_WIDTH;
        panel.layout.i = index + 1;

        let query = panel.queries[0].query
          .replace("[STREAM_NAME]", () => `"${streamName}"`)
          .replace("[WHERE_CLAUSE]", () => whereClause)
          .replace("[INTERVAL]", interval.sql)
          .replace("[INTERVAL_SECONDS]", String(interval.seconds));

        // Always span counts here, so the Rate unit is too.
        if (panel.title === "Rate") {
          panel.config.unit_custom = `\u00a0${t("traces.metrics.perSecond.spans")}`;
          panel.config.decimals = 1;
        }

        // Use count(*) instead of approx_distinct(trace_id)
        query = query
          .replace(
            /approx_distinct\(trace_id\)\s+filter\s*\(where\s+span_status\s*=\s*'ERROR'\)/gi,
            "count(*) FILTER (WHERE span_status = 'ERROR')",
          )
          .replace(/approx_distinct\(trace_id\)/gi, "count(*)");

        convertedDashboard.tabs[0].panels[index]["queries"][0].query = query;
      });

      dashboardData.value = convertedDashboard;
    };

    const createRangeFilter = (
      data: any,
      start: number | null = null,
      end: number | null = null,
      timeStart: number | null = null,
      timeEnd: number | null = null,
    ) => {
      const panelId = data?.id;
      const panelTitle = data?.title || "Chart";
      if (
        panelId &&
        (panelTitle === "Duration" || panelTitle === "Rate" || panelTitle === "Errors")
      ) {
        localRangeFilters.value.set(panelId, {
          panelTitle,
          start: start != null ? Math.floor(start) : null,
          end: end != null ? Math.floor(end) : null,
          timeStart: timeStart != null ? Math.floor(timeStart) : null,
          timeEnd: timeEnd != null ? Math.floor(timeEnd) : null,
        });
        rangeFiltersVersion.value++;
      }
    };

    const onDataZoom = ({
      start,
      end,
      start1,
      end1,
      data,
    }: {
      start: number;
      end: number;
      start1: number;
      end1: number;
      data: any;
    }) => {
      if (start && end) {
        const panelTitle = data?.title;
        if (panelTitle === "Rate" || panelTitle === "Errors") {
          createRangeFilter(data, -1, -1, start * 1000, end * 1000);
        } else {
          createRangeFilter(data, start1, end1, start * 1000, end * 1000);
        }
        rangeFiltersVersion.value++;
      }
    };

    const removeLocalRangeFilter = (panelId: string) => {
      localRangeFilters.value.delete(panelId);
      rangeFiltersVersion.value++;
    };

    const filterChips = computed(() => {
      // Access rangeFiltersVersion to force reactivity when Map changes
      rangeFiltersVersion.value;
      const chips: {
        key: string;
        label: I18nText;
        type: "duration" | "error";
      }[] = [];
      localRangeFilters.value.forEach((f, key) => {
        if (
          f.panelTitle === "Duration" &&
          f.start !== null &&
          f.end !== null &&
          f.start > 0 &&
          f.end > 0
        ) {
          chips.push({
            key,
            type: "duration",
            label: t("traces.serviceGraphNodeSidePanel.durationRange", {
              start: formatTimeWithSuffix(f.start),
              end: formatTimeWithSuffix(f.end),
            }),
          });
        } else if (f.panelTitle === "Errors") {
          chips.push({
            key,
            type: "error",
            label: t("traces.serviceGraphNodeSidePanel.statusError"),
          });
        }
      });
      return chips;
    });

    const viewInTraces = () => {
      let errorsOnly = false;
      let minDurationMicros: number | undefined;
      let maxDurationMicros: number | undefined;

      localRangeFilters.value.forEach((f) => {
        if (f.panelTitle === "Errors") errorsOnly = true;
        if (f.panelTitle === "Duration" && f.start !== null && f.start > 0) {
          minDurationMicros = f.start;
          maxDurationMicros = f.end ?? undefined;
        }
      });

      navigateToTraces({ errorsOnly, minDurationMicros, maxDurationMicros });
    };

    // Metric group definitions — controls which category tabs and default selections
    // appear in the metrics dashboard. Uses K8S_METRIC_GROUP_DEFINITIONS for OTel
    // semantic defaults; overrides the pods icon with the project-specific component.
    const metricGroupResources = ref<MetricGroupDefinition[]>(
      K8S_METRIC_GROUP_DEFINITIONS.map((g) => (g.id === "pods" ? { ...g, icon: DeployedCode } : g)),
    );

    // Semantic groups — fetched once for chip deduplication
    const orgSemanticGroups = ref<FieldAlias[]>([]);
    const loadOrgSemanticGroups = async () => {
      if (orgSemanticGroups.value.length > 0) return;
      try {
        const org = store.state.selectedOrganization.identifier;
        const resp = await getSemanticGroups(org);
        orgSemanticGroups.value = resp.data || [];
      } catch {
        // non-fatal: chips won't be deduplicated but will still show
      }
    };

    const { locked: correlationLocked, lockedReason: correlationLockedReason } =
      useLicenseLock("correlation");
    const { locked: dbmLocked, lockedReason: dbmLockedReason } = useLicenseLock("db_monitoring");
    const { locked: logsLocked, lockedReason: logsLockedReason } = useLicenseLock("logs");
    const { locked: tracesLocked, lockedReason: tracesLockedReason } = useLicenseLock("traces");

    // Metrics Correlation State
    const showTelemetryDialog = ref(false);
    const correlationLoading = ref(false);
    const correlationError = ref<string | null>(null);
    const correlationData = ref<{
      serviceName: string;
      matchedDimensions: Record<string, string>;
      additionalDimensions: Record<string, string>;
      matchedSetId?: string;
      chipDimensions?: Record<string, string>;
      logStreams: any[];
      metricStreams: any[];
      traceStreams: any[];
    } | null>(null);

    const telemetryTimeRange = computed(() => ({
      startTime: props.timeRange.startTime,
      endTime: props.timeRange.endTime,
    }));

    // Metrics Tab State (independent from "Show Telemetry" dialog)
    const metricsCorrelationLoading = ref(false);
    const metricsCorrelationError = ref<string | null>(null);
    const metricsCorrelationData = ref<{
      serviceName: string;
      matchedDimensions: Record<string, string>;
      additionalDimensions: Record<string, string>;
      matchedSetId?: string;
      chipDimensions?: Record<string, string>;
      sourceEvent?: {
        timestamp?: number | string;
        severity?: string;
        message?: I18nText;
      };
      logStreams: any[];
      metricStreams: any[];
      traceStreams: any[];
    } | null>(null);
    const metricsCorrelationLoaded = ref(false);

    const fetchCorrelatedStreams = async (force = false) => {
      if (!props.selectedNode || correlationLocked.value) return;
      if (!force && correlationData.value) return;

      correlationLoading.value = true;
      correlationError.value = null;

      try {
        const org = store.state.selectedOrganization.identifier;
        await loadOrgSemanticGroups();
        const serviceName =
          props.selectedNode.name || props.selectedNode.label || props.selectedNode.id;

        // Send service name directly to _correlate
        const correlateResponse = await correlateStreams(org, {
          source_stream: props.streamFilter || "default",
          source_type: "traces",
          available_dimensions: { service: serviceName },
        });

        const data = correlateResponse.data;
        if (!data) {
          correlationError.value = t("traces.serviceGraphNodeSidePanel.noCorrelatedStreams");
          correlationData.value = null;
          return;
        }

        correlationData.value = {
          serviceName: data.service_name,
          matchedDimensions: data.matched_dimensions || {},
          additionalDimensions: data.additional_dimensions || {},
          matchedSetId: data.matched_set_id,
          chipDimensions: buildChipDimensionsFromFilters(data, orgSemanticGroups.value),
          // No source row available here — subject chips will be added by metricsCorrelationData path
          logStreams: data.related_streams?.logs || [],
          metricStreams: data.related_streams?.metrics || [],
          traceStreams: data.related_streams?.traces || [],
        };
      } catch (err: any) {
        if (err.response?.status === 403) {
          correlationError.value = t("traces.serviceGraphNodeSidePanel.enterpriseFeature");
        } else {
          correlationError.value =
            err.message || t("traces.serviceGraphNodeSidePanel.failedToLoadStreams");
        }
        correlationData.value = null;
      } finally {
        correlationLoading.value = false;
      }
    };

    // Reset correlation data when node changes
    watch(
      () => props.selectedNode?.id,
      () => {
        correlationData.value = null;
        correlationError.value = null;
      },
    );

    // The latest span only enriches the metric chips, so a failed read degrades to no span.
    const fetchLatestSpan = async (): Promise<Record<string, any> | null> => {
      const streamName = props.streamFilter || "default";
      try {
        const rows = await streamTraceRows<Record<string, any>>({
          org: store.state.selectedOrganization.identifier,
          sql: `SELECT * FROM "${streamName}" WHERE ${serviceFilter()} ORDER BY _timestamp DESC`,
          startTime: props.timeRange.startTime,
          endTime: props.timeRange.endTime,
          size: 1,
          keepPartial: true,
        });
        return rows[0] ?? null;
      } catch {
        return null;
      }
    };

    // Fetch correlated metric streams for the Metrics tab
    const fetchMetricsCorrelation = async (force = false) => {
      if (!props.selectedNode || correlationLocked.value) return;
      if (!force && metricsCorrelationLoaded.value) return;

      metricsCorrelationLoading.value = true;
      metricsCorrelationError.value = null;
      metricsCorrelationData.value = null;

      try {
        const org = store.state.selectedOrganization.identifier;
        const serviceName = buildServiceName();

        // Fetch latest span to extract richer semantic dimensions
        const latestSpan = await fetchLatestSpan();
        const spanDimensions = {
          service: serviceName,
        };

        const correlateResponse = await correlateStreams(org, {
          source_stream: props.streamFilter || "default",
          source_type: "traces",
          available_dimensions: spanDimensions,
        });

        const data = correlateResponse.data;
        if (!data) {
          metricsCorrelationData.value = null;
          return;
        }

        const spanSeverity = (() => {
          if (!latestSpan) return undefined;
          const ss =
            typeof latestSpan.span_status === "string"
              ? latestSpan.span_status.toUpperCase()
              : null;
          if (ss === "ERROR") return "ERROR";
          return normalizeSeverity(latestSpan.severity_text ?? latestSpan.severity) ?? undefined;
        })();

        metricsCorrelationData.value = {
          serviceName: data.service_name,
          matchedDimensions: data.matched_dimensions || {},
          additionalDimensions: data.additional_dimensions || {},
          matchedSetId: data.matched_set_id,
          chipDimensions: {
            ...buildChipDimensionsFromFilters(data, orgSemanticGroups.value),
            ...buildWorkloadChipDimensions(
              data.matched_set_id,
              orgSemanticGroups.value,
              latestSpan ?? undefined,
            ),
          },
          sourceEvent: latestSpan
            ? {
                timestamp: latestSpan.start_time ?? latestSpan._timestamp,
                severity: spanSeverity,
                message: latestSpan.operation_name,
              }
            : undefined,
          logStreams: data.related_streams?.logs || [],
          metricStreams: data.related_streams?.metrics || [],
          traceStreams: data.related_streams?.traces || [],
        };
      } catch (err: any) {
        if (err.response?.status === 403) {
          metricsCorrelationError.value = t("traces.serviceGraphNodeSidePanel.enterpriseFeature");
        } else {
          metricsCorrelationError.value = t("traces.serviceGraphNodeSidePanel.metricsLoadFailed", {
            reason: err.response?.data?.message || err.message || "",
          });
        }
        metricsCorrelationData.value = null;
      } finally {
        metricsCorrelationLoading.value = false;
        metricsCorrelationLoaded.value = true;
      }
    };

    // Reload RED charts when node, time range, stream, visibility — or the
    // resolved identity column — changes. `serviceNameField` is in the deps
    // because for a model node it depends on the stream schema (request vs
    // response model column); the schema fetch settles AFTER the first render,
    // so without re-running here the charts fire once with the wrong/absent
    // column and error with "field not found".
    watch(
      () =>
        [
          props.selectedNode?.id,
          props.timeRange,
          props.streamFilter,
          props.visible,
          serviceNameField.value,
          panelWhereKey.value,
        ] as const,
      ([, , , visible, , whereKey]) => {
        if (visible && props.selectedNode) {
          if (whereKey === null) dashboardData.value = {};
          else loadDashboard();
        } else if (!visible) {
          dashboardData.value = {};
        }
      },
      { immediate: true, deep: true },
    );

    // Active tab state
    const activeTab = ref<string>(
      routeOwnsNode.value ? versionPanel.state.value.tab : "operations",
    );
    watch(
      () => versionPanel.state.value.tab,
      (tab) => {
        if (routeOwnsNode.value) activeTab.value = tab;
      },
    );

    // Recent Operations State
    const recentOperations = ref<any[]>([]);
    const loadingOperations = ref(false);

    // Dynamic resource tabs state
    const resourceTabData = ref<Record<string, ResourceRow[]>>({});
    const resourceTabLoading = ref<Record<string, boolean>>({});
    const resourceTabError = ref<Record<string, string>>({});
    // Resource groups from getDimensionAnalytics that match the current stream schema
    // (after platform-priority filtering — see resolveWorkloadFields)
    const availableResourceTabConfigs = ref<ResourceTabConfig[]>([]);
    // IDs of alias entries the user has checked in the dropdown
    const selectedWorkloadFields = ref<string[]>([]);

    /** Fetch the trace stream schema and populate streamFieldSet.
     *  Idempotent — skips if already resolved for the current stream.
     *  Uses useStreams(t).getStream() which caches the schema in the Vuex store
     *  so other components benefit from the cached data. */
    const resolveStreamSchema = async () => {
      if (
        !props.visible ||
        props.streamFilter === "all" ||
        !props.streamFilter ||
        schemaResolved.value
      )
        return;

      const generation = schemaGeneration;
      const isCurrent = () => generation === schemaGeneration;
      try {
        const stream = await getStream(props.streamFilter, "traces", true);
        if (!isCurrent()) return false;
        const schemaFields: { name: string; type: string }[] = stream?.schema || [];
        streamFieldSet.value = new Set(schemaFields.map((f) => f.name));
        schemaResolved.value = true;
      } catch (err) {
        if (!isCurrent()) return false;
        console.error("[ServiceGraphNodeSidePanel] Failed to resolve stream schema:", err);
        streamFieldSet.value = new Set();
        schemaFailed.value = true;
      }
      return true;
    };

    // Inferred service tabs — built from INFERRED_SERVICE_TABS registry when
    // the selected node has a service_type (database/queue/rpc/external).
    // Each tab's fallback field chain is filtered to only include fields that
    // actually exist in the stream schema. Tabs with zero surviving fields are
    // dropped entirely.
    const inferredTabConfigs = computed<ResourceTabConfig[]>(() => {
      const st = props.selectedNode?.service_type as string | undefined;
      if (!st) return [];
      const tabs = INFERRED_SERVICE_TABS[st];
      if (!tabs?.length) return [];
      const fieldSet = streamFieldSet.value;
      // If schema hasn't resolved yet, return empty — tabs appear once the
      // schema fetch completes (reactive via streamFieldSet).
      if (!schemaResolved.value) return [];
      const resolved: ResourceTabConfig[] = [];
      // named `tab`, not `t` — that would shadow the translator used just below
      for (const tab of tabs) {
        const present = tab.fields.filter((f) => fieldSet.has(f));
        if (present.length === 0) continue;
        resolved.push({
          id: tab.id,
          label: tab.labelKey ? t(tab.labelKey) : (tab.label ?? raw("")),
          groupField: `COALESCE(${buildCoalesceExpr(present)})`,
          colLabel: t(tab.colLabelKey),
          colId: tab.id,
          environment: "",
          isDefault: true,
          fields: present,
        });
      }
      return resolved;
    });

    /** Whether the selected node is an inferred service (uninstrumented dependency). */
    const isInferred = computed(() => !!props.selectedNode?.service_type);

    // The clicked agent's display name (same value the graph node is keyed by
    // and that AgentSignalDetailPanel filters on — see design §4b id-vs-name).
    const behaviorAgentName = computed<string>(
      () => props.selectedNode?.name || props.selectedNode?.label || props.selectedNode?.id || "",
    );

    // The Behavior tab (loop/failure signals) is relevant only for agent
    // nodes, and only when a concrete stream is selected (the signals stream
    // is per-source-stream) — independent of edition, so it drives the tab's
    // VISIBILITY. Actually unlocking it is a separate, edition-gated check.
    const isAgentBehaviorContext = computed(
      () =>
        props.selectedNode?.service_type === "agent" &&
        props.streamFilter !== "all" &&
        !!props.streamFilter,
    );
    const agentBehaviorAccess = useLockedAffordance("agentBehavior");
    // The AgentNodeBehaviorTab itself degrades gracefully to a "feature off"
    // hint if the rollup is disabled, so the panel only needs to mount once
    // both the context is right AND the edition allows it.
    const { locked: aiObsLocked, lockedReason: aiObsLockedReason } =
      useLicenseLock("ai_observability");
    const behaviorLocked = computed(() => aiObsLocked.value || !agentBehaviorAccess.value.allowed);
    const showBehaviorTab = computed(
      () =>
        isAgentBehaviorContext.value && (aiObsLocked.value || agentBehaviorAccess.value.allowed),
    );
    const { open: openUpgradeDialog } = useEnterpriseUpgradeDialog();

    // OTabs is controlled (`:model-value`), so refusing to advance `activeTab`
    // here is what keeps the locked Behavior tab from becoming active —
    // clicking it opens the upgrade dialog instead of switching.
    function onTabChange(name: string | number) {
      if (name === "behavior" && !aiObsLocked.value && !agentBehaviorAccess.value.allowed) {
        openUpgradeDialog();
        return;
      }
      activeTab.value = String(name);
      if (routeOwnsNode.value)
        void versionPanel.update(versionPanel.state.value.where, String(name));
    }

    // env/version for the clicked agent node. The graph topology doesn't carry
    // these, so resolve them from the discovered-agents registry: fetch the
    // agents for this stream and match the node's name. Cached per stream.
    const agentEnvVersion = ref<{ env: string | null; version: string | null }>({
      env: null,
      version: null,
    });
    const loadAgentEnvVersion = async () => {
      agentEnvVersion.value = { env: null, version: null };
      if (
        props.selectedNode?.service_type !== "agent" ||
        !props.streamFilter ||
        props.streamFilter === "all"
      ) {
        return;
      }
      try {
        const org = store.state.selectedOrganization?.identifier;
        if (!org) return;
        const res = await queryClient.fetchQuery(
          genAiAgentsQuery(
            org,
            Math.trunc(props.timeRange.startTime),
            Math.trunc(props.timeRange.endTime),
          ),
        );
        const match = res.agents.find(
          (a) => a.source_stream === props.streamFilter && a.name === behaviorAgentName.value,
        );
        if (match) {
          agentEnvVersion.value = {
            env: match.env ?? null,
            version: match.version ?? null,
          };
        }
      } catch {
        // Non-fatal: badges simply don't render if the lookup fails.
      }
    };
    watch(
      () => [props.selectedNode?.id, props.selectedNode?.service_type, props.streamFilter],
      loadAgentEnvVersion,
      { immediate: true },
    );

    // Tabs actually shown. For inferred services use the registry tabs;
    // for instrumented services use the user-selected OTEL resource tabs.
    const activeResourceTabConfigs = computed(() =>
      isInferred.value
        ? inferredTabConfigs.value
        : availableResourceTabConfigs.value
            .filter((c) => selectedWorkloadFields.value.includes(c.id))
            .sort(
              (a, b) =>
                Number(b.fields?.includes("o2_service_version")) -
                Number(a.fields?.includes("o2_service_version")),
            ),
    );
    const resourceTabsSettled = ref(false);
    const renderedTabIds = computed(() => [
      "operations",
      ...(isAgentBehaviorContext.value ? ["behavior"] : []),
      ...activeResourceTabConfigs.value.map((c) => c.id),
      ...(isInferred.value ? [] : ["metrics", "versions"]),
    ]);
    // Deduped list of environments detected from visible resource groups
    const detectedEnvironments = computed<{ key: string; label: string }[]>(() => {
      const seen = new Set<string>();
      const envs: { key: string; label: string }[] = [];
      for (const cfg of availableResourceTabConfigs.value) {
        if (!seen.has(cfg.environment)) {
          seen.add(cfg.environment);
          envs.push({
            key: cfg.environment,
            label: envLabel(cfg.environment),
          });
        }
      }
      return envs;
    });

    // Workload Field Discovery State
    const resolvedWorkloadFields = ref<{ field: string; alias: FieldAlias }[]>([]);

    // The picker's only write path, for both the dropdown item and its checkbox, so hiding the active tab always leaves it.
    const toggleWorkloadField = (id: string) => {
      const current = selectedWorkloadFields.value;
      const hiding = current.includes(id);
      selectedWorkloadFields.value = hiding
        ? current.filter((entry) => entry !== id)
        : [...current, id];
      // Leaving the hidden tab active would make the route-restore watcher re-enable it.
      if (hiding && activeTab.value === id) onTabChange("operations");
    };

    // Computed: Service Metrics
    const serviceMetrics = computed(() => {
      if (!props.selectedNode || !props.graphData) {
        return {
          requestRate: raw("N/A"),
          requestRateValue: raw("N/A"),
          totalRequests: 0,
          incomingRequests: 0,
          outgoingRequests: 0,
          errorRate: raw("N/A"),
          p50Latency: raw("N/A"),
          p95Latency: raw("N/A"),
          p99Latency: raw("N/A"),
        };
      }

      // Get total request count - handle both graph view (uses 'value') and tree view (uses 'requests')
      const totalRequests = props.selectedNode.value || props.selectedNode.requests || 0;

      // Calculate incoming requests (sum of all edges TO this node)
      const incomingEdges = props.graphData.edges.filter(
        (edge: any) => edge.to === props.selectedNode.id,
      );
      const incomingRequests = incomingEdges.reduce(
        (sum: number, edge: any) => sum + (edge.total_requests || 0),
        0,
      );

      // Calculate outgoing requests (sum of all edges FROM this node)
      const outgoingEdges = props.graphData.edges.filter(
        (edge: any) => edge.from === props.selectedNode.id,
      );
      const outgoingRequests = outgoingEdges.reduce(
        (sum: number, edge: any) => sum + (edge.total_requests || 0),
        0,
      );

      // Get errors and calculate error rate
      const errors = props.selectedNode.errors || 0;
      const errorRate = totalRequests > 0 ? (errors / totalRequests) * 100 : 0;

      // Calculate latency percentiles from incoming edges
      let p50Latency = 0;
      let p95Latency = 0;
      let p99Latency = 0;
      if (incomingEdges.length > 0) {
        p50Latency = Math.max(...incomingEdges.map((edge: any) => edge.p50_latency_ns || 0));
        p95Latency = Math.max(...incomingEdges.map((edge: any) => edge.p95_latency_ns || 0));
        p99Latency = Math.max(...incomingEdges.map((edge: any) => edge.p99_latency_ns || 0));
      }

      // Format request rate value without unit
      let requestRateValue = "";
      if (totalRequests >= 1000000) {
        requestRateValue = (totalRequests / 1000000).toFixed(1) + "M";
      } else if (totalRequests >= 1000) {
        requestRateValue = (totalRequests / 1000).toFixed(1) + "K";
      } else {
        requestRateValue = totalRequests.toString();
      }

      return {
        requestRate: formatRequestRate(totalRequests),
        requestRateValue: requestRateValue,
        totalRequests: totalRequests,
        incomingRequests: incomingRequests,
        outgoingRequests: outgoingRequests,
        errorRate: errorRate.toFixed(2) + "%",
        p50Latency: incomingEdges.length > 0 ? formatLatency(p50Latency) : raw("N/A"),
        p95Latency: incomingEdges.length > 0 ? formatLatency(p95Latency) : raw("N/A"),
        p99Latency: incomingEdges.length > 0 ? formatLatency(p99Latency) : raw("N/A"),
      };
    });

    // Computed: Service Health
    const serviceHealth = computed(() => {
      if (!props.selectedNode) {
        return {
          status: "unknown",
          text: t("traces.serviceGraphNodeSidePanel.unknown"),
        };
      }

      const node = props.selectedNode;
      if (node.health_status)
        return {
          status: node.health_status,
          text: t(`traces.servicesCatalog.status.${node.health_status}`),
        };
      const status = serviceHealthFromErrorRate(serviceNodeErrorRate(node));
      return { status, text: t(`traces.servicesCatalog.status.${status}`) };
    });

    // Computed: Check if "All Streams" is selected
    const isAllStreamsSelected = computed(() => {
      return props.streamFilter === "all";
    });

    // Helper: Format Request Rate (with unit)
    const formatRequestRate = (requests: number): string => {
      if (requests >= 1000000) {
        return (requests / 1000000).toFixed(1) + "M req/min";
      }
      if (requests >= 1000) {
        return (requests / 1000).toFixed(1) + "K req/min";
      }
      return requests + " req/min";
    };

    // Helper: Format Number (without unit)
    const formatNumber = (num: number): string => {
      if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + "M";
      }
      if (num >= 1000) {
        return (num / 1000).toFixed(1) + "K";
      }
      return num.toString();
    };

    // Helper: Format Latency
    const formatLatency = (nanoseconds: number): string => {
      if (!nanoseconds || nanoseconds === 0) return "N/A";
      const milliseconds = nanoseconds / 1000000;
      if (milliseconds >= 1000) {
        return (milliseconds / 1000).toFixed(2) + "s";
      }
      return milliseconds.toFixed(0) + "ms";
    };

    // The catalog's latency format and no-value mark, so one service reads the same in both.
    const formatOperationLatency = (microseconds: number): string =>
      microseconds ? formatTimeWithSuffix(microseconds) : "—";

    // ── Sorting state ──────────────────────────────────────────────────────
    const sortBy = ref<string>("");
    const sortOrder = ref<"asc" | "desc" | "">("");

    // The table's sort-order prop only accepts "asc" | "desc" | undefined; our
    // internal "" cleared-sentinel maps to undefined for the binding.
    const sortOrderProp = computed<"asc" | "desc" | undefined>(() =>
      sortOrder.value === "" ? undefined : sortOrder.value,
    );

    // 3-state sort cycle to match other O2 tables (OTable): asc → desc → cleared.
    // TenstackTable itself only toggles asc/desc, so we drive the cycle from our
    // own state and ignore its computed order — clearing restores the default order.
    function handleSortChange(field: string) {
      if (sortBy.value !== field) {
        sortBy.value = field;
        sortOrder.value = "asc";
      } else if (sortOrder.value === "asc") {
        sortOrder.value = "desc";
      } else {
        sortBy.value = "";
        sortOrder.value = "";
      }
    }

    const compareRows = (a: any, b: any, field: string): number => {
      if (field === "p99" || field === "p95" || field === "p75") {
        return (a[field] ?? 0) - (b[field] ?? 0);
      }
      // For requests, sort by raw _requests value
      if (field === "requests") {
        return (a.requests ?? 0) - (b.requests ?? 0);
      }
      const va = a[field];
      const vb = b[field];
      if (typeof va === "number" && typeof vb === "number") {
        return va - vb;
      }
      return String(va ?? "").localeCompare(String(vb ?? ""));
    };

    // A cleared sort falls back to the default, so the table is never in arrival order.
    const sortResourceRows = (rows: any[]) => {
      const field = sortBy.value || DEFAULT_SORT_BY;
      const order = sortBy.value ? sortOrder.value : "desc";
      return [...rows].sort((a, b) => {
        const result = compareRows(a, b, field);
        return order === "desc" ? -result : result;
      });
    };

    const sortedOperationsTableRows = computed(() => sortResourceRows(operationsTableRows.value));

    // Generic helper: builds table columns with a dynamic first (entity) column
    const buildEntityTableColumns = (entityId: string, entityHeader: I18nText) => [
      {
        id: entityId,
        accessorKey: entityId,
        header: entityHeader,
        size: 220,
        enableSorting: true,
        meta: { slot: false, sortable: true },
      },
      {
        id: "requests",
        accessorFn: (row: any) => formatNumber(row.requests),
        header: t("traces.serviceGraphNodeSidePanel.spans"),
        size: 130,
        enableSorting: true,
        meta: {
          sortable: true,
          align: "right",
          headerTooltip: t("traces.serviceGraphNodeSidePanel.spansTooltip"),
        },
      },
      {
        id: "errors",
        accessorKey: "errors",
        header: t("traces.serviceGraphNodeSidePanel.errors"),
        size: 110,
        enableSorting: true,
        meta: { slot: true, sortable: true, align: "right" },
      },
      {
        id: "p99",
        accessorKey: "p99",
        header: t("traces.serviceGraphNodeSidePanel.p99"),
        size: 118,
        enableSorting: true,
        meta: { slot: true, sortable: true, align: "right" },
      },
      {
        id: "p95",
        accessorKey: "p95",
        header: t("traces.serviceGraphNodeSidePanel.p95"),
        size: 118,
        enableSorting: true,
        meta: { slot: true, sortable: true, align: "right" },
      },
      {
        id: "p75",
        accessorKey: "p75",
        header: t("traces.serviceGraphNodeSidePanel.p75"),
        size: 118,
        enableSorting: true,
        meta: { slot: true, sortable: true, align: "right" },
      },
    ];

    // Computed: Operations table columns
    const operationsTableColumns = computed(() => {
      const cols = buildEntityTableColumns(
        "operation",
        t("traces.serviceGraphNodeSidePanel.operation"),
      );
      if (isInferred.value) {
        cols.unshift({
          id: "caller",
          accessorKey: "caller",
          header: t("traces.serviceGraphNodeSidePanel.caller"),
          size: 180,
          enableSorting: true,
          meta: { slot: false, sortable: true },
        });
      }
      return cols;
    });

    // Computed: Operations table rows
    const operationsTableRows = computed(() =>
      recentOperations.value.map((op) => ({
        operation: op.name,
        caller: op.callerService || "",
        requests: op.requestCount,
        errors: op.errorCount,
        p99: op.p99Latency,
        p95: op.p95Latency,
        p75: op.p75Latency,
        p50: op.p50Latency,
      })),
    );

    // Fetch aggregated operations (grouped by operation_name with percentiles).
    // For inferred services we also GROUP BY service_name so the caller is visible.
    const fetchAggregatedOperations = async () => {
      if (!props.selectedNode || !props.visible || props.streamFilter === "all") return;

      loadingOperations.value = true;
      recentOperations.value = [];
      const scope = opsContext();

      try {
        const streamName = props.streamFilter || "default";
        const st = props.selectedNode?.service_type;
        // A tool/model node's caller is its OWNING AGENT, which usually sits on an
        // ancestor span — resolve it with the same parent-chain climb the graph
        // edge uses (else the panel would show the host app as the caller, in
        // conflict with the graph). Genuinely-inferred deps (database/queue/…)
        // keep the raw service_name as caller. Instrumented services show none.
        const isGenAiChild = st === "tool" || st === "model";
        const isInf = isInferred.value;

        const metrics = `count(*) as request_count, count(*) FILTER (WHERE ${isGenAiChild ? "c." : ""}span_status = 'ERROR') as error_count, approx_percentile_cont(${isGenAiChild ? "c." : ""}duration, 0.50) as p50_latency, approx_percentile_cont(${isGenAiChild ? "c." : ""}duration, 0.75) as p75_latency, approx_percentile_cont(${isGenAiChild ? "c." : ""}duration, 0.95) as p95_latency, approx_percentile_cont(${isGenAiChild ? "c." : ""}duration, 0.99) as p99_latency`;

        let sql: string;
        if (isGenAiChild) {
          const { callerExpr, joins } = genAiCallerClimb(streamName);
          sql = `SELECT ${callerExpr} as caller_service, c.operation_name, ${metrics} FROM "${streamName}" AS c ${joins} WHERE ${serviceFilter("c.")} GROUP BY ${callerExpr}, c.operation_name`;
        } else {
          const selectCols = isInf
            ? "service_name as caller_service, operation_name"
            : "operation_name";
          const groupCols = isInf ? "service_name, operation_name" : "operation_name";
          sql = `SELECT ${selectCols}, ${metrics} FROM "${streamName}" WHERE ${serviceFilter()} GROUP BY ${groupCols}`;
        }

        const hits = await streamTraceRows<any>({
          org: store.state.selectedOrganization.identifier,
          sql,
          startTime: props.timeRange.startTime,
          endTime: props.timeRange.endTime,
          size: 100,
          keepPartial: true,
        });

        if (scope !== opsContext()) return;
        opsEmptyFor.value = hits.length ? null : scope;
        recentOperations.value = hits.map((op: any) => ({
          name: op.operation_name || "unknown",
          callerService: op.caller_service || undefined,
          requestCount: op.request_count || 0,
          errorCount: op.error_count || 0,
          p50Latency: op.p50_latency || 0,
          p75Latency: op.p75_latency || 0,
          p95Latency: op.p95_latency || 0,
          p99Latency: op.p99_latency || 0,
        }));
      } catch (error) {
        console.error("Failed to fetch aggregated operations:", error);
        if (scope === opsContext()) {
          recentOperations.value = [];
          opsEmptyFor.value = null;
        }
      } finally {
        if (scope === opsContext()) loadingOperations.value = false;
      }
    };

    watch(
      () => [
        props.visible,
        props.selectedNode?.id,
        props.streamFilter,
        props.timeRange.startTime,
        props.timeRange.endTime,
        // Re-fetch once the schema resolves the model column (request vs
        // response) — otherwise a model node's operations query fires with the
        // wrong column and returns "No operations found".
        serviceNameField.value,
        panelWhereKey.value,
      ],
      () => {
        if (!props.visible || !props.selectedNode || props.streamFilter === "all") return;
        // The schema read decides the scope, so the table shows its loading state, not "No operations", meanwhile.
        if (panelWhereKey.value === null) {
          loadingOperations.value = true;
          recentOperations.value = [];
          return;
        }
        fetchAggregatedOperations();
      },
      { immediate: true },
    );

    // Generic fetch for any OTEL resource tab config (supports both instrumented
    // and inferred service tabs; inferred tabs use a COALESCE field chain).
    const fetchResourceData = async (config: ResourceTabConfig) => {
      if (!props.selectedNode || !props.visible || props.streamFilter === "all") return;

      resourceTabLoading.value = {
        ...resourceTabLoading.value,
        [config.id]: true,
      };
      resourceTabData.value = { ...resourceTabData.value, [config.id]: [] };
      resourceTabError.value = { ...resourceTabError.value, [config.id]: "" };
      const scope = opsContext();

      try {
        const streamName = props.streamFilter || "default";
        const groupField = config.groupField;
        const alias = config.colId + "_name";

        // For inferred tabs with fallback fields, the null-check must span all
        // fields in the chain; for instrumented tabs a simple IS NOT NULL works.
        const nullClause = config.fields
          ? `(${buildNullCheck(config.fields)})`
          : `${groupField} IS NOT NULL`;

        const sql = `SELECT ${groupField} as ${alias}, count(*) as request_count, count(*) FILTER (WHERE span_status = 'ERROR') as error_count, approx_percentile_cont(duration, 0.50) as p50_latency, approx_percentile_cont(duration, 0.75) as p75_latency, approx_percentile_cont(duration, 0.95) as p95_latency, approx_percentile_cont(duration, 0.99) as p99_latency FROM "${streamName}" WHERE ${serviceFilter()} AND ${nullClause} GROUP BY ${alias} ORDER BY request_count DESC`;

        const hits = await streamTraceRows<any>({
          org: store.state.selectedOrganization.identifier,
          sql,
          startTime: props.timeRange.startTime,
          endTime: props.timeRange.endTime,
          size: 100,
          keepPartial: true,
        });

        if (scope !== opsContext()) return;
        resourceTabData.value = {
          ...resourceTabData.value,
          [config.id]: hits.map((row: any) => ({
            name: row[alias] || "unknown",
            requestCount: row.request_count || 0,
            errorCount: row.error_count || 0,
            p50Latency: row.p50_latency || 0,
            p75Latency: row.p75_latency || 0,
            p95Latency: row.p95_latency || 0,
            p99Latency: row.p99_latency || 0,
          })),
        };
      } catch (error: any) {
        if (scope !== opsContext()) return;
        // No data entry, so reopening the tab reads again instead of showing a failure as empty.
        const data = { ...resourceTabData.value };
        delete data[config.id];
        resourceTabData.value = data;
        resourceTabError.value = {
          ...resourceTabError.value,
          [config.id]: t("traces.serviceGraphNodeSidePanel.resourceLoadFailed", {
            resource: config.label.toLowerCase(),
            reason: error?.response?.data?.message || error?.message || "",
          }),
        };
      } finally {
        if (scope === opsContext())
          resourceTabLoading.value = {
            ...resourceTabLoading.value,
            [config.id]: false,
          };
      }
    };

    // Discover which workload fields exist in the trace stream and build resource tabs
    // via getDimensionAnalytics. Uses ENV_SEGMENTS priority: if any primary-platform
    // groups (k8s / aws / azure / gcp) match the schema, show only those. Otherwise
    // fall back to generic groups (host, container, faas, process, cloud).
    const resolveWorkloadFields = async () => {
      if (!props.visible || props.streamFilter === "all" || !props.streamFilter) return;

      // Ensure the stream schema is resolved (shared with inferred tab resolution)
      const generation = schemaGeneration;
      const isCurrent = () => generation === schemaGeneration;
      if ((await resolveStreamSchema()) === false || !isCurrent()) return;
      if (streamFieldSet.value.size === 0 || correlationLocked.value) return;

      try {
        const org = store.state.selectedOrganization.identifier;

        // Fetch semantic groups and build a reverse lookup map (field → alias)
        const semanticGroupsResponse = await getSemanticGroups(org);
        if (!isCurrent()) return;
        const fieldToAliasMap = new Map<string, FieldAlias>();
        for (const alias of semanticGroupsResponse.data) {
          for (const field of alias.fields) {
            fieldToAliasMap.set(field, alias);
          }
        }

        // Filter for service_ fields, intersect with semantic groups, deduplicate by alias.id
        const seen = new Set<string>();
        const matched: { field: string; alias: FieldAlias }[] = [];
        const schemaFields = [...streamFieldSet.value]; // already resolved above
        for (const fieldName of schemaFields) {
          if (!fieldName.startsWith("service_")) continue;
          const alias = fieldToAliasMap.get(fieldName);
          if (!alias || seen.has(alias.id)) continue;
          seen.add(alias.id);
          matched.push({ field: fieldName, alias });
        }
        resolvedWorkloadFields.value = matched;

        // Fetch org-wide dimension analytics to discover all available resource groups
        const analyticsResp = await getDimensionAnalytics(org);
        if (!isCurrent()) return;
        const allGroups: FoundGroup[] = analyticsResp.data?.available_groups ?? [];

        // Filter to groups whose traces (or spans) alias exists in this stream's schema
        const schemaMatchedGroups = allGroups.filter((g) => {
          const field = g.aliases["traces"] ?? g.aliases["spans"];
          return field && streamFieldSet.value.has(field);
        });

        // Apply ENV_SEGMENTS priority
        // If any primary-platform groups (k8s / aws / azure / gcp) are present
        // in this stream, show ONLY those. Otherwise fall back to generic groups.
        const platformGroups = schemaMatchedGroups.filter((g) => groupEnvKey(g.group_id) !== null);
        const visibleGroups = platformGroups.length > 0 ? platformGroups : schemaMatchedGroups;

        // Build ResourceTabConfig from FoundGroup data
        availableResourceTabConfigs.value = visibleGroups.map((g) => {
          const field = g.aliases["traces"] ?? g.aliases["spans"] ?? "";
          const envKey = groupEnvKey(g.group_id) ?? g.group_id.split("-")[0];
          return {
            id: g.group_id,
            label: raw(g.display),
            groupField: field,
            colLabel: raw(g.display),
            colId: g.group_id.replace(/-/g, "_"),
            environment: envKey,
            isDefault: DEFAULT_GROUP_FIELDS.has(field),
          };
        });

        // Version traffic replaces every version breakdown, so one meaning gets one tab.
        if (streamFieldSet.value.has("o2_service_version")) {
          availableResourceTabConfigs.value = availableResourceTabConfigs.value.filter(
            (c) =>
              c.groupField !== "o2_service_version" && c.groupField !== "service_service_version",
          );
          availableResourceTabConfigs.value.unshift({
            id: "service-version",
            label: t("serviceVersions.panel.byVersion"),
            groupField: "o2_service_version",
            colLabel: t("serviceVersions.panel.version"),
            colId: "service_version",
            environment: "",
            isDefault: true,
          });
        }

        // Smart defaults — pre-select only the important groups
        selectedWorkloadFields.value = availableResourceTabConfigs.value
          .filter((c) => c.isDefault)
          .map((c) => c.id);
      } catch (err) {
        if (!isCurrent()) return;
        console.error("[ServiceGraphNodeSidePanel] Failed to resolve workload fields:", err);
        resolvedWorkloadFields.value = [];
        availableResourceTabConfigs.value = [];
        selectedWorkloadFields.value = [];
      }
    };

    // An empty breakdown names what the spans lack, since the stream can have the column while this service never sets it.
    const resourceEmptyText = (config: ResourceTabConfig) =>
      config.groupField === "o2_service_version"
        ? t("traces.serviceGraphNodeSidePanel.noVersionTraffic")
        : t("traces.serviceGraphNodeSidePanel.noResourceRecorded", {
            resource: config.label.toLowerCase(),
          });

    // A tab whose read has not started yet is loading, never empty.
    const resourceTabPending = (id: string) =>
      Boolean(resourceTabLoading.value[id]) ||
      (resourceTabData.value[id] === undefined && !resourceTabError.value[id]);

    // Build table rows for any resource tab config
    const buildResourceTableRows = (config: ResourceTabConfig) =>
      (resourceTabData.value[config.id] || []).map((row) => ({
        [config.colId]: row.name,
        requests: row.requestCount,
        errors: row.errorCount,
        p99: row.p99Latency,
        p95: row.p95Latency,
        p75: row.p75Latency,
        p50: row.p50Latency,
      }));

    // Lazy-fetch resource tab data / metrics when their tab is activated
    watch(
      () =>
        [
          props.visible,
          props.selectedNode?.id,
          props.streamFilter,
          activeTab.value,
          panelWhereKey.value,
          activeResourceTabConfigs.value.map((c) => c.id).join(),
          // A refreshed row of the same node can add a spelling, which changes what the cached rows counted.
          serviceFilter(),
        ] as const,
      (next, prev) => {
        if (prev && (next[4] !== prev[4] || next[6] !== prev[6])) {
          resourceTabData.value = {};
          resourceTabLoading.value = {};
          resourceTabError.value = {};
          metricsCorrelationLoaded.value = false;
        }
        if (
          !props.visible ||
          !props.selectedNode ||
          props.streamFilter === "all" ||
          panelWhereKey.value === null
        )
          return;
        const config = activeResourceTabConfigs.value.find((c) => c.id === activeTab.value);
        // An empty result is a loaded answer too; only a tab never read for this scope fetches.
        if (config && resourceTabData.value[config.id] === undefined) fetchResourceData(config);
        if (activeTab.value === "metrics") fetchMetricsCorrelation();
      },
      // A tab restored from the route may see no later dependency change, e.g. Metrics after a failed schema read.
      { immediate: true },
    );

    // Declared before discovery so the reset runs first; one source per value, so a refreshed row of the same node keeps its tab.
    watch(
      [
        () => props.selectedNode?.id,
        () => props.streamFilter,
        () => store.state.selectedOrganization?.identifier,
      ],
      () => {
        resourceTabData.value = {};
        resourceTabLoading.value = {};
        resourceTabError.value = {};
        availableResourceTabConfigs.value = [];
        resolvedWorkloadFields.value = [];
        selectedWorkloadFields.value = [];
        schemaGeneration++;
        resourceTabsSettled.value = false;
        schemaResolved.value = false;
        schemaFailed.value = false;
        streamFieldSet.value = new Set();
        metricsCorrelationData.value = null;
        metricsCorrelationError.value = null;
        metricsCorrelationLoaded.value = false;
        activeTab.value = routeOwnsNode.value ? versionPanel.state.value.tab : "operations";
        localRangeFilters.value.clear();
        rangeFiltersVersion.value++;
      },
    );

    // Trigger workload field discovery when the panel becomes visible with a valid stream.
    // For inferred services, resolve the stream schema so inferredTabConfigs can filter
    // fallback field chains to only those present in the schema.
    watch(
      () => [
        props.visible,
        props.selectedNode?.id,
        props.streamFilter,
        store.state.selectedOrganization?.identifier,
      ],
      ([visible]) => {
        if (visible && props.selectedNode && props.streamFilter !== "all") {
          const generation = schemaGeneration;
          const discovery = isInferred.value ? resolveStreamSchema() : resolveWorkloadFields();
          void discovery.finally(() => {
            if (generation === schemaGeneration) resourceTabsSettled.value = true;
          });
        }
      },
      { immediate: true },
    );

    // A stale or hidden tab name from the URL would leave an empty panel, so it falls back once the tab list is final.
    watch(
      () => [activeTab.value, renderedTabIds.value, resourceTabsSettled.value] as const,
      ([tab, ids, settled]) => {
        if (!settled || props.streamFilter === "all" || ids.includes(tab)) return;
        if (availableResourceTabConfigs.value.some((c) => c.id === tab)) {
          selectedWorkloadFields.value = [...selectedWorkloadFields.value, tab];
          return;
        }
        activeTab.value = "operations";
        if (routeOwnsNode.value)
          void versionPanel.update(versionPanel.state.value.where, "operations");
      },
    );

    // Navigate to traces explore page with contextual filters
    const navigateToTraces = (params: {
      operationName?: string;
      /** When the service is inferred, this is the caller's service_name. */
      callerService?: string;
      /** @deprecated use resourceFilter instead */
      nodeName?: string;
      /** @deprecated use resourceFilter instead */
      podName?: string;
      /** Generic OTEL resource filter. Use `field` for a single field,
       *  or `fields` for a fallback chain (OR clause in the filter). */
      resourceFilter?: { field?: string; fields?: string[]; value: string };
      errorsOnly?: boolean;
      minDurationMicros?: number;
      maxDurationMicros?: number;
      mode?: "spans" | "traces";
    }) => {
      if (tracesLocked.value) return;
      emit("view-traces", {
        stream: props.streamFilter,
        serviceName:
          props.selectedNode?.name || props.selectedNode?.label || props.selectedNode?.id,
        serviceType: props.selectedNode?.service_type,
        ...(props.selectedNode?.service_names?.length && !props.selectedNode?.service_type
          ? { serviceNames: spanServiceNames() }
          : {}),
        ...(hasCatalogServiceIdentity.value
          ? { serviceSystem: props.selectedNode?.service_system }
          : {}),
        operationName: params.operationName,
        callerService: params.callerService,
        nodeName: params.nodeName,
        podName: params.podName,
        resourceFilter: params.resourceFilter,
        errorsOnly: params.errorsOnly,
        minDurationMicros: params.minDurationMicros,
        maxDurationMicros: params.maxDurationMicros,
        timeRange: props.timeRange,
        mode: params.mode || "spans",
      });
    };

    // Handlers
    const handleClose = () => {
      emit("close");
    };

    const viewRelatedTraces = () => {
      navigateToTraces({ mode: "traces" });
    };

    /** Database Monitoring is on for this instance, so the service→databases
     *  entry point may render. Same flag the DBM routes and nav gate on. */
    const dbmEnabled = computed(() => Boolean(store.state.zoConfig?.database_monitoring_enabled));

    /**
     * Service → databases (DBM FR-7). Top queries scoped to this service over
     * the panel's window: the question from a service is "which of MY queries
     * is hurting", which is the query grain — the databases tab cannot scope
     * to a service without collapsing to estimated per-query totals. The name
     * goes in RAW (the router encodes it); `buildServiceName` is SQL-escaped
     * and would corrupt an O'Reilly-style name in a URL.
     */
    const viewRelatedDatabases = () => {
      const node = props.selectedNode;
      const serviceName = node?.name || node?.label || node?.id;
      if (!serviceName || dbmLocked.value) return;
      router.push({
        name: "dbmQueries",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          service: String(serviceName),
          from: String(props.timeRange.startTime),
          to: String(props.timeRange.endTime),
        },
      });
    };

    const viewRelatedLogs = async () => {
      const serviceName = buildServiceName();
      if (!serviceName || logsLocked.value || correlationLocked.value) return;

      const org = store.state.selectedOrganization.identifier;

      let streamName: string | undefined;
      let filterQuery = `${serviceNameField.value}='${serviceName}'`;

      try {
        const correlateResponse = await correlateStreams(org, {
          source_stream: props.streamFilter || "default",
          source_type: "traces",
          available_dimensions: { service: serviceName },
        });

        const logStreams = correlateResponse.data?.related_streams?.logs || [];
        if (logStreams.length > 0) {
          const firstLogStream = logStreams[0];
          streamName = firstLogStream.stream_name;

          // Build filter from the stream's resolved field names
          const filters: Record<string, string> = firstLogStream.filters || {};
          const filterParts = Object.entries(filters)
            .map(([field, value]) => buildStreamFilterCondition(firstLogStream, field, value))
            .join(" AND ");
          if (filterParts) {
            filterQuery = filterParts;
          }
        } else {
          toast({
            variant: "warning",
            message: t("traces.noLogsAvailableForService"),
          });
          return;
        }
      } catch {
        toast({
          variant: "warning",
          message: t("traces.noLogsAvailableForService"),
        });
        return;
      }

      const queryParams: any = {
        stream_type: "logs",
        from: props.timeRange.startTime,
        to: props.timeRange.endTime,
        sql_mode: "false",
        query: b64EncodeUnicode(filterQuery),
        org_identifier: org,
        // The Logs route is keep-alive, so a repeat visit only runs onActivated —
        // which restores the URL params solely on the trace-explorer branch.
        type: "trace_explorer",
      };

      if (streamName) {
        queryParams.stream = streamName;
      }

      // The Logs page keeps `isInitialized` in the store across unmounts, and while
      // it is set it restores the previous session from the store instead of reading
      // these params — dropping the stream, time range and filter. Clearing it makes
      // the URL the source of truth, same as the trace-details "View Logs" button.
      store.dispatch("logs/setIsInitialized", false);

      router.push({
        path: "/logs",
        query: queryParams,
      });
    };

    const handleShowTelemetry = async () => {
      await fetchCorrelatedStreams();
      if (correlationData.value) {
        showTelemetryDialog.value = true;
      } else if (correlationError.value) {
        toast({
          variant: "warning",
          message: raw(correlationError.value),
        });
      }
    };

    // Get color class for error rate card
    const getErrorRateClass = (): string => {
      const errorRateStr = serviceMetrics.value.errorRate;
      if (errorRateStr === "N/A") return "status-unknown";

      const errorRate = parseFloat(errorRateStr);
      if (errorRate < 1) return "status-healthy";
      if (errorRate < 5) return "status-warning";
      return "status-critical";
    };

    // Get color class for latency card
    const getLatencyClass = (latencyStr: string): string => {
      if (latencyStr === "N/A") return "status-unknown";

      // Parse latency value (could be "125ms" or "1.5s")
      let latencyMs = 0;
      if (latencyStr.endsWith("ms")) {
        latencyMs = parseFloat(latencyStr);
      } else if (latencyStr.endsWith("s")) {
        latencyMs = parseFloat(latencyStr) * 1000;
      }

      if (latencyMs < 100) return "status-healthy";
      if (latencyMs < 500) return "status-warning";
      return "status-critical";
    };

    const isDurationColumn = (column: string) => {
      return ["p99", "p95", "p75"].includes(column);
    };

    function rowMaxes(rows: any[], fields: string[]): Record<string, number> {
      const result: Record<string, number> = {};
      for (const f of fields) {
        result[f] = rows.reduce((m, r) => Math.max(m, r[f] ?? 0), 0) || 1;
      }
      return result;
    }

    return {
      serviceDoor,
      mdUp,
      dependencies,
      dependencyDoor,
      raw,
      t,
      whereUnscopedNotice,
      placeWithoutSpans,
      placeNoSpansText,
      serviceMetrics,
      serviceHealth,
      isAllStreamsSelected,
      isInferred,
      isAgentBehaviorContext,
      behaviorLocked,
      aiObsLocked,
      aiObsLockedReason,
      onTabChange,
      showBehaviorTab,
      behaviorAgentName,
      agentEnvVersion,
      serviceNameField,
      streamFieldSet,
      formatNumber,
      getErrorRateClass,
      getLatencyClass,
      handleClose,
      viewRelatedTraces,
      viewRelatedLogs,
      dbmEnabled,
      dbmLocked,
      dbmLockedReason,
      logsLocked,
      logsLockedReason,
      tracesLocked,
      tracesLockedReason,
      correlationLocked,
      correlationLockedReason,
      viewRelatedDatabases,
      handleShowTelemetry,
      // RED Charts
      dashboardData,
      markedDashboardData,
      markerQuery,
      deployBuildLabel,
      versionCount,
      versionsTabScope,
      versionsAutoPick,
      headerIdentity,
      headerVersion,
      pickedPlace,
      identityNotReported,
      identityAbsent,
      clearPickedPlace,
      whereText,
      resourceEmptyText,
      DEFAULT_SORT_BY,
      compareDrawer,
      versionsEnabled,
      selectedTimeObj,
      currentTimeObj,
      loadDashboard,
      // DataZoom filters
      filterChips,
      onDataZoom,
      removeLocalRangeFilter,
      viewInTraces,
      // Telemetry Correlation
      showTelemetryDialog,
      correlationLoading,
      correlationData,
      telemetryTimeRange,
      // Tabs
      activeTab,
      // Recent Operations
      loadingOperations,
      recentOperations,
      operationsTableColumns,
      operationsTableRows,
      navigateToTraces,
      // Dynamic resource tabs (OTEL platforms)
      availableResourceTabConfigs,
      resourceTabsSettled,
      activeResourceTabConfigs,
      detectedEnvironments,
      resourceTabData,
      resourceTabLoading,
      resourceTabError,
      fetchResourceData,
      resourceTabPending,
      panelVersions,
      buildEntityTableColumns,
      buildResourceTableRows,
      // Workload Field Discovery
      resolvedWorkloadFields,
      selectedWorkloadFields,
      toggleWorkloadField,
      // Metrics Tab
      metricsCorrelationLoading,
      metricsCorrelationError,
      metricsCorrelationData,
      metricsCorrelationLoaded,
      fetchMetricsCorrelation,
      metricGroupResources,
      sortedOperationsTableRows,
      sortBy,
      sortOrder,
      sortOrderProp,
      handleSortChange,
      sortResourceRows,
      formatOperationLatency,
      isDurationColumn,
      rowMaxes,
    };
  },
});
</script>

<style scoped>
/* keep(scrollbar): ::-webkit-scrollbar pseudo-elements have no utility form.
   This panel has both a light treatment (default values) and a dark
   indigo-tinted "glass" treatment (under `.dark &`). Keep the light rules — do
   not make it always-dark. */
.panel-content::-webkit-scrollbar {
  width: 0.5rem;
}

.panel-content::-webkit-scrollbar-track {
  background: var(--color-surface-panel);
}

.panel-content::-webkit-scrollbar-thumb {
  background: var(--color-border-default);
  border-radius: 0.25rem;
}

.panel-content::-webkit-scrollbar-thumb:hover {
  background: var(--color-grey-300);
}

.dark .panel-content::-webkit-scrollbar-track {
  background: color-mix(in srgb, var(--color-grey-900) 70%, var(--color-indigo-900));
}

.dark .panel-content::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--color-grey-800) 80%, var(--color-indigo-900));
}

.dark .panel-content::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--color-grey-700) 80%, var(--color-indigo-900));
}

.panel-section:last-child {
  margin-bottom: 0;
}

/* The panel scrolls vertically, so these tables take their natural height; a table
   wider than the panel scrolls sideways instead of clipping its last columns. */
.svc-panel-table :deep([data-test="o2-table-scroll-container"]) {
  overflow-x: auto;
  overflow-y: hidden;
  height: auto;
  max-height: none;
}

/* Align the first column's content with the tab labels above (page-edge + the
   tab's own 0.5rem px-2) while the header band and rows still bleed to the edge. */
.svc-panel-table :deep(tr > th:first-child),
.svc-panel-table :deep(tr > td:first-child) {
  padding-left: calc(var(--spacing-page-edge) + 0.5rem);
}

/* Numeric columns reserve a fixed right-hand slot: the value sits just left of
   it, and the per-cell "view in traces" button lives in that slot on hover — so
   there's no overlap and no shift. Headers get the same reserve so their text /
   sort-icon stay aligned with the values. */
.svc-panel-table :deep(td[class~="text-right!"]) > div,
.svc-panel-table :deep(th[class~="text-right!"]) {
  padding-right: 1.75rem;
}
</style>
