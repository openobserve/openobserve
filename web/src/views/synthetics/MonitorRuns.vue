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
<!--
  MonitorRuns — Chrome-less tabbed content for the Monitor Runs page.

  Two tabs (OTabs):
    - Overview: KPI cards, charts, breakdown cards, filter bar, runs table
    - Steps: Step analysis table with expandable rows
    - Errors: Error pattern grouping

  Runs table features:
    - Column resize (drag header edges) and column reorder (drag headers)
    - OTimeCell for date columns (Scheduled At, Last Run At)
    - Icons in cells (browser logos, location cloud icons, device icons)
    - Icons in filter dropdowns (browser, device, location selects)

  This component is chrome-less — it does NOT render OPageHeader.
  The parent (MonitorResults.vue) owns the header. This component is the
  content below it, following the LLMInsightsDashboard pattern.
-->

<template>
  <div
    class="monitor-runs h-full flex flex-col"
    data-test="synthetics-monitor-runs"
  >
    <!-- ── Tabs ──────────────────────────────────────────────────────── -->
    <OTabs
      v-model="activeTab"
      class="shrink-0 px-page-edge border-b border-border-default"
    >
      <OTab name="overview" data-test="monitor-runs-tab-overview">
        {{ t('synthetics.runs.tabOverview') }}
      </OTab>
      <OTab name="steps" data-test="monitor-runs-tab-steps"> {{ t('synthetics.runs.tabSteps') }} </OTab>
    </OTabs>

    <div class="flex-1 min-h-0">
      <OTabPanels v-model="activeTab" grow scroll="y" class="h-full min-h-0">
        <!-- ════════════ OVERVIEW ════════════ -->
        <OTabPanel name="overview">
          <div
            class="mx-auto py-2 flex flex-col gap-2"
          >
            <!-- Status Timeline — gated on runs query -->
            <template v-if="runsLoading || !runsHasLoadedOnce">
              <div class="px-page-edge">
                <div
                  class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-3.5 pt-2.5 pb-2"
                  >
                    <SkeletonBox width="100px" height="14px" rounded-default />
                    <span class="flex-1" />
                    <SkeletonBox width="45px" height="12px" rounded-default />
                    <SkeletonBox width="50px" height="12px" rounded-default />
                    <SkeletonBox width="45px" height="12px" rounded-default />
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="flex flex-col gap-1 py-2 px-3.5">
                    <div class="flex items-center gap-1">
                      <div class="w-5 h-5 shrink-0" />
                      <div class="flex-1 h-6.5 rounded-default flex gap-0.5 items-stretch">
                        <div
                          v-for="n in 26"
                          :key="n"
                          class="flex-1 h-full rounded-default bg-border-default opacity-40"
                        />
                      </div>
                      <div class="w-5 h-5 shrink-0" />
                    </div>
                    <div class="flex justify-between">
                      <SkeletonBox width="60px" height="10px" rounded-default />
                      <SkeletonBox width="80px" height="10px" rounded-default />
                      <SkeletonBox width="60px" height="10px" rounded-default />
                    </div>
                  </div>
                </div>
              </div>
            </template>
            <!-- Status Timeline — runs query error state -->
            <template v-else-if="runsError">
              <div class="px-page-edge">
                <div
                  class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-3.5 pt-2.5 pb-2"
                  >
                    <span class="font-bold text-sm text-text-heading">{{ t('synthetics.runs.statusTimeline') }}</span>
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="flex items-center justify-center py-6 text-xs text-status-error-text">
                    <span class="flex items-center gap-1">
                      <OIcon name="error" size="xs" />
                      {{ runsError }}
                    </span>
                  </div>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="px-page-edge">
              <MonitorStatusTimeline
                :segments="timelineSegments"
                :fail-count="timelineFailCount"
                :pass-count="timelinePassCount"
                :mixed-count="timelineMixedCount"
                :start-label="timelineStartLabel"
                :end-label="timelineEndLabel"
              />
              </div>
            </template>

            <!-- KPI Cards — gated on KPI + last-run queries -->
            <template v-if="kpiLoading || !kpiHasLoadedOnce">
              <div class="px-page-edge">
                <div class="grid grid-cols-5 gap-2.5">
                  <div
                    v-for="n in 5"
                    :key="n"
                    class="card-container rounded-default flex flex-col px-3.5 pt-2.5 pb-2.5 gap-2 bg-surface-base border border-border-default"
                  >
                    <SkeletonBox width="60%" height="11px" rounded-default />
                    <SkeletonBox width="55%" height="22px" rounded-default />
                  </div>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="px-page-edge">
              <div class="grid grid-cols-5 gap-2.5">
                <div
                  v-for="card in kpiCards"
                  :key="card.key"
                  class="card-container rounded-default flex flex-col px-2 pt-2.5 pb-2.5 gap-1 bg-surface-base border border-border-default transition-shadow duration-200 hover:shadow-[0_1px_6px_rgba(0,0,0,0.08)]"
                  :data-test="`monitor-runs-kpi-${card.key}`"
                >
                  <div class="flex flex-col gap-1">
                    <div
                      class="kpi-label text-2xs font-semibold text-text-muted"
                    >
                      {{ card.label }}
                      <span v-if="card.unit"> ({{ card.unit }}) </span>
                    </div>
                    <div class="flex items-baseline gap-[0.2rem]">
                      <!-- Per-card error indicator -->
                      <template v-if="kpiError">
                        <span class="flex items-center gap-1 text-xs text-status-error-text">
                          <OIcon name="error" size="xs" class="shrink-0" />
                          {{ kpiError }}
                        </span>
                      </template>
                      <template v-else>
                        <span
                          class="text-xl font-bold leading-none text-[var(--color-text-heading)]"
                          :class="card.valueClass"
                        >
                          {{ card.value }}
                        </span>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </template>

            <!-- Charts — gated on histogram query -->
            <template v-if="histogramLoading || !histogramHasLoadedOnce">
              <div class="px-page-edge">
              <div class="grid grid-cols-2 gap-2">
                <div
                  class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-2 pt-2.5 pb-2"
                  >
                    <SkeletonBox width="110px" height="14px" rounded-default />
                    <span class="flex-1" />
                    <SkeletonBox width="80px" height="20px" rounded-default />
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="p-4">
                    <SkeletonBox width="100%" height="160px" rounded-default />
                  </div>
                </div>
                <div
                  class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-2 pt-2.5 pb-2"
                  >
                    <SkeletonBox width="120px" height="14px" rounded-default />
                    <span class="flex-1" />
                    <SkeletonBox width="90px" height="20px" rounded-default />
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="p-4">
                    <SkeletonBox width="100%" height="160px" rounded-default />
                  </div>
                </div>
              </div>
              </div>
            </template>
            <template v-else>
              <div class="px-page-edge">
              <div class="grid grid-cols-2 gap-2">
                <div
                  class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-2 pt-2.5 pb-2"
                  >
                    <span class="font-bold text-sm text-text-heading">
                      {{ t('synthetics.results.responseTime') }}
                    </span>
                    <span class="flex-1" />
                    <OBadge v-if="!histogramError" variant="default" size="sm">
                      p95 {{ p95Label }}
                    </OBadge>
                    <span
                      v-else
                      class="inline-flex items-center gap-1 text-xs text-status-error-text"
                    >
                      <OIcon name="error_outline" size="xs" />
                      {{ t('synthetics.results.error') }}
                    </span>
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="min-h-45 p-0">
                    <ChartRenderer
                      v-if="!histogramError"
                      :data="{ options: responseChartOption }"
                      height="180px"
                    />
                    <div v-else class="flex flex-col items-center justify-center h-45 gap-1 text-sm text-text-secondary">
                      <OIcon name="error_outline" size="sm" class="text-status-error-text" />
                      <span>{{ histogramError }}</span>
                    </div>
                  </div>
                </div>
                <div
                  class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-2 pt-2.5 pb-2"
                  >
                    <span class="font-bold text-sm text-text-heading">
                      {{ t('synthetics.runs.errorsOverTime') }}
                    </span>
                    <span class="flex-1" />
                    <OBadge v-if="!histogramError" variant="error" size="sm">
                      {{ t('synthetics.runs.failedCount', { count: failCount }) }}
                    </OBadge>
                    <span
                      v-else
                      class="inline-flex items-center gap-1 text-xs text-status-error-text"
                    >
                      <OIcon name="error_outline" size="xs" />
                      {{ t('synthetics.results.error') }}
                    </span>
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="min-h-45 p-0">
                    <ChartRenderer
                      v-if="!histogramError"
                      :data="{ options: errorChartOption }"
                      height="180px"
                    />
                    <div v-else class="flex flex-col items-center justify-center h-45 gap-1 text-sm text-text-secondary">
                      <OIcon name="error_outline" size="sm" class="text-status-error-text" />
                      <span>{{ histogramError }}</span>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </template>

            <!-- Breakdown Cards — gated on runs query -->
            <template v-if="runsLoading || !runsHasLoadedOnce">
              <div class="px-page-edge">
              <div class="grid grid-cols-3 gap-2">
                <div
                  v-for="n in 3"
                  :key="n"
                  class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-2 pt-2.5 pb-2"
                  >
                    <SkeletonBox
                      width="16px"
                      height="16px"
                      :custom-radius="'4px'"
                    />
                    <SkeletonBox width="110px" height="14px" rounded-default />
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="px-2 py-2 flex flex-col">
                    <div
                      v-for="row in 3"
                      :key="row"
                      class="flex items-center gap-3 py-2.25 border-b border-border-default last:border-b-0"
                    >
                      <SkeletonBox
                        width="16px"
                        height="16px"
                        :custom-radius="'4px'"
                      />
                      <SkeletonBox width="70px" height="12px" rounded-default />
                      <div
                        class="flex-1 h-1.5 rounded-full bg-border-default opacity-30"
                      />
                      <SkeletonBox width="36px" height="12px" rounded-default />
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </template>
            <!-- Breakdown Cards — runs query error state -->
            <template v-else-if="runsError">
              <div class="px-page-edge">
              <div class="grid grid-cols-3 gap-2">
                <div
                  v-for="dim in ['Browser','Location','Device']"
                  :key="dim"
                  class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-2 pt-2.5 pb-2"
                  >
                    <span class="font-bold text-sm text-text-heading">
                      {{ dim === 'Browser' ? t('synthetics.runs.passRateByBrowser') : dim === 'Location' ? t('synthetics.runs.passRateByLocation') : t('synthetics.runs.passRateByDevice') }}
                    </span>
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="flex items-center justify-center py-8 text-xs text-status-error-text">
                    <span class="flex items-center gap-1">
                      <OIcon name="error" size="xs" />
                      {{ runsError }}
                    </span>
                  </div>
                </div>
              </div>
              </div>
            </template>
            <template v-else>
              <div class="px-page-edge">
              <div class="grid grid-cols-3 gap-2">
                <div
                  class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-2 pt-2.5 pb-2"
                  >
                    <OIcon name="language" size="sm" class="text-accent" />
                    <span class="font-bold text-sm text-text-heading">
                      {{ t('synthetics.runs.passRateByBrowser') }}
                    </span>
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="px-2 py-2">
                    <div
                      v-for="b in browserBreakdown"
                      :key="b.name"
                      class="flex items-center gap-3 py-2.25 border-b border-border-default last:border-b-0"
                    >
                      <OIcon
                        :name="b.icon"
                        size="sm"
                        class="text-text-secondary flex-none"
                      />
                      <span
                        class="w-20 flex-none font-semibold text-xs text-text-body"
                      >
                        {{ b.name }}
                      </span>
                      <div
                        class="flex-1 h-1.5 rounded-full bg-text-disabled/25! overflow-hidden min-w-10"
                      >
                        <!-- :style for dynamic bar width + computed color — inline required for per-breakdown values -->
                        <div
                          class="h-full rounded-full"
                          :style="{ width: b.pct, background: b.barColor }"
                        />
                      </div>
                      <span
                        class="font-mono tabular-nums font-bold text-xs w-12 text-right"
                        :style="{ color: b.textColor }"
                      >
                        {{ b.pct }}
                      </span>
                    </div>
                  </div>
                </div>
                <div
                  class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-2 pt-2.5 pb-2"
                  >
                    <OIcon
                      name="location-on"
                      size="sm"
                      class="text-accent"
                    />
                    <span class="font-bold text-sm text-text-heading">
                      {{ t('synthetics.runs.passRateByLocation') }}
                    </span>
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="px-2 py-2">
                    <div
                      v-for="l in locationBreakdown"
                      :key="l.name"
                      class="flex items-center gap-3 py-2.25 border-b border-border-default last:border-b-0"
                    >
                      <OIcon
                        :name="l.icon"
                        size="sm"
                        class="text-text-secondary flex-none"
                      />
                      <span
                        class="w-27.5 flex-none font-semibold text-xs text-text-body"
                      >
                        {{ l.name }}
                      </span>
                      <div
                        class="flex-1 h-1.5 rounded-full bg-text-disabled/25! overflow-hidden min-w-10"
                      >
                        <div
                          class="h-full rounded-full"
                          :style="{ width: l.pct, background: l.barColor }"
                        />
                      </div>
                      <span
                        class="font-mono tabular-nums font-bold text-xs w-12 text-right"
                        :style="{ color: l.textColor }"
                      >
                        {{ l.pct }}
                      </span>
                    </div>
                  </div>
                </div>
                <div
                  class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-2 pt-2.5 pb-2"
                  >
                    <OIcon name="devices" size="sm" class="text-accent" />
                    <span class="font-bold text-sm text-text-heading">
                      {{ t('synthetics.runs.passRateByDevice') }}
                    </span>
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="px-2 py-2">
                    <div
                      v-for="d in deviceBreakdown"
                      :key="d.name"
                      class="flex items-center gap-3 py-2.25 border-b border-border-default last:border-b-0"
                    >
                      <OIcon
                        :name="d.icon"
                        size="sm"
                        class="text-text-secondary flex-none"
                      />
                      <span
                        class="w-20 flex-none font-semibold text-xs text-text-body"
                      >
                        {{ d.name }}
                      </span>
                      <div
                        class="flex-1 h-1.5 rounded-full bg-text-disabled/25! overflow-hidden min-w-10"
                      >
                        <div
                          class="h-full rounded-full"
                          :style="{ width: d.pct, background: d.barColor }"
                        />
                      </div>
                      <span
                        class="font-mono tabular-nums font-bold text-xs w-12 text-right"
                        :style="{ color: d.textColor }"
                      >
                        {{ d.pct }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </template>

            <!-- Filter bar -->
            <div class="flex items-center gap-2 flex-wrap px-2">
              <OToggleGroup v-model="statusFilter" variant="default">
                <OToggleGroupItem
                  v-for="so in statusOptions"
                  :key="so.key"
                  :value="so.key"
                  size="sm"
                >
                  <template #icon-left>
                    <span
                      class="w-[0.4375rem] h-[0.4375rem] rounded-full"
                      :style="{ background: so.dot }"
                    />
                  </template>
                  {{ so.label }}
                </OToggleGroupItem>
              </OToggleGroup>

              <OSelect
                v-model="browserFilter"
                :options="browserOptions"
                icon-key="icon"
                size="md"
                class="w-35!"
                data-test="monitor-runs-filter-browser"
              />
              <OSelect
                v-model="deviceFilter"
                :options="deviceOptions"
                icon-key="icon"
                size="md"
                class="w-35!"
                data-test="monitor-runs-filter-device"
              />
              <OSelect
                v-model="locationFilter"
                :options="locationOptions"
                icon-key="icon"
                size="md"
                class="w-35!"
                data-test="monitor-runs-filter-location"
              />

              <!-- Failure-specific filters -->
              <template v-if="statusFilter === 'fail' && false">
                <OSeparator orientation="vertical" class="h-5" />
                <OSelect
                  v-model="failedStepFilter"
                  :options="failedStepOptions"
                  size="sm"
                  class="w-40"
                  data-test="monitor-runs-filter-step"
                />
                <OInput
                  v-model="locatorFilter"
                  size="sm"
                  :placeholder="t('synthetics.runs.locatorPlaceholder')"
                  class="w-42.5"
                  data-test="monitor-runs-filter-locator"
                />
                <OSelect
                  v-model="actionFilter"
                  :options="actionOptions"
                  size="sm"
                  class="w-32.5"
                  data-test="monitor-runs-filter-action"
                />
              </template>

              <span class="flex-1" />
              <span class="text-xs text-text-secondary">
                {{ t('synthetics.runs.filterCount', { current: filteredRuns.length, total: allRuns.length }) }}
              </span>
            </div>

            <!-- Error filter indicator -->
            <div
              v-if="errorFilter"
              class="flex items-center gap-2 px-2"
              data-test="monitor-runs-error-filter-badge"
            >
              <span class="text-xs text-text-secondary"
                >{{ t('synthetics.runs.filteringByErrorLabel') }}</span
              >
              <OBadge variant="error" size="sm" class="gap-1">
                {{ errorFilter }}
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  class="text-inherit"
                  data-test="synthetics-monitor-runs-clear-error-filter-btn"
                  @click.stop="clearErrorFilter"
                >
                  <OIcon name="close" size="xs" />
                </OButton>
              </OBadge>
            </div>

            <!-- Runs table -->
            <OCard class="p-0" :key="tableFilterKey">
              <OTable
                :columns="runColumns"
                :data="visibleRuns"
                :loading="runsLoading"
                pagination="client"
                :page-size="10"
                :page-size-options="[10, 20, 25, 50]"
                row-key="id"
                :show-global-filter="false"
                :enable-column-resize="true"
                :enable-column-reorder="true"
                data-test="monitor-runs-runs-table"
                @row-click="openRun"
              >
                <template #cell-status="{ row }">
                  <OBadge
                    :variant="(row as VisibleRun).statusBadgeVariant"
                    size="sm"
                    dot
                  >
                    {{ (row as VisibleRun).statusLabel }}
                  </OBadge>
                </template>
                <template #cell-scheduled_at="{ row }">
                  <OTimeCell
                    :value="(row as VisibleRun).scheduledTs"
                    unit="ms"
                    mode="absolute"
                    empty-label="—"
                  />
                </template>
                <template #cell-last_run_at="{ row }">
                  <OTimeCell
                    :value="(row as VisibleRun).lastRunTs"
                    unit="ms"
                    mode="absolute"
                    empty-label="—"
                  />
                </template>
                <template #cell-duration="{ row }">
                  <span class="tabular-nums text-sm">
                    {{ (row as VisibleRun).duration }}
                  </span>
                </template>
                <template #cell-location="{ row }">
                  <span
                    class="inline-flex items-center gap-1 text-sm text-text-body"
                  >
                    <OIcon
                      :name="locationIcon((row as VisibleRun).location)"
                      size="sm"
                    />
                    {{ (row as VisibleRun).location }}
                  </span>
                </template>
                <template #cell-browser="{ row }">
                  <span
                    class="inline-flex items-center gap-1 text-sm text-text-body"
                  >
                    <OIcon
                      :name="browserIcon((row as VisibleRun).browser)"
                      size="sm"
                    />
                    {{ (row as VisibleRun).browser }}
                  </span>
                </template>
                <template #cell-device="{ row }">
                  <span
                    class="inline-flex items-center gap-1 text-sm text-text-body"
                  >
                    <OIcon
                      :name="deviceIconName((row as VisibleRun).device)"
                      size="sm"
                    />
                    {{ deviceLabel((row as VisibleRun).device) }}
                  </span>
                </template>
                <template #cell-error="{ row }">
                  <span
                    v-if="(row as VisibleRun).errorSnippet"
                    class="cursor-pointer"
                    @click.stop="
                      filterByError((row as VisibleRun).errorPattern)
                    "
                  >
                    <OBadge
                      variant="error-outline"
                      size="sm"
                      class="truncate max-w-50"
                    >
                      {{ (row as VisibleRun).errorSnippet }}
                    </OBadge>
                  </span>
                </template>
                <template #cell-trigger_type="{ row }">
                  <span class="text-sm text-text-body">
                    {{ (row as VisibleRun).triggerType }}
                  </span>
                </template>

                <!-- Empty state: smart — differentiates "never run" vs "no runs in window" -->
                <template #empty>
                  <div v-if="kpiHasLoadedOnce" class="px-page-edge">
                    <!-- Monitor has runs elsewhere — guide to last run + optionally clear filters -->
                    <OEmptyState
                      v-if="synthetics.kpi.value.totalRuns > 0"
                      size="block"
                      illustration="no-results"
                      :title="t('synthetics.results.noRunsInWindow')"
                      :description="t('synthetics.results.noRunsInWindowDesc')"
                      data-test="monitor-runs-empty"
                    >
                      <template #actions>
                        <EmptyStateActionCard
                          icon="schedule"
                          :label="t('synthetics.results.jumpToLastRun')"
                          :sublabel="lastRunLabel"
                          data-test="monitor-runs-empty-jump-last-run"
                          @click="handleEmptyStateAction('jump-to-last-run')"
                        />
                        <EmptyStateActionCard
                          v-if="hasActiveFilters"
                          icon="filter-list"
                          :label="t('synthetics.results.clearFilters')"
                          :sublabel="t('synthetics.results.clearFiltersDesc')"
                          data-test="monitor-runs-empty-clear-filters"
                          @click="handleEmptyStateAction('clear-filters')"
                        />
                      </template>
                    </OEmptyState>

                    <!-- Monitor has never been run — prompt to trigger -->
                    <OEmptyState
                      v-else
                      size="block"
                      illustration="browser-check"
                      :title="t('synthetics.results.noRunsYet')"
                      :description="t('synthetics.results.noRunsYetDesc')"
                      data-test="monitor-runs-empty"
                    >
                      <template #actions>
                        <EmptyStateActionCard
                          icon="play-arrow"
                          :label="t('synthetics.results.triggerRunNow')"
                          :sublabel="t('synthetics.results.triggerRunNowDesc')"
                          data-test="monitor-runs-empty-trigger-run"
                          @click="handleEmptyStateAction('trigger-run')"
                        />
                      </template>
                    </OEmptyState>
                  </div>
                </template>
              </OTable>
            </OCard>

          </div>
        </OTabPanel>

        <!-- ════════════ STEPS ════════════ -->
        <!-- ════════════ STEPS ════════════ -->
        <OTabPanel name="steps">
          <div
            class="mx-auto flex flex-col gap-2"
          >
            <!-- Loading skeleton -->
            <template v-if="stepsLoading || !stepsHasLoadedOnce">
              <div class="grid grid-cols-2 gap-2">
                <div class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden">
                  <div class="flex items-center gap-2 px-2 pt-2.5 pb-2">
                    <SkeletonBox width="100px" height="14px" rounded-default />
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="p-4"><SkeletonBox width="100%" height="160px" rounded-default /></div>
                </div>
                <div class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden">
                  <div class="flex items-center gap-2 px-2 pt-2.5 pb-2">
                    <SkeletonBox width="100px" height="14px" rounded-default />
                  </div>
                  <div class="border-t border-border-default" />
                  <div class="p-4"><SkeletonBox width="100%" height="160px" rounded-default /></div>
                </div>
              </div>
              <div v-for="n in 5" :key="n" class="card-container rounded-default overflow-hidden">
                <div class="h-10 bg-[var(--color-border-default)] opacity-20" />
              </div>
            </template>

            <!-- Steps query error — compact inline indicator -->
            <template v-else-if="stepsError">
              <div
                class="px-2 flex items-center gap-2"
                data-test="monitor-runs-steps-error"
              >
                <OIcon name="error_outline" size="xs" class="text-status-error-text shrink-0" />
                <span class="text-xs text-status-error-text truncate flex-1 min-w-0">{{ stepsError }}</span>
                <OButton
                  variant="ghost"
                  size="xs"
                  class="underline! text-xs!"
                  data-test="monitor-runs-steps-retry-btn"
                  @click="emit('refresh')"
                >
                  {{ t('synthetics.journey.retry') }}
                </OButton>
              </div>
            </template>

            <!-- Real content -->
            <template v-else>
              <!-- Steps Analysis Table -->
              <OCard class="p-0">
                <OTable
                  :data="stepTableRows"
                  :columns="stepTableColumns"
                  row-key="id"
                  :pagination="'none'"
                  :sorting="'client'"
                  :show-global-filter="false"
                  :show-header="true"
                  :dense="true"
                  :bordered="true"
                  :enable-column-resize="true"
                  :enable-column-reorder="true"
                  :fill-height="false"
                >
                  <!-- cell-name: Step name -->
                  <template #cell-name="{ row }">
                    <div class="min-w-0">
                      <div class="font-semibold text-xs text-[var(--color-text-heading)] truncate">
                        {{ row.name }}
                      </div>
                    </div>
                  </template>

                  <!-- cell-failRate: Colored percentage + bar -->
                  <template #cell-failRate="{ row }">
                    <div class="flex flex-col gap-1">
                      <span class="font-mono tabular-nums font-bold text-xs" :style="{ color: row.failColor }">
                        {{ row.failRatePct }}%&ensp;<span class="font-normal text-[var(--color-text-muted)]">{{ row.failCount }}</span>
                      </span>
                      <div class="h-1.25 rounded-full bg-[var(--color-text-disabled)]/25! overflow-hidden">
                        <div class="h-full rounded-full" :style="{ width: row.failRateBarPct, background: row.failBarColor }" />
                      </div>
                    </div>
                  </template>

                  <!-- cell-flakyRate: Colored percentage -->
                  <template #cell-flakyRate="{ row }">
                    <span class="font-mono tabular-nums text-xs" :style="{ color: row.flakyColor }">
                      {{ row.flakyRatePct }}%&ensp;<span class="font-normal text-[var(--color-text-muted)]">{{ row.flakyCount }}</span>
                    </span>
                  </template>

                  <!-- cell-avgDuration: Duration + bar -->
                  <template #cell-avgDuration="{ row }">
                    <div class="flex flex-col gap-1">
                      <span class="font-mono tabular-nums text-xs text-[var(--color-text-body)]">{{ row.avgDuration }}</span>
                      <div class="h-1.25 rounded-full bg-[var(--color-text-disabled)]/25! overflow-hidden">
                        <div class="h-full rounded-full bg-[var(--color-primary-400)]" :style="{ width: row.durationBarPct }" />
                      </div>
                    </div>
                  </template>

                  <!-- cell-p95Duration: Duration + bar -->
                  <template #cell-p95Duration="{ row }">
                    <div class="flex flex-col gap-1">
                      <span class="font-mono tabular-nums text-xs text-[var(--color-text-body)]">{{ row.p95Duration }}</span>
                      <div class="h-1.25 rounded-full bg-[var(--color-text-disabled)]/25! overflow-hidden">
                        <div class="h-full rounded-full bg-[var(--color-primary-400)]" :style="{ width: row.p95DurationBarPct }" />
                      </div>
                    </div>
                  </template>

                  <!-- cell-maxDuration: Duration + bar -->
                  <template #cell-maxDuration="{ row }">
                    <div class="flex flex-col gap-1">
                      <span class="font-mono tabular-nums text-xs text-[var(--color-text-body)]">{{ row.maxDuration }}</span>
                      <div class="h-1.25 rounded-full bg-[var(--color-text-disabled)]/25! overflow-hidden">
                        <div class="h-full rounded-full bg-[var(--color-primary-400)]" :style="{ width: row.maxDurationBarPct }" />
                      </div>
                    </div>
                  </template>

                  <!-- Empty -->
                  <template #empty>
                    <div class="flex items-center justify-center py-12 text-sm text-[var(--color-text-secondary)]">
                      {{ t('synthetics.runs.noStepData') }}
                    </div>
                  </template>
                </OTable>
              </OCard>

            </template>
          </div>
        </OTabPanel>

        <!-- ════════════ ERRORS ════════════ -->
        <OTabPanel name="errors">
          <div
            class="mx-auto px-2 py-2 pb-7 flex flex-col gap-2"
          >
            <div class="flex items-center gap-2.5">
              <span class="font-bold text-sm text-text-heading">
                {{ t('synthetics.runs.errorPatterns') }}
              </span>
              <span class="text-xs text-text-secondary">
                {{ t('synthetics.runs.errorPatternsWindowDesc', { window: windowLabel }) }}
              </span>
            </div>

            <OCard class="p-0">
              <div
                class="grid grid-cols-[1fr_100px_160px_32px] gap-2.5 px-4 py-2 bg-surface-subtle border-b border-border-default text-2xs font-semibold text-text-secondary uppercase tracking-wide"
              >
                <span>{{ t('synthetics.runs.errorPattern') }}</span>
                <span>{{ t('synthetics.runs.count') }}</span>
                <span>{{ t('synthetics.runs.lastSeen') }}</span>
                <span />
              </div>
              <div
                v-for="e in errorGroups"
                :key="e.pattern"
                class="grid grid-cols-[1fr_100px_160px_32px] gap-2.5 px-4 py-2.75 border-b border-border-default items-center cursor-pointer hover:bg-surface-subtle"
                data-test="monitor-runs-error-row"
                @click="filterByErrorPattern(e.pattern)"
              >
                <span
                  class="font-mono tabular-nums text-xs text-text-body truncate"
                >
                  {{ e.pattern }}
                </span>
                <span class="font-bold text-sm text-status-error-text">
                  {{ e.count }}
                </span>
                <span class="text-xs text-text-secondary">
                  {{ e.lastSeen }}
                </span>
                <OIcon
                  name="filter_alt"
                  size="sm"
                  class="text-text-secondary"
                />
              </div>
            </OCard>
          </div>
        </OTabPanel>
      </OTabPanels>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OInput from "@/lib/forms/Input/OInput.vue";
import MonitorStatusTimeline from "@/views/synthetics/MonitorStatusTimeline.vue";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import useSyntheticResults from "@/composables/useSyntheticResults";
import type { SyntheticRun } from "@/composables/synthetics/syntheticResultsSchema";
import {
  deviceIconName,
  deviceLabel,
} from "@/composables/synthetics/syntheticResultsSchema";
import awsSvgUrl from "@/assets/images/ingestion/aws.svg";
import gcpSvgUrl from "@/assets/images/ingestion/gcp.svg";
import chromiumSvgUrl from "@/assets/images/synthetics/chromium.svg";
import firefoxSvgUrl from "@/assets/images/synthetics/firefox.svg";
import webkitSvgUrl from "@/assets/images/synthetics/webkit.svg";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";
import syntheticsService from "@/services/synthetics";
import { toast } from "@/lib/feedback/Toast/useToast";

defineOptions({ name: "SyntheticMonitorRuns" });

const { t } = useI18n();

const emit = defineEmits<{
  (e: "edit"): void;
  (e: "open-run", runId: string, executionId: string): void;
  (e: "refresh"): void;
  (e: "jump-to-window", startTime: number, endTime: number): void;
}>();

const store = useStore();
const orgIdentifier = computed(() => (store.state as any).selectedOrganization?.identifier ?? "");

// ── Props ────────────────────────────────────────────────────────────────
interface Props {
  monitorId: string;
  monitorName: string;
  monitorStatus?: "healthy" | "degraded" | "critical";
}
const props = withDefaults(defineProps<Props>(), {
  monitorStatus: "healthy",
});

// ── Synthetic results composable ──────────────────────────────────────────
const synthetics = useSyntheticResults();
const kpiLoading = computed(() => synthetics.kpiLoading.value);
const histogramLoading = computed(() => synthetics.histogramLoading.value);
const runsLoading = computed(() => synthetics.runsLoading.value);
const kpiHasLoadedOnce = computed(() => synthetics.kpiHasLoadedOnce.value);
const histogramHasLoadedOnce = computed(() => synthetics.histogramHasLoadedOnce.value);
const runsHasLoadedOnce = computed(() => synthetics.runsHasLoadedOnce.value);
const stepsLoading = computed(() => synthetics.stepsLoading.value);
const stepsHasLoadedOnce = computed(() => synthetics.stepsHasLoadedOnce.value);
const kpiError = computed(() => synthetics.kpiError.value);
const histogramError = computed(() => synthetics.histogramError.value);
const runsError = computed(() => synthetics.runsError.value);
const stepsError = computed(() => synthetics.stepsError.value);
const effectiveP95Ms = computed(() => synthetics.effectiveP95Ms.value);

// ── Helpers ──────────────────────────────────────────────────────────────
function fmtDur(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms";
}

function browserIcon(name: string): string {
  switch (name) {
    case "Chromium":
      return "img:" + chromiumSvgUrl;
    case "Firefox":
      return "img:" + firefoxSvgUrl;
    case "WebKit":
      return "img:" + webkitSvgUrl;
    default:
      return "open-in-browser";
  }
}
function locationIcon(region: string): string {
  const prefix = region.split("-")[0].toLowerCase();
  if (prefix === "aws") return "img:" + awsSvgUrl;
  if (prefix === "gcp") return "img:" + gcpSvgUrl;
  if (/^[a-z]{2}-[a-z]+-\d+$/.test(region)) return "img:" + awsSvgUrl;
  if (/^[a-z]+-[a-z]+\d*$/.test(region)) return "img:" + gcpSvgUrl;
  return "location-on";
}

// ── State ────────────────────────────────────────────────────────────────
const activeTab = ref("overview");

// ── Seeded random (for fallback mock data in charts/timeline) ────────────
function seedRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** Time range from the parent (microseconds). Updated on each refresh call. */
const timeRangeMicros = ref<{ startTime: number; endTime: number } | null>(
  null,
);

/** Human-readable window label derived from the time range duration. */
function formatWindowLabel(startMicros: number, endMicros: number): string {
  const diffMs = (endMicros - startMicros) / 1000;
  const hours = Math.round(diffMs / 3600000);
  if (hours >= 48) return t('synthetics.runs.windowDays', { days: Math.round(hours / 24) });
  if (hours >= 24) return t('synthetics.runs.window24h');
  if (hours >= 2) return t('synthetics.runs.windowHours', { hours });
  const minutes = Math.round(diffMs / 60000);
  if (minutes >= 60) return t('synthetics.runs.window1h');
  return t('synthetics.runs.windowMinutes', { minutes });
}
const windowLabel = computed(() =>
  timeRangeMicros.value
    ? formatWindowLabel(
        timeRangeMicros.value.startTime,
        timeRangeMicros.value.endTime,
      )
    : t('synthetics.runs.window24h'),
);
const statusFilter = ref("all");
const browserFilter = ref("all");
const deviceFilter = ref("all");
const locationFilter = ref("all");
const durationFilter = ref("all");
const failedStepFilter = ref("all");
const locatorFilter = ref("");
const actionFilter = ref("all");
const errorFilter = ref<string | null>(null);

// ── Smart empty state helpers ──────────────────────────────────────────
const hasActiveFilters = computed(
  () =>
    statusFilter.value !== "all" ||
    browserFilter.value !== "all" ||
    deviceFilter.value !== "all" ||
    locationFilter.value !== "all" ||
    errorFilter.value !== null,
);

const lastRunLabel = computed(() => {
  const ts = synthetics.kpi.value.lastRunAt;
  if (!ts) return "";
  return new Date(ts).toLocaleString();
});

const runTriggerLoading = ref(false);

async function handleEmptyStateAction(id: string) {
  if (id === "jump-to-last-run") {
    const lastRunAt = synthetics.kpi.value.lastRunAt;
    if (!lastRunAt) return;
    const HALF_HOUR_US = 30 * 60 * 1000 * 1000;
    const startTime = lastRunAt * 1000 - HALF_HOUR_US;
    const endTime = lastRunAt * 1000 + HALF_HOUR_US;
    emit("jump-to-window", startTime, endTime);
    return;
  }

  if (id === "clear-filters") {
    resetFilters();
    return;
  }

  if (id === "trigger-run") {
    if (runTriggerLoading.value) return;
    runTriggerLoading.value = true;
    const dismiss = toast({
      variant: "loading",
      message: t('synthetics.toast.triggeringSingle', { name: props.monitorName }),
      timeout: 0,
    });
    try {
      await syntheticsService.run(orgIdentifier.value, props.monitorId, {});
      dismiss();
      toast({ variant: "success", message: t('synthetics.toast.triggerSuccessSingle', { name: props.monitorName }) });
      // Emit refresh so parent reloads data
      emit("refresh");
    } catch (err: any) {
      dismiss();
      toast({
        variant: "error",
        message: err?.response?.data?.message || t('synthetics.toast.triggerFailedSingle', { name: props.monitorName }),
      });
    } finally {
      runTriggerLoading.value = false;
    }
  }
}

// Composite key that changes when any filter changes — ensures the runs
// table fully re-renders with the filtered data.
const tableFilterKey = computed(
  () =>
    `${statusFilter.value}|${browserFilter.value}|${deviceFilter.value}|${locationFilter.value}|${errorFilter.value ?? ""}`,
);

// ── Select options (dynamic from run data) ──────────────────────────────
function uniqueValues(key: "browser" | "device" | "location"): string[] {
  const vals = new Set(allRuns.value.map((r) => r[key]).filter(Boolean));
  return Array.from(vals).sort();
}
const browserOptions = computed<SelectOption[]>(() => [
  { label: t('synthetics.filters.allBrowsers'), value: "all", icon: "language" },
  ...uniqueValues("browser").map((v) => ({
    label: v,
    value: v,
    icon: browserIcon(v),
  })),
]);
const deviceOptions = computed<SelectOption[]>(() => [
  { label: t('synthetics.filters.allDevices'), value: "all", icon: "devices" },
  ...uniqueValues("device").map((v) => ({
    label: deviceLabel(v),
    value: v,
    icon: deviceIconName(v),
  })),
]);
const locationOptions = computed<SelectOption[]>(() => [
  { label: t('synthetics.filters.allLocations'), value: "all", icon: "location-on" },
  ...uniqueValues("location").map((v) => ({
    label: v,
    value: v,
    icon: locationIcon(v),
  })),
]);
const durationOptions: SelectOption[] = [
  { label: t('synthetics.filters.anyDuration'), value: "all" },
  { label: t('synthetics.filters.durationFast'), value: "fast" },
  { label: t('synthetics.filters.durationMid'), value: "mid" },
  { label: t('synthetics.filters.durationSlow'), value: "slow" },
];
const actionOptions: SelectOption[] = [
  { label: t('synthetics.filters.anyAction'), value: "all" },
  { label: t('synthetics.filters.actionClick'), value: "click" },
  { label: t('synthetics.filters.actionType'), value: "type" },
];

// ── Helper: map SyntheticRun to MockRun shape used by computed properties ─
function toMockRun(r: SyntheticRun, idx: number): MockRun {
  const eng = r.browserEngine;
  const browser = eng ? eng.charAt(0).toUpperCase() + eng.slice(1) : eng;
  return {
    id: idx + 1,
    runId: r.runId || "unknown-" + idx,
    ageMin: Math.round((Date.now() - r.timestamp) / 60000),
    scheduledTs: r.scheduledTs,
    timestamp: r.timestamp,
    triggerType: r.triggerType,
    duration: r.durationMs,
    status: r.status === "passed" ? ("pass" as const) : ("fail" as const),
    location: r.location,
    browser,
    device: r.device,
    failedStep: null,
    locator: null,
    action: null,
    errorPattern: r.error || null,
    artifacts: { screenshot: true, replay: false, trace: true, rum: false },
  };
}

// ── Runs: use live data when available, fall back to mock data ──────────
const allRuns = computed<MockRun[]>(() => {
  if (runsHasLoadedOnce.value) {
    return synthetics.runs.value.map(toMockRun);
  }
  const tr = timeRangeMicros.value;
  if (tr) {
    return generateRuns({
      startTimeMs: tr.startTime / 1000,
      endTimeMs: tr.endTime / 1000,
    });
  }
  return generateRuns();
});

const filteredRuns = computed(() => {
  return allRuns.value.filter((run) => {
    const s = statusFilter.value;
    if (s !== "all" && run.status !== s) return false;
    if (browserFilter.value !== "all" && run.browser !== browserFilter.value)
      return false;
    if (deviceFilter.value !== "all" && run.device !== deviceFilter.value)
      return false;
    if (locationFilter.value !== "all" && run.location !== locationFilter.value)
      return false;
    if (durationFilter.value === "fast" && run.duration >= 5000) return false;
    if (
      durationFilter.value === "mid" &&
      (run.duration < 5000 || run.duration > 15000)
    )
      return false;
    if (durationFilter.value === "slow" && run.duration <= 15000) return false;
    if (s === "fail") {
      if (
        failedStepFilter.value !== "all" &&
        run.failedStep !== failedStepFilter.value
      )
        return false;
      if (
        locatorFilter.value &&
        !(run.locator || "")
          .toLowerCase()
          .includes(locatorFilter.value.toLowerCase())
      )
        return false;
      if (actionFilter.value !== "all" && run.action !== actionFilter.value)
        return false;
    }
    if (errorFilter.value && run.errorPattern !== errorFilter.value)
      return false;
    return true;
  });
});

const totalFails = computed(
  () => allRuns.value.filter((r) => r.status === "fail").length,
);

const hasKpiData = computed(() => synthetics.kpi.value.totalRuns > 0);

const p95Label = computed(() =>
  effectiveP95Ms.value > 0
    ? fmtDur(effectiveP95Ms.value)
    : hasKpiData.value ? fmtDur(0) : "—",
);
const p95Ms = computed(() => effectiveP95Ms.value);
const failCount = computed(() => String(synthetics.kpi.value.failedRuns));

interface KpiCard {
  key: string;
  label: string;
  value: string;
  unit?: string;
  valueClass?: string;
}
const kpiCards = computed<KpiCard[]>(() => {
  const k = synthetics.kpi.value;
  if (hasKpiData.value) {
    return [
      {
        key: "last-run",
        label: t('synthetics.results.lastRun'),
        value: k.lastRunStatus
          ? k.lastRunStatus === "failed"
            ? t('synthetics.results.failed')
            : t('synthetics.results.passed')
          : "—",
        valueClass:
          k.lastRunStatus === "failed"
            ? "text-status-error-text!"
            : "text-status-success-text!",
      },
      {
        key: "pass-rate",
        label: t('synthetics.runs.passRate'),
        value: k.totalRuns > 0 ? k.uptimePct.toFixed(1) + "%" : "—",
      },
      {
        key: "p95-duration",
        label: t('synthetics.results.p95Duration'),
        value: effectiveP95Ms.value > 0 ? fmtDur(effectiveP95Ms.value) : "—",
      },
      {
        key: "retry-rate",
        label: t('synthetics.runs.retryRate'),
        value:
          k.totalRuns > 0
            ? ((k.retriedRuns / k.totalRuns) * 100).toFixed(1) + "%"
            : "0.0%",
        valueClass: k.retriedRuns > 0 ? "text-text-body!" : undefined,
      },
      {
        key: "failed-runs",
        label: t('synthetics.results.failedRuns'),
        value: String(k.failedRuns),
        valueClass: k.failedRuns > 0 ? "text-status-error-text!" : undefined,
      },
    ];
  }
  // Fallback: derive from mock data
  const fallbackPassPct =
    allRuns.value.length > 0
      ? (
          (allRuns.value.filter((r) => r.status === "pass").length /
            allRuns.value.length) *
          100
        ).toFixed(1) + "%"
      : "100%";
  const lastRun = allRuns.value[0];
  return [
    { key: "pass-rate", label: t('synthetics.runs.passRate'), value: fallbackPassPct },
    { key: "p95-duration", label: t('synthetics.results.p95Duration'), value: "—" },
    { key: "retry-rate", label: t('synthetics.runs.retryRate'), value: "0.0%" },
    {
      key: "failed-runs",
      label: t('synthetics.results.failedRuns'),
      value: String(totalFails.value),
    },
    {
      key: "last-run",
      label: t('synthetics.results.lastRun'),
      value: lastRun?.status === "fail" ? t('synthetics.results.failed') : t('synthetics.results.passed'),
      valueClass:
        lastRun?.status === "fail"
          ? "text-status-error-text!"
          : "text-status-success-text!",
    },
  ];
});

// ── Timeline view model types ────────────────────────────────────────────
interface TimelineExecution {
  location: string;
  browserEngine: string;
  device: string;
  status: "pass" | "fail";
  statusIcon: string;
  errorSnippet: string | null;
}

interface TimelineSegment {
  runId: string;
  status: "all-pass" | "mixed" | "all-fail";
  color: string;
  title: string;
  /** Epoch ms of the first execution in this logical run. */
  timestampMs: number;
  executions: TimelineExecution[];
}

// ── Status timeline ──────────────────────────────────────────────────────
const timelineSegments = computed<TimelineSegment[]>(() => {
  const runs = allRuns.value;
  if (runs.length === 0) return [];

  // Group by runId — preserves insertion order (most recent run first)
  const groupMap = new Map<string, MockRun[]>();
  const groupOrder: string[] = [];
  for (const run of runs) {
    if (!run.runId) continue;
    const existing = groupMap.get(run.runId);
    if (existing) {
      existing.push(run);
    } else {
      groupMap.set(run.runId, [run]);
      groupOrder.push(run.runId);
    }
  }

  return groupOrder.map((runId) => {
    const executions = groupMap.get(runId)!;
    const allPass = executions.every((e) => e.status === "pass");
    const allFail = executions.every((e) => e.status === "fail");
    const status: TimelineSegment["status"] = allPass
      ? "all-pass"
      : allFail
        ? "all-fail"
        : "mixed";

    const color =
      status === "all-pass"
        ? "bg-badge-success-solid-bg/80"
        : status === "all-fail"
          ? "bg-badge-error-solid-bg/80"
          : "bg-badge-orange-solid-bg/80";

    const passCount = executions.filter((e) => e.status === "pass").length;
    const failCount = executions.length - passCount;
    const title =
      status === "all-pass"
        ? t('synthetics.runs.timelineAllPassed', { count: executions.length })
        : status === "all-fail"
          ? t('synthetics.runs.timelineAllFailed', { count: executions.length })
          : t('synthetics.runs.timelineMixed', { passed: passCount, failed: failCount, total: executions.length });

    const execDetails: TimelineExecution[] = executions.map((e) => ({
      location: e.location,
      browserEngine: e.browser,
      device: e.device,
      status: e.status === "pass" ? "pass" : "fail",
      statusIcon: e.status === "pass" ? "check_circle" : "cancel",
      errorSnippet: e.errorPattern
        ? e.errorPattern.split(":")[0].substring(0, 50)
        : null,
    }));

    return {
      runId,
      status,
      color,
      title,
      timestampMs: executions[0]?.scheduledTs || 0,
      executions: execDetails,
    };
  });
});

const timelineFailCount = computed(() =>
  String(timelineSegments.value.filter((s) => s.status === "all-fail").length),
);
const timelinePassCount = computed(() =>
  String(timelineSegments.value.filter((s) => s.status === "all-pass").length),
);
const timelineMixedCount = computed(() =>
  String(timelineSegments.value.filter((s) => s.status === "mixed").length),
);

function formatTimelineDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  if (d.getFullYear() !== now.getFullYear()) {
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...opts,
    });
  }
  if (d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate()) {
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      ...opts,
    });
  }
  return d.toLocaleTimeString("en-US", opts);
}

const timelineStartLabel = computed(() => {
  if (!timeRangeMicros.value) return "";
  return formatTimelineDate(timeRangeMicros.value.startTime / 1000);
});
const timelineEndLabel = computed(() => {
  if (!timeRangeMicros.value) return t('synthetics.runs.timelineNow');
  return formatTimelineDate(timeRangeMicros.value.endTime / 1000);
});

// ── Breakdowns ───────────────────────────────────────────────────────────
interface BreakdownItem {
  name: string;
  icon?: string;
  pct: string;
  barColor: string;
  textColor: string;
}
const browserBreakdown = computed<BreakdownItem[]>(() => {
  const groups = new Map<string, { pass: number; total: number }>();
  for (const run of allRuns.value) {
    const key = run.browser || "Unknown";
    const g = groups.get(key) ?? { pass: 0, total: 0 };
    g.total++;
    if (run.status === "pass") g.pass++;
    groups.set(key, g);
  }
  const browserIconMap: Record<string, string> = {
    Chromium: "img:" + chromiumSvgUrl,
    Firefox: "img:" + firefoxSvgUrl,
    WebKit: "img:" + webkitSvgUrl,
  };
  return Array.from(groups.entries()).map(([name, g]) => {
    const pct = g.total > 0 ? Math.round((g.pass / g.total) * 100) : 100;
    const entry: BreakdownItem = {
      name,
      icon: browserIconMap[name] || "open-in-browser",
      pct: pct + "%",
      barColor: "var(--color-status-success-text)",
      textColor: "var(--color-success-700)",
    };
    return entry;
  });
});
const locationBreakdown = computed<BreakdownItem[]>(() => {
  const groups = new Map<string, { pass: number; total: number }>();
  for (const run of allRuns.value) {
    const key = run.location || "Unknown";
    const g = groups.get(key) ?? { pass: 0, total: 0 };
    g.total++;
    if (run.status === "pass") g.pass++;
    groups.set(key, g);
  }

  function getIconForRegion(region: string): string {
    // Handle prefixed names like "aws-us-east-1", "gcp-us-central1", "azure-eastus"
    const prefix = region.split("-")[0].toLowerCase();
    if (prefix === "aws") return "img:" + awsSvgUrl;
    if (prefix === "gcp") return "img:" + gcpSvgUrl;

    // AWS format: xx-xxxx-N (us-east-1, eu-west-1, ap-south-1)
    if (/^[a-z]{2}-[a-z]+-\d+$/.test(region)) return "img:" + awsSvgUrl;
    // GCP format: xxx-xxxxN (us-central1, europe-west1)
    if (/^[a-z]+-[a-z]+\d*$/.test(region)) return "img:" + gcpSvgUrl;
    // Azure or just a single word like "eastus", "westeurope"
    return "location-on";
  }

  return Array.from(groups.entries()).map(([name, g]) => {
    const pct = g.total > 0 ? Math.round((g.pass / g.total) * 100) : 100;
    const entry: BreakdownItem = {
      name,
      icon: getIconForRegion(name),
      pct: pct + "%",
      barColor: "var(--color-status-success-text)",
      textColor: "var(--color-success-700)",
    };
    return entry;
  });
});
const deviceBreakdown = computed<BreakdownItem[]>(() => {
  const groups = new Map<string, { pass: number; total: number }>();
  for (const run of allRuns.value) {
    const key = run.device || "Unknown";
    const g = groups.get(key) ?? { pass: 0, total: 0 };
    g.total++;
    if (run.status === "pass") g.pass++;
    groups.set(key, g);
  }
  return Array.from(groups.entries()).map(([id, g]) => {
    const pct = g.total > 0 ? Math.round((g.pass / g.total) * 100) : 100;
    return {
      name: deviceLabel(id),
      icon: deviceIconName(id),
      pct: pct + "%",
      barColor: "var(--color-status-success-text)",
      textColor: "var(--color-success-700)",
    };
  });
  });

// ── Status filter options ────────────────────────────────────────────────
const statusOptions = [
  { key: "all", label: t('synthetics.filters.all'), dot: "var(--color-text-secondary)" },
  { key: "pass", label: t('synthetics.results.passed'), dot: "var(--color-status-success-text)" },
  { key: "fail", label: t('synthetics.results.failed'), dot: "var(--color-status-error-text)" },
];

// ── Mock fallback data (used by Overview/Errors tabs when no real data) ────
function stepNames(): string[] {
  return [
    "Open homepage", "Open search", "Search query", "Submit search",
    "Search results", "Results shown", "Open first product", "Product page",
    "Add to cart", "Go to checkout", "Fill card number", "Place order",
  ];
}
function stepMeta(): Record<string, { locator: string | null; browsers: string[] }> {
  return {
    "Open homepage": { locator: null, browsers: ["Chromium", "Firefox", "WebKit"] },
    "Open search": { locator: 'css=[data-testid="search-icon"]', browsers: ["Chromium", "Firefox", "WebKit"] },
    "Search query": { locator: "css=#search", browsers: ["Chromium", "Firefox", "WebKit"] },
    "Submit search": { locator: null, browsers: ["Chromium", "Firefox", "WebKit"] },
    "Search results": { locator: null, browsers: ["Chromium", "Firefox", "WebKit"] },
    "Results shown": { locator: 'text="results for"', browsers: ["Chromium", "Firefox", "WebKit"] },
    "Open first product": { locator: "testid=result-0", browsers: ["Chromium", "Firefox", "WebKit"] },
    "Product page": { locator: null, browsers: ["Chromium", "Firefox", "WebKit"] },
    "Add to cart": { locator: "css=.btn-add-to-cart", browsers: ["Chromium", "Firefox", "WebKit"] },
    "Go to checkout": { locator: "css=.btn-checkout", browsers: ["Chromium", "Firefox", "WebKit"] },
    "Fill card number": { locator: "css=#card-number", browsers: ["Chromium", "Firefox", "WebKit"] },
    "Place order": { locator: "testid=place-order-btn", browsers: ["Chromium", "Firefox", "WebKit"] },
  };
}
function errorPatterns(): string[] {
  return [
    'TimeoutError: waiting for selector `[data-testid="place-order-btn"]`',
    "Selector not found: .btn-checkout",
    "Navigation timeout exceeded: /api/checkout/session",
    'AssertionError: expected text "results for"',
  ];
}
function fmtAge(min: number): string {
  if (min < 60) return min + "m ago";
  const h = Math.floor(min / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}
interface MockRun {
  id: number; runId: string; ageMin: number; scheduledTs: number;
  timestamp: number; duration: number; status: "pass" | "fail";
  location: string; browser: string; device: string; triggerType: string;
  failedStep: string | null; locator: string | null; action: string | null;
  errorPattern: string | null;
  artifacts: { screenshot: boolean; replay: boolean; trace: boolean; rum: boolean };
}
function generateRuns(timeRange?: { startTimeMs: number; endTimeMs: number }): MockRun[] {
  const r = seedRand(77);
  const locations = ["us-east-1", "eu-west-1", "ap-south-1"];
  const browsers = ["Chromium", "Firefox", "WebKit"];
  const devices = ["Desktop", "Tablet", "Mobile"];
  const steps = stepNames();
  const meta = stepMeta();
  const errs = errorPatterns();
  const runs: MockRun[] = [];
  const timeSpan = timeRange ? timeRange.endTimeMs - timeRange.startTimeMs : 26 * 17 * 60 * 1000;
  const baseTime = timeRange ? timeRange.endTimeMs : Date.now();
  const NUM_LOGICAL_RUNS = 26;
  let idCounter = 1;
  for (let logicalRunIdx = 0; logicalRunIdx < NUM_LOGICAL_RUNS; logicalRunIdx++) {
    const runId = "run-" + String(5000 - logicalRunIdx);
    const numExecutions = 3 + Math.floor(r() * 16);
    const intervalFraction = logicalRunIdx / NUM_LOGICAL_RUNS;
    const scheduledBase = baseTime - Math.round(intervalFraction * timeSpan);
    for (let execIdx = 0; execIdx < numExecutions; execIdx++) {
      const isFail = r() < 0.22;
      const dur = isFail ? Math.round(20000 + r() * 15000) : Math.round(1800 + r() * 3200);
      const errIdx = Math.floor(r() * errs.length);
      const failedStep = isFail ? steps[8 + Math.floor(r() * 4)] : null;
      const locator = failedStep ? meta[failedStep].locator : null;
      runs.push({
        id: idCounter++, runId,
        ageMin: Math.round((baseTime - scheduledBase) / 60000),
        scheduledTs: scheduledBase, timestamp: scheduledBase + Math.round(r() * 30000),
        triggerType: "schedule", duration: dur, status: isFail ? "fail" : "pass",
        location: locations[Math.floor(r() * locations.length)],
        browser: browsers[Math.floor(r() * browsers.length)],
        device: devices[r() < 0.7 ? 0 : r() < 0.85 ? 1 : 2],
        failedStep, locator,
        action: failedStep ? (["Place order", "Go to checkout", "Add to cart"].includes(failedStep) ? "click" : "type") : null,
        errorPattern: isFail ? errs[errIdx] : null,
        artifacts: { screenshot: true, replay: r() < 0.7, trace: true, rum: r() < 0.9 },
      });
    }
  }
  return runs;
}

// ── Error groups (Errors tab) ────────────────────────────────────────────
interface ErrorGroup { pattern: string; count: number; lastSeen: string; }
const errorGroups = computed<ErrorGroup[]>(() => {
  const errs = errorPatterns();
  const runs = allRuns.value;
  return errs
    .map((pattern) => {
      const matches = runs.filter((r) => r.errorPattern === pattern);
      const lastSeen = matches.length ? fmtAge(Math.min(...matches.map((m) => m.ageMin))) : "—";
      return { pattern, count: matches.length, lastSeen };
    })
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count);
});
const errorGroupCount = computed(() => errorGroups.value.length);

const failedStepOptions = computed<SelectOption[]>(() => {
  const meta = stepMeta();
  const withLocator = stepNames().filter((n) => meta[n].locator);
  return [
    { label: t('synthetics.filters.anyFailedStep'), value: "all" },
    ...withLocator.map((n) => ({ label: n, value: n })),
  ];
});

// ── OTable columns ───────────────────────────────────────────────────────
interface VisibleRun {
  id: number;
  statusBadgeVariant: string;
  statusIcon: string;
  statusLabel: string;
  scheduledTs: number;
  lastRunTs: number;
  triggerType: string;
  duration: string;
  location: string;
  browser: string;
  device: string;
  errorSnippet: string | null;
  errorPattern: string | null;
}

const visibleRuns = computed<VisibleRun[]>(() => {
  return filteredRuns.value.map((run) => {
    const isFail = run.status === "fail";
    return {
      id: run.id,
      statusBadgeVariant: isFail ? "error-soft" : "success-soft",
      statusIcon: isFail ? "cancel" : "check_circle",
      statusLabel: isFail ? t('synthetics.results.failed') : t('synthetics.results.passed'),
      scheduledTs: run.scheduledTs,
      lastRunTs: run.timestamp,
      triggerType: run.triggerType === "manual" ? t('synthetics.runs.triggerManual') : t('synthetics.runs.triggerSchedule'),
      duration: fmtDur(run.duration),
      location: run.location,
      browser: run.browser,
      device: run.device,
      errorSnippet: run.errorPattern
        ? run.errorPattern.split(":")[0] +
          (run.failedStep ? " · " + run.failedStep : "")
        : null,
      errorPattern: run.errorPattern,
    };
  });
});

const runColumns: OTableColumnDef[] = [
  { id: "status", header: t('synthetics.table.status'), accessorKey: "status", size: 60 },
  {
    id: "last_run_at",
    header: t('synthetics.table.lastRunAt'),
    accessorKey: "lastRunTs",
    size: 100,
  },
  {
    id: "duration",
    header: t('synthetics.results.duration'),
    accessorKey: "duration",
    size: 50,
  },
  { id: "location", header: t('synthetics.results.location'), accessorKey: "location", size: 110 },
  { id: "browser", header: t('synthetics.results.steps.browser'), accessorKey: "browser", size: 100 },
  { id: "device", header: t('synthetics.results.device'), accessorKey: "device", size: 90 },
  {
    id: "trigger_type",
    header: t('synthetics.table.trigger'),
    accessorKey: "triggerType",
    size: 90,
  },
  {
    id: "scheduled_at",
    header: t('synthetics.table.scheduledAt'),
    accessorKey: "scheduledTs",
    size: 100,
  },
];

// ── Steps: real data from composable ────────────────────────────────────
const stepGroupsData = computed(() => synthetics.stepStats.value.stepGroups);

// ── Display helpers for step analysis ────────────────────────────────────

function colorForRate(pct: number): string {
  return pct >= 15
    ? "var(--color-status-error-text)"
    : pct >= 5
      ? "var(--color-warning-600)"
      : "var(--color-text-secondary)";
}
function barColorForRate(pct: number): string {
  return pct >= 15
    ? "var(--color-status-error-text)"
    : pct >= 5
      ? "var(--color-warning-500)"
      : "var(--color-status-success-text)";
}
// ── Steps Analysis Table ──────────────────────────────────────────────────

interface StepTableRow {
  id: string;
  name: string;
  sub: string | null;
  failRatePct: number;
  failCount: number;
  failColor: string;
  failRateBarPct: string;
  failBarColor: string;
  flakyRatePct: number;
  flakyCount: number;
  flakyColor: string;
  avgDuration: string;
  avgDurationMs: number;
  durationBarPct: string;
  maxDuration: string;
  maxDurationMs: number;
  maxDurationBarPct: string;
  p95Duration: string;
  p95DurationMs: number;
  p95DurationBarPct: string;
}

const stepTableRows = computed<StepTableRow[]>(() => {
  const groups = stepGroupsData.value;
  if (groups.length === 0) return [];

  const maxFailRate = Math.max(...groups.map((g) => g.failRate), 0.01);
  const maxAvgDuration = Math.max(...groups.map((g) => g.avgDurationMs), 1);
  const maxMaxDuration = Math.max(...groups.map((g) => g.maxDurationMs), 1);
  const maxP95Duration = Math.max(...groups.map((g) => g.p95DurationMs), 1);

  return groups.map((g) => {
    const failPct = Math.round(g.failRate * 100);
    const failBarWidth = Math.round((g.failRate / maxFailRate) * 100);
    const flakyPct = Math.round(g.flakyRate * 10) / 10;

    return {
      id: g.key,
      name: g.name,
      sub: g.sub,
      failRatePct: failPct,
      failCount: g.failCount,
      failColor: colorForRate(failPct),
      failRateBarPct: failBarWidth + "%",
      failBarColor: barColorForRate(failPct),
      flakyRatePct: flakyPct,
      flakyCount: g.flakyCount,
      flakyColor: g.flakyRate >= 5 ? "var(--color-status-warning-text)" : "var(--color-text-secondary)",
      avgDuration: fmtDur(g.avgDurationMs),
      avgDurationMs: g.avgDurationMs,
      durationBarPct: Math.round((g.avgDurationMs / maxAvgDuration) * 100) + "%",
      maxDuration: fmtDur(g.maxDurationMs),
      maxDurationMs: g.maxDurationMs,
      maxDurationBarPct: Math.round((g.maxDurationMs / maxMaxDuration) * 100) + "%",
      p95Duration: fmtDur(g.p95DurationMs),
      p95DurationMs: g.p95DurationMs,
      p95DurationBarPct: Math.round((g.p95DurationMs / maxP95Duration) * 100) + "%",
    };
  });
});

const stepTableColumns: OTableColumnDef<StepTableRow>[] = [
  { id: "name", header: t('synthetics.results.steps.stepName'), accessorKey: "name", meta: { isName: true } },
  { id: "failRate", header: t('synthetics.results.steps.failRate'), accessorKey: "failRatePct", size: 110, meta: { align: "right" } },
  { id: "flakyRate", header: t('synthetics.results.steps.flakyRate'), accessorKey: "flakyRatePct", size: 100, meta: { align: "right" } },
  { id: "avgDuration", header: t('synthetics.results.steps.avgDuration'), accessorKey: "avgDurationMs", size: 100, meta: { align: "right" } },
  { id: "p95Duration", header: t('synthetics.results.steps.p95Duration'), accessorKey: "p95DurationMs", size: 96, meta: { align: "right" } },
  { id: "maxDuration", header: t('synthetics.results.steps.maxDuration'), accessorKey: "maxDurationMs", size: 100, meta: { align: "right" } },
];

// ── Chart options ────────────────────────────────────────────────────────
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return (
    getComputedStyle(document.body).getPropertyValue(name).trim() || fallback
  );
}

const responseChartOption = computed(() => {
  const lineColor = cssVar("--color-primary-600", "#3b82f6");
  const axisColor = cssVar("--color-text-secondary", "#6c707e");
  const splitColor = cssVar("--color-border-default", "#e2e8f0");
  const p95Color = cssVar("--color-status-warning-text", "#f59e0b");

  let seriesData: [number, number][];
  if (synthetics.buckets.value.length > 0) {
    seriesData = synthetics.buckets.value.map(
      (b) => [b.tsMs, b.p95Ms] as [number, number],
    );
  } else {
    const rB = seedRand(31);
    const bucketCount = 24;
    const now = Date.now();
    seriesData = [];
    for (let i = 0; i < bucketCount; i++) {
      seriesData.push([
        now - (bucketCount - i) * 3600000,
        1900 + Math.sin(i / 4) * 300 + (rB() - 0.5) * 500,
      ]);
    }
  }

  return {
    backgroundColor: "transparent",
    grid: { left: 52, right: 52, top: 16, bottom: 28 },
    tooltip: {
      trigger: "axis" as const,
      valueFormatter: (val: number) => fmtDur(val),
    },
    xAxis: {
      type: "time" as const,
      axisLine: { lineStyle: { color: splitColor } },
      axisLabel: { color: axisColor, fontSize: 10 },
    },
    yAxis: {
      type: "value" as const,
      axisLabel: {
        color: axisColor,
        fontSize: 10,
        formatter: (val: number) => fmtDur(val),
      },
      splitLine: { lineStyle: { color: splitColor, type: "dashed" as const } },
    },
    series: [
      {
        type: "line" as const,
        smooth: true,
        showSymbol: false,
        data: seriesData,
        lineStyle: { color: lineColor, width: 1.5 },
        areaStyle: { color: lineColor, opacity: 0.08 },
        markLine: p95Ms.value
          ? {
              silent: true,
              symbol: "none" as const,
              lineStyle: { color: p95Color, type: "dashed" as const },
              data: [{ yAxis: p95Ms.value }],
              label: {
                formatter: t('synthetics.runs.chartP95', { value: p95Label.value }),
                color: p95Color,
                fontSize: 10,
              },
            }
          : undefined,
      },
    ],
  };
});

const errorChartOption = computed(() => {
  const axisColor = cssVar("--color-text-secondary", "#6c707e");
  const splitColor = cssVar("--color-border-default", "#e2e8f0");
  const errorColor = cssVar("--color-status-error-text", "#dc2626");

  let categories: string[];
  let data: number[];
  if (synthetics.buckets.value.length > 0) {
    categories = synthetics.buckets.value.map((b) => {
      const d = new Date(b.tsMs);
      return d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
    });
    data = synthetics.buckets.value.map((b) => b.failedRuns);
  } else {
    const rB = seedRand(31);
    const bucketCount = 24;
    const now = Date.now();
    categories = [];
    data = [];
    for (let i = 0; i < bucketCount; i++) {
      const date = new Date(now - (bucketCount - i) * 3600000);
      categories.push(
        date.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      data.push(Math.max(0, Math.round(rB() < 0.25 ? 1 + rB() * 2 : 0)));
    }
  }

  return {
    backgroundColor: "transparent",
    grid: { left: 44, right: 16, top: 16, bottom: 28 },
    tooltip: {
      trigger: "axis" as const,
      valueFormatter: (val: number) => t('synthetics.runs.chartFailures', { count: val }),
    },
    xAxis: {
      type: "category" as const,
      data: categories,
      axisLine: { lineStyle: { color: splitColor } },
      axisLabel: { color: axisColor, fontSize: 10 },
    },
    yAxis: {
      type: "value" as const,
      axisLabel: { color: axisColor, fontSize: 10 },
      splitLine: { lineStyle: { color: splitColor, type: "dashed" as const } },
    },
    series: [
      {
        type: "bar" as const,
        data,
        itemStyle: { color: errorColor, borderRadius: [1, 1, 0, 0] },
        barMaxWidth: 12,
      },
    ],
  };
});

// ── Methods ──────────────────────────────────────────────────────────────
function filterByError(pattern: string | null) {
  if (!pattern) return;
  errorFilter.value = pattern;
  statusFilter.value = "fail";
}

function filterByErrorPattern(pattern: string) {
  errorFilter.value = pattern;
  statusFilter.value = "fail";
  activeTab.value = "overview";
}

function clearErrorFilter() {
  errorFilter.value = null;
}

function resetFilters() {
  statusFilter.value = "all";
  browserFilter.value = "all";
  deviceFilter.value = "all";
  locationFilter.value = "all";
  durationFilter.value = "all";
  failedStepFilter.value = "all";
  locatorFilter.value = "";
  actionFilter.value = "all";
  errorFilter.value = null;
}

function openRun(row: { id: number }) {
  // When data comes from the composable, use the real run_id
  const idx = allRuns.value.findIndex((r) => r.id === row.id);
  if (idx >= 0 && runsHasLoadedOnce.value) {
    const realRun = synthetics.runs.value[idx];
    // Dispatcher/reaper-written error rows carry no execution_id — fall back
    // to job_id (== execution_id for protocol checks and reaped jobs).
    const executionId = realRun?.executionId || realRun?.jobId;
    if (realRun?.runId && executionId) {
      emit("open-run", realRun.runId, executionId);
      return;
    }
  }
  emit("open-run", String(row.id), "");
}

// ── Public API — parent drives all (re)loads ─────────────────────────────
async function refresh(startTime?: number, endTime?: number) {
  if (!startTime || !endTime) return;
  timeRangeMicros.value = { startTime, endTime };
  await synthetics.fetchAll(props.monitorId, startTime, endTime);
}

defineExpose({ refresh });
</script>
