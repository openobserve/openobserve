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

interface HistoryRow {
  timestamp?: number;
  status?: string;
  error?: string | null;
  acked_by?: string | null;
  ack_action?: string | null;
}

const props = withDefaults(
  defineProps<{
    alertId: string;
    folderId?: string;
    /** How many runs to list. */
    limit?: number;
  }>(),
  { folderId: undefined, limit: 5 },
);

const { t } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();
const zone = useViewerTimezone();

const DAY_MICROS = 24 * 60 * 60 * 1_000_000;
const endTime = Date.now() * 1000;

const historyQuery = useQuery(() =>
  Object.assign(
    alertHistoryQuery(orgId.value, {
      alert_id: props.alertId,
      start_time: endTime - DAY_MICROS,
      end_time: endTime,
      from: 0,
      size: props.limit,
    }),
    { enabled: !!orgId.value && !!props.alertId },
  ),
);

// The endpoint pages but promises no order.
const runs = computed(() =>
  [
    ...(((historyQuery.data.value as { hits?: HistoryRow[] } | undefined)?.hits ??
      []) as HistoryRow[]),
  ]
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, props.limit),
);

const timeText = (micros?: number) =>
  raw(micros ? formatInTimeZone(new Date(micros / 1000), zone.value, "MMM d, HH:mm") : "—");

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
      <span class="text-sm font-medium">{{ t("alerts.editMode.recentRuns.title") }}</span>
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
      class="text-text-secondary m-0 px-3 py-2 text-sm"
      data-test="add-alert-recent-runs-empty"
    >
      {{ t("alerts.editMode.recentRuns.empty") }}
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
      {{ t("alerts.editMode.recentRuns.note") }}
    </p>
  </div>
</template>
