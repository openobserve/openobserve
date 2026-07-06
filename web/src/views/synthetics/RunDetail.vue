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

      <div class="tw:flex tw:items-center tw:gap-2.5">
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
            :disabled="!hasPrevRun"
            data-test="synthetics-run-detail-prev-btn"
            @click="goToPrevRun"
          />
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="chevron_right"
            :disabled="!hasNextRun"
            data-test="synthetics-run-detail-next-btn"
            @click="goToNextRun"
          />
        </div>
        <span class="tw:flex tw:flex-1" />
        <OButton
          variant="outline"
          size="sm"
          icon-left="open-in-new"
          data-test="synthetics-run-detail-trace-btn"
        >
          View Playwright Trace
        </OButton>
      </div>
    </header>

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
            <div class="tw:flex tw:gap-[0.875rem] tw:items-start">
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
                  class="tw:max-h-[35rem] tw:p-0 tw:overflow-auto"
                >
                  <div
                    v-for="st in steps"
                    :key="st.id"
                    class="tw:rounded tw:border tw:border-separator/70 tw:bg-[var(--o2-card-bg)] tw:mb-1"
                    :class="{
                      'tw:bg-[var(--o2-primary-50)]': st.id === selectedStepId,
                    }"
                  >
                    <!-- Compact row -->
                    <div
                      class="tw:flex tw:items-center tw:gap-2 tw:px-2 tw:h-16 tw:min-h-16 tw:group tw:relative tw:cursor-pointer"
                      :class="{
                        'tw:border-b tw:border-border-default': isExpanded(
                          st.id,
                        ),
                      }"
                      :style="
                        st.status === 'fail' && !isExpanded(st.id)
                          ? {
                              boxShadow:
                                'inset 3px 0 0 var(--o2-status-error-text)',
                            }
                          : {}
                      "
                      :data-test="`synthetics-run-detail-step-row-${st.id}`"
                      @click="selectStep(st.id)"
                    >
                      <OIcon
                        :name="st.statusIcon"
                        :class="
                          st.status === 'fail'
                            ? 'tw:text-badge-error-soft-text'
                            : 'tw:text-badge-success-soft-text'
                        "
                        size="sm"
                      />
                      <span
                        class="tw:w-6 tw:text-center tw:text-sm tw:tabular-nums tw:text-[var(--o2-text-muted)] tw:shrink-0"
                      >
                        {{ st.id }}
                      </span>
                      <!-- Screenshot thumbnail after serial number -->
                      <div
                        class="tw:w-18 tw:h-12 tw:rounded tw:border tw:border-border-default tw:bg-surface-subtle tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:overflow-hidden"
                      >
                        <OIcon
                          :name="
                            st.status === 'fail' ? 'broken_image' : 'image'
                          "
                          size="xs"
                          :class="
                            st.status === 'fail'
                              ? 'tw:text-status-error-text'
                              : 'tw:text-text-caption'
                          "
                        />
                      </div>
                      <!-- Action icon chip -->
                      <span
                        class="tw:bg-[var(--o2-primary-50)] tw:rounded tw:p-1 tw:shrink-0 tw:flex tw:items-center"
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
                      <!-- Step display name -->
                      <span
                        class="tw:text-sm tw:text-[var(--o2-text-body)] tw:flex-1 tw:truncate tw:min-w-0"
                      >
                        {{ st.name }}
                      </span>
                      <span
                        class="tw:font-mono tw:tabular-nums tw:text-xs tw:shrink-0"
                        :class="
                          st.status === 'fail'
                            ? 'tw:text-status-error-text'
                            : 'tw:text-[var(--o2-text-secondary)]'
                        "
                      >
                        {{ st.durStr }}
                      </span>
                      <!-- Expand/collapse -->
                      <OButton
                        variant="ghost"
                        size="xs"
                        :aria-label="
                          isExpanded(st.id) ? 'Collapse step' : 'Expand step'
                        "
                        :data-test="`synthetics-run-detail-step-expand-${st.id}`"
                        @click.stop="toggleExpandStep(st.id)"
                      >
                        <OIcon
                          :name="
                            isExpanded(st.id) ? 'expand-less' : 'expand-more'
                          "
                          size="sm"
                        />
                      </OButton>
                    </div>

                    <!-- Expanded step detail -->
                    <div
                      v-if="isExpanded(st.id)"
                      class="tw:border-t tw:border-border-default"
                    >
                      <div class="tw:grid tw:grid-cols-[280px_1fr]">
                        <div
                          class="tw:p-2.5 tw:border-r tw:border-border-default"
                        >
                          <div
                            class="tw:border tw:border-border-default tw:rounded-lg tw:overflow-hidden"
                          >
                            <div
                              class="tw:aspect-[16/10] tw:flex tw:items-center tw:justify-center tw:flex-col tw:gap-1.5"
                              :class="
                                st.status === 'fail'
                                  ? 'tw:bg-[var(--o2-status-error-subtle)]'
                                  : 'tw:bg-surface-subtle'
                              "
                            >
                              <OIcon
                                :name="
                                  st.status === 'fail'
                                    ? 'broken_image'
                                    : 'image'
                                "
                                size="lg"
                                :class="
                                  st.status === 'fail'
                                    ? 'tw:text-status-error-text'
                                    : 'tw:text-text-caption'
                                "
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
                                    : "Screenshot"
                                }}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div
                          class="tw:p-[0.625rem_0.875rem] tw:flex tw:flex-col tw:gap-2"
                        >
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
                            <dd class="tw:text-text-heading">
                              {{ st.durStr }}
                            </dd>
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
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter, RouterLink } from "vue-router";
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

defineOptions({ name: "SyntheticRunDetail" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

// ── Route params ──────────────────────────────────────────────────────────
const monitorId = computed(() => String(route.params.id ?? ""));
const runIdParam = computed(() => String(route.params.runId ?? "0"));

// ── Seeded random (deterministic mock data) ───────────────────────────────
function seedRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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

// ── Mock run data ─────────────────────────────────────────────────────────
interface MockStep {
  id: number;
  action: string;
  name: string;
  detail: string;
  duration: number;
  status: "pass" | "fail";
}

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

interface MockRun {
  id: number;
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

function fmtDur(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms";
}

function stepsData(isFailed: boolean, seed: number): MockStep[] {
  const r = seedRand(seed);
  const base = [
    {
      id: 1,
      action: "navigate",
      name: "Open homepage",
      detail: "https://shop.example.com/",
      duration: 412,
    },
    {
      id: 2,
      action: "click",
      name: "Open search",
      detail: 'css=[data-testid="search-icon"]',
      duration: 88,
    },
    {
      id: 3,
      action: "type",
      name: "Search query",
      detail: 'css=#search → "wireless headphones"',
      duration: 210,
    },
    {
      id: 4,
      action: "press",
      name: "Submit search",
      detail: "key=Enter",
      duration: 64,
    },
    {
      id: 5,
      action: "navigate",
      name: "Search results",
      detail: "https://shop.example.com/search?q=wireless+headphones",
      duration: 588,
    },
    {
      id: 6,
      action: "assert",
      name: "Results shown",
      detail: 'text="results for"',
      duration: 120,
    },
    {
      id: 7,
      action: "click",
      name: "Open first product",
      detail: "testid=result-0",
      duration: 96,
    },
    {
      id: 8,
      action: "navigate",
      name: "Product page",
      detail: "https://shop.example.com/p/1042",
      duration: 441,
    },
    {
      id: 9,
      action: "click",
      name: "Add to cart",
      detail: "css=.btn-add-to-cart",
      duration: 132,
    },
    {
      id: 10,
      action: "click",
      name: "Go to checkout",
      detail: "css=.btn-checkout",
      duration: 104,
    },
    {
      id: 11,
      action: "type",
      name: "Fill card number",
      detail: 'css=#card-number → "4242 4242 4242 4242"',
      duration: 180,
    },
    {
      id: 12,
      action: "click",
      name: "Place order",
      detail: "testid=place-order-btn",
      duration: isFailed ? 30000 : 214,
    },
  ];
  const result: MockStep[] = base.map((s) => ({
    ...s,
    status: isFailed && s.id === 12 ? ("fail" as const) : ("pass" as const),
    duration: s.duration + Math.round((r() - 0.5) * s.duration * 0.3),
  }));
  if (!isFailed) {
    result.push({
      id: 13,
      action: "assert",
      name: "Order confirmed",
      detail: 'text="Order #"',
      duration: 96 + Math.round((r() - 0.5) * 30),
      status: "pass" as const,
    });
  }
  return result;
}

function generateRuns(): MockRun[] {
  const r = seedRand(88);
  const locations = ["us-east-1", "eu-west-1", "ap-south-1"];
  const browsers = ["Chrome 124", "Firefox 125", "WebKit"];
  const devices = [
    "Linux · Desktop 1440×900",
    "Mac · Desktop 1920×1080",
    "Windows · Desktop 1366×768",
  ];
  const hours = ["14:", "15:", "16:", "11:", "09:", "08:"];
  const days = ["Jul 3", "Jul 3", "Jul 3", "Jul 2", "Jul 2", "Jul 1"];
  const runs: MockRun[] = [];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const idNum = 4828 - i;
    const isFail = (i >= 8 && i <= 10) || i === 3;
    const dur = isFail
      ? Math.round(28000 + r() * 12000)
      : Math.round(2200 + r() * 3800);
    const dayIdx = Math.floor(r() * days.length);
    const hourIdx = Math.floor(r() * hours.length);
    const min = Math.floor(r() * 60)
      .toString()
      .padStart(2, "0");
    const hasReplay = i <= 6;

    runs.push({
      id: idNum,
      monitorName: "Checkout Smoke Test",
      status: isFail ? ("fail" as const) : ("pass" as const),
      duration: dur,
      browser: browsers[Math.floor(r() * browsers.length)],
      device: devices[Math.floor(r() * devices.length)],
      location: locations[Math.floor(r() * locations.length)],
      timestamp: days[dayIdx] + " " + hours[hourIdx] + min + " UTC",
      hasReplay,
      ...(isFail
        ? {
            errorType: "Selector not found",
            errorReason:
              "No element matched this selector. After waiting the full 30.0s timeout, 0 elements were found. The checkout form may still be validating card details, or the place-order button's test id changed after a recent release.",
            errorStack:
              'TimeoutError: waiting for selector `[data-testid="place-order-btn"]` failed: timeout 30000ms exceeded\n    at ElementHandle.waitForSelector (page.ts:412)\n    at Runner.step (runner.ts:88)\n    at Runner.run (runner.ts:53)',
            failedStepLabel: "Step 12 · Place order",
            failedStepId: 12,
          }
        : {}),
    });
  }
  return runs;
}

// ── State ─────────────────────────────────────────────────────────────────
const activeTab = ref("summary");
const allRuns = computed(() => generateRuns());

const currentRunIndex = computed(() => {
  const id = parseInt(runIdParam.value, 10);
  const idx = allRuns.value.findIndex((r) => r.id === id);
  return idx >= 0 ? idx : 0;
});

const currentRun = computed(
  () => allRuns.value[currentRunIndex.value] ?? allRuns.value[0],
);

const hasPrevRun = computed(() => currentRunIndex.value > 0);
const hasNextRun = computed(
  () => currentRunIndex.value < allRuns.value.length - 1,
);

const isFailed = computed(() => currentRun.value.status === "fail");

const steps = computed<StepRow[]>(() => {
  const raw = stepsData(isFailed.value, currentRun.value.id);
  return raw.map((st) => ({
    ...st,
    icon: actionIcon(st.action),
    statusIcon: st.status === "fail" ? "cancel" : "check-circle",
    durStr: fmtDur(st.duration),
    durColor:
      st.status === "fail"
        ? "var(--o2-status-error-text)"
        : "var(--o2-text-secondary)",
  }));
});

const selectedStepId = ref(steps.value[steps.value.length - 1]?.id ?? 1);

const selectedStep = computed<StepRow>(() => {
  return (
    steps.value.find((s) => s.id === selectedStepId.value) ??
    steps.value[steps.value.length - 1]
  );
});

const stackOpen = ref(false);
const expandedStepIds = ref(new Set<number>());

function isExpanded(id: number): boolean {
  return expandedStepIds.value.has(id);
}

function toggleExpandStep(id: number) {
  const next = new Set(expandedStepIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedStepIds.value = next;
}

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
  { label: "Duration", value: fmtDur(currentRun.value.duration) },
  { label: "Browser", value: currentRun.value.browser },
  { label: "Device", value: currentRun.value.device },
  { label: "Region", value: "AWS · " + currentRun.value.location },
  { label: "Timestamp", value: currentRun.value.timestamp },
]);

const replayDuration = computed(() => (isFailed.value ? "0:38" : "0:14"));

const scrubberPct = computed(() => (isFailed.value ? "38%" : "60%"));

// ── Navigation ────────────────────────────────────────────────────────────
function goToPrevRun() {
  if (!hasPrevRun.value) return;
  const prev = allRuns.value[currentRunIndex.value - 1];
  router.push({
    name: "synthetic-run-detail",
    params: { id: monitorId.value, runId: String(prev.id) },
  });
  selectedStepId.value = steps.value[steps.value.length - 1]?.id ?? 1;
  stackOpen.value = false;
}

function goToNextRun() {
  if (!hasNextRun.value) return;
  const next = allRuns.value[currentRunIndex.value + 1];
  router.push({
    name: "synthetic-run-detail",
    params: { id: monitorId.value, runId: String(next.id) },
  });
  selectedStepId.value = steps.value[steps.value.length - 1]?.id ?? 1;
  stackOpen.value = false;
}

function selectStep(id: number) {
  selectedStepId.value = id;
}

function toggleStack() {
  stackOpen.value = !stackOpen.value;
}
</script>
