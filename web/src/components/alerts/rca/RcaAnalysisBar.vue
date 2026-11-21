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
  <!-- One row at any width: the subtitle truncates first, then Ask and Re-analyze drop to icons,
       then the run label truncates. -->
  <div
    data-test="rca-analysis-bar"
    class="@container flex flex-nowrap items-center gap-2.5"
    :class="variant === 'report' ? 'max-md:flex-wrap' : ''"
  >
    <ODropdown align="start" content-class="w-100 max-w-[calc(100vw-1.5rem)]">
      <template #trigger>
        <OButton data-test="rca-run-selector" variant="outline" size="sm" class="min-w-0">
          <span
            v-if="selectedIsLive"
            class="bg-status-positive me-1.5 inline-block size-1.75 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
            aria-hidden="true"
          />
          <OIcon v-else name="history" size="sm" class="text-text-secondary me-1.5 shrink-0" />
          <span data-test="rca-run-selector-label" class="min-w-0 truncate">{{
            selectorLabel
          }}</span>
          <OIcon name="expand-more" size="sm" class="ms-1 shrink-0" />
        </OButton>
      </template>
      <ODropdownGroup :label="t('alerts.incidents.rcaHistory')">
        <template v-for="entry in entries" :key="entry.key">
          <ODropdownItem
            v-if="entry.kind === 'run'"
            :data-test="`rca-history-item-${entry.idx}`"
            :disabled="!entry.openable"
            :description="entry.description"
            @select="$emit('select-run', entry.isLatest ? null : entry.runId)"
          >
            <span :class="entry.selected ? 'font-bold' : 'font-semibold'">{{ entry.label }}</span>
            <template v-if="entry.regionShown" #icon-right>
              <RcaRegionTag
                class="ms-auto"
                :region="entry.region"
                :state="entry.live ? 'live' : 'terminal'"
                :data-test="`rca-history-item-${entry.idx}-region`"
              />
            </template>
          </ODropdownItem>
          <!-- A page the run guard refused: it opens the exact covering run, never the latest. -->
          <div v-else class="border-border-strong ms-2.5 border-s-2">
            <ODropdownItem
              :data-test="`rca-history-skipped-${entry.idx}`"
              :data-covering-run-id="entry.coveringRunId"
              :disabled="entry.gone"
              :description="entry.description"
              @select="$emit('select-run', entry.coveringRunId)"
            >
              <template #icon-left>
                <OIcon name="redo" size="xs" class="text-text-secondary mt-1 shrink-0 self-start" />
              </template>
              <span class="text-compact font-semibold">{{ entry.label }}</span>
              <template #icon-right>
                <span
                  :data-test="`rca-history-skipped-${entry.idx}-link`"
                  :aria-disabled="entry.gone || undefined"
                  class="text-compact ms-auto inline-flex shrink-0 items-center gap-0.5 self-start font-semibold"
                  :class="entry.gone ? undefined : 'text-text-link'"
                >
                  {{ entry.open }}
                  <OIcon name="arrow-forward" size="xs" />
                </span>
              </template>
            </ODropdownItem>
          </div>
        </template>
      </ODropdownGroup>
    </ODropdown>

    <span
      data-test="rca-analysis-subtitle"
      class="text-text-secondary min-w-0 flex-1 truncate text-xs"
    >
      {{ subtitle }}
    </span>

    <template v-if="variant === 'report'">
      <template v-if="!selectedIsLive">
        <OButton
          ref="copyButton"
          data-test="rca-report-copy-btn"
          variant="outline"
          size="sm"
          class="shrink-0"
          icon-left="content-copy"
          :disabled="!hasReport"
          @click="$emit('copy-report')"
        >
          {{ t("alerts.incidents.rcaCopy") }}
        </OButton>
        <OPopover
          :open="!!copyPreview"
          :anchor="copyAnchor"
          align="end"
          :close-on-scroll="false"
          :aria-label="t('alerts.incidents.rcaLight.copiedTitle')"
          @update:open="!$event && $emit('close-preview')"
        >
          <section
            data-test="rca-copy-preview"
            class="flex w-[min(48rem,calc(100vw-1.5rem))] flex-col"
          >
            <header class="border-border-default flex items-center gap-2 border-b py-2 ps-3 pe-2">
              <OIcon name="check-circle" size="sm" class="text-status-positive shrink-0" />
              <span class="text-text-heading text-compact font-semibold">
                {{ t("alerts.incidents.rcaLight.copiedTitle") }}
              </span>
              <span class="text-text-secondary min-w-0 flex-1 truncate text-xs">
                {{ t("alerts.incidents.rcaLight.copiedHint") }}
              </span>
              <OButton
                data-test="rca-copy-preview-close"
                variant="ghost"
                size="icon-sm"
                icon-left="close"
                :aria-label="t('alerts.incidents.rcaLight.closePreview')"
                @click="$emit('close-preview')"
              />
            </header>
            <pre
              data-test="rca-copy-preview-text"
              class="text-text-body m-0 max-h-[50vh] overflow-auto p-3 font-mono text-xs break-words whitespace-pre-wrap"
              >{{ copyPreview }}</pre>
          </section>
        </OPopover>
        <OButton
          data-test="rca-report-download-btn"
          variant="outline"
          size="sm"
          class="shrink-0"
          icon-left="download"
          :disabled="!hasReport"
          @click="$emit('download-report')"
        >
          {{ t("alerts.incidents.rcaDownload") }}
        </OButton>
      </template>
      <OButton
        v-if="hasThread"
        data-test="rca-report-open-thread-btn"
        variant="outline"
        size="sm"
        class="shrink-0"
        icon-left="forum"
        @click="$emit('open-thread')"
      >
        {{ t("alerts.incidents.rcaLight.openThread") }}
      </OButton>
    </template>

    <template v-else>
      <OButton
        v-if="live"
        data-test="rca-cancel-btn"
        variant="ghost-destructive"
        size="sm"
        class="shrink-0"
        icon-left="stop-circle"
        :loading="cancelling"
        @click="$emit('cancel')"
      >
        {{ t("alerts.incidents.rcaRun.cancelRun") }}
      </OButton>

      <OButton
        v-if="!live && canAsk"
        data-test="rca-ask-btn"
        variant="outline"
        size="sm"
        class="shrink-0"
        icon-left="auto-awesome"
        @click="$emit('ask')"
      >
        <span class="sr-only @2xl:not-sr-only">{{ t("alerts.incidents.rcaAsk.button") }}</span>
      </OButton>

      <OTooltip
        v-if="!live"
        :content="startLockedReason"
        :disabled="!startLockedReason"
        side="bottom"
      >
        <span class="inline-flex shrink-0">
          <OButton
            data-test="rca-reanalyze-btn"
            variant="outline"
            size="sm"
            :icon-left="startLockedReason ? 'lock' : 'refresh'"
            :loading="triggering"
            :disabled="resuming || !!startLockedReason"
            @click="$emit('reanalyze')"
          >
            <span class="sr-only @2xl:not-sr-only">{{ t("alerts.incidents.rcaReanalyze") }}</span>
          </OButton>
        </span>
      </OTooltip>

      <ODropdown align="end" content-class="w-55">
        <template #trigger>
          <OButton
            data-test="rca-more-btn"
            variant="outline"
            size="icon-toolbar"
            class="shrink-0"
            :aria-label="t('alerts.incidents.rcaRun.more')"
          >
            <OIcon name="more-horiz" size="sm" />
          </OButton>
        </template>
        <ODropdownItem
          data-test="rca-copy-btn"
          icon-left="content-copy"
          :disabled="!hasReport"
          @select="$emit('copy-report')"
        >
          {{ t("alerts.incidents.rcaCopy") }}
        </ODropdownItem>
        <ODropdownItem
          data-test="rca-download-btn"
          icon-left="download"
          :disabled="!hasReport"
          @select="$emit('download-report')"
        >
          {{ t("alerts.incidents.rcaDownload") }}
        </ODropdownItem>
        <ODropdownItem
          data-test="rca-copy-thread-btn"
          icon-left="forum"
          :disabled="!hasThread"
          @select="$emit('copy-thread')"
        >
          {{ t("alerts.incidents.rcaThread.copy") }}
        </ODropdownItem>
      </ODropdown>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { RcaRunItem, RcaSkippedPage } from "@/services/incidents";
import type { RcaRunListStatus } from "@/composables/useIncidentRca";
import { formatTimestampInTimezone } from "@/utils/date";
import { formatMicrosDuration, timezoneAbbr } from "@/utils/formatters";
import RcaRegionTag from "./RcaRegionTag.vue";
import { rcaTriggerLabel } from "@/utils/incidents/rcaThread";

const props = withDefaults(
  defineProps<{
    /** Runs of the incident, newest first. */
    runs: RcaRunItem[];
    /** The latest run's id. */
    latestRunId: string | null;
    /** The run the tab shows (the latest, or one picked from the history). */
    selectedRunId: string | null;
    /** The latest run is running or waiting for input. */
    live: boolean;
    /** Trigger and age of the shown run. */
    subtitle: I18nText | string;
    /** The shown report's text is loaded (Copy, Download). */
    hasReport: boolean;
    hasThread: boolean;
    /** The shown run has a report or a record and AI chat is available (J5). */
    canAsk?: boolean;
    triggering?: boolean;
    /** A resume is in flight: Re-analyze waits for it. */
    resuming?: boolean;
    cancelling?: boolean;
    /** Why no new run can start: Re-analyze stays visible, disabled, with this reason. */
    startLockedReason?: I18nText;
    /** `report`: the Report tab's bar, with Copy report and Download as Markdown as buttons. */
    variant?: "analysis" | "report";
    /** The app's time zone for run times. */
    timezone?: string;
    /** The Markdown Copy report just put on the clipboard; null hides the preview. */
    copyPreview?: string | null;
    /** Pages the run guard refused, shown in time order between the runs (P16). */
    skippedPages?: RcaSkippedPage[];
    /** Covering runs confirmed no longer kept: their notes stay, not selectable. */
    goneRunIds?: string[];
    /** The run list read; an unknown region is only claimed once it succeeded. */
    listStatus?: RcaRunListStatus;
  }>(),
  {
    skippedPages: () => [],
    goneRunIds: () => [],
    listStatus: "ready",
    variant: "analysis",
    timezone: "UTC",
    copyPreview: null,
    canAsk: false,
    triggering: false,
    resuming: false,
    cancelling: false,
    startLockedReason: undefined,
  },
);

defineEmits<{
  "select-run": [runId: string | null];
  /** Re-analyze: open the re-analysis dialog. */
  reanalyze: [];
  cancel: [];
  "copy-report": [];
  "download-report": [];
  "copy-thread": [];
  /** "Ask about this analysis": open a new AI chat with the analysis attached. */
  ask: [];
  /** The Report tab's way to the analysis, with its thread in focus. */
  "open-thread": [];
  "close-preview": [];
}>();

const { t } = useI18nTyped();

const runTime = (us: number) =>
  `${formatTimestampInTimezone(us, "MMM D, HH:mm", props.timezone)} ${timezoneAbbr(props.timezone, new Date(us / 1000))}`;

const copyButton = ref<ComponentPublicInstance | null>(null);
const copyAnchor = computed(() => (copyButton.value?.$el as Element | undefined) ?? null);

const runNumberOf = (run: RcaRunItem, idx: number) => run.run_number ?? props.runs.length - idx;

const items = computed(() =>
  props.runs.map((run, idx) => {
    const number = runNumberOf(run, idx);
    const isLatest = run.run_id === props.latestRunId;
    const liveRun = isLatest && props.live;
    const parts: string[] = [rcaTriggerLabel(run.trigger, run.started_by)];
    if (run.state === "failed") parts.push(t("alerts.incidents.rcaRun.state.failed"));
    if (run.state === "cancelled") parts.push(t("alerts.incidents.rcaRun.state.cancelled"));
    return {
      kind: "run" as const,
      key: run.run_id,
      idx,
      at: run.started_at,
      runId: run.run_id,
      isLatest,
      live: liveRun,
      selected: run.run_id === props.selectedRunId,
      // Completed runs open a report and runs with a record (a cancelled or failed run's
      // partial ledger) open it; the latest run is always the way back.
      openable: isLatest || run.state === "completed" || run.has_record,
      label: liveRun
        ? t("alerts.incidents.rcaRun.runLive", { number })
        : t("alerts.incidents.rcaLight.runAt", { number, time: runTime(run.started_at) }),
      description: raw(parts.join(" · ")),
      region: run.serving_region ?? null,
      // A failed or forbidden list read is not an unknown region.
      regionShown: !!run.serving_region?.trim() || props.listStatus === "ready",
    };
  }),
);

const skippedEntries = computed(() =>
  props.skippedPages.map((page, idx) => {
    const covering = props.runs.findIndex((run) => run.run_id === page.covering_run_id);
    const number =
      page.covering_run_number ??
      (covering >= 0 ? runNumberOf(props.runs[covering], covering) : null);
    const numberText = raw(number === null ? "?" : String(number));
    const gone = props.goneRunIds.includes(page.covering_run_id);
    const reason =
      page.reason === "cooling_down"
        ? t("alerts.incidents.rcaRun.skipped.coolingDown", {
            number: numberText,
            cooldown: raw(formatMicrosDuration(page.cooldown_us ?? 0)),
          })
        : t("alerts.incidents.rcaRun.skipped.inFlight", { number: numberText });
    return {
      kind: "skipped" as const,
      key: `skipped-${page.at_us}-${idx}`,
      idx,
      at: page.at_us,
      coveringRunId: page.covering_run_id,
      gone,
      label: t("alerts.incidents.rcaRun.skipped.title", {
        time: raw(formatTimestampInTimezone(page.at_us, "HH:mm", "UTC")),
      }),
      description: gone ? raw(`${reason} · ${t("alerts.incidents.rcaRun.skipped.gone")}`) : reason,
      open: t("alerts.incidents.rcaRun.skipped.open", { number: numberText }),
    };
  }),
);

/** Runs newest first, with each skipped page placed by its time. */
const entries = computed(() =>
  [...items.value, ...skippedEntries.value].sort(
    (a, b) => b.at - a.at || (a.kind === "run" ? -1 : 1),
  ),
);

const selectedItem = computed(() => items.value.find((item) => item.selected) ?? null);

const selectedIsLive = computed(() => props.live && selectedItem.value?.isLatest === true);

const selectorLabel = computed(() => selectedItem.value?.label ?? t("alerts.incidents.rcaHistory"));
</script>
