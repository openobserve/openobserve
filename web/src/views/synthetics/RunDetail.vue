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
    <header
      class="tw:flex tw:items-center tw:gap-3 tw:px-5 tw:py-[0.625rem] tw:border-b tw:border-border-default tw:shrink-0"
    >
      <RouterLink
        :to="{ name: 'synthetic-monitor-results', params: { id: monitorId } }"
        class="tw:w-[30px] tw:h-[30px] tw:rounded-md tw:border tw:border-border-default tw:flex tw:items-center tw:justify-center tw:hover:bg-surface-subtle tw:no-underline"
        data-test="synthetics-run-detail-back-btn"
      >
        <OIcon name="arrow_back" size="sm" class="tw:text-text-secondary" />
      </RouterLink>

      <div class="tw:flex tw:items-center tw:gap-2.5 tw:flex-1 tw:min-w-0">
        <h1
          class="tw:text-lg tw:font-bold tw:text-text-heading tw:m-0"
          data-test="synthetics-run-detail-title"
        >
          Run #{{ currentRun.id }}
        </h1>
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
        <span class="tw:flex-1" />
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
      </div>
    </header>

    <!-- ════════ SUB TABS ════════ -->
    <OTabs
      v-model="activeTab"
      class="tw:shrink-0 tw:px-5 tw:border-b tw:border-border-default"
    >
      <OTab
        name="summary"
        data-test="synthetics-run-detail-tab-summary"
      >
        <span class="tw:flex tw:items-center tw:gap-1.5">
          <OIcon name="summarize" size="sm" />
          Summary
        </span>
      </OTab>
      <OTab
        name="logs"
        data-test="synthetics-run-detail-tab-logs"
      >
        <span class="tw:flex tw:items-center tw:gap-1.5">
          <OIcon name="search" size="sm" />
          Logs
        </span>
      </OTab>
      <OTab
        name="traces"
        data-test="synthetics-run-detail-tab-traces"
      >
        <span class="tw:flex tw:items-center tw:gap-1.5">
          <OIcon name="account_tree" size="sm" />
          Traces
        </span>
      </OTab>
      <OTab
        name="rum"
        data-test="synthetics-run-detail-tab-rum"
      >
        <span class="tw:flex tw:items-center tw:gap-1.5">
          <OIcon name="devices" size="sm" />
          RUM
        </span>
      </OTab>
    </OTabs>

    <div class="tw:flex-1 tw:min-h-0">
      <OTabPanels v-model="activeTab" grow scroll="y" class="tw:h-full tw:min-h-0">
        <!-- ════════════ SUMMARY ════════════ -->
        <OTabPanel name="summary" data-test="synthetics-run-detail-summary-tab">
          <div
            class="tw:max-w-[85rem] tw:mx-auto tw:px-5 tw:py-[0.875rem] tw:pb-[1.75rem] tw:flex tw:flex-col tw:gap-[0.875rem]"
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
                  >{{ errorStack }}</pre>
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
                  class="tw:text-[10px] tw:font-semibold tw:text-text-secondary tw:uppercase tw:tracking-wide"
                >
                  {{ chip.label }}
                </span>
                <span
                  class="tw:font-mono tw:tabular-nums tw:text-[13px] tw:font-bold tw:text-text-heading"
                >
                  {{ chip.value }}
                </span>
              </div>
            </div>

            <!-- ══ Split: Replay Player (left) + Steps Timeline (right) ══ -->
            <div
              class="tw:flex tw:gap-[0.875rem] tw:items-start"
            >
              <!-- ── Left: Session Replay Player ── -->
              <OCard class="tw:p-0 tw:gap-0 tw:w-[30%] tw:min-w-[30rem]">
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
                    v-if="currentRun.hasReplay"
                    class="tw:font-mono tw:text-[11px] tw:text-text-secondary"
                  >
                    Step {{ selectedStep.id }} of {{ steps.length }}
                  </span>
                </OCardSection>
                <OSeparator />

                <template v-if="currentRun.hasReplay">
                  <div class="tw:h-[380px] tw:flex tw:flex-col">
                    <div class="tw:flex-1 tw:min-h-0">
                      <VideoPlayer
                        :events="[]"
                        :segments="[]"
                        :is-loading="false"
                      />
                    </div>
                  </div>
                </template>

                <!-- No replay state -->
                <template v-else>
                  <div
                    class="tw:py-10 tw:flex tw:flex-col tw:items-center tw:gap-2.5"
                  >
                    <OIcon
                      name="videocam_off"
                      size="lg"
                      class="tw:text-text-caption"
                    />
                    <span
                      class="tw:text-sm tw:font-semibold tw:text-text-heading"
                    >
                      No session replay captured
                    </span>
                    <span class="tw:text-xs tw:text-text-secondary">
                      Enable session replay in Configure &rarr; RUM &amp;
                      Session Replay.
                    </span>
                  </div>
                </template>
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
                  <div
                    v-for="st in steps"
                    :key="st.id"
                    class="tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:mb-1"
                    :data-test="`synthetics-run-detail-step-row-${st.id}`"
                  >
                    <!-- Compact row -->
                    <div
                      class="tw:flex tw:items-center tw:gap-1.5 tw:px-2 tw:h-9 tw:min-h-9 tw:rounded"
                      :class="{ 'tw:border-b tw:border-[var(--o2-border-color)]': isExpanded(st.id) }"
                    >
                      <!-- Screenshot thumbnail 60×40 -->
                      <div
                        class="tw:w-[60px] tw:h-[40px] tw:shrink-0 tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:bg-surface-subtle tw:flex tw:items-center tw:justify-center tw:overflow-hidden"
                      >
                        <OIcon name="image" size="xs" class="tw:text-text-caption" />
                      </div>

                      <!-- Step number -->
                      <span
                        class="tw:w-6 tw:text-center tw:text-sm tw:font-bold tw:tabular-nums tw:text-[var(--o2-text-muted)] tw:shrink-0"
                      >
                        {{ st.id }}
                      </span>

                      <!-- Action icon -->
                      <span
                        class="tw:bg-[var(--o2-primary-50)] tw:rounded tw:p-1 tw:flex tw:items-center tw:shrink-0"
                      >
                        <OIcon :name="st.icon" size="sm" class="tw:text-[var(--o2-primary-color)]" />
                      </span>

                      <!-- Action label badge -->
                      <OBadge variant="default" size="sm">{{ st.action }}</OBadge>

                      <!-- Step name -->
                      <span class="tw:text-sm tw:text-[var(--o2-text-body)] tw:flex-1 tw:truncate tw:min-w-0">
                        {{ st.name }}
                      </span>

                      <!-- Duration -->
                      <span class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:shrink-0 tw:font-mono tw:tabular-nums">
                        {{ st.durStr }}
                      </span>

                      <!-- Error marker for failed steps -->
                      <OIcon
                        v-if="st.status === 'fail'"
                        name="error"
                        size="sm"
                        class="tw:text-status-error-text tw:shrink-0"
                      />

                      <!-- Expand/collapse -->
                      <OButton
                        variant="ghost"
                        size="xs"
                        class="tw:shrink-0"
                        :data-test="`synthetics-run-detail-step-expand-${st.id}`"
                        @click="toggleExpand(st.id)"
                      >
                        <OIcon
                          :name="isExpanded(st.id) ? 'expand-less' : 'expand-more'"
                          size="sm"
                        />
                      </OButton>
                    </div>

                    <!-- Expanded content -->
                    <div
                      v-if="isExpanded(st.id)"
                      class="tw:flex tw:gap-4 tw:p-3"
                    >
                      <!-- Screenshot preview 280px -->
                      <div class="tw:w-[280px] tw:shrink-0">
                        <div class="tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:overflow-hidden">
                          <div
                            class="tw:flex tw:items-center tw:gap-1 tw:px-[8px] tw:py-1 tw:bg-surface-subtle tw:border-b tw:border-[var(--o2-border-color)]"
                          >
                            <span class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-[var(--o2-grey-300)]" />
                            <span class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-[var(--o2-grey-300)]" />
                            <span class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-[var(--o2-grey-300)]" />
                            <span
                              class="tw:font-mono tw:text-[10px] tw:text-text-secondary tw:ml-1 tw:truncate"
                            >{{ st.detail }}</span>
                          </div>
                          <div
                            class="tw:aspect-[16/10] tw:flex tw:items-center tw:justify-center tw:flex-col tw:gap-1"
                            :class="st.status === 'fail' ? 'tw:bg-[var(--o2-status-error-subtle)]' : 'tw:bg-surface-subtle'"
                          >
                            <OIcon
                              :name="st.status === 'fail' ? 'broken_image' : 'image'"
                              :class="st.status === 'fail' ? 'tw:text-status-error-text' : 'tw:text-text-caption'"
                              size="lg"
                            />
                            <span
                              class="tw:text-xs tw:font-semibold"
                              :class="st.status === 'fail' ? 'tw:text-status-error-text' : 'tw:text-text-caption'"
                            >
                              {{ st.status === 'fail' ? 'Failure screenshot' : 'Screenshot placeholder' }}
                            </span>
                          </div>
                        </div>
                      </div>

                      <!-- KV metadata + actions -->
                      <div class="tw:flex-1 tw:flex tw:flex-col tw:gap-2">
                        <dl class="tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-3 tw:gap-y-1.5 tw:text-xs">
                          <dt
                            class="tw:text-[10px] tw:font-semibold tw:text-text-secondary tw:uppercase tw:tracking-wide"
                          >Action</dt>
                          <dd class="tw:text-text-body">{{ st.action }}</dd>
                          <dt
                            class="tw:text-[10px] tw:font-semibold tw:text-text-secondary tw:uppercase tw:tracking-wide"
                          >Selector</dt>
                          <dd class="tw:font-mono tw:text-text-body">{{ st.detail }}</dd>
                          <dt
                            class="tw:text-[10px] tw:font-semibold tw:text-text-secondary tw:uppercase tw:tracking-wide"
                          >URL</dt>
                          <dd class="tw:font-mono tw:truncate tw:text-text-body">{{ st.detail }}</dd>
                          <dt
                            class="tw:text-[10px] tw:font-semibold tw:text-text-secondary tw:uppercase tw:tracking-wide"
                          >Duration</dt>
                          <dd class="tw:text-text-heading">{{ st.durStr }}</dd>
                          <template v-if="st.status === 'fail'">
                            <dt
                              class="tw:text-[10px] tw:font-semibold tw:text-text-secondary tw:uppercase tw:tracking-wide"
                            >Error</dt>
                            <dd class="tw:text-status-error-text">{{ st.detail }}</dd>
                          </template>
                        </dl>
                        <div class="tw:flex tw:gap-2 tw:mt-auto">
                          <OButton
                            variant="outline"
                            size="sm"
                            icon-left="open_in_new"
                            data-test="synthetics-run-detail-trace-viewer-btn"
                          >
                            Open in Trace Viewer
                          </OButton>
                          <OButton
                            variant="ghost"
                            size="sm"
                            icon-left="download"
                            data-test="synthetics-run-detail-download-step-btn"
                          />
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
          <div
            class="tw:h-full tw:flex tw:items-center tw:justify-center"
          >
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
          <div
            class="tw:h-full tw:flex tw:items-center tw:justify-center"
          >
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
          <div
            class="tw:h-full tw:flex tw:items-center tw:justify-center"
          >
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
import { useRoute, RouterLink } from "vue-router";
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
import useSyntheticResults from "@/composables/useSyntheticResults";
import type { SyntheticRunDetail, RecordedStep, StepExecution } from "@/composables/synthetics/syntheticResultsSchema";

defineOptions({ name: "SyntheticRunDetail" });

const { t } = useI18n();
const route = useRoute();

// ── Route params ──────────────────────────────────────────────────────────
const monitorId = computed(() => String(route.params.id ?? ""));
const runIdParam = computed(() => String(route.params.runId ?? ""));

// ── Composable ─────────────────────────────────────────────────────────────
const synthetics = useSyntheticResults();

// ── Action icon map ────────────────────────────────────────────────────────
const ACTION_META: Record<string, string> = {
  navigate: "open_in_browser",
  click: "ads_click",
  type: "keyboard",
  select: "checklist",
  press: "keyboard_command_key",
  hover: "point_scan",
  scroll: "swipe_vertical",
  wait: "hourglass_empty",
  assert: "fact_check",
  screenshot: "photo_camera",
};

function actionIcon(action: string): string {
  return ACTION_META[action] || "ads_click";
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
}

function fmtDur(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms";
}

/** Merge recorded_step definitions with last_attempt_step execution results. */
function buildSteps(detail: SyntheticRunDetail | null): StepRow[] {
  if (!detail || !detail.recordedSteps.length) return [];
  const execMap = new Map<string, StepExecution>();
  for (const ex of detail.lastAttemptSteps) {
    execMap.set(ex.stepId, ex);
  }
  return detail.recordedSteps.map((rs, idx) => {
    const exec = execMap.get(rs.id);
    const isFail = exec?.status === "fail";
    return {
      id: idx + 1,
      action: rs.action,
      name: rs.name || rs.action,
      detail: rs.selector || rs.url || rs.action,
      duration: exec?.durationMs ?? 0,
      status: isFail ? ("fail" as const) : ("pass" as const),
      icon: actionIcon(rs.action),
      statusIcon: isFail ? "cancel" : "check_circle",
      durStr: fmtDur(exec?.durationMs ?? 0),
      durColor: isFail
        ? "var(--o2-status-error-text)"
        : "var(--o2-text-secondary)",
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
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) +
    " UTC"
  );
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
    timestamp: fmtTimestamp(detail.timestamp * 1000),
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

const statusBadgeVariant = computed(() => (isFailed.value ? "error" : "success"));
const statusIcon = computed(() => (isFailed.value ? "cancel" : "check_circle"));
const statusLabel = computed(() => (isFailed.value ? "Failed" : "Passed"));

const errorType = computed(() => currentRun.value.errorType ?? "");
const errorReason = computed(() => currentRun.value.errorReason ?? "");
const errorStack = computed(() => currentRun.value.errorStack ?? "");
const failedStepLabel = computed(() => currentRun.value.failedStepLabel ?? "");

const infoChips = computed(() => [
  { label: "Duration", value: fmtDur(currentRun.value.duration) },
  { label: "Browser", value: currentRun.value.browser },
  { label: "Device", value: currentRun.value.device },
  { label: "Region", value: "AWS " + currentRun.value.location },
  { label: "Timestamp", value: currentRun.value.timestamp },
]);

// ── Fetch data on mount / route change ────────────────────────────────────
async function loadRun() {
  if (!runIdParam.value) return;
  const endTime = Date.now() * 1000; // µs
  const startTime = endTime - 30 * 24 * 3600 * 1000 * 1000; // 30 days
  await synthetics.fetchRun(
    monitorId.value,
    runIdParam.value,
    startTime,
    endTime,
  );
}

watch(
  () => runIdParam.value,
  (newVal) => {
    if (newVal) {
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
