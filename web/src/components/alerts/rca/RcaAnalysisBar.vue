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

<!-- Analysis bar (contract E5): run version selector from the history, the
     trigger + age line, Re-analyze ▾ (not live; Fresh, Build on previous, With
     guidance… (04 frame I)) or Cancel run (live), and the ⋯ menu with Copy
     report / Download as Markdown / Copy thread. -->
<template>
  <div data-test="rca-analysis-bar" class="flex flex-wrap items-center gap-2.5">
    <ODropdown align="start" content-class="w-80">
      <template #trigger>
        <OButton data-test="rca-run-selector" variant="outline" size="sm">
          <span
            v-if="selectedIsLive"
            class="rca-live-dot bg-status-positive me-1.5 inline-block size-1.75 rounded-full"
            aria-hidden="true"
          />
          <OIcon v-else name="history" size="sm" class="text-text-secondary me-1.5" />
          <span data-test="rca-run-selector-label">{{ selectorLabel }}</span>
          <OIcon name="expand-more" size="sm" class="ms-1" />
        </OButton>
      </template>
      <ODropdownGroup :label="t('alerts.incidents.rcaHistory')">
        <ODropdownItem
          v-for="(item, idx) in items"
          :key="item.runId"
          :data-test="`rca-history-item-${idx}`"
          :disabled="!item.openable"
          :description="item.description"
          @select="$emit('select-run', item.isLatest ? null : item.runId)"
        >
          <span :class="item.selected ? 'font-bold' : 'font-semibold'">{{ item.label }}</span>
        </ODropdownItem>
      </ODropdownGroup>
    </ODropdown>

    <span
      data-test="rca-analysis-subtitle"
      class="text-text-secondary min-w-0 flex-1 truncate text-xs"
    >
      {{ subtitle }}
    </span>

    <OButton
      v-if="live"
      data-test="rca-cancel-btn"
      variant="ghost-destructive"
      size="sm"
      icon-left="stop-circle"
      :loading="cancelling"
      @click="$emit('cancel')"
    >
      {{ t("alerts.incidents.rcaRun.cancelRun") }}
    </OButton>

    <ODropdown v-else align="end" content-class="w-75">
      <template #trigger>
        <OButton data-test="rca-reanalyze-btn" variant="outline" size="sm" :loading="triggering">
          <OIcon name="refresh" size="sm" class="me-1" />
          {{ t("alerts.incidents.rcaReanalyze") }}
          <OIcon name="expand-more" size="sm" class="ms-1" />
        </OButton>
      </template>
      <ODropdownItem
        data-test="rca-reanalyze-fresh"
        :description="t('alerts.incidents.rcaFreshAnalysisHint')"
        @select="$emit('reanalyze', { buildOnPrevious: false })"
      >
        {{ t("alerts.incidents.rcaFreshAnalysis") }}
      </ODropdownItem>
      <ODropdownItem
        data-test="rca-reanalyze-build"
        :disabled="!canBuildOnPrevious"
        :description="t('alerts.incidents.rcaBuildOnPreviousHint')"
        @select="$emit('reanalyze', { buildOnPrevious: true })"
      >
        {{ t("alerts.incidents.rcaBuildOnPrevious") }}
      </ODropdownItem>
      <ODropdownItem
        data-test="rca-reanalyze-guidance"
        :description="t('alerts.incidents.rcaSteer.withGuidanceHint')"
        @select="$emit('reanalyze-guidance')"
      >
        {{ t("alerts.incidents.rcaSteer.withGuidance") }}
      </ODropdownItem>
    </ODropdown>

    <ODropdown align="end" content-class="w-55">
      <template #trigger>
        <OButton
          data-test="rca-more-btn"
          variant="outline"
          size="icon-toolbar"
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
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { RcaRunItem } from "@/services/incidents";
import { formatTimestampInTimezone } from "@/utils/date";
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
    /** A completed run exists to build on. */
    canBuildOnPrevious: boolean;
    hasThread: boolean;
    triggering?: boolean;
    cancelling?: boolean;
  }>(),
  { triggering: false, cancelling: false },
);

defineEmits<{
  "select-run": [runId: string | null];
  reanalyze: [options: { buildOnPrevious: boolean }];
  /** "With guidance…": open the frame I dialog. */
  "reanalyze-guidance": [];
  cancel: [];
  "copy-report": [];
  "download-report": [];
  "copy-thread": [];
}>();

const { t } = useI18nTyped();

const runTime = (us: number) => formatTimestampInTimezone(us, "MMM D, HH:mm", "UTC");

const items = computed(() =>
  props.runs.map((run, idx) => {
    const number = props.runs.length - idx;
    const isLatest = run.run_id === props.latestRunId;
    const liveRun = isLatest && props.live;
    const parts: string[] = [rcaTriggerLabel(run.trigger, run.started_by)];
    if (run.state === "failed") parts.push(t("alerts.incidents.rcaRun.state.failed"));
    if (run.state === "cancelled") parts.push(t("alerts.incidents.rcaRun.state.cancelled"));
    return {
      runId: run.run_id,
      isLatest,
      selected: run.run_id === props.selectedRunId,
      // Completed runs open a report; the latest run is always the way back.
      openable: isLatest || run.state === "completed",
      label: liveRun
        ? t("alerts.incidents.rcaRun.runLive", { number })
        : t("alerts.incidents.rcaRun.runAt", { number, time: runTime(run.started_at) }),
      description: raw(parts.join(" · ")),
    };
  }),
);

const selectedItem = computed(() => items.value.find((item) => item.selected) ?? null);

const selectedIsLive = computed(() => props.live && selectedItem.value?.isLatest === true);

const selectorLabel = computed(() => selectedItem.value?.label ?? t("alerts.incidents.rcaHistory"));
</script>

<style scoped>
/* Live pulse of the run selector (reference: o2pulse 1.4s). */
.rca-live-dot {
  animation: rca-live-pulse 1.4s ease-in-out infinite;
}

@keyframes rca-live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rca-live-dot {
    animation: none;
  }
}
</style>
