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
  <div class="flex min-h-0 flex-1 flex-col" data-test="metrics-detail">
    <div
      v-if="loading"
      class="flex flex-1 flex-col items-center justify-center gap-2.5 opacity-80"
      data-test="metrics-detail-loading"
    >
      <OSpinner size="lg" />
      <span>{{ t("metrics.explorer.detail.loading") }}</span>
    </div>

    <OEmptyState
      v-else-if="!card"
      size="block"
      icon="search-off"
      :title="t('metrics.explorer.detail.notFound')"
      :description="t('metrics.explorer.detail.notFoundDesc', { name: metricName })"
      :action-label="t('metrics.explorer.detail.close')"
      data-test="metrics-detail-not-found"
      @action="$emit('close')"
    />

    <template v-else>
      <OPageHeader
        :title="raw(card.name)"
        :subtitle="card.help ? raw(card.help) : undefined"
        title-data-test="metrics-detail-title"
        :back="{
          label: t('metrics.explorer.detail.backTo'),
          onClick: () => $emit('close'),
          dataTest: 'metrics-detail-close',
        }"
      >
        <template #title-trail>
          <OTag
            type="metricType"
            :value="card.typeFilterBucket"
            class="shrink-0"
            data-test="metrics-detail-badge"
          />
          <!-- The function in effect, ⚙ override included: the same text the card shows. -->
          <span
            v-if="overview.footerLabel"
            class="text-text-secondary shrink-0 text-xs"
            data-test="metrics-detail-function"
            >{{ overview.footerLabel }}</span
          >
          <span
            v-if="unitLabel"
            class="text-text-secondary shrink-0 text-xs max-md:hidden"
            data-test="metrics-detail-unit"
            >{{ unitLabel }}</span
          >
          <!-- The subtitle truncates and hides on a phone; this always holds the whole sentence. -->
          <OButton
            v-if="card.help"
            variant="ghost"
            size="icon"
            icon-left="info-outline"
            class="shrink-0"
            :aria-label="t('metrics.explorer.card.helpAria', { name: card.name, help: card.help })"
            :data-test="`metrics-explorer-card-help-${card.name}`"
          >
            <OTooltip side="bottom" max-width="22.5rem">
              <template #content
                ><div class="whitespace-pre-wrap">{{ card.help }}</div></template
              >
            </OTooltip>
          </OButton>
        </template>
        <template #actions>
          <!-- An on toggle keeps its status beside it, so the viewer can see why markers are drawn. -->
          <template v-if="exemplarsEligible">
            <OSpinner
              v-if="exemplarsOn && exemplars?.status === 'loading'"
              size="xs"
              :data-test="`metrics-explorer-card-exemplars-loading-${card.name}`"
            />
            <OTag
              v-if="exemplarsOn && exemplars?.status === 'empty'"
              variant="default-soft"
              size="sm"
              :data-test="`metrics-explorer-card-exemplars-empty-${card.name}`"
              >{{ t("dashboard.exemplars.empty") }}</OTag
            >
            <OButton
              v-if="exemplarsOn && exemplars?.status === 'error'"
              variant="ghost-warning"
              size="icon-toolbar"
              icon-left="warning"
              :aria-label="t('dashboard.exemplars.loadFailed')"
              :data-test="`metrics-explorer-card-exemplars-error-${card.name}`"
            >
              <OTooltip side="bottom" align="end" max-width="22.5rem" hoverable>
                <template #content>
                  <div class="flex flex-col gap-1.5">
                    <div class="font-medium">{{ t("dashboard.exemplars.loadFailed") }}</div>
                    <div
                      class="whitespace-pre-wrap"
                      data-test="dashboard-panel-exemplars-error-message"
                    >
                      {{ exemplars?.errorMessage }}
                    </div>
                    <div>
                      <OButton
                        variant="outline"
                        size="xs"
                        icon-left="replay"
                        data-test="dashboard-panel-exemplars-retry"
                        @click="$emit('retry-exemplars')"
                      >
                        {{ t("dashboard.exemplars.retry") }}
                      </OButton>
                    </div>
                  </div>
                </template>
              </OTooltip>
            </OButton>
            <OButton
              variant="outline"
              size="sm-toolbar"
              icon-left="account-tree"
              :active="exemplarsOn"
              :aria-pressed="String(exemplarsOn)"
              :aria-label="exemplarsTooltip"
              :data-swaps-variant="exemplarsSwapsVariant ? 'percentiles' : undefined"
              :data-test="`metrics-explorer-card-exemplars-${card.name}`"
              @click="$emit('toggle-exemplars')"
            >
              <span class="max-md:hidden">{{ t("metrics.explorer.detail.exemplars") }}</span>
              <OTooltip :content="exemplarsTooltip" />
            </OButton>
          </template>
          <OButton
            v-if="card.configurable"
            variant="outline"
            size="sm-toolbar"
            icon-left="settings"
            :aria-label="t('metrics.explorer.card.configureAria', { name: card.name })"
            :data-test="`metrics-explorer-card-fn-${card.name}`"
            @click="$emit('configure')"
          >
            <span class="max-md:hidden">{{ t("metrics.explorer.card.configureTooltip") }}</span>
            <OTooltip :content="t('metrics.explorer.card.configureTooltip')" />
          </OButton>
          <OButton
            variant="outline"
            size="sm-toolbar"
            icon-left="edit"
            :aria-label="t('metrics.explorer.detail.openInVisualize')"
            data-test="metrics-detail-open-visualize"
            @click="$emit('open-visualize')"
          >
            <span class="max-md:hidden">{{ t("metrics.explorer.detail.openInVisualize") }}</span>
            <OTooltip :content="t('metrics.explorer.detail.openInVisualize')" />
          </OButton>
          <ODropdown
            v-if="drilldown.availability.value === 'available'"
            align="end"
            @update:open="onDrilldownOpen"
          >
            <template #trigger>
              <OButton
                variant="outline"
                size="sm-toolbar"
                icon-left="manage-search"
                icon-right="expand-more"
                :aria-label="t('metrics.explorer.detail.drilldown.button')"
                data-test="metrics-detail-drilldown"
              >
                <span class="max-md:hidden">{{
                  t("metrics.explorer.detail.drilldown.button")
                }}</span>
                <OTooltip
                  :content="t('metrics.explorer.detail.drilldown.help')"
                  max-width="22.5rem"
                />
              </OButton>
            </template>
            <div data-test="metrics-detail-drilldown-menu">
              <ODropdownItem v-if="drilldownMenu.kind === 'loading'" disabled>
                {{ t("metrics.explorer.detail.drilldown.loading") }}
              </ODropdownItem>
              <template v-else-if="drilldownMenu.kind === 'error'">
                <ODropdownItem disabled data-test="metrics-detail-drilldown-error">
                  {{
                    drilldownMenu.message === null
                      ? t("metrics.explorer.detail.drilldown.schemaError")
                      : raw(drilldownMenu.message)
                  }}
                </ODropdownItem>
                <ODropdownItem
                  icon-left="replay"
                  data-test="metrics-detail-drilldown-retry"
                  @select="onDrilldownRetry"
                >
                  {{ t("metrics.explorer.detail.drilldown.retry") }}
                </ODropdownItem>
              </template>
              <ODropdownItem
                v-else-if="drilldownMenu.kind === 'notice'"
                disabled
                data-test="metrics-detail-drilldown-notice"
              >
                {{ t(`metrics.explorer.detail.drilldown.${drilldownMenu.notice}` as const) }}
              </ODropdownItem>
              <ODropdownGroup
                v-else-if="drilldownMenu.kind === 'pickService'"
                :label="
                  t('metrics.explorer.detail.drilldown.pickService', { label: drilldownMenu.label })
                "
              >
                <ODropdownItem
                  v-for="value in drilldownMenu.values"
                  :key="value"
                  :data-test="`metrics-detail-drilldown-service-${value}`"
                  @select="onDrilldownPick($event, value)"
                >
                  {{ raw(value) }}
                </ODropdownItem>
                <ODropdownItem v-if="!drilldownMenu.values.length" disabled>
                  {{
                    t("metrics.explorer.detail.drilldown.noServiceValues", {
                      label: drilldownMenu.label,
                    })
                  }}
                </ODropdownItem>
              </ODropdownGroup>
              <template v-else-if="drilldownMenu.kind === 'streams'">
                <ODropdownGroup
                  v-for="signal in DRILLDOWN_SIGNALS"
                  :key="signal"
                  :label="t(`metrics.explorer.detail.drilldown.${signal}` as const)"
                >
                  <ODropdownItem
                    v-for="item in drilldownMenu[signal]"
                    :key="item.name"
                    :disabled="!item.openable"
                    :data-test="`metrics-detail-drilldown-${signal}-${item.name}`"
                    @select="drilldown.openStream(signal, item)"
                  >
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate">{{ raw(item.name) }}</span>
                      <span v-if="!item.openable" class="text-text-secondary text-xs">{{
                        t("metrics.explorer.detail.drilldown.noServiceField")
                      }}</span>
                    </span>
                  </ODropdownItem>
                  <ODropdownItem v-if="!drilldownMenu[signal].length" disabled>
                    {{
                      t(
                        signal === "logs"
                          ? "metrics.explorer.detail.drilldown.noLogsStream"
                          : "metrics.explorer.detail.drilldown.noTracesStream",
                        { service: drilldownMenu.service },
                      )
                    }}
                  </ODropdownItem>
                </ODropdownGroup>
              </template>
            </div>
          </ODropdown>
          <!-- A disabled button fires no pointer events, so the span is the tooltip's hover target. -->
          <OTooltip v-else :content="drilldownBlockedReason" max-width="22.5rem">
            <span class="inline-flex">
              <OButton
                variant="outline"
                size="sm-toolbar"
                disabled
                :aria-label="t('metrics.explorer.detail.drilldown.button')"
                data-test="metrics-detail-drilldown"
              >
                <template v-if="drilldown.availability.value === 'oss'" #icon-left>
                  <OIcon name="lock" size="sm" data-test="metrics-detail-drilldown-lock" />
                </template>
                <span class="max-md:hidden">{{
                  t("metrics.explorer.detail.drilldown.button")
                }}</span>
              </OButton>
            </span>
          </OTooltip>
          <CreateAlertAction
            variant="toolbar"
            source="explorer"
            :build="buildOverviewAlertPrefill"
            :disabled-reason="
              overview.queries.length ? null : t('metrics.explorer.detail.noAlertQuery')
            "
            data-test="metrics-detail-create-alert"
          />
          <OButton
            variant="ghost"
            size="icon-toolbar"
            :icon-left="isFavorite ? 'star' : 'star-outline'"
            :class="isFavorite ? 'text-favorite' : ''"
            :aria-label="
              isFavorite
                ? t('metrics.explorer.card.favoriteRemoveAria', { name: card.name })
                : t('metrics.explorer.card.favoriteAddAria', { name: card.name })
            "
            :aria-pressed="String(isFavorite)"
            data-test="metrics-detail-favorite"
            @click="$emit('toggle-favorite')"
          >
            <OTooltip
              :content="
                isFavorite
                  ? t('metrics.explorer.card.favoriteRemoveTooltip')
                  : t('metrics.explorer.card.favoriteAddTooltip')
              "
            />
          </OButton>
        </template>
      </OPageHeader>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <OContent class="flex flex-col gap-3 py-3">
          <!-- The engine ignores matchers on labels the metric lacks, so the chart is unfiltered by these. -->
          <OBanner
            v-if="inapplicableFilters.length"
            variant="info"
            icon="info"
            dense
            :content="
              t(
                'metrics.explorer.detail.filtersNotApplied',
                { filters: inapplicableFiltersText },
                inapplicableFilters.length,
              )
            "
            data-test="metrics-detail-filters-not-applied"
          />
          <!-- Selects own popovers, which the header's overflow menu would unmount, so they get a row here. -->
          <div
            v-if="compareEligible || forecastEligible"
            class="flex flex-wrap items-center gap-x-5 gap-y-2"
            data-test="metrics-detail-chart-options"
          >
            <div v-if="compareEligible" class="flex items-center gap-1.5">
              <label for="metrics-detail-compare" class="text-text-secondary text-xs">{{
                t("metrics.explorer.detail.compare.label")
              }}</label>
              <OSelect
                id="metrics-detail-compare"
                :model-value="compare ?? 'off'"
                :options="compareOptions"
                appearance="inline"
                size="sm"
                :searchable="false"
                class="min-w-20"
                data-test="metrics-detail-compare"
                @update:model-value="onCompareChange"
              />
            </div>
            <template v-if="forecastEligible">
              <div class="flex items-center gap-1.5">
                <label for="metrics-detail-forecast" class="text-text-secondary text-xs">{{
                  t("metrics.explorer.detail.forecast.label")
                }}</label>
                <OSelect
                  id="metrics-detail-forecast"
                  :model-value="forecast ?? 'off'"
                  :options="forecastOptions"
                  appearance="inline"
                  size="sm"
                  :searchable="false"
                  class="min-w-32"
                  data-test="metrics-detail-forecast"
                  @update:model-value="onForecastChange"
                />
                <OButton
                  variant="ghost"
                  size="icon"
                  icon-left="info-outline"
                  :aria-label="forecastMethodsHelp"
                  data-test="metrics-detail-forecast-help"
                >
                  <OTooltip side="bottom" max-width="22.5rem">
                    <template #content>
                      <div class="flex flex-col gap-1.5">
                        <div>{{ t("metrics.explorer.detail.forecast.linearHelp") }}</div>
                        <div>{{ t("metrics.explorer.detail.forecast.smoothedHelp") }}</div>
                      </div>
                    </template>
                  </OTooltip>
                </OButton>
              </div>
              <div v-if="forecast" class="flex items-center gap-1.5">
                <template v-if="forecastHorizonOptions.length > 1">
                  <label
                    for="metrics-detail-forecast-horizon"
                    class="text-text-secondary text-xs"
                    >{{ t("metrics.explorer.detail.forecast.horizon") }}</label
                  >
                  <OSelect
                    id="metrics-detail-forecast-horizon"
                    :model-value="forecastHorizonChoice"
                    :options="forecastHorizonOptions"
                    appearance="inline"
                    size="sm"
                    :searchable="false"
                    class="min-w-28"
                    data-test="metrics-detail-forecast-horizon"
                    @update:model-value="onForecastHorizonChange"
                  />
                </template>
                <template v-else>
                  <span class="text-text-secondary text-xs">{{
                    t("metrics.explorer.detail.forecast.horizon")
                  }}</span>
                  <span
                    class="text-text-body text-xs font-medium"
                    data-test="metrics-detail-forecast-horizon-auto"
                    >{{
                      t("metrics.explorer.detail.forecast.horizonComputed", {
                        duration: forecastHorizonText,
                      })
                    }}</span
                  >
                </template>
              </div>
            </template>
            <MetricOverlayKey
              v-if="compareShift || overviewState.forecast"
              class="ms-auto"
              :period="compareShift?.periodAsStr ?? null"
              :period-empty="overviewPeriodEmpty"
              :forecast="!!overviewState.forecast"
              data-test="metrics-detail-overlay-key"
            />
          </div>
          <section
            class="border-border-default rounded-surface relative h-60 border"
            data-test="metrics-detail-overview"
          >
            <OSpinner
              v-if="overviewRefreshing"
              size="xs"
              class="absolute top-1 right-1 z-10"
              data-test="metrics-detail-overview-refreshing"
            />
            <div
              v-if="overviewState.status === 'error'"
              class="text-text-secondary flex h-full flex-col items-center justify-center gap-1 text-xs"
              :title="overviewState.error"
            >
              <OIcon name="error" size="sm" class="text-error-600" />
              <span>{{ t("metrics.explorer.queryFailed") }}</span>
              <OButton variant="ghost-primary" size="xs" @click="loadOverview()">
                {{ t("metrics.explorer.retry") }}
              </OButton>
            </div>
            <div
              v-else-if="!overview.queries.length"
              class="text-text-secondary flex h-full items-center justify-center text-xs"
            >
              {{ t("metrics.explorer.detail.noPreview") }}
            </div>
            <div
              v-else-if="overviewState.status === 'done' && !overviewHasSamples"
              class="text-text-secondary flex h-full items-center justify-center text-xs"
            >
              {{ t("metrics.explorer.noData") }}
            </div>
            <MetricCardChart
              v-else-if="overviewState.status === 'done'"
              :results="overviewState.results"
              :shifted="overviewState.shifted ?? []"
              :step-seconds="overviewState.stepSeconds ?? 0"
              :forecast="overviewState.forecast ?? null"
              :queries="overviewQueries"
              :chart-type="overview.chartType"
              :unit="overviewUnit.unit"
              :unit-custom="overviewUnit.unitCustom ?? undefined"
              :bucket-unit="overviewBucketUnit.unit ?? undefined"
              :bucket-unit-custom="overviewBucketUnit.unitCustom ?? undefined"
              :color="color"
              :time-range="overviewState.timeRange"
              :injected-exemplars="exemplarsOn ? exemplars : undefined"
              :allow-alert-creation="true"
              @error="onOverviewRenderError"
            />
            <OSkeleton v-else class="h-full" animation="wave" />
          </section>
        </OContent>

        <OTabs
          :model-value="activeTab"
          class="border-border-default border-b"
          data-test="metrics-detail-tabs"
          @update:model-value="$emit('update:tab', $event)"
        >
          <OTab
            v-if="breakdownSupported"
            name="breakdown"
            :label="t('metrics.explorer.detail.tabBreakdown')"
          />
          <OTab name="related" :label="t('metrics.explorer.detail.tabRelated')" />
          <OTab name="used_in" :label="usedInLabel" />
        </OTabs>

        <OContent class="py-3">
          <MetricBreakdown
            v-if="activeTab === 'breakdown'"
            :card="card"
            :labels-by-stream="labelsByStream"
            :filters="filters"
            :time-range="timeRange"
            :selected-label="breakdownLabel"
            :rate-window="rateWindow"
            :panel-rate-window="panelRateWindow"
            :nan-guard="nanGuard"
            :color="color"
            :run-query="runBreakdownQuery"
            :compare="compareShift"
            :forecast="breakdownForecast"
            :step-seconds="stepSeconds"
            :variant="overview"
            :panel-queries="panelQueries"
            @update:selected-label="$emit('update:breakdownLabel', $event)"
            @add-filter="$emit('add-filter', $event)"
          />

          <MetricUsageList
            v-else-if="activeTab === 'used_in'"
            :usage="usage"
            :status="usageStatus"
            @retry="loadUsage(card?.name)"
          />

          <div v-else data-test="metrics-detail-related">
            <OEmptyState
              v-if="!related.length"
              size="inline"
              icon="search-off"
              :title="t('metrics.explorer.detail.related.empty')"
              data-test="metrics-detail-related-empty"
            />
            <div
              v-else
              class="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-md:grid-cols-1"
              data-test="metrics-detail-related-grid"
            >
              <MetricChartTile
                v-for="row in related"
                :key="row.name"
                class="hover:border-primary h-56 cursor-pointer"
                :queries="row.chart.queries"
                :chart-type="row.chart.chartType"
                :unit="row.chart.unit"
                :bucket-unit="row.chart.bucketUnit"
                :color="row.color"
                :time-range="timeRange"
                :run-query="row.runQuery"
                :data-test="`metrics-detail-related-card-${row.name}`"
                @select="$emit('open-related', row.name)"
              >
                <template #header>
                  <div class="flex min-w-0 flex-1 flex-col py-0.5">
                    <div class="flex min-w-0 items-center gap-1.5">
                      <OButton
                        variant="ghost"
                        size="chip"
                        class="min-w-0"
                        :aria-label="t('metrics.explorer.card.detailsAria', { name: row.name })"
                        :data-test="`metrics-detail-related-open-${row.name}`"
                        @click.stop="$emit('open-related', row.name)"
                      >
                        <span class="truncate" :title="row.name">{{ row.name }}</span>
                      </OButton>
                      <OTag type="metricType" :value="row.typeFilterBucket" class="shrink-0" />
                    </div>
                    <span
                      class="text-2xs text-text-secondary block truncate px-1.5 font-normal"
                      :title="row.sharedLabels.join(', ')"
                      :data-test="`metrics-detail-related-shared-${row.name}`"
                      >{{
                        row.sharedLabels.length
                          ? t("metrics.explorer.detail.related.sharedLabels", {
                              labels: row.sharedLabels.join(", "),
                            })
                          : t("metrics.explorer.detail.related.noSharedLabels")
                      }}</span
                    >
                  </div>
                </template>
              </MetricChartTile>
            </div>
          </div>
        </OContent>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, ref, watch, type PropType } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import MetricCardChart, { type ChartForecast, type ShiftedResult } from "./MetricCardChart.vue";
import MetricBreakdown from "./MetricBreakdown.vue";
import MetricChartTile, {
  type TileCompare,
  type TileForecast,
  type TileQuery,
} from "./MetricChartTile.vue";
import MetricUsageList from "./MetricUsageList.vue";
import MetricOverlayKey from "./MetricOverlayKey.vue";
import metricsService, { type MetricUsage } from "@/services/metrics";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useMetricDrilldown } from "@/composables/metrics/useMetricDrilldown";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import CreateAlertAction from "@/components/alerts/CreateAlertAction.vue";
import { buildPrefillFromPanel } from "@/utils/alerts/prefill/fromPanel";
import { withBareMetricNames, withSourceStreams } from "@/utils/metrics/metricsHandoff";
import { durationFormatter } from "@/utils/formatters";
import { parseSearchError } from "@/utils/query/searchError";
import { CARD_KIND, supportsBreakdown, toO2Unit } from "@/utils/metrics/metricDefaults";
import {
  fitForecasts,
  forecastHorizonOptions as forecastHorizonPresets,
  forecastHorizonSeconds,
  type ForecastHorizon,
  type ForecastMethod,
} from "@/utils/metrics/forecast";
import { UNIT_LABELS } from "@/utils/metrics/metricPalette";
import { rankRelatedMetrics, relatedCandidates } from "@/utils/metrics/relatedMetrics";
import {
  COMPARE_OFFSET_MS,
  type CompareOffset,
  type DetailTab,
} from "@/utils/metrics/explorerUrlState";
import type { MetricCard as MetricCardModel } from "@/utils/metrics/metricFamily";
import { isCancelled } from "@/composables/metrics/useMetricsPreviewQueue";
import {
  hasSamples,
  type LabelFilter,
  type QueryWindow,
} from "@/composables/metrics/useMetricsExplorerGrid";
import type { InjectedExemplars } from "@/ts/interfaces/exemplars";
import type { AlertBuildOptions } from "@/ts/interfaces/alertPrefill";

const RELATED_LIMIT = 12;
const DRILLDOWN_SIGNALS = ["logs", "traces"] as const;
/** A compared period draws as a twin series, which a heatmap's cells cannot show. */
const COMPARE_CHART_TYPES = ["line", "area", "bar"];
const COMPARE_OFFSETS = Object.keys(COMPARE_OFFSET_MS) as CompareOffset[];
/** Kinds whose values are not a level that trends: labels, timestamps, or unknown. */
const FORECAST_EXCLUDED_KINDS = [CARD_KIND.INFO, CARD_KIND.TIMESTAMP, CARD_KIND.OTHER];

/** A metric's chart as its explorer card draws it. */
export interface DetailChart {
  queries: TileQuery[];
  chartType: string;
  unit: string;
  bucketUnit: string | null;
  /** The function in effect, as the card's footer names it. */
  footerLabel?: string;
}

interface RelatedRow {
  name: string;
  sharedLabels: string[];
  typeFilterBucket: string;
  chart: DetailChart;
  color: string;
  runQuery: (expr: string, signal: AbortSignal) => Promise<any>;
}

interface OverviewState {
  status: "idle" | "loading" | "done" | "error";
  results: any[];
  error: string;
  /** The window `results` were queried for: a chart kept through a refresh stays on its axis. */
  timeRange?: { start_time: number; end_time: number };
  shifted?: ShiftedResult[];
  /** The step `results` were queried at, kept with them like `timeRange`. */
  stepSeconds?: number;
  forecast?: ChartForecast | null;
}

const IDLE: OverviewState = { status: "idle", results: [], error: "" };

export default defineComponent({
  name: "MetricDetailView",
  components: {
    MetricCardChart,
    MetricBreakdown,
    MetricChartTile,
    MetricUsageList,
    MetricOverlayKey,
    OPageHeader,
    OContent,
    OButton,
    OIcon,
    OTag,
    OTabs,
    OTab,
    OEmptyState,
    OSkeleton,
    OSpinner,
    OTooltip,
    OBanner,
    ODropdown,
    ODropdownItem,
    ODropdownGroup,
    OSelect,
    CreateAlertAction,
  },
  props: {
    /** `null` while loading, or when the URL names a metric that does not exist. */
    card: { type: Object as PropType<MetricCardModel | null>, default: null },
    metricName: { type: String, required: true },
    /** The stream list or the label schemas are still loading. */
    loading: { type: Boolean, default: false },
    tab: { type: String as PropType<DetailTab | null>, default: null },
    breakdownLabel: { type: String as PropType<string | null>, default: null },
    /** The card's current query — its ⚙ override included — resolved by the grid. */
    overview: { type: Object as PropType<DetailChart>, required: true },
    /** The overview's queries at a dashboard panel's rate window, for Breakdown's Add to dashboard. */
    panelQueries: { type: Array as PropType<TileQuery[]>, default: () => [] },
    /** Any metric's chart as the grid would draw it, for the Related cards. */
    chartOf: {
      type: Function as PropType<(card: MetricCardModel) => DetailChart>,
      required: true,
    },
    isFavorite: { type: Boolean, default: false },
    allCards: { type: Array as PropType<MetricCardModel[]>, required: true },
    labelsByStream: { type: Object as PropType<Record<string, string[]>>, required: true },
    ensureSchemas: {
      type: Function as PropType<() => Promise<boolean | void>>,
      default: () => Promise.resolve(),
    },
    prefixOf: { type: Function as PropType<(name: string) => string>, required: true },
    familyOf: { type: Function as PropType<(name: string) => string>, required: true },
    filters: { type: Array as PropType<LabelFilter[]>, required: true },
    /** The active filters this metric cannot apply: its chart ignores them. */
    inapplicableFilters: { type: Array as PropType<LabelFilter[]>, default: () => [] },
    /** Whether a metric can apply every active filter — Related offers only those. */
    isLabelEligible: {
      type: Function as PropType<(card: MetricCardModel) => boolean>,
      default: () => true,
    },
    timeRange: {
      type: Object as PropType<{ start_time: number; end_time: number }>,
      required: true,
    },
    rateWindow: { type: String, required: true },
    compare: { type: String as PropType<CompareOffset | null>, default: null },
    forecast: { type: String as PropType<ForecastMethod | null>, default: null },
    /** A preset from the URL; absent, or longer than the visible range, the horizon is a quarter of it. */
    forecastHorizon: { type: String as PropType<ForecastHorizon | null>, default: null },
    /** The detail queries' step, so a compared period snaps onto the current one. */
    stepSeconds: { type: Number, default: 0 },
    /** The rate window a dashboard panel built from this metric rates over. */
    panelRateWindow: { type: String, required: true },
    nanGuard: { type: Boolean, default: false },
    color: { type: String, required: true },
    /** A metric's colour on its grid card, so a Related card matches it. */
    colorOf: { type: Function as PropType<(name: string) => string>, required: true },
    exemplarsEligible: { type: Boolean, default: false },
    exemplarsOn: { type: Boolean, default: false },
    /** A heatmap metric charts its percentiles variant while exemplars are on. */
    exemplarsSwapsVariant: { type: Boolean, default: false },
    exemplars: {
      type: Object as PropType<InjectedExemplars | undefined>,
      default: undefined,
    },
    /** Runs one PromQL query on the scheduler, stepped for `card` (default: this view's metric). */
    runQuery: {
      type: Function as PropType<
        (
          expr: string,
          signal: AbortSignal,
          card?: MetricCardModel,
          opts?: { maxSeries?: number; window?: QueryWindow; instantAt?: number },
        ) => Promise<any>
      >,
      required: true,
    },
  },
  emits: [
    "close",
    "open-visualize",
    "toggle-favorite",
    "configure",
    "toggle-exemplars",
    "retry-exemplars",
    "update:tab",
    "update:breakdownLabel",
    "open-related",
    "add-filter",
    "update:compare",
    "update:forecast",
    "update:forecastHorizon",
  ],
  setup(props, { emit }) {
    const { t } = useI18nTyped();

    const unitLabel = computed(() => raw(UNIT_LABELS[props.card?.unit ?? ""] ?? ""));

    const exemplarsTooltip = computed(() => {
      const count = props.exemplars?.markers?.length ?? 0;
      if (props.exemplarsSwapsVariant) {
        return props.exemplarsOn
          ? t("metrics.explorer.card.exemplarsHideHeatmap", { count })
          : t("metrics.explorer.card.exemplarsShowHeatmap");
      }
      return props.exemplarsOn
        ? t("dashboard.exemplars.hide", { count })
        : t("dashboard.exemplars.show");
    });

    const inapplicableFiltersText = computed(() =>
      props.inapplicableFilters.map((f) => `${f.label}${f.operator ?? "="}"${f.value}"`).join(", "),
    );

    const breakdownSupported = computed(
      () => !!props.card && supportsBreakdown(props.card.cardKind),
    );
    /** Breakdown is the default; a kind without one lands on Related. */
    const activeTab = computed<DetailTab>(() => {
      if (props.tab === "related" || props.tab === "used_in") return props.tab;
      return breakdownSupported.value ? "breakdown" : "related";
    });

    const store = useStore();
    const usage = ref<MetricUsage | null>(null);
    const usageStatus = ref<"idle" | "loading" | "done" | "error">("idle");
    let usageRequest: AbortController | null = null;

    const loadUsage = async (metric: string | undefined) => {
      usageRequest?.abort();
      usage.value = null;
      usageStatus.value = metric ? "loading" : "idle";
      if (!metric) return;
      const request = new AbortController();
      usageRequest = request;
      try {
        const res = await metricsService.getMetricUsage({
          org_identifier: store.state.selectedOrganization?.identifier,
          metric,
          signal: request.signal,
        });
        if (request.signal.aborted) return;
        usage.value = res.data;
        usageStatus.value = "done";
      } catch {
        if (!request.signal.aborted) usageStatus.value = "error";
      }
    };
    watch(
      () => [store.state.selectedOrganization?.identifier, props.card?.name] as const,
      ([, metric]) => loadUsage(metric),
      { immediate: true },
    );
    onBeforeUnmount(() => usageRequest?.abort());

    const usedInLabel = computed(() => {
      const found = usage.value;
      if (!found) return t("metrics.explorer.detail.tabUsedIn");
      const count =
        found.dashboards.length + found.alerts.length + found.slos.length + found.pipelines.length;
      return t("metrics.explorer.detail.tabUsedInCount", { count });
    });

    const overviewState = ref<OverviewState>(IDLE);

    const router = useRouter();
    const drilldown = useMetricDrilldown({
      org: () => store.state.selectedOrganization?.identifier ?? "",
      metric: () => (props.card ? { name: props.card.name, labels: props.card.labels } : null),
      labelsOf: (name) => props.labelsByStream[name],
      ensureSchemas: () => props.ensureSchemas(),
      filters: () => props.filters,
      inapplicableFilters: () => props.inapplicableFilters,
      timeRange: () => props.timeRange,
      serviceStreamsEnabled: () => !!store.state.zoConfig?.service_streams_enabled,
      router,
      store,
      onDropped: (labels) =>
        toast({
          variant: "warning",
          message: t("metrics.explorer.detail.drilldown.notApplied", {
            labels: labels.join(", "),
          }),
        }),
    });
    const drilldownMenu = computed(() => drilldown.menu.value);
    const drilldownBlockedReason = computed(() => {
      const state = drilldown.availability.value;
      if (state === "oss") return t("metrics.explorer.detail.drilldown.enterprise");
      if (state === "discoveryOff") return t("metrics.explorer.detail.drilldown.discoveryOff");
      if (state === "pending") return t("metrics.explorer.detail.drilldown.checking");
      return t("metrics.explorer.detail.drilldown.forbidden");
    });
    const onDrilldownOpen = (open: boolean) => {
      if (open) drilldown.open();
    };
    // Selecting an item closes the menu; these keep it open for the next step.
    const onDrilldownPick = (event: Event, value: string) => {
      event.preventDefault();
      drilldown.pickService(value);
    };
    const onDrilldownRetry = (event: Event) => {
      event.preventDefault();
      drilldown.retry();
    };

    const compareEligible = computed(() => COMPARE_CHART_TYPES.includes(props.overview.chartType));
    const comparePeriodLabel = (offset: CompareOffset) =>
      t(`metrics.explorer.detail.compare.ago${offset}` as const);
    const compareOptions = computed(() => [
      { label: t("metrics.explorer.detail.compare.off"), value: "off" },
      ...COMPARE_OFFSETS.map((offset) => ({ label: comparePeriodLabel(offset), value: offset })),
    ]);
    /** The comparison the charts draw: none on a heatmap, whatever the URL says. */
    const compareShift = computed<TileCompare | null>(() =>
      compareEligible.value && props.compare
        ? {
            gapMs: COMPARE_OFFSET_MS[props.compare],
            periodAsStr: comparePeriodLabel(props.compare),
          }
        : null,
    );
    const onCompareChange = (value: unknown) =>
      emit("update:compare", value === "off" ? null : (value as CompareOffset));

    const forecastEligible = computed(
      () =>
        props.overview.chartType === "line" &&
        !!props.card &&
        !FORECAST_EXCLUDED_KINDS.includes(props.card.cardKind),
    );
    const rangeSeconds = computed(
      () => (props.timeRange.end_time - props.timeRange.start_time) / 1e6,
    );
    const forecastOptions = computed(() => [
      { label: t("metrics.explorer.detail.forecast.off"), value: "off" },
      { label: t("metrics.explorer.detail.forecast.linear"), value: "linear" },
      { label: t("metrics.explorer.detail.forecast.smoothed"), value: "smoothed" },
    ]);
    const forecastMethodsHelp = computed(() =>
      t("metrics.explorer.detail.forecast.methodsHelp", {
        linear: t("metrics.explorer.detail.forecast.linearHelp"),
        smoothed: t("metrics.explorer.detail.forecast.smoothedHelp"),
      }),
    );
    const forecastHorizonOptions = computed(() => [
      { label: t("metrics.explorer.detail.forecast.horizonAuto"), value: "auto" },
      ...forecastHorizonPresets(rangeSeconds.value).map((preset) => ({
        label: t(`metrics.explorer.detail.forecast.horizon${preset}` as const),
        value: preset,
      })),
    ]);
    const forecastHorizonChoice = computed(() =>
      props.forecastHorizon &&
      forecastHorizonPresets(rangeSeconds.value).includes(props.forecastHorizon)
        ? props.forecastHorizon
        : "auto",
    );
    /** The forecast the overview draws: none where it is not offered, whatever the URL says. */
    const activeForecast = computed(() =>
      forecastEligible.value && props.forecast && props.stepSeconds > 0
        ? {
            method: props.forecast,
            horizon: forecastHorizonSeconds(props.forecastHorizon, rangeSeconds.value),
          }
        : null,
    );
    const onForecastChange = (value: unknown) =>
      emit("update:forecast", value === "off" ? null : (value as ForecastMethod));
    const onForecastHorizonChange = (value: unknown) =>
      emit("update:forecastHorizon", value === "auto" ? null : (value as ForecastHorizon));

    const breakdownForecast = computed<TileForecast | null>(() =>
      activeForecast.value
        ? { ...activeForecast.value, label: t("metrics.explorer.detail.forecast.suffix") }
        : null,
    );
    const loadForecast = async (exprs: string[], signal: AbortSignal) => {
      const ahead = activeForecast.value;
      if (!ahead) return null;
      const { end_time: T } = props.timeRange;
      const window = { T, rangeSeconds: rangeSeconds.value, stepSeconds: props.stepSeconds };
      const fits = await fitForecasts(exprs, ahead, window, (query) =>
        props.runQuery(query, signal, undefined, { instantAt: T }),
      );
      return fits && { ...fits, label: t("metrics.explorer.detail.forecast.suffix") };
    };
    const overviewQueries = computed(() =>
      props.card ? withSourceStreams(props.overview.queries, props.card.name) : [],
    );
    /** The overview's queries as a panel's, with no threshold: the form defaults to `>= 1`. */
    const buildOverviewAlertPrefill = (options: AlertBuildOptions = {}) => {
      const queries = overviewQueries.value.map((query) => ({
        query: withBareMetricNames(query.expr),
        fields: { stream: query.stream, stream_type: "metrics" },
      }));
      const prefill = buildPrefillFromPanel({
        panelTitle: props.card?.name,
        queries,
        queryType: "promql",
        queryIndex: options.queryIndex,
        queryChoices:
          queries.length > 1
            ? queries.map((query, index) => ({ index, query: query.query }))
            : undefined,
        timeRange: {
          start_time: new Date(props.timeRange.start_time / 1000),
          end_time: new Date(props.timeRange.end_time / 1000),
        },
      });
      return { ...prefill, source: "explorer" };
    };
    // The earlier period alone is still worth charting: it says what this window is missing.
    const overviewHasSamples = computed(
      () =>
        overviewState.value.results.some(hasSamples) ||
        !!overviewState.value.shifted?.some((entry) => hasSamples(entry.result)),
    );
    const overviewPeriodEmpty = computed(
      () =>
        overviewState.value.status === "done" &&
        !overviewState.value.shifted?.some((entry) => hasSamples(entry.result)),
    );
    const forecastHorizonText = computed(() =>
      raw(durationFormatter(activeForecast.value?.horizon ?? 0)),
    );
    const overviewUnit = computed(() => toO2Unit(props.overview.unit));
    const overviewBucketUnit = computed(() =>
      props.overview.bucketUnit
        ? toO2Unit(props.overview.bucketUnit)
        : { unit: null, unitCustom: null },
    );

    /** A resolution from a previous card or window must never land. */
    let generation = 0;
    let active: AbortController | null = null;
    const overviewRefreshing = ref(false);

    const cancelActive = () => {
      active?.abort();
      active = null;
    };

    /** `keep`: only the window moved, so the drawn chart stays up until the new result lands. */
    const loadOverview = async (keep = false) => {
      const mine = ++generation;
      cancelActive();
      overviewRefreshing.value = false;
      const exprs: string[] = props.overview.queries.map((query: any) => query.expr);
      if (props.loading || !props.card || !exprs.length) {
        overviewState.value = IDLE;
        return;
      }
      const timeRange = props.timeRange;
      const stepSeconds = props.stepSeconds;
      const compare = compareShift.value;
      active = new AbortController();
      const { signal } = active;
      if (keep && overviewState.value.status === "done") overviewRefreshing.value = true;
      else overviewState.value = { status: "loading", results: [], error: "" };
      try {
        const window = compare && {
          start: timeRange.start_time - compare.gapMs * 1000,
          end: timeRange.end_time - compare.gapMs * 1000,
        };
        const current = Promise.all([
          Promise.all(exprs.map((expr) => props.runQuery(expr, signal))),
          window
            ? Promise.all(exprs.map((expr) => props.runQuery(expr, signal, undefined, { window })))
            : [],
        ]);
        // Queued after the chart's own queries, and never waited on by it: the fits are slower and optional.
        const pendingForecast = loadForecast(exprs, signal).catch(() => null);
        const [results, past] = await current;
        if (mine !== generation) return;
        overviewRefreshing.value = false;
        const shifted = compare
          ? past.map((result, parentIndex) => ({ result, ...compare, parentIndex }))
          : [];
        overviewState.value = {
          status: "done",
          results,
          shifted,
          error: "",
          timeRange,
          stepSeconds,
          forecast: null,
        };
        const forecast = await pendingForecast;
        if (mine !== generation) return;
        active = null;
        if (forecast) overviewState.value = { ...overviewState.value, forecast };
      } catch (error: any) {
        if (mine !== generation) return;
        cancelActive();
        overviewRefreshing.value = false;
        // Not its own doing (that bumps `generation`): a shared query or bulk clear cancelled it.
        if (isCancelled(error)) {
          loadOverview(true);
          return;
        }
        overviewState.value = {
          status: "error",
          results: [],
          error: parseSearchError(error).message,
        };
      }
    };

    // Sources compared one by one: a getter returning a fresh array re-fires on every card rebuild.
    watch(
      [
        () => props.loading,
        () => props.card?.name,
        () => props.overview.queries.map((query: any) => query.expr).join("\n"),
        () => compareShift.value?.gapMs,
        () => `${activeForecast.value?.method}|${activeForecast.value?.horizon}`,
        () => props.timeRange,
      ],
      // Only the window or the forecast changed: the drawn chart stays up while the new one loads.
      (now, before) => {
        // A kept chart must not go on drawing a forecast the control no longer asks for.
        if (before && now[4] !== before[4] && overviewState.value.forecast) {
          overviewState.value = { ...overviewState.value, forecast: null };
        }
        loadOverview(!!before && now.slice(0, -2).every((v, i) => v === before[i]));
      },
      { immediate: true },
    );

    const onOverviewRenderError = (error: any) => {
      overviewState.value = {
        status: "error",
        results: [],
        error: String(error || t("metrics.functionConfigDialog.failedToRenderChart")),
      };
    };

    onBeforeUnmount(() => {
      generation += 1;
      cancelActive();
    });

    const related = computed<RelatedRow[]>(() => {
      const card = props.card;
      if (!card) return [];
      // A metric the filters do not apply to is hidden from the grid, so it is no neighbour here.
      const byName = new Map(
        props.allCards.filter((c) => props.isLabelEligible(c)).map((c) => [c.name, c]),
      );
      const candidates = relatedCandidates(card.name, [...byName.keys()], props.prefixOf);
      return rankRelatedMetrics(card.name, candidates, props.labelsByStream, props.familyOf)
        .slice(0, RELATED_LIMIT)
        .flatMap(({ name, sharedLabels }) => {
          const other = byName.get(name);
          if (!other) return [];
          return [
            {
              name,
              sharedLabels,
              typeFilterBucket: other.typeFilterBucket ?? "other",
              chart: props.chartOf(other),
              color: props.colorOf(name),
              runQuery: (expr: string, signal: AbortSignal) => props.runQuery(expr, signal, other),
            },
          ];
        });
    });

    /** The breakdown's queries run for this view's own metric. */
    const runBreakdownQuery = (
      expr: string,
      signal: AbortSignal,
      opts?: { maxSeries?: number; window?: QueryWindow; instantAt?: number },
    ) => props.runQuery(expr, signal, undefined, opts);

    return {
      runBreakdownQuery,
      raw,
      t,
      unitLabel,
      exemplarsTooltip,
      inapplicableFiltersText,
      breakdownSupported,
      activeTab,
      overviewState,
      overviewQueries,
      buildOverviewAlertPrefill,
      drilldown,
      drilldownMenu,
      drilldownBlockedReason,
      onDrilldownOpen,
      onDrilldownPick,
      onDrilldownRetry,
      DRILLDOWN_SIGNALS,
      compareEligible,
      compareOptions,
      compareShift,
      breakdownForecast,
      onCompareChange,
      forecastEligible,
      forecastOptions,
      forecastHorizonOptions,
      forecastHorizonChoice,
      onForecastChange,
      onForecastHorizonChange,
      overviewPeriodEmpty,
      forecastMethodsHelp,
      loadUsage,
      forecastHorizonText,
      activeForecast,
      overviewHasSamples,
      overviewUnit,
      overviewBucketUnit,
      overviewRefreshing,
      loadOverview,
      onOverviewRenderError,
      related,
      usage,
      usageStatus,
      usedInLabel,
    };
  },
});
</script>
