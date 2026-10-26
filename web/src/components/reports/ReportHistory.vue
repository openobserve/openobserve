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
  <div class="h-full min-h-0" data-test="reports-reporthistory">
    <ReportRunHistory
      ref="historyRef"
      :report-id="selectedReportId || undefined"
      show-report-column
      show-cached-tile
      :running="running"
      @run-now="openRunNow"
    >
      <template #toolbar-start>
        <OSelect
          :model-value="selectedReportId"
          :options="reportOptions"
          label-key="label"
          value-key="value"
          searchable
          clearable
          :loading="reportList.isLoading.value"
          :placeholder="t('reports.history.allReports')"
          class="min-w-56 max-md:min-w-40 max-md:flex-1"
          data-test="reports-reporthistory-report-select"
          @update:model-value="onReportSelected"
          @clear="onReportSelected(null)"
        />
      </template>
    </ReportRunHistory>

    <ReportRunNowDialog
      v-if="runNowTarget"
      v-model:open="runNowOpen"
      :report-id="runNowTarget.id"
      :report-name="runNowTarget.name"
      @update:running="running = $event"
      @ran="historyRef?.afterManualRun()"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRoute, useRouter } from "vue-router";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ReportRunHistory from "@/components/reports/ReportRunHistory.vue";
import ReportRunNowDialog from "@/components/reports/ReportRunNowDialog.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import { reportsQuery } from "@/services/reports.queries";
import { raw, useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();

const historyRef = ref<InstanceType<typeof ReportRunHistory> | null>(null);
const running = ref(false);
const runNowOpen = ref(false);
const runNowTarget = ref<{ id: string; name: string } | null>(null);

const reportList = useQuery(() =>
  Object.assign(reportsQuery(orgId.value, { folder: undefined, isCache: undefined }), {
    enabled: !!orgId.value,
  }),
);

const reportOptions = computed(() =>
  (reportList.data.value ?? []).map((r: any) => ({ label: raw(r.name), value: r.report_id })),
);

/** The report filter lives in the URL so the org-wide view can be shared filtered. */
const selectedReportId = computed(() =>
  typeof route.query.report_id === "string" ? route.query.report_id : "",
);

const onReportSelected = (value: unknown) => {
  const { report_id: _old, run: _run, ...rest } = route.query;
  router.replace({ query: value ? { ...rest, report_id: String(value) } : rest });
};

const openRunNow = (reportId?: string) => {
  const id = reportId || selectedReportId.value;
  if (!id) return;
  const found = (reportList.data.value ?? []).find((r: any) => r.report_id === id);
  runNowTarget.value = { id, name: found?.name ?? "" };
  runNowOpen.value = true;
};
</script>
