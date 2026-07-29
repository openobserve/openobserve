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
    :location-names="locationNames"
    @update-status="emit('update-status', $event)"
  />
  <OPageLayout v-else class="run-detail" data-test="synthetics-run-detail" bleed>
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
          <span class="inline-flex min-w-0 items-center gap-2">
            <span data-test="synthetics-run-detail-title" class="truncate">{{
              displayMonitorName
            }}</span>
            <BetaBadge />
          </span>
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
            class="max-w-50 truncate"
            data-test="synthetics-run-detail-url-badge"
          >
            {{ currentRun.url }}
          </OBadge>
          <div class="ml-1 flex">
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="chevron-left"
              :disabled="true"
              data-test="synthetics-run-detail-prev-btn"
            />
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="chevron-right"
              :disabled="true"
              data-test="synthetics-run-detail-next-btn"
            />
          </div>
        </template>
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            icon-left="open-in-new"
            data-test="synthetics-run-detail-trace-btn"
          >
            {{ t("synthetics.runDetail.openTrace") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            icon-left="replay"
            data-test="synthetics-run-detail-rerun-btn"
          >
            {{ t("synthetics.journey.reRun") }}
          </OButton>
        </template>
      </OPageHeader>
    </template>

    <!-- ════════ SUMMARY ════════ -->
    <div class="min-h-0 flex-1">
      <div class="flex h-full min-h-0 flex-1 flex-col py-3.5 pb-7">
        <!-- Info chips skeleton -->
        <template v-if="loading">
          <div
            class="grid grid-cols-5 gap-2.5 px-2"
            data-test="synthetics-run-detail-info-skeleton"
          >
            <div
              v-for="i in 5"
              :key="i"
              class="card-container rounded-default bg-surface-base border-border-default flex flex-row items-center gap-1.5 border px-3.5 py-2.5"
            >
              <OSkeleton type="circle" class="h-4 w-4 shrink-0" />
              <OSkeleton type="text" class="h-4 w-20" />
            </div>
          </div>
        </template>
        <!-- Info chips -->
        <template v-else>
          <div class="grid grid-cols-5 gap-2.5 px-2" data-test="synthetics-run-detail-info-bar">
            <div
              v-for="chip in infoChips"
              :key="chip.label"
              class="card-container rounded-default bg-surface-base border-border-default flex flex-row items-center gap-1.5 border px-3.5 py-2.5"
            >
              <OIcon
                v-if="chip.icon"
                :name="chip.icon"
                size="sm"
                class="shrink-0"
                :class="chip.colorClass ? chip.colorClass : ''"
              />
              <span
                class="truncate text-sm leading-none"
                :class="chip.colorClass || 'text-text-body'"
              >
                {{ chip.value }}
              </span>
            </div>
          </div>
        </template>

        <!-- Attempts: a compact selector, because the info bar is already six
             chips wide and a retried run adds nothing the chip does not say. -->
        <div
          v-if="!loading && attemptViews.length > 1"
          class="flex items-center gap-2 px-2 pt-3"
          data-test="synthetics-run-detail-attempt-select"
        >
          <span class="text-text-secondary text-xs">
            {{ t("synthetics.runDetail.attemptsLabel", { count: attemptViews.length }) }}
          </span>
          <OSelect
            v-model="selectedAttemptValue"
            :options="attemptOptions"
            size="sm"
            class="w-56"
            data-test="synthetics-run-detail-attempt-dropdown"
          />
          <!-- Superseded attempts keep only a compact timeline; the full
               forensics are retained for the attempt that decided the run. -->
          <span
            v-if="currentAttempt?.compact"
            class="text-text-secondary text-xs"
            data-test="synthetics-run-detail-attempt-reduced"
          >
            {{ t("synthetics.runDetail.attemptReducedDetail") }}
          </span>
        </div>

        <!-- Steps and Evidence are siblings, not stacked. Stacking them pushed
             a 158-row event list above the step table and broke the drawer's
             scroll: OTabPanels owns the scroll container (`grow scroll="y"`). -->
        <OTabs
          v-if="!loading"
          v-model="detailTab"
          class="border-border-default mt-2 shrink-0 border-b px-2"
        >
          <OTab name="steps" data-test="synthetics-run-detail-tab-steps">
            {{ t("synthetics.runs.tabSteps") }}
          </OTab>
          <OTab name="evidence" data-test="synthetics-run-detail-tab-evidence">
            {{ t("synthetics.runDetail.evidenceSection") }}
          </OTab>
        </OTabs>

        <div class="min-h-0 flex-1">
          <OTabPanels v-model="detailTab" grow scroll="y" class="h-full min-h-0">
            <OTabPanel name="evidence">
              <!-- v-if, not v-show: this is what makes the fetch happen on open
                   rather than with the record. -->
              <EvidencePanel
                v-if="detailTab === 'evidence'"
                :evidence-key="evidenceKey"
                :resolve-url="screenshotUrl"
                :step-defs="evidenceStepDefs"
                :record-truncated="synthetics.runDetail.value?.evidenceTruncated ?? false"
                :run-passed="currentRun.status === 'pass'"
              />
            </OTabPanel>

            <OTabPanel name="steps">
              <!-- Steps skeleton -->
              <template v-if="loading">
                <OCard class="gap-0 p-0">
                  <OCardSection role="header" class="gap-2">
                    <OSkeleton type="text" class="h-4 w-14" />
                  </OCardSection>
                  <OSeparator />
                  <OCardSection role="body" class="flex flex-col gap-2 p-3">
                    <div
                      v-for="i in 4"
                      :key="i"
                      class="rounded-default border-border-default flex items-center gap-2 border p-2"
                    >
                      <OSkeleton type="rect" class="rounded-default h-12 w-18 shrink-0" />
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
                class="border-badge-error-ol-border/30 rounded-default m-2 overflow-hidden border bg-[var(--color-badge-error-soft-bg)]"
                role="alert"
                data-test="synthetics-run-detail-steps-error-banner"
              >
                <div class="flex items-start gap-2 p-3">
                  <OIcon name="error" class="text-status-error-text shrink-0" size="md" />
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-status-error-text text-sm font-bold">
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
                      <span class="text-2xs text-status-error-text font-semibold">
                        {{ t("synthetics.runDetail.viewFullError") }}
                      </span>
                    </OButton>
                    <pre
                      v-if="stackOpen && currentRun.errorStack"
                      class="text-2xs text-text-body bg-code-bg rounded-default mt-2 overflow-auto p-[10px_12px] font-mono leading-[1.6] whitespace-pre-wrap"
                      data-test="synthetics-run-detail-error-stack"
                      >{{ currentRun.errorStack }}</pre
                    >
                  </div>
                </div>
              </div>

              <!-- ══ Split: Replay Player (left) + Steps Timeline (right) ══ -->
              <div v-else-if="steps.length > 0" class="flex min-h-0 flex-1 items-start">
                <!-- ── Left: Session Replay Player ── -->
                <OCard v-if="currentRun.hasReplay" class="w-[30%] min-w-[30rem] gap-0 p-0">
                  <OCardSection role="header" class="gap-2">
                    <OIcon name="smart_display" size="sm" class="text-accent" />
                    <span class="text-text-heading text-sm font-bold">{{
                      t("synthetics.runDetail.sessionReplay")
                    }}</span>
                    <span class="flex-1" />
                    <span class="text-2xs text-text-secondary font-mono">
                      {{
                        t("synthetics.runDetail.stepOf", {
                          selected: selectedStep?.id,
                          total: steps.length,
                        })
                      }}
                    </span>
                  </OCardSection>
                  <OSeparator />

                  <div class="flex h-95 flex-col">
                    <div class="min-h-0 flex-1">
                      <VideoPlayer :events="[]" :segments="[]" :is-loading="false" />
                    </div>
                  </div>
                </OCard>

                <!-- ── Right: Execution Timeline ── -->
                <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                  <div class="flex items-center gap-2 px-3 py-4">
                    <h4 class="text-text-heading m-0 text-sm font-bold">
                      {{ t("synthetics.journey.steps") }}
                    </h4>
                    <OBadge variant="default" size="sm">{{ steps.length }}</OBadge>
                    <span class="flex-1" />
                  </div>

                  <div class="min-h-0 flex-1 overflow-auto pb-2">
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
                          class="h-full w-full object-cover"
                        />
                        <OIcon v-else name="image" size="xs" class="text-text-secondary" />
                      </template>

                      <!-- Expanded content: screenshot + metadata + error -->
                      <template #expansion="{ row }">
                        <div class="flex gap-4 p-3">
                          <div class="w-[40%] shrink-0">
                            <div
                              class="rounded-default border-border-default overflow-hidden border"
                            >
                              <div
                                class="flex aspect-[16/10] items-center justify-center overflow-hidden"
                                :class="
                                  row.status === 'fail' ? 'bg-status-error-bg' : 'bg-surface-subtle'
                                "
                              >
                                <div v-if="row.screenshotKey" class="group relative h-full w-full">
                                  <OButton
                                    variant="ghost"
                                    size="sm"
                                    class="h-full! w-full rounded-none! border-0! p-0!"
                                    data-test="synthetics-run-detail-step-screenshot-thumb"
                                    @click="openLightbox(row.id)"
                                  >
                                    <img
                                      :src="screenshotUrl(row.screenshotKey)"
                                      :alt="t('synthetics.runDetail.screenshotAlt')"
                                      class="h-full w-full object-contain transition-opacity group-hover:opacity-90"
                                    />
                                  </OButton>
                                  <div
                                    class="rounded-default bg-surface-base/80 pointer-events-none absolute top-2 right-2 flex h-7 w-7 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                                    aria-hidden="true"
                                  >
                                    <OIcon name="fullscreen" size="sm" class="text-text-body" />
                                  </div>
                                </div>
                                <template v-else>
                                  <OIcon
                                    name="image"
                                    :class="
                                      row.status === 'fail'
                                        ? 'text-status-error-text'
                                        : 'text-text-secondary'
                                    "
                                    size="lg"
                                  />
                                  <span
                                    class="text-xs font-semibold"
                                    :class="
                                      row.status === 'fail'
                                        ? 'text-status-error-text'
                                        : 'text-text-secondary'
                                    "
                                  >
                                    {{
                                      row.status === "fail"
                                        ? t("synthetics.runDetail.failureScreenshot")
                                        : t("synthetics.runDetail.screenshotPlaceholder")
                                    }}
                                  </span>
                                </template>
                              </div>
                            </div>
                          </div>

                          <div class="flex flex-1 flex-col gap-4">
                            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                              <dt
                                class="text-text-secondary text-sm font-semibold tracking-wide capitalize"
                              >
                                {{ t("synthetics.runDetail.detailAction") }}
                              </dt>
                              <dd class="text-text-secondary">{{ row.action }}</dd>
                              <dt
                                class="text-text-secondary text-sm font-semibold tracking-wide capitalize"
                              >
                                {{ t("synthetics.runDetail.detailSelector") }}
                              </dt>
                              <dd class="text-text-secondary">{{ row.detail }}</dd>
                              <dt
                                class="text-text-secondary text-sm font-semibold tracking-wide capitalize"
                              >
                                {{ t("synthetics.runDetail.detailUrl") }}
                              </dt>
                              <dd class="text-text-secondary truncate">
                                {{ row.url || currentRun.url }}
                              </dd>
                              <dt
                                class="text-text-secondary text-sm font-semibold tracking-wide capitalize"
                              >
                                {{ t("synthetics.results.duration") }}
                              </dt>
                              <dd class="text-text-secondary">{{ row.durStr }}</dd>
                            </dl>

                            <div
                              v-if="row.status === 'fail' && row.error"
                              class="rounded-default border-badge-error-ol-border/30 overflow-hidden border"
                              :data-test="`synthetics-run-detail-step-error-card-${row.id}`"
                            >
                              <div
                                class="flex items-center gap-2 bg-[var(--color-badge-error-soft-bg)] px-3 py-2"
                              >
                                <OIcon
                                  name="error"
                                  size="sm"
                                  class="text-status-error-text"
                                  aria-hidden="true"
                                />
                                <span class="text-text-heading flex-1 text-xs font-semibold">{{
                                  t("synthetics.results.error")
                                }}</span>
                              </div>
                              <div class="px-3 py-3">
                                <pre
                                  class="text-text-body m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap"
                                  :class="{
                                    'max-h-24 overflow-hidden':
                                      !expandedStepErrors.has(row.id) &&
                                      (row.error?.length ?? 0) > 200,
                                  }"
                                  >{{ row.error }}</pre
                                >
                                <div class="mt-1.5 flex items-center gap-2">
                                  <OButton
                                    v-if="(row.error?.length ?? 0) > 200"
                                    variant="ghost"
                                    size="xs"
                                    class="text-text-link text-xs font-semibold"
                                    data-test="synthetics-run-detail-toggle-step-error-btn"
                                    @click="toggleStepError(row.id)"
                                  >
                                    {{
                                      expandedStepErrors.has(row.id)
                                        ? t("synthetics.runDetail.showLess")
                                        : t("synthetics.runDetail.showFullError")
                                    }}
                                  </OButton>
                                  <OButton
                                    variant="ghost"
                                    size="xs"
                                    data-test="synthetics-run-detail-step-view-error-btn"
                                    @click="openErrorFullscreen(row.id)"
                                  >
                                    {{ t("synthetics.runDetail.viewFullErrorBtn") }}
                                  </OButton>
                                </div>
                              </div>
                            </div>
                            <!-- P5.4 items 3-5: what the runner saw. Written by the
                           probe on every failed run and rendered by nothing
                           until now, which is why every failure looked alike. -->
                            <StepEvidence
                              v-if="row.evidence"
                              :detail="row.evidence"
                              :evidence="row.appEvidence"
                              :truncated="detail?.evidenceTruncated"
                              class="mt-3"
                            />
                          </div>
                        </div>
                      </template>
                    </JourneySteps>
                  </div>
                </div>
              </div>
            </OTabPanel>
          </OTabPanels>
        </div>
      </div>
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
      class="flex h-full items-center justify-center p-6"
      :class="lightboxStep.status === 'fail' ? 'bg-status-error-bg' : 'bg-surface-subtle'"
    >
      <img
        v-if="lightboxStep.screenshotKey"
        :src="screenshotUrl(lightboxStep.screenshotKey)"
        :alt="t('synthetics.runDetail.screenshotAlt')"
        class="max-h-[85vh] max-w-full object-contain"
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
    <div v-if="errorStep" class="flex h-full flex-col overflow-y-auto p-6">
      <div class="rounded-default border-badge-error-ol-border/30 overflow-hidden border">
        <div class="flex items-center gap-2 bg-[var(--color-badge-error-soft-bg)] px-4 py-2.5">
          <OIcon name="error" size="sm" class="text-status-error-text" aria-hidden="true" />
          <span class="text-text-heading flex-1 text-sm font-semibold">{{
            t("synthetics.results.error")
          }}</span>
        </div>
        <div class="px-4 py-3">
          <pre class="text-text-body m-0 font-mono text-sm leading-relaxed whitespace-pre-wrap">{{
            errorStep.error
          }}</pre>
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import syntheticsService from "@/services/synthetics";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { locationDisplayLabel } from "@/utils/synthetics/format";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import StepEvidence from "@/components/synthetics/StepEvidence.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import VideoPlayer from "@/components/rum/VideoPlayer.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import JourneySteps from "@/components/synthetics/journey/JourneySteps.vue";
import type { StepDotState } from "@/components/synthetics/journey/JourneySteps.vue";
import useSyntheticResults from "@/composables/useSyntheticResults";
import ProtocolRunSummary from "@/components/synthetics/results/ProtocolRunSummary.vue";
import EvidencePanel from "@/components/synthetics/results/EvidencePanel.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import { buildAttemptViews } from "@/composables/synthetics/syntheticResultsSchema";
import type {
  AttemptView,
  FailureDetail,
  StepEvidence as StepEvidenceSummary,
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
      variant: BadgeVariant;
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
  overrideMonitorType?: string;
}
const props = withDefaults(defineProps<Props>(), {
  drawerMode: false,
  overrideMonitorId: "",
  overrideMonitorName: "",
  overrideRunId: "",
  overrideExecutionId: "",
  overrideMonitorType: "",
});

const { t } = useI18n();
const route = useRoute();
const store = useStore();

// id -> "Name (region)" — the run's location field is the raw id (KSUID for
// private, "aws-us-east-1" for public); resolve it for display.
const locationNames = ref<Record<string, string>>({});
function locationLabel(id: string): string {
  return locationNames.value[id] ?? id;
}
syntheticsService
  .getLocations(store.state.selectedOrganization.identifier)
  .then((res) => {
    const locations: { id: string; label: string; region: string }[] =
      (res.data as any).locations ?? [];
    locationNames.value = Object.fromEntries(
      locations.map((loc) => [loc.id, locationDisplayLabel(loc.label, loc.region)]),
    );
  })
  .catch((err) => console.error("[synthetics] failed to load locations", err));

// ── Source IDs — props in drawer mode, route params otherwise ────────────────
const monitorId = computed(() =>
  props.drawerMode ? props.overrideMonitorId : String(route.params.id ?? ""),
);
const runIdParam = computed(() =>
  props.drawerMode ? props.overrideRunId : String(route.params.runId ?? ""),
);
const executionIdParam = computed(() =>
  props.drawerMode ? props.overrideExecutionId : String(route.params.executionId ?? ""),
);
// The check's folder (name), carried on the results-page route as ?folder=.
// Passed to per-check API calls so RBAC can resolve folder-scoped grants.
const folderName = computed(() => String(route.query.folder ?? ""));

// ── Composable ─────────────────────────────────────────────────────────────
const synthetics = useSyntheticResults();

// ── Monitor type — protocol runs render ProtocolRunSummary instead ──────────
// null until resolved; browser view only fetches once known (avoids running
// the steps/screenshot query for protocol runs). In drawer mode the parent
// (MonitorResults.vue) already knows the type — seed from it to skip the
// redundant fetch and the render gap while this would otherwise be null.
const monitorType = ref<string | null>(
  props.drawerMode && props.overrideMonitorType ? props.overrideMonitorType : null,
);

async function resolveMonitorType() {
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.get(org, monitorId.value, folderName.value);
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
  url: string;
  duration: number;
  status: "pass" | "fail";
  icon: string;
  statusIcon: string;
  durStr: string;
  durColor: string;
  error: string | null;
  screenshotKey: string | null;
  /** P5.4 items 3-5, present only on the step that actually failed. */
  evidence: FailureDetail | null;
  /** Browser-side evidence for this step, when the probe captured any. */
  appEvidence: StepEvidenceSummary | null;
}

function fmtDur(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms";
}

/** Merge recorded_step definitions with last_attempt_step execution results. */
/**
 * @param attempt — the attempt being viewed. Its steps and failure detail are
 *   used in place of the record's top-level ones, so switching attempts
 *   re-renders the table instead of showing the deciding attempt's steps under
 *   another attempt's label.
 */
function buildSteps(
  detail: SyntheticRunDetail | null,
  attempt: AttemptView | null = null,
): StepRow[] {
  const steps = attempt?.steps ?? detail?.lastAttemptSteps ?? [];
  const failureDetail = attempt ? attempt.failureDetail : (detail?.failureDetail ?? null);
  if (!detail || !steps.length) return [];
  const recordedMap = new Map<string, RecordedStep>();
  for (const rs of detail.recordedSteps) {
    recordedMap.set(rs.id, rs);
  }
  return steps.map((ex, idx) => {
    const recorded = recordedMap.get(ex.step_id);
    const isFail = ex.status === "fail";
    return {
      id: idx + 1,
      stepId: ex.step_id,
      action: recorded?.action ?? "step",
      name: recorded?.name || recorded?.selector || recorded?.url || ex.step_id.slice(0, 8),
      detail: recorded?.selector ?? recorded?.url ?? ex.step_id,
      url: recorded?.url ?? "",
      duration: ex.duration_ms,
      status: isFail ? ("fail" as const) : ("pass" as const),
      icon: recorded ? actionIcon(recorded.action) : "radio_button_checked",
      statusIcon: isFail ? "cancel" : "check-circle",
      durStr: fmtDur(ex.duration_ms),
      durColor: isFail ? "var(--color-status-error-text)" : "var(--color-text-secondary)",
      error: ex.error,
      // A superseded attempt's screenshots are uploaded under an attempt-scoped
      // key, so they are resolved from THAT attempt's refs. Falling back to the
      // record's key would show the surviving attempt's pixels under the
      // failing attempt's label.
      screenshotKey: attempt?.screenshotKeys.get(ex.step_id) ?? ex.screenshot_key,
      // Scoped to the failing step: the report describes one failure, and
      // hanging it off every row would imply each step had its own.
      evidence: failureDetail && failureDetail.stepId === ex.step_id ? failureDetail : null,
      // Per step, not per failure: the step that CAUSED the problem is often
      // not the one that failed, so evidence hangs off whichever step owns it.
      appEvidence: detail.evidenceByStep.find((e) => e.stepId === ex.step_id) ?? null,
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
  // Every attempt's artifacts, not only the deciding one's: switching attempts
  // in the strip must not trigger a second presign round-trip, and a superseded
  // attempt's screenshots live under their own keys.
  const keys = [
    ...detail.lastAttemptSteps.map((s) => s.screenshot_key),
    detail.traceKey,
    detail.evidenceKey,
    // Evidence bundles as well as screenshots and traces, so opening the
    // Evidence tab and switching attempts inside it cost no further round-trip.
    ...detail.retryHistory.flatMap((a) => [
      ...a.screenshotKeys.values(),
      a.traceKey,
      a.evidenceKey,
    ]),
  ].filter((k): k is string => !!k);
  if (!keys.length) return;
  const orgId = store.state.selectedOrganization.identifier;
  try {
    const { data } = await syntheticsService.presignArtifacts(
      orgId,
      monitorId.value,
      keys,
      folderName.value,
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
  return syntheticsService.artifactUrl(orgId, key, folderName.value);
}

// ── Evidence tab ──────────────────────────────────────────────────────────
//
// The panel reads the BUNDLE, not `evidence_by_step`: that field is an anomaly
// index and is empty whenever the network behaved, which is the common shape of
// a browser failure (a locator that never matched).
/** Which panel the drawer is showing. Steps first — it is what the run is. */
const detailTab = ref<"steps" | "evidence">("steps");

/** The SELECTED attempt's own bundle — attempt 0 bare, retries `attempt-N-`. */
const evidenceKey = computed(
  () => currentAttempt.value?.evidenceKey ?? synthetics.runDetail.value?.evidenceKey ?? null,
);

/** step_id -> definition, for naming groups. Reuses the run's own snapshot so a
 *  later edit to the check cannot relabel this run's history. */
const evidenceStepDefs = computed(() => {
  const m = new Map<string, { name: string; selector: string | null }>();
  for (const rs of synthetics.runDetail.value?.recordedSteps ?? []) {
    m.set(rs.id, { name: rs.name || rs.id, selector: rs.selector });
  }
  return m;
});

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
    status: isFail ? ("fail" as const) : isError ? ("error" as const) : ("pass" as const),
    duration: detail.durationMs,
    browser: capitalizeEngine(detail.browserEngine),
    device: detail.device,
    location: detail.location,
    timestamp: fmtTimestamp(detail.timestamp),
    url: detail.recordedSteps[0]?.url ?? "",
    hasReplay: false,
    ...(hasIssue
      ? {
          errorType: detail.error ? detail.error.split(":")[0] : t("synthetics.results.error"),
          errorReason: detail.error || "",
          errorStack: detail.error || "",
          failedStepLabel: detail.failedStep
            ? t("synthetics.runDetail.failedAtStep", { step: detail.failedStep })
            : undefined,
          failedStepId: 1,
        }
      : {}),
  };
}

// ── Attempts (C2) ─────────────────────────────────────────────────────────
//
// One record carries every attempt the execution made. Switching between them
// is local state — `retry_history` is already on the row, so the strip costs no
// request.
const attemptViews = computed<AttemptView[]>(() =>
  synthetics.runDetail.value ? buildAttemptViews(synthetics.runDetail.value) : [],
);
const selectedAttempt = ref(0);
// The deciding attempt is the default: it is the one the run's verdict and the
// record's top-level fields describe. Reset on every new run, or the index
// would point into the previous run's (possibly shorter) list.
watch(attemptViews, (views) => {
  selectedAttempt.value = Math.max(0, views.length - 1);
});
const currentAttempt = computed<AttemptView | null>(
  () => attemptViews.value[selectedAttempt.value] ?? null,
);

/**
 * Options for the attempt selector.
 *
 * Labelled 1-based ("Attempt 2 of 3") while `attempt` on the record is 0-based;
 * displaying the raw index invites off-by-one bug reports. The deciding attempt
 * is marked, because that is the one the record's top-level fields describe —
 * and on a flaky run it is the attempt that PASSED while the run reads warning.
 */
const attemptOptions = computed(() =>
  attemptViews.value.map((a, i) => ({
    label:
      `${t("synthetics.runDetail.attemptN", { n: a.attempt + 1 })} · ${fmtDur(a.durationMs)}` +
      ` · ${a.status === "passed" ? t("synthetics.results.passed") : t("synthetics.results.failed")}` +
      (a.decided ? ` · ${t("synthetics.runDetail.attemptDecided")}` : ""),
    value: String(i),
  })),
);

/** OSelect works in strings; the index is the identity. */
const selectedAttemptValue = computed({
  get: () => String(selectedAttempt.value),
  set: (v: string) => {
    selectedAttempt.value = Number(v);
  },
});

// ── State ─────────────────────────────────────────────────────────────────
const stackOpen = ref(true);

/** Multi-expand: set of expanded step IDs (strings — OTable composable uses string keys via getRowId().toString()). */
const expandedStepIds = ref(new Set<string>());
const expandedStepIdsArr = computed(() => Array.from(expandedStepIds.value));

function handleUpdateExpanded(ids: string[]) {
  expandedStepIds.value = new Set(ids);
}

function stepDotState(row: any): StepDotState | undefined {
  return row.status === "fail" ? "fail" : "pass";
}

/** Steps enriched with total duration for progress bar calculation. */
const stepsWithTotal = computed(() => {
  const total = currentRun.value.duration || 1;
  return steps.value.map((s) => ({ ...s, _totalDuration: total }));
});

/** Current step shown in the session-replay panel (first step for now). */
const selectedStep = computed<StepRow | null>(() => steps.value[0] ?? null);

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
  return s ? t("synthetics.runDetail.lightboxTitle", { id: s.id, action: s.action }) : "";
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
  return s ? t("synthetics.runDetail.errorFullscreenTitle", { id: s.id, action: s.action }) : "";
});

function openErrorFullscreen(id: number) {
  errorStepId.value = id;
}

// Computed: current run from composable data
const loading = computed(() => synthetics.loading.value);
const currentRun = computed<DisplayRun>(() => {
  return synthetics.runDetail.value ? toDisplayRun(synthetics.runDetail.value) : toDisplayRun(null);
});

const isFailed = computed(
  () => currentRun.value.status === "fail" || currentRun.value.status === "error",
);

const isErrorRun = computed(() => currentRun.value.status === "error");

// ── Display monitor name — prefers explicit prop, falls back to SQL result ──
const displayMonitorName = computed(
  () => props.overrideMonitorName || currentRun.value.monitorName,
);

const steps = computed<StepRow[]>(() => {
  if (synthetics.runDetail.value) {
    return buildSteps(synthetics.runDetail.value, currentAttempt.value);
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
    summary: step.error ? step.error.split("\n")[0] : "",
  };
});

/** Auto-expand any failed steps when the run data loads. */
watch(steps, (newSteps) => {
  const next = new Set(expandedStepIds.value);
  let changed = false;
  for (const st of newSteps) {
    if (st.status === "fail" && !next.has(String(st.id))) {
      next.add(String(st.id));
      changed = true;
    }
  }
  if (changed) expandedStepIds.value = next;

  // Scroll to the first failed step after layout settles
  const failedStep = newSteps.find((st) => st.status === "fail");
  if (failedStep) {
    nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.querySelector(
            `[data-test="synthetics-run-detail-step-row-${failedStep.id}"]`,
          );
          el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  isErrorRun.value
    ? t("synthetics.results.error")
    : isFailed.value
      ? t("synthetics.results.failed")
      : t("synthetics.results.passed"),
);

const statusChip = computed(() => {
  if (isErrorRun.value) {
    return {
      label: t("synthetics.results.status"),
      value: t("synthetics.results.error"),
      icon: "error",
      colorClass: "text-status-error-text",
    };
  }
  if (currentRun.value.status === "fail") {
    const stepNum = failedStepInfo.value?.step?.id;
    return {
      label: t("synthetics.results.status"),
      value: stepNum
        ? t("synthetics.runDetail.failedAtStep", { step: stepNum })
        : t("synthetics.results.failed"),
      icon: "cancel",
      colorClass: "text-status-error-text",
    };
  }
  return {
    label: t("synthetics.results.status"),
    value: t("synthetics.results.passed"),
    icon: "check-circle",
    colorClass: "text-status-success-text",
  };
});

interface InfoChip {
  label: string;
  value: string;
  icon: string;
  colorClass?: string;
}

const infoChips = computed<InfoChip[]>(() => [
  statusChip.value,
  {
    label: t("synthetics.results.duration"),
    value: fmtDur(currentRun.value.duration),
    icon: "schedule",
  },
  {
    label: t("synthetics.results.steps.browser"),
    value: currentRun.value.browser,
    icon: browserIcon(currentRun.value.browser),
  },
  {
    label: t("synthetics.results.device"),
    value: currentRun.value.device,
    icon: deviceIcon(currentRun.value.device),
  },
  {
    label: t("synthetics.results.location"),
    value: locationLabel(currentRun.value.location),
    icon: locationIcon(currentRun.value.location),
  },
  // C4 — probe start-up is INSIDE the duration above. Shown separately rather
  // than subtracted, because a cold Lambda's 113s init is itself the finding:
  // unlabelled it made every Lambda location look permanently slower than a
  // private agent at every percentile.
  ...(initMs.value > 0
    ? [
        {
          label: t("synthetics.runDetail.initTime"),
          value: fmtDur(initMs.value),
          icon: "bolt",
        },
      ]
    : []),
  // C5 — scheduled → started. Null (not 0) when the record predates the field,
  // so an unknown delay is never rendered as a perfect one.
  ...(queueDelayMs.value !== null
    ? [
        {
          label: t("synthetics.runDetail.queueDelay"),
          value: fmtDur(queueDelayMs.value),
          icon: "schedule",
        },
      ]
    : []),
  ...(attemptViews.value.length > 1
    ? [
        {
          label: t("synthetics.runDetail.attempts"),
          value: `⟳${attemptViews.value.length}`,
          icon: "replay",
          colorClass: "text-status-warning-text",
        },
      ]
    : []),
]);

const initMs = computed(() => synthetics.runDetail.value?.initMs ?? 0);
const queueDelayMs = computed(() => synthetics.runDetail.value?.queueDelayMs ?? null);

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
      label: isErr
        ? t("synthetics.results.error")
        : isF
          ? t("synthetics.results.failed")
          : t("synthetics.results.passed"),
      url: currentRun.value.url,
      timestamp: currentRun.value.timestamp,
    });
  },
);

// ── Fetch data on mount / route change ────────────────────────────────────
async function loadRun() {
  if (!runIdParam.value || !executionIdParam.value) return;
  // Show the skeleton (rather than the empty browser layout) for as long as
  // the monitor type is unresolved, since we don't yet know which branch —
  // this one or ProtocolRunSummary — will end up rendering.
  synthetics.loading.value = true;
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
