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
    class="run-detail tw:flex tw:flex-col tw:h-full tw:min-h-0"
    data-test="synthetics-run-detail"
  >
    <!-- ════════ HEADER ════════ -->
    <AppPageHeader
      class="tw:px-4"
      :back="{
        label: t('synthetics.results.monitors'),
        to: { name: 'synthetic-monitor-results', params: { id: monitorId } },
        dataTest: 'synthetics-run-detail-back-btn',
      }"
    >
      <template #title>
        <span data-test="synthetics-run-detail-title"
          >Run #{{ currentRun.id }}</span
        >
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
        <div class="tw:flex tw:ml-1">
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
      class="tw:shrink-0 tw:px-5 tw:border-b tw:border-border-default"
    >
      <OTab name="summary" data-test="synthetics-run-detail-tab-summary">
        <span class="tw:flex tw:items-center tw:gap-1.5">
          <OIcon name="summarize" size="sm" />
          Summary
        </span>
      </OTab>
      <OTab name="logs" data-test="synthetics-run-detail-tab-logs">
        <span class="tw:flex tw:items-center tw:gap-1.5">
          <OIcon name="search" size="sm" />
          Logs
        </span>
      </OTab>
      <OTab name="traces" data-test="synthetics-run-detail-tab-traces">
        <span class="tw:flex tw:items-center tw:gap-1.5">
          <OIcon name="account_tree" size="sm" />
          Traces
        </span>
      </OTab>
      <OTab name="rum" data-test="synthetics-run-detail-tab-rum">
        <span class="tw:flex tw:items-center tw:gap-1.5">
          <OIcon name="devices" size="sm" />
          RUM
        </span>
      </OTab>
    </OTabs>

    <div class="tw:flex-1 tw:min-h-0">
      <OTabPanels
        v-model="activeTab"
        grow
        scroll="y"
        class="tw:h-full tw:min-h-0"
      >
        <!-- ════════════ SUMMARY ════════════ -->
        <OTabPanel name="summary" data-test="synthetics-run-detail-summary-tab">
          <div
            class="tw:mx-auto tw:px-5 tw:py-[0.875rem] tw:pb-[1.75rem] tw:flex tw:flex-col tw:gap-[0.875rem]"
          >
            <!-- Error callout -->
            <div
              v-if="isFailed"
              class="tw:border tw:border-[var(--o2-status-error-border)] tw:bg-[var(--o2-status-error-subtle)] tw:rounded-lg tw:overflow-hidden"
              data-test="synthetics-run-detail-error-callout"
            >
              <div class="tw:flex tw:items-start tw:gap-3 tw:p-[0.875rem]">
                <OIcon
                  name="error"
                  class="tw:text-[var(--o2-status-error-text)] tw:shrink-0 tw:text-[22px]"
                />
                <div class="tw:flex-1 tw:min-w-0">
                  <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                    <span
                      class="tw:text-[13.5px] tw:font-bold tw:text-[var(--o2-status-error-text)]"
                    >
                      {{ errorType }}
                    </span>
                    <OBadge variant="error" size="sm">
                      {{ failedStepLabel }}
                    </OBadge>
                  </div>
                  <p
                    class="tw:text-[12.5px] tw:leading-[1.6] tw:text-text-body tw:mt-1.5 tw:mb-0"
                  >
                    {{ errorReason }}
                  </p>
                  <button
                    type="button"
                    class="tw:flex tw:items-center tw:gap-1 tw:bg-transparent tw:border-0 tw:p-0 tw:mt-2 tw:cursor-pointer tw:font-inherit tw:text-[11.5px] tw:font-semibold tw:text-[var(--o2-status-error-text)]"
                    @click="toggleStack"
                  >
                    <OIcon
                      name="expand_more"
                      size="xs"
                      class="tw:transition-transform tw:duration-150"
                      :class="{ 'tw:rotate-180': stackOpen }"
                    />
                    View full error &amp; stack trace
                  </button>
                  <pre
                    v-if="stackOpen"
                    class="tw:mt-2 tw:text-[11px] tw:leading-[1.6] tw:text-text-body tw:bg-[var(--o2-code-bg)] tw:rounded-md tw:p-[10px_12px] tw:overflow-auto tw:whitespace-pre-wrap tw:font-mono"
                    data-test="synthetics-run-detail-error-stack"
                    >{{ errorStack }}</pre
                  >
                </div>
              </div>
            </div>

            <!-- Info bar -->
            <div
              class="tw:grid tw:grid-cols-5 tw:border tw:border-border-default tw:rounded-lg tw:bg-surface-subtle tw:overflow-hidden"
              data-test="synthetics-run-detail-info-bar"
            >
              <div
                v-for="chip in infoChips"
                :key="chip.label"
                class="tw:flex tw:flex-col tw:gap-0.5 tw:px-4 tw:py-[0.625rem] tw:border-r tw:border-border-default tw:last:border-r-0"
              >
                <span
                  class="tw:text-xs tw:pb-1 tw:font-semibold tw:text-text-secondary tw:capitalize tw:tracking-wide"
                >
                  {{ chip.label }}
                </span>
                <span
                  class="tw:flex tw:items-center tw:gap-1 tw:font-mono tw:tabular-nums tw:text-[13px] tw:font-bold tw:text-text-heading"
                >
                  <OIcon
                    v-if="chip.icon"
                    :name="chip.icon"
                    size="sm"
                    class="tw:shrink-0"
                  />
                  {{ chip.value }}
                </span>
              </div>
            </div>

            <!-- ══ Split: Replay Player (left) + Steps Timeline (right) ══ -->
            <div class="tw:flex tw:gap-[0.875rem] tw:items-start">
              <!-- ── Left: Session Replay Player ── -->
              <OCard
                v-if="currentRun.hasReplay"
                class="tw:p-0 tw:gap-0 tw:w-[30%] tw:min-w-[30rem]"
              >
                <OCardSection role="header" class="tw:gap-2">
                  <OIcon
                    name="smart_display"
                    size="sm"
                    class="tw:text-primary-700"
                  />
                  <span class="tw:font-bold tw:text-sm tw:text-text-heading"
                    >Session Replay</span
                  >
                  <span class="tw:flex-1" />
                  <span
                    class="tw:font-mono tw:text-[11px] tw:text-text-secondary"
                  >
                    Step {{ selectedStep.id }} of {{ steps.length }}
                  </span>
                </OCardSection>
                <OSeparator />

                <div class="tw:h-[380px] tw:flex tw:flex-col">
                  <div class="tw:flex-1 tw:min-h-0">
                    <VideoPlayer
                      :events="[]"
                      :segments="[]"
                      :is-loading="false"
                    />
                  </div>
                </div>
              </OCard>

              <!-- ── Right: Execution Timeline ── -->
              <OCard class="tw:p-0 tw:gap-0 tw:flex-1 tw:min-w-0">
                <OCardSection role="header" class="tw:gap-2">
                  <span class="tw:font-bold tw:text-sm tw:text-text-heading"
                    >Steps</span
                  >
                  <OBadge variant="default" size="sm">{{
                    steps.length
                  }}</OBadge>
                  <span class="tw:flex-1" />
                  <OBadge
                    v-if="isFailed"
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
                  class="tw:max-h-[35rem] tw:p-2 tw:overflow-auto"
                >
                  <!-- Steps pass/fail banner -->
                  <div
                    v-if="isFailed"
                    class="tw:flex tw:items-start tw:gap-2 tw:px-3 tw:py-2 tw:mb-2 tw:rounded tw:bg-[var(--color-badge-error-soft-bg)] tw:border tw:border-badge-error-ol-border/30"
                    role="alert"
                    data-test="synthetics-run-detail-steps-failed-banner"
                  >
                    <OIcon
                      name="error"
                      size="sm"
                      class="tw:mt-0.5 tw:text-status-error-text"
                      aria-hidden="true"
                    />
                    <div
                      class="tw:flex tw:flex-col tw:gap-0.5 tw:flex-1 tw:min-w-0"
                    >
                      <span
                        class="tw:text-sm tw:text-status-error-text tw:font-semibold"
                      >
                        Run failed — {{ failedStepLabel || "execution error" }}
                      </span>
                    </div>
                  </div>
                  <div
                    v-else-if="steps.length > 0"
                    class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:mb-2 tw:rounded tw:bg-[var(--color-badge-success-soft-bg)] tw:border tw:border-badge-success-ol-border/50"
                    role="status"
                    data-test="synthetics-run-detail-steps-passed-banner"
                  >
                    <OIcon
                      name="check-circle"
                      size="sm"
                      class="tw:text-[var(--color-timeline-dot-success)]"
                      aria-hidden="true"
                    />
                    <span
                      class="tw:text-sm tw:text-badge-success-ol-text tw:font-semibold"
                    >
                      Run passed — {{ steps.length }}/{{ steps.length }} steps
                      completed successfully
                    </span>
                  </div>
                  <div
                    v-for="st in steps"
                    :key="st.id"
                    class="tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:mb-1"
                    :data-test="`synthetics-run-detail-step-row-${st.id}`"
                  >
                    <!-- Compact row -->
                    <div
                      class="tw:flex tw:items-center tw:gap-1.5 tw:px-2 tw:h-16 tw:min-h-16 tw:rounded"
                      :class="{
                        'tw:border-b tw:border-[var(--o2-border-color)]':
                          isExpanded(st.id),
                      }"
                    >
                      <!-- Screenshot thumbnail 60×40 -->
                      <div
                        class="tw:w-18 tw:h-12 tw:shrink-0 tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:bg-surface-subtle tw:flex tw:items-center tw:justify-center tw:overflow-hidden"
                      >
                        <img
                          v-if="st.screenshotKey"
                          :src="screenshotUrl(st.screenshotKey)"
                          alt="Step screenshot"
                          class="tw:w-full tw:h-full tw:object-cover"
                        />
                        <OIcon
                          v-else
                          name="image"
                          size="xs"
                          class="tw:text-text-caption"
                        />
                      </div>

                      <!-- Step number (colored status circle) -->
                      <span
                        :class="[
                          st.status === 'fail'
                            ? 'tw:w-6 tw:h-6 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:bg-[var(--color-badge-error-soft-bg)] tw:text-[var(--color-badge-error-soft-text)] tw:border tw:border-[var(--color-badge-error-soft-text)] tw:text-xs tw:font-semibold'
                            : 'tw:w-6 tw:h-6 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:bg-[var(--color-badge-success-soft-bg)] tw:text-[var(--color-badge-success-soft-text)] tw:border tw:border-[var(--color-badge-success-soft-text)] tw:text-xs tw:font-semibold',
                        ]"
                      >
                        {{ st.id }}
                      </span>

                      <!-- Action icon -->
                      <span
                        class="tw:bg-[var(--o2-primary-50)] tw:rounded tw:p-1 tw:flex tw:items-center tw:shrink-0"
                      >
                        <OIcon
                          :name="st.icon"
                          size="sm"
                          class="tw:text-[var(--o2-primary-color)]"
                        />
                      </span>

                      <!-- Action label badge -->
                      <OBadge variant="default" size="sm">{{
                        st.action
                      }}</OBadge>

                      <!-- Step name -->
                      <span
                        class="tw:text-sm tw:text-[var(--o2-text-body)] tw:flex-1 tw:truncate tw:min-w-0"
                      >
                        {{ st.name }}
                      </span>

                      <!-- Duration -->
                      <span
                        class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:shrink-0 tw:font-mono tw:tabular-nums"
                      >
                        {{ st.durStr }}
                      </span>

                      <!-- Expand/collapse -->
                      <OButton
                        variant="ghost"
                        size="xs"
                        class="tw:shrink-0"
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

                    <!-- Inline error card for failed steps -->
                    <div
                      v-if="st.status === 'fail' && st.error"
                      class="tw:mx-6 tw:mb-2 tw:border tw:border-badge-error-ol-border/30 tw:rounded-lg tw:overflow-hidden"
                      :data-test="`synthetics-run-detail-step-error-card-${st.id}`"
                    >
                      <div
                        class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:bg-[var(--color-badge-error-soft-bg)]"
                      >
                        <OIcon
                          name="error"
                          size="sm"
                          class="tw:text-[var(--o2-status-error)]"
                          aria-hidden="true"
                        />
                        <span
                          class="tw:text-xs tw:font-semibold tw:text-[var(--o2-text-heading)] tw:flex-1"
                          >Error</span
                        >
                        <span
                          class="tw:text-xs tw:font-mono tw:text-[var(--o2-text-secondary)]"
                          >exit · {{ st.durStr }}</span
                        >
                      </div>
                      <div class="tw:px-3 tw:py-3">
                        <p
                          class="tw:text-[12.5px] tw:text-[var(--o2-text-body)] tw:m-0"
                        >
                          {{ st.error }}
                        </p>
                      </div>
                    </div>

                    <!-- Expanded content -->
                    <div
                      v-if="isExpanded(st.id)"
                      class="tw:flex tw:gap-4 tw:p-3"
                    >
                      <!-- Screenshot preview 280px -->
                      <div class="tw:w-[280px] tw:shrink-0">
                        <div
                          class="tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:overflow-hidden"
                        >
                          <div
                            class="tw:flex tw:items-center tw:gap-1 tw:px-[8px] tw:py-1 tw:bg-surface-subtle tw:border-b tw:border-[var(--o2-border-color)]"
                          >
                            <span
                              class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-[var(--o2-grey-300)]"
                            />
                            <span
                              class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-[var(--o2-grey-300)]"
                            />
                            <span
                              class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-[var(--o2-grey-300)]"
                            />
                            <span
                              class="tw:font-mono tw:text-[10px] tw:text-text-secondary tw:ml-1 tw:truncate"
                              >{{ st.detail }}</span
                            >
                          </div>
                          <div
                            class="tw:aspect-[16/10] tw:flex tw:items-center tw:justify-center tw:overflow-hidden"
                            :class="
                              st.status === 'fail'
                                ? 'tw:bg-[var(--o2-status-error-subtle)]'
                                : 'tw:bg-surface-subtle'
                            "
                          >
                            <img
                              v-if="st.screenshotKey"
                              :src="screenshotUrl(st.screenshotKey)"
                              alt="Step screenshot"
                              class="tw:w-full tw:h-full tw:object-contain"
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
                                    ? 'tw:text-status-error-text'
                                    : 'tw:text-text-caption'
                                "
                                size="lg"
                              />
                              <span
                                class="tw:text-xs tw:font-semibold"
                                :class="
                                  st.status === 'fail'
                                    ? 'tw:text-status-error-text'
                                    : 'tw:text-text-caption'
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

                      <!-- KV metadata + actions -->
                      <div class="tw:flex-1 tw:flex tw:flex-col tw:gap-2">
                        <dl
                          class="tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-3 tw:gap-y-1.5 tw:text-xs"
                        >
                          <dt
                            class="tw:text-[10px] tw:font-semibold tw:text-text-secondary tw:uppercase tw:tracking-wide"
                          >
                            Action
                          </dt>
                          <dd class="tw:text-text-body">{{ st.action }}</dd>
                          <dt
                            class="tw:text-[10px] tw:font-semibold tw:text-text-secondary tw:uppercase tw:tracking-wide"
                          >
                            Selector
                          </dt>
                          <dd class="tw:font-mono tw:text-text-body">
                            {{ st.detail }}
                          </dd>
                          <dt
                            class="tw:text-[10px] tw:font-semibold tw:text-text-secondary tw:uppercase tw:tracking-wide"
                          >
                            URL
                          </dt>
                          <dd
                            class="tw:font-mono tw:truncate tw:text-text-body"
                          >
                            {{ st.detail }}
                          </dd>
                          <dt
                            class="tw:text-[10px] tw:font-semibold tw:text-text-secondary tw:uppercase tw:tracking-wide"
                          >
                            Duration
                          </dt>
                          <dd class="tw:text-text-heading">{{ st.durStr }}</dd>
                        </dl>
                        <div class="tw:flex tw:gap-2 tw:mt-auto">
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
          <div class="tw:h-full tw:flex tw:items-center tw:justify-center">
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
          <div class="tw:h-full tw:flex tw:items-center tw:justify-center">
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
          <div class="tw:h-full tw:flex tw:items-center tw:justify-center">
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

const { t } = useI18n();
const route = useRoute();
const store = useStore();

// ── Route params ──────────────────────────────────────────────────────────
const monitorId = computed(() => String(route.params.id ?? ""));
const runIdParam = computed(() => String(route.params.runId ?? ""));
const executionIdParam = computed(() => String(route.params.executionId ?? ""));

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
      statusIcon: isFail ? "cancel" : "check_circle",
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
  const d = new Date(tsMs);
  return (
    d.toLocaleDateString("en-US", { day: "numeric", month: "short" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) +
    " UTC"
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

function screenshotUrl(key: string | null): string {
  if (!key) return "";
  const orgId = store.state.selectedOrganization.identifier;
  return syntheticsService.artifactUrl(orgId, key);
}

// ── Display model for the current run (mapped from SyntheticRunDetail) ─────
interface DisplayRun {
  id: string;
  monitorName: string;
  status: "pass" | "fail";
  duration: number;
  browser: string;
  device: string;
  location: string;
  timestamp: string;
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
      hasReplay: false,
    };
  }
  const isFail = detail.status === "failed";
  return {
    id: detail.runId,
    monitorName: detail.monitorName,
    status: isFail ? ("fail" as const) : ("pass" as const),
    duration: detail.durationMs,
    browser: capitalizeEngine(detail.browserEngine),
    device: detail.device,
    location: detail.location,
    timestamp: fmtTimestamp(detail.timestamp),
    hasReplay: false,
    ...(isFail
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
const currentRun = computed<DisplayRun>(() => {
  return synthetics.runDetail.value
    ? toDisplayRun(synthetics.runDetail.value)
    : toDisplayRun(null);
});

const isFailed = computed(() => currentRun.value.status === "fail");

const steps = computed<StepRow[]>(() => {
  if (synthetics.runDetail.value) {
    return buildSteps(synthetics.runDetail.value);
  }
  return [];
});

const statusBadgeVariant = computed(() =>
  isFailed.value ? "error" : "success",
);
const statusIcon = computed(() => (isFailed.value ? "cancel" : "check_circle"));
const statusLabel = computed(() => (isFailed.value ? "Failed" : "Passed"));

const errorType = computed(() => currentRun.value.errorType ?? "");
const errorReason = computed(() => currentRun.value.errorReason ?? "");
const errorStack = computed(() => currentRun.value.errorStack ?? "");
const failedStepLabel = computed(() => currentRun.value.failedStepLabel ?? "");

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
  { label: "Timestamp", value: currentRun.value.timestamp, icon: "" },
]);

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
