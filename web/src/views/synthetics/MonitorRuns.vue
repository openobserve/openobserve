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

  Three tabs (OTabs):
    - Overview: KPI cards, charts, breakdown cards, filter bar, runs table
    - Steps: Cross-run step analysis with expandable rows
    - Errors: Error pattern grouping

  This component is chrome-less — it does NOT render AppPageHeader.
  The parent (MonitorResults.vue) owns the header. This component is the
  content below it, following the LLMInsightsDashboard pattern.
-->

<template>
  <div
    class="monitor-runs tw:h-full tw:flex tw:flex-col"
    data-test="synthetics-monitor-runs"
  >
    <!-- ── Tabs ──────────────────────────────────────────────────────── -->
    <OTabs
      v-model="activeTab"
      class="tw:shrink-0 tw:px-5 tw:border-b tw:border-border-default"
    >
      <OTab name="overview" data-test="monitor-runs-tab-overview">
        Overview
      </OTab>
      <OTab name="steps" data-test="monitor-runs-tab-steps"> Steps </OTab>
      <OTab name="errors" data-test="monitor-runs-tab-errors">
        Errors
        <OBadge
          v-if="errorGroupCount > 0"
          variant="error"
          size="sm"
          class="tw:ml-1"
        >
          {{ errorGroupCount }}
        </OBadge>
      </OTab>
    </OTabs>

    <div class="tw:flex-1 tw:min-h-0">
      <OTabPanels
        v-model="activeTab"
        grow
        scroll="y"
        class="tw:h-full tw:min-h-0"
      >
        <!-- ════════════ OVERVIEW ════════════ -->
        <OTabPanel name="overview">
          <div
            class="tw:max-w-[85rem] tw:mx-auto tw:px-5 tw:py-[0.875rem] tw:pb-[1.75rem] tw:flex tw:flex-col tw:gap-[0.875rem]"
          >
            <!-- Status Timeline -->
            <OCard>
              <OCardSection role="header" class="tw:gap-2">
                <span class="tw:font-bold tw:text-xs tw:text-text-heading">
                  Status Timeline
                </span>
                <span class="tw:flex-1" />
                <span
                  class="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-text-secondary"
                >
                  <span
                    class="tw:w-[7px] tw:h-[7px] tw:rounded-full tw:bg-status-error-text"
                  />
                  {{ timelineFailCount }} Failed
                </span>
                <span
                  class="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-text-secondary"
                >
                  <span
                    class="tw:w-[7px] tw:h-[7px] tw:rounded-full tw:bg-[var(--o2-status-success-text)]"
                  />
                  {{ timelinePassCount }} Passed
                </span>
              </OCardSection>
              <OSeparator />
              <OCardSection
                role="body"
                class="tw:flex tw:flex-col tw:gap-1 tw:py-2"
              >
                <div
                  class="tw:flex tw:w-full tw:h-[26px] tw:rounded tw:overflow-hidden tw:gap-0.5"
                >
                  <div
                    v-for="(seg, i) in timelineSegments"
                    :key="i"
                    class="tw:min-w-[3px] tw:h-full"
                    :style="{ width: seg.pct, background: seg.color }"
                    :title="seg.title"
                  />
                </div>
                <div
                  class="tw:flex tw:justify-between tw:text-[10.5px] tw:font-mono tw:tabular-nums tw:text-text-secondary"
                >
                  <span>{{ timelineStartLabel }}</span>
                  <span>{{ timelineEndLabel }}</span>
                </div>
              </OCardSection>
            </OCard>

            <!-- KPI Cards — LLMInsightsDashboard style -->
            <div class="tw:grid tw:grid-cols-4 tw:gap-[0.625rem]">
              <div
                v-for="card in kpiCards"
                :key="card.key"
                class="card-container tw:rounded-lg tw:flex tw:flex-col tw:px-[0.875rem] tw:pt-[0.625rem] tw:pb-[0.625rem] tw:gap-[0.25rem]"
                :data-test="`monitor-runs-kpi-${card.key}`"
              >
                <div
                  class="kpi-label tw:text-[0.7rem] tw:font-semibold tw:text-[var(--o2-text-muted)]"
                >
                  {{ card.label }}
                </div>
                <div class="tw:flex tw:items-baseline tw:gap-[0.2rem]">
                  <span
                    class="tw:text-[1.4rem] tw:font-bold tw:leading-none tw:text-[var(--o2-text-primary)]"
                    :class="card.valueClass"
                  >
                    {{ card.value }}
                  </span>
                  <span
                    v-if="card.unit"
                    class="tw:text-[0.8rem] tw:font-semibold tw:text-[var(--o2-text-secondary)]"
                  >
                    {{ card.unit }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Charts row -->
            <div class="tw:grid tw:grid-cols-2 tw:gap-[0.875rem]">
              <OCard>
                <OCardSection role="header" class="tw:gap-2">
                  <span class="tw:font-bold tw:text-sm tw:text-text-heading">
                    Response Time
                  </span>
                  <span class="tw:flex-1" />
                  <OBadge variant="default" size="sm">
                    p95 {{ p95Label }}
                  </OBadge>
                </OCardSection>
                <OSeparator />
                <OCardSection role="body" class="tw:p-0 tw:min-h-[180px]">
                  <ChartRenderer
                    :data="{ options: responseChartOption }"
                    height="180px"
                  />
                </OCardSection>
              </OCard>
              <OCard>
                <OCardSection role="header" class="tw:gap-2">
                  <span class="tw:font-bold tw:text-sm tw:text-text-heading">
                    Errors Over Time
                  </span>
                  <span class="tw:flex-1" />
                  <OBadge variant="error" size="sm">
                    {{ failCount }} failed
                  </OBadge>
                </OCardSection>
                <OSeparator />
                <OCardSection role="body" class="tw:p-0 tw:min-h-[180px]">
                  <ChartRenderer
                    :data="{ options: errorChartOption }"
                    height="180px"
                  />
                </OCardSection>
              </OCard>
            </div>

            <!-- Breakdown cards -->
            <div class="tw:grid tw:grid-cols-3 tw:gap-[0.875rem]">
              <OCard>
                <OCardSection role="header" class="tw:gap-2">
                  <OIcon name="public" size="sm" class="tw:text-primary-700" />
                  <span class="tw:font-bold tw:text-sm tw:text-text-heading">
                    Pass Rate by Browser
                  </span>
                </OCardSection>
                <OSeparator />
                <OCardSection role="body">
                  <div
                    v-for="b in browserBreakdown"
                    :key="b.name"
                    class="tw:flex tw:items-center tw:gap-3 tw:py-[9px] tw:border-b tw:border-border-default tw:last:border-b-0"
                  >
                    <OIcon
                      :name="b.icon"
                      size="sm"
                      class="tw:text-text-secondary tw:flex-none"
                    />
                    <span
                      class="tw:w-20 tw:flex-none tw:font-semibold tw:text-xs tw:text-text-heading"
                    >
                      {{ b.name }}
                    </span>
                    <div
                      class="tw:flex-1 tw:h-1.5 tw:rounded-full tw:bg-grey-100 tw:overflow-hidden tw:min-w-[40px]"
                    >
                      <div
                        class="tw:h-full tw:rounded-full"
                        :style="{ width: b.pct, background: b.barColor }"
                      />
                    </div>
                    <span
                      class="tw:font-mono tw:tabular-nums tw:font-bold tw:text-xs tw:w-12 tw:text-right"
                      :style="{ color: b.textColor }"
                    >
                      {{ b.pct }}
                    </span>
                  </div>
                </OCardSection>
              </OCard>
              <OCard>
                <OCardSection role="header" class="tw:gap-2">
                  <OIcon
                    name="distance"
                    size="sm"
                    class="tw:text-primary-700"
                  />
                  <span class="tw:font-bold tw:text-sm tw:text-text-heading">
                    Pass Rate by Location
                  </span>
                </OCardSection>
                <OSeparator />
                <OCardSection role="body">
                  <div
                    v-for="l in locationBreakdown"
                    :key="l.name"
                    class="tw:flex tw:items-center tw:gap-3 tw:py-[9px] tw:border-b tw:border-border-default tw:last:border-b-0"
                  >
                    <span
                      class="tw:w-2 tw:h-2 tw:rounded-full tw:flex-none"
                      :style="{ background: l.dot }"
                    />
                    <span
                      class="tw:w-[110px] tw:flex-none tw:font-semibold tw:text-xs tw:text-text-heading"
                    >
                      {{ l.name }}
                    </span>
                    <div
                      class="tw:flex-1 tw:h-1.5 tw:rounded-full tw:bg-grey-100 tw:overflow-hidden tw:min-w-[40px]"
                    >
                      <div
                        class="tw:h-full tw:rounded-full"
                        :style="{ width: l.pct, background: l.barColor }"
                      />
                    </div>
                    <span
                      class="tw:font-mono tw:tabular-nums tw:font-bold tw:text-xs tw:w-12 tw:text-right"
                      :style="{ color: l.textColor }"
                    >
                      {{ l.pct }}
                    </span>
                  </div>
                </OCardSection>
              </OCard>
              <OCard>
                <OCardSection role="header" class="tw:gap-2">
                  <OIcon name="devices" size="sm" class="tw:text-primary-700" />
                  <span class="tw:font-bold tw:text-sm tw:text-text-heading">
                    Pass Rate by Device
                  </span>
                </OCardSection>
                <OSeparator />
                <OCardSection role="body">
                  <div
                    v-for="d in deviceBreakdown"
                    :key="d.name"
                    class="tw:flex tw:items-center tw:gap-3 tw:py-[9px] tw:border-b tw:border-border-default tw:last:border-b-0"
                  >
                    <OIcon
                      :name="d.icon"
                      size="sm"
                      class="tw:text-text-secondary tw:flex-none"
                    />
                    <span
                      class="tw:w-20 tw:flex-none tw:font-semibold tw:text-xs tw:text-text-heading"
                    >
                      {{ d.name }}
                    </span>
                    <div
                      class="tw:flex-1 tw:h-1.5 tw:rounded-full tw:bg-grey-100 tw:overflow-hidden tw:min-w-[40px]"
                    >
                      <div
                        class="tw:h-full tw:rounded-full"
                        :style="{ width: d.pct, background: d.barColor }"
                      />
                    </div>
                    <span
                      class="tw:font-mono tw:tabular-nums tw:font-bold tw:text-xs tw:w-12 tw:text-right"
                      :style="{ color: d.textColor }"
                    >
                      {{ d.pct }}
                    </span>
                  </div>
                </OCardSection>
              </OCard>
            </div>

            <!-- Filter bar -->
            <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
              <OToggleGroup v-model="statusFilter" variant="default">
                <OToggleGroupItem
                  v-for="so in statusOptions"
                  :key="so.key"
                  :value="so.key"
                  size="sm"
                >
                  <template #icon-left>
                    <span
                      class="tw:w-[7px] tw:h-[7px] tw:rounded-full"
                      :style="{ background: so.dot }"
                    />
                  </template>
                  {{ so.label }}
                </OToggleGroupItem>
              </OToggleGroup>

              <OSelect
                v-model="browserFilter"
                :options="browserOptions"
                size="md"
                class="tw:w-35!"
                data-test="monitor-runs-filter-browser"
              />
              <OSelect
                v-model="deviceFilter"
                :options="deviceOptions"
                size="md"
                class="tw:w-35!"
                data-test="monitor-runs-filter-device"
              />
              <OSelect
                v-model="locationFilter"
                :options="locationOptions"
                size="md"
                class="tw:w-35!"
                data-test="monitor-runs-filter-location"
              />

              <!-- Failure-specific filters -->
              <template v-if="statusFilter === 'fail' && false">
                <OSeparator orientation="vertical" class="tw:h-5" />
                <OSelect
                  v-model="failedStepFilter"
                  :options="failedStepOptions"
                  size="sm"
                  class="tw:w-[160px]"
                  data-test="monitor-runs-filter-step"
                />
                <OInput
                  v-model="locatorFilter"
                  size="sm"
                  placeholder="Locator contains…"
                  class="tw:w-[170px]"
                  data-test="monitor-runs-filter-locator"
                />
                <OSelect
                  v-model="actionFilter"
                  :options="actionOptions"
                  size="sm"
                  class="tw:w-[130px]"
                  data-test="monitor-runs-filter-action"
                />
              </template>

              <span class="tw:flex-1" />
              <span class="tw:text-xs tw:text-text-secondary">
                {{ filteredRuns.length }} of {{ allRuns.length }} runs
              </span>
            </div>

            <!-- Error filter indicator -->
            <div
              v-if="errorFilter"
              class="tw:flex tw:items-center tw:gap-2"
              data-test="monitor-runs-error-filter-badge"
            >
              <span class="tw:text-xs tw:text-text-secondary"
                >Filtering by error:</span
              >
              <OBadge variant="error" size="sm" class="tw:gap-1">
                {{ errorFilter }}
                <button
                  class="tw:inline-flex tw:items-center tw:justify-center tw:cursor-pointer tw:bg-transparent tw:border-none tw:p-0 tw:text-inherit"
                  @click="clearErrorFilter"
                >
                  <OIcon name="close" size="xs" />
                </button>
              </OBadge>
            </div>

            <!-- Runs table -->
            <OCard class="tw:p-0">
              <OTable
                :columns="runColumns"
                :data="visibleRuns"
                :loading="loading"
                pagination="client"
                :page-size="20"
                :page-size-options="[10, 20, 25, 50]"
                row-key="id"
                :show-global-filter="false"
                :empty-message="'No runs match'"
                data-test="monitor-runs-runs-table"
                @row-click="openRun"
              >
                <template #cell-status="{ row }">
                  <OBadge
                    :variant="(row as VisibleRun).statusBadgeVariant"
                    size="sm"
                    :icon="(row as VisibleRun).statusIcon"
                  >
                    {{ (row as VisibleRun).statusLabel }}
                  </OBadge>
                </template>
                <template #cell-scheduled_at="{ row }">
                  <span class="tw:text-xs tw:text-text-secondary tw:font-mono tw:tabular-nums">
                    {{ (row as VisibleRun).scheduledAt }}
                  </span>
                </template>
                <template #cell-duration="{ row }">
                  <span
                    class="tw:font-mono tw:tabular-nums tw:text-xs"
                    :style="{ color: (row as VisibleRun).durColor }"
                  >
                    {{ (row as VisibleRun).duration }}
                  </span>
                </template>
                <template #cell-location="{ row }">
                  <span class="tw:text-xs tw:text-text-secondary">
                    {{ (row as VisibleRun).location }}
                  </span>
                </template>
                <template #cell-browser="{ row }">
                  <span class="tw:text-xs tw:text-text-secondary">
                    {{ (row as VisibleRun).browser }}
                  </span>
                </template>
                <template #cell-device="{ row }">
                  <span class="tw:text-xs tw:text-text-secondary">
                    {{ (row as VisibleRun).device }}
                  </span>
                </template>
                <template #cell-error="{ row }">
                  <span
                    v-if="(row as VisibleRun).errorSnippet"
                    class="tw:cursor-pointer"
                    @click.stop="
                      filterByError((row as VisibleRun).errorPattern)
                    "
                  >
                    <OBadge
                      variant="error-outline"
                      size="sm"
                      class="tw:truncate tw:max-w-[200px]"
                    >
                      {{ (row as VisibleRun).errorSnippet }}
                    </OBadge>
                  </span>
                </template>
                <template #cell-trigger_type="{ row }">
                  <span class="tw:text-xs tw:text-text-secondary">
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
            class="tw:max-w-[85rem] tw:mx-auto tw:px-5 tw:py-[0.875rem] tw:pb-[1.75rem] tw:flex tw:flex-col tw:gap-[0.875rem]"
          >
            <div class="tw:flex tw:items-center tw:gap-2.5">
              <span class="tw:font-bold tw:text-sm tw:text-text-heading">
                Cross-run step analysis
              </span>
              <span class="tw:text-xs tw:text-text-secondary">
                Grouped over {{ windowLabel }} &middot;
                {{ allRuns.length }} runs
              </span>
              <span class="tw:flex-1" />
              <OToggleGroup v-model="stepsGroupBy" variant="default">
                <OToggleGroupItem value="step" size="sm"
                  >By Step Name</OToggleGroupItem
                >
                <OToggleGroupItem value="locator" size="sm"
                  >By Locator</OToggleGroupItem
                >
              </OToggleGroup>
            </div>

            <OCard class="tw:p-0">
              <div
                class="tw:grid tw:grid-cols-[1fr_110px_120px_110px_1fr_1fr_32px] tw:gap-2.5 tw:px-4 tw:py-2 tw:bg-surface-subtle tw:border-b tw:border-border-default tw:text-[11px] tw:font-semibold tw:text-text-secondary tw:uppercase tw:tracking-wide"
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
                    class="tw:grid tw:grid-cols-[1fr_110px_120px_110px_1fr_1fr_32px] tw:gap-2.5 tw:px-4 tw:py-2.5 tw:border-b tw:border-border-default tw:items-center tw:cursor-pointer tw:hover:bg-surface-subtle"
                    @click="toggleStepGroup(g._key)"
                  >
                    <div class="tw:min-w-0">
                      <div
                        class="tw:font-semibold tw:text-xs tw:text-text-heading tw:truncate"
                        :class="
                          stepsGroupBy === 'locator'
                            ? 'tw:font-mono tw:tabular-nums'
                            : ''
                        "
                      >
                        {{ g.name }}
                      </div>
                      <div
                        v-if="g.sub"
                        class="tw:text-[11px] tw:text-text-secondary"
                      >
                        {{ g.sub }}
                      </div>
                    </div>
                    <div class="tw:flex tw:flex-col tw:gap-1">
                      <span
                        class="tw:font-mono tw:tabular-nums tw:font-bold tw:text-xs"
                        :style="{ color: g.failColor }"
                      >
                        {{ g.failRate }}
                      </span>
                      <div
                        class="tw:h-[5px] tw:rounded-full tw:bg-grey-100 tw:overflow-hidden"
                      >
                        <div
                          class="tw:h-full tw:rounded-full"
                          :style="{
                            width: g.failRateBarPct,
                            background: g.failBarColor,
                          }"
                        />
                      </div>
                    </div>
                    <div class="tw:flex tw:flex-col tw:gap-1">
                      <span
                        class="tw:font-mono tw:tabular-nums tw:text-xs tw:text-text-body"
                      >
                        {{ g.avgDuration }}
                      </span>
                      <div
                        class="tw:h-[5px] tw:rounded-full tw:bg-grey-100 tw:overflow-hidden"
                      >
                        <div
                          class="tw:h-full tw:rounded-full tw:bg-primary-400"
                          :style="{ width: g.durationBarPct }"
                        />
                      </div>
                    </div>
                    <svg
                      viewBox="0 0 90 24"
                      class="tw:w-[90px] tw:h-6 tw:block"
                    >
                      <polyline
                        :points="g.trendPts"
                        fill="none"
                        :stroke="g.trendColor"
                        stroke-width="1.5"
                        vector-effect="non-scaling-stroke"
                      />
                    </svg>
                    <div class="tw:flex tw:gap-1.5 tw:flex-wrap">
                      <OBadge
                        v-for="bc in g.browserChips"
                        :key="bc.label"
                        size="sm"
                        :style="{ background: bc.bg, color: bc.color }"
                      >
                        {{ bc.label }}
                      </OBadge>
                    </div>
                    <div class="tw:flex tw:gap-1.5 tw:flex-wrap">
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
                      class="tw:text-text-secondary tw:transition-transform tw:duration-150"
                      :class="{ 'tw:rotate-180': g.expanded }"
                    />
                  </div>
                  <div
                    v-if="g.expanded"
                    class="tw:grid tw:grid-cols-2 tw:gap-4 tw:px-4 tw:py-3 tw:bg-surface-subtle tw:border-b tw:border-border-default"
                  >
                    <div>
                      <div
                        class="tw:text-[10px] tw:font-bold tw:text-text-secondary tw:uppercase tw:tracking-wide tw:mb-1.5"
                      >
                        Fail rate by browser
                      </div>
                      <div
                        v-for="br in g.browserRows"
                        :key="br.name"
                        class="tw:flex tw:items-center tw:gap-2.5 tw:py-1"
                      >
                        <span
                          class="tw:w-[70px] tw:text-xs tw:text-text-body"
                          >{{ br.name }}</span
                        >
                        <div
                          class="tw:flex-1 tw:h-1.5 tw:rounded-full tw:bg-grey-100 tw:overflow-hidden"
                        >
                          <div
                            class="tw:h-full tw:rounded-full"
                            :style="{ width: br.pct, background: br.barColor }"
                          />
                        </div>
                        <span
                          class="tw:font-mono tw:tabular-nums tw:text-xs tw:text-text-secondary tw:w-10 tw:text-right"
                          >{{ br.pct }}</span
                        >
                      </div>
                    </div>
                    <div>
                      <div
                        class="tw:text-[10px] tw:font-bold tw:text-text-secondary tw:uppercase tw:tracking-wide tw:mb-1.5"
                      >
                        Fail rate by location
                      </div>
                      <div
                        v-for="lr in g.locationRows"
                        :key="lr.name"
                        class="tw:flex tw:items-center tw:gap-2.5 tw:py-1"
                      >
                        <span
                          class="tw:w-[90px] tw:text-xs tw:text-text-body"
                          >{{ lr.name }}</span
                        >
                        <div
                          class="tw:flex-1 tw:h-1.5 tw:rounded-full tw:bg-grey-100 tw:overflow-hidden"
                        >
                          <div
                            class="tw:h-full tw:rounded-full"
                            :style="{ width: lr.pct, background: lr.barColor }"
                          />
                        </div>
                        <span
                          class="tw:font-mono tw:tabular-nums tw:text-xs tw:text-text-secondary tw:w-10 tw:text-right"
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
            class="tw:max-w-[85rem] tw:mx-auto tw:px-5 tw:py-[0.875rem] tw:pb-[1.75rem] tw:flex tw:flex-col tw:gap-[0.875rem]"
          >
            <div class="tw:flex tw:items-center tw:gap-2.5">
              <span class="tw:font-bold tw:text-sm tw:text-text-heading">
                Error patterns
              </span>
              <span class="tw:text-xs tw:text-text-secondary">
                Normalized across {{ windowLabel }} &middot; click a row to
                filter runs
              </span>
            </div>

            <OCard class="tw:p-0">
              <div
                class="tw:grid tw:grid-cols-[1fr_100px_160px_32px] tw:gap-2.5 tw:px-4 tw:py-2 tw:bg-surface-subtle tw:border-b tw:border-border-default tw:text-[11px] tw:font-semibold tw:text-text-secondary tw:uppercase tw:tracking-wide"
              >
                <span>Error Pattern</span>
                <span>Count</span>
                <span>Last Seen</span>
                <span />
              </div>
              <div
                v-for="e in errorGroups"
                :key="e.pattern"
                class="tw:grid tw:grid-cols-[1fr_100px_160px_32px] tw:gap-2.5 tw:px-4 tw:py-[11px] tw:border-b tw:border-border-default tw:items-center tw:cursor-pointer tw:hover:bg-surface-subtle"
                data-test="monitor-runs-error-row"
                @click="filterByErrorPattern(e.pattern)"
              >
                <span
                  class="tw:font-mono tw:tabular-nums tw:text-xs tw:text-text-heading tw:truncate"
                >
                  {{ e.pattern }}
                </span>
                <span class="tw:font-bold tw:text-sm tw:text-status-error-text">
                  {{ e.count }}
                </span>
                <span class="tw:text-xs tw:text-text-secondary">
                  {{ e.lastSeen }}
                </span>
                <OIcon
                  name="filter_alt"
                  size="sm"
                  class="tw:text-text-secondary"
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
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OInput from "@/lib/forms/Input/OInput.vue";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import useSyntheticResults from "@/composables/useSyntheticResults";
import type { SyntheticRun } from "@/composables/synthetics/syntheticResultsSchema";

defineOptions({ name: "SyntheticMonitorRuns" });

const emit = defineEmits<{
  (e: "edit"): void;
  (e: "open-run", runId: string): void;
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
  ageMin: number;
  scheduledTs: number;
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

function generateRuns(): MockRun[] {
  const r = seedRand(77);
  const locations = ["us-east-1", "eu-west-1", "ap-south-1"];
  const browsers = ["Chromium", "Firefox", "WebKit"];
  const devices = ["Desktop", "Mobile"];
  const steps = stepNames();
  const meta = stepMeta();
  const errs = errorPatterns();
  const runs: MockRun[] = [];
  const N = 26;
  for (let i = 0; i < N; i++) {
    const idNum = 4821 - i;
    const isFail = r() < 0.22;
    const dur = isFail
      ? Math.round(20000 + r() * 15000)
      : Math.round(1800 + r() * 3200);
    const errIdx = Math.floor(r() * errs.length);
    const failedStep = isFail ? steps[8 + Math.floor(r() * 4)] : null;
    const locator = failedStep ? meta[failedStep].locator : null;
    const ageMinVal = i * 17 + Math.floor(r() * 6);
    runs.push({
      id: idNum,
      ageMin: ageMinVal,
      scheduledTs: Date.now() - ageMinVal * 60 * 1000,
      triggerType: "schedule",
      duration: dur,
      status: isFail ? ("fail" as const) : ("pass" as const),
      location: locations[Math.floor(r() * locations.length)],
      browser: browsers[Math.floor(r() * browsers.length)],
      device: devices[r() < 0.85 ? 0 : 1],
      failedStep,
      locator,
      action: failedStep
        ? ["Place order", "Go to checkout", "Add to cart"].includes(failedStep)
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
function fmtScheduledTs(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
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
const windowLabel = ref("Last 24 hours");
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

// ── Select options ───────────────────────────────────────────────────────
const browserOptions: SelectOption[] = [
  { label: "All browsers", value: "all" },
  { label: "Chromium", value: "Chromium" },
  { label: "Firefox", value: "Firefox" },
  { label: "WebKit", value: "WebKit" },
];
const deviceOptions: SelectOption[] = [
  { label: "All devices", value: "all" },
  { label: "Desktop", value: "Desktop" },
  { label: "Mobile", value: "Mobile" },
];
const locationOptions: SelectOption[] = [
  { label: "All locations", value: "all" },
  { label: "us-east-1", value: "us-east-1" },
  { label: "eu-west-1", value: "eu-west-1" },
  { label: "ap-south-1", value: "ap-south-1" },
];
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
    ageMin: Math.round((Date.now() / 1000 - r.timestamp) / 60),
    scheduledTs: r.scheduledTs,
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
const totalPasses = computed(
  () => allRuns.value.filter((r) => r.status === "pass").length,
);

const p95Label = computed(() =>
  synthetics.hasLoadedOnce.value && synthetics.kpi.value.p95Ms > 0
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
  if (synthetics.hasLoadedOnce.value) {
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
        key: "failed-runs",
        label: "Failed Runs",
        value: String(k.failedRuns),
        valueClass: k.failedRuns > 0 ? "tw:text-status-error-text!" : undefined,
      },
      {
        key: "last-run",
        label: "Last Run",
        value: k.lastRunStatus
          ? k.lastRunStatus === "failed"
            ? "Failed"
            : "Passed"
          : "—",
        unit: k.lastRunAt
          ? fmtAge(Math.round((Date.now() - k.lastRunAt) / 60000)) +
            " · Next in 3 min"
          : undefined,
        valueClass:
          k.lastRunStatus === "failed"
            ? "tw:text-status-error-text!"
            : "tw:text-status-success-text!",
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
    {
      key: "failed-runs",
      label: "Failed Runs",
      value: String(totalFails.value),
    },
    {
      key: "last-run",
      label: "Last Run",
      value: lastRun?.status === "fail" ? "Failed" : "Passed",
      unit: lastRun ? fmtAge(lastRun.ageMin) + " · Next in 3 min" : undefined,
      valueClass:
        lastRun?.status === "fail"
          ? "tw:text-status-error-text!"
          : "tw:text-status-success-text!",
    },
  ];
});

// ── Status timeline ──────────────────────────────────────────────────────
const timelineSegments = computed(() => {
  const chronological = [...allRuns.value].sort((a, b) => b.ageMin - a.ageMin);
  const totalSpan = chronological.length ? chronological[0].ageMin || 1 : 1;
  const rawSegments = chronological.map((run, i) => {
    const nextAge =
      i < chronological.length - 1 ? chronological[i + 1].ageMin : 0;
    return { status: run.status, width: Math.max(run.ageMin - nextAge, 0) };
  });
  const merged: { status: string; width: number }[] = [];
  rawSegments.forEach((seg) => {
    const last = merged[merged.length - 1];
    if (last && last.status === seg.status) last.width += seg.width;
    else merged.push({ ...seg });
  });
  return merged.map((seg) => ({
    pct: ((seg.width / totalSpan) * 100).toFixed(2) + "%",
    color:
      seg.status === "fail"
        ? "var(--o2-status-error-text)"
        : "var(--o2-status-success-text)",
    title:
      (seg.status === "fail" ? "Failed" : "Passed") +
      " · ~" +
      Math.max(1, Math.round(seg.width)) +
      " min",
  }));
});
const timelineFailCount = computed(() => String(totalFails.value));
const timelinePassCount = computed(() => String(totalPasses.value));
const timelineStartLabel = computed(
  () => windowLabel.value.replace("Last ", "") + " ago",
);
const timelineEndLabel = "Now";

// ── Breakdowns ───────────────────────────────────────────────────────────
interface BreakdownItem {
  name: string;
  icon?: string;
  dot?: string;
  pct: string;
  barColor: string;
  textColor: string;
}
const browserBreakdown = computed<BreakdownItem[]>(() => {
  const names = ["Chromium", "Firefox", "WebKit"];
  const icons = ["language", "travel_explore", "explore"];
  return names.map((name, i) => {
    const br = allRuns.value.filter((r) => r.browser === name);
    const pass = br.filter((r) => r.status === "pass").length;
    const pct = br.length ? Math.round((pass / br.length) * 100) : 100;
    return {
      name,
      icon: icons[i],
      pct: pct + "%",
      barColor:
        pct >= 95
          ? "var(--o2-status-success-text)"
          : pct >= 85
            ? "var(--o2-warning-500)"
            : "var(--o2-status-error-text)",
      textColor:
        pct >= 95
          ? "var(--o2-success-700)"
          : pct >= 85
            ? "var(--o2-warning-700)"
            : "var(--o2-status-error-text)",
    };
  });
});
const locationBreakdown = computed<BreakdownItem[]>(() => {
  const names = ["us-east-1", "eu-west-1", "ap-south-1"];
  return names.map((name) => {
    const lr = allRuns.value.filter((r) => r.location === name);
    const pass = lr.filter((r) => r.status === "pass").length;
    const pct = lr.length ? Math.round((pass / lr.length) * 100) : 100;
    return {
      name,
      dot:
        pct >= 95
          ? "var(--o2-status-success-text)"
          : pct >= 85
            ? "var(--o2-warning-500)"
            : "var(--o2-status-error-text)",
      pct: pct + "%",
      barColor:
        pct >= 95
          ? "var(--o2-status-success-text)"
          : pct >= 85
            ? "var(--o2-warning-500)"
            : "var(--o2-status-error-text)",
      textColor:
        pct >= 95
          ? "var(--o2-success-700)"
          : pct >= 85
            ? "var(--o2-warning-700)"
            : "var(--o2-status-error-text)",
    };
  });
});
const deviceBreakdown = computed<BreakdownItem[]>(() => {
  return ["Desktop", "Mobile"].map((name) => {
    const dr = allRuns.value.filter((r) => r.device === name);
    const pass = dr.filter((r) => r.status === "pass").length;
    const pct = dr.length ? Math.round((pass / dr.length) * 100) : 100;
    return {
      name,
      icon: name === "Desktop" ? "computer" : "smartphone",
      pct: pct + "%",
      barColor:
        pct >= 95
          ? "var(--o2-status-success-text)"
          : pct >= 85
            ? "var(--o2-warning-500)"
            : "var(--o2-status-error-text)",
      textColor:
        pct >= 95
          ? "var(--o2-success-700)"
          : pct >= 85
            ? "var(--o2-warning-700)"
            : "var(--o2-status-error-text)",
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
  scheduledAt: string;
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
      statusBadgeVariant: isFail ? "error-outline" : "success-outline",
      statusIcon: isFail ? "cancel" : "check_circle",
      statusLabel: isFail ? "Failed" : "Passed",
      scheduledAt: fmtScheduledTs(run.scheduledTs),
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
  { id: "status", header: "Status", accessorKey: "status", size: 110 },
  { id: "scheduled_at", header: "Scheduled At", accessorKey: "scheduledAt", size: 160 },
  {
    id: "duration",
    header: "Duration",
    accessorKey: "duration",
    size: 90,
    meta: { align: "right" },
  },
  { id: "location", header: "Location", accessorKey: "location", size: 110 },
  { id: "browser", header: "Browser", accessorKey: "browser", size: 100 },
  { id: "device", header: "Device", accessorKey: "device", size: 90 },
  { id: "trigger_type", header: "Trigger", accessorKey: "triggerType", size: 90 },
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

  // Use real histogram data when available, fall back to seeded mock
  let seriesData: [number, number][];
  if (synthetics.hasLoadedOnce.value && synthetics.buckets.value.length > 0) {
    // p95 per bucket
    seriesData = synthetics.buckets.value.map((b) => [b.tsMs, b.p95Ms] as [number, number]);
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
  if (synthetics.hasLoadedOnce.value && synthetics.buckets.value.length > 0) {
    categories = synthetics.buckets.value.map((b) => {
      const d = new Date(b.tsMs);
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
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
        date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
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
    if (realRun?.runId) {
      emit("open-run", realRun.runId);
      return;
    }
  }
  emit("open-run", String(row.id));
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
  await synthetics.fetchAll(props.monitorId, startTime, endTime);
}

defineExpose({ refresh });
</script>
