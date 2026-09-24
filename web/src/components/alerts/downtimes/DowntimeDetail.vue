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
    bleed
    :title="title"
    :subtitle="subtitle"
    icon="notifications-paused"
    :back="{
      label: t('alerts.downtimes.title'),
      onClick: goBack,
      dataTest: 'downtime-detail-back',
    }"
    tabs-below
    title-data-test="downtime-detail-title"
  >
    <template v-if="downtime" #title-trail>
      <OTag type="downtimeStatus" :value="downtime.status" data-test="downtime-detail-status" />
    </template>

    <template v-if="downtime" #actions-overflow>
      <OButton
        variant="outline"
        size="sm"
        icon-left="edit"
        data-test="downtime-detail-edit"
        @click="editDowntime"
      >
        {{ t("alerts.downtimes.actions.edit") }}
      </OButton>
      <OButton
        variant="outline"
        size="sm"
        icon-left="notifications-paused"
        :loading="muteMutation.isPending.value"
        data-test="downtime-detail-mute-hour"
        @click="muteForHour"
      >
        {{ t("alerts.downtimes.actions.muteForHour") }}
      </OButton>
    </template>

    <template v-if="downtime && cancellable" #actions>
      <OButton
        variant="destructive"
        size="sm"
        data-test="downtime-detail-cancel"
        @click="cancelOpen = true"
      >
        {{ t("alerts.downtimes.actions.cancel") }}
      </OButton>
    </template>

    <template #header-tabs>
      <OTabs v-model="activeTab" data-test="downtime-detail-tabs">
        <OTab
          name="overview"
          :label="t('alerts.downtimes.detail.overview')"
          data-test="downtime-detail-tab-overview"
        />
        <OTab
          name="affected"
          :label="t('alerts.downtimes.detail.affected', { count: affectedTotal })"
          data-test="downtime-detail-tab-affected"
        />
        <OTab
          name="suppressed"
          :label="t('alerts.downtimes.detail.suppressed', { count: suppressedTotal })"
          data-test="downtime-detail-tab-suppressed"
        />
      </OTabs>
    </template>

    <OContent class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto py-3">
      <div v-if="!downtime" class="relative min-h-40" data-test="downtime-detail-loading">
        <OEmptyState v-if="forbidden" preset="no-access" size="block" />
        <OInnerLoading v-else :showing="detailQuery.isPending.value" size="sm" />
      </div>

      <template v-else-if="activeTab === 'overview'">
        <section class="flex flex-col gap-2" data-test="downtime-detail-overview">
          <h2 class="text-text-heading text-sm font-semibold">
            {{ t("alerts.downtimes.detail.details") }}
          </h2>
          <ODescriptionList :columns="2">
            <ODescriptionItem :label="t('alerts.downtimes.detail.condition')" stacked>
              <OTag
                v-if="conditionText"
                type="downtimeTarget"
                value="condition"
                :label="conditionText"
                data-test="downtime-detail-condition"
              />
            </ODescriptionItem>
            <ODescriptionItem
              v-for="target in sortedTargets(downtime.targets)"
              :key="target.module"
              :label="t(MODULE_LABEL_KEYS[target.module])"
            >
              {{ targetSummary(target, t, targetFolderName).text }}
            </ODescriptionItem>
            <ODescriptionItem
              v-for="m in missingModules"
              :key="m"
              :label="t(MODULE_LABEL_KEYS[m])"
              :empty-label="t('alerts.downtimes.detail.noTarget')"
            />
            <ODescriptionItem :label="t('alerts.downtimes.detail.banner')">
              {{
                downtime.show_banner
                  ? t("alerts.downtimes.detail.bannerOn")
                  : t("alerts.downtimes.detail.bannerOff")
              }}
            </ODescriptionItem>
            <ODescriptionItem :label="t('alerts.downtimes.columns.schedule')">
              {{ scheduleSentence(downtime.schedule, t) }}
            </ODescriptionItem>
            <ODescriptionItem :label="t('alerts.downtimes.form.reason')">
              <template v-if="downtime.reason">{{ downtime.reason }}</template>
            </ODescriptionItem>
            <ODescriptionItem :label="t('alerts.downtimes.columns.createdBy')">
              <span class="inline-flex items-center gap-2">
                <OUserCell :value="downtime.created_by" />
                <OTimeCell :value="downtime.created_at" unit="us" mode="date" />
              </span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('alerts.downtimes.columns.folder')">
              {{ folderLabel }}
            </ODescriptionItem>
          </ODescriptionList>
        </section>

        <section class="flex flex-col gap-2" data-test="downtime-detail-occurrences">
          <h2 class="text-text-heading text-sm font-semibold">
            {{ t("alerts.downtimes.detail.occurrences") }}
          </h2>
          <DowntimeScheduleBand
            :past="pastWindows"
            :active="downtime.current_window"
            :next="downtime.status === 'cancelled' ? null : downtime.next_window"
            :timezone="downtime.schedule.timezone"
            :now-micros="nowMicros"
          />
          <p v-if="nextWindow" class="text-text-body text-xs" data-test="downtime-detail-next">
            {{
              t("alerts.downtimes.detail.nextWindow", {
                window: formatWindow(nextWindow, downtime.schedule.timezone, t),
                local: formatWindow(nextWindow, viewerZone, t),
              })
            }}
          </p>
        </section>
      </template>

      <template v-else-if="activeTab === 'affected'">
        <div
          v-for="section in affectedSections"
          :key="section.module"
          class="flex flex-col gap-2"
          :data-test="`downtime-detail-affected-${section.module}`"
        >
          <h2 class="text-text-heading text-sm font-semibold">
            {{
              t("alerts.downtimes.detail.sectionCount", {
                name: t(MODULE_LABEL_KEYS[section.module]),
                count: section.rows.length,
              })
            }}
          </h2>
          <OTable
            :data="section.rows"
            :columns="affectedColumns"
            row-key="id"
            :fill-height="false"
            :show-global-filter="false"
            :page-size="20"
            :page-size-options="[20, 50, 100]"
          />
        </div>
      </template>

      <template v-else>
        <OTable
          :data="suppressedRows"
          :columns="suppressedColumns"
          row-key="key"
          :loading="historyQuery.isPending.value"
          :fill-height="false"
          :show-global-filter="false"
          :page-size="20"
          :page-size-options="[20, 50, 100]"
          data-test="downtime-detail-suppressed-table"
        >
          <template #cell-timestamp="{ row }">
            <OTimeCell :value="row.timestamp" unit="us" :timezone="viewerZone" />
          </template>
          <template #empty>
            <div data-test="downtime-detail-suppressed-empty">
              <OEmptyState
                size="block"
                illustration="history"
                :title="t('alerts.downtimes.detail.noSuppressed')"
              />
            </div>
          </template>
        </OTable>
      </template>
    </OContent>

    <ConfirmDialog
      v-model="cancelOpen"
      :title="t('alerts.downtimes.confirmCancel.title')"
      :message="t('alerts.downtimes.confirmCancel.message')"
      @update:ok="confirmCancel"
      @update:cancel="cancelOpen = false"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { foldersQuery } from "@/services/common.queries";
import { alertHistoryQuery } from "@/services/alerts.queries";
import {
  cancelDowntimeMutation,
  downtimeDetailQuery,
  quickMuteMutation,
} from "@/services/downtimes.queries";
import type { PreviewMatch, TargetModule } from "@/services/downtimes";
import { useToast } from "@/lib/feedback/Toast/useToast";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import {
  currentOrNextWindow,
  formatWindow,
  recentWindows,
  scheduleSentence,
} from "@/utils/downtimes/schedule";
import {
  MODULE_LABEL_KEYS,
  MODULE_ORDER,
  conditionSummary,
  sortedTargets,
  targetSummary,
  type FolderNameFn,
} from "@/utils/downtimes/targetSummary";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import DowntimeScheduleBand from "./DowntimeScheduleBand.vue";

type DetailTab = "overview" | "affected" | "suppressed";

const HOUR_MICROS = 3600 * 1_000_000;
const HISTORY_DAYS = 90;

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();
const { toast } = useToast();

const id = computed(() => String(route.params.id ?? ""));
const folderParam = computed(() => String(route.query.folder ?? "") || undefined);
const activeTab = ref<DetailTab>("overview");
const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const nowMicros = Date.now() * 1000;

const detailQuery = useQuery(() =>
  Object.assign(downtimeDetailQuery(orgId.value, id.value, folderParam.value), {
    enabled: !!orgId.value && !!id.value,
  }),
);
const downtime = computed(() => detailQuery.data.value ?? null);
const forbidden = computed(() => {
  const e: any = detailQuery.error.value;
  return e?.status === 403 || e?.response?.status === 403;
});

const downtimeFolders = useQuery(() =>
  Object.assign(foldersQuery(orgId.value, "downtimes"), { enabled: !!orgId.value }),
);
const alertFolders = useQuery(() =>
  Object.assign(foldersQuery(orgId.value, "alerts"), { enabled: !!orgId.value }),
);
const syntheticFolders = useQuery(() =>
  Object.assign(foldersQuery(orgId.value, "synthetics"), { enabled: !!orgId.value }),
);

const historyQuery = useQuery(() =>
  Object.assign(
    alertHistoryQuery(orgId.value, {
      start_time: nowMicros - HISTORY_DAYS * 24 * HOUR_MICROS,
      end_time: nowMicros,
      from: 0,
      size: 500,
      downtime_id: id.value,
      status: "suppressed",
    }),
    { enabled: !!orgId.value && !!id.value },
  ),
);

const cancelMutation = useMutation(() => cancelDowntimeMutation(orgId.value));
const muteMutation = useMutation(() => quickMuteMutation(orgId.value));

const title = computed<I18nText>(() =>
  downtime.value ? raw(downtime.value.name) : t("alerts.downtimes.detailTitle"),
);
const subtitle = computed<I18nText | undefined>(() =>
  downtime.value ? scheduleSentence(downtime.value.schedule, t) : undefined,
);

const folderNameIn = (list: { folderId: string; name: string }[] | undefined, fid: string) =>
  list?.find((f) => f.folderId === fid)?.name;

const folderLabel = computed(() =>
  downtime.value
    ? (folderNameIn(downtimeFolders.data.value, downtime.value.folder_id) ??
      downtime.value.folder_id)
    : "",
);

const targetFolderName: FolderNameFn = (module, fid) =>
  folderNameIn(
    module === "synthetics" ? syntheticFolders.data.value : alertFolders.data.value,
    fid,
  );

const cancellable = computed(
  () => downtime.value?.status === "active" || downtime.value?.status === "scheduled",
);

const conditionText = computed(() =>
  downtime.value ? conditionSummary(downtime.value.condition, t) : null,
);
const missingModules = computed(() =>
  MODULE_ORDER.filter((m) => !(downtime.value?.targets ?? []).some((tg) => tg.module === m)),
);

const pastWindows = computed(() =>
  downtime.value ? recentWindows(downtime.value.schedule, nowMicros, 3) : [],
);

const nextWindow = computed(() =>
  downtime.value && downtime.value.status !== "cancelled"
    ? (downtime.value.next_window ?? currentOrNextWindow(downtime.value.schedule, nowMicros))
    : null,
);

// ── Affected ────────────────────────────────────────────────────────────────
const AFFECTED_KEYS: Record<TargetModule, "alerts" | "anomalies" | "synthetics" | "slos"> = {
  alerts: "alerts",
  anomaly_detections: "anomalies",
  synthetics: "synthetics",
  slos: "slos",
};

const affectedSections = computed(() => {
  const d = downtime.value;
  if (!d) return [];
  return sortedTargets(d.targets).map((tg) => ({
    module: tg.module,
    rows: d.affected?.[AFFECTED_KEYS[tg.module]] ?? [],
  }));
});

const affectedTotal = computed(() =>
  affectedSections.value.reduce((sum, s) => sum + s.rows.length, 0),
);

const MATCHED_BY_KEYS: Record<string, I18nKey> = {
  query: "alerts.downtimes.detail.matchedBy.query",
  source_alert: "alerts.downtimes.detail.matchedBy.source_alert",
  tag: "alerts.downtimes.detail.matchedBy.tag",
  id: "alerts.downtimes.detail.matchedBy.id",
  folder: "alerts.downtimes.detail.matchedBy.folder",
  org: "alerts.downtimes.detail.matchedBy.org",
};

const affectedColumns = computed<OTableColumnDef<PreviewMatch>[]>(() => [
  {
    id: "name",
    accessorKey: "name",
    header: t("alerts.downtimes.columns.name"),
    sortable: true,
    size: 320,
    meta: { isName: true, flex: true },
  },
  {
    id: "matched_by",
    header: t("alerts.downtimes.detail.matchedByHeader"),
    accessorFn: (row) =>
      row.matched_by && MATCHED_BY_KEYS[row.matched_by]
        ? t(MATCHED_BY_KEYS[row.matched_by])
        : "—",
    size: 160,
  },
  {
    id: "folder_id",
    header: t("alerts.downtimes.columns.folder"),
    accessorFn: (row) => row.folder_id,
    size: 160,
  },
]);

// ── Suppressed ──────────────────────────────────────────────────────────────
const suppressedRows = computed(() =>
  ((historyQuery.data.value as { hits?: any[] } | undefined)?.hits ?? []).map((hit, index) => ({
    key: `${hit.timestamp}-${index}`,
    source: hit.alert_name,
    timestamp: hit.timestamp,
    status: hit.status,
  })),
);

const suppressedTotal = computed(
  () => (historyQuery.data.value as { total?: number } | undefined)?.total ?? 0,
);

const suppressedColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "source",
    accessorKey: "source",
    header: t("alerts.downtimes.detail.source"),
    size: 320,
    meta: { isName: true, flex: true },
  },
  {
    id: "timestamp",
    accessorKey: "timestamp",
    header: t("alerts.downtimes.detail.wouldHaveNotified"),
    cell: " ",
    sortable: true,
    size: 200,
  },
  { id: "status", accessorKey: "status", header: t("alerts.downtimes.columns.status"), size: 140 },
]);

// ── Actions ─────────────────────────────────────────────────────────────────
const orgQuery = () => ({ org_identifier: orgId.value });

const goBack = () =>
  router.push({
    name: "downtimes",
    query: { ...orgQuery(), folder: downtime.value?.folder_id ?? "default" },
  });

const editDowntime = () =>
  router.push({
    name: "editDowntime",
    params: { id: id.value },
    query: { ...orgQuery(), folder: downtime.value?.folder_id },
  });

const cancelOpen = ref(false);
const confirmCancel = async () => {
  cancelOpen.value = false;
  try {
    await cancelMutation.mutateAsync({ id: id.value, folder: downtime.value?.folder_id });
    toast({ variant: "success", message: t("toastMessages.downtimes.cancelled") });
  } catch {
    toast({ variant: "error", message: t("toastMessages.downtimes.cancelFailed") });
  }
};

// A one-time child window with the same scope, for the hour from now.
const muteForHour = async () => {
  const d = downtime.value;
  if (!d) return;
  const startsAt = Date.now() * 1000;
  try {
    await muteMutation.mutateAsync({
      folder_id: d.folder_id,
      name: t("alerts.downtimes.detail.muteHourName", { name: d.name }),
      reason: d.reason,
      condition: d.condition,
      targets: d.targets,
      schedule: {
        repeat: "none",
        starts_at: startsAt,
        ends_at: startsAt + HOUR_MICROS,
        timezone: d.schedule.timezone,
        duration_secs: 3600,
        weekdays: [],
      },
      show_banner: false,
    });
    toast({ variant: "success", message: t("toastMessages.downtimes.created") });
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("toastMessages.downtimes.muteFailed"),
    });
  }
};
</script>
