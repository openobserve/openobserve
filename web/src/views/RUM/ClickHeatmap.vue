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
  <div
    ref="rootRef"
    class="h-full min-h-0"
    :class="isFullscreen ? 'bg-surface-base' : ''"
    data-test="rum-heatmap-page"
  >
    <div class="flex h-full min-h-0 flex-col">
      <div
        class="border-border-default flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2"
        data-test="rum-heatmap-toolbar"
      >
        <div class="min-w-0 flex-[1_1_20rem]">
          <OPopover
            v-model:open="pageOpen"
            :aria-label="t('rum.heatmap.pageLabel')"
            content-class="w-(--reka-popover-trigger-width) p-0"
          >
            <template #trigger>
              <OButton
                variant="outline"
                size="sm"
                block
                :disabled="!pageRows.length"
                :aria-label="t('rum.heatmap.pageLabel')"
                data-test="rum-heatmap-page-select"
              >
                <template #icon-left><OIcon name="link" size="sm" /></template>
                <span
                  class="text-compact min-w-0 flex-1 truncate text-left font-mono"
                  :title="pageUrl"
                  data-test="rum-heatmap-page-current"
                >
                  {{ pageUrl || t("rum.heatmap.pagePlaceholder") }}
                </span>
                <span
                  class="text-text-secondary min-w-14 text-end text-xs font-normal"
                  data-test="rum-heatmap-page-count"
                >
                  {{ pageCountText }}
                </span>
                <template #icon-right><OIcon name="unfold-more" size="sm" /></template>
              </OButton>
            </template>
            <div class="flex flex-col" data-test="rum-heatmap-page-list">
              <div class="border-border-default border-b p-2">
                <OSearchInput
                  v-model="pageQuery"
                  :placeholder="t('rum.heatmap.pageSearch')"
                  data-test="rum-heatmap-page-search"
                />
              </div>
              <div
                class="text-text-secondary grid grid-cols-[minmax(0,1fr)_4.5rem_5rem] gap-2 px-3 py-1.5 text-xs font-normal"
              >
                <span>{{ t("rum.heatmap.pageColPage") }}</span>
                <span class="text-right">{{ t("rum.heatmap.pageColClicksAll") }}</span>
                <span class="text-right">{{ t("rum.heatmap.colSessions") }}</span>
              </div>
              <div class="max-h-72 overflow-auto">
                <OButton
                  v-for="p in visiblePages"
                  :key="p.url"
                  variant="ghost"
                  size="sm"
                  block
                  :aria-current="p.url === pageUrl ? 'true' : undefined"
                  :data-test="`rum-heatmap-page-option-${p.url}`"
                  @click="onPagePick(p.url)"
                >
                  <span
                    class="text-compact grid w-full grid-cols-[minmax(0,1fr)_4.5rem_5rem] items-center gap-2 text-left font-normal"
                    :class="p.url === pageUrl ? 'text-accent' : ''"
                  >
                    <span class="flex min-w-0 items-center gap-1">
                      <OIcon v-if="p.url === pageUrl" name="check" size="sm" class="shrink-0" />
                      <span class="truncate font-mono" :title="p.url">{{ p.url }}</span>
                    </span>
                    <span class="text-right font-medium">{{ addCommasToNumber(p.clicks) }}</span>
                    <span class="text-right">{{ addCommasToNumber(p.sessions) }}</span>
                  </span>
                </OButton>
                <p
                  v-if="pageSearchState === 'loading'"
                  class="text-text-secondary px-3 py-4 text-center text-xs"
                  data-test="rum-heatmap-page-searching"
                >
                  {{ t("rum.heatmap.pageSearching") }}
                </p>
                <p
                  v-else-if="pageSearchState === 'error'"
                  class="text-text-secondary px-3 py-4 text-center text-xs"
                  data-test="rum-heatmap-page-search-failed"
                >
                  {{ t("rum.heatmap.pageSearchFailed") }}
                </p>
                <p
                  v-else-if="!visiblePages.length"
                  class="text-text-secondary px-3 py-4 text-center text-xs"
                  data-test="rum-heatmap-page-none"
                >
                  {{ t("rum.heatmap.pageNone") }}
                </p>
              </div>
              <p
                v-if="pickerLimited"
                class="border-border-default text-text-secondary border-t px-3 py-2 text-xs"
                data-test="rum-heatmap-page-limited"
              >
                {{ t("rum.heatmap.limitedPages", { count: PAGE_LIST_LIMIT }) }}
              </p>
            </div>
          </OPopover>
        </div>
        <OToggleGroup
          :model-value="deviceClass"
          :aria-label="t('rum.heatmap.deviceLabel')"
          mobile-dropdown
          data-test="rum-heatmap-device-select"
          @update:model-value="onDeviceChange"
        >
          <OToggleGroupItem
            v-for="opt in deviceOptions"
            :key="opt.value"
            :value="opt.value"
            :icon-left="opt.icon"
            size="sm"
            :data-test="`rum-heatmap-device-${opt.value}`"
          >
            {{ opt.label }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>

      <OBanner
        v-if="deviceSplitFailed"
        variant="warning"
        dense
        :content="t('rum.heatmap.deviceSplitFailed')"
        data-test="rum-heatmap-device-split-failed"
      />

      <OEmptyState
        v-if="!loading && !listLoading && !pageRows.length && !loadError"
        preset="no-data"
        :title="t('rum.heatmap.noPages')"
        data-test="rum-heatmap-empty"
      />
      <div v-else-if="loadError" class="p-4">
        <OBanner
          variant="warning"
          dense
          :content="loadError ?? undefined"
          data-test="rum-heatmap-load-error"
        >
          <template #actions>
            <OButton
              variant="outline"
              size="sm"
              data-test="rum-heatmap-retry-btn"
              @click="onRetry"
              >{{ t("common.retry") }}</OButton
            >
          </template>
        </OBanner>
      </div>
      <template v-else>
        <div
          class="border-border-default bg-surface-subtle flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2"
          data-test="rum-heatmap-stage-toolbar"
        >
          <div
            class="flex flex-wrap items-center gap-2"
            :aria-busy="loading"
            data-test="rum-heatmap-stats"
          >
            <div
              v-for="stat in statItems"
              :key="stat.key"
              class="border-border-default bg-surface-base rounded-default flex min-w-28 items-baseline gap-1.5 border px-2.5 py-1"
              :data-test="stat.dataTest"
            >
              <span class="text-text-secondary text-xs font-normal">{{ stat.label }}</span>
              <span class="min-w-10 text-sm font-medium tabular-nums" :class="stat.valueClass">{{
                stat.value
              }}</span>
            </div>
          </div>
          <span
            class="bg-border-default h-6 w-px shrink-0 max-lg:hidden"
            aria-hidden="true"
            data-test="rum-heatmap-divider-stats"
          />
          <div class="flex flex-wrap items-center gap-3" data-test="rum-heatmap-view-group">
            <OToggleGroup
              :model-value="viewMode"
              :aria-label="t('rum.heatmap.modeLabel')"
              :title="modeHint"
              data-test="rum-heatmap-mode"
              @update:model-value="onModeChange"
            >
              <OToggleGroupItem
                v-for="opt in modeOptions"
                :key="opt.value"
                :value="opt.value"
                :icon-left="opt.icon"
                size="sm"
                :data-test="`rum-heatmap-mode-${opt.value}`"
              >
                {{ opt.label }}
              </OToggleGroupItem>
            </OToggleGroup>
            <span class="sr-only" data-test="rum-heatmap-mode-hint">{{ modeHint }}</span>
            <div
              class="border-border-default bg-surface-base rounded-default flex shrink-0 items-center gap-3 border px-3 py-1.5"
              data-test="rum-heatmap-view-options"
            >
              <div
                class="flex items-center gap-3"
                :class="heatVisible ? '' : 'invisible'"
                :inert="!heatVisible"
                data-test="rum-heatmap-opacity"
              >
                <span
                  class="text-text-secondary flex shrink-0"
                  data-test="rum-heatmap-opacity-icon"
                >
                  <OIcon name="water-drop" size="sm" />
                  <OTooltip :content="t('rum.heatmap.opacityLabel')" side="bottom" />
                </span>
                <div class="w-32 shrink-0">
                  <OSlider
                    v-model="heatOpacity"
                    :aria-label="t('rum.heatmap.opacityLabel')"
                    :min="0"
                    :max="100"
                    :step="5"
                    size="sm"
                    data-test="rum-heatmap-opacity-slider"
                  />
                </div>
                <span
                  class="text-text-secondary min-w-10 text-end text-sm tabular-nums"
                  data-test="rum-heatmap-opacity-value"
                >
                  {{ formatOpacity(heatOpacity) }}
                </span>
              </div>
              <span class="border-border-default h-5 border-s" aria-hidden="true" />
              <OSwitch v-model="autoScroll" size="sm" data-test="rum-heatmap-auto-scroll">
                <template #label>
                  <span class="text-text-heading text-sm font-normal">{{
                    t("rum.heatmap.autoScroll")
                  }}</span>
                </template>
                <template #tooltip>
                  <OTooltip :content="t('rum.heatmap.autoScrollTip')" side="bottom" />
                </template>
              </OSwitch>
            </div>
          </div>
          <div class="ms-auto flex shrink-0 items-center gap-2" data-test="rum-heatmap-actions">
            <OButton
              v-if="fullscreenSupported"
              variant="outline"
              size="icon-xs-sq"
              :aria-label="fullscreenLabel"
              :aria-pressed="isFullscreen"
              data-test="rum-heatmap-fullscreen-toggle"
              @click="toggleFullscreenMode"
            >
              <OIcon :name="isFullscreen ? 'fullscreen-exit' : 'fullscreen'" size="sm" />
              <OTooltip :content="fullscreenLabel" side="bottom" />
            </OButton>
            <OButton
              variant="outline"
              size="sm"
              :aria-label="panelLabel"
              :aria-expanded="panelOpen"
              data-test="rum-heatmap-panel-toggle"
              @click="panelOpen = !panelOpen"
            >
              <OIcon
                :name="panelOpen ? 'keyboard-double-arrow-right' : 'keyboard-double-arrow-left'"
                size="sm"
              />
              <span class="max-lg:hidden" data-test="rum-heatmap-panel-toggle-text">{{
                panelLabel
              }}</span>
              <OTooltip :content="panelLabel" side="bottom" />
            </OButton>
          </div>
        </div>
        <div
          class="grid min-h-0 flex-1 max-lg:grid-cols-1 max-lg:grid-rows-[minmax(24rem,1fr)_auto]"
          :class="
            panelOpen ? 'grid-cols-[minmax(0,1fr)_minmax(20rem,26%)]' : 'grid-cols-[minmax(0,1fr)]'
          "
        >
          <div class="flex min-h-0 min-w-0 flex-col">
            <div class="relative min-h-0 flex-1 p-4">
              <div
                ref="scrollerRef"
                class="rounded-surface border-border-default h-full min-w-0 overflow-auto border"
                @scroll.passive="tipSuppressed = true"
              >
                <OEmptyState
                  v-if="snapshotError"
                  size="block"
                  :title="snapshotError"
                  data-test="rum-heatmap-snapshot-error"
                />
                <OBanner
                  v-if="pageUrl && !loading && !groups.length"
                  variant="warning"
                  dense
                  :content="
                    totals.clicks > 0
                      ? t('rum.heatmap.noTargets')
                      : deviceClass === 'all'
                        ? t('rum.heatmap.noPosition')
                        : t('rum.heatmap.noDeviceData')
                  "
                  data-test="rum-heatmap-no-position"
                />
                <div class="flex p-4">
                  <div class="relative mx-auto shrink-0">
                    <div ref="fitRef" class="overflow-hidden">
                      <div
                        v-show="snapshotReady"
                        ref="stageRef"
                        role="img"
                        :aria-label="t('rum.heatmap.stageLabel')"
                        class="origin-top-left [&_.replayer-mouse]:hidden [&_.replayer-mouse-tail]:hidden"
                        data-test="rum-heatmap-stage"
                      />
                    </div>
                    <div
                      v-if="hitLayerVisible"
                      class="absolute inset-0 z-10"
                      data-test="rum-heatmap-hit-layer"
                      @mousemove="onStageMove"
                      @mouseleave="stageHover = ''"
                      @click="onStageClick"
                    />
                    <div
                      v-if="hoverBox"
                      class="border-accent bg-accent/10 rounded-default pointer-events-none absolute z-10 border-2"
                      :style="hoverBox"
                      data-test="rum-heatmap-hover-box"
                    />
                    <div
                      v-if="markersVisible"
                      class="pointer-events-none absolute inset-0 z-20"
                      data-test="rum-heatmap-markers"
                    >
                      <div
                        v-for="m in markers"
                        :key="m.selector"
                        role="button"
                        tabindex="0"
                        :aria-label="m.ariaLabel"
                        :aria-pressed="m.selected"
                        class="rounded-default pointer-events-auto absolute cursor-pointer border-2"
                        :class="[m.borderClass, m.active ? 'bg-accent/10 z-20' : 'z-10']"
                        :style="m.style"
                        :data-test="`rum-heatmap-marker-${m.selector}`"
                        @mouseenter="showTip(m.selector)"
                        @mouseleave="tipSelector = ''"
                        @focus="showTip(m.selector)"
                        @blur="tipSelector = ''"
                        @click="onMarkerSelect(m.selector)"
                        @keydown.enter.prevent="onMarkerSelect(m.selector)"
                        @keydown.space.prevent="onMarkerSelect(m.selector)"
                      >
                        <span
                          class="absolute -start-2.5 -top-2.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.6875rem] font-medium text-white"
                          :class="m.badgeClass"
                          aria-hidden="true"
                          data-test="rum-heatmap-marker-badge"
                        >
                          {{ m.rank }}
                        </span>
                      </div>
                    </div>
                    <div
                      v-if="tipView"
                      class="bg-text-heading text-surface-base rounded-default pointer-events-none absolute z-30 w-56 px-3 py-2.5 text-xs leading-normal shadow-lg"
                      :style="tipView.style"
                      role="tooltip"
                      data-test="rum-heatmap-element-tip"
                    >
                      <div class="truncate text-sm font-medium" data-test="rum-heatmap-tip-name">
                        {{ tipView.name }}
                      </div>
                      <div
                        v-if="tipView.hasName"
                        class="truncate font-mono"
                        data-test="rum-heatmap-tip-selector"
                      >
                        {{ tipView.selector }}
                      </div>
                      <div class="mt-1.5 flex flex-wrap gap-x-4">
                        <span data-test="rum-heatmap-tip-clicks">{{ tipView.clicksText }}</span>
                        <span data-test="rum-heatmap-tip-share">{{ tipView.shareText }}</span>
                        <span data-test="rum-heatmap-tip-sessions">{{ tipView.sessionsText }}</span>
                      </div>
                      <div
                        v-if="tipView.frustratedText"
                        class="mt-1.5"
                        data-test="rum-heatmap-tip-frustrated"
                      >
                        {{ tipView.frustratedText }}
                        <span class="block">{{ tipView.splitText }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-if="snapshotLoading"
                class="pointer-events-none absolute inset-0 flex items-center justify-center"
              >
                <OSpinner size="lg" data-test="rum-heatmap-snapshot-loading" />
              </div>
              <div
                v-if="snapshotReady && heatVisible"
                class="border-border-default bg-surface-base rounded-default pointer-events-none absolute bottom-8 left-8 flex items-center gap-2 border px-2.5 py-1.5 text-xs shadow-sm"
                data-test="rum-heatmap-legend"
              >
                {{ t("rum.heatmap.legendFewer") }}
                <span class="bg-heat-legend h-2 w-24 rounded-full" aria-hidden="true" />
                {{ t("rum.heatmap.legendMore") }}
              </div>
            </div>
          </div>

          <div
            v-show="panelOpen"
            ref="panelRef"
            class="border-border-default flex min-h-0 flex-col border-s max-lg:border-s-0 max-lg:border-t"
            data-test="rum-heatmap-panel"
          >
            <div class="border-border-default flex flex-col gap-2 border-b px-4 py-2">
              <OSearchInput
                v-model="elementQuery"
                :placeholder="t('rum.heatmap.elementSearch')"
                data-test="rum-heatmap-element-search"
              />
              <div class="flex flex-wrap items-center gap-1.5">
                <OBadge
                  v-for="chip in chips"
                  :key="chip.key"
                  :variant="chip.active ? 'primary-soft' : 'default-outline'"
                  clickable
                  :disabled="chip.disabled"
                  :title="chip.title"
                  :aria-pressed="chip.active"
                  :data-test="`rum-heatmap-chip-${chip.key}`"
                  @click="chip.toggle"
                >
                  {{ chip.label }}
                </OBadge>
              </div>
              <p
                v-if="unusedReason"
                class="text-text-secondary text-xs"
                data-test="rum-heatmap-unused-reason"
              >
                {{ unusedReason }}
              </p>
            </div>
            <div
              class="border-border-default bg-surface-subtle flex items-center justify-between gap-2 border-y px-4 py-1.5"
              data-test="rum-heatmap-element-bar"
            >
              <span class="text-text-secondary text-xs" data-test="rum-heatmap-element-count">
                <span class="font-medium">{{ visibleRows.length }}</span>
                {{ t("rum.heatmap.elementNoun", {}, visibleRows.length) }}
              </span>
              <OSelect
                v-model="sortOrder"
                :aria-label="t('rum.heatmap.sortLabel')"
                :options="sortOptions"
                appearance="inline"
                size="sm"
                class="text-accent text-xs"
                data-test="rum-heatmap-sort-select"
              />
            </div>
            <div class="min-h-0 flex-1 overflow-auto">
              <OEmptyState
                v-if="groups.length && !visibleRows.length"
                size="block"
                :title="t('rum.heatmap.noElementMatch')"
                :action-label="t('rum.heatmap.clearFilters')"
                data-test="rum-heatmap-no-match"
                @action="clearElementFilters"
              />
              <OTable
                v-else
                :data="visibleRows"
                :columns="columns"
                :default-columns="false"
                row-key="selector"
                pagination="none"
                :show-header="false"
                :show-global-filter="false"
                :frame="false"
                horizontal-scroll
                :row-class="rowClass"
                :loading="loading"
                data-test="rum-heatmap-elements-table"
                @row-click="onRowClick"
                :row-rail-tone="rowRailTone"
                @row-mouseenter="(row: ElementRow) => (rowHover = row.selector)"
                @row-mouseleave="rowHover = ''"
              >
                <template #cell-feature="{ row }">
                  <div
                    class="flex min-w-0 flex-col gap-0.5 py-1"
                    :title="rowTitle(row) || undefined"
                    :data-test="`rum-heatmap-feature-${row.selector}`"
                  >
                    <span
                      v-if="row.firstUnused"
                      class="text-text-secondary text-xs font-normal"
                      data-test="rum-heatmap-unused-heading"
                    >
                      {{ t("rum.heatmap.unusedHeading") }}
                    </span>
                    <div class="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3">
                      <span
                        class="text-text-secondary text-end text-xs tabular-nums"
                        data-test="rum-heatmap-row-rank"
                      >
                        {{ row.rank }}
                      </span>
                      <div class="flex min-w-0 flex-col gap-1.5">
                        <OTruncatedText class="text-sm font-medium">{{
                          row.feature
                        }}</OTruncatedText>
                        <div
                          v-if="row.clicks"
                          class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                          data-test="rum-heatmap-row-stats"
                        >
                          <OProgressBar
                            :value="clicksMax > 0 ? row.clicks / clicksMax : 0"
                            size="xs"
                            class="w-24 shrink-0"
                            data-test="rum-heatmap-row-bar"
                          />
                          <span
                            class="text-text-secondary text-xs"
                            data-test="rum-heatmap-row-sessions"
                          >
                            {{
                              t(
                                "rum.heatmap.sessionsCount",
                                { count: addCommasToNumber(row.sessions) },
                                row.sessions,
                              )
                            }}
                          </span>
                          <OBadge
                            v-if="row.missing"
                            variant="warning-soft"
                            size="sm"
                            :data-test="`rum-heatmap-not-on-snapshot-${row.selector}`"
                          >
                            {{ t("rum.heatmap.offSnapshot") }}
                          </OBadge>
                          <OBadge
                            v-if="row.frustrated"
                            variant="error-soft"
                            size="sm"
                            :data-test="`rum-heatmap-frustrated-${row.selector}`"
                          >
                            {{
                              t("rum.heatmap.frustratedShort", {
                                count: addCommasToNumber(row.frustrated),
                              })
                            }}
                          </OBadge>
                        </div>
                      </div>
                      <div
                        v-if="row.clicks"
                        class="flex flex-col items-end whitespace-nowrap"
                        data-test="rum-heatmap-row-numbers"
                      >
                        <span
                          class="text-sm font-medium tabular-nums"
                          data-test="rum-heatmap-row-clicks"
                          >{{ addCommasToNumber(row.clicks) }}</span
                        >
                        <span
                          class="text-text-secondary text-xs tabular-nums"
                          data-test="rum-heatmap-row-share"
                          >{{ t("rum.heatmap.sharePct", { pct: row.share }) }}</span
                        >
                      </div>
                    </div>
                  </div>
                </template>
              </OTable>
            </div>
            <div
              class="border-border-default text-text-secondary flex flex-wrap gap-x-1 border-t px-4 py-2 text-xs"
              data-test="rum-heatmap-footer"
            >
              <template v-for="(part, i) in footerParts" :key="part.dataTest">
                <span v-if="i > 0" aria-hidden="true">{{ separator }}</span>
                <span :data-test="part.dataTest">{{ part.text }}</span>
              </template>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSlider from "@/lib/forms/Slider/OSlider.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { addCommasToNumber } from "@/utils/formatters";
import { useFullscreenBox } from "@/composables/useFullscreenBox";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import useStreams from "@/composables/useStreams";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { createMultiViewDecoder } from "@/utils/rum/sessionReplayViews";
import { resolveRelativeLinks } from "@/utils/rum/sessionReplayUrls";
import useAnalyticsSearch, { type SearchSpec } from "@/composables/rum/useAnalyticsSearch";
import useProductAnalytics, { querySignature } from "@/composables/rum/useProductAnalytics";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import {
  drawOutline,
  placeGroup,
  renderHeat,
  sharePercent,
  sortElements,
  toElementGroup,
  type ClickSummary,
  type ElementGroup,
  type HeatSpot,
  type OutlineRect,
} from "@/utils/rum/clickHeatmap";
import {
  deviceClause,
  deviceSplitSql,
  PAGE_LIST_LIMIT,
  pageListSql,
  RANKING_LIMIT,
  rankingSql,
  totalsSql,
  type DeviceBucket,
  type DeviceClass,
} from "@/utils/rum/clickHeatmapQueries";
import { rowScope, type AnalyticsScope } from "@/utils/rum/productAnalyticsQueries";

interface ElementRow {
  selector: string;
  name: string;
  feature: string;
  clicks: number;
  share: number;
  sessions: number;
  frustrated: number;
  rage: number;
  dead: number;
  error: number;
  rank?: number;
  firstUnused?: boolean;
  missing?: boolean;
}

interface PageRow {
  url: string;
  clicks: number;
  sessions: number;
}

interface StatCell {
  key: string;
  label: I18nText;
  value: string;
  valueClass?: string;
  dataTest: string;
}

interface FilterChip {
  key: string;
  label: I18nText;
  active: boolean;
  disabled?: boolean;
  title?: I18nText;
  toggle: () => void;
}

interface MarkerView {
  selector: string;
  rank: number;
  name: string;
  ariaLabel: I18nText;
  borderClass: string;
  badgeClass: string;
  style: Record<string, string>;
  selected: boolean;
  active: boolean;
}

type ViewMode = "heat" | "markers" | "both";

const MARKER_HIGH_SHARE = 0.6;
const MARKER_MEDIUM_SHARE = 0.4;
const RANK_PANELS = ["devices", "totals", "ranking"] as const;
const SNAPSHOT_LOOKBACK_HOURS = 720;
const OUTLINE_SCROLL_MARGIN = 96;
const MAX_UNUSED = 30;
const MIN_PLACED_CLICK_SHARE = 0.9;
const UNUSED_LABEL_MAX = 40;
const INTERACTIVE_SELECTOR =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]';
const SNAPSHOT_WAIT_MS = 8000;
const MAX_REPLAY_SEGMENTS = 80;
const SETTLE_MS = 150;
const FIRST_SEGMENTS = 3;
const PAGE_SEARCH_DEBOUNCE_MS = 300;
const PAGE_SEARCH_PANEL = "page-search";
const FULL_SNAPSHOT = 2;
const META = 4;
const MARKER_TONES = {
  high: { border: "border-status-negative", badge: "bg-status-negative" },
  medium: { border: "border-warning", badge: "bg-warning" },
  low: { border: "border-accent", badge: "bg-accent" },
} as const;
const HOVER_SYNC_MS = 100;
const TIP_WIDTH_REM = 14;
const TIP_HEIGHT_REM = 8;
const MIN_STAGE_SCALE = 0.25;
const MAX_REFIT_TRIES = 20;

const { t } = useI18nTyped();
const store = useStore();
const { getStream } = useStreams(t);
const pa = useProductAnalytics();
const router = useRouter();
const route = useRoute();
const search = useAnalyticsSearch();

const heatOpacity = ref(100);
const autoScroll = ref(true);
const rootRef = ref<HTMLElement | null>(null);
const { fullscreenEl, toggle: toggleFullscreenBox } = useFullscreenBox();
const stageHover = ref("");
const deviceClass = ref<DeviceClass>(pa.heatmap.device as DeviceClass);
const pageUrl = ref("");
const pageRows = ref<PageRow[]>([]);
const pageOpen = ref(false);
const pageQuery = ref("");
const searchedPages = ref<PageRow[]>([]);
const pageSearchState = ref<"idle" | "loading" | "done" | "error">("idle");
const elementQuery = ref("");
const onlyMissing = ref(false);
const onlyFrustrated = ref(false);
const showUnused = ref(false);
const unusedAvailable = ref(false);
const sortOrder = ref<"asc" | "desc">("desc");
const loading = ref(true);
const listLoading = ref(false);
const groups = ref<ElementGroup[]>([]);
const totals = ref({ clicks: 0, sessions: 0, frustrated: 0 });
const deviceClicks = ref<Partial<Record<DeviceBucket, number>>>({});
const deviceSplitLoaded = ref(false);
const deviceSplitFailed = ref(false);
const placedSelectors = ref<Set<string>>(new Set());
const snapshotLoading = ref(false);
const snapshotReady = ref(false);
const placementsReady = ref(false);
const snapshotError = ref<I18nText | null>(null);
const loadError = ref<I18nText | null>(null);
const stageRef = ref<HTMLElement | null>(null);
const scrollerRef = ref<HTMLElement | null>(null);
const fitRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const viewMode = ref<ViewMode>("heat");
const panelOpen = ref(false);
const rowHover = ref("");
const tipSelector = ref("");
const tipSuppressed = ref(false);
const tipPos = ref({ left: 0, top: 0 });
const markerBoxes = ref<Record<string, OutlineRect>>({});
const stageScale = ref(1);
let pageSize = { width: 0, height: 0 };
let resizeObserver: ResizeObserver | null = null;
const selectedSelector = ref("");
const pagesLimited = ref(false);
const rankingLimited = ref(false);
let pageSearchTimer: ReturnType<typeof setTimeout> | undefined;
let pageSearchToken = 0;

type Row = Record<string, unknown>;

interface ReplayPlayer {
  getReplayer?: () => { iframe?: HTMLIFrameElement; wrapper?: HTMLElement; destroy?: () => void };
  $destroy?: () => void;
  goto: (ms: number, play?: boolean) => void;
}

let player: ReplayPlayer | null = null;
let overlay: HTMLCanvasElement | null = null;
let elementRects = new Map<string, OutlineRect>();
let loadToken = 0;
let retryTarget: "scope" | "page" = "scope";
let cycleEnd = Date.now() * 1000;
let cycleRange = { start_time: 0, end_time: 0 };
let refitFrame = 0;
let snapshotKey = "";
let clicksDoneToken = -1;
let headDoneToken = -1;
let drawnToken = -1;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let rowRevealTimer: ReturnType<typeof setTimeout> | undefined;

const deviceLabel = (key: string, device: DeviceBucket) => {
  const n = deviceClicks.value[device];
  if (!deviceSplitLoaded.value) return t(key);
  return t("rum.heatmap.deviceWithCount", { device: t(key), count: addCommasToNumber(n ?? 0) });
};

const deviceOptions = computed(() => [
  { label: t("rum.heatmap.deviceAll"), value: "all", icon: "devices" },
  {
    label: deviceLabel("rum.heatmap.deviceDesktop", "desktop"),
    value: "desktop",
    icon: "computer",
  },
  { label: deviceLabel("rum.heatmap.deviceTablet", "tablet"), value: "tablet", icon: "tablet" },
  { label: deviceLabel("rum.heatmap.devicePhone", "phone"), value: "phone", icon: "smartphone" },
]);

const modeOptions = computed<{ value: ViewMode; label: I18nText; icon: string }[]>(() => [
  { value: "heat", label: t("rum.heatmap.modeHeat"), icon: "local-fire-department" },
  { value: "markers", label: t("rum.heatmap.modeMarkers"), icon: "pin-drop" },
  { value: "both", label: t("rum.heatmap.modeBoth"), icon: "layers" },
]);
const modeHint = computed(() =>
  viewMode.value === "heat"
    ? t("rum.heatmap.hintHeat")
    : viewMode.value === "markers"
      ? t("rum.heatmap.hintMarkers")
      : t("rum.heatmap.hintBoth"),
);
const heatVisible = computed(() => viewMode.value !== "markers");
const markersVisible = computed(
  () => viewMode.value !== "heat" && snapshotReady.value && placementsReady.value,
);

const separator = computed(() => t("rum.heatmap.separator"));
const unknownDeviceClicks = computed(() => deviceClicks.value.unknown ?? 0);
const placedCount = computed(() => placedSelectors.value.size);
const summary = computed<ClickSummary>(() => ({ ...totals.value }));
// Kept across refetches so the strip never unmounts while totals reload.
const strip = ref<ClickSummary | null>(null);
const clicksMax = computed(() => groups.value[0]?.clicks ?? 0);
const unusedRows = ref<ElementRow[]>([]);
const clickedRows = computed<ElementRow[]>(() =>
  groups.value.map((g, i) => ({
    rank: i + 1,
    selector: g.selector,
    name: g.name,
    feature: g.name || g.selector,
    clicks: g.clicks,
    share: sharePercent(g.clicks, summary.value.clicks),
    sessions: g.sessions,
    frustrated: g.frustrated,
    rage: g.rage,
    dead: g.dead,
    error: g.error,
    missing: placementsReady.value && !placedSelectors.value.has(g.selector),
  })),
);
const matchesQuery = (r: ElementRow) =>
  `${r.feature} ${r.selector}`.toLowerCase().includes(elementQuery.value.trim().toLowerCase());
const rowFilterOn = computed(() => onlyMissing.value || onlyFrustrated.value);
const unusedReason = computed(() => {
  if (rowFilterOn.value) return t("rum.heatmap.chipUnusedFiltered");
  if (!unusedAvailable.value && !snapshotLoading.value) return t("rum.heatmap.chipUnusedDisabled");
  return undefined;
});
const visibleRows = computed<ElementRow[]>(() => {
  const clicked = clickedRows.value.filter(
    (r) =>
      matchesQuery(r) &&
      (!onlyMissing.value || r.missing) &&
      (!onlyFrustrated.value || r.frustrated),
  );
  if (sortOrder.value === "asc") clicked.reverse();
  const unused =
    showUnused.value && unusedAvailable.value && !rowFilterOn.value
      ? unusedRows.value.filter(matchesQuery).map((r, i) => ({ ...r, firstUnused: i === 0 }))
      : [];
  return [...clicked, ...unused];
});
const columns = computed<OTableColumnDef<ElementRow>[]>(() => [
  {
    id: "feature",
    header: t("rum.heatmap.colFeature"),
    size: 120,
    meta: { autoWidth: true, fillRemaining: true },
  },
]);
const sortOptions = computed(() => [
  { label: t("rum.heatmap.sortMost"), value: "desc" },
  { label: t("rum.heatmap.sortFewest"), value: "asc" },
]);
const chips = computed<FilterChip[]>(() => [
  {
    key: "missing",
    label: t("rum.heatmap.chipNotOnSnapshot"),
    active: onlyMissing.value,
    toggle: () => (onlyMissing.value = !onlyMissing.value),
  },
  {
    key: "frustrated",
    label: t("rum.heatmap.chipFrustrated"),
    active: onlyFrustrated.value,
    toggle: () => (onlyFrustrated.value = !onlyFrustrated.value),
  },
  {
    key: "unused",
    label: t("rum.heatmap.unusedHeading"),
    active: showUnused.value && unusedAvailable.value && !rowFilterOn.value,
    disabled: !unusedAvailable.value || rowFilterOn.value,
    title: unusedReason.value,
    toggle: () => (showUnused.value = !showUnused.value),
  },
]);
const searching = computed(() => pageQuery.value.trim() !== "");
const visiblePages = computed(() =>
  searching.value ? (pageSearchState.value === "done" ? searchedPages.value : []) : pageRows.value,
);
const pickerLimited = computed(() =>
  searching.value
    ? pageSearchState.value === "done" && searchedPages.value.length >= PAGE_LIST_LIMIT
    : pagesLimited.value,
);
const pageCountText = computed(() =>
  pagesLimited.value
    ? t("rum.heatmap.pageCountLimited", { count: PAGE_LIST_LIMIT }, PAGE_LIST_LIMIT)
    : t("rum.heatmap.pageCount", { count: pageRows.value.length }, pageRows.value.length),
);
const limitedText = computed(() => {
  const pages = pagesLimited.value ? PAGE_LIST_LIMIT : 0;
  const elements = rankingLimited.value ? RANKING_LIMIT : 0;
  if (pages && elements) return t("rum.heatmap.limitedBoth", { pages, elements });
  if (pages) return t("rum.heatmap.limitedPages", { count: pages });
  if (elements) return t("rum.heatmap.limitedElements", { count: elements });
  return "";
});
const footerParts = computed(() => {
  const parts: { dataTest: string; text: I18nText }[] = [];
  if (limitedText.value) parts.push({ dataTest: "rum-heatmap-limited", text: limitedText.value });
  if (placementsReady.value) {
    const text = t("rum.heatmap.drawn", { placed: placedCount.value, total: groups.value.length });
    parts.push({ dataTest: "rum-heatmap-placed", text });
  }
  if (unknownDeviceClicks.value) {
    const count = addCommasToNumber(unknownDeviceClicks.value);
    const text = t("rum.heatmap.unknownDevice", { count }, unknownDeviceClicks.value);
    parts.push({ dataTest: "rum-heatmap-unknown-device", text });
  }
  return parts;
});
const statItems = computed<StatCell[]>(() => {
  const loaded = strip.value;
  const { clicks, sessions, frustrated } = loaded ?? summary.value;
  const show = (n: number) => (loaded ? addCommasToNumber(n) : t("rum.heatmap.statPlaceholder"));
  return [
    {
      key: "clicks",
      label: t("rum.heatmap.statClicks"),
      value: show(clicks),
      dataTest: "rum-heatmap-stat-clicks",
    },
    {
      key: "sessions",
      label: t("rum.heatmap.statSessions"),
      value: show(sessions),
      dataTest: "rum-heatmap-stat-sessions",
    },
    {
      key: "frustrated",
      label: t("rum.heatmap.statFrustrated"),
      value: show(frustrated),
      valueClass: loaded && frustrated ? "text-status-negative" : undefined,
      dataTest: "rum-heatmap-stat-frustrated",
    },
  ];
});

const markerTone = (clicks: number) => {
  const share = clicksMax.value > 0 ? clicks / clicksMax.value : 0;
  if (share >= MARKER_HIGH_SHARE) return MARKER_TONES.high;
  return share >= MARKER_MEDIUM_SHARE ? MARKER_TONES.medium : MARKER_TONES.low;
};

const markers = computed<MarkerView[]>(() =>
  groups.value.flatMap((g, i) => {
    const box = markerBoxes.value[g.selector];
    if (!box || !placedSelectors.value.has(g.selector)) return [];
    const scale = stageScale.value;
    const tone = markerTone(g.clicks);
    const name = g.name || g.selector;
    const selected = g.selector === selectedSelector.value;
    const clicks = addCommasToNumber(g.clicks);
    return [
      {
        selector: g.selector,
        rank: i + 1,
        name,
        ariaLabel: t("rum.heatmap.markerLabel", { rank: i + 1, name, count: clicks }, g.clicks),
        borderClass: tone.border,
        badgeClass: tone.badge,
        // Page coordinates scaled by the stage fit, which only the browser knows at runtime.
        style: {
          left: `${box.x * scale}px`,
          top: `${box.y * scale}px`,
          width: `${box.width * scale}px`,
          height: `${box.height * scale}px`,
        },
        selected,
        active:
          selected ||
          rowHover.value === g.selector ||
          tipSelector.value === g.selector ||
          stageHover.value === g.selector,
      },
    ];
  }),
);

const tsField = () => store.state.zoConfig.timestamp_column || "_timestamp";

const scope = (): AnalyticsScope => pa.scope.value;
const appId = computed(() => pa.state.app);

function windowMicros(hours: number) {
  return { start_time: cycleEnd - hours * 3_600_000_000, end_time: cycleEnd };
}

function startCycle() {
  cycleEnd = Date.now() * 1000;
  const { startUs, endUs } = pa.resolveRange();
  cycleRange = { start_time: startUs, end_time: endUs };
}

class ForbiddenError extends Error {}

// A null result means a newer request replaced this one, so the caller must drop it.
async function searchRows<T>(
  id: string,
  sql: string,
  limit: number,
  win: { start_time: number; end_time: number },
  stream?: string,
): Promise<T[] | null> {
  const spec: SearchSpec = {
    sql,
    startUs: win.start_time,
    endUs: win.end_time,
    limit,
    sampled: 1,
    stream,
  };
  const res = await search.run<T>(id, spec, `${id}:${sql}`);
  if (res.status === "ok") return res.rows;
  if (res.status === "forbidden") throw new ForbiddenError();
  if (res.status === "error") throw new Error(res.error?.message || res.status);
  return null;
}

// Replay lookups go through the shared search so superseding or leaving the page cancels them.
async function replayRows(
  id: string,
  sql: string,
  limit: number,
  stream = "_rumdata",
  win = windowMicros(SNAPSHOT_LOOKBACK_HOURS),
): Promise<Row[]> {
  const rows = await searchRows<Row>(id, sql, limit, win, stream);
  if (!rows) throw new Error("replay lookup superseded");
  return rows;
}

function failLoad(label: string, error: unknown, retry: "scope" | "page" = "scope") {
  retryTarget = retry;
  console.error(`Click heatmap: ${label} failed`, error);
  strip.value = null;
  loadError.value = t(
    error instanceof ForbiddenError ? "rum.heatmap.forbidden" : "rum.heatmap.loadFailed",
  );
}

function onRetry() {
  return retryTarget === "page" ? loadPage() : startLoad();
}

// The shell owns app, range and bot rules, so the page waits until they are loaded.
function startLoad() {
  if (pa.scopeStatus.value !== "ok" || !pa.rulesReady.value) return;
  startCycle();
  deviceClass.value = pa.heatmap.device as DeviceClass;
  clearElementFilters();
  loadError.value = null;
  const known = pa.heatmap.pageUrl;
  if (!known) return loadPages(false);
  // A page named by the link needs no list to start, so its snapshot and clicks load alongside the list.
  pageUrl.value = known;
  void loadPage(true, false);
  return loadPages(true);
}

function syncHeatmapUrl() {
  pa.heatmap.pageUrl = pageUrl.value;
  pa.heatmap.device = deviceClass.value;
  const name = String(route?.name ?? "");
  if (name !== PA_ROUTES.heatmaps || !router) return;
  if (querySignature(pa.toQuery(name)) === querySignature(route.query)) return;
  void pa.syncUrl(router);
}

function clearElementFilters() {
  elementQuery.value = "";
  onlyMissing.value = false;
  onlyFrustrated.value = false;
}

async function loadPages(preStarted: boolean) {
  const token = preStarted ? loadToken : ++loadToken;
  loading.value = true;
  listLoading.value = true;
  try {
    const rows = appId.value
      ? await searchRows<{ view_url: string; clicks?: unknown; sessions?: unknown }>(
          "pages",
          pageListSql(scope()),
          PAGE_LIST_LIMIT,
          cycleRange,
        )
      : [];
    if (token !== loadToken || !rows) return;
    listLoading.value = false;
    pagesLimited.value = rows.length >= PAGE_LIST_LIMIT;
    pageRows.value = rows.map((h) => ({
      url: h.view_url,
      clicks: Number(h.clicks) || 0,
      sessions: Number(h.sessions) || 0,
    }));
    const wanted = pa.heatmap.pageUrl || pageUrl.value;
    if (pa.heatmap.pageUrl && !pageRows.value.some((p) => p.url === wanted)) {
      pageRows.value.unshift({ url: wanted, clicks: 0, sessions: 0 });
    }
    pageUrl.value = pageRows.value.some((p) => p.url === wanted)
      ? wanted
      : (pageRows.value[0]?.url ?? "");
    syncHeatmapUrl();
  } catch (error) {
    if (token !== loadToken) return;
    listLoading.value = false;
    resetPage();
    failLoad("page list", error);
    pageRows.value = [];
    loading.value = false;
    return;
  }
  if (preStarted) return;
  loading.value = false;
  await loadPage(true, false);
}

function resetPage(keepSnapshot = false) {
  if (keepSnapshot) placementsReady.value = false;
  else destroyPlayer();
  groups.value = [];
  totals.value = { clicks: 0, sessions: 0, frustrated: 0 };
  placedSelectors.value = new Set();
  snapshotError.value = null;
  loadError.value = null;
  rankingLimited.value = false;
  pagesLimited.value = false;
  selectedSelector.value = "";
  unusedRows.value = [];
  unusedAvailable.value = false;
}

async function loadPage(refreshSplit = true, newCycle = true) {
  if (newCycle) startCycle();
  const token = ++loadToken;
  if (refreshSplit) {
    deviceClicks.value = {};
    deviceSplitLoaded.value = false;
    deviceSplitFailed.value = false;
  }
  const pageListFull = pagesLimited.value;
  const key = `${appId.value}|${pageUrl.value}|${deviceClass.value}`;
  // Same page and device means the screenshot is still right, so only the clicks are refetched.
  const reuse = !!pageUrl.value && key === snapshotKey && !!player && snapshotReady.value;
  resetPage(reuse);
  pagesLimited.value = pageListFull;
  if (!pageUrl.value) {
    strip.value = null;
    for (const id of RANK_PANELS) search.hold(id, "idle");
    return;
  }
  if (reuse) headDoneToken = token;
  const [, clicks] = await Promise.allSettled([
    reuse ? Promise.resolve() : loadSnapshot(token, key),
    loadClicks(token, refreshSplit),
  ]);
  if (token !== loadToken) return;
  if (clicks.status === "rejected") failLoad("clicks", clicks.reason, "page");
  tryDraw(token);
}

// Heat is drawn by whichever of the clicks and the first frame lands last.
function tryDraw(token: number) {
  if (token !== loadToken || drawnToken === token) return;
  if (clicksDoneToken !== token || headDoneToken !== token) return;
  if (!snapshotReady.value || !frameDoc()) return;
  drawnToken = token;
  try {
    drawHeat();
  } catch (error) {
    console.error("Click heatmap: drawing the heat failed", error);
  }
}

async function loadClicks(token: number, withSplit: boolean) {
  loading.value = true;
  try {
    const win = cycleRange;
    const sc = scope();
    const url = pageUrl.value;
    const rankSql = rankingSql(sc, url, deviceClass.value);
    const [splitRes, totRes, rankRes] = await Promise.allSettled([
      withSplit
        ? searchRows<Record<string, unknown>>("devices", deviceSplitSql(sc, url), 8, win)
        : [],
      searchRows<Record<string, unknown>>("totals", totalsSql(sc, url, deviceClass.value), 1, win),
      rankSql ? searchRows<Record<string, unknown>>("ranking", rankSql, RANKING_LIMIT, win) : [],
    ]);
    if (token !== loadToken) return;
    if (totRes.status === "rejected") throw totRes.reason;
    if (rankRes.status === "rejected") throw rankRes.reason;
    const tot = totRes.value;
    const ranked = rankRes.value;
    if (!tot || !ranked) return;
    if (withSplit) {
      if (splitRes.status === "rejected") {
        console.error("Click heatmap: device split failed", splitRes.reason);
        deviceSplitFailed.value = true;
      } else if (splitRes.value) {
        const split = splitRes.value;
        deviceClicks.value = Object.fromEntries(split.map((r) => [r.cls, Number(r.clicks) || 0]));
        deviceSplitLoaded.value = true;
      }
    }
    rankingLimited.value = ranked.length >= RANKING_LIMIT;
    const row = tot[0] ?? {};
    totals.value = {
      clicks: Number(row.clicks) || 0,
      sessions: Number(row.sessions) || 0,
      frustrated: Number(row.frustrated) || 0,
    };
    groups.value = sortElements(
      ranked.map(toElementGroup).filter((g): g is ElementGroup => g !== null),
    );
    strip.value = { ...totals.value };
    clicksDoneToken = token;
    tryDraw(token);
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

const isSnapshotFlag = (v: unknown) => v === true || v === "true" || Number(v) === 1;

interface SnapshotSource {
  events: any[];
  viewId: string;
}

async function pickReplayView(token: number): Promise<string | null> {
  const stream = await getStream("_rumdata", "logs", true);
  if (token !== loadToken) return null;
  const hasActions = (stream?.schema ?? []).some((f: any) => f?.name === "view_action_count");
  const viewsSql = `SELECT view_id, max(${tsField()}) AS t${hasActions ? ", max(view_action_count) AS ac" : ""} FROM "_rumdata" WHERE ${rowScope(scope())} AND type = 'view' AND view_url = ${sqlLiteral(pageUrl.value)}${deviceClause(scope(), deviceClass.value)} GROUP BY view_id ORDER BY ${hasActions ? "ac DESC, " : ""}t DESC LIMIT 30`;
  // The active range is far cheaper to scan, so the wide lookback is only for pages with no recent view.
  let views = await replayRows("replay-views", viewsSql, 30, "_rumdata", cycleRange);
  if (!views.length && token === loadToken) {
    views = await replayRows("replay-views", viewsSql, 30);
  }
  if (!views.length || token !== loadToken) return null;
  const replayStream = await getStream("_sessionreplay", "logs", true);
  if (token !== loadToken) return null;
  // Older and mobile streams have no has_full_snapshot column, so any view may hold a snapshot.
  if (!(replayStream?.schema ?? []).some((f: any) => f?.name === "has_full_snapshot")) {
    return String(views[0].view_id);
  }
  const ids = views.map((v) => sqlLiteral(String(v.view_id))).join(",");
  const rows = await replayRows(
    "replay-flags",
    `SELECT view_id, bool_or(has_full_snapshot) AS has_full_snapshot FROM "_sessionreplay" WHERE view_id IN (${ids}) GROUP BY view_id`,
    views.length,
    "_sessionreplay",
  );
  if (token !== loadToken) return null;
  const withSnapshot = new Set(
    rows.filter((r) => isSnapshotFlag(r.has_full_snapshot)).map((r) => String(r.view_id)),
  );
  const best = views.find((v) => withSnapshot.has(String(v.view_id)));
  return best ? String(best.view_id) : null;
}

function decodeReplayEvents(bodies: any[]): any[] {
  const { events } = createMultiViewDecoder().push(bodies, Infinity);
  let href: unknown;
  return events.map((e: any) => {
    if (e.type === 8) return { ...e, type: 5, data: { payload: { ...e.data }, tag: "viewport" } };
    if (e.type === META) href = e.data?.href;
    if (e.type === FULL_SNAPSHOT && e.data?.node) resolveRelativeLinks(e.data.node, href);
    return e;
  });
}

const parseSegments = (rows: Row[]) =>
  rows.flatMap((r) => {
    try {
      return [JSON.parse(String(r.segment))];
    } catch {
      return [];
    }
  });

const segmentsSql = (viewId: string, limit: number) =>
  `SELECT start, segment FROM "_sessionreplay" WHERE view_id = ${sqlLiteral(viewId)} ORDER BY start ASC LIMIT ${limit}`;

const hasFirstFrame = (events: any[]) =>
  events.some((e) => e.type === META) && events.some((e) => e.type === FULL_SNAPSHOT);

// The earliest segments hold the meta and full snapshot, so they alone are enough to show the first frame.
async function loadSnapshotHead(token: number): Promise<SnapshotSource | null> {
  const viewId = await pickReplayView(token);
  if (!viewId || token !== loadToken) return null;
  let rows = await replayRows(
    "replay-segments",
    segmentsSql(viewId, FIRST_SEGMENTS),
    FIRST_SEGMENTS,
    "_sessionreplay",
  );
  let events = decodeReplayEvents(parseSegments(rows));
  if (!hasFirstFrame(events) && rows.length >= FIRST_SEGMENTS) {
    rows = await replayRows(
      "replay-segments",
      segmentsSql(viewId, MAX_REPLAY_SEGMENTS),
      MAX_REPLAY_SEGMENTS,
      "_sessionreplay",
    );
    events = decodeReplayEvents(parseSegments(rows));
  }
  if (token !== loadToken || !events.length) return null;
  return { viewId, events };
}

async function loadSnapshot(token: number, key: string) {
  snapshotLoading.value = true;
  snapshotReady.value = false;
  let mounted: SnapshotSource | null = null;
  try {
    const head = await loadSnapshotHead(token);
    if (token !== loadToken) return;
    const meta = head?.events.find((e) => e.type === META);
    if (!head || !hasFirstFrame(head.events) || !meta) {
      snapshotError.value = t("rum.heatmap.noReplay");
      return;
    }
    snapshotReady.value = true;
    await nextTick();
    if (token !== loadToken || !stageRef.value) return;
    await mountPlayer(head, meta.data.width, meta.data.height, token);
    if (token !== loadToken) return;
    snapshotKey = key;
    headDoneToken = token;
    mounted = head;
  } catch (error) {
    if (token !== loadToken) return;
    console.error("Click heatmap: snapshot failed", error);
    snapshotReady.value = false;
    snapshotError.value = t("rum.heatmap.snapshotFailed");
  } finally {
    if (token === loadToken) snapshotLoading.value = false;
  }
  if (mounted && token === loadToken) {
    tryDraw(token);
    void refineSnapshot(token, mounted);
  }
}

// The first snapshot is taken at page load, before an app has drawn its content, so play on to when people clicked.
async function refineSnapshot(token: number, head: SnapshotSource) {
  try {
    const [rows, [lastClick]] = await Promise.all([
      replayRows(
        "replay-rest",
        segmentsSql(head.viewId, MAX_REPLAY_SEGMENTS),
        MAX_REPLAY_SEGMENTS,
        "_sessionreplay",
      ),
      replayRows(
        "replay-click",
        `SELECT max(date) AS d FROM "_rumdata" WHERE ${rowScope(scope())} AND type = 'action' AND view_id = ${sqlLiteral(head.viewId)}`,
        1,
      ),
    ]);
    if (token !== loadToken) return;
    const events = decodeReplayEvents(parseSegments(rows));
    if (!events.length) return;
    const first = Number(events[0].timestamp);
    const last = Number(events[events.length - 1].timestamp);
    const clickAt = Number(lastClick?.d);
    const target = Number.isFinite(clickAt) && clickAt > first ? clickAt : last;
    const seekMs = Math.min(Math.max(target - first, 0), Math.max(last - first, 0));
    const extra = events.slice(head.events.length);
    if (!extra.length && seekMs <= 0) return;
    const replayer: any = player?.getReplayer?.();
    if (!replayer) return;
    for (const event of extra) replayer.addEvent?.(event);
    await new Promise((r) => setTimeout(r, 0));
    if (token !== loadToken) return;
    player?.goto(seekMs, false);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    if (token === loadToken && snapshotReady.value && placementsReady.value) drawHeat();
  } catch (error) {
    // The first frame stays; a failed refinement is not worth an error banner.
    if (token === loadToken) console.warn("Click heatmap: snapshot refinement skipped", error);
  }
}

async function mountPlayer(source: SnapshotSource, width: number, height: number, token: number) {
  const module: any = await import("@openobserve/rrweb-player");
  await import("@openobserve/rrweb-player/dist/style.css");
  if (token !== loadToken || !stageRef.value) return;
  const Player = module.default;
  player = markRaw(
    new Player({
      target: stageRef.value as HTMLElement,
      props: {
        events: source.events,
        autoPlay: false,
        showController: false,
        mouseTail: false,
        UNSAFE_replayCanvas: false,
        mutateChildNodes: true,
        width,
        height,
      },
    }),
  );
  await waitForSnapshotDom(token);
  if (token !== loadToken) return;
  player?.goto(0, false);
  await nextFrames();
}

// The replayer rebuilds the first snapshot on a timer after construction, so the iframe is empty until then.
async function waitForSnapshotDom(token: number) {
  const deadline = performance.now() + SNAPSHOT_WAIT_MS;
  while (token === loadToken && performance.now() < deadline) {
    const body = frameDoc()?.doc.body;
    if (body && body.childElementCount > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (token === loadToken) throw new Error("snapshot did not render");
}

// Two frames let the rebuilt page lay out before anything is measured.
const nextFrames = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

function destroyPlayer() {
  snapshotKey = "";
  snapshotReady.value = false;
  placementsReady.value = false;
  overlay = null;
  try {
    player?.getReplayer?.()?.destroy?.();
    player?.$destroy?.();
  } catch {
    // The player is already gone; nothing left to release.
  }
  player = null;
  if (stageRef.value) stageRef.value.replaceChildren();
}

function frameDoc(): { doc: Document; wrapper: HTMLElement; iframe: HTMLIFrameElement } | null {
  const replayer = player?.getReplayer?.();
  const iframe: HTMLIFrameElement | undefined = replayer?.iframe;
  const wrapper: HTMLElement | undefined = replayer?.wrapper;
  const doc = iframe?.contentDocument;
  return doc && wrapper && iframe ? { doc, wrapper, iframe } : null;
}

function growToFullPage(frame: { doc: Document; wrapper: HTMLElement; iframe: HTMLIFrameElement }) {
  const full = Math.max(frame.doc.documentElement.scrollHeight, Number(frame.iframe.height) || 0);
  frame.iframe.setAttribute("height", String(full));
  const boxes = [
    frame.wrapper,
    stageRef.value?.querySelector<HTMLElement>(".rr-player__frame"),
    stageRef.value?.querySelector<HTMLElement>(".rr-player"),
  ];
  for (const box of boxes) {
    // Must match the iframe's px height attribute exactly.
    box?.style.setProperty("height", `${full}px`);
  }
  pageSize = {
    width: Number(frame.iframe.width) || frame.doc.documentElement.scrollWidth,
    height: full,
  };
  fitStage(true);
  return full;
}

// Shrinks a wide page to the pane so the whole width is visible without sideways scrolling.
// Returns false when the pane has no usable width yet (mid fullscreen or tab switch), so the caller retries.
function fitStage(accept = false): boolean {
  const scroller = scrollerRef.value;
  const fit = fitRef.value;
  const stage = stageRef.value;
  if (!scroller || !fit || !stage || !pageSize.width) return true;
  const gutter = 2 * parseFloat(getComputedStyle(document.documentElement).fontSize);
  const available = scroller.clientWidth - gutter;
  if (!Number.isFinite(available) || available <= 0) return false;
  // A pane far narrower than the page is mid-transition, so wait for it unless the caller must apply a result.
  if (!accept && available / pageSize.width < MIN_STAGE_SCALE) return false;
  stageScale.value = Math.min(1, Math.max(MIN_STAGE_SCALE, available / pageSize.width));
  stage.style.setProperty("transform", `scale(${stageScale.value})`);
  fit.style.setProperty("width", `${pageSize.width * stageScale.value}px`);
  fit.style.setProperty("height", `${pageSize.height * stageScale.value}px`);
  return true;
}

// Waits two frames so the new layout is settled before re-measuring, then redraws at the new scale.
function refit(tries = 0, resetScroll = false) {
  cancelAnimationFrame(refitFrame);
  refitFrame = requestAnimationFrame(() => {
    refitFrame = requestAnimationFrame(() => {
      if (!fitStage(tries >= MAX_REFIT_TRIES) && tries < MAX_REFIT_TRIES) {
        return refit(tries + 1, resetScroll);
      }
      if (resetScroll && scrollerRef.value) scrollerRef.value.scrollTop = 0;
      if (snapshotReady.value && frameDoc()) drawHeat();
    });
  });
}

// A hand-rolled canvas because it paints over a rebuilt replay DOM, which no chart component can host.
function ensureOverlay(frame: { wrapper: HTMLElement }, width: number, height: number) {
  if (!overlay) {
    overlay = document.createElement("canvas");
    overlay.dataset.test = "rum-heatmap-canvas";
    overlay.setAttribute("aria-hidden", "true");
    overlay.className = "pointer-events-none absolute left-0 top-0 z-10";
    frame.wrapper.appendChild(overlay);
  }
  overlay.classList.toggle("hidden", !heatVisible.value);
  overlay.style.setProperty("opacity", String(heatOpacity.value / 100));
  overlay.width = width;
  overlay.height = height;
  return overlay;
}

// Hidden controls (collapsed menus) still match a selector but have no place on the page.
function isVisible(el: Element): boolean {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !!style && style.display !== "none" && style.visibility !== "hidden";
}

function drawHeat() {
  const frame = frameDoc();
  if (!frame) return;
  const full = growToFullPage(frame);
  const canvas = ensureOverlay(
    frame,
    Number(frame.iframe.width) || frame.doc.documentElement.scrollWidth,
    full,
  );
  const spots: HeatSpot[] = [];
  const placed = new Set<string>();
  const rects = new Map<string, OutlineRect>();
  const clickedEls: Element[] = [];
  const win = frame.doc.defaultView;
  for (const g of groups.value) {
    let el: Element | null = null;
    try {
      el = frame.doc.querySelector(g.selector);
    } catch {
      el = null;
    }
    if (!el || !isVisible(el)) continue;
    const box = el.getBoundingClientRect();
    const spot = placeGroup(g, clicksMax.value, box, win?.scrollX ?? 0, win?.scrollY ?? 0);
    if (!spot) continue;
    clickedEls.push(el);
    spots.push(spot);
    rects.set(g.selector, {
      x: box.left + (win?.scrollX ?? 0),
      y: box.top + (win?.scrollY ?? 0),
      width: box.width,
      height: box.height,
    });
    placed.add(g.selector);
  }
  placedSelectors.value = placed;
  placementsReady.value = true;
  unusedAvailable.value = mostlyPlaced(placed);
  unusedRows.value = unusedAvailable.value ? findUnusedControls(frame.doc, clickedEls, rects) : [];
  markerBoxes.value = Object.fromEntries(rects);
  elementRects = rects;
  renderHeat(canvas, spots);
  const selected = elementRects.get(selectedSelector.value);
  if (selected) drawOutline(canvas, selected);
}

// Unplaced clicks may be on controls this snapshot lacks, so "never clicked" is only trustworthy when most clicks landed.
function mostlyPlaced(placed: Set<string>): boolean {
  const placedClicks = groups.value
    .filter((g) => placed.has(g.selector))
    .reduce((sum, g) => sum + g.clicks, 0);
  return totals.value.clicks > 0 && placedClicks / totals.value.clicks >= MIN_PLACED_CLICK_SHARE;
}

function findUnusedControls(
  doc: Document,
  clicked: Element[],
  rects: Map<string, OutlineRect>,
): ElementRow[] {
  if (!clicked.length) return [];
  const win = doc.defaultView;
  const rows: ElementRow[] = [];
  for (const el of doc.querySelectorAll(INTERACTIVE_SELECTOR)) {
    if (rows.length >= MAX_UNUSED) break;
    if (clicked.some((c) => c === el || el.contains(c))) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const key = `unused-${rows.length}`;
    const tag = el.tagName.toLowerCase();
    const label =
      el.getAttribute("aria-label") ||
      el.textContent?.trim().slice(0, UNUSED_LABEL_MAX) ||
      el.getAttribute("name") ||
      tag;
    rects.set(key, {
      x: box.left + (win?.scrollX ?? 0),
      y: box.top + (win?.scrollY ?? 0),
      width: box.width,
      height: box.height,
    });
    rows.push({
      selector: key,
      name: "",
      feature: label,
      clicks: 0,
      share: 0,
      sessions: 0,
      frustrated: 0,
      rage: 0,
      dead: 0,
      error: 0,
    });
  }
  return rows;
}

function onDeviceChange(value: unknown) {
  if (typeof value !== "string" || !value || value === deviceClass.value) return;
  deviceClass.value = value as DeviceClass;
  syncHeatmapUrl();
  clearElementFilters();
  loadPage(false);
}

function onPagePick(url: string) {
  pageOpen.value = false;
  if (url === pageUrl.value) return;
  pageUrl.value = url;
  syncHeatmapUrl();
  clearElementFilters();
  loadPage();
}

function stopPageSearch() {
  clearTimeout(pageSearchTimer);
  pageSearchToken++;
  search.hold(PAGE_SEARCH_PANEL, "idle");
}

async function runPageSearch(term: string, token: number) {
  try {
    const rows = await searchRows<{ view_url: string; clicks?: unknown; sessions?: unknown }>(
      PAGE_SEARCH_PANEL,
      pageListSql(scope(), term),
      PAGE_LIST_LIMIT,
      cycleRange,
    );
    if (token !== pageSearchToken || !rows) return;
    searchedPages.value = rows.map((r) => ({
      url: r.view_url,
      clicks: Number(r.clicks) || 0,
      sessions: Number(r.sessions) || 0,
    }));
    pageSearchState.value = "done";
  } catch (error) {
    if (token !== pageSearchToken) return;
    console.error("Click heatmap: page search failed", error);
    pageSearchState.value = "error";
  }
}

watch(pageQuery, (value) => {
  stopPageSearch();
  const term = value.trim();
  if (!term) {
    pageSearchState.value = "idle";
    searchedPages.value = [];
    return;
  }
  pageSearchState.value = "loading";
  const token = pageSearchToken;
  pageSearchTimer = setTimeout(() => runPageSearch(term, token), PAGE_SEARCH_DEBOUNCE_MS);
});

watch(pageOpen, (open) => {
  if (!open) pageQuery.value = "";
});

const tipTarget = computed(() =>
  tipSuppressed.value ? "" : tipSelector.value || stageHover.value,
);

// One card for every mode, built from the same strings as the marker label.
const tipView = computed(() => {
  const sel = tipTarget.value;
  const i = groups.value.findIndex((g) => g.selector === sel);
  if (i < 0 || !markerBoxes.value[sel] || !placedSelectors.value.has(sel)) return null;
  const g = groups.value[i];
  const clicks = addCommasToNumber(g.clicks);
  const frustrated = addCommasToNumber(g.frustrated);
  return {
    selector: g.selector,
    name: g.name || g.selector,
    hasName: !!g.name,
    rank: i + 1,
    clicksText: t("rum.heatmap.markerClicks", { count: clicks }, g.clicks),
    shareText: t("rum.heatmap.sharePct", { pct: sharePercent(g.clicks, summary.value.clicks) }),
    sessionsText: t(
      "rum.heatmap.sessionsCount",
      { count: addCommasToNumber(g.sessions) },
      g.sessions,
    ),
    frustratedText: g.frustrated ? t("rum.heatmap.frustratedShort", { count: frustrated }) : "",
    splitText: g.frustrated
      ? t("rum.heatmap.frustrationSplit", {
          rage: addCommasToNumber(g.rage),
          dead: addCommasToNumber(g.dead),
          error: addCommasToNumber(g.error),
        })
      : "",
    style: {
      left: `${tipPos.value.left}px`,
      top: `${tipPos.value.top}px`,
    },
  };
});

function showTip(selector: string) {
  tipSelector.value = selector;
  tipSuppressed.value = false;
  placeTip();
}

// Opens below the element, flipping above or left when the card would leave the visible pane.
function placeTip() {
  const sel = tipSelector.value || stageHover.value;
  const box = markerBoxes.value[sel];
  const scroller = scrollerRef.value;
  const wrapper = fitRef.value?.parentElement;
  if (!box || !scroller || !wrapper) return;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const width = TIP_WIDTH_REM * rem;
  const height = TIP_HEIGHT_REM * rem;
  const gap = 0.5 * rem;
  const scale = stageScale.value;
  const area = wrapper.getBoundingClientRect();
  const pane = scroller.getBoundingClientRect();
  const visTop = Math.max(pane.top, 0) - area.top;
  const visBottom = Math.min(pane.bottom, window.innerHeight || pane.bottom) - area.top;
  const maxLeft = (fitRef.value?.offsetWidth || wrapper.offsetWidth || Infinity) - width;
  const below = (box.y + box.height) * scale + gap;
  const top = below + height > visBottom ? box.y * scale - gap - height : below;
  let left = box.x * scale;
  if (left > maxLeft) left = (box.x + box.width) * scale - width;
  tipPos.value = {
    left: Math.max(0, Math.min(left, Math.max(0, maxLeft))),
    top: Math.max(visTop, top),
  };
}

watch([tipSelector, stageHover], () => {
  tipSuppressed.value = false;
  if (tipSelector.value || stageHover.value) placeTip();
});
watch(viewMode, () => {
  tipSelector.value = "";
  stageHover.value = "";
});

const listHighlight = computed(() => tipSelector.value || stageHover.value);
const isRowLit = (row: ElementRow) =>
  row.selector === selectedSelector.value ||
  row.selector === listHighlight.value ||
  row.selector === rowHover.value;
const rowClass = (row: ElementRow) => (isRowLit(row) ? "bg-surface-tint-accent" : "");
const rowRailTone = (row: ElementRow) => (isRowLit(row) ? ("primary" as const) : null);
const isFullscreen = computed(() => !!rootRef.value && fullscreenEl.value === rootRef.value);
const fullscreenSupported =
  typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
const fullscreenLabel = computed(() =>
  isFullscreen.value ? t("rum.heatmap.exitFullscreen") : t("rum.heatmap.fullscreen"),
);
const panelLabel = computed(() =>
  panelOpen.value ? t("rum.heatmap.hideElements") : t("rum.heatmap.showElements"),
);
const toggleFullscreenMode = () => toggleFullscreenBox(rootRef.value);
const formatOpacity = (v: number) => t("rum.heatmap.opacityValue", { pct: v });
const hitLayerVisible = computed(
  () => viewMode.value !== "markers" && snapshotReady.value && placementsReady.value,
);
const hoverBox = computed(() => {
  const box = markerBoxes.value[rowHover.value || stageHover.value];
  if (!box || viewMode.value !== "heat") return null;
  const scale = stageScale.value;
  // Page coordinates scaled by the stage fit, which only the browser knows at runtime.
  return {
    left: `${box.x * scale}px`,
    top: `${box.y * scale}px`,
    width: `${box.width * scale}px`,
    height: `${box.height * scale}px`,
  };
});

function rowTitle(row: ElementRow): string {
  if (!row.clicks) return "";
  const lines: string[] = [];
  if (row.name) lines.push(row.selector);
  lines.push(
    t("rum.heatmap.sessionsCount", { count: addCommasToNumber(row.sessions) }, row.sessions),
  );
  if (row.frustrated) {
    lines.push(
      t("rum.heatmap.frustrationSplit", {
        rage: addCommasToNumber(row.rage),
        dead: addCommasToNumber(row.dead),
        error: addCommasToNumber(row.error),
      }),
    );
  }
  return lines.join("\n");
}

function onModeChange(value: unknown) {
  if (value !== "heat" && value !== "markers" && value !== "both") return;
  viewMode.value = value;
}

watch(viewMode, () => overlay?.classList.toggle("hidden", !heatVisible.value));
watch(heatOpacity, (v) => overlay?.style.setProperty("opacity", String(v / 100)));

// Smallest box wins so a button inside a card beats the card.
function elementAt(x: number, y: number): string {
  let best = "";
  let bestArea = Infinity;
  for (const g of groups.value) {
    const r = elementRects.get(g.selector);
    if (!r || x < r.x || y < r.y || x > r.x + r.width || y > r.y + r.height) continue;
    if (r.width * r.height < bestArea) {
      best = g.selector;
      bestArea = r.width * r.height;
    }
  }
  return best;
}

function onStageMove(e: MouseEvent) {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const scale = stageScale.value || 1;
  stageHover.value = elementAt((e.clientX - box.left) / scale, (e.clientY - box.top) / scale);
  if (tipSuppressed.value && stageHover.value) {
    tipSuppressed.value = false;
    placeTip();
  }
}

function onStageClick() {
  if (stageHover.value) selectSelector(stageHover.value);
}

function revealOnStage(selector: string) {
  const rect = elementRects.get(selector);
  const scroller = scrollerRef.value;
  const stage = stageRef.value;
  if (!rect || !scroller || !stage) return;
  const scale = stageScale.value;
  const stageTop =
    stage.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const top = stageTop + rect.y * scale;
  const bottom = top + rect.height * scale;
  if (top >= scroller.scrollTop && bottom <= scroller.scrollTop + scroller.clientHeight) return;
  scroller.scrollTo({ top: (top + bottom - scroller.clientHeight) / 2, behavior: "smooth" });
}

function revealRow(selector: string) {
  if (!panelOpen.value) return;
  const cell = panelRef.value?.querySelector(
    `[data-test="rum-heatmap-feature-${CSS.escape(selector)}"]`,
  );
  cell?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

watch(rowHover, (selector) => {
  clearTimeout(hoverTimer);
  if (selector && autoScroll.value)
    hoverTimer = setTimeout(() => revealOnStage(selector), HOVER_SYNC_MS);
});

watch(listHighlight, (selector) => {
  clearTimeout(rowRevealTimer);
  if (selector && autoScroll.value)
    rowRevealTimer = setTimeout(() => revealRow(selector), HOVER_SYNC_MS);
});

function onRowClick(row: ElementRow) {
  selectSelector(row.selector);
}

function onMarkerSelect(selector: string) {
  selectSelector(selector);
  if (selectedSelector.value) revealRow(selector);
}

function selectSelector(selector: string) {
  selectedSelector.value = selectedSelector.value === selector ? "" : selector;
  drawHeat();
  const rect = elementRects.get(selectedSelector.value);
  if (!rect || !scrollerRef.value || !stageRef.value) return;
  const scroller = scrollerRef.value;
  const stageTop =
    stageRef.value.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop;
  scroller.scrollTo({
    top: stageTop + rect.y * stageScale.value - OUTLINE_SCROLL_MARGIN,
    behavior: "smooth",
  });
}

onMounted(() => {
  window.addEventListener("resize", onWindowResize);
  // Warm the player bundle so the first frame does not wait on its download.
  void import("@openobserve/rrweb-player").catch(() => undefined);
  void import("@openobserve/rrweb-player/dist/style.css").catch(() => undefined);
});

watch(
  () => [pa.scopeKey.value, pa.refreshTick.value, pa.rulesReady.value, pa.scopeStatus.value],
  () => void startLoad(),
  { immediate: true },
);

// A pasted link changes page or device without changing the shell scope.
watch(
  () => [pa.heatmap.pageUrl, pa.heatmap.device],
  ([url, device]) => {
    if (loading.value) return;
    if (device !== deviceClass.value) {
      deviceClass.value = device as DeviceClass;
      clearElementFilters();
      void loadPage(false);
    } else if (url && url !== pageUrl.value) {
      pageUrl.value = url;
      clearElementFilters();
      void loadPage();
    }
  },
);

function onWindowResize() {
  refit();
}

watch(isFullscreen, () => refit(0, true));
watch(panelOpen, () => refit());

// The scroller only exists once the page list has loaded, so observe it whenever it appears.
watch(scrollerRef, (el) => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!el) return;
  resizeObserver = new ResizeObserver(() => {
    if (!fitStage()) refit();
  });
  resizeObserver.observe(el);
});

function cancelLoads() {
  loadToken++;
  search.abortAll();
}

onBeforeUnmount(() => {
  stopPageSearch();
  clearTimeout(hoverTimer);
  clearTimeout(rowRevealTimer);
  cancelAnimationFrame(refitFrame);
  window.removeEventListener("resize", onWindowResize);
  cancelLoads();
  resizeObserver?.disconnect();
  destroyPlayer();
});
</script>
