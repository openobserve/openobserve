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
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import StarterPackDetailsDrawer from "@/components/starterPacks/StarterPackDetailsDrawer.vue";
import StarterPackDrawer from "@/components/starterPacks/StarterPackDrawer.vue";
import StarterPackFindMore from "@/components/starterPacks/StarterPackFindMore.vue";
import StarterPackRepairChip from "@/components/starterPacks/StarterPackRepairChip.vue";
import StarterPackUpdateDrawer from "@/components/starterPacks/StarterPackUpdateDrawer.vue";
import StarterPackUndoDialog from "@/components/starterPacks/StarterPackUndoDialog.vue";
import TurnOnAlertsDrawer from "@/components/starterPacks/TurnOnAlertsDrawer.vue";
import QuickMuteDialog from "@/components/alerts/downtimes/QuickMuteDialog.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useDowntimesEnabled } from "@/composables/downtimes/useDowntimesEnabled";
import { readQuery } from "@/composables/query/readQuery";
import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
import { KUBERNETES_PACK, STARTER_PACKS } from "@/composables/starterPacks/kubernetesPack";
import { adaptSavedView } from "@/composables/starterPacks/packAdapt";
import type { PackRecordItem } from "@/composables/starterPacks/types";
import { useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useStarterPackMatcher } from "@/composables/starterPacks/useStarterPackMatcher";
import { staleSinceText, usePackHealth } from "@/composables/starterPacks/usePackHealth";
import { usePackUpdates } from "@/composables/starterPacks/usePackUpdates";
import { alertStreams } from "@/composables/starterPacks/useRepairLater";
import { useTurnOnAlerts, type TurnOnRow } from "@/composables/starterPacks/useTurnOnAlerts";
import { queriesPerDay } from "@/composables/starterPacks/wouldFire";
import { alertHistoryQuery, firingAlertsQuery } from "@/services/alerts.queries";
import { permittedFoldersQuery } from "@/services/common.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { isFiringNow } from "@/utils/alerts/firingAlerts";
import { copyToClipboard } from "@/utils/clipboard";
import { getImageURL } from "@/utils/zincutils";
import { toast } from "@/lib/feedback/Toast/useToast";

type RowState = "off" | "firing" | "noData" | "watching";
type ViewKind = "dashboard" | "savedView";

const FIRED_WINDOW_US = 7 * 24 * 60 * 60 * 1_000_000;
const STATE_BADGES: Record<RowState, BadgeVariant> = {
  off: "default-outline",
  firing: "error",
  noData: "warning-soft",
  watching: "success-outline",
};
const VIEW_KINDS: ViewKind[] = ["dashboard", "savedView"];
const STATE_KEYS = {
  off: "starterPacks.page.off",
  firing: "starterPacks.page.firing",
  noData: "starterPacks.turnOn.noData",
  watching: "starterPacks.page.watching",
} as const;

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const org = String(route.query.org_identifier ?? store.state.selectedOrganization?.identifier);
const pack = STARTER_PACKS.find(({ id }) => id === route.params.pack) ?? KUBERNETES_PACK;
const title = t(pack.titleKey);
const packsEnabled = STARTER_PACKS_ENABLED;
const flow = useStarterPackFlow(org, pack);
const matcher = useStarterPackMatcher(org, { pack });
const turn = useTurnOnAlerts(org, flow);
const health = usePackHealth(org);
const updates = usePackUpdates(org, flow);
const muteEnabled = useDowntimesEnabled();

const turnOnOpen = ref(false);
const preselect = ref<string[] | undefined>();
const setupOpen = ref(false);
const detailsOpen = ref(false);
const removeOpen = ref(false);
const updateOpen = ref(false);
const muteRow = ref<TurnOnRow | null>(null);
const editRow = ref<TurnOnRow | null>(null);
const thresholdDraft = ref<string | number>("");
const thresholdInvalid = ref(false);
const switchEpoch = ref(0);
const turningOff = ref<string | null>(null);
const fired = shallowRef<Record<string, number>>({});
const firing = shallowRef<Set<string>>(new Set());
const folderNames = ref<string[]>([]);
const folderName = ref(pack.folder.name);

const rows = computed(() => turn.rows.value);
const offCount = computed(() => rows.value.filter(({ enabled }) => !enabled).length);
const onRows = computed(() => rows.value.filter(({ enabled }) => enabled));
const perDay = computed(() => queriesPerDay(onRows.value.map(({ alert }) => alert)));
// A repaired alert's query reads the new stream while its stream setting keeps the name it was created with.
const readsOf = ({ alert }: TurnOnRow): string[] => {
  const reads = packsEnabled ? [...alertStreams(alert)] : [];
  return reads.length ? reads : [alert.stream_name];
};
const movedFrom = (row: TurnOnRow) => {
  const reads = readsOf(row);
  return reads.includes(row.alert.stream_name) ? null : reads.join(", ");
};
const isStale = (row: TurnOnRow) =>
  readsOf(row).some((name) => health.staleStreams.value.has(name));
const stateOf = (row: TurnOnRow): RowState => {
  if (!row.enabled) return "off";
  if (firing.value.has(row.id)) return "firing";
  return isStale(row) ? "noData" : "watching";
};
const streamNames = computed(() => [...new Set(rows.value.flatMap(readsOf))]);
const streamList = computed(() => {
  const types = new Map<string, string>();
  rows.value.forEach((row) =>
    readsOf(row).forEach((name) => {
      if (!types.has(name))
        types.set(name, row.alert.stream_type ? String(row.alert.stream_type) : "");
    }),
  );
  return [...types].map(([name, type]) => ({ name, type }));
});
const silentFired = (row: TurnOnRow) =>
  row.enabled && (fired.value[row.id] ?? 0) > 0 && !row.alert.destinations?.length;
const notifies = computed(() =>
  [...new Set(onRows.value.flatMap(({ alert }) => alert.destinations ?? []))].join(", "),
);
const alertsLine = computed(() => {
  const counts = { on: onRows.value.length, total: rows.value.length };
  return notifies.value
    ? t("starterPacks.page.alertsNotifies", { ...counts, destinations: raw(notifies.value) })
    : t("starterPacks.page.alertsOf", counts);
});
const recordItems = computed(() => flow.record.value?.items ?? []);
const viewGroups = computed(() =>
  VIEW_KINDS.map((kind) => ({
    kind,
    items: recordItems.value.filter(
      (item) => item.kind === kind && (item.status === "created" || item.status === "existing"),
    ),
  })).filter(({ items }) => items.length),
);
const skippedAlerts = computed(() => {
  const recorded = new Set(recordItems.value.map(({ itemId }) => itemId));
  const leftOut = (flow.preview.value?.notIncluded ?? []).filter(
    (item) => item.kind === "alert" && item.reason === "no_data" && !recorded.has(item.itemId),
  ).length;
  const skipped = recordItems.value.filter(
    ({ kind, status }) => kind === "alert" && status === "skipped",
  ).length;
  return leftOut + skipped;
});
const pageState = computed(() => {
  if (!flow.loaded.value) return "loading";
  if (flow.loadFailed.value) return "error";
  return flow.record.value ? "installed" : "empty";
});
const installed = computed(() => pageState.value === "installed");
const canManage = computed(
  () => flow.canManage.value && !flow.forbidden.value && !turn.forbidden.value,
);
const viewOnly = computed(() => installed.value && !canManage.value);
const staleText = computed(() => staleSinceText(health.staleSince.value));
const showUpdate = computed(
  () => packsEnabled && canManage.value && installed.value && updates.available.value,
);
const showAddDashboard = computed(
  () => packsEnabled && canManage.value && installed.value && updates.needsDashboard.value,
);
const chip = computed<{ variant: BadgeVariant; icon: IconName; text: I18nText } | null>(() => {
  if (pageState.value === "error")
    return { variant: "default-soft", icon: "info", text: t("starterPacks.page.loadFailed") };
  if (pageState.value === "empty")
    return { variant: "default-soft", icon: "info", text: t("starterPacks.page.chipNotSetUp") };
  if (!installed.value) return null;
  if (viewOnly.value)
    return { variant: "default-soft", icon: "lock", text: t("starterPacks.page.chipViewOnly") };
  if (rows.value.length && !onRows.value.length)
    return {
      variant: "default-soft",
      icon: "notifications-off",
      text: t("starterPacks.page.chipOff", { count: offCount.value }, offCount.value),
    };
  if (staleText.value)
    return {
      variant: "warning-soft",
      icon: "sensors-off",
      text: t("starterPacks.page.chipNoData", { since: raw(staleText.value) }),
    };
  if (showUpdate.value)
    return {
      variant: "primary-soft",
      icon: "arrow-upward",
      text: t("starterPacks.page.chipUpdate"),
    };
  if (showAddDashboard.value)
    return {
      variant: "primary-soft",
      icon: "info",
      text: t("starterPacks.page.chipPlanChanged"),
    };
  if (!rows.value.length) return null;
  return {
    variant: "default-soft",
    icon: "notifications-active",
    text: t("starterPacks.page.chipOn", { count: onRows.value.length }, onRows.value.length),
  };
});
const folderOptions = computed(() =>
  [...new Set([pack.folder.name, ...folderNames.value])].map((name) => ({
    label: raw(name),
    value: name,
  })),
);
const columns = computed<OTableColumnDef<TurnOnRow>[]>(() => [
  { id: "name", header: t("starterPacks.turnOn.colAlert"), accessorKey: "name", size: 300 },
  { id: "state", header: t("starterPacks.page.colState"), size: 110 },
  { id: "threshold", header: t("starterPacks.page.threshold"), size: 200 },
  { id: "fired", header: t("starterPacks.page.colFired"), size: 130 },
  { id: "actions", header: raw(""), isAction: true, size: 150 },
]);

const readFired = async () => {
  const end = Date.now() * 1000;
  const counts = await Promise.all(
    onRows.value.map(async ({ id }) => {
      const query = {
        alert_id: id,
        status: "firing",
        start_time: end - FIRED_WINDOW_US,
        end_time: end,
        from: 0,
        size: 1,
      };
      const reply = await readQuery(alertHistoryQuery(org, query)).catch(() => null);
      return [id, Number(reply?.total ?? 0)] as const;
    }),
  );
  fired.value = Object.fromEntries(counts);
};
const readFiring = async () => {
  const page = await readQuery(firingAlertsQuery(org)).catch(() => null);
  firing.value = new Set((page?.list ?? []).filter(isFiringNow).map(({ alert_id }) => alert_id));
};

const openTurnOn = (ids?: string[]) => {
  preselect.value = ids;
  turnOnOpen.value = true;
};
// The Library card links here with ?turnOn=1 so one drawer host serves both pages.
const consumeTurnOnLink = () => {
  if (route.query.turnOn !== "1" || !installed.value || !canManage.value || !offCount.value) return;
  router.replace({ query: { ...route.query, turnOn: undefined } }).catch(() => {});
  openTurnOn();
};

const refresh = async () => {
  await flow.load();
  if (!flow.record.value) {
    if (flow.isAdmin.value) {
      const folders = await readQuery(permittedFoldersQuery(org, "alerts")).catch(() => []);
      folderNames.value = folders.map(({ name }) => name);
    }
    return;
  }
  await turn.load({ count: false });
  if (packsEnabled) void updates.check();
  await Promise.all([
    flow.loadPreview(),
    readFired(),
    readFiring(),
    health.check(streamNames.value),
    matcher.check(),
  ]);
};

onMounted(async () => {
  await refresh();
  consumeTurnOnLink();
});
watch(setupOpen, (isOpen) => {
  if (isOpen) void flow.loadPreview();
});
watch(turnOnOpen, (isOpen) => {
  if (!isOpen) preselect.value = undefined;
});
watch([turnOnOpen, editRow, removeOpen, muteRow, updateOpen, setupOpen], (opened) => {
  if (opened.some(Boolean)) detailsOpen.value = false;
});

const setUp = async () => {
  setupOpen.value = true;
  if (await flow.install(folderName.value === pack.folder.name ? undefined : folderName.value)) {
    setupOpen.value = false;
    await refresh();
  }
};
const backToPacks = () =>
  router.push({ name: "starterPacks", query: { org_identifier: org } }).catch(() => {});
const copyLink = () => copyToClipboard(flow.packLink(), t);
const thresholdOf = ({ alert }: TurnOnRow) =>
  alert.query_condition?.type === "promql"
    ? alert.query_condition.promql_condition?.value
    : alert.trigger_condition?.threshold;
const operatorOf = ({ alert }: TurnOnRow): string =>
  (alert.query_condition?.type === "promql"
    ? alert.query_condition.promql_condition?.operator
    : alert.trigger_condition?.operator) ?? "";
const thresholdText = (row: TurnOnRow) => {
  const op = operatorOf(row);
  const word = op.startsWith(">")
    ? t("starterPacks.page.opAbove")
    : op.startsWith("<")
      ? t("starterPacks.page.opBelow")
      : op === "=" || op === "=="
        ? t("starterPacks.page.opEquals")
        : raw(op);
  return t("starterPacks.page.thresholdFor", {
    op: word,
    value: raw(thresholdOf(row)),
    period: row.alert.trigger_condition?.period ?? 0,
  });
};
const startEdit = (row: TurnOnRow) => {
  editRow.value = row;
  thresholdDraft.value = thresholdOf(row);
  thresholdInvalid.value = false;
};
watch(thresholdDraft, () => {
  thresholdInvalid.value = false;
});
const saveThreshold = async () => {
  if (!editRow.value) return;
  const value = Number(thresholdDraft.value);
  if (String(thresholdDraft.value).trim() === "" || !Number.isFinite(value)) {
    thresholdInvalid.value = true;
    return;
  }
  if (await turn.setThreshold(editRow.value.id, value, { count: false })) {
    editRow.value = null;
    return;
  }
  toast({ variant: "error", message: t("starterPacks.page.thresholdFailed") });
};
// Turning on needs a destination, so it goes through the drawer; turning off acts directly.
const toggle = async (row: TurnOnRow, on: unknown) => {
  // OSwitch flips itself on click; remounting it keeps it on the alert's real state until the change lands.
  switchEpoch.value += 1;
  if (on) return openTurnOn([row.id]);
  turningOff.value = row.id;
  const done = await turn.turnOff([row]);
  turningOff.value = null;
  if (!done) toast({ variant: "error", message: t("starterPacks.page.turnOffFailed") });
};
const openAlert = (row: TurnOnRow) =>
  router
    .push({
      name: "alertDetail",
      params: { alert_id: row.id },
      query: { org_identifier: org, ...(row.folderId ? { folder: row.folderId } : {}) },
    })
    .catch(() => {});
const openItem = (item: PackRecordItem) => {
  if (item.kind === "dashboard") {
    const query = {
      org_identifier: org,
      dashboard: item.id ?? "",
      folder: item.folderId ?? "",
      pack: pack.id,
    };
    router.push({ name: "viewDashboard", query }).catch(() => {});
    return;
  }
  // Logs has no link to a saved view, so Open lands on the stream the view reads.
  const view = pack.savedViews.find(({ id }) => id === item.itemId);
  const stream = view
    ? adaptSavedView(view.search, flow.record.value?.repairs ?? []).data?.stream
    : null;
  const query = {
    org_identifier: org,
    ...(stream?.selectedStream?.length
      ? { stream_type: stream.streamType ?? "logs", stream: stream.selectedStream.join(",") }
      : {}),
  };
  router.push({ name: "logs", query }).catch(() => {});
};
const muteSelection = computed(() =>
  muteRow.value ? [{ module: "alerts" as const, ids: [muteRow.value.id] }] : [],
);
const muteContext = computed(() =>
  muteRow.value
    ? { alertId: muteRow.value.id, name: muteRow.value.name, folderId: muteRow.value.folderId }
    : null,
);
</script>

<template>
  <OPageLayout
    bleed
    :title="t('starterPacks.page.title', { title })"
    title-data-test="starter-pack-page-title"
  >
    <template #title-prefix>
      <span
        class="border-border-default rounded-default inline-flex size-9.5 shrink-0 items-center justify-center border max-md:hidden"
        aria-hidden="true"
      >
        <img v-if="pack.logo" :src="getImageURL(pack.logo)" class="size-5 object-contain" alt="" />
        <OIcon v-else name="hub" size="md" class="text-text-secondary" />
      </span>
    </template>
    <template #subtitle>
      <OButton
        variant="ghost-muted"
        size="chip"
        data-test="starter-pack-page-back"
        @click="backToPacks"
      >
        {{ t("menu.starterPacks") }}
      </OButton>
    </template>
    <template #title-trail>
      <span v-if="chip" class="flex shrink-0 items-center gap-2">
        <OBadge
          :variant="chip.variant"
          :icon="chip.icon"
          shape="rounded"
          data-test="starter-pack-page-chip"
          >{{ chip.text }}</OBadge
        >
        <OButton
          v-if="pageState === 'error'"
          variant="ghost-primary"
          size="sm-action"
          data-test="starter-pack-page-chip-retry-btn"
          @click="refresh"
        >
          {{ t("common.retry") }}
        </OButton>
        <OButton
          v-else-if="showUpdate"
          variant="ghost-primary"
          size="sm-action"
          data-test="starter-pack-page-update-btn"
          @click="updateOpen = true"
        >
          {{ t("starterPacks.page.reviewUpdateTo", { version: raw(pack.version) }) }}
        </OButton>
        <OButton
          v-if="showAddDashboard"
          variant="ghost-primary"
          size="sm-action"
          :title="t('starterPacks.page.addDashboard')"
          :loading="updates.state.value === 'applying'"
          data-test="starter-pack-page-add-dashboard-btn"
          @click="updates.addDashboard()"
        >
          {{ t("starterPacks.page.addDashboardBtn") }}
        </OButton>
      </span>
    </template>
    <template #actions>
      <StarterPackRepairChip
        v-if="packsEnabled && installed && canManage"
        :org="org"
        :scope="{ packId: pack.id }"
        @repaired="refresh"
        @opened="detailsOpen = false"
      />
      <OButton
        v-if="viewOnly"
        variant="outline"
        size="sm-action"
        icon-left="content-copy"
        data-test="starter-pack-page-copy-link-btn"
        @click="copyLink"
      >
        {{ t("starterPacks.copyLink") }}
      </OButton>
      <OButton
        v-if="installed"
        variant="outline"
        size="sm-action"
        icon-left="info"
        :active="detailsOpen"
        data-test="starter-pack-page-pack-details-btn"
        @click="detailsOpen = !detailsOpen"
      >
        {{ t("starterPacks.page.packDetails") }}
      </OButton>
      <StarterPackFindMore
        v-if="packsEnabled"
        :org="org"
        @changed="flow.load()"
        @opened="detailsOpen = false"
      />
      <template v-if="installed && canManage">
        <OButton
          variant="ghost-destructive"
          size="sm-action"
          icon-left="delete"
          data-test="starter-pack-page-remove-btn"
          @click="removeOpen = true"
        >
          {{ t("starterPacks.landing.remove") }}
        </OButton>
        <OButton
          v-if="offCount"
          variant="primary"
          size="sm-action"
          data-test="starter-pack-page-turn-on-btn"
          @click="openTurnOn()"
        >
          {{ t("starterPacks.turnOn.submit", { count: offCount }, offCount) }}
        </OButton>
      </template>
    </template>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 text-sm">
      <div v-if="pageState === 'loading'" class="flex flex-col gap-3">
        <OSkeleton class="h-6 w-full" />
        <OSkeleton class="h-6 w-full" />
      </div>
      <OEmptyState
        v-else-if="pageState === 'error'"
        size="block"
        variant="error"
        illustration="broken-panel"
        :title="t('starterPacks.page.loadFailed')"
        :action-label="t('common.retry')"
        action-icon="refresh"
        data-test="starter-pack-page-error"
        @action="refresh"
      />
      <div
        v-else-if="pageState === 'empty'"
        class="border-border-default rounded-default flex items-center gap-3 border p-3"
      >
        <p class="min-w-0 flex-1">{{ t("starterPacks.page.notSetUp") }}</p>
        <div class="flex shrink-0 items-end gap-2">
          <OSelect
            v-if="flow.isAdmin.value"
            v-model="folderName"
            width="md"
            :label="t('starterPacks.page.setUpIn')"
            :options="folderOptions"
            label-key="label"
            value-key="value"
            data-test="starter-pack-page-folder-select"
          />
          <OButton
            variant="outline"
            size="sm-action"
            data-test="starter-pack-page-details-btn"
            @click="setupOpen = true"
          >
            {{ t("starterPacks.details") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            data-test="starter-pack-page-setup-btn"
            @click="setUp"
          >
            {{ t("starterPacks.setUp", { title }) }}
          </OButton>
        </div>
      </div>
      <section v-else class="flex flex-col gap-2" data-test="starter-pack-page-section-alerts">
        <div class="flex min-h-6 flex-wrap items-center gap-2">
          <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <OText variant="card-title" as="h2">{{ t("starterPacks.page.sectionAlerts") }}</OText>
            <OText variant="meta" data-test="starter-pack-page-alerts-meta">{{ alertsLine }}</OText>
          </div>
          <OButton
            v-if="packsEnabled && canManage && updates.canRevert.value"
            variant="ghost-primary"
            size="sm-action"
            :loading="updates.state.value === 'applying'"
            data-test="starter-pack-page-revert-btn"
            @click="updates.revert()"
          >
            {{ t("starterPacks.update.revert") }}
          </OButton>
        </div>
        <div class="min-h-80" data-test="starter-pack-page-alerts-table">
          <OTable
            :data="rows"
            :columns="columns"
            row-key="id"
            :loading="turn.loadState.value === 'loading'"
          >
            <template #cell-name="{ row }">
              <span class="flex min-w-0 flex-col items-start gap-0.5">
                <span class="flex min-w-0 items-center gap-2">
                  <span
                    class="truncate"
                    :title="row.name"
                    data-test="starter-pack-page-alert-title"
                    >{{ flow.alertTitle(row.id, row.name) }}</span
                  >
                  <OBadge
                    :variant="row.severity === 'critical' ? 'error-outline' : 'warning-outline'"
                    shape="rounded"
                    size="sm"
                  >
                    {{ t(`starterPacks.severity.${row.severity as "critical" | "warning"}`) }}
                  </OBadge>
                </span>
                <OText
                  v-if="packsEnabled && movedFrom(row)"
                  variant="meta"
                  :title="
                    t('starterPacks.page.readsInsteadTip', {
                      stream: raw(movedFrom(row) ?? ''),
                      name: raw(row.alert.stream_name),
                    })
                  "
                  data-test="starter-pack-page-reads-instead"
                >
                  {{
                    t("starterPacks.page.readsInstead", {
                      stream: raw(movedFrom(row) ?? ""),
                      name: raw(row.alert.stream_name),
                    })
                  }}
                </OText>
              </span>
            </template>
            <template #cell-state="{ row }">
              <OBadge
                :variant="STATE_BADGES[stateOf(row)]"
                shape="rounded"
                size="sm"
                :data-test="`starter-pack-page-state-${stateOf(row)}`"
              >
                {{ t(STATE_KEYS[stateOf(row)]) }}
              </OBadge>
            </template>
            <template #cell-threshold="{ row }">
              <span class="text-text-secondary truncate">{{ thresholdText(row) }}</span>
            </template>
            <template #cell-fired="{ row }">
              <span class="flex items-center gap-1 tabular-nums">
                {{ row.enabled ? (fired[row.id] ?? 0) : raw("—") }}
                <OIcon
                  v-if="silentFired(row)"
                  name="notifications-paused"
                  size="sm"
                  class="text-status-warning-text"
                  :title="
                    t('starterPacks.page.silentFired', { count: 1, times: fired[row.id] ?? 0 }, 1)
                  "
                  data-test="starter-pack-page-silent-fired"
                />
              </span>
            </template>
            <template #cell-actions="{ row }">
              <span class="flex items-center justify-end gap-1">
                <template v-if="canManage">
                  <OSwitch
                    :key="`${row.id}-${switchEpoch}`"
                    :model-value="row.enabled"
                    :disabled="turningOff === row.id"
                    size="sm"
                    :aria-label="
                      t(row.enabled ? 'starterPacks.page.turnOff' : 'starterPacks.page.turnOn')
                    "
                    data-test="starter-pack-page-row-switch"
                    @update:model-value="toggle(row, $event)"
                  />
                  <OButton
                    variant="ghost"
                    size="icon-sm"
                    icon-left="edit"
                    :title="t('starterPacks.turnOn.editThreshold')"
                    :aria-label="t('starterPacks.turnOn.editThreshold')"
                    data-test="starter-pack-page-edit-threshold-btn"
                    @click="startEdit(row)"
                  />
                  <OButton
                    v-if="muteEnabled"
                    variant="ghost"
                    size="icon-sm"
                    icon-left="notifications-off"
                    :disabled="!row.enabled"
                    :title="t('starterPacks.page.mute')"
                    :aria-label="t('starterPacks.page.mute')"
                    data-test="starter-pack-page-mute-btn"
                    @click="muteRow = row"
                  />
                </template>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="open-in-new"
                  :title="t('starterPacks.page.openInAlerts')"
                  :aria-label="t('starterPacks.page.openInAlerts')"
                  data-test="starter-pack-page-open-alert-btn"
                  @click="openAlert(row)"
                />
              </span>
            </template>
            <template v-if="turn.loadState.value === 'error'" #empty>
              <OEmptyState
                size="block"
                variant="error"
                illustration="broken-panel"
                :title="t('starterPacks.turnOn.loadFailed')"
                :action-label="t('common.retry')"
                action-icon="refresh"
                data-test="starter-pack-page-alerts-load-failed"
                @action="turn.load({ count: false })"
              />
            </template>
            <template v-else-if="skippedAlerts" #empty>
              <OEmptyState
                size="block"
                illustration="alert"
                :title="
                  t('starterPacks.page.alertsSkipped', { count: skippedAlerts }, skippedAlerts)
                "
                data-test="starter-pack-page-alerts-skipped"
              />
            </template>
          </OTable>
        </div>
      </section>
      <section
        v-if="installed && viewGroups.length"
        class="flex flex-col gap-2"
        data-test="starter-pack-page-section-views"
      >
        <div class="flex min-h-6 flex-wrap items-center gap-2">
          <OText variant="card-title" as="h2">{{ t("starterPacks.page.sectionViews") }}</OText>
        </div>
        <div class="border-border-default rounded-default flex flex-col border">
          <template v-for="(group, index) in viewGroups" :key="group.kind">
            <OText
              variant="meta"
              class="bg-surface-subtle px-3 py-1"
              :class="{ 'border-border-default border-t': index > 0 }"
              :data-test="`starter-pack-page-group-${group.kind}`"
              >{{
                t(`starterPacks.page.group.${group.kind}`, { count: group.items.length })
              }}</OText
            >
            <div
              v-for="item in group.items"
              :key="item.itemId"
              class="border-border-default flex items-center justify-between gap-2 border-t px-3 py-1.5"
              data-test="starter-pack-page-view-row"
            >
              <span class="min-w-0 truncate">{{ flow.nameOf(item.itemId) }}</span>
              <OButton
                variant="ghost-primary"
                size="sm-action"
                data-test="starter-pack-page-view-open-btn"
                @click="openItem(item)"
              >
                {{ t("starterPacks.page.open") }}
              </OButton>
            </div>
          </template>
        </div>
      </section>
    </div>

    <StarterPackDetailsDrawer
      v-if="installed"
      v-model:open="detailsOpen"
      :org="org"
      :flow="flow"
      :clusters="matcher.clusters.value"
      :streams="streamList"
      :stale-since="health.staleSince.value"
      :queries-per-day="perDay"
    />
    <TurnOnAlertsDrawer
      v-model:open="turnOnOpen"
      :flow="flow"
      :clusters="matcher.clusters.value"
      :preselect-ids="preselect"
      @done="refresh"
    />
    <StarterPackDrawer v-model:open="setupOpen" :flow="flow" :clusters="matcher.clusters.value" />
    <StarterPackUpdateDrawer v-if="packsEnabled" v-model:open="updateOpen" :updates="updates" />
    <StarterPackUndoDialog v-model:open="removeOpen" :flow="flow" mode="remove" @done="refresh" />
    <ODialog
      :open="!!editRow"
      size="xs"
      :title="t('starterPacks.turnOn.editThreshold')"
      :primary-button-label="t('common.save')"
      primary-button-data-test="starter-pack-page-threshold-save-btn"
      :secondary-button-label="t('common.cancel')"
      @update:open="editRow = null"
      @click:primary="saveThreshold"
      @click:secondary="editRow = null"
    >
      <OInput
        v-model="thresholdDraft"
        type="number"
        :label="t('starterPacks.page.threshold')"
        :error="thresholdInvalid"
        :error-message="thresholdInvalid ? t('starterPacks.page.thresholdNotNumber') : undefined"
        data-test="starter-pack-page-threshold-input"
      />
    </ODialog>
    <QuickMuteDialog
      v-if="muteEnabled && muteRow"
      :open="true"
      :selection="muteSelection"
      :alert="muteContext"
      @update:open="muteRow = null"
      @muted="muteRow = null"
    />
  </OPageLayout>
</template>
