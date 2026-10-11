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
  <OPageLayout
    :title="notFound ? t('reports.history.notFoundTitle') : raw(report?.name || '')"
    icon="description"
    :subtitle="subtitle"
    :back="backTarget"
    title-data-test="reports-reportdetail-title"
    bleed
    tabs-below
  >
    <template #title-trail>
      <div v-if="report" class="flex items-center gap-2">
        <OTag
          :variant="report.enabled ? 'success-soft' : 'default-soft'"
          :label="report.enabled ? t('reports.history.enabled') : t('reports.history.paused')"
          data-test="reports-reportdetail-enabled"
        />
        <OTag
          v-if="overdue"
          type="reportRunStatus"
          value="overdue"
          data-test="reports-reportdetail-overdue"
        />
      </div>
    </template>

    <template #actions>
      <OButton
        v-if="report"
        variant="primary"
        size="sm-action"
        icon-left="send"
        :loading="running"
        data-test="reports-reportdetail-run-now"
        @click="runNowOpen = true"
      >
        {{ t("reports.history.runNow") }}
      </OButton>
      <OButton
        v-if="report"
        variant="outline"
        size="sm-action"
        icon-left="edit"
        data-test="reports-reportdetail-edit"
        @click="editReport()"
      >
        {{ t("alerts.edit") }}
      </OButton>
    </template>

    <template #header-tabs>
      <OTabs
        :model-value="activeTab"
        align="left"
        data-test="reports-reportdetail-tabs"
        @change="onTabChange"
      >
        <OTab name="history" :label="t('reports.history.tab')" icon="history" />
        <OTab name="configuration" :label="t('reports.history.configurationTab')" icon="settings" />
      </OTabs>
    </template>

    <OContent v-if="notFound" class="py-6">
      <OEmptyState
        size="hero"
        :title="t('reports.history.notFoundTitle')"
        :description="t('reports.history.notFoundDescription')"
        hide-action
        data-test="reports-reportdetail-not-found"
      />
    </OContent>

    <template v-else-if="report">
      <ReportRunHistory
        v-if="activeTab === 'history'"
        ref="historyRef"
        :report-id="reportId"
        :report="report"
        :show-cached-tile="isCached"
        :running="running"
        @run-now="runNowOpen = true"
      />
      <OContent v-else class="h-full overflow-y-auto py-4">
        <ODescriptionList data-test="reports-reportdetail-configuration">
          <ODescriptionItem :label="t('reports.history.configTitle')">
            {{ report.title }}
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.configDescription')">
            <template v-if="report.description">{{ report.description }}</template>
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.configSchedule')">
            {{ frequencyText }}
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.configTimezone')">
            <template v-if="report.timezone">{{ report.timezone }}</template>
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.colRecipients')" stacked>
            <template v-if="recipients.length">{{ recipients.join(", ") }}</template>
            <template v-else>{{ t("reports.history.noRecipients") }}</template>
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.colAttachment')">
            <template v-if="attachmentType">{{ attachmentType }}</template>
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.colDashboards')">
            {{ report.dashboards?.length ?? 0 }}
          </ODescriptionItem>
          <ODescriptionItem :label="t('reports.history.lastRun')">
            <OTag type="reportRunStatus" :value="lastRunValue" />
          </ODescriptionItem>
        </ODescriptionList>
      </OContent>
    </template>

    <ReportRunNowDialog
      v-if="report"
      v-model:open="runNowOpen"
      :report-id="reportId"
      :report-name="report.name"
      :last-run-status="report.last_run_status"
      :last-run-error="report.last_run_error"
      @update:running="running = $event"
      @ran="historyRef?.afterManualRun()"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import ReportRunHistory from "@/components/reports/ReportRunHistory.vue";
import ReportRunNowDialog from "@/components/reports/ReportRunNowDialog.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import { reportByIdQuery } from "@/services/reports.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import { isOverdue, lastRunChip } from "@/utils/reports/reportRun";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();

const reportId = computed(() => String(route.params.report_id || ""));
const historyRef = ref<InstanceType<typeof ReportRunHistory> | null>(null);
const running = ref(false);
const runNowOpen = ref(false);

const detail = useQuery(() =>
  Object.assign(reportByIdQuery(orgId.value, reportId.value), {
    enabled: !!orgId.value && !!reportId.value,
  }),
);
const report = computed<any>(() => detail.data.value ?? null);
const notFound = computed(() => !!detail.error.value);

const activeTab = computed(() =>
  route.query.tab === "configuration" ? "configuration" : "history",
);
const onTabChange = (name: string | number) =>
  router.replace({ query: { ...route.query, tab: String(name), run: undefined } });

const recipients = computed<string[]>(() =>
  (report.value?.destinations ?? [])
    .map((d: { email?: string }) => d.email)
    .filter((e: string | undefined): e is string => !!e),
);
const isCached = computed(() => !!report.value && recipients.value.length === 0);
const attachmentType = computed<string>(() => report.value?.dashboards?.[0]?.report_type ?? "");
const overdue = computed(() => !!report.value && isOverdue(report.value));
const lastRunValue = computed(() =>
  report.value ? lastRunChip(report.value, isCached.value) : "never",
);

const frequencyText = computed<I18nText>(() => {
  const f = report.value?.frequency;
  if (!f) return raw("");
  const n = Number(f.interval) || 1;
  switch (f.type) {
    case "once":
      return t("reports.history.frequencyOnce");
    case "cron":
      return t("reports.history.frequencyCron", { cron: raw(f.cron) });
    case "hours":
      return t("reports.history.everyHours", { count: n }, n);
    case "weeks":
      return t("reports.history.everyWeeks", { count: n }, n);
    case "months":
      return t("reports.history.everyMonths", { count: n }, n);
    default:
      return t("reports.history.everyDays", { count: n }, n);
  }
});

const subtitle = computed<I18nText>(() => {
  const r = report.value;
  if (!r) return raw("");
  const tz = r.timezone || "UTC";
  const parts: string[] = [`${frequencyText.value} (${tz})`];
  if (r.next_run_at && r.enabled) {
    parts.push(
      t("reports.history.nextRunAt", {
        time: raw(formatTimestampInTimezone(r.next_run_at, "ddd D MMM, HH:mm", tz)),
      }),
    );
  }
  const dashboards = r.dashboards?.length ?? 0;
  parts.push(t("reports.history.dashboardCount", { count: dashboards }, dashboards));
  if (!isCached.value) {
    const count = recipients.value.length;
    parts.push(t("reports.history.recipientCount", { count }, count));
  }
  if (attachmentType.value) parts.push(attachmentType.value.toUpperCase());
  return raw(parts.join(" · "));
});

const backTarget = computed(() => ({
  label: t("reports.header"),
  to: {
    name: "reports",
    query: { org_identifier: orgId.value, folder: route.query.folder || "default" },
  },
}));

const editReport = (step?: string) =>
  router.push({
    name: "createReport",
    query: {
      report_id: reportId.value,
      name: report.value?.name,
      org_identifier: orgId.value,
      folder: (route.query.folder as string) || "default",
      ...(step ? { step } : {}),
      returnTo: router.resolve({
        name: "reportDetail",
        params: { report_id: reportId.value },
        query: { org_identifier: orgId.value, tab: "history" },
      }).fullPath,
    },
  });
</script>
