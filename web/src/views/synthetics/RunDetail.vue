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
  RunDetail — Full page run detail view for synthetic monitoring.

  Opens when clicking a row in the MonitorRuns OTable. Shows the step
  timeline, session replay (when available), error details for failed
  runs, and step-level metadata.

  Split layout: left panel is the session replay player (or "no replay"
  message), right panel is the execution timeline. Step detail sits below.
-->

<template>
  <div
    class="run-detail flex flex-col h-full min-h-0"
    data-test="synthetics-run-detail"
  >
    <!-- ════════ HEADER ════════ -->
    <!-- ── Route mode header ── -->
    <AppPageHeader
      v-if="!drawerMode"
      class="px-4"
      :back="{
        label: t('synthetics.results.monitors'),
        to: { name: 'synthetic-monitor-results', params: { id: monitorId } },
        dataTest: 'synthetics-run-detail-back-btn',
      }"
    >
      <template #title>
        <span data-test="synthetics-run-detail-title">Run Details</span>
      </template>
      <template #title-trail>
        <OBadge
          :variant="statusBadgeVariant"
          size="sm"
          :icon="statusIcon"
          data-test="synthetics-run-detail-status-badge"
        >
          {{ statusLabel }}
        </OBadge>
        <OBadge
          v-if="currentRun.url"
          variant="default"
          size="sm"
          icon="link"
          class="truncate max-w-[200px]"
          data-test="synthetics-run-detail-url-badge"
        >
          {{ currentRun.url }}
        </OBadge>
        <span
          class="font-mono text-xs text-text-secondary shrink-0"
          data-test="synthetics-run-detail-timestamp-label"
        >
          {{ currentRun.timestamp }}
        </span>
        <div class="flex ml-1">
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="chevron_left"
            :disabled="true"
            data-test="synthetics-run-detail-prev-btn"
          />
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="chevron_right"
            :disabled="true"
            data-test="synthetics-run-detail-next-btn"
          />
        </div>
      </template>
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          icon-left="open_in_new"
          data-test="synthetics-run-detail-trace-btn"
        >
          Open Playwright Trace
        </OButton>
        <OButton
          variant="outline"
          size="sm"
          icon-left="replay"
          data-test="synthetics-run-detail-rerun-btn"
        >
          Rerun
        </OButton>
      </template>
    </AppPageHeader>

    <!-- ════════ SUB TABS ════════ -->
    <OTabs
      v-model="activeTab"
      class="shrink-0 px-5 border-b border-border-default"
    >
      <OTab name="summary" data-test="synthetics-run-detail-tab-summary">
        <span class="flex items-center gap-1.5">
          <OIcon name="article" size="sm" />
          Summary
        </span>
      </OTab>
      <OTab name="logs" data-test="synthetics-run-detail-tab-logs">
        <span class="flex items-center gap-1.5">
          <OIcon name="search" size="sm" />
          Logs
        </span>
      </OTab>
      <OTab name="traces" data-test="synthetics-run-detail-tab-traces">
        <span class="flex items-center gap-1.5">
          <OIcon name="account-tree" size="sm" />
          Traces
        </span>
      </OTab>
      <OTab name="rum" data-test="synthetics-run-detail-tab-rum">
        <span class="flex items-center gap-1.5">
          <OIcon name="devices" size="sm" />
          RUM
        </span>
      </OTab>
    </OTabs>

    <div class="flex-1 min-h-0">
      <OTabPanels v-model="activeTab" grow scroll="y" class="h-full min-h-0">
        <!-- ════════════ SUMMARY ════════════ -->
        <OTabPanel name="summary" data-test="synthetics-run-detail-summary-tab">
          <div
            class="mx-auto px-5 py-[0.875rem] pb-[1.75rem] flex flex-col gap-[0.875rem]"
          >
            <!-- Info chips skeleton -->
            <template v-if="loading">
              <div
                class="grid grid-cols-4 gap-[0.625rem]"
                data-test="synthetics-run-detail-info-skeleton"
              >
                <div
                  v-for="i in 4"
                  :key="i"
                  class="card-container rounded-lg flex flex-col px-[0.875rem] pt-[0.625rem] pb-[0.625rem] gap-[0.25rem] bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)]"
                >
                  <OSkeleton type="text" class="h-3 w-16" />
                  <OSkeleton type="text" class="h-5 w-24 mt-1" />
                </div>
              </div>
            </template>
            <!-- Info chips -->
            <template v-else>
              <div
                class="grid grid-cols-4 gap-[0.625rem]"
                data-test="synthetics-run-detail-info-bar"
              >
                <div
                  v-for="chip in infoChips"
                  :key="chip.label"
                  class="card-container rounded-lg flex flex-col px-[0.875rem] pt-[0.625rem] pb-[0.625rem] gap-[0.25rem] bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)]"
                >
                  <span
                    class="kpi-label text-[0.7rem] font-semibold text-[var(--o2-text-muted)] capitalize"
                  >
                    {{ chip.label }}
                  </span>
                  <span
                    class="flex items-center gap-1 text-xs font-bold leading-none text-[var(--o2-text-primary)]"
                  >
                    <OIcon
                      v-if="chip.icon"
                      :name="chip.icon"
                      size="sm"
                      class="shrink-0"
                    />
                    {{ chip.value }}
                  </span>
                </div>
              </div>
            </template>

            <!-- Error callout -->
            <div
              v-if="isFailed"
              class="bg-[var(--color-badge-error-soft-bg)] border border-badge-error-ol-border/30 rounded-lg overflow-hidden"
              data-test="synthetics-run-detail-error-callout"
            >
              <div class="flex items-start gap-3 p-[0.875rem]">
                <OIcon
                  name="error"
                  class="text-[var(--o2-status-error-text)] shrink-0 text-[22px]"
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span
                      class="text-[13.5px] font-bold text-[var(--o2-status-error-text)]"
                    >
                      {{ errorType }}
                    </span>
                    <OBadge v-if="failedStepInfo" variant="error" size="sm">
                      Step {{ failedStepInfo.step.id }}: {{ failedStepInfo.step.action }} failed
                    </OBadge>
                  </div>
                  <p
                    v-if="failedStepInfo?.summary"
                    class="text-[12.5px] leading-[1.6] text-text-body mt-1.5 mb-0"
                  >
                    {{ failedStepInfo.summary }}
                  </p>
                  <OButton
                    variant="outline-destructive"
                    size="xs"
                    class="mt-2"
                    data-test="synthetics-run-detail-error-expand-btn"
                    @click="toggleStack"
                  >
                    <template #icon-left>
                      <OIcon
                        name="expand-more"
                        size="xs"
                        class="transition-transform duration-150"
                        :class="{ 'rotate-180': stackOpen }"
                      />
                    </template>
                    <span
                      class="text-[11.5px] font-semibold text-[var(--o2-status-error-text)]"
                    >
                      View full error &amp; stack trace
                    </span>
                  </OButton>
                  <pre
                    v-if="stackOpen"
                    class="mt-2 text-[11px] leading-[1.6] text-text-body bg-[var(--o2-code-bg)] rounded-md p-[10px_12px] overflow-auto whitespace-pre-wrap font-mono"
                    data-test="synthetics-run-detail-error-stack"
                    >{{ errorStack }}</pre
                  >
                </div>
              </div>
            </div>

            <!-- Steps skeleton -->
            <template v-if="loading">
              <OCard class="p-0 gap-0">
                <OCardSection role="header" class="gap-2">
                  <OSkeleton type="text" class="h-4 w-14" />
                </OCardSection>
                <OSeparator />
                <OCardSection role="body" class="flex flex-col gap-2 p-3">
                  <div
                    v-for="i in 4"
                    :key="i"
                    class="flex items-center gap-2 rounded border border-[var(--o2-border-color)] p-2"
                  >
                    <OSkeleton type="rect" class="h-12 w-18 shrink-0 rounded" />
                    <OSkeleton type="circle" class="h-6 w-6 shrink-0" />
                    <OSkeleton type="text" class="h-4 flex-1" />
                    <OSkeleton type="text" class="h-4 w-16 shrink-0" />
                  </div>
                </OCardSection>
              </OCard>
            </template>
            <!-- ══ Split: Replay Player (left) + Steps Timeline (right) ══ -->
            <div v-else-if="steps.length > 0" class="flex gap-[0.875rem] items-start">
              <!-- ── Left: Session Replay Player ── -->
              <OCard
                v-if="currentRun.hasReplay"
                class="p-0 gap-0 w-[30%] min-w-[30rem]"
              >
                <OCardSection role="header" class="gap-2">
                  <OIcon
                    name="smart_display"
                    size="sm"
                    class="text-primary-700"
                  />
                  <span class="font-bold text-sm text-text-heading"
                    >Session Replay</span
                  >
                  <span class="flex-1" />
                  <span class="font-mono text-[11px] text-text-secondary">
                    Step {{ selectedStep.id }} of {{ steps.length }}
                  </span>
                </OCardSection>
                <OSeparator />

                <div class="h-[380px] flex flex-col">
                  <div class="flex-1 min-h-0">
                    <VideoPlayer
                      :events="[]"
                      :segments="[]"
                      :is-loading="false"
                    />
                  </div>
                </div>
              </OCard>

              <!-- ── Right: Execution Timeline ── -->
              <OCard class="p-0 gap-0 flex-1 min-w-0">
                <OCardSection role="header" class="gap-2">
                  <span class="font-bold text-sm text-text-heading">Steps</span>
                  <OBadge variant="default" size="sm">{{
                    steps.length
                  }}</OBadge>
                  <span class="flex-1" />
                  <OBadge
                    v-if="isErrorRun"
                    variant="error-soft"
                    size="sm"
                    data-test="synthetics-run-detail-error-step-badge"
                  >
                    Lambda Error
                  </OBadge>
                  <OBadge
                    v-else-if="isFailed"
                    variant="error"
                    size="sm"
                    dot
                    data-test="synthetics-run-detail-error-step-badge"
                  >
                    {{ failedStepLabel }}
                  </OBadge>
                </OCardSection>
                <OSeparator />
                <OCardSection
                  role="body"
                  scrollable
                  class="max-h-[35rem] p-2 overflow-auto"
                >
                  <!-- Steps pass/fail banner -->
                  <div
                    v-if="isErrorRun"
                    class="flex items-start gap-2 px-3 py-2 mb-2 rounded bg-[var(--color-badge-error-soft-bg)] border border-badge-error-ol-border/30"
                    role="alert"
                    data-test="synthetics-run-detail-steps-error-banner"
                  >
                    <OIcon
                      name="error"
                      size="sm"
                      class="mt-0.5 text-badge-error-ol-text"
                      aria-hidden="true"
                    />
                    <div class="flex flex-col gap-0.5 flex-1 min-w-0">
                      <span
                        class="text-sm text-badge-error-ol-text font-semibold"
                      >
                        Lambda execution failed — check the error details above
                      </span>
                    </div>
                  </div>
                  <div
                    v-else-if="isFailed"
                    class="flex items-start gap-2 px-3 py-2 mb-2 rounded bg-[var(--color-badge-error-soft-bg)] border border-badge-error-ol-border/30"
                    role="alert"
                    data-test="synthetics-run-detail-steps-failed-banner"
                  >
                    <OIcon
                      name="error"
                      size="sm"
                      class="mt-0.5 text-badge-error-ol-text"
                      aria-hidden="true"
                    />
                    <div class="flex flex-col gap-0.5 flex-1 min-w-0">
                      <span
                        class="text-sm text-badge-error-ol-text font-semibold"
                      >
                        Run failed — {{ failedStepLabel || "execution error" }}
                      </span>
                    </div>
                  </div>
                  <div
                    v-else-if="steps.length > 0"
                    class="flex items-center gap-2 px-3 py-2 mb-2 rounded bg-[var(--color-badge-success-soft-bg)] border border-badge-success-ol-border/50"
                    role="status"
                    data-test="synthetics-run-detail-steps-passed-banner"
                  >
                    <OIcon
                      name="check-circle"
                      size="sm"
                      class="text-[var(--color-timeline-dot-success)]"
                      aria-hidden="true"
                    />
                    <span
                      class="text-sm text-badge-success-ol-text font-semibold"
                    >
                      Run passed — {{ steps.length }}/{{ steps.length }} steps
                      completed successfully
                    </span>
                  </div>
                  <div
                    v-for="st in steps"
                    :key="st.id"
                    class="rounded border border-[var(--o2-border-color)] bg-[var(--o2-card-bg)] mb-1"
                    :data-test="`synthetics-run-detail-step-row-${st.id}`"
                  >
                    <!-- Compact row -->
                    <div
                      class="flex items-center gap-1.5 px-2 h-16 min-h-16 rounded"
                      :class="{
                        'border-b border-[var(--o2-border-color)]': isExpanded(
                          st.id,
                        ),
                      }"
                    >
                      <!-- Step number (colored status circle) -->
                      <span
                        :class="[
                          st.status === 'fail'
                            ? 'w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-[var(--color-badge-error-soft-bg)] text-[var(--color-badge-error-soft-text)] border border-[var(--color-badge-error-soft-text)] text-xs font-semibold'
                            : 'w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-[var(--color-badge-success-soft-bg)] text-[var(--color-badge-success-soft-text)] border border-[var(--color-badge-success-soft-text)] text-xs font-semibold',
                        ]"
                      >
                        {{ st.id }}
                      </span>
                      <!-- Screenshot thumbnail 60×40 -->
                      <div
                        class="w-18 h-12 shrink-0 rounded border border-[var(--o2-border-color)] bg-surface-subtle flex items-center justify-center overflow-hidden"
                      >
                        <img
                          v-if="st.screenshotKey"
                          :src="screenshotUrl(st.screenshotKey)"
                          alt="Step screenshot"
                          class="w-full h-full object-cover"
                        />
                        <OIcon
                          v-else
                          name="image"
                          size="xs"
                          class="text-text-caption"
                        />
                      </div>

                      <!-- Action icon -->
                      <span
                        class="bg-[var(--o2-primary-50)] rounded p-1 flex items-center shrink-0"
                      >
                        <OIcon
                          :name="st.icon"
                          size="sm"
                          class="text-[var(--o2-primary-color)]"
                        />
                      </span>

                      <!-- Action label badge -->
                      <OBadge variant="default" size="sm">{{
                        st.action
                      }}</OBadge>

                      <!-- Step name -->
                      <span
                        class="text-sm text-[var(--o2-text-body)] flex-1 truncate min-w-0"
                      >
                        {{ st.name }}
                      </span>

                      <!-- Duration -->
                      <span
                        class="text-xs text-[var(--o2-text-secondary)] shrink-0 font-mono tabular-nums"
                      >
                        {{ st.durStr }}
                      </span>

                      <!-- Expand/collapse -->
                      <OButton
                        variant="ghost"
                        size="xs"
                        class="shrink-0"
                        :data-test="`synthetics-run-detail-step-expand-${st.id}`"
                        @click="toggleExpand(st.id)"
                      >
                        <OIcon
                          :name="
                            isExpanded(st.id) ? 'expand-less' : 'expand-more'
                          "
                          size="sm"
                        />
                      </OButton>
                    </div>

                    <!-- Expanded content (auto-expanded for failed steps) -->
                    <div v-if="isExpanded(st.id)" class="flex gap-4 p-3">
                      <!-- Screenshot preview 280px -->
                      <div class="w-[30%] shrink-0">
                        <div
                          class="rounded border border-[var(--o2-border-color)] overflow-hidden"
                        >
                          <div
                            class="aspect-[16/10] flex items-center justify-center overflow-hidden"
                            :class="
                              st.status === 'fail'
                                ? 'bg-[var(--o2-status-error-subtle)]'
                                : 'bg-surface-subtle'
                            "
                          >
                            <img
                              v-if="st.screenshotKey"
                              :src="screenshotUrl(st.screenshotKey)"
                              alt="Step screenshot"
                              class="w-full h-full object-contain"
                            />
                            <template v-else>
                              <OIcon
                                :name="
                                  st.status === 'fail'
                                    ? 'broken_image'
                                    : 'image'
                                "
                                :class="
                                  st.status === 'fail'
                                    ? 'text-status-error-text'
                                    : 'text-text-caption'
                                "
                                size="lg"
                              />
                              <span
                                class="text-xs font-semibold"
                                :class="
                                  st.status === 'fail'
                                    ? 'text-status-error-text'
                                    : 'text-text-caption'
                                "
                              >
                                {{
                                  st.status === "fail"
                                    ? "Failure screenshot"
                                    : "Screenshot placeholder"
                                }}
                              </span>
                            </template>
                          </div>
                        </div>
                      </div>

                      <!-- Details (right panel): error + KV metadata + actions -->
                      <div class="flex-1 flex flex-col gap-2">
                        <dl
                          class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs"
                        >
                          <dt
                            class="text-[10px] font-semibold text-text-secondary uppercase tracking-wide"
                          >
                            Action
                          </dt>
                          <dd class="text-text-body">{{ st.action }}</dd>
                          <dt
                            class="text-[10px] font-semibold text-text-secondary uppercase tracking-wide"
                          >
                            Selector
                          </dt>
                          <dd class="font-mono text-text-body">
                            {{ st.detail }}
                          </dd>
                          <dt
                            class="text-[10px] font-semibold text-text-secondary uppercase tracking-wide"
                          >
                            URL
                          </dt>
                          <dd class="font-mono truncate text-text-body">
                            {{ st.detail }}
                          </dd>
                          <dt
                            class="text-[10px] font-semibold text-text-secondary uppercase tracking-wide"
                          >
                            Duration
                          </dt>
                          <dd class="text-text-heading">{{ st.durStr }}</dd>
                        </dl>

                        <!-- Error section (failed steps only) -->
                        <div
                          v-if="st.status === 'fail' && st.error"
                          class="rounded-lg border border-badge-error-ol-border/30 overflow-hidden"
                          :data-test="`synthetics-run-detail-step-error-card-${st.id}`"
                        >
                          <div
                            class="flex items-center gap-2 px-3 py-2 bg-[var(--color-badge-error-soft-bg)]"
                          >
                            <OIcon
                              name="error"
                              size="sm"
                              class="text-[var(--o2-status-error)]"
                              aria-hidden="true"
                            />
                            <span
                              class="text-xs font-semibold text-[var(--o2-text-heading)] flex-1"
                              >Error</span
                            >
                            <span
                              class="text-xs font-mono text-[var(--o2-text-secondary)]"
                              >exit · {{ st.durStr }}</span
                            >
                          </div>
                          <div class="px-3 py-3">
                            <pre
                              class="text-[12.5px] text-[var(--o2-text-body)] m-0 whitespace-pre-wrap font-mono leading-relaxed"
                              :class="{ 'max-h-[96px] overflow-hidden': !expandedStepErrors.has(st.id) && (st.error?.length ?? 0) > 200 }"
                            >{{ st.error }}</pre>
                            <button
                              v-if="(st.error?.length ?? 0) > 200"
                              class="text-xs font-semibold text-[var(--o2-text-link)] mt-1.5 hover:underline cursor-pointer"
                              @click="toggleStepError(st.id)"
                            >
                              {{ expandedStepErrors.has(st.id) ? 'Show less' : 'Show full error' }}
                            </button>
                          </div>
                        </div>

                        <div class="flex gap-2 mt-auto">
                          <OButton
                            variant="ghost"
                            size="sm"
                            data-test="synthetics-run-detail-download-step-btn"
                            aria-label="Download screenshot"
                          >
                            <OIcon name="file-download" size="sm" />
                          </OButton>
                        </div>
                      </div>
                    </div>
                  </div>
                </OCardSection>
              </OCard>
            </div>
          </div>
        </OTabPanel>

        <!-- ════════════ LOGS (placeholder) ════════════ -->
        <OTabPanel name="logs">
          <div class="h-full flex items-center justify-center">
            <OEmptyState
              preset="no-results"
              size="block"
              data-test="synthetics-run-detail-logs-empty"
            >
              <template #title>
                <span>No correlated logs</span>
              </template>
              <template #description>
                <span
                  >Correlated observability data will appear here when your
                  application is sending logs to OpenObserve.</span
                >
              </template>
            </OEmptyState>
          </div>
        </OTabPanel>

        <!-- ════════════ TRACES (placeholder) ════════════ -->
        <OTabPanel name="traces">
          <div class="h-full flex items-center justify-center">
            <OEmptyState
              preset="no-results"
              size="block"
              data-test="synthetics-run-detail-traces-empty"
            >
              <template #title>
                <span>No correlated traces</span>
              </template>
              <template #description>
                <span
                  >Correlated observability data will appear here when your
                  application is sending traces to OpenObserve.</span
                >
              </template>
            </OEmptyState>
          </div>
        </OTabPanel>

        <!-- ════════════ RUM (placeholder) ════════════ -->
        <OTabPanel name="rum">
          <div class="h-full flex items-center justify-center">
            <OEmptyState
              preset="no-results"
              size="block"
              data-test="synthetics-run-detail-rum-empty"
            >
              <template #title>
                <span>No correlated RUM data</span>
              </template>
              <template #description>
                <span
                  >Correlated observability data will appear here when your
                  application is sending RUM data to OpenObserve.</span
                >
              </template>
            </OEmptyState>
          </div>
        </OTabPanel>
      </OTabPanels>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import syntheticsService from "@/services/synthetics";
import { timestampToTimezoneDate } from "@/utils/timezone";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import VideoPlayer from "@/components/rum/VideoPlayer.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import useSyntheticResults from "@/composables/useSyntheticResults";
import type {
  SyntheticRunDetail,
  RecordedStep,
} from "@/composables/synthetics/syntheticResultsSchema";
import awsSvgUrl from "@/assets/images/ingestion/aws.svg";
import gcpSvgUrl from "@/assets/images/ingestion/gcp.svg";
import chromiumSvgUrl from "@/assets/images/synthetics/chromium.svg";
import firefoxSvgUrl from "@/assets/images/synthetics/firefox.svg";
import webkitSvgUrl from "@/assets/images/synthetics/webkit.svg";

defineOptions({ name: "SyntheticRunDetail" });

const emit = defineEmits<{
  (
    e: "update-status",
    status: {
      variant: string;
      icon: string;
      label: string;
      url: string;
      timestamp: string;
    },
  ): void;
}>();

// ── Props — enable embedding in ODrawer ──────────────────────────────────────
interface Props {
  drawerMode?: boolean;
  overrideMonitorId?: string;
  overrideRunId?: string;
  overrideExecutionId?: string;
}
const props = withDefaults(defineProps<Props>(), {
  drawerMode: false,
  overrideMonitorId: "",
  overrideRunId: "",
  overrideExecutionId: "",
});

const { t } = useI18n();
const route = useRoute();
const store = useStore();

// ── Source IDs — props in drawer mode, route params otherwise ────────────────
const monitorId = computed(() =>
  props.drawerMode ? props.overrideMonitorId : String(route.params.id ?? ""),
);
const runIdParam = computed(() =>
  props.drawerMode ? props.overrideRunId : String(route.params.runId ?? ""),
);
const executionIdParam = computed(() =>
  props.drawerMode
    ? props.overrideExecutionId
    : String(route.params.executionId ?? ""),
);

// ── Composable ─────────────────────────────────────────────────────────────
const synthetics = useSyntheticResults();

// ── Action icon map ────────────────────────────────────────────────────────
const ACTION_META: Record<string, string> = {
  navigate: "open-in-browser",
  click: "ads-click",
  type: "keyboard",
  select: "checklist",
  press: "keyboard",
  hover: "touch-app",
  scroll: "swap-vert",
  wait: "hourglass-empty",
  assert: "fact-check",
  screenshot: "photo-camera",
};

function actionIcon(action: string): string {
  return ACTION_META[action] || "ads-click";
}

// ── StepRow — display model for step rows ──────────────────────────────────
interface StepRow {
  id: number;
  stepId: string;
  action: string;
  name: string;
  detail: string;
  duration: number;
  status: "pass" | "fail";
  icon: string;
  statusIcon: string;
  durStr: string;
  durColor: string;
  error: string | null;
  screenshotKey: string | null;
}

function fmtDur(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms";
}

/** Merge recorded_step definitions with last_attempt_step execution results. */
function buildSteps(detail: SyntheticRunDetail | null): StepRow[] {
  if (!detail || !detail.lastAttemptSteps.length) return [];
  const recordedMap = new Map<string, RecordedStep>();
  for (const rs of detail.recordedSteps) {
    recordedMap.set(rs.id, rs);
  }
  return detail.lastAttemptSteps.map((ex, idx) => {
    const recorded = recordedMap.get(ex.step_id);
    const isFail = ex.status === "fail";
    return {
      id: idx + 1,
      stepId: ex.step_id,
      action: recorded?.action ?? "step",
      name:
        recorded?.name ||
        recorded?.selector ||
        recorded?.url ||
        ex.step_id.slice(0, 8),
      detail: recorded?.selector ?? recorded?.url ?? ex.step_id,
      duration: ex.duration_ms,
      status: isFail ? ("fail" as const) : ("pass" as const),
      icon: recorded ? actionIcon(recorded.action) : "radio_button_checked",
      statusIcon: isFail ? "cancel" : "check-circle",
      durStr: fmtDur(ex.duration_ms),
      durColor: isFail
        ? "var(--o2-status-error-text)"
        : "var(--o2-text-secondary)",
      error: ex.error,
      screenshotKey: ex.screenshot_key,
    };
  });
}

function capitalizeEngine(engine: string): string {
  if (!engine) return engine;
  return engine.charAt(0).toUpperCase() + engine.slice(1);
}

function fmtTimestamp(tsMs: number): string {
  return timestampToTimezoneDate(
    tsMs,
    store.state.timezone,
    "MMM dd, HH:mm ZZZ",
  );
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

function deviceIcon(name: string): string {
  console.log(name);
  if (name === "laptop_large") return "computer";
  if (name === "tablet") return "tablet";
  if (name === "mobile_small") return "smartphone";
  return "devices";
}

// ── Artifact URLs — batch-presigned per run ────────────────────────────────
// key → signed (or proxy) URL, populated once per run load. Backend decides
// mode from its storage config; both URL kinds work directly in <img src>.
const artifactUrls = ref<Record<string, string>>({});

async function presignRunArtifacts() {
  const detail = synthetics.runDetail.value;
  if (!detail) return;
  const keys = [
    ...detail.lastAttemptSteps.map((s) => s.screenshot_key),
    detail.traceKey,
  ].filter((k): k is string => !!k);
  if (!keys.length) return;
  const orgId = store.state.selectedOrganization.identifier;
  try {
    const { data } = await syntheticsService.presignArtifacts(
      orgId,
      monitorId.value,
      keys,
    );
    const map: Record<string, string> = {};
    for (const entry of data.urls ?? []) {
      map[entry.key] = entry.url;
    }
    artifactUrls.value = map;
  } catch (e) {
    // Presign failed — screenshotUrl falls back to the proxy endpoint per key.
    console.error("[synthetics] presign artifacts failed:", e);
    artifactUrls.value = {};
  }
}

watch(
  () => synthetics.runDetail.value,
  (detail) => {
    artifactUrls.value = {};
    if (detail) presignRunArtifacts();
  },
);

function screenshotUrl(key: string | null): string {
  if (!key) return "";
  const signed = artifactUrls.value[key];
  if (signed) return signed;
  const orgId = store.state.selectedOrganization.identifier;
  return syntheticsService.artifactUrl(orgId, key);
}

// ── Display model for the current run (mapped from SyntheticRunDetail) ─────
interface DisplayRun {
  id: string;
  monitorName: string;
  status: "pass" | "fail" | "error";
  duration: number;
  browser: string;
  device: string;
  location: string;
  timestamp: string;
  url: string;
  hasReplay: boolean;
  errorType?: string;
  errorReason?: string;
  errorStack?: string;
  failedStepLabel?: string;
  failedStepId?: number;
}

function toDisplayRun(detail: SyntheticRunDetail | null): DisplayRun {
  if (!detail) {
    return {
      id: "",
      monitorName: "",
      status: "pass",
      duration: 0,
      browser: "",
      device: "",
      location: "",
      timestamp: "",
      url: "",
      hasReplay: false,
    };
  }
  const isFail = detail.status === "failed";
  const isError = detail.status === "error";
  const hasIssue = isFail || isError;
  return {
    id: detail.runId,
    monitorName: detail.monitorName,
    status: isFail
      ? ("fail" as const)
      : isError
        ? ("error" as const)
        : ("pass" as const),
    duration: detail.durationMs,
    browser: capitalizeEngine(detail.browserEngine),
    device: detail.device,
    location: detail.location,
    timestamp: fmtTimestamp(detail.timestamp),
    url: detail.recordedSteps[0]?.url ?? "",
    hasReplay: false,
    ...(hasIssue
      ? {
          errorType: detail.error ? detail.error.split(":")[0] : "Error",
          errorReason: detail.error || "",
          errorStack: detail.error || "",
          failedStepLabel: detail.failedStep
            ? "Failed at: " + detail.failedStep
            : undefined,
          failedStepId: 1,
        }
      : {}),
  };
}

// ── State ─────────────────────────────────────────────────────────────────
const activeTab = ref("summary");
const stackOpen = ref(false);

/** Multi-expand: set of expanded step IDs. */
const expandedStepIds = ref(new Set<number>());
function isExpanded(id: number): boolean {
  return expandedStepIds.value.has(id);
}
function toggleExpand(id: number) {
  const next = new Set(expandedStepIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedStepIds.value = next;
}

// Computed: current run from composable data
const loading = computed(() => synthetics.loading.value);
const currentRun = computed<DisplayRun>(() => {
  return synthetics.runDetail.value
    ? toDisplayRun(synthetics.runDetail.value)
    : toDisplayRun(null);
});

const isFailed = computed(
  () =>
    currentRun.value.status === "fail" || currentRun.value.status === "error",
);

const isErrorRun = computed(() => currentRun.value.status === "error");

const steps = computed<StepRow[]>(() => {
  if (synthetics.runDetail.value) {
    return buildSteps(synthetics.runDetail.value);
  }
  return [];
});

/** Collapsible step error state (show-more / show-less for long Playwright logs). */
const expandedStepErrors = ref(new Set<number>());
function toggleStepError(id: number) {
  const next = new Set(expandedStepErrors.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedStepErrors.value = next;
}

/** Failed step info for the error banner — matched from detail.failedStep. */
const failedStepInfo = computed(() => {
  const detail = synthetics.runDetail.value;
  if (!detail?.failedStep || !steps.value.length) return null;
  const step = steps.value.find((s) => s.stepId === detail.failedStep);
  if (!step) return null;
  return {
    step,
    summary: step.error ? step.error.split('\n')[0] : '',
  };
});

/** Auto-expand any failed steps when the run data loads. */
watch(steps, (newSteps) => {
  const next = new Set(expandedStepIds.value);
  let changed = false;
  for (const st of newSteps) {
    if (st.status === 'fail' && !next.has(st.id)) {
      next.add(st.id);
      changed = true;
    }
  }
  if (changed) expandedStepIds.value = next;
});

const statusBadgeVariant = computed(() =>
  isErrorRun.value ? "error-soft" : isFailed.value ? "error" : "success",
);
const statusIcon = computed(() =>
  isErrorRun.value ? "error" : isFailed.value ? "cancel" : "check_circle",
);
const statusLabel = computed(() =>
  isErrorRun.value ? "Error" : isFailed.value ? "Failed" : "Passed",
);

const errorType = computed(() => currentRun.value.errorType ?? "");
const errorStack = computed(() => currentRun.value.errorStack ?? "");

const infoChips = computed(() => [
  { label: "Duration", value: fmtDur(currentRun.value.duration), icon: "" },
  {
    label: "Browser",
    value: currentRun.value.browser,
    icon: browserIcon(currentRun.value.browser),
  },
  {
    label: "Device",
    value: currentRun.value.device,
    icon: deviceIcon(currentRun.value.device),
  },
  {
    label: "Location",
    value: "AWS " + currentRun.value.location,
    icon: locationIcon(currentRun.value.location),
  },
]);

// ── Emit status to parent (for drawer header-right badge) ──────────────────
watch(
  () => synthetics.runDetail.value?.status ?? null,
  (status) => {
    if (!props.drawerMode || !status) return;
    const isErr = status === "error";
    const isF = status === "failed" || isErr;
    emit("update-status", {
      variant: isErr ? "error-soft" : isF ? "error" : "success",
      icon: isErr ? "error" : isF ? "cancel" : "check-circle",
      label: isErr ? "Error" : isF ? "Failed" : "Passed",
      url: currentRun.value.url,
      timestamp: currentRun.value.timestamp,
    });
  },
);

// ── Fetch data on mount / route change ────────────────────────────────────
async function loadRun() {
  if (!runIdParam.value || !executionIdParam.value) return;
  const endTime = Date.now() * 1000; // µs
  const startTime = endTime - 30 * 24 * 3600 * 1000 * 1000; // 30 days
  await synthetics.fetchRun(
    monitorId.value,
    runIdParam.value,
    executionIdParam.value,
    startTime,
    endTime,
  );
}

watch(
  () => [runIdParam.value, executionIdParam.value] as [string, string],
  ([newRunId, newExecId]) => {
    if (newRunId && newExecId) {
      expandedStepIds.value = new Set();
      stackOpen.value = false;
      loadRun();
    }
  },
  { immediate: true },
);

function toggleStack() {
  stackOpen.value = !stackOpen.value;
}
</script>
