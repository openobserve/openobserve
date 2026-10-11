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
  <ODrawer
    :open="open && !!run"
    size="md"
    :title="title"
    title-data-test="reports-reportrundrawer-title"
    data-test="reports-reportrundrawer"
    @update:open="emit('update:open', $event)"
  >
    <div v-if="run" class="flex flex-col gap-5">
      <div class="flex items-center gap-2">
        <OTag
          type="reportRunStatus"
          :value="runChip(run)"
          data-test="reports-reportrundrawer-status"
        />
        <span class="text-compact text-text-secondary">
          {{ t("reports.history.attempt", { count: run.retries + 1 }) }}
        </span>
      </div>

      <OBanner
        v-if="run.error"
        :variant="run.status === 'error' ? 'error' : 'warning'"
        :content="raw(run.error)"
        preserve-whitespace
        data-test="reports-reportrundrawer-error"
      />

      <section class="flex flex-col gap-2">
        <h3 class="text-text-heading text-sm font-semibold">
          {{ t("reports.history.deliverySection") }}
        </h3>
        <ODescriptionList dense>
          <ODescriptionItem :label="t('reports.history.colRecipients')">
            <template v-if="run.is_cached">{{ t("reports.history.noRecipients") }}</template>
            <template v-else-if="recipients.length">{{ recipients.join(", ") }}</template>
            <template v-else-if="run.recipient_count != null">{{ run.recipient_count }}</template>
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.colAttachment')">
            <template v-if="run.attachment_type">
              {{
                t(
                  "reports.history.attachmentValue",
                  {
                    type: run.attachment_type,
                    count: run.dashboard_count ?? 0,
                  },
                  run.dashboard_count ?? 0,
                )
              }}
            </template>
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.outcome')" stacked>
            <span data-test="reports-reportrundrawer-outcome">{{ outcome }}</span>
          </ODescriptionItem>
        </ODescriptionList>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-text-heading text-sm font-semibold">
          {{ t("reports.history.timingSection") }}
        </h3>
        <ODescriptionList dense>
          <ODescriptionItem
            v-if="run.trigger_source === 'manual'"
            :label="t('reports.history.triggeredBy')"
          >
            {{ run.triggered_by || t("reports.history.triggerManual") }}
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.scheduledFor')">
            <template v-if="run.scheduled_for">
              {{ inReportZone(run.scheduled_for) }}
            </template>
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.pickedUp')">
            <template v-if="run.delay_in_secs != null">
              {{
                t("reports.history.secondsLater", { count: run.delay_in_secs }, run.delay_in_secs)
              }}
            </template>
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.finished')">
            <template v-if="finishedAfter != null">
              {{
                t("reports.history.finishedValue", {
                  after: finishedAfter,
                  took: durationSecs ?? 0,
                })
              }}
            </template>
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.colQueueTime')">
            <template v-if="run.time_in_queue_ms != null">
              {{ t("reports.history.milliseconds", { count: run.time_in_queue_ms }) }}
            </template>
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.colNode')">
            <template v-if="run.source_node">{{ run.source_node }}</template>
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.colTraceId')" stacked>
            <span v-if="run.scheduler_trace_id" class="text-compact font-mono break-all">{{
              run.scheduler_trace_id
            }}</span>
          </ODescriptionItem>
        </ODescriptionList>
      </section>

      <section v-if="dashboards.length" class="flex flex-col gap-2">
        <h3 class="text-text-heading text-sm font-semibold">
          {{ t("reports.history.dashboardsSection") }}
        </h3>
        <ul class="flex flex-col gap-1">
          <li v-for="(d, i) in dashboards" :key="i">
            <OButton
              variant="ghost-primary"
              size="sm"
              :data-test="`reports-reportrundrawer-dashboard-${i}`"
              @click="openDashboard(d)"
            >
              {{ t("reports.history.dashboardLink", { tab: d.tabs?.[0] ?? "" }) }}
            </OButton>
          </li>
        </ul>
      </section>

      <p class="text-text-secondary text-xs">{{ t("reports.history.retryWarning") }}</p>
    </div>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <OButton
          v-if="canEdit && !run?.is_cached"
          variant="outline"
          size="sm-action"
          icon-left="edit"
          data-test="reports-reportrundrawer-edit-recipients"
          @click="emit('edit-recipients')"
        >
          {{ t("reports.history.editRecipients") }}
        </OButton>
        <OButton
          v-if="canTrigger"
          variant="primary"
          size="sm-action"
          icon-left="send"
          :loading="running"
          data-test="reports-reportrundrawer-run-now"
          @click="emit('run-now')"
        >
          {{ t("reports.history.runNow") }}
        </OButton>
      </div>
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import type { ReportRunHit } from "@/services/reports";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import { microsToSeconds, runChip } from "@/utils/reports/reportRun";

interface RenderedDashboard {
  dashboard: string;
  folder: string;
  tabs?: string[];
  timerange?: { type?: string; period?: string; from?: number; to?: number };
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    run: ReportRunHit | null;
    /** The report's current configuration, when the page has it. */
    report?: any;
    canEdit?: boolean;
    canTrigger?: boolean;
    running?: boolean;
  }>(),
  { report: null, canEdit: true, canTrigger: true, running: false },
);

const emit = defineEmits<{
  "update:open": [value: boolean];
  "run-now": [];
  "edit-recipients": [];
}>();

const { t } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();

const timezone = computed(() => props.report?.timezone || undefined);

const inReportZone = (us: number) =>
  raw(
    formatTimestampInTimezone(us, "ddd D MMM, HH:mm", timezone.value ?? "UTC") +
      (timezone.value ? ` (${timezone.value})` : ""),
  );

const title = computed(() =>
  props.run
    ? t("reports.history.drawerTitle", {
        time: formatTimestampInTimezone(
          props.run.timestamp,
          "ddd D MMM, HH:mm",
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      })
    : t("reports.history.tab"),
);

const recipients = computed<string[]>(() =>
  (props.report?.destinations ?? [])
    .map((d: { email?: string }) => d.email)
    .filter((e: string | undefined): e is string => !!e),
);

const dashboards = computed<RenderedDashboard[]>(() => props.report?.dashboards ?? []);

const durationSecs = computed(() =>
  props.run?.duration_ms != null ? Math.round(props.run.duration_ms / 1000) : null,
);

/** Offset of the finish from the due time, so viewers in other zones read no conflicting clock. */
const finishedAfter = computed(() => {
  const run = props.run;
  if (!run?.finished_at) return null;
  return microsToSeconds(run.finished_at - (run.scheduled_for ?? run.timestamp));
});

const outcome = computed(() => {
  const run = props.run;
  if (!run) return "";
  if (run.is_cached) return t("reports.history.outcomeCached");
  if (run.status === "succeeded") {
    return run.is_partial
      ? t("reports.history.outcomePartial")
      : t("reports.history.outcomeAccepted");
  }
  if (run.status === "error") return t("reports.history.outcomeRejected");
  return t("reports.history.outcomeNotSent");
});

const openDashboard = (d: RenderedDashboard) => {
  const range = d.timerange;
  router.push({
    name: "viewDashboard",
    query: {
      org_identifier: orgId.value,
      dashboard: d.dashboard,
      folder: d.folder,
      tab: d.tabs?.[0],
      ...(range?.type === "absolute"
        ? { from: String(range.from), to: String(range.to) }
        : { period: range?.period }),
    },
  });
};
</script>
