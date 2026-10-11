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
  <ConfirmDialog
    :model-value="open"
    data-test="reports-reportrunnowdialog"
    :title="title"
    :message="message"
    :warning-message="warning"
    :ok-label="t('reports.history.runNow')"
    @update:model-value="emit('update:open', $event)"
    @update:ok="runNow"
    @update:cancel="emit('update:open', false)"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import { queryClient } from "@/composables/query/queryClient";
import { reportByIdQuery, triggerReportMutation } from "@/services/reports.queries";
import type { ReportRunHit, TriggerReportResponse } from "@/services/reports";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped } from "@/types/i18n";
import { rememberManualRun, runKey } from "@/utils/reports/reportRun";

const props = defineProps<{
  open: boolean;
  reportId: string;
  reportName: string;
  lastRunStatus?: string | null;
  lastRunError?: string | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  "update:running": [value: boolean];
  ran: [run: ReportRunHit];
}>();

const { t } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();
const recipients = ref<string[] | null>(null);
const recipientsFailed = ref(false);
const trigger = useMutation(triggerReportMutation(orgId.value));

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    recipients.value = null;
    recipientsFailed.value = false;
    try {
      const report: any = await queryClient.fetchQuery(
        reportByIdQuery(orgId.value, props.reportId),
      );
      recipients.value = (report?.destinations ?? [])
        .map((d: { email?: string }) => d.email)
        .filter((e: string | undefined): e is string => !!e);
    } catch {
      // Unknown recipients are not "no recipients": the send still emails everyone configured.
      recipientsFailed.value = true;
    }
  },
  { immediate: true },
);

const isCached = computed(() => recipients.value !== null && recipients.value.length === 0);

const title = computed(() =>
  isCached.value
    ? t("reports.history.runNowCachedTitle")
    : t("reports.history.runNowTitle", { name: props.reportName }),
);

const message = computed(() => {
  if (recipientsFailed.value) return t("reports.history.runNowRecipientsUnknown");
  if (recipients.value === null) return t("reports.history.runNowLoadingRecipients");
  if (isCached.value) return t("reports.history.runNowCachedBody");
  const count = recipients.value.length;
  return t("reports.history.runNowBody", { count, recipients: recipients.value.join(", ") }, count);
});

const warning = computed(() =>
  props.lastRunStatus === "error" && props.lastRunError
    ? t("reports.history.runNowLastError", { error: props.lastRunError })
    : undefined,
);

const openRun = (run: ReportRunHit) =>
  router.push({
    name: "reportDetail",
    params: { report_id: run.report_id },
    query: { org_identifier: orgId.value, tab: "history", run: runKey(run) },
  });

const runNow = async () => {
  emit("update:open", false);
  emit("update:running", true);
  try {
    const data = await trigger.mutateAsync(props.reportId);
    rememberManualRun(orgId.value, data.run);
    emit("ran", data.run);
    const count = data.run.recipient_count ?? 0;
    toast({
      variant: "success",
      message: data.run.is_cached
        ? t("reports.history.runNowCached")
        : t("reports.history.runNowSent", { count }, count),
      action: { label: t("reports.history.viewRun"), handler: () => openRun(data.run) },
    });
  } catch (err: any) {
    const body: TriggerReportResponse | undefined = err?.response?.data;
    if (err?.response?.status === 403) return;
    if (body?.run) {
      rememberManualRun(orgId.value, body.run);
      emit("ran", body.run);
    }
    toast({
      variant: "error",
      message: raw(body?.message) || t("reports.history.runNowFailed"),
      action: body?.run
        ? { label: t("reports.history.viewRun"), handler: () => openRun(body.run) }
        : undefined,
    });
  } finally {
    emit("update:running", false);
  }
};
</script>
