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
    <template #title>
      <span class="inline-flex max-w-full min-w-0 items-center gap-2">
        <span class="truncate">{{ title }}</span>
        <BetaBadge class="shrink-0" />
      </span>
    </template>

    <template v-if="downtime" #title-trail>
      <OTag type="downtimeStatus" :value="downtime.status" data-test="downtime-detail-status" />
    </template>

    <template v-if="downtime" #actions-overflow>
      <OButton
        v-if="isEditable(downtime)"
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
      <ExtendDowntimeMenu
        :enabled="isExtendable(downtime)"
        data-test="downtime-detail-extend"
        @preset="(secs) => downtime && extendBy(downtime, secs)"
        @until="extendOpen = true"
      />
      <OButton
        variant="destructive"
        size="sm"
        :data-test="endsNow ? 'downtime-detail-end-now' : 'downtime-detail-cancel'"
        @click="cancelOpen = true"
      >
        {{ endsNow ? t("alerts.downtimes.actions.endNow") : t("alerts.downtimes.actions.cancel") }}
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
        <OTab
          name="notifications"
          :label="t('alerts.downtimes.notify.tab')"
          data-test="downtime-detail-tab-notifications"
        />
      </OTabs>
    </template>

    <OContent class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto py-3">
      <div v-if="!downtime" class="relative min-h-40" data-test="downtime-detail-loading">
        <OEmptyState v-if="forbidden" preset="no-access" size="block" />
        <OEmptyState
          v-else-if="notFound"
          size="block"
          illustration="no-results"
          :title="t('alerts.downtimes.detail.notFoundTitle')"
          :description="t('alerts.downtimes.detail.notFoundDescription')"
          :action-label="t('alerts.downtimes.detail.backToList')"
          data-test="downtime-detail-not-found"
          @action="goBack"
        />
        <OEmptyState
          v-else-if="detailQuery.isError.value"
          preset="load-error"
          size="block"
          data-test="downtime-detail-error"
          @action="detailQuery.refetch()"
        />
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
            :next="isCalledOff(downtime) ? null : downtime.next_window"
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
          >
            <template #cell-matched_by="{ row }">
              <span v-if="matchedByText(row)">{{ matchedByText(row) }}</span>
              <span v-else class="text-text-muted">—</span>
            </template>
            <template #cell-folder_id="{ row }">
              <span class="truncate">{{
                targetFolderName(section.module, row.folder_id) ?? raw(row.folder_id)
              }}</span>
            </template>
          </OTable>
        </div>
      </template>

      <template v-else-if="activeTab === 'notifications'">
        <section class="flex flex-col gap-2" data-test="downtime-detail-notifications">
          <div class="flex items-center gap-2">
            <span class="text-text-secondary min-w-0 flex-1 text-xs">
              {{ notifySentence(downtime.notifications, t) }}
            </span>
            <OButton
              variant="outline"
              size="sm"
              icon-left="send"
              :disabled="testDestinations.length === 0"
              :loading="testMutation.isPending.value"
              data-test="downtime-detail-send-test"
              @click="sendTest"
            >
              {{ t("alerts.downtimes.notify.test.send") }}
            </OButton>
          </div>
          <OTable
            :data="notificationRows"
            :columns="notificationColumns"
            row-key="key"
            :fill-height="false"
            :show-global-filter="false"
            :page-size="20"
            :page-size-options="[20, 50]"
            data-test="downtime-detail-notifications-table"
          >
            <template #cell-sent_at="{ row }">
              <OTimeCell :value="row.sent_at" unit="us" :timezone="viewerZone" />
            </template>
            <template #cell-result="{ row }">
              <span :class="row.failed ? 'text-status-error-text' : 'text-text-body'">
                {{ row.result }}
              </span>
            </template>
            <template #empty>
              <div data-test="downtime-detail-notifications-empty">
                <OEmptyState
                  size="block"
                  illustration="history"
                  :title="t('alerts.downtimes.notify.log.empty')"
                />
              </div>
            </template>
          </OTable>
        </section>
      </template>

      <template v-else>
        <OTable
          :data="suppressedRows"
          :columns="suppressedColumns"
          row-key="key"
          :loading="historyQuery.isLoading.value"
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
      v-if="endsNow"
      v-model="cancelOpen"
      :title="t('alerts.downtimes.confirmEndNow.title')"
      :message="t('alerts.downtimes.confirmEndNow.message')"
      :ok-label="t('alerts.downtimes.confirmEndNow.ok')"
      :cancel-label="t('alerts.downtimes.confirmEndNow.keep')"
      ok-color="destructive"
      @update:ok="confirmCancel"
      @update:cancel="cancelOpen = false"
    />
    <ConfirmDialog
      v-else
      v-model="cancelOpen"
      :title="t('alerts.downtimes.confirmCancel.title')"
      :message="t('alerts.downtimes.confirmCancel.message')"
      :ok-label="t('alerts.downtimes.confirmCancel.confirm', { count: 1 }, 1)"
      :cancel-label="t('alerts.downtimes.confirmCancel.keep', { count: 1 }, 1)"
      @update:ok="confirmCancel"
      @update:cancel="cancelOpen = false"
    />

    <ExtendDowntimeDialog
      v-model:open="extendOpen"
      :downtime="downtime"
      data-test="downtime-detail-extend-dialog"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { foldersQuery, optionalFoldersQuery } from "@/services/common.queries";
import { alertHistoryQuery } from "@/services/alerts.queries";
import {
  cancelDowntimeMutation,
  downtimeDetailQuery,
  quickMuteMutation,
} from "@/services/downtimes.queries";
import type {
  DowntimeNotificationLogEntry,
  NotificationEvent,
  PreviewMatch,
  TargetModule,
} from "@/services/downtimes";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { sendDowntimeTestMutation } from "@/services/downtimes.queries";
import { notifySentence } from "@/utils/downtimes/summary";
import type { TestDestination } from "@/utils/downtimes/notifyTest";
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
import BetaBadge from "@/components/common/BetaBadge.vue";
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
import ExtendDowntimeDialog from "./ExtendDowntimeDialog.vue";
import ExtendDowntimeMenu from "./ExtendDowntimeMenu.vue";
import { useExtendDowntime } from "@/composables/downtimes/useExtendDowntime";
import { isExtendable } from "@/utils/downtimes/extend";
import { isEditable } from "@/utils/downtimes/listOrder";
import { suppressedPage } from "@/utils/downtimes/suppressed";
import { browserTimezone } from "@/utils/timezoneAliases";

type DetailTab = "overview" | "affected" | "suppressed" | "notifications";

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
const viewerZone = browserTimezone();
const nowMicros = Date.now() * 1000;

const detailQuery = useQuery(() =>
  Object.assign(downtimeDetailQuery(orgId.value, id.value, folderParam.value), {
    enabled: !!orgId.value && !!id.value,
  }),
);
const downtime = computed(() => detailQuery.data.value ?? null);
const errorStatus = computed(() => {
  const e = detailQuery.error.value as { status?: number; response?: { status?: number } } | null;
  return e?.response?.status ?? e?.status;
});
const forbidden = computed(() => errorStatus.value === 403);
const notFound = computed(() => errorStatus.value === 404);

const downtimeFolders = useQuery(() =>
  Object.assign(foldersQuery(orgId.value, "downtimes"), { enabled: !!orgId.value }),
);
const alertFolders = useQuery(() =>
  Object.assign(optionalFoldersQuery(orgId.value, "alerts"), { enabled: !!orgId.value }),
);
const syntheticFolders = useQuery(() =>
  Object.assign(optionalFoldersQuery(orgId.value, "synthetics"), { enabled: !!orgId.value }),
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
    module === "synthetics"
      ? syntheticFolders.data.value?.folders
      : alertFolders.data.value?.folders,
    fid,
  );

const cancellable = computed(() => !!downtime.value && isEditable(downtime.value));
const endsNow = computed(() => downtime.value?.status === "active");
const isCalledOff = (d: { status: string }) =>
  d.status === "cancelled" || d.status === "ended_early";

const { extendBy } = useExtendDowntime();
const extendOpen = ref(false);

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
  downtime.value && !isCalledOff(downtime.value)
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

const matchedByText = (row: PreviewMatch) =>
  row.matched_by && MATCHED_BY_KEYS[row.matched_by] ? t(MATCHED_BY_KEYS[row.matched_by]) : null;

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
    accessorFn: (row) => matchedByText(row) ?? "",
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
const historyPage = computed(() => suppressedPage(historyQuery.data.value));

const suppressedRows = computed(() =>
  historyPage.value.hits.map((hit, index) => ({
    key: `${hit.timestamp}-${index}`,
    source: hit.alert_name,
    timestamp: hit.timestamp,
    status: hit.status,
  })),
);

const suppressedTotal = computed(() => historyPage.value.total);

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

const EVENT_LABEL_KEYS = {
  started: "alerts.downtimes.notify.log.events.started",
  ending_soon: "alerts.downtimes.notify.log.events.ending_soon",
  ended: "alerts.downtimes.notify.log.events.ended",
  cancelled: "alerts.downtimes.notify.log.events.cancelled",
  extended: "alerts.downtimes.notify.log.events.extended",
} as const satisfies Record<NotificationEvent, I18nKey>;

const RESULT_OK = "ok";

const resultText = (entry: DowntimeNotificationLogEntry): I18nText => {
  if (entry.result === undefined || entry.result === null) {
    return t("alerts.downtimes.notify.log.pending");
  }
  return entry.result === RESULT_OK ? t("alerts.downtimes.notify.log.ok") : raw(entry.result);
};

const notificationRows = computed(() =>
  (downtime.value?.notification_log ?? []).map((entry, index) => ({
    key: `${entry.sent_at}-${entry.event}-${index}`,
    sent_at: entry.sent_at,
    event: EVENT_LABEL_KEYS[entry.event] ? t(EVENT_LABEL_KEYS[entry.event]) : raw(entry.event),
    destinations: raw(entry.destinations.join(", ")),
    result: resultText(entry),
    failed: !!entry.result && entry.result !== RESULT_OK,
  })),
);

const notificationColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "sent_at",
    accessorKey: "sent_at",
    header: t("alerts.downtimes.notify.log.time"),
    cell: " ",
    sortable: true,
    size: 200,
  },
  { id: "event", accessorKey: "event", header: t("alerts.downtimes.notify.log.event"), size: 160 },
  {
    id: "destinations",
    accessorKey: "destinations",
    header: t("alerts.downtimes.notify.log.destinations"),
    size: 240,
  },
  {
    id: "result",
    accessorKey: "result",
    header: t("alerts.downtimes.notify.log.result"),
    cell: " ",
    size: 320,
    meta: { flex: true },
  },
]);

const testMutation = useMutation(() => sendDowntimeTestMutation(orgId.value));
const alertDestinations = useQuery(() =>
  Object.assign(destinationsQuery(orgId.value, "alert"), {
    enabled: !!orgId.value && !!downtime.value?.notifications?.destinations.length,
  }),
);
const testDestinations = computed<TestDestination[]>(() => {
  const names = downtime.value?.notifications?.destinations ?? [];
  const known: TestDestination[] = alertDestinations.data.value ?? [];
  return names.flatMap((name) => known.filter((d) => d.name === name));
});

const sendTest = async () => {
  const d = downtime.value;
  if (!d) return;
  const href = router.resolve({ name: "downtimes", query: orgQuery() }).href;
  const results = await testMutation.mutateAsync({
    downtime: d,
    destinations: testDestinations.value,
    url: `${window.location.origin}${href}`,
  });
  const failed = results.filter((r) => !r.ok).map((r) => r.destination);
  if (failed.length === 0) {
    toast({
      variant: "success",
      message: t("alerts.downtimes.notify.test.sent", { count: results.length }, results.length),
    });
    return;
  }
  toast({
    variant: "error",
    message: t("alerts.downtimes.notify.test.failed", { names: failed.join(", ") }),
  });
};

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
