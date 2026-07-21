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
  <!-- Protocol runs (http/tcp/tls/ssh) have no steps/replay — dedicated view -->
  <ProtocolRunSummary
    v-if="monitorType && monitorType !== 'browser'"
    :monitor-id="monitorId"
    :run-id="runIdParam"
    :execution-id="executionIdParam"
    :drawer-mode="drawerMode"
    @update-status="emit('update-status', $event)"
  />
  <OPageLayout
    v-else
    class="run-detail"
    data-test="synthetics-run-detail"
    bleed
  >
    <!-- ════════ HEADER ════════ -->
    <template #header v-if="!drawerMode">
    <OPageHeader
      class=""
      :subtitle="currentRun.timestamp"
      :back="{
        label: t('synthetics.results.monitors'),
        to: { name: 'synthetic-monitor-results', params: { id: monitorId } },
        dataTest: 'synthetics-run-detail-back-btn',
      }"
    >
      <template #title>
        <span data-test="synthetics-run-detail-title">{{ displayMonitorName }}</span>
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
          class="truncate max-w-50"
          data-test="synthetics-run-detail-url-badge"
        >
          {{ currentRun.url }}
        </OBadge>
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
          {{ t('synthetics.runDetail.openTrace') }}
        </OButton>
        <OButton
          variant="outline"
          size="sm"
          icon-left="replay"
          data-test="synthetics-run-detail-rerun-btn"
        >
          {{ t('synthetics.journey.reRun') }}
        </OButton>
      </template>
    </OPageHeader>
    </template>

    <!-- ════════ SUB TABS ════════ -->
    <OTabs
      v-model="activeTab"
      class="shrink-0 px-page-edge border-b border-border-default"
    >
      <OTab name="summary" data-test="synthetics-run-detail-tab-summary">
        <span class="flex items-center gap-1.5">
          <OIcon name="article" size="sm" />
          {{ t('synthetics.runDetail.tabSummary') }}
        </span>
      </OTab>
      <OTab name="logs" data-test="synthetics-run-detail-tab-logs">
        <span class="flex items-center gap-1.5">
          <OIcon name="search" size="sm" />
          {{ t('synthetics.runDetail.tabLogs') }}
        </span>
      </OTab>
      <OTab name="traces" data-test="synthetics-run-detail-tab-traces">
        <span class="flex items-center gap-1.5">
          <OIcon name="account-tree" size="sm" />
          {{ t('synthetics.runDetail.tabTraces') }}
        </span>
      </OTab>
      <OTab name="rum" data-test="synthetics-run-detail-tab-rum">
        <span class="flex items-center gap-1.5">
          <OIcon name="devices" size="sm" />
          {{ t('synthetics.runDetail.tabRum') }}
        </span>
      </OTab>
    </OTabs>

    <div class="flex-1 min-h-0">
      <OTabPanels v-model="activeTab" grow scroll="y" class="h-full min-h-0">
        <!-- ════════════ SUMMARY ════════════ -->
        <OTabPanel name="summary" data-test="synthetics-run-detail-summary-tab">
          <div
            class="py-3.5 pb-7 flex flex-col"
          >
            <!-- Info chips skeleton -->
            <template v-if="loading">
              <div
                class="grid grid-cols-5 gap-2.5 px-2"
                data-test="synthetics-run-detail-info-skeleton"
              >
                <div
                  v-for="i in 5"
                  :key="i"
                  class="card-container rounded-default flex flex-row items-center px-3.5 py-2.5 gap-1.5 bg-surface-base border border-border-default"
                >
                  <OSkeleton type="circle" class="h-4 w-4 shrink-0" />
                  <OSkeleton type="text" class="h-4 w-20" />
                </div>
              </div>
            </template>
            <!-- Info chips -->
            <template v-else>
              <div
                class="grid grid-cols-5 gap-2.5 px-2"
                data-test="synthetics-run-detail-info-bar"
              >
                <div
                  v-for="chip in infoChips"
                  :key="chip.label"
                  class="card-container rounded-default flex flex-row items-center px-3.5 py-2.5 gap-1.5 bg-surface-base border border-border-default"
                >
                  <OIcon
                    v-if="chip.icon"
                    :name="chip.icon"
                    size="sm"
                    class="shrink-0"
                    :class="chip.colorClass ? chip.colorClass : ''"
                  />
                  <span
                    class="text-sm leading-none truncate"
                    :class="chip.colorClass || 'text-text-body'"
                  >
                    {{ chip.value }}
                  </span>
                </div>
              </div>
            </template>

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
                    class="flex items-center gap-2 rounded-default border border-border-default p-2"
                  >
                    <OSkeleton type="rect" class="h-12 w-18 shrink-0 rounded-default" />
                    <OSkeleton type="circle" class="h-6 w-6 shrink-0" />
                    <OSkeleton type="text" class="h-4 flex-1" />
                    <OSkeleton type="text" class="h-4 w-16 shrink-0" />
                  </div>
                </OCardSection>
              </OCard>
            </template>
            <!-- Lambda execution error (no steps) -->
            <div
              v-else-if="isErrorRun"
              class="bg-[var(--color-badge-error-soft-bg)] border border-badge-error-ol-border/30 rounded-default overflow-hidden m-2"
              role="alert"
              data-test="synthetics-run-detail-steps-error-banner"
            >
              <div class="flex items-start gap-2 p-3">
                <OIcon
                  name="error"
                  class="text-status-error-text shrink-0"
                  size="md"
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-bold text-status-error-text">
                      {{ currentRun.errorType }}
                    </span>
                  </div>
                  <OButton
                    v-if="currentRun.errorStack"
                    variant="ghost-destructive"
                    size="xs"
                    class="mt-1"
                    data-test="synthetics-run-detail-error-expand-btn"
                    @click="stackOpen = !stackOpen"
                  >
                    <template #icon-left>
                      <OIcon
                        name="expand-more"
                        size="xs"
                        class="transition-transform duration-150"
                        :class="{ 'rotate-180': stackOpen }"
                      />
                    </template>
                    <span class="text-2xs font-semibold text-status-error-text">
                      {{ t('synthetics.runDetail.viewFullError') }}
                    </span>
                  </OButton>
                  <pre
                    v-if="stackOpen && currentRun.errorStack"
                    class="mt-2 text-2xs leading-[1.6] text-text-body bg-code-bg rounded-default p-[10px_12px] overflow-auto whitespace-pre-wrap font-mono"
                    data-test="synthetics-run-detail-error-stack"
                  >{{ currentRun.errorStack }}</pre>
                </div>
              </div>
            </div>

            <!-- ══ Split: Replay Player (left) + Steps Timeline (right) ══ -->
            <div v-else-if="steps.length > 0" class="flex items-start">
              <!-- ── Left: Session Replay Player ── -->
              <OCard
                v-if="currentRun.hasReplay"
                class="p-0 gap-0 w-[30%] min-w-[30rem]"
              >
                <OCardSection role="header" class="gap-2">
                  <OIcon
                    name="smart_display"
                    size="sm"
                    class="text-accent"
                  />
                  <span class="font-bold text-sm text-text-heading"
                    >{{ t('synthetics.runDetail.sessionReplay') }}</span
                  >
                  <span class="flex-1" />
                  <span class="font-mono text-2xs text-text-secondary">
                    {{ t('synthetics.runDetail.stepOf', { selected: selectedStep.id, total: steps.length }) }}
                  </span>
                </OCardSection>
                <OSeparator />

                <div class="h-95 flex flex-col">
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
              <div class="flex-1 min-w-0 flex flex-col">
                <div class="flex items-center gap-2 px-3 py-4">
                  <h4 class="font-bold text-sm text-text-heading m-0">{{ t('synthetics.journey.steps') }}</h4>
                  <OBadge variant="default" size="sm">{{ steps.length }}</OBadge>
                  <span class="flex-1" />
                </div>

                <div class="flex-1 min-h-0 overflow-auto pb-2">
                  <!-- JourneySteps in results mode -->
                  <JourneySteps
                    :data="stepsWithTotal"
                    mode="results"
                    action-key="action"
                    name-key="name"
                    detail-key="detail"
                    icon-key="icon"
                    :dot-state-fn="stepDotState"
                    :expanded-ids="expandedStepIdsArr"
                    @update:expanded-ids="handleUpdateExpanded"
                  >
                    <!-- Screenshot thumbnail -->
                    <template #screenshot-thumb="{ row }">
                      <img
                        v-if="row.screenshotKey"
                        :src="screenshotUrl(row.screenshotKey)"
                        :alt="t('synthetics.runDetail.screenshotAlt')"
                        class="w-full h-full object-cover"
                      />
                      <OIcon
                        v-else
                        name="image"
                        size="xs"
                        class="text-text-secondary"
                      />
                    </template>

                    <!-- Expanded content: screenshot + metadata + error -->
                    <template #expansion="{ row }">
                      <div class="flex gap-4 p-3">
                        <div class="w-[40%] shrink-0">
                          <div class="rounded-default border border-border-default overflow-hidden">
                            <div
                              class="aspect-[16/10] flex items-center justify-center overflow-hidden"
                              :class="row.status === 'fail' ? 'bg-status-error-bg' : 'bg-surface-subtle'"
                            >
                              <div
                                v-if="row.screenshotKey"
                                class="relative w-full h-full group"
                              >
                                <OButton
                                  variant="ghost"
                                  size="sm"
                                  class="w-full h-full! p-0! rounded-none! border-0!"
                                  data-test="synthetics-run-detail-step-screenshot-thumb"
                                  @click="openLightbox(row.id)"
                                >
                                  <img
                                    :src="screenshotUrl(row.screenshotKey)"
                                    :alt="t('synthetics.runDetail.screenshotAlt')"
                                    class="w-full h-full object-contain transition-opacity group-hover:opacity-90"
                                  />
                                </OButton>
                                <div
                                  class="absolute top-2 right-2 flex items-center justify-center w-7 h-7 rounded-default bg-surface-base/80 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                                  aria-hidden="true"
                                >
                                  <OIcon name="fullscreen" size="sm" class="text-text-body" />
                                </div>
                              </div>
                              <template v-else>
                                <OIcon name="image" :class="row.status === 'fail' ? 'text-status-error-text' : 'text-text-secondary'" size="lg" />
                                <span class="text-xs font-semibold" :class="row.status === 'fail' ? 'text-status-error-text' : 'text-text-secondary'">
                                  {{ row.status === 'fail' ? t('synthetics.runDetail.failureScreenshot') : t('synthetics.runDetail.screenshotPlaceholder') }}
                                </span>
                              </template>
                            </div>
                          </div>
                        </div>

                        <div class="flex-1 flex flex-col gap-4">
                          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                            <dt class="text-sm font-semibold text-text-secondary capitalize tracking-wide">{{ t('synthetics.runDetail.detailAction') }}</dt>
                            <dd class="text-text-secondary">{{ row.action }}</dd>
                            <dt class="text-sm font-semibold text-text-secondary capitalize tracking-wide">{{ t('synthetics.runDetail.detailSelector') }}</dt>
                            <dd class="text-text-secondary">{{ row.detail }}</dd>
                            <dt class="text-sm font-semibold text-text-secondary capitalize tracking-wide">{{ t('synthetics.runDetail.detailUrl') }}</dt>
                            <dd class="truncate text-text-secondary">{{ row.detail }}</dd>
                            <dt class="text-sm font-semibold text-text-secondary capitalize tracking-wide">{{ t('synthetics.results.duration') }}</dt>
                            <dd class="text-text-secondary">{{ row.durStr }}</dd>
                          </dl>

                          <div
                            v-if="row.status === 'fail' && row.error"
                            class="rounded-default border border-badge-error-ol-border/30 overflow-hidden"
                            :data-test="`synthetics-run-detail-step-error-card-${row.id}`"
                          >
                            <div class="flex items-center gap-2 px-3 py-2 bg-[var(--color-badge-error-soft-bg)]">
                              <OIcon name="error" size="sm" class="text-status-error-text" aria-hidden="true" />
                              <span class="text-xs font-semibold text-text-heading flex-1">{{ t('synthetics.results.error') }}</span>
                            </div>
                            <div class="px-3 py-3">
                              <pre
                                class="text-xs text-text-body m-0 whitespace-pre-wrap font-mono leading-relaxed"
                                :class="{ 'max-h-24 overflow-hidden': !expandedStepErrors.has(row.id) && (row.error?.length ?? 0) > 200 }"
                              >{{ row.error }}</pre>
                              <div class="flex items-center gap-2 mt-1.5">
                                <OButton
                                  v-if="(row.error?.length ?? 0) > 200"
                                  variant="ghost"
                                  size="xs"
                                  class="text-xs font-semibold text-text-link"
                                  data-test="synthetics-run-detail-toggle-step-error-btn"
                                  @click="toggleStepError(row.id)"
                                >
                                  {{ expandedStepErrors.has(row.id) ? t('synthetics.runDetail.showLess') : t('synthetics.runDetail.showFullError') }}
                                </OButton>
                                <OButton
                                  variant="ghost"
                                  size="xs"
                                  data-test="synthetics-run-detail-step-view-error-btn"
                                  @click="openErrorFullscreen(row.id)"
                                >
                                  {{ t('synthetics.runDetail.viewFullErrorBtn') }}
                                </OButton>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </template>
                  </JourneySteps>
                </div>
              </div>
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
                <span>{{ t('synthetics.runDetail.noCorrelatedLogs') }}</span>
              </template>
              <template #description>
                <span>{{ t('synthetics.runDetail.noCorrelatedLogsDesc') }}</span>
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
                <span>{{ t('synthetics.runDetail.noCorrelatedTraces') }}</span>
              </template>
              <template #description>
                <span>{{ t('synthetics.runDetail.noCorrelatedTracesDesc') }}</span>
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
                <span>{{ t('synthetics.runDetail.noCorrelatedRum') }}</span>
              </template>
              <template #description>
                <span>{{ t('synthetics.runDetail.noCorrelatedRumDesc') }}</span>
              </template>
            </OEmptyState>
          </div>
        </OTabPanel>
      </OTabPanels>
    </div>
  </OPageLayout>

  <!-- ════════════ Screenshot Lightbox ════════════ -->
  <ODialog
    v-model:open="lightboxOpen"
    size="full"
    :title="lightboxTitle"
    data-test="synthetics-run-detail-step-screenshot-lightbox"
  >
    <div
      v-if="lightboxStep"
      class="flex items-center justify-center h-full p-6"
      :class="
        lightboxStep.status === 'fail'
          ? 'bg-status-error-bg'
          : 'bg-surface-subtle'
      "
    >
      <img
        v-if="lightboxStep.screenshotKey"
        :src="screenshotUrl(lightboxStep.screenshotKey)"
        :alt="t('synthetics.runDetail.screenshotAlt')"
        class="max-w-full max-h-[85vh] object-contain"
      />
    </div>
  </ODialog>

  <!-- ════════════ Error Fullscreen ════════════ -->
  <ODialog
    v-model:open="errorOpen"
    size="full"
    :title="errorTitle"
    data-test="synthetics-run-detail-step-error-fullscreen"
  >
    <div
      v-if="errorStep"
      class="flex flex-col h-full overflow-y-auto p-6"
    >
      <div class="rounded-default border border-badge-error-ol-border/30 overflow-hidden">
        <div
          class="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-badge-error-soft-bg)]"
        >
          <OIcon
            name="error"
            size="sm"
            class="text-status-error-text"
            aria-hidden="true"
          />
          <span
            class="text-sm font-semibold text-text-heading flex-1"
            >{{ t('synthetics.results.error') }}</span
          >
        </div>
        <div class="px-4 py-3">
          <pre
            class="text-sm text-text-body m-0 whitespace-pre-wrap font-mono leading-relaxed"
          >{{ errorStep.error }}</pre>
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
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
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import VideoPlayer from "@/components/rum/VideoPlayer.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import JourneySteps from "@/components/synthetics/journey/JourneySteps.vue";
import type { StepDotState } from "@/components/synthetics/journey/JourneySteps.vue";
import useSyntheticResults from "@/composables/useSyntheticResults";
import ProtocolRunSummary from "@/components/synthetics/results/ProtocolRunSummary.vue";
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
  overrideMonitorName?: string;
  overrideRunId?: string;
  overrideExecutionId?: string;
}
const props = withDefaults(defineProps<Props>(), {
  drawerMode: false,
  overrideMonitorId: "",
  overrideMonitorName: "",
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

// ── Monitor type — protocol runs render ProtocolRunSummary instead ──────────
// null until resolved; browser view only fetches once known (avoids running
// the steps/screenshot query for protocol runs).
const monitorType = ref<string | null>(null);

async function resolveMonitorType() {
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.get(org, monitorId.value);
    monitorType.value = (res.data as any)?.type ?? "browser";
  } catch {
    monitorType.value = "browser";
  }
}

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
        ? "var(--color-status-error-text)"
        : "var(--color-text-secondary)",
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
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    "MMM dd, yyyy 'at' HH:mm ZZZ",
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
  // legacy ids (laptop_large/mobile_small) — records created before the rename
  if (name === "desktop" || name === "laptop_large") return "computer";
  if (name === "tablet") return "tablet";
  if (name === "mobile" || name === "mobile_small") return "smartphone";
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
          errorType: detail.error ? detail.error.split(":")[0] : t('synthetics.results.error'),
          errorReason: detail.error || "",
          errorStack: detail.error || "",
          failedStepLabel: detail.failedStep
            ? t('synthetics.runDetail.failedAtStep', { step: detail.failedStep })
            : undefined,
          failedStepId: 1,
        }
      : {}),
  };
}

// ── State ─────────────────────────────────────────────────────────────────
const activeTab = ref("summary");
const stackOpen = ref(true);

/** Multi-expand: set of expanded step IDs (strings — OTable composable uses string keys via getRowId().toString()). */
const expandedStepIds = ref(new Set<string>());
const expandedStepIdsArr = computed(() => Array.from(expandedStepIds.value));

function handleUpdateExpanded(ids: string[]) {
  expandedStepIds.value = new Set(ids);
}

function stepDotState(row: any): StepDotState | undefined {
  return row.status === 'fail' ? 'fail' : 'pass';
}

/** Steps enriched with total duration for progress bar calculation. */
const stepsWithTotal = computed(() => {
  const total = currentRun.value.duration || 1;
  return steps.value.map((s) => ({ ...s, _totalDuration: total }));
});

// ── Screenshot lightbox ──────────────────────────────────────────────────────
const lightboxStepId = ref<number | null>(null);

const lightboxOpen = computed({
  get: () => lightboxStepId.value !== null,
  set: (v: boolean) => {
    if (!v) lightboxStepId.value = null;
  },
});

const lightboxStep = computed(() => {
  if (lightboxStepId.value === null) return null;
  return steps.value.find((s) => s.id === lightboxStepId.value) ?? null;
});

const lightboxTitle = computed(() => {
  const s = lightboxStep.value;
  return s ? t('synthetics.runDetail.lightboxTitle', { id: s.id, action: s.action }) : "";
});

function openLightbox(id: number) {
  lightboxStepId.value = id;
}

// ── Error fullscreen ─────────────────────────────────────────────────────────
const errorStepId = ref<number | null>(null);

const errorOpen = computed({
  get: () => errorStepId.value !== null,
  set: (v: boolean) => {
    if (!v) errorStepId.value = null;
  },
});

const errorStep = computed(() => {
  if (errorStepId.value === null) return null;
  return steps.value.find((s) => s.id === errorStepId.value) ?? null;
});

const errorTitle = computed(() => {
  const s = errorStep.value;
  return s ? t('synthetics.runDetail.errorFullscreenTitle', { id: s.id, action: s.action }) : "";
});

function openErrorFullscreen(id: number) {
  errorStepId.value = id;
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

// ── Display monitor name — prefers explicit prop, falls back to SQL result ──
const displayMonitorName = computed(() =>
  props.overrideMonitorName || currentRun.value.monitorName,
);

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
    if (st.status === 'fail' && !next.has(String(st.id))) {
      next.add(String(st.id));
      changed = true;
    }
  }
  if (changed) expandedStepIds.value = next;

  // Scroll to the first failed step after layout settles
  const failedStep = newSteps.find((st) => st.status === 'fail');
  if (failedStep) {
    nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.querySelector(
            `[data-test="synthetics-run-detail-step-row-${failedStep.id}"]`,
          );
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      });
    });
  }
});

const statusBadgeVariant = computed(() =>
  isErrorRun.value ? "error-soft" : isFailed.value ? "error" : "success",
);
const statusIcon = computed(() =>
  isErrorRun.value ? "error" : isFailed.value ? "cancel" : "check-circle",
);
const statusLabel = computed(() =>
  isErrorRun.value ? t('synthetics.results.error') : isFailed.value ? t('synthetics.results.failed') : t('synthetics.results.passed'),
);

const statusChip = computed(() => {
  if (isErrorRun.value) {
    return {
      label: t('synthetics.results.status'),
      value: t('synthetics.results.error'),
      icon: "error",
      colorClass: "text-status-error-text",
    };
  }
  if (currentRun.value.status === "fail") {
    const stepNum = failedStepInfo.value?.step?.id;
    return {
      label: t('synthetics.results.status'),
      value: stepNum ? t('synthetics.runDetail.failedAtStep', { step: stepNum }) : t('synthetics.results.failed'),
      icon: "cancel",
      colorClass: "text-status-error-text",
    };
  }
  return {
    label: t('synthetics.results.status'),
    value: t('synthetics.results.passed'),
    icon: "check-circle",
    colorClass: "text-status-success-text",
  };
});

const infoChips = computed(() => [
  statusChip.value,
  { label: t('synthetics.results.duration'), value: fmtDur(currentRun.value.duration), icon: "schedule" },
  {
    label: t('synthetics.results.steps.browser'),
    value: currentRun.value.browser,
    icon: browserIcon(currentRun.value.browser),
  },
  {
    label: t('synthetics.results.device'),
    value: currentRun.value.device,
    icon: deviceIcon(currentRun.value.device),
  },
  {
    label: t('synthetics.results.location'),
    value: currentRun.value.location,
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
      label: isErr ? t('synthetics.results.error') : isF ? t('synthetics.results.failed') : t('synthetics.results.passed'),
      url: currentRun.value.url,
      timestamp: currentRun.value.timestamp,
    });
  },
);

// ── Fetch data on mount / route change ────────────────────────────────────
async function loadRun() {
  if (!runIdParam.value || !executionIdParam.value) return;
  // Resolve the monitor type first — protocol runs are rendered by
  // ProtocolRunSummary (which fetches its own row), so skip the browser
  // steps/screenshot query for them.
  if (monitorType.value === null) await resolveMonitorType();
  if (monitorType.value !== "browser") return;
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
      lightboxStepId.value = null;
      errorStepId.value = null;
      loadRun();
    }
  },
  { immediate: true },
);
</script>
