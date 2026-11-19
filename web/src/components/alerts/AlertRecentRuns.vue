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

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { formatInTimeZone } from "date-fns-tz";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { alertHistoryQuery } from "@/services/alerts.queries";
import { historyStatusOf } from "@/utils/alerts/ackState";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { everyWords } from "@/utils/alerts/alertCopy";
import {
  ksuidSeconds,
  newestRuns,
  noChecksNotice,
  recentRunsParams,
  RECENT_RUNS_LIMIT,
  runClock,
} from "@/utils/alerts/recentRuns";

const props = withDefaults(
  defineProps<{
    alertId: string;
    folderId?: string;
    /** How many runs to list. */
    limit?: number;
    /** Minutes between checks of an enabled alert that should have checked in the last day. */
    expectedEveryMinutes?: number;
    /** The alert's `updated_at` in seconds; without one, the id's creation time is used. */
    savedAt?: number;
    /** A real-time alert lists only the matches that notified; it records no quiet checks. */
    isRealTime?: boolean;
  }>(),
  {
    folderId: undefined,
    limit: RECENT_RUNS_LIMIT,
    expectedEveryMinutes: undefined,
    savedAt: undefined,
    isRealTime: false,
  },
);

const { t } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();
const zone = useViewerTimezone();

const nowMs = Date.now();

const historyQuery = useQuery(() =>
  Object.assign(
    alertHistoryQuery(orgId.value, recentRunsParams(props.alertId, nowMs * 1000, props.limit)),
    { enabled: !!orgId.value && !!props.alertId },
  ),
);

const runs = computed(() => newestRuns(historyQuery.data.value, props.limit));

const timeText = (micros?: number) =>
  raw(micros ? formatInTimeZone(new Date(micros / 1000), zone.value, "MMM d, HH:mm") : "—");

const clockText = (ms: number) => raw(runClock(ms, zone.value, nowMs));

const emptyNotice = computed(() => {
  if (props.isRealTime) {
    const savedSec = props.savedAt ?? ksuidSeconds(props.alertId);
    const savedMs = savedSec ? savedSec * 1000 : 0;
    return {
      warn: false,
      text:
        savedMs > nowMs - 24 * 60 * 60 * 1000
          ? t("alerts.editMode.recentRuns.emptyRealtimeSinceSave", { time: clockText(savedMs) })
          : t("alerts.editMode.recentRuns.emptyRealtime"),
    };
  }
  const notice = noChecksNotice({
    everyMinutes: props.expectedEveryMinutes,
    savedAtSec: props.savedAt ?? ksuidSeconds(props.alertId),
    nowMs,
  });
  if (notice.kind === "none") return { warn: false, text: t("alerts.editMode.recentRuns.empty") };
  if (notice.kind === "firstDue")
    return {
      warn: false,
      text: t("alerts.editMode.recentRuns.firstDue", { time: clockText(notice.byMs) }),
    };
  const every = everyWords(props.expectedEveryMinutes ?? 0, t);
  return {
    warn: true,
    text: notice.savedMs
      ? t("alerts.editMode.recentRuns.emptySinceSave", { time: clockText(notice.savedMs), every })
      : t("alerts.editMode.recentRuns.emptyExpected", { every }),
  };
});

const openRun = () =>
  router.push({
    name: "alertDetail",
    params: { alert_id: props.alertId },
    query: { folder: props.folderId, org_identifier: orgId.value },
  });
</script>

<template>
  <div
    class="bg-surface-base border-border-default rounded-surface flex shrink-0 flex-col overflow-hidden border"
    data-test="add-alert-recent-runs"
  >
    <div class="border-border-default flex shrink-0 items-center gap-2 border-b px-3 py-2">
      <span class="text-sm font-medium">{{
        isRealTime
          ? t("alerts.editMode.recentRuns.titleRealtime")
          : t("alerts.editMode.recentRuns.title")
      }}</span>
    </div>
    <p
      v-if="historyQuery.isError.value"
      class="text-text-secondary m-0 px-3 py-2 text-sm"
      data-test="add-alert-recent-runs-error"
    >
      {{ t("alerts.editMode.recentRuns.failed") }}
    </p>
    <p
      v-else-if="!historyQuery.isLoading.value && runs.length === 0"
      class="m-0 px-3 py-2 text-sm"
      :class="emptyNotice.warn ? 'text-status-warning-text' : 'text-text-secondary'"
      data-test="add-alert-recent-runs-empty"
    >
      {{ emptyNotice.text }}
    </p>
    <ol v-else class="m-0 flex list-none flex-col p-0">
      <li
        v-for="(run, index) in runs"
        :key="`${run.timestamp}-${index}`"
        class="border-border-default flex flex-col gap-1 border-b px-3 py-2 last:border-b-0"
        data-test="add-alert-recent-run"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="text-text-body shrink-0 text-xs tabular-nums">{{
            timeText(run.timestamp)
          }}</span>
          <OTag
            type="alertState"
            :value="historyStatusOf(run)"
            size="sm"
            data-test="add-alert-recent-run-status"
          />
          <OButton
            variant="ghost-primary"
            size="xs"
            class="ms-auto"
            data-test="add-alert-recent-run-open"
            @click="openRun"
            >{{ t("alerts.editMode.recentRuns.openRun") }}</OButton
          >
        </div>
        <span
          v-if="run.error"
          class="text-status-error-text line-clamp-3 font-mono text-xs break-words"
          data-test="add-alert-recent-run-error"
          >{{ run.error }}</span
        >
      </li>
    </ol>
    <p class="text-text-secondary m-0 px-3 pb-2 text-xs">
      {{
        isRealTime
          ? t("alerts.editMode.recentRuns.noteRealtime")
          : t("alerts.editMode.recentRuns.note")
      }}
    </p>
  </div>
</template>
