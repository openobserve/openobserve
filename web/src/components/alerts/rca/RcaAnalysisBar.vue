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
  <div data-test="rca-analysis-bar" class="@container flex flex-nowrap items-center gap-2.5">
    <ODropdown align="start" content-class="w-80">
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

    <OButton
      v-if="!live"
      data-test="rca-reanalyze-btn"
      variant="outline"
      size="sm"
      class="shrink-0"
      icon-left="refresh"
      :loading="triggering"
      :disabled="resuming"
      @click="$emit('reanalyze')"
    >
      <span class="sr-only @2xl:not-sr-only">{{ t("alerts.incidents.rcaReanalyze") }}</span>
    </OButton>

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
    hasThread: boolean;
    /** The shown run has a report or a record and AI chat is available (J5). */
    canAsk?: boolean;
    triggering?: boolean;
    /** A resume is in flight: Re-analyze waits for it. */
    resuming?: boolean;
    cancelling?: boolean;
  }>(),
  {
    canAsk: false,
    triggering: false,
    resuming: false,
    cancelling: false,
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
      // Completed runs open a report and runs with a record (a cancelled or failed run's
      // partial ledger) open it; the latest run is always the way back.
      openable: isLatest || run.state === "completed" || run.has_record,
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
