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
  <OPageLayout
    class="bg-card-glass-bg"
    data-test="profiles-page"
    :title="t('profiles.title')"
    :subtitle="t('profiles.subtitle')"
    icon="memory"
    title-data-test="profiles-page-title"
    bleed
  >
    <template #title>
      <span class="inline-flex items-center gap-2">
        {{ t("profiles.title") }}
        <BetaBadge />
      </span>
    </template>
    <template #actions>
      <!-- Applies a picked window at once, as on Logs and Traces: Run query is the apply step. -->
      <DateTimePickerDashboard
        ref="datePickerRef"
        v-model="dateState"
        :auto-apply-dashboard="true"
        :hide-range-shift="isMobile"
        class="h-8"
        data-test="profiles-date-picker"
      />
      <ShareButton
        :url="shareUrl"
        variant="outline"
        size="icon-toolbar"
        :disabled="!hasProfileData"
        class="h-8"
        data-test="profiles-share-btn"
      />
      <!-- Run, Cancel and the Auto Run switch, as on RUM Performance and Dashboards (shared useAutoRunToggle). -->
      <OButtonGroup>
        <!-- All labels share one grid cell, so the button keeps the widest label's width in every language. -->
        <OButton
          :variant="queryLoading ? 'cancel-query' : runPending ? 'warning' : 'primary'"
          size="sm-toolbar"
          :disabled="!queryLoading && !canQuery"
          :data-run-pending="runPending && !queryLoading ? 'true' : undefined"
          :data-test="queryLoading ? 'profiles-cancel-query' : 'profiles-run-query'"
          :class="isAutoRunAvailable ? 'border-y-0! border-s-0! border-e!' : 'border-0!'"
          @click="queryLoading ? cancelQuery() : runQuery()"
        >
          <span class="grid">
            <span
              class="invisible col-start-1 row-start-1 flex items-center gap-1"
              aria-hidden="true"
            >
              <OIcon name="autorenew" size="xs" />{{ t("profiles.runQuery") }}
            </span>
            <span class="invisible col-start-1 row-start-1" aria-hidden="true">{{
              t("search.cancel")
            }}</span>
            <span class="col-start-1 row-start-1 flex items-center justify-center gap-1">
              <OIcon v-if="!queryLoading && isAutoRunOn" name="autorenew" size="xs" />
              {{ queryLoading ? t("search.cancel") : t("profiles.runQuery") }}
            </span>
          </span>
          <OTooltip
            v-if="!queryLoading && (!canQuery || runPending || isAutoRunOn)"
            :content="runButtonTooltip"
          />
        </OButton>
        <ODropdown
          v-if="isAutoRunAvailable"
          v-model:open="runOptionsOpen"
          align="end"
          side="bottom"
        >
          <template #trigger>
            <OButton
              :variant="queryLoading ? 'cancel-query' : runPending ? 'warning' : 'primary'"
              size="sm-toolbar"
              icon-left="arrow-drop-down"
              class="px-1"
              :disabled="!queryLoading && !canQuery"
              :aria-label="t('profiles.runOptions')"
              data-test="profiles-run-options"
            />
          </template>
          <ODropdownItem data-test="profiles-auto-run-toggle" @select="toggleAutoRun">
            <template #icon-left>
              <OIcon
                :name="isAutoRunOn ? 'autorenew' : 'sync-disabled'"
                size="sm"
                :class="isAutoRunOn ? 'text-accent' : ''"
              />
            </template>
            <span>
              <div class="font-medium">
                {{ isAutoRunOn ? t("search.turnOffLiveMode") : t("search.turnOnLiveMode") }}
              </div>
              <div class="text-text-secondary text-xs">
                {{ t("search.liveModeTooltip") }}
              </div>
            </span>
          </ODropdownItem>
        </ODropdown>
      </OButtonGroup>
    </template>

    <template #subnav>
      <OContent class="flex flex-nowrap items-center gap-1.5 py-1.5 max-lg:flex-wrap">
        <div
          class="max-w-36 min-w-0 flex-1 max-lg:min-w-32 max-md:max-w-none max-md:basis-[calc(50%-0.1875rem)]"
        >
          <OSelect
            v-model="selectedStream"
            :label="t('profiles.stream')"
            label-position="inside"
            :options="streamOptions"
            :disabled="!streamOptions.length"
            class="w-full"
            data-test="profiles-stream-select"
          />
        </div>
        <div
          class="max-w-36 min-w-0 flex-1 max-lg:min-w-32 max-md:max-w-none max-md:basis-[calc(50%-0.1875rem)]"
        >
          <OSelect
            v-model="selectedService"
            :label="t('profiles.service')"
            label-position="inside"
            :options="serviceOptions"
            class="w-full"
            data-test="profiles-service-select"
          />
        </div>
        <div
          class="max-w-44 min-w-0 flex-1 max-lg:min-w-32 max-md:max-w-none max-md:basis-[calc(50%-0.1875rem)]"
        >
          <OSelect
            v-model="selectedProfileType"
            :label="t('profiles.profileType')"
            label-position="inside"
            :options="profileTypeSelectOptions"
            class="w-full"
            data-test="profiles-type-select"
          />
        </div>
      </OContent>

      <OContent class="border-border-default border-t py-1.5">
        <ProfilesLabelFilters
          v-model:editing-index="editingFilterIndex"
          v-model:draft-key="draftTagKey"
          v-model:draft-value="draftTagValue"
          :filters="appliedFilters"
          :label-options="tagKeyOptions"
          :value-options="tagValueOptions"
          :values-loading="tagValuesLoading"
          @apply="applyDraftFilter"
          @remove="removeFilter"
        />
      </OContent>
    </template>

    <div
      ref="resultsScrollEl"
      class="min-h-0 flex-1 overflow-y-auto md:flex md:flex-col md:overflow-hidden"
      :class="!hasProfileData && streamOptions.length ? 'flex flex-col' : ''"
    >
      <!-- Same states as the Metrics explorer: a load error with Retry, and a no-data state that links to setup. -->
      <div
        v-if="errorMessage && !hasProfileData"
        class="flex min-h-0 flex-1 flex-col items-center justify-center p-3"
      >
        <OEmptyState
          size="block"
          preset="load-error"
          :description="raw(errorMessage)"
          data-test="profiles-error"
          @action="retry"
        />
      </div>

      <div
        v-else-if="streamsLoaded && !streamOptions.length"
        class="flex min-h-0 flex-1 flex-col items-center justify-center p-3"
      >
        <OEmptyState
          size="block"
          preset="no-streams"
          :title="t('profiles.noStreams')"
          :actions="noStreamsActions"
          data-test="profiles-no-stream"
          @action="openProfilesIngestion"
        />
      </div>

      <!-- As on Logs: a cancelled query with nothing on screen is not "no data". -->
      <div
        v-else-if="!hasProfileData && !showSkeleton && queryCancelled"
        class="flex min-h-0 flex-1 flex-col items-center justify-center p-3"
        data-test="profiles-search-cancelled"
      >
        <OEmptyState preset="search-cancelled" size="block" @action="runQuery" />
      </div>

      <div
        v-else-if="!hasProfileData && !showSkeleton"
        class="flex min-h-0 flex-1 flex-col items-center justify-center p-3"
        data-test="profiles-no-results"
      >
        <OEmptyState preset="no-profiles" size="block" :hide-action="true" />
      </div>

      <OContent v-else class="flex flex-col gap-2.5 py-2.5 md:min-h-0 md:flex-1">
        <!-- A failed re-run keeps the last results and says so. -->
        <OBanner
          v-if="errorMessage"
          variant="error"
          dense
          inline-actions
          class="shrink-0"
          data-test="profiles-error-banner"
        >
          {{ errorMessage }}
          <template #actions>
            <OButton variant="outline" size="sm" data-test="profiles-error-retry" @click="retry">{{
              t("emptyState.loadError.action")
            }}</OButton>
          </template>
        </OBanner>
        <section
          v-show="!resultsExpanded"
          class="bg-surface-panel border-border-default rounded-default shrink-0 border"
          data-test="profiles-series-card"
        >
          <header
            class="border-border-default flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5 text-sm"
          >
            <span class="font-semibold">{{ t("profiles.timeSeriesTitle") }}</span>
            <div
              v-if="seriesLines.length > 1"
              class="flex min-w-0 flex-wrap items-center gap-1"
              data-test="profiles-breakdown-legend"
            >
              <OButton
                v-for="line in seriesLines"
                :key="line.key"
                variant="ghost"
                size="xs"
                :disabled="line.others"
                :data-test="`profiles-breakdown-chip-${line.key}`"
                @click="filterToBreakdownValue(line)"
              >
                <span
                  class="me-1 inline-block size-2 shrink-0 rounded-full"
                  :style="{ backgroundColor: line.color }"
                  aria-hidden="true"
                />{{ line.label }}
                <OTooltip
                  v-if="!line.others"
                  :content="
                    t('profiles.breakdownFilter', { key: breakdownLabel ?? '', value: line.label })
                  "
                />
              </OButton>
            </div>
            <div class="ms-auto flex shrink-0 items-center gap-1.5">
              <label for="profiles-breakdown" class="text-text-secondary text-xs font-semibold">{{
                t("profiles.breakdown")
              }}</label>
              <OSelect
                id="profiles-breakdown"
                :aria-label="t('profiles.breakdown')"
                :model-value="breakdownLabel ?? BREAKDOWN_NONE"
                :options="breakdownOptions"
                size="xs"
                width="sm"
                :disabled="!lastRun"
                data-test="profiles-breakdown-select"
                @update:model-value="setBreakdown"
              />
            </div>
          </header>
          <div class="h-36 p-3">
            <OSkeleton
              v-if="showSkeleton || seriesLoading"
              type="rect"
              class="rounded-default h-full w-full"
              data-test="profiles-series-skeleton"
            />
            <ChartRenderer
              v-else-if="seriesLines.some((line) => line.points.length)"
              :data="seriesChartData"
              class="h-full w-full"
              @updated:data-zoom="onRangeSelect"
            />
            <div
              v-else
              class="text-text-secondary flex h-full items-center justify-center text-sm"
              data-test="profiles-no-series"
            >
              {{ t("profiles.noSeries") }}
            </div>
          </div>
        </section>

        <section
          class="bg-surface-panel border-border-default rounded-default overflow-hidden border md:flex md:min-h-0 md:flex-1 md:flex-col"
        >
          <header
            class="border-border-default flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2"
          >
            <OToggleGroup
              :model-value="activeView"
              mobile-dropdown
              data-test="profiles-view"
              @update:model-value="setView"
            >
              <OToggleGroupItem
                value="top"
                size="sm"
                icon-left="table-chart"
                data-test="profiles-view-top"
              >
                {{ t("profiles.viewTop") }}
              </OToggleGroupItem>
              <OToggleGroupItem
                value="flame"
                size="sm"
                icon-left="flame"
                data-test="profiles-view-flame"
              >
                {{ t("profiles.viewFlame") }}
              </OToggleGroupItem>
              <OToggleGroupItem
                value="tree"
                size="sm"
                icon-left="account-tree"
                data-test="profiles-view-tree"
              >
                {{ t("profiles.viewTree") }}
              </OToggleGroupItem>
              <OToggleGroupItem
                value="sandwich"
                size="sm"
                icon-left="swap-vert"
                data-test="profiles-view-sandwich"
              >
                {{ t("profiles.viewSandwich") }}
              </OToggleGroupItem>
              <OToggleGroupItem
                value="compare"
                size="sm"
                icon-left="compare-arrows"
                data-test="profiles-view-compare"
              >
                {{ t("profiles.viewCompare") }}
              </OToggleGroupItem>
            </OToggleGroup>
            <div class="min-w-0 flex-1 max-md:min-w-40">
              <OSearchInput
                v-model="searchQuery"
                :placeholder="t('profiles.searchFunctions')"
                data-test="profiles-search-functions"
              />
            </div>
            <span
              v-if="searchSummary && activeView !== 'compare'"
              class="text-text-secondary text-xs whitespace-nowrap tabular-nums"
              data-test="profiles-search-summary"
              >{{ searchSummary }}</span
            >
            <!-- Same expand toggle as the Logs query editor: the results take the chart's space too. -->
            <OButton
              :icon-left="resultsExpanded ? 'fullscreen-exit' : 'fullscreen'"
              variant="ghost"
              size="icon-toolbar"
              :aria-label="resultsExpanded ? t('search.collapse') : t('search.expand')"
              data-test="profiles-results-expand"
              @click="resultsExpanded = !resultsExpanded"
            >
              <OTooltip :content="resultsExpanded ? t('search.collapse') : t('search.expand')" />
            </OButton>
          </header>
          <OBanner
            v-if="sampledPercent"
            variant="info"
            icon="info"
            dense
            bar
            class="shrink-0"
            data-test="profiles-partial-result"
          >
            {{ t("profiles.partialResult", { percent: sampledPercent }) }}
          </OBanner>
          <!-- Views on the left, Function details beside them (below them on phones). -->
          <div class="md:flex md:min-h-0 md:flex-1">
            <div class="md:flex md:min-h-0 md:min-w-0 md:flex-1 md:flex-col">
              <OTable
                v-if="activeView === 'top'"
                :data="topRows"
                :loading="showSkeleton"
                :columns="profileColumns"
                :default-columns="false"
                row-key="name"
                sorting="client"
                sort-by="self"
                sort-order="desc"
                pagination="none"
                virtual-scroll
                :overscan="isMobile ? 100 : 20"
                :scroll-el="isMobile ? resultsScrollEl : null"
                :scroll-margin="0"
                :show-global-filter="false"
                :frame="false"
                :fill-height="!isMobile"
                class="md:min-h-0 md:flex-1"
                :row-height="28"
                :enable-column-resize="true"
                data-test="profiles-top-table"
              >
                <template #cell-name="{ row, index }">
                  <span class="flex min-w-0 items-center gap-1">
                    <ProfilesFunctionMenu
                      :name="row.name"
                      :data-test="`profiles-top-row-${index}`"
                      @copy="copyFunctionName"
                      @search="searchForFunction"
                      @show="showInFlameGraph(row.name)"
                      @sandwich="showSandwich"
                      @details="showDetails"
                    />
                    <span
                      class="text-text-body min-w-0 truncate font-mono text-xs"
                      v-html="highlightName(row.name)"
                    />
                  </span>
                </template>
                <template v-for="cell in VALUE_CELLS" :key="cell.id" #[`cell-${cell.id}`]="{ row }">
                  <ODataBarCell
                    v-if="cell.bar"
                    :value="shareOf(row[cell.field])"
                    :max="100"
                    :display="formatPercent(row[cell.field], mergeResult?.total ?? 0)"
                    class="text-text-body font-mono text-xs"
                    :class="{ 'pt-1.5': shareOf(row[cell.field]) > 0 }"
                  />
                  <span v-else class="text-text-body font-mono text-xs">{{
                    formatTableValue(row[cell.field])
                  }}</span>
                </template>
              </OTable>

              <div
                v-else-if="activeView === 'flame'"
                class="overflow-auto p-3 md:min-h-0 md:flex-1"
              >
                <!-- Same skeleton idea as the tables: bars that narrow as they go down, like a flame graph. -->
                <div
                  v-if="showSkeleton"
                  class="flex flex-col gap-1.5"
                  data-test="profiles-flame-skeleton"
                >
                  <OSkeleton
                    v-for="width in FLAME_SKELETON_WIDTHS"
                    :key="width"
                    type="rect"
                    class="rounded-default h-6"
                    :class="width"
                  />
                </div>
                <CommonFlameGraph
                  v-else
                  ref="flameGraphRef"
                  :root="mergeResult?.root ?? null"
                  @focus="flameFocus = $event"
                  :summary-label="t('profiles.total')"
                  :summary-value="formatTableValue(mergeResult?.total ?? 0)"
                  v-bind="flameGraphProps"
                  v-on="flameGraphEvents"
                />
              </div>

              <!-- Sandwich: who calls the function (root at the bottom) above what it calls. -->
              <div
                v-else-if="activeView === 'sandwich'"
                class="flex flex-col gap-3 overflow-auto p-3 md:min-h-0 md:flex-1"
                data-test="profiles-sandwich"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <div class="max-w-120 min-w-0 flex-1 max-md:min-w-full">
                    <OSelect
                      :model-value="sandwichName"
                      :label="t('profiles.function')"
                      label-position="inside"
                      :options="functionOptions"
                      searchable
                      class="w-full"
                      data-test="profiles-sandwich-function"
                      @update:model-value="sandwichFunction = $event ? String($event) : null"
                    />
                  </div>
                  <span
                    v-if="sandwichCoverage"
                    class="text-text-secondary text-xs"
                    data-test="profiles-sandwich-coverage"
                    >{{ t("profiles.treeCoverage", { percent: sandwichCoverage }) }}</span
                  >
                </div>
                <div
                  v-if="showSkeleton"
                  class="flex flex-col gap-1.5"
                  data-test="profiles-sandwich-skeleton"
                >
                  <OSkeleton
                    v-for="width in FLAME_SKELETON_WIDTHS"
                    :key="width"
                    type="rect"
                    class="rounded-default h-6"
                    :class="width"
                  />
                </div>
                <section v-if="!showSkeleton" data-test="profiles-sandwich-callers">
                  <CommonFlameGraph
                    :key="`callers-${sandwichName}`"
                    :root="sandwichCallers"
                    :summary-label="t('profiles.callers')"
                    :summary-value="formatTableValue(sandwichCallers?.total ?? 0)"
                    v-bind="flameGraphProps"
                    initial-root-at-bottom
                    v-on="flameGraphEvents"
                  />
                </section>
                <section v-if="!showSkeleton" data-test="profiles-sandwich-callees">
                  <CommonFlameGraph
                    :key="`callees-${sandwichName}`"
                    :root="sandwichCallees"
                    :summary-label="t('profiles.callees')"
                    :summary-value="formatTableValue(sandwichCallees?.total ?? 0)"
                    v-bind="flameGraphProps"
                    v-on="flameGraphEvents"
                  />
                </section>
              </div>

              <ProfilesCompare
                v-else-if="activeView === 'compare' && lastRun && orgIdentifier"
                v-model:state="compareState"
                :org-identifier="orgIdentifier"
                :stream="lastRun.query.stream"
                :payload="lastRun.payload"
                :labels="compareLabels"
                :search-query="searchQuery"
                :unit-label="tableUnitLabel"
                :value-formatter="formatTableValue"
              />
              <OTable
                v-else-if="activeView === 'tree'"
                v-model:expanded-ids="expandedStackIds"
                :data="stackTree"
                :loading="showSkeleton"
                :columns="profileColumns"
                :default-columns="false"
                row-key="id"
                tree
                tree-column-id="name"
                sorting="none"
                pagination="none"
                :show-global-filter="false"
                :frame="false"
                :fill-height="!isMobile"
                class="md:min-h-0 md:flex-1"
                :row-height="28"
                :enable-column-resize="true"
                data-test="profiles-stack-table"
              >
                <template #cell-name="{ row, index }">
                  <span class="flex min-w-0 items-center gap-1">
                    <ProfilesFunctionMenu
                      :name="row.name"
                      focusable
                      :data-test="`profiles-tree-row-${index}`"
                      @copy="copyFunctionName"
                      @search="searchForFunction"
                      @show="focusInFlameGraph(row.id)"
                      @sandwich="showSandwich"
                      @details="showDetails"
                    />
                    <span
                      class="text-text-body min-w-0 truncate font-mono text-xs"
                      v-html="highlightName(row.name)"
                    />
                    <span
                      v-if="row.childCount"
                      class="text-text-secondary shrink-0 text-xs whitespace-nowrap"
                      :data-test="`profiles-tree-row-${index}-counts`"
                      >{{ t("profiles.childCount", { count: row.childCount }, row.childCount) }} ·
                      {{ t("profiles.nodeCount", { count: row.nodeCount }, row.nodeCount) }}</span
                    >
                  </span>
                </template>
                <template v-for="cell in VALUE_CELLS" :key="cell.id" #[`cell-${cell.id}`]="{ row }">
                  <ODataBarCell
                    v-if="cell.bar"
                    :value="shareOf(row[cell.field])"
                    :max="100"
                    :display="formatPercent(row[cell.field], mergeResult?.total ?? 0)"
                    class="text-text-body font-mono text-xs"
                    :class="{ 'pt-1.5': shareOf(row[cell.field]) > 0 }"
                  />
                  <span v-else class="text-text-body font-mono text-xs">{{
                    formatTableValue(row[cell.field])
                  }}</span>
                </template>
              </OTable>
            </div>
            <ProfilesFunctionDetails
              v-if="detailsRow && activeView !== 'compare'"
              :name="detailsRow.name"
              :self="detailsRow.self"
              :total="detailsRow.total"
              :grand-total="mergeResult?.total ?? 0"
              :call-paths="detailsCallPaths"
              :coverage="detailsCoverage"
              :folded="detailsFolded"
              :callers="detailsCallers"
              :callees="detailsCallees"
              :value-formatter="formatTableValue"
              class="border-border-default max-md:border-t md:w-80 md:shrink-0 md:border-s"
              @close="detailsName = null"
              @copy="copyFunctionName"
              @sandwich="showSandwich"
              @show="showInFlameGraph"
            />
          </div>
        </section>
      </OContent>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from "vue";
import { useStore } from "vuex";
import { useThemeRevision } from "@/composables/useTheme";
import { useRoute, useRouter, type LocationQuery } from "vue-router";
import type { EmptyStateAction } from "@/lib/core/EmptyState/presets";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useAutoRunToggle } from "@/composables/dashboard/useAutoRunToggle";
import OContent from "@/lib/core/Content/OContent.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import CommonFlameGraph from "@/components/common/FlameGraphView.vue";
import ShareButton from "@/components/common/ShareButton.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import ProfilesLabelFilters from "./ProfilesLabelFilters.vue";
import ProfilesFunctionMenu from "./ProfilesFunctionMenu.vue";
import ProfilesFunctionDetails from "./ProfilesFunctionDetails.vue";
import ProfilesCompare, { type CompareState } from "./ProfilesCompare.vue";
import { calleesOf, callersOf } from "./sandwich";
import { formatPercent } from "./format";
import { copyToClipboard } from "@/utils/clipboard";
import streamService from "@/services/stream";
import profilesService, {
  encodeProfileFilters,
  parseProfileFilters,
  type ProfileFilter,
  type ProfilesMergeResponse,
  type ProfilesQueryBody,
  type ProfilesSeriesPoint,
  type ProfilesSeriesResponse,
  type ProfilesTreeNode,
} from "@/services/profiles";
import { cssToken } from "@/utils/theme";
import { getConsumableRelativeTime } from "@/utils/date";
import { escapeHtml } from "@/utils/html";
import { niceStep } from "@/utils/slos/chartScale";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import { formatEventCount } from "@/utils/formatters";
import { dataZoomBrushStyle } from "@/utils/chartTheme";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import useBreakpoint from "@/composables/useBreakpoint";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

type SelectOption = { label: I18nText; value: string };
type ProfileView = "top" | "flame" | "tree" | "sandwich" | "compare";
type StackNode = {
  id: string;
  name: string;
  self: number;
  total: number;
  /** Direct callees, and every node below this one. */
  childCount: number;
  nodeCount: number;
  children?: StackNode[];
};
type RouteSeed = {
  stream: string;
  range: { startTime: number; endTime: number } | null;
  /** A relative window such as "15m", written when the picker is relative. */
  period: string | null;
  service: string | null;
  profileType: string | null;
  filters: ProfileFilter[];
  view: ProfileView | null;
  sandwichFunction: string | null;
  search: string;
  focus: string | null;
  details: string | null;
  breakdown: string | null;
  compare: CompareState;
};

const PROFILE_VIEWS: ProfileView[] = ["top", "flame", "tree", "sandwich", "compare"];
const defaultCompareState = (): CompareState => ({
  label: null,
  baseline: null,
  comparison: null,
  display: "flame",
});

const { t } = useI18nTyped();
const { isMobile } = useBreakpoint();
const store = useStore();
const themeRevision = useThemeRevision();
const route = useRoute();
const router = useRouter();
const pageRouteName = route.name;

const defaultDateState = () => ({
  startTime: 0,
  endTime: 0,
  relativeTimePeriod: "15m",
  valueType: "relative",
});
const dateState = ref(defaultDateState());
const datePickerRef = ref<{
  setCustomDate: (type: string, range: { start: Date; end: Date }) => void;
  setSavedDate: (date: Record<string, unknown>) => void;
} | null>(null);
const streamOptions = ref<SelectOption[]>([]);
const selectedStream = ref<string | null>(null);
const selectedService = ref<string | null>(null);
const selectedProfileType = ref<string | null>(null);
const draftTagKey = ref<string | null>(null);
const draftTagValue = ref<string | null>(null);
const tagValueOptions = ref<SelectOption[]>([]);
const tagValuesLoading = ref(false);
const appliedFilters = ref<ProfileFilter[]>([]);
const editingFilterIndex = ref<number | null>(null);
const searchQuery = ref("");
const activeView = ref<ProfileView>("top");
const setView = (value: unknown) => {
  const next = PROFILE_VIEWS.find((view) => view === value);
  if (next) activeView.value = next;
};
const expandedStackIds = ref<string[]>([]);
// On phones the page body is the one scroller and the Top Table virtualizes against it; from md up each table scrolls itself.
const resultsScrollEl = ref<HTMLElement | null>(null);
const resultsExpanded = ref(false);
const flameGraphRef = ref<{ focus: (path: string) => void } | null>(null);
// The function the Sandwich view shows; null means the one with the most self samples.
const sandwichFunction = ref<string | null>(null);
// The function in the Function details panel; null hides the panel.
const detailsName = ref<string | null>(null);
// The focused flame graph frame, kept here so it outlives a view switch and goes into the URL.
const flameFocus = ref<string | null>(null);

/** Matching functions from the Top list, and their share of samples from the tree, with nested matches counted once. */
const searchSummary = computed(() => {
  const needle = searchQuery.value.trim().toLowerCase();
  const result = mergeResult.value;
  if (!needle || !result?.root?.total) return "";
  const count = result.top.filter((row) => row.name.toLowerCase().includes(needle)).length;
  if (!count) return t("profiles.searchNoMatches");
  let matched = 0;
  const walk = (node: ProfilesTreeNode, inMatch: boolean) => {
    const hit = node.name.toLowerCase().includes(needle);
    if (hit && !inMatch) matched += node.total;
    for (const child of node.children ?? []) walk(child, inMatch || hit);
  };
  for (const child of result.root.children ?? []) walk(child, false);
  const percent = formatPercent(matched, result.root.total);
  return t("profiles.searchSummary", { count, percent }, count);
});

// Row and frame menu actions (ProfilesFunctionMenu, the flame graph frame menu).
const copyFunctionName = (name: string) =>
  copyToClipboard(name, t, { successMessage: t("common.copiedToClipboard") });
const searchForFunction = (name: string) => {
  searchQuery.value = name;
};
/** A Top Table row is a whole function: open the flame graph with every call of it highlighted. */
const showInFlameGraph = (name: string) => {
  searchQuery.value = name;
  activeView.value = "flame";
};
const showDetails = (name: string) => {
  detailsName.value = name;
};
const showSandwich = (name: string) => {
  sandwichFunction.value = name;
  activeView.value = "sandwich";
};
// The props and events every flame graph on the page shares.
const flameGraphProps = computed(() => ({
  unitLabel: tableUnitLabel.value,
  emptyLabel: t("profiles.noProfilesFound"),
  valueFormatter: formatTableValue,
  searchQuery: searchQuery.value,
}));
const flameGraphEvents = {
  search: searchForFunction,
  sandwich: showSandwich,
  details: showDetails,
};
/** Call Tree ids are the flame graph's frame paths, so a row can focus that exact frame. */
const focusInFlameGraph = async (path: string) => {
  activeView.value = "flame";
  await nextTick();
  flameGraphRef.value?.focus(path);
};

const metaResponse = ref<{
  services: string[];
  profile_types: Array<{ type: string; unit: string }>;
  label_names: string[];
} | null>(null);
const seriesResponse = ref<ProfilesSeriesResponse | null>(null);
const mergeResult = ref<ProfilesMergeResponse | null>(null);
// The inputs and window of the run on screen; the URL and the share link describe it, not unrun changes.
const lastRun = ref<{
  query: Record<string, string>;
  range: { startTime: number; endTime: number };
  payload: ProfilesQueryBody;
} | null>(null);
const compareState = ref<CompareState>(defaultCompareState());
/** The label the chart draws one line per value of; null draws one line. */
const breakdownLabel = ref<string | null>(null);
const seriesLoading = ref(false);
let seriesAbort: AbortController | null = null;
let seriesRequestSeq = 0;

const queryLoading = ref(false);
// Auto Run (server ZO_AUTO_QUERY_ENABLED plus the user's switch, shared with Logs and Traces).
const { isAutoRunAvailable, isAutoRunOn, toggleAutoRun } = useAutoRunToggle();
// The inputs changed since the last run while Auto Run is off; Run query turns amber until it runs.
const runPending = ref(false);
// The last query was cancelled before it answered.
const queryCancelled = ref(false);
const runOptionsOpen = ref(false);
const errorMessage = ref("");
// False until the stream list answers, so "no streams" does not flash while it loads.
const streamsLoaded = ref(false);
// True while initPage loads streams, meta and the first query, so no empty state flashes in between.
const initializing = ref(false);
// While a query runs, every view shows a skeleton in place of the old results, as Logs does.
const showSkeleton = computed(() => queryLoading.value || initializing.value);
const FLAME_SKELETON_WIDTHS = ["w-full", "w-11/12", "w-3/4", "w-7/12", "w-5/12", "w-1/4"];
let metaRequestSeq = 0;
let queryRequestSeq = 0;
let tagValuesRequestSeq = 0;
let initRunSeq = 0;
// Holds the stream and date watchers off while a route seed is applied or dropped, so they cannot reset it or reload.
let seeding = false;
let lastRunSeeded = false;
// The focus from a link belongs to the first run's tree; any later run draws a tree its index path may not match.
let keepSeededFocus = false;
// Set while a watcher reloads meta, which can pick a new service or type: the select watcher must not run a second query.
let reloadingMeta = false;
// Set by a drag on the chart: that is a direct action on the results, so it runs even with Auto Run off.
let runNextRange = false;
let queryAbort: AbortController | null = null;
// The seed this page last wrote to the URL, so the route watcher does not reload for its own write.
let syncedSeedKey = "";

const orgIdentifier = computed(
  () => store.state.selectedOrganization?.identifier as string | undefined,
);
// A newer initPage (org or route change) supersedes every request started before it.
const isStaleRun = (run: number, org: string) => run !== initRunSeq || org !== orgIdentifier.value;

const serviceOptions = computed<SelectOption[]>(() =>
  (metaResponse.value?.services ?? []).map((value) => ({ label: raw(value), value })),
);
const profileTypeOptions = computed<SelectOption[]>(() =>
  (metaResponse.value?.profile_types ?? []).map((item) => ({
    label: raw(`${item.type} (${seriesUnitLabel(item.type, item.unit)})`),
    value: `${item.type}\u0000${item.unit}`,
  })),
);
// A type seeded from the URL is shown by its label, not its raw id, until meta lists it.
const profileTypeSelectOptions = computed<SelectOption[]>(() => {
  const selected = selectedProfileType.value;
  const options = profileTypeOptions.value;
  if (!selected || options.some((option) => option.value === selected)) return options;
  const [type, unit = ""] = selected.split("\u0000");
  return [...options, { label: raw(`${type} (${seriesUnitLabel(type, unit)})`), value: selected }];
});
const tagKeyOptions = computed<SelectOption[]>(() =>
  (metaResponse.value?.label_names ?? []).map((value) => ({ label: raw(value), value })),
);
const BREAKDOWN_NONE = "none";
// Labels that change per request or thread give one line per sample, not a breakdown.
const PER_REQUEST_LABEL = /(^|_)(trace|span|request|thread)_?id$|^process_pid$/;
const compareLabels = computed<SelectOption[]>(() =>
  tagKeyOptions.value.filter((option) => !PER_REQUEST_LABEL.test(String(option.value))),
);
const breakdownOptions = computed<SelectOption[]>(() => [
  { label: t("profiles.breakdownNone"), value: BREAKDOWN_NONE },
  ...compareLabels.value,
]);
const currentProfileType = computed(() => {
  const selected = selectedProfileType.value;
  if (!selected) return null;
  const [type, unit = ""] = selected.split("\u0000");
  if (!type) return null;
  return { type, unit };
});

const canQuery = computed(
  () => !!orgIdentifier.value && !!selectedStream.value && !!currentProfileType.value,
);
const runButtonTooltip = computed(() => {
  if (!canQuery.value) return t("profiles.runNeedsProfileType");
  return runPending.value ? t("search.autoRunPendingDot") : t("search.autoRunEnabled");
});
const hasProfileData = computed(() => (mergeResult.value?.total ?? 0) > 0);
// The server keeps the most common stacks only; say how much of the data the views show.
const sampledPercent = computed(() => {
  const result = mergeResult.value;
  if (!result?.truncated || !result.total) return "";
  return formatPercent(result.merged_total, result.total);
});
const seriesPoints = computed(() => seriesResponse.value?.series ?? []);
const seriesStepSecs = computed(() => Math.max(1, seriesResponse.value?.step_secs ?? 1));
const currentUnit = computed(
  () => currentProfileType.value?.unit || seriesResponse.value?.unit || "",
);
const currentType = computed(
  () => currentProfileType.value?.type || seriesResponse.value?.profile_type || "",
);
const isCpuMetric = computed(
  () => currentType.value.toLowerCase() === "cpu" && /nano/i.test(currentUnit.value),
);

// Token values change with the theme, so they are re-read whenever it switches.
const seriesColors = computed(() => {
  void themeRevision.value;
  return {
    palette: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((step) =>
      cssToken(`--color-chart-series-${step}`, ""),
    ),
    others: cssToken("--color-border-strong", ""),
  };
});
type SeriesDatum = [number, number | null];
type SeriesLine = {
  key: string;
  label: string;
  value: string;
  others: boolean;
  color: string;
  points: ProfilesSeriesPoint[];
};
/** One line per Breakdown value (heaviest first, then Others), or the single total line. */
const seriesLines = computed<SeriesLine[]>(() => {
  const groups = seriesResponse.value?.groups;
  if (!groups?.length) {
    return [
      {
        key: "total",
        label: currentType.value,
        value: "",
        others: false,
        color: seriesColors.value.palette[0],
        points: seriesPoints.value,
      },
    ];
  }
  const { palette, others } = seriesColors.value;
  let colorIndex = 0;
  // Values in their own order (v1.4.0, v1.5.0, v1.10.0), so a value keeps its colour; Others last.
  const ordered = [...groups].sort(
    (a, b) =>
      Number(a.others) - Number(b.others) ||
      a.value.localeCompare(b.value, undefined, { numeric: true }),
  );
  return ordered.map((group, index) => ({
    key: group.others ? "others" : String(index),
    label: group.others
      ? t("profiles.breakdownOthers")
      : group.value || t("profiles.breakdownNoValue"),
    value: group.value,
    others: group.others,
    color: group.others ? others : palette[colorIndex++ % palette.length],
    points: group.series,
  }));
});

const seriesChartData = computed(() => {
  const lines = seriesLines.value;
  // In-use memory is a snapshot, so an empty bucket is missing data, not 0 B.
  const gapValue = currentType.value.toLowerCase().startsWith("inuse_") ? null : 0;
  const lineData = lines.map((line) =>
    withGaps(
      line.points.map((point): SeriesDatum => [
        Math.floor(point.timestamp / 1000),
        seriesDisplayValue(point),
      ]),
      (seriesResponse.value?.step_secs ?? 0) * 1000,
      gapValue,
    ),
  );
  const seriesData = lineData.flat();
  const runRange = lastRun.value?.range;
  return {
    options: {
      // In dark mode the ECharts theme draws its own background, which would box the chart in.
      backgroundColor: "transparent",
      // Tooltip, grid and y axis follow the Logs histogram (utils/logs/convertLogData.ts).
      tooltip: {
        show: true,
        trigger: "axis",
        textStyle: { fontSize: 12 },
        axisPointer: { type: "cross", label: { show: true, fontSize: 12 } },
        valueFormatter: (v: number | null | undefined) => formatSeriesValue(v),
      },
      grid: { containLabel: true, left: 20, right: 20, top: 8, bottom: 5 },
      // Drag across the chart to pick a time range, as on the Logs histogram; the toolbox itself stays hidden.
      toolbox: {
        show: true,
        showTitle: false,
        tooltip: { show: false },
        itemSize: 0,
        itemGap: 0,
        bottom: "100%",
        feature: {
          dataZoom: { brushStyle: dataZoomBrushStyle(), show: true, yAxisIndex: "none" },
        },
      },
      // The axis spans the run's window, so one bucket is not stretched to fill the chart.
      xAxis: {
        type: "time",
        min: runRange ? Math.floor(runRange.startTime / 1000) : undefined,
        max: runRange ? Math.floor(runRange.endTime / 1000) : undefined,
        axisLabel: { hideOverlap: true },
      },
      yAxis: {
        type: "value",
        axisLine: { show: true },
        axisPointer: {
          label: { formatter: ({ value }: { value: number }) => formatSeriesAxisLabel(value) },
        },
        // Same tick count as the Logs histogram; drop any label that still collides.
        splitNumber: 3,
        interval: isBytesUnit.value ? byteAxisInterval(seriesData) : undefined,
        axisLabel: {
          hideOverlap: true,
          formatter: (v: number) => formatSeriesAxisLabel(v),
        },
      },
      series: lines.map((line, index) => {
        const isolated = isolatedPoints(lineData[index]);
        const fewPoints = line.points.length < 3;
        return {
          type: "line",
          name: line.label,
          smooth: false,
          // With symbols off, a lone point (or one cut off by a gap) draws nothing, and two read as a bare segment.
          showSymbol: fewPoints || isolated.size > 0,
          symbol:
            fewPoints || !isolated.size
              ? undefined
              : (_value: unknown, params: { dataIndex: number }) =>
                  isolated.has(params.dataIndex) ? "emptyCircle" : "none",
          color: line.color || undefined,
          lineStyle: { width: 2 },
          // An area under one line reads as volume; under several it hides the lines below.
          areaStyle: lines.length === 1 ? { opacity: 0.12 } : undefined,
          data: lineData[index],
        };
      }),
    },
  };
});
const topRows = computed(() => {
  const needle = searchQuery.value.trim().toLowerCase();
  const rows = [...(mergeResult.value?.top ?? [])].filter((row) =>
    needle ? row.name.toLowerCase().includes(needle) : true,
  );
  return rows;
});
const functionOptions = computed<SelectOption[]>(() =>
  [...(mergeResult.value?.top ?? [])]
    .sort((a, b) => b.total - a.total)
    .map((row) => ({ label: raw(row.name), value: row.name })),
);
const sandwichName = computed(() => {
  const top = mergeResult.value?.top ?? [];
  if (sandwichFunction.value && top.some((row) => row.name === sandwichFunction.value))
    return sandwichFunction.value;
  return (
    top.reduce<{ name: string; self: number } | null>(
      (best, row) => (!best || row.self > best.self ? row : best),
      null,
    )?.name ?? null
  );
});
const sandwichCallers = computed(() =>
  sandwichName.value ? callersOf(mergeResult.value?.root ?? null, sandwichName.value) : null,
);
const sandwichCallees = computed(() =>
  sandwichName.value ? calleesOf(mergeResult.value?.root ?? null, sandwichName.value) : null,
);
/** Share of a function's samples that the cut call tree still holds, or "" when it holds them all. */
const treeCoverage = (name: string | null, drawn: number) => {
  const exact = mergeResult.value?.top.find((row) => row.name === name)?.total ?? 0;
  if (exact <= 0 || drawn / exact >= 0.995) return "";
  return formatPercent(drawn, exact);
};
const sandwichCoverage = computed(() =>
  treeCoverage(sandwichName.value, sandwichCallees.value?.total ?? 0),
);
// Function details: exact Self and Total from the Top list, callers and callees from the drawn tree.
const detailsRow = computed(
  () => mergeResult.value?.top.find((row) => row.name === detailsName.value) ?? null,
);
const detailsCallers = computed(() =>
  detailsRow.value ? callersOf(mergeResult.value?.root ?? null, detailsRow.value.name) : null,
);
const detailsCallees = computed(() =>
  detailsRow.value ? calleesOf(mergeResult.value?.root ?? null, detailsRow.value.name) : null,
);
const detailsCoverage = computed(() =>
  treeCoverage(detailsRow.value?.name ?? null, detailsCallees.value?.total ?? 0),
);
// More self time in the tree than in the Top list means the server folded callees into this frame.
const detailsFolded = computed(
  () => !!detailsRow.value && (detailsCallees.value?.self ?? 0) > detailsRow.value.self * 1.005,
);
const detailsCallPaths = computed(() => {
  const name = detailsRow.value?.name;
  let count = 0;
  const walk = (node: ProfilesTreeNode) => {
    if (node.name === name) count += 1;
    node.children?.forEach(walk);
  };
  if (name && mergeResult.value?.root) walk(mergeResult.value.root);
  return count;
});
/** The merged call tree, children by total descending, with path ids for OTable tree mode. */
const stackTree = computed<StackNode[]>(() => {
  const root = mergeResult.value?.root;
  if (!root) return [];
  const build = (node: ProfilesTreeNode, id: string): StackNode => {
    const children = [...(node.children ?? [])]
      .sort((a, b) => b.total - a.total)
      .map((child, index) => build(child, `${id}/${index}`));
    return {
      id,
      name: node.name,
      self: node.self,
      total: node.total,
      childCount: children.length,
      nodeCount: children.reduce((sum, child) => sum + 1 + child.nodeCount, 0),
      ...(children.length ? { children } : {}),
    };
  };
  return [build(root, "root")];
});
/** The value cells both tables share: a plain value, or a share of all samples with a bar. */
const VALUE_CELLS = [
  { id: "self", field: "self", bar: false },
  { id: "selfPercent", field: "self", bar: true },
  { id: "total", field: "total", bar: false },
  { id: "totalPercent", field: "total", bar: true },
] as const;
// As in RankedKeysTable: the name column takes the spare width, and the number columns stay narrow and right-aligned, like the shared data-bar cell.
const profileColumns = computed<OTableColumnDef[]>(() => {
  const left = { align: "left" as const };
  const right = { align: "right" as const };
  return [
    {
      id: "name",
      header: t("profiles.functions"),
      accessorKey: "name",
      size: 320,
      meta: { ...left, fillRemaining: true },
    },
    {
      id: "self",
      header: t("profiles.self"),
      accessorKey: "self",
      sortable: true,
      size: 120,
      meta: right,
    },
    {
      id: "selfPercent",
      header: t("profiles.selfPercent"),
      accessorKey: "self",
      sortable: true,
      size: 110,
      meta: right,
    },
    {
      id: "total",
      header: t("profiles.total"),
      accessorKey: "total",
      sortable: true,
      size: 120,
      meta: right,
    },
    {
      id: "totalPercent",
      header: t("profiles.totalPercent"),
      accessorKey: "total",
      sortable: true,
      size: 110,
      meta: right,
    },
  ];
});

const seriesUnitLabel = (profileType: string, unit: string) => {
  if (profileType.toLowerCase() === "cpu" && /nano/i.test(unit)) return "cores";
  if (/nanosecond|^ns$/i.test(unit)) return "nanoseconds";
  if (/byte|^b$/i.test(unit)) return "bytes";
  if (!unit) return "count";
  return unit;
};

const tableUnitLabel = computed(() => {
  if (isCpuMetric.value) return t("profiles.cpuDuration");
  return seriesUnitLabel(currentType.value, currentUnit.value);
});

const formatBytes = (value: number) => {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let current = Math.abs(value);
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  const signed = value < 0 ? -current : current;
  return `${signed.toLocaleString(undefined, { maximumFractionDigits: current >= 100 ? 0 : 2 })} ${units[index]}`;
};

const formatDurationNanos = (value: number) => {
  const abs = Math.abs(value);
  if (abs < 1_000) return `${value.toLocaleString()} ns`;
  if (abs < 1_000_000)
    return `${(value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} µs`;
  if (abs < 1_000_000_000) {
    return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} ms`;
  }
  if (abs < 60_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`;
  }
  if (abs < 3_600_000_000_000) {
    return `${(value / 60_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} min`;
  }
  return `${(value / 3_600_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;
};

const formatTableValue = (value: number) => {
  if (isCpuMetric.value) return formatDurationNanos(value);
  if (/byte|^b$/i.test(currentUnit.value)) return formatBytes(value);
  if (/nanosecond|^ns$/i.test(currentUnit.value)) return formatDurationNanos(value);
  return formatEventCount(Number(value || 0));
};

/** CPU as cores: CPU time per second of profiled time when the server knows it, else per second of the step. */
const seriesDisplayValue = (point: ProfilesSeriesPoint) => {
  if (!isCpuMetric.value) return point.value;
  if (point.rate != null) return point.rate / 1_000_000_000;
  return point.value / (seriesStepSecs.value * 1_000_000_000);
};

const formatCpuCore = (value: number) => {
  const abs = Math.abs(value);
  if (abs === 0) return "0 cores";
  if (abs < 0.001) {
    const mcore = value * 1_000;
    const digits = Math.abs(mcore) < 10 ? 3 : 2;
    return `${mcore.toLocaleString(undefined, { maximumFractionDigits: digits })} mcore`;
  }
  const digits = abs < 0.01 ? 6 : abs < 0.1 ? 5 : abs < 1 ? 4 : 3;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })} cores`;
};

const isBytesUnit = computed(() => /byte|^b$/i.test(currentUnit.value));

/** Drops a line to `gapValue` across empty buckets (null breaks it), so a gap is not drawn as a slope. */
const withGaps = (points: SeriesDatum[], stepMs: number, gapValue: number | null) => {
  // Without the server's bucket size a gap cannot be told from normal spacing.
  if (!(stepMs > 0)) return points;
  const filled: SeriesDatum[] = [];
  for (const point of points) {
    const previous = filled.at(-1);
    if (previous && point[0] - previous[0] > stepMs * 1.5) {
      const gapStart = previous[0] + stepMs;
      const gapEnd = point[0] - stepMs;
      filled.push([gapStart, gapValue]);
      if (gapValue !== null && gapEnd > gapStart) filled.push([gapEnd, gapValue]);
    }
    filled.push(point);
  }
  return filled;
};

/** Indexes of points with no non-null neighbour, which a line cannot draw without a symbol. */
const isolatedPoints = (points: SeriesDatum[]) => {
  const isolated = new Set<number>();
  points.forEach(([, value], index) => {
    if (value === null) return;
    const before = points[index - 1]?.[1] ?? null;
    const after = points[index + 1]?.[1] ?? null;
    if (before === null && after === null) isolated.add(index);
  });
  return isolated;
};

/** Byte ticks on round binary steps (0, 2.5, 5 GiB), not decimal steps shown as 3.73 GiB. */
const byteAxisInterval = (points: SeriesDatum[]) => {
  // A loop, not Math.max(...spread), which overflows the call stack on long multi-line runs.
  let max = 0;
  for (const [, value] of points) if (value !== null && value > max) max = value;
  if (!max) return undefined;
  const unitSize = 1024 ** Math.min(4, Math.floor(Math.log(max) / Math.log(1024)));
  return niceStep(max / unitSize / 3) * unitSize;
};

/** Short axis labels as on the Logs histogram (1.50K, 2.00s); bytes use the table's binary units (2.5 GiB). */
const formatSeriesAxisLabel = (value: number) => {
  if (isBytesUnit.value) return formatBytes(value);
  let unit = "numbers";
  if (!isCpuMetric.value && /nanosecond|^ns$/i.test(currentUnit.value)) unit = "nanoseconds";
  return formatUnitValue(getUnitValue(value, unit, "", 2));
};

const formatSeriesValue = (value: number | null | undefined) => {
  // In-use gaps are null so the line breaks; formatting them would read as a real 0 B.
  if (value === null || value === undefined) return "—";
  if (isCpuMetric.value) return formatCpuCore(value);
  if (/byte|^b$/i.test(currentUnit.value)) return formatBytes(value);
  if (/nanosecond|^ns$/i.test(currentUnit.value)) return formatDurationNanos(value);
  return Number(value).toLocaleString();
};

/** Share of all samples, 0–100, for the % column bars. */
const shareOf = (value: number) => {
  const total = mergeResult.value?.total ?? 0;
  return total > 0 ? (value / total) * 100 : 0;
};

const highlightName = (name: string) => {
  const query = searchQuery.value.trim();
  if (!query) return escapeHtml(name);
  const lowerName = name.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let html = "";
  let cursor = 0;
  while (cursor < name.length) {
    const matchAt = lowerName.indexOf(lowerQuery, cursor);
    if (matchAt === -1) {
      html += escapeHtml(name.slice(cursor));
      break;
    }
    html += escapeHtml(name.slice(cursor, matchAt));
    html += `<mark class="bg-status-warning-bg text-text-body rounded-default px-0.5">${escapeHtml(
      name.slice(matchAt, matchAt + query.length),
    )}</mark>`;
    cursor = matchAt + query.length;
  }
  return html;
};

const resetStackExpansion = (root?: ProfilesTreeNode) => {
  if (root?.children?.length) {
    expandedStackIds.value = ["root"];
    return;
  }
  expandedStackIds.value = [];
};

/** A drag on the chart sets the picker to that range, in whole minutes, and the query runs, as on Metrics. */
const onRangeSelect = async ({ start, end }: { start: number; end: number }) => {
  if (!start || !end || end <= start) return;
  const range = { start: new Date(start), end: new Date(end) };
  range.start.setSeconds(0, 0);
  range.end.setSeconds(0, 0);
  if (range.start.getTime() === range.end.getTime())
    range.end.setMinutes(range.end.getMinutes() + 1);
  // The picker applies at once, so setCustomDate alone emits the range; a refresh() would emit it twice.
  runNextRange = true;
  datePickerRef.value?.setCustomDate("absolute", range);
};

const resolveTimeRange = () => {
  if (dateState.value.valueType === "relative") {
    return getConsumableRelativeTime(dateState.value.relativeTimePeriod) ?? null;
  }
  if (dateState.value.startTime > 0 && dateState.value.endTime > 0) {
    return { startTime: dateState.value.startTime, endTime: dateState.value.endTime };
  }
  return getConsumableRelativeTime("15m") ?? null;
};

const queryPayload = (range = resolveTimeRange()): ProfilesQueryBody | null => {
  const profileType = currentProfileType.value;
  if (!range || !profileType) return null;
  return {
    start_time: range.startTime,
    end_time: range.endTime,
    service_name: selectedService.value || undefined,
    profile_type: profileType.type,
    profile_unit: profileType.unit,
    filters: appliedFilters.value.map((filter) => ({ ...filter })),
  };
};

const buildErrorMessage = (error: unknown): string => {
  const err = error as {
    response?: { data?: { message?: string; error?: string } };
    message?: string;
  };
  return (
    err.response?.data?.message ||
    err.response?.data?.error ||
    err.message ||
    t("profiles.errors.loadFailed")
  );
};

const invalidateTagValuesRequest = () => {
  tagValuesRequestSeq += 1;
  tagValuesLoading.value = false;
};

const clearDraftTag = () => {
  invalidateTagValuesRequest();
  editingFilterIndex.value = null;
  draftTagKey.value = null;
  draftTagValue.value = null;
  tagValueOptions.value = [];
};

const resetProfilesState = () => {
  selectedService.value = null;
  selectedProfileType.value = null;
  appliedFilters.value = [];
  searchQuery.value = "";
  clearDraftTag();
  seriesResponse.value = null;
  mergeResult.value = null;
  lastRun.value = null;
  breakdownLabel.value = null;
  compareState.value = defaultCompareState();
  expandedStackIds.value = [];
  activeView.value = "top";
  sandwichFunction.value = null;
  detailsName.value = null;
  flameFocus.value = null;
  keepSeededFocus = false;
  errorMessage.value = "";
};

/** Stops waiting for the query: the last results stay, and Run query shows the inputs as pending. */
const cancelQuery = () => {
  queryAbort?.abort();
  queryAbort = null;
  queryRequestSeq += 1;
  queryLoading.value = false;
  runPending.value = true;
  queryCancelled.value = true;
};

/** With Auto Run on, a changed input runs the query; with it off, Run query shows the change as pending. */
const runOrMarkPending = async () => {
  if (isAutoRunOn.value) {
    await runQuery();
    return;
  }
  runPending.value = true;
};

/** Sets a label filter in place of the one at `index` and of any other filter on the same label. */
const setLabelFilter = (key: string, value: string, index = -1) => {
  // One filter per label: the server joins filters with AND, so two values of one label match nothing.
  const keep = (filter: ProfileFilter, i: number) => i !== index && filter.key !== key;
  const current = appliedFilters.value;
  const anchor = index >= 0 ? index : current.findIndex((filter) => filter.key === key);
  const next = current.filter(keep);
  const at = anchor < 0 ? next.length : current.slice(0, anchor).filter(keep).length;
  next.splice(at, 0, { key, op: "=", value });
  appliedFilters.value = next;
};

/** A click on a Breakdown legend chip filters the page to that value. */
const filterToBreakdownValue = async (line: SeriesLine) => {
  if (line.others || !breakdownLabel.value) return;
  setLabelFilter(breakdownLabel.value, line.value);
  await runOrMarkPending();
};

/** Adds the draft filter, or replaces the one being edited, then closes the menu and re-runs. */
const applyDraftFilter = async () => {
  const key = draftTagKey.value;
  const value = draftTagValue.value;
  if (!key || !value) return;
  setLabelFilter(key, value, editingFilterIndex.value ?? -1);
  editingFilterIndex.value = null;
  draftTagKey.value = null;
  await runOrMarkPending();
};

const removeFilter = async (filter: ProfileFilter) => {
  appliedFilters.value = appliedFilters.value.filter(
    (item) => !(item.key === filter.key && item.value === filter.value),
  );
  await runOrMarkPending();
};

const loadTagValues = async () => {
  const org = orgIdentifier.value;
  const stream = selectedStream.value;
  const tag = draftTagKey.value;
  const range = resolveTimeRange();
  const profileType = currentProfileType.value;
  if (!org || !stream || !tag || !range) {
    tagValueOptions.value = [];
    return;
  }
  const requestSeq = ++tagValuesRequestSeq;
  tagValuesLoading.value = true;
  try {
    const response = await profilesService.tagValues(org, stream, {
      start_time: range.startTime,
      end_time: range.endTime,
      service_name: selectedService.value || undefined,
      profile_type: profileType?.type,
      profile_unit: profileType?.unit,
      // The filter being edited must not narrow its own value list.
      filters: appliedFilters.value
        .filter((_, index) => index !== editingFilterIndex.value)
        .map((filter) => ({ ...filter })),
      tag,
    });
    if (requestSeq !== tagValuesRequestSeq) return;
    tagValueOptions.value = (response.data.values ?? []).map((value) => ({
      label: raw(value),
      value,
    }));
    if (
      draftTagValue.value &&
      !tagValueOptions.value.some((option) => option.value === draftTagValue.value)
    ) {
      draftTagValue.value = null;
    }
  } catch {
    // As the Metrics label filter does: the value list stays empty, and the results stay.
    if (requestSeq !== tagValuesRequestSeq) return;
    tagValueOptions.value = [];
  } finally {
    if (requestSeq === tagValuesRequestSeq) {
      tagValuesLoading.value = false;
    }
  }
};

const loadStreams = async () => {
  const org = orgIdentifier.value;
  if (!org) return;
  const run = initRunSeq;
  streamsLoaded.value = false;
  let response;
  try {
    response = await streamService.nameList(org, "profiles", false);
  } catch (error) {
    if (isStaleRun(run, org)) return;
    streamOptions.value = [];
    selectedStream.value = null;
    errorMessage.value = buildErrorMessage(error);
    return;
  }
  if (isStaleRun(run, org)) return;
  streamsLoaded.value = true;
  const list = Array.isArray(response?.data?.list) ? response.data.list : [];
  streamOptions.value = list
    .map((item: Record<string, unknown>) => String(item.name ?? item.stream_name ?? ""))
    .filter((name: string) => name.length > 0)
    .map((name: string) => ({ label: raw(name), value: name }));
  if (!streamOptions.value.length) {
    selectedStream.value = null;
    return;
  }
  if (
    !selectedStream.value ||
    !streamOptions.value.some((opt) => opt.value === selectedStream.value)
  ) {
    selectedStream.value = streamOptions.value[0].value;
  }
};

const loadMeta = async () => {
  const org = orgIdentifier.value;
  const stream = selectedStream.value;
  const range = resolveTimeRange();
  if (!org || !stream || !range) return;
  const requestSeq = ++metaRequestSeq;
  const run = initRunSeq;
  const isStale = () => requestSeq !== metaRequestSeq || isStaleRun(run, org);
  // The server scopes only profile_types to service_name; services always lists every service.
  const fetchMeta = (service: string | null) =>
    profilesService.meta(org, stream, {
      start_time: range.startTime,
      end_time: range.endTime,
      ...(service ? { service_name: service } : {}),
    });
  try {
    let service = selectedService.value;
    let response = await fetchMeta(service);
    if (isStale()) return;
    const services: string[] = response.data.services ?? [];
    // An empty window lists no services; keep the chosen one for when data comes back.
    if (services.length && (!service || !services.includes(service))) {
      service = services[0];
      response = await fetchMeta(service);
      if (isStale()) return;
    }
    metaResponse.value = response.data;
    // CPU first, as the Traces "View Profile" link does; the server lists types alphabetically (alloc_objects first).
    const firstProfileType =
      profileTypeOptions.value.find((option) => option.value.startsWith("cpu\u0000"))?.value ??
      profileTypeOptions.value[0]?.value ??
      null;

    selectedService.value = service;
    if (
      !selectedProfileType.value ||
      !profileTypeOptions.value.some((item) => item.value === selectedProfileType.value)
    ) {
      selectedProfileType.value = firstProfileType;
    }
    if (
      draftTagKey.value &&
      !tagKeyOptions.value.some((item) => item.value === draftTagKey.value)
    ) {
      clearDraftTag();
    }
    if (
      breakdownLabel.value &&
      !breakdownOptions.value.some((item) => item.value === breakdownLabel.value)
    ) {
      breakdownLabel.value = null;
    }
  } catch (error) {
    if (isStale()) return;
    errorMessage.value = buildErrorMessage(error);
  }
};

const seriesPayload = (payload: ProfilesQueryBody): ProfilesQueryBody =>
  breakdownLabel.value ? { ...payload, group_by: breakdownLabel.value, group_limit: 10 } : payload;

/** A new Breakdown redraws the chart for the run on screen; the tables do not change. */
const setBreakdown = async (value: unknown) => {
  const label = typeof value === "string" && value !== BREAKDOWN_NONE ? value : null;
  if (label === breakdownLabel.value) return;
  breakdownLabel.value = label;
  const org = orgIdentifier.value;
  const run = lastRun.value;
  if (!org || !run) return;
  const requestSeq = ++seriesRequestSeq;
  seriesAbort?.abort();
  const abort = (seriesAbort = new AbortController());
  seriesLoading.value = true;
  try {
    const response = await profilesService.series(
      org,
      run.query.stream,
      seriesPayload(run.payload),
      { signal: abort.signal },
    );
    if (requestSeq !== seriesRequestSeq) return;
    seriesResponse.value = response.data;
  } catch (error) {
    if (requestSeq !== seriesRequestSeq || abort.signal.aborted) return;
    errorMessage.value = buildErrorMessage(error);
  } finally {
    if (requestSeq === seriesRequestSeq) seriesLoading.value = false;
  }
};

const runQuery = async () => {
  const org = orgIdentifier.value;
  const stream = selectedStream.value;
  const range = resolveTimeRange();
  const payload = queryPayload(range);
  if (!org || !stream || !payload || !range) return;
  // Only the run started with the link's inputs may keep its focus, even if it is superseded or fails.
  const keepFocus = keepSeededFocus;
  keepSeededFocus = false;
  const runState = { query: pageQuery(), range, payload };
  const requestSeq = ++queryRequestSeq;
  const run = initRunSeq;
  queryAbort?.abort();
  seriesAbort?.abort();
  seriesRequestSeq += 1;
  seriesLoading.value = false;
  const abort = (queryAbort = new AbortController());
  queryLoading.value = true;
  runPending.value = false;
  queryCancelled.value = false;
  errorMessage.value = "";
  try {
    const [seriesResult, mergeResponseValue] = await Promise.all([
      profilesService.series(org, stream, seriesPayload(payload), { signal: abort.signal }),
      profilesService.merge(org, stream, { ...payload, max_nodes: 4096 }, { signal: abort.signal }),
    ]);
    if (requestSeq !== queryRequestSeq || isStaleRun(run, org)) return;
    seriesResponse.value = seriesResult.data;
    mergeResult.value = mergeResponseValue.data;
    if (!keepFocus) flameFocus.value = null;
    lastRun.value = runState;
    resetStackExpansion(mergeResponseValue.data.root);
    syncUrl();
  } catch (error) {
    if (requestSeq !== queryRequestSeq || isStaleRun(run, org)) return;
    errorMessage.value = buildErrorMessage(error);
  } finally {
    if (requestSeq === queryRequestSeq) {
      queryLoading.value = false;
    }
  }
};

/** Runs the query while meta loads, and again only when meta replaced the service or profile type. */
const runAlongsideMeta = async (load: () => Promise<void>) => {
  const run = initRunSeq;
  const selection = () => `${selectedService.value}\u0000${selectedProfileType.value}`;
  const before = selection();
  const query = runQuery();
  await load();
  if (run !== initRunSeq) return;
  if (selection() !== before) await runQuery();
  else await query;
};

const queryString = (value: LocationQuery[string]) => (typeof value === "string" ? value : "");
const COMPARE_DISPLAYS = ["flame", "sides", "table"] as const;

const parseRouteSeed = (query: LocationQuery): RouteSeed | null => {
  const stream = queryString(query.stream);
  if (!stream) return null;
  const from = Number(query.from);
  const to = Number(query.to);
  const type = queryString(query.profile_type);
  const view = queryString(query.view);
  return {
    stream,
    range: from > 0 && to > from ? { startTime: from, endTime: to } : null,
    period: queryString(query.period) || null,
    service: queryString(query.service_name) || null,
    profileType: type ? `${type}\u0000${queryString(query.profile_unit)}` : null,
    filters: parseProfileFilters(queryString(query.filters)),
    view: PROFILE_VIEWS.find((item) => item === view) ?? null,
    sandwichFunction: queryString(query.fn) || null,
    search: queryString(query.search),
    focus: queryString(query.focus) || null,
    details: queryString(query.details) || null,
    breakdown: queryString(query.breakdown) || null,
    compare: {
      label: queryString(query.compare_label) || null,
      baseline: queryString(query.compare_a) || null,
      comparison: queryString(query.compare_b) || null,
      display:
        COMPARE_DISPLAYS.find((value) => value === queryString(query.compare_display)) ?? "flame",
    },
  };
};

/** The picker reads its v-model only on mount, so a window set later must be passed to it. */
const showDateInPicker = () => {
  const date = dateState.value;
  datePickerRef.value?.setSavedDate(
    date.valueType === "relative"
      ? { type: "relative", relativeTimePeriod: date.relativeTimePeriod }
      : { type: "absolute", startTime: date.startTime, endTime: date.endTime },
  );
};

const applyRouteSeed = (seed: RouteSeed) => {
  selectedStream.value = seed.stream;
  if (seed.range) {
    dateState.value = { ...seed.range, relativeTimePeriod: "", valueType: "absolute" };
  } else if (seed.period) {
    dateState.value = { ...defaultDateState(), relativeTimePeriod: seed.period };
  }
  selectedService.value = seed.service;
  selectedProfileType.value = seed.profileType;
};

/** The page state as URL query: the same keys the Traces "View Profile" link sends, plus `period`. */
const pageQuery = (range?: { startTime: number; endTime: number } | null) => {
  const profileType = currentProfileType.value;
  const query: Record<string, string> = {
    org_identifier: orgIdentifier.value ?? "",
    stream: selectedStream.value ?? "",
  };
  if (range) {
    query.from = String(range.startTime);
    query.to = String(range.endTime);
  } else if (dateState.value.valueType === "relative") {
    query.period = dateState.value.relativeTimePeriod;
  } else {
    query.from = String(dateState.value.startTime);
    query.to = String(dateState.value.endTime);
  }
  if (selectedService.value) query.service_name = selectedService.value;
  if (profileType) {
    query.profile_type = profileType.type;
    query.profile_unit = profileType.unit;
  }
  const filters = encodeProfileFilters(appliedFilters.value);
  if (filters) query.filters = filters;
  query.view = activeView.value;
  return query;
};

/** Writes the page state to the URL (replace, no history entry), as Metrics does, so a reload keeps it. */
/** What is on screen beyond the run inputs: the view, Sandwich function, search, focus and open details. */
const viewQuery = () => {
  const query: Record<string, string> = { view: activeView.value };
  if (sandwichFunction.value) query.fn = sandwichFunction.value;
  if (searchQuery.value.trim()) query.search = searchQuery.value.trim();
  if (flameFocus.value) query.focus = flameFocus.value;
  if (detailsName.value) query.details = detailsName.value;
  if (breakdownLabel.value) query.breakdown = breakdownLabel.value;
  if (activeView.value === "compare") {
    const compare = compareState.value;
    query.compare_display = compare.display;
    if (compare.label) query.compare_label = compare.label;
    if (compare.baseline) query.compare_a = compare.baseline;
    if (compare.comparison) query.compare_b = compare.comparison;
  }
  return query;
};

const syncUrl = () => {
  if (route.name !== pageRouteName || !lastRun.value) return;
  const query: Record<string, string> = { ...lastRun.value.query, ...viewQuery() };
  const changed =
    Object.keys(query).some((key) => query[key] !== queryString(route.query[key])) ||
    Object.keys(route.query).some((key) => !(key in query));
  if (!changed) return;
  syncedSeedKey = routeKey(query);
  lastRunSeeded = true;
  router.replace({ query }).catch(() => {});
};

// A share link freezes the window of the run on screen, so the person who opens it sees the same samples.
const shareUrl = computed(() => {
  const run = lastRun.value;
  if (!run) return "";
  const url = new URL(window.location.origin + window.location.pathname);
  const query: Record<string, string> = {
    ...run.query,
    from: String(run.range.startTime),
    to: String(run.range.endTime),
    ...viewQuery(),
  };
  delete query.period;
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.href;
});

/** Retry from the step that failed: the stream list, or the meta load and query. */
const retry = async () => {
  if (!streamsLoaded.value || !selectedStream.value) {
    await initPage();
    return;
  }
  errorMessage.value = "";
  await loadMeta();
  await runQuery();
};

const noStreamsActions: EmptyStateAction[] = [
  {
    id: "setup-ingestion",
    icon: "cloud-upload",
    titleKey: "profiles.setupIngestion",
    descriptionKey: "profiles.setupIngestionDesc",
  },
];
/** The in-app Data Sources profiles page, where ingestion is set up. */
const openProfilesIngestion = () => {
  router.push({ name: "ingestProfiles", query: { org_identifier: orgIdentifier.value } });
};

const initPage = async () => {
  const seed = parseRouteSeed(route.query);
  const run = ++initRunSeq;
  const unseed = !seed && lastRunSeeded;
  lastRunSeeded = !!seed;
  // Always hold the watchers: loadStreams picks a stream, and the stream watcher must not run a second query.
  seeding = true;
  initializing.value = true;
  try {
    resetProfilesState();
    if (seed) applyRouteSeed(seed);
    if (unseed) {
      selectedStream.value = null;
      dateState.value = defaultDateState();
    }
    if (seed || unseed) showDateInPicker();
    await loadStreams();
    if (run !== initRunSeq || !selectedStream.value) return;
    if (seed) {
      appliedFilters.value = seed.filters;
      if (seed.view) activeView.value = seed.view;
      searchQuery.value = seed.search;
      sandwichFunction.value = seed.sandwichFunction;
      detailsName.value = seed.details;
      flameFocus.value = seed.focus;
      keepSeededFocus = !!seed.focus;
      breakdownLabel.value = seed.breakdown;
      compareState.value = seed.compare;
    }
    await runAlongsideMeta(loadMeta);
  } finally {
    if (run === initRunSeq) {
      seeding = false;
      initializing.value = false;
    }
  }
};

watch(draftTagKey, async (key, previousKey) => {
  if (key === previousKey) return;
  draftTagValue.value = null;
  tagValueOptions.value = [];
  if (!key) {
    invalidateTagValuesRequest();
    return;
  }
  await loadTagValues();
});

/** Reloads meta for a new stream or window, holding the select watcher so it does not query halfway. */
const reloadMeta = async () => {
  reloadingMeta = true;
  try {
    await loadMeta();
  } finally {
    reloadingMeta = false;
  }
};

// A new service or profile type runs the query (Auto Run) or marks Run query pending.
watch([selectedService, selectedProfileType], async ([service], [previousService]) => {
  if (seeding || reloadingMeta) return;
  // Profile types are scoped to the service; reloadMeta holds this watcher, so it cannot loop.
  if (service !== previousService) await reloadMeta();
  if (draftTagKey.value) {
    draftTagValue.value = null;
    await loadTagValues();
  }
  await runOrMarkPending();
});

watch(selectedStream, async (stream, previousStream) => {
  if (seeding || !stream || stream === previousStream) return;
  clearDraftTag();
  appliedFilters.value = [];
  selectedService.value = null;
  await reloadMeta();
  await runOrMarkPending();
});

// A new window reloads meta, then runs (Auto Run, or a drag on the chart) or marks Run query pending.
watch(dateState, async () => {
  if (seeding) return;
  const fromChart = runNextRange;
  runNextRange = false;
  if (fromChart || isAutoRunOn.value) {
    await runAlongsideMeta(reloadMeta);
  } else {
    await reloadMeta();
    runPending.value = true;
  }
  if (draftTagKey.value) {
    await loadTagValues();
  }
});

/** The org in the URL and the page state it seeds. */
const routeKey = (query: LocationQuery) =>
  JSON.stringify([queryString(query.org_identifier), parseRouteSeed(query)]);
// An org switch changes the store before the URL, so the URL can still name the old org for a moment.
const routeNamesOtherOrg = () => {
  const org = queryString(route.query.org_identifier);
  return !!org && org !== orgIdentifier.value;
};

watch(
  orgIdentifier,
  async (org, previousOrg) => {
    if (!org || org === previousOrg) return;
    // On a switch, the route watcher loads the page once the new URL lands.
    if (previousOrg && routeNamesOtherOrg()) return;
    await initPage();
  },
  { immediate: true },
);

watch(
  () => routeKey(route.query),
  async (key) => {
    if (route.name !== pageRouteName || key === syncedSeedKey || routeNamesOtherOrg()) return;
    await initPage();
  },
);

watch(
  [
    activeView,
    sandwichFunction,
    searchQuery,
    flameFocus,
    detailsName,
    breakdownLabel,
    compareState,
  ],
  () => {
    if (!seeding && mergeResult.value) syncUrl();
  },
);

// The graph keeps its own focus, so a graph that mounts again (or from a link) gets the page's focus.
watch(flameGraphRef, (graph) => {
  if (graph && flameFocus.value) graph.focus(flameFocus.value);
});
</script>
