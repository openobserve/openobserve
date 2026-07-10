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
    - Steps: Cross-run step analysis with expandable rows
    - Errors: Error pattern grouping

  Runs table features:
    - Column resize (drag header edges) and column reorder (drag headers)
    - OTimeCell for date columns (Scheduled At, Last Run At)
    - Icons in cells (browser logos, location cloud icons, device icons)
    - Icons in filter dropdowns (browser, device, location selects)

  This component is chrome-less — it does NOT render AppPageHeader.
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
      class="shrink-0 px-5 border-b border-border-default"
    >
      <OTab name="overview" data-test="monitor-runs-tab-overview">
        Overview
      </OTab>
      <OTab name="steps" data-test="monitor-runs-tab-steps"> Steps </OTab>
    </OTabs>

    <div class="flex-1 min-h-0">
      <OTabPanels v-model="activeTab" grow scroll="y" class="h-full min-h-0">
        <!-- ════════════ OVERVIEW ════════════ -->
        <OTabPanel name="overview">
          <div
            class="mx-auto px-5 py-[0.875rem] pb-[1.75rem] flex flex-col gap-[0.875rem]"
          >
            <!-- Skeleton (while loading or before first data arrives) -->
            <template v-if="loading || !hasLoadedOnce">
              <MonitorRunsSkeleton />

              <!-- Charts skeleton -->
              <div class="grid grid-cols-2 gap-[0.875rem]">
                <div
                  class="card-container rounded-lg flex flex-col bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-[0.875rem] pt-[0.625rem] pb-[0.5rem]"
                  >
                    <SkeletonBox width="110px" height="14px" rounded />
                    <span class="flex-1" />
                    <SkeletonBox width="80px" height="20px" rounded />
                  </div>
                  <div class="border-t border-[var(--o2-border-color)]" />
                  <div class="p-4">
                    <SkeletonBox width="100%" height="160px" rounded />
                  </div>
                </div>
                <div
                  class="card-container rounded-lg flex flex-col bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-[0.875rem] pt-[0.625rem] pb-[0.5rem]"
                  >
                    <SkeletonBox width="120px" height="14px" rounded />
                    <span class="flex-1" />
                    <SkeletonBox width="90px" height="20px" rounded />
                  </div>
                  <div class="border-t border-[var(--o2-border-color)]" />
                  <div class="p-4">
                    <SkeletonBox width="100%" height="160px" rounded />
                  </div>
                </div>
              </div>

              <!-- Breakdown skeleton -->
              <div class="grid grid-cols-3 gap-[0.875rem]">
                <div
                  v-for="n in 3"
                  :key="n"
                  class="card-container rounded-lg flex flex-col bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-[0.875rem] pt-[0.625rem] pb-[0.5rem]"
                  >
                    <SkeletonBox
                      width="16px"
                      height="16px"
                      :custom-radius="'4px'"
                    />
                    <SkeletonBox width="110px" height="14px" rounded />
                  </div>
                  <div class="border-t border-[var(--o2-border-color)]" />
                  <div class="px-[0.875rem] py-[0.5rem] flex flex-col">
                    <div
                      v-for="row in 3"
                      :key="row"
                      class="flex items-center gap-3 py-[9px] border-b border-[var(--o2-border-color)] last:border-b-0"
                    >
                      <SkeletonBox
                        width="16px"
                        height="16px"
                        :custom-radius="'4px'"
                      />
                      <SkeletonBox width="70px" height="12px" rounded />
                      <div
                        class="flex-1 h-1.5 rounded-full"
                        style="background: var(--o2-border-color); opacity: 0.3"
                      />
                      <SkeletonBox width="36px" height="12px" rounded />
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Real content (once loaded at least once) -->
            <template v-else>
              <MonitorStatusTimeline
                :segments="timelineSegments"
                :fail-count="timelineFailCount"
                :pass-count="timelinePassCount"
                :mixed-count="timelineMixedCount"
                :start-label="timelineStartLabel"
                :end-label="timelineEndLabel"
              />

              <div class="grid grid-cols-5 gap-[0.625rem]">
                <div
                  v-for="card in kpiCards"
                  :key="card.key"
                  class="card-container rounded-lg flex flex-col px-[0.875rem] pt-[0.625rem] pb-[0.625rem] gap-[0.25rem] bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] transition-shadow duration-200 hover:shadow-[0_1px_6px_rgba(0,0,0,0.08)]"
                  :data-test="`monitor-runs-kpi-${card.key}`"
                >
                  <div class="flex flex-col gap-[0.25rem]">
                    <div
                      class="kpi-label text-[0.7rem] font-semibold text-[var(--o2-text-muted)]"
                    >
                      {{ card.label }}
                      <span v-if="card.unit"> ({{ card.unit }}) </span>
                    </div>
                    <div class="flex items-baseline gap-[0.2rem]">
                      <span
                        class="text-[1.4rem] font-bold leading-none text-[var(--o2-text-primary)]"
                        :class="card.valueClass"
                      >
                        {{ card.value }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Charts row -->
              <div class="grid grid-cols-2 gap-[0.875rem]">
                <div
                  class="card-container rounded-lg flex flex-col bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-[0.875rem] pt-[0.625rem] pb-[0.5rem]"
                  >
                    <span class="font-bold text-sm text-text-heading">
                      Response Time
                    </span>
                    <span class="flex-1" />
                    <OBadge variant="default" size="sm">
                      p95 {{ p95Label }}
                    </OBadge>
                  </div>
                  <div class="border-t border-[var(--o2-border-color)]" />
                  <div class="min-h-[180px] p-0">
                    <ChartRenderer
                      :data="{ options: responseChartOption }"
                      height="180px"
                    />
                  </div>
                </div>
                <div
                  class="card-container rounded-lg flex flex-col bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-[0.875rem] pt-[0.625rem] pb-[0.5rem]"
                  >
                    <span class="font-bold text-sm text-text-heading">
                      Errors Over Time
                    </span>
                    <span class="flex-1" />
                    <OBadge variant="error" size="sm">
                      {{ failCount }} failed
                    </OBadge>
                  </div>
                  <div class="border-t border-[var(--o2-border-color)]" />
                  <div class="min-h-[180px] p-0">
                    <ChartRenderer
                      :data="{ options: errorChartOption }"
                      height="180px"
                    />
                  </div>
                </div>
              </div>

              <!-- Breakdown cards -->
              <div class="grid grid-cols-3 gap-[0.875rem]">
                <div
                  class="card-container rounded-lg flex flex-col bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-[0.875rem] pt-[0.625rem] pb-[0.5rem]"
                  >
                    <OIcon name="language" size="sm" class="text-primary-700" />
                    <span class="font-bold text-sm text-text-heading">
                      Pass Rate by Browser
                    </span>
                  </div>
                  <div class="border-t border-[var(--o2-border-color)]" />
                  <div class="px-[0.875rem] py-[0.5rem]">
                    <div
                      v-for="b in browserBreakdown"
                      :key="b.name"
                      class="flex items-center gap-3 py-[9px] border-b border-border-default last:border-b-0"
                    >
                      <OIcon
                        :name="b.icon"
                        size="sm"
                        class="text-text-secondary flex-none"
                      />
                      <span
                        class="w-20 flex-none font-semibold text-xs text-text-heading"
                      >
                        {{ b.name }}
                      </span>
                      <div
                        class="flex-1 h-1.5 rounded-full bg-text-disabled/25! overflow-hidden min-w-[40px]"
                      >
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
                  class="card-container rounded-lg flex flex-col bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-[0.875rem] pt-[0.625rem] pb-[0.5rem]"
                  >
                    <OIcon
                      name="location-on"
                      size="sm"
                      class="text-primary-700"
                    />
                    <span class="font-bold text-sm text-text-heading">
                      Pass Rate by Location
                    </span>
                  </div>
                  <div class="border-t border-[var(--o2-border-color)]" />
                  <div class="px-[0.875rem] py-[0.5rem]">
                    <div
                      v-for="l in locationBreakdown"
                      :key="l.name"
                      class="flex items-center gap-3 py-[9px] border-b border-border-default last:border-b-0"
                    >
                      <OIcon
                        :name="l.icon"
                        size="sm"
                        class="text-text-secondary flex-none"
                      />
                      <span
                        class="w-[110px] flex-none font-semibold text-xs text-text-heading"
                      >
                        {{ l.name }}
                      </span>
                      <div
                        class="flex-1 h-1.5 rounded-full bg-text-disabled/25! overflow-hidden min-w-[40px]"
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
                  class="card-container rounded-lg flex flex-col bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] overflow-hidden"
                >
                  <div
                    class="flex items-center gap-2 px-[0.875rem] pt-[0.625rem] pb-[0.5rem]"
                  >
                    <OIcon name="devices" size="sm" class="text-primary-700" />
                    <span class="font-bold text-sm text-text-heading">
                      Pass Rate by Device
                    </span>
                  </div>
                  <div class="border-t border-[var(--o2-border-color)]" />
                  <div class="px-[0.875rem] py-[0.5rem]">
                    <div
                      v-for="d in deviceBreakdown"
                      :key="d.name"
                      class="flex items-center gap-3 py-[9px] border-b border-border-default last:border-b-0"
                    >
                      <OIcon
                        :name="d.icon"
                        size="sm"
                        class="text-text-secondary flex-none"
                      />
                      <span
                        class="w-20 flex-none font-semibold text-xs text-text-heading"
                      >
                        {{ d.name }}
                      </span>
                      <div
                        class="flex-1 h-1.5 rounded-full bg-text-disabled/25! overflow-hidden min-w-[40px]"
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
            </template>

            <!-- Filter bar -->
            <div class="flex items-center gap-2 flex-wrap">
              <OToggleGroup v-model="statusFilter" variant="default">
                <OToggleGroupItem
                  v-for="so in statusOptions"
                  :key="so.key"
                  :value="so.key"
                  size="sm"
                >
                  <template #icon-left>
                    <span
                      class="w-[7px] h-[7px] rounded-full"
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
                  class="w-[160px]"
                  data-test="monitor-runs-filter-step"
                />
                <OInput
                  v-model="locatorFilter"
                  size="sm"
                  placeholder="Locator contains…"
                  class="w-[170px]"
                  data-test="monitor-runs-filter-locator"
                />
                <OSelect
                  v-model="actionFilter"
                  :options="actionOptions"
                  size="sm"
                  class="w-[130px]"
                  data-test="monitor-runs-filter-action"
                />
              </template>

              <span class="flex-1" />
              <span class="text-xs text-text-secondary">
                {{ filteredRuns.length }} of {{ allRuns.length }} runs
              </span>
            </div>

            <!-- Error filter indicator -->
            <div
              v-if="errorFilter"
              class="flex items-center gap-2"
              data-test="monitor-runs-error-filter-badge"
            >
              <span class="text-xs text-text-secondary"
                >Filtering by error:</span
              >
              <OBadge variant="error" size="sm" class="gap-1">
                {{ errorFilter }}
                <button
                  class="inline-flex items-center justify-center cursor-pointer bg-transparent border-none p-0 text-inherit"
                  @click="clearErrorFilter"
                >
                  <OIcon name="close" size="xs" />
                </button>
              </OBadge>
            </div>

            <!-- Runs table -->
            <OCard class="p-0">
              <OTable
                :columns="runColumns"
                :data="visibleRuns"
                :loading="loading"
                pagination="client"
                :page-size="20"
                :page-size-options="[10, 20, 25, 50]"
                row-key="id"
                :show-global-filter="false"
                :enable-column-resize="true"
                :enable-column-reorder="true"
                :empty-message="'No runs match'"
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
                  <span
                    class="font-mono tabular-nums text-xs"
                    :style="{ color: (row as VisibleRun).durColor }"
                  >
                    {{ (row as VisibleRun).duration }}
                  </span>
                </template>
                <template #cell-location="{ row }">
                  <span
                    class="inline-flex items-center gap-1 text-xs text-text-secondary"
                  >
                    <OIcon
                      :name="locationIcon((row as VisibleRun).location)"
                      size="xs"
                    />
                    {{ (row as VisibleRun).location }}
                  </span>
                </template>
                <template #cell-browser="{ row }">
                  <span
                    class="inline-flex items-center gap-1 text-xs text-text-secondary"
                  >
                    <OIcon
                      :name="browserIcon((row as VisibleRun).browser)"
                      size="xs"
                    />
                    {{ (row as VisibleRun).browser }}
                  </span>
                </template>
                <template #cell-device="{ row }">
                  <span
                    class="inline-flex items-center gap-1 text-xs text-text-secondary"
                  >
                    <OIcon
                      :name="
                        (row as VisibleRun).device === 'Desktop'
                          ? 'computer'
                          : (row as VisibleRun).device === 'Tablet'
                            ? 'tablet'
                            : 'smartphone'
                      "
                      size="xs"
                    />
                    {{ (row as VisibleRun).device }}
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
                      class="truncate max-w-[200px]"
                    >
                      {{ (row as VisibleRun).errorSnippet }}
                    </OBadge>
                  </span>
                </template>
                <template #cell-trigger_type="{ row }">
                  <span class="text-xs text-text-secondary">
                    {{ (row as VisibleRun).triggerType }}
                  </span>
                </template>
              </OTable>
            </OCard>

            <!-- Empty state -->
            <OEmptyState
              v-if="visibleRuns.length === 0 && !loading"
              preset="no-results"
              size="sm"
              data-test="monitor-runs-empty"
              @action="resetFilters"
            />
          </div>
        </OTabPanel>

        <!-- ════════════ STEPS ════════════ -->
        <OTabPanel name="steps">
          <div
            class="mx-auto px-5 py-[0.875rem] pb-[1.75rem] flex flex-col gap-[0.875rem]"
          >
            <div class="flex items-center gap-2.5">
              <span class="font-bold text-sm text-text-heading">
                Cross-run step analysis
              </span>
              <span class="text-xs text-text-secondary">
                Grouped over {{ windowLabel }} &middot;
                {{ allRuns.length }} runs
              </span>
              <span class="flex-1" />
              <OToggleGroup v-model="stepsGroupBy" variant="default">
                <OToggleGroupItem value="step" size="sm"
                  >By Step Name</OToggleGroupItem
                >
                <OToggleGroupItem value="locator" size="sm"
                  >By Locator</OToggleGroupItem
                >
              </OToggleGroup>
            </div>

            <OCard class="p-0">
              <div
                class="grid grid-cols-[1fr_110px_120px_110px_1fr_1fr_32px] gap-2.5 px-4 py-2 bg-surface-subtle border-b border-border-default text-[11px] font-semibold text-text-secondary uppercase tracking-wide"
              >
                <span>{{ primaryColLabel }}</span>
                <span>Fail Rate</span>
                <span>Avg Duration</span>
                <span>Trend</span>
                <span>Browser</span>
                <span>Location</span>
                <span />
              </div>
              <div v-for="(g, gi) in stepGroups" :key="gi">
                <!-- Group row (manual expand/collapse) -->
                <div>
                  <div
                    class="grid grid-cols-[1fr_110px_120px_110px_1fr_1fr_32px] gap-2.5 px-4 py-2.5 border-b border-border-default items-center cursor-pointer hover:bg-surface-subtle"
                    @click="toggleStepGroup(g._key)"
                  >
                    <div class="min-w-0">
                      <div
                        class="font-semibold text-xs text-text-heading truncate"
                        :class="
                          stepsGroupBy === 'locator'
                            ? 'font-mono tabular-nums'
                            : ''
                        "
                      >
                        {{ g.name }}
                      </div>
                      <div v-if="g.sub" class="text-[11px] text-text-secondary">
                        {{ g.sub }}
                      </div>
                    </div>
                    <div class="flex flex-col gap-1">
                      <span
                        class="font-mono tabular-nums font-bold text-xs"
                        :style="{ color: g.failColor }"
                      >
                        {{ g.failRate }}
                      </span>
                      <div
                        class="h-[5px] rounded-full bg-text-disabled/25! overflow-hidden"
                      >
                        <div
                          class="h-full rounded-full"
                          :style="{
                            width: g.failRateBarPct,
                            background: g.failBarColor,
                          }"
                        />
                      </div>
                    </div>
                    <div class="flex flex-col gap-1">
                      <span
                        class="font-mono tabular-nums text-xs text-text-body"
                      >
                        {{ g.avgDuration }}
                      </span>
                      <div
                        class="h-[5px] rounded-full bg-text-disabled/25! overflow-hidden"
                      >
                        <div
                          class="h-full rounded-full bg-primary-400"
                          :style="{ width: g.durationBarPct }"
                        />
                      </div>
                    </div>
                    <svg viewBox="0 0 90 24" class="w-[90px] h-6 block">
                      <polyline
                        :points="g.trendPts"
                        fill="none"
                        :stroke="g.trendColor"
                        stroke-width="1.5"
                        vector-effect="non-scaling-stroke"
                      />
                    </svg>
                    <div class="flex gap-1.5 flex-wrap">
                      <OBadge
                        v-for="bc in g.browserChips"
                        :key="bc.label"
                        size="sm"
                        :style="{ background: bc.bg, color: bc.color }"
                      >
                        {{ bc.label }}
                      </OBadge>
                    </div>
                    <div class="flex gap-1.5 flex-wrap">
                      <OBadge
                        v-for="lc in g.locationChips"
                        :key="lc.label"
                        size="sm"
                        :style="{ background: lc.bg, color: lc.color }"
                      >
                        {{ lc.label }}
                      </OBadge>
                    </div>
                    <OIcon
                      name="expand_more"
                      size="sm"
                      class="text-text-secondary transition-transform duration-150"
                      :class="{ 'rotate-180': g.expanded }"
                    />
                  </div>
                  <div
                    v-if="g.expanded"
                    class="grid grid-cols-2 gap-4 px-4 py-3 bg-surface-subtle border-b border-border-default"
                  >
                    <div>
                      <div
                        class="text-[10px] font-bold text-text-secondary uppercase tracking-wide mb-1.5"
                      >
                        Fail rate by browser
                      </div>
                      <div
                        v-for="br in g.browserRows"
                        :key="br.name"
                        class="flex items-center gap-2.5 py-1"
                      >
                        <span class="w-[70px] text-xs text-text-body">{{
                          br.name
                        }}</span>
                        <div
                          class="flex-1 h-1.5 rounded-full bg-text-disabled/25! overflow-hidden"
                        >
                          <div
                            class="h-full rounded-full"
                            :style="{ width: br.pct, background: br.barColor }"
                          />
                        </div>
                        <span
                          class="font-mono tabular-nums text-xs text-text-secondary w-10 text-right"
                          >{{ br.pct }}</span
                        >
                      </div>
                    </div>
                    <div>
                      <div
                        class="text-[10px] font-bold text-text-secondary uppercase tracking-wide mb-1.5"
                      >
                        Fail rate by location
                      </div>
                      <div
                        v-for="lr in g.locationRows"
                        :key="lr.name"
                        class="flex items-center gap-2.5 py-1"
                      >
                        <span class="w-[90px] text-xs text-text-body">{{
                          lr.name
                        }}</span>
                        <div
                          class="flex-1 h-1.5 rounded-full bg-text-disabled/25! overflow-hidden"
                        >
                          <div
                            class="h-full rounded-full"
                            :style="{ width: lr.pct, background: lr.barColor }"
                          />
                        </div>
                        <span
                          class="font-mono tabular-nums text-xs text-text-secondary w-10 text-right"
                          >{{ lr.pct }}</span
                        >
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </OCard>
          </div>
        </OTabPanel>

        <!-- ════════════ ERRORS ════════════ -->
        <OTabPanel name="errors">
          <div
            class="mx-auto px-5 py-[0.875rem] pb-[1.75rem] flex flex-col gap-[0.875rem]"
          >
            <div class="flex items-center gap-2.5">
              <span class="font-bold text-sm text-text-heading">
                Error patterns
              </span>
              <span class="text-xs text-text-secondary">
                Normalized across {{ windowLabel }} &middot; click a row to
                filter runs
              </span>
            </div>

            <OCard class="p-0">
              <div
                class="grid grid-cols-[1fr_100px_160px_32px] gap-2.5 px-4 py-2 bg-surface-subtle border-b border-border-default text-[11px] font-semibold text-text-secondary uppercase tracking-wide"
              >
                <span>Error Pattern</span>
                <span>Count</span>
                <span>Last Seen</span>
                <span />
              </div>
              <div
                v-for="e in errorGroups"
                :key="e.pattern"
                class="grid grid-cols-[1fr_100px_160px_32px] gap-2.5 px-4 py-[11px] border-b border-border-default items-center cursor-pointer hover:bg-surface-subtle"
                data-test="monitor-runs-error-row"
                @click="filterByErrorPattern(e.pattern)"
              >
                <span
                  class="font-mono tabular-nums text-xs text-text-heading truncate"
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
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
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
import awsSvgUrl from "@/assets/images/ingestion/aws.svg";
import gcpSvgUrl from "@/assets/images/ingestion/gcp.svg";
import chromiumSvgUrl from "@/assets/images/synthetics/chromium.svg";
import firefoxSvgUrl from "@/assets/images/synthetics/firefox.svg";
import webkitSvgUrl from "@/assets/images/synthetics/webkit.svg";
import MonitorRunsSkeleton from "@/views/synthetics/MonitorRunsSkeleton.vue";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";

defineOptions({ name: "SyntheticMonitorRuns" });

const emit = defineEmits<{
  (e: "edit"): void;
  (e: "open-run", runId: string, executionId: string): void;
}>();

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
const loading = computed(() => synthetics.loading.value);
const hasLoadedOnce = computed(() => synthetics.hasLoadedOnce.value);

// ── Seeded random (deterministic mock data) ──────────────────────────────
function seedRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── Mock data generators ────────────────────────────────────────────────
function stepNames(): string[] {
  return [
    "Open homepage",
    "Open search",
    "Search query",
    "Submit search",
    "Search results",
    "Results shown",
    "Open first product",
    "Product page",
    "Add to cart",
    "Go to checkout",
    "Fill card number",
    "Place order",
  ];
}

function stepMeta(): Record<
  string,
  { locator: string | null; browsers: string[] }
> {
  return {
    "Open homepage": {
      locator: null,
      browsers: ["Chromium", "Firefox", "WebKit"],
    },
    "Open search": {
      locator: 'css=[data-testid="search-icon"]',
      browsers: ["Chromium", "Firefox", "WebKit"],
    },
    "Search query": {
      locator: "css=#search",
      browsers: ["Chromium", "Firefox", "WebKit"],
    },
    "Submit search": {
      locator: null,
      browsers: ["Chromium", "Firefox", "WebKit"],
    },
    "Search results": {
      locator: null,
      browsers: ["Chromium", "Firefox", "WebKit"],
    },
    "Results shown": {
      locator: 'text="results for"',
      browsers: ["Chromium", "Firefox", "WebKit"],
    },
    "Open first product": {
      locator: "testid=result-0",
      browsers: ["Chromium", "Firefox", "WebKit"],
    },
    "Product page": {
      locator: null,
      browsers: ["Chromium", "Firefox", "WebKit"],
    },
    "Add to cart": {
      locator: "css=.btn-add-to-cart",
      browsers: ["Chromium", "Firefox", "WebKit"],
    },
    "Go to checkout": {
      locator: "css=.btn-checkout",
      browsers: ["Chromium", "Firefox", "WebKit"],
    },
    "Fill card number": {
      locator: "css=#card-number",
      browsers: ["Chromium", "Firefox", "WebKit"],
    },
    "Place order": {
      locator: "testid=place-order-btn",
      browsers: ["Chromium", "Firefox", "WebKit"],
    },
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

interface MockRun {
  id: number;
  runId: string;
  ageMin: number;
  scheduledTs: number;
  timestamp: number;
  duration: number;
  status: "pass" | "fail";
  location: string;
  browser: string;
  device: string;
  triggerType: string;
  failedStep: string | null;
  locator: string | null;
  action: string | null;
  errorPattern: string | null;
  artifacts: {
    screenshot: boolean;
    replay: boolean;
    trace: boolean;
    rum: boolean;
  };
}

function generateRuns(timeRange?: {
  startTimeMs: number;
  endTimeMs: number;
}): MockRun[] {
  const r = seedRand(77);
  const locations = ["us-east-1", "eu-west-1", "ap-south-1"];
  const browsers = ["Chromium", "Firefox", "WebKit"];
  const devices = ["Desktop", "Tablet", "Mobile"];
  const steps = stepNames();
  const meta = stepMeta();
  const errs = errorPatterns();
  const runs: MockRun[] = [];

  const timeSpan = timeRange
    ? timeRange.endTimeMs - timeRange.startTimeMs
    : 26 * 17 * 60 * 1000; // default ~7h span
  const baseTime = timeRange ? timeRange.endTimeMs : Date.now();

  const NUM_LOGICAL_RUNS = 26;
  let idCounter = 1;
  for (
    let logicalRunIdx = 0;
    logicalRunIdx < NUM_LOGICAL_RUNS;
    logicalRunIdx++
  ) {
    const runId = "run-" + String(5000 - logicalRunIdx);
    const numExecutions = 3 + Math.floor(r() * 16); // 3–18 executions per run
    const intervalFraction = logicalRunIdx / NUM_LOGICAL_RUNS;
    const scheduledBase = baseTime - Math.round(intervalFraction * timeSpan);

    for (let execIdx = 0; execIdx < numExecutions; execIdx++) {
      const isFail = r() < 0.22;
      const dur = isFail
        ? Math.round(20000 + r() * 15000)
        : Math.round(1800 + r() * 3200);
      const errIdx = Math.floor(r() * errs.length);
      const failedStep = isFail ? steps[8 + Math.floor(r() * 4)] : null;
      const locator = failedStep ? meta[failedStep].locator : null;

      runs.push({
        id: idCounter++,
        runId,
        ageMin: Math.round((baseTime - scheduledBase) / 60000),
        scheduledTs: scheduledBase,
        timestamp: scheduledBase + Math.round(r() * 30000),
        triggerType: "schedule",
        duration: dur,
        status: isFail ? ("fail" as const) : ("pass" as const),
        location: locations[Math.floor(r() * locations.length)],
        browser: browsers[Math.floor(r() * browsers.length)],
        device: devices[r() < 0.7 ? 0 : r() < 0.85 ? 1 : 2],
        failedStep,
        locator,
        action: failedStep
          ? ["Place order", "Go to checkout", "Add to cart"].includes(
              failedStep,
            )
            ? "click"
            : "type"
          : null,
        errorPattern: isFail ? errs[errIdx] : null,
        artifacts: {
          screenshot: true,
          replay: r() < 0.7,
          trace: true,
          rum: r() < 0.9,
        },
      });
    }
  }
  return runs;
}

// ── Helpers ──────────────────────────────────────────────────────────────
function fmtDur(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms";
}
function fmtAge(min: number): string {
  if (min < 60) return min + "m ago";
  const h = Math.floor(min / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
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

function sparkPts(seed: number, n: number, base: number, vol: number): string {
  const r = seedRand(seed);
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = base + Math.sin(i / 3) * vol * 0.4 + (r() - 0.5) * vol;
    const x = (i / (n - 1)) * 120;
    const y = 28 - Math.max(2, Math.min(28, v));
    pts.push(x.toFixed(1) + "," + y.toFixed(1));
  }
  return pts.join(" ");
}

// ── State ────────────────────────────────────────────────────────────────
const activeTab = ref("overview");
/** Time range from the parent (microseconds). Updated on each refresh call. */
const timeRangeMicros = ref<{ startTime: number; endTime: number } | null>(
  null,
);

/** Human-readable window label derived from the time range duration. */
function formatWindowLabel(startMicros: number, endMicros: number): string {
  const diffMs = (endMicros - startMicros) / 1000;
  const hours = Math.round(diffMs / 3600000);
  if (hours >= 48) return `Last ${Math.round(hours / 24)} days`;
  if (hours >= 24) return "Last 24 hours";
  if (hours >= 2) return `Last ${hours} hours`;
  const minutes = Math.round(diffMs / 60000);
  if (minutes >= 60) return "Last 1 hour";
  return `Last ${minutes} minutes`;
}
const windowLabel = computed(() =>
  timeRangeMicros.value
    ? formatWindowLabel(
        timeRangeMicros.value.startTime,
        timeRangeMicros.value.endTime,
      )
    : "Last 24 hours",
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
const stepsGroupBy = ref<"step" | "locator">("step");
const expandedRows = ref<Record<string, boolean>>({});

// ── Select options (dynamic from run data) ──────────────────────────────
function uniqueValues(key: "browser" | "device" | "location"): string[] {
  const vals = new Set(allRuns.value.map((r) => r[key]).filter(Boolean));
  return Array.from(vals).sort();
}
const browserOptions = computed<SelectOption[]>(() => [
  { label: "All browsers", value: "all", icon: "language" },
  ...uniqueValues("browser").map((v) => ({
    label: v,
    value: v,
    icon: browserIcon(v),
  })),
]);
const deviceOptions = computed<SelectOption[]>(() => [
  { label: "All devices", value: "all", icon: "devices" },
  ...uniqueValues("device").map((v) => ({
    label: v,
    value: v,
    icon:
      v === "Desktop" ? "computer" : v === "Tablet" ? "tablet" : "smartphone",
  })),
]);
const locationOptions = computed<SelectOption[]>(() => [
  { label: "All locations", value: "all", icon: "location-on" },
  ...uniqueValues("location").map((v) => ({
    label: v,
    value: v,
    icon: locationIcon(v),
  })),
]);
const durationOptions: SelectOption[] = [
  { label: "Any duration", value: "all" },
  { label: "< 5s", value: "fast" },
  { label: "5–15s", value: "mid" },
  { label: "> 15s", value: "slow" },
];
const actionOptions: SelectOption[] = [
  { label: "Any action", value: "all" },
  { label: "click", value: "click" },
  { label: "type", value: "type" },
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
  if (synthetics.hasLoadedOnce.value) {
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
  hasKpiData.value && synthetics.kpi.value.p95Ms > 0
    ? fmtDur(synthetics.kpi.value.p95Ms)
    : fmtDur(0),
);
const p95Ms = computed(() => synthetics.kpi.value.p95Ms);
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
  console.log("Data ---", hasKpiData.value);
  if (hasKpiData.value) {
    return [
      {
        key: "pass-rate",
        label: "Pass Rate",
        value: k.totalRuns > 0 ? k.uptimePct.toFixed(1) + "%" : "—",
      },
      {
        key: "p95-duration",
        label: "p95 Duration",
        value: k.p95Ms > 0 ? fmtDur(k.p95Ms) : "—",
      },
      {
        key: "retry-rate",
        label: "Retry Rate",
        value:
          k.totalRuns > 0
            ? ((k.retriedRuns / k.totalRuns) * 100).toFixed(1) + "%"
            : "0.0%",
        valueClass: k.retriedRuns > 0 ? "text-text-body!" : undefined,
      },
      {
        key: "failed-runs",
        label: "Failed Runs",
        value: String(k.failedRuns),
        valueClass: k.failedRuns > 0 ? "text-status-error-text!" : undefined,
      },
      {
        key: "last-run",
        label: "Last Run",
        value: k.lastRunStatus
          ? k.lastRunStatus === "failed"
            ? "Failed"
            : "Passed"
          : "—",
        valueClass:
          k.lastRunStatus === "failed"
            ? "text-status-error-text!"
            : "text-status-success-text!",
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
    { key: "pass-rate", label: "Pass Rate", value: fallbackPassPct },
    { key: "p95-duration", label: "p95 Duration", value: "—" },
    { key: "retry-rate", label: "Retry Rate", value: "0.0%" },
    {
      key: "failed-runs",
      label: "Failed Runs",
      value: String(totalFails.value),
    },
    {
      key: "last-run",
      label: "Last Run",
      value: lastRun?.status === "fail" ? "Failed" : "Passed",
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
        ? "var(--o2-status-success-text)"
        : status === "all-fail"
          ? "var(--o2-status-error-text)"
          : "var(--o2-status-warning-text)";

    const passCount = executions.filter((e) => e.status === "pass").length;
    const failCount = executions.length - passCount;
    const title =
      status === "all-pass"
        ? "All " + executions.length + " passed"
        : status === "all-fail"
          ? "All " + executions.length + " failed"
          : passCount +
            " passed, " +
            failCount +
            " failed of " +
            executions.length;

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
  if (!timeRangeMicros.value) return "Now";
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
      barColor: "var(--o2-status-success-text)",
      textColor: "var(--o2-success-700)",
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
      barColor: "var(--o2-status-success-text)",
      textColor: "var(--o2-success-700)",
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
  const iconMap: Record<string, string> = {
    Desktop: "computer",
    Tablet: "tablet",
    Mobile: "smartphone",
  };
  return Array.from(groups.entries()).map(([name, g]) => {
    const pct = g.total > 0 ? Math.round((g.pass / g.total) * 100) : 100;
    return {
      name,
      icon: iconMap[name] || "devices",
      pct: pct + "%",
      barColor: "var(--o2-status-success-text)",
      textColor: "var(--o2-success-700)",
    };
  });
});

// ── Status filter options ────────────────────────────────────────────────
const statusOptions = [
  { key: "all", label: "All", dot: "var(--o2-text-secondary)" },
  { key: "pass", label: "Passed", dot: "var(--o2-status-success-text)" },
  { key: "fail", label: "Failed", dot: "var(--o2-status-error-text)" },
];

const failedStepOptions = computed<SelectOption[]>(() => {
  const meta = stepMeta();
  const withLocator = stepNames().filter((n) => meta[n].locator);
  return [
    { label: "Any failed step", value: "all" },
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
  durColor: string;
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
      statusLabel: isFail ? "Failed" : "Passed",
      scheduledTs: run.scheduledTs,
      lastRunTs: run.timestamp,
      triggerType: run.triggerType === "manual" ? "Manual" : "Schedule",
      duration: fmtDur(run.duration),
      durColor: isFail ? "var(--o2-status-error-text)" : "var(--o2-text-body)",
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
  { id: "status", header: "Status", accessorKey: "status", size: 60 },
  {
    id: "scheduled_at",
    header: "Scheduled At",
    accessorKey: "scheduledTs",
    size: 100,
  },
  {
    id: "last_run_at",
    header: "Last Run At",
    accessorKey: "lastRunTs",
    size: 100,
  },
  {
    id: "duration",
    header: "Duration",
    accessorKey: "duration",
    size: 50,
  },
  { id: "location", header: "Location", accessorKey: "location", size: 110 },
  { id: "browser", header: "Browser", accessorKey: "browser", size: 100 },
  { id: "device", header: "Device", accessorKey: "device", size: 90 },
  {
    id: "trigger_type",
    header: "Trigger",
    accessorKey: "triggerType",
    size: 90,
  },
];

// ── Step groups ──────────────────────────────────────────────────────────
interface StepGroupRow {
  name: string;
  sub: string | null;
  failRate: string;
  failColor: string;
  failRateBarPct: string;
  failBarColor: string;
  avgDuration: string;
  durationBarPct: string;
  trendPts: string;
  trendColor: string;
  browserChips: { label: string; bg: string; color: string }[];
  locationChips: { label: string; bg: string; color: string }[];
  browserRows: { name: string; pct: string; barColor: string }[];
  locationRows: { name: string; pct: string; barColor: string }[];
  expanded: boolean;
}
interface StepGroupEntry extends StepGroupRow {
  _key: string;
}

const stepGroups = computed<StepGroupRow[]>(() => {
  const steps = stepNames();
  const meta = stepMeta();
  const rS = seedRand(55);

  const colorForRate = (pct: number) =>
    pct >= 15
      ? "var(--o2-status-error-text)"
      : pct >= 5
        ? "var(--o2-warning-600)"
        : "var(--o2-text-secondary)";
  const barColorForRate = (pct: number) =>
    pct >= 15
      ? "var(--o2-status-error-text)"
      : pct >= 5
        ? "var(--o2-warning-500)"
        : "var(--o2-status-success-text)";
  const chipStyleForRate = (pct: number) =>
    pct >= 15
      ? { bg: "var(--o2-error-50)", color: "var(--o2-status-error-text)" }
      : pct >= 5
        ? { bg: "var(--o2-warning-50)", color: "var(--o2-warning-700)" }
        : { bg: "var(--o2-success-50)", color: "var(--o2-success-700)" };

  const rawGroups = steps.map((name) => {
    const m = meta[name];
    const failRate =
      name === "Place order"
        ? 18 + Math.round(rS() * 8)
        : m.locator
          ? Math.round(rS() * 4)
          : 0;
    const avgDur = name === "Place order" ? 8200 : Math.round(80 + rS() * 500);
    const browserRows = ["Chromium", "Firefox", "WebKit"].map((b) => ({
      name: b,
      pct: Math.max(0, Math.round(failRate + (rS() - 0.5) * 10)),
    }));
    const locationRows = ["us-east-1", "eu-west-1", "ap-south-1"].map((l) => ({
      name: l,
      pct: Math.max(0, Math.round(failRate + (rS() - 0.5) * 12)),
    }));
    return {
      name,
      locator: m.locator,
      failRate,
      avgDur,
      browserRows,
      locationRows,
    };
  });

  const maxAvgDur = Math.max(...rawGroups.map((g) => g.avgDur), 1);
  const maxFailRate = Math.max(...rawGroups.map((g) => g.failRate), 1);

  const buildRow = (
    g: (typeof rawGroups)[number],
    key: string,
    mono?: boolean,
  ): StepGroupEntry => ({
    _key: key,
    name: mono ? (g.locator ?? g.name) : g.name,
    sub: mono ? "Used in: " + g.name : g.locator || null,
    failRate: g.failRate + "%",
    failColor: colorForRate(g.failRate),
    failRateBarPct: Math.round((g.failRate / maxFailRate) * 100) + "%",
    failBarColor: barColorForRate(g.failRate),
    durationBarPct: Math.round((g.avgDur / maxAvgDur) * 100) + "%",
    avgDuration: fmtDur(g.avgDur),
    trendPts: sparkPts(
      mono ? 300 + rawGroups.indexOf(g) : 200 + rawGroups.indexOf(g),
      16,
      24 - g.failRate,
      6,
    ),
    trendColor:
      g.failRate >= 10
        ? "var(--o2-status-error-text)"
        : "var(--o2-primary-500)",
    browserChips: g.browserRows.map((b) => {
      const c = chipStyleForRate(b.pct);
      return {
        label: b.name.slice(0, 2).toUpperCase() + " " + b.pct + "%",
        bg: c.bg,
        color: c.color,
      };
    }),
    locationChips: g.locationRows.map((l) => {
      const c = chipStyleForRate(l.pct);
      return { label: l.name + " " + l.pct + "%", bg: c.bg, color: c.color };
    }),
    browserRows: g.browserRows.map((b) => ({
      ...b,
      pct: b.pct + "%",
      barColor: barColorForRate(b.pct),
    })),
    locationRows: g.locationRows.map((l) => ({
      ...l,
      pct: l.pct + "%",
      barColor: barColorForRate(l.pct),
    })),
    expanded: !!expandedRows.value[key],
  });

  if (stepsGroupBy.value === "step") {
    return rawGroups.map((g, i) => buildRow(g, "step-" + i));
  }
  return rawGroups
    .filter((g) => g.locator)
    .map((g, i) => buildRow(g, "loc-" + i, true));
});

const primaryColLabel = computed(() =>
  stepsGroupBy.value === "step" ? "Step Name" : "Locator",
);

// ── Error groups ─────────────────────────────────────────────────────────
interface ErrorGroup {
  pattern: string;
  count: number;
  lastSeen: string;
}
const errorGroups = computed<ErrorGroup[]>(() => {
  const errs = errorPatterns();
  const runs = allRuns.value;
  return errs
    .map((pattern) => {
      const matches = runs.filter((r) => r.errorPattern === pattern);
      const lastSeen = matches.length
        ? fmtAge(Math.min(...matches.map((m) => m.ageMin)))
        : "—";
      return { pattern, count: matches.length, lastSeen };
    })
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count);
});
const errorGroupCount = computed(() => errorGroups.value.length);

// ── Chart options ────────────────────────────────────────────────────────
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return (
    getComputedStyle(document.body).getPropertyValue(name).trim() || fallback
  );
}

const responseChartOption = computed(() => {
  const lineColor = cssVar("--o2-primary-color", "#3b82f6");
  const axisColor = cssVar("--o2-text-caption", "#6c707e");
  const splitColor = cssVar("--o2-border-color", "#e2e8f0");
  const p95Color = cssVar("--o2-status-warning-text", "#f59e0b");

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
                formatter: "p95 " + p95Label.value,
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
  const axisColor = cssVar("--o2-text-caption", "#6c707e");
  const splitColor = cssVar("--o2-border-color", "#e2e8f0");
  const errorColor = cssVar("--o2-status-error-text", "#dc2626");

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
    grid: { left: 44, right: 16, top: 16, bottom: 28 },
    tooltip: {
      trigger: "axis" as const,
      valueFormatter: (val: number) => String(val) + " failures",
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
  if (idx >= 0 && synthetics.hasLoadedOnce.value) {
    const realRun = synthetics.runs.value[idx];
    if (realRun?.runId && realRun?.executionId) {
      emit("open-run", realRun.runId, realRun.executionId);
      return;
    }
  }
  emit("open-run", String(row.id), "");
}

function toggleStepGroup(key: string) {
  expandedRows.value = {
    ...expandedRows.value,
    [key]: !expandedRows.value[key],
  };
}

// ── Public API — parent drives all (re)loads ─────────────────────────────
async function refresh(startTime?: number, endTime?: number) {
  if (!startTime || !endTime) return;
  timeRangeMicros.value = { startTime, endTime };
  await synthetics.fetchAll(props.monitorId, startTime, endTime);
}

defineExpose({ refresh });
</script>
