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
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OCard from "@/lib/core/Card/OCard.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import StarterPackParseDialog from "@/components/starterPacks/StarterPackParseDialog.vue";
import StarterPackUndoDialog from "@/components/starterPacks/StarterPackUndoDialog.vue";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { STARTER_PACKS } from "@/composables/starterPacks/kubernetesPack";
import { matchPack, readOrgStreams } from "@/composables/starterPacks/packMatchData";
import { findRawNginxLogs, type RawLogNotice } from "@/composables/starterPacks/rawLogs";
import type {
  PackInstallRecord,
  PackItemKind,
  StarterPack,
} from "@/composables/starterPacks/types";
import { useInstallRecords } from "@/composables/starterPacks/useInstallRecords";
import { useNginxParse, type ParsePreview } from "@/composables/starterPacks/useNginxParse";
import { usePackUpdates } from "@/composables/starterPacks/usePackUpdates";
import { isOrgAdmin, useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useStreamValues } from "@/composables/starterPacks/useStreamValues";
import { copyToClipboard } from "@/utils/clipboard";
import { getImageURL } from "@/utils/zincutils";
import StarterPackDrawer from "./StarterPackDrawer.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

type Facet = "ready" | "missing" | "installed" | "all";

interface LibraryRow {
  id: string;
  pack: StarterPack;
  title: I18nText;
  ready: boolean;
  matched: number;
  total: number;
  record: PackInstallRecord | null;
}

const props = defineProps<{ org: string }>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const records = useInstallRecords(props.org);
const parser = useNginxParse(props.org);
const { loadManifest, loadAlertFile } = useAlertLibrary();
const { readValues } = useStreamValues(props.org);

const rows = ref<LibraryRow[]>([]);
const state = ref<"loading" | "ready" | "error">("loading");
const facet = ref<Facet>("all");
const flows = new Map(STARTER_PACKS.map((pack) => [pack.id, useStarterPackFlow(props.org, pack)]));
const updates = new Map(
  STARTER_PACKS.map((pack) => [pack.id, usePackUpdates(props.org, flows.get(pack.id)!)]),
);
const drawerPackId = ref<string | null>(null);
const drawerFlow = computed(() => (drawerPackId.value ? flows.get(drawerPackId.value) : undefined));
const rawLogs = ref<RawLogNotice[]>([]);
const repairs = ref<PackInstallRecord[]>([]);
const parsing = ref<RawLogNotice | null>(null);
const parseOpen = ref(false);
const undoing = ref<PackInstallRecord | null>(null);
const undoOpen = ref(false);
const undoFailed = ref(false);
const undoPackId = ref<string | null>(null);
const undoSetupOpen = ref(false);
const undoPackFlow = computed(() => (undoPackId.value ? flows.get(undoPackId.value) : undefined));

const isAdmin = computed(() => isOrgAdmin(store.state));
const repairStream = (record: PackInstallRecord) => record.items[0]?.stream ?? "";
const unrepaired = computed(() => {
  const repaired = new Set(repairs.value.map(repairStream));
  return rawLogs.value.filter(({ stream }) => !repaired.has(stream));
});

const count = (test: (row: LibraryRow) => boolean) => rows.value.filter(test).length;
const isReadyRow = (row: LibraryRow) => row.ready;
const isMissingRow = (row: LibraryRow) => !row.ready;
const isInstalledRow = (row: LibraryRow) => row.record !== null;
const FACET_TESTS: Record<Facet, (row: LibraryRow) => boolean> = {
  ready: isReadyRow,
  missing: isMissingRow,
  installed: isInstalledRow,
  all: () => true,
};

const statItems = computed<StatItem[]>(() => [
  {
    key: "ready",
    label: t("alert_library.statReady"),
    value: count(isReadyRow),
    icon: "check-circle",
    tone: "success",
    max: rows.value.length,
    dataTest: "library-tab-stat-ready",
  },
  {
    key: "missing",
    label: t("alert_library.statNeedsData"),
    value: count(isMissingRow),
    icon: "sensors-off",
    tone: "warning",
    max: rows.value.length,
    dataTest: "library-tab-stat-missing",
  },
  {
    key: "installed",
    label: t("starterPacks.libraryTabs.statInstalled"),
    value: count(isInstalledRow),
    icon: "check-circle-outline",
    tone: "neutral",
    max: rows.value.length,
    dataTest: "library-tab-stat-installed",
  },
  // Never highlighted as a filter: it is the way out of one.
  {
    key: "all",
    label: t("alert_library.statAll"),
    value: rows.value.length,
    icon: "widgets",
    tone: "neutral",
    dataTest: "library-tab-stat-all",
  },
]);

const onStatSelect = (key: string) => {
  const next = key as Facet;
  facet.value = next === "all" || facet.value === next ? "all" : next;
};

// Ready packs first, so the list opens on what can be set up now.
const visibleRows = computed(() =>
  rows.value.filter(FACET_TESTS[facet.value]).sort((a, b) => Number(b.ready) - Number(a.ready)),
);

const packItems = (record: PackInstallRecord) =>
  record.items.filter(({ kind }) => kind !== "folder");
const isMade = ({ status }: PackInstallRecord["items"][number]) =>
  status === "created" || status === "existing";
const madeCount = (record: PackInstallRecord) => packItems(record).filter(isMade).length;
const failedCount = (record: PackInstallRecord) =>
  packItems(record).filter(({ status }) => status === "failed").length;

const flowOf = (row: LibraryRow) => flows.get(row.pack.id)!;
// The flow tracks one install, so its live state belongs only to that install's card.
const isFlowRecord = (row: LibraryRow) =>
  !!row.record && flowOf(row).record.value?.installId === row.record.installId;
// A stored "installing" status may be a setup that died, so only a live run reads as busy.
const isSettingUp = (row: LibraryRow) =>
  flowOf(row).running.value && (!row.record || isFlowRecord(row));
const alertsOff = (row: LibraryRow) => (isFlowRecord(row) ? flowOf(row).alertsOff.value : 0);
const updateAvailable = (row: LibraryRow) =>
  isFlowRecord(row) && !!updates.get(row.pack.id)?.available.value;
const isComplete = (record: PackInstallRecord) =>
  record.status === "complete" && failedCount(record) === 0;
// Without the license the pack page explains what still gets created, so Set up waits there.
const needsLicense = (row: LibraryRow) => !!row.pack.nativeView && !flowOf(row).licensed.value;
const canUndoSetup = (row: LibraryRow) =>
  !!row.record &&
  isComplete(row.record) &&
  isFlowRecord(row) &&
  !flowOf(row).running.value &&
  flowOf(row).canUndo.value;

const shortDate = (us: number) =>
  new Date(us / 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });

const installedLine = (record: PackInstallRecord): I18nText => {
  const date = raw(
    record.installedAt ? shortDate(record.installedAt) : t("starterPacks.libraryTabs.unknownDate"),
  );
  return record.installedBy
    ? t("starterPacks.libraryTabs.installedBy", { who: raw(record.installedBy), date })
    : t("starterPacks.libraryTabs.installedByUnknown", { date });
};

const join = (parts: I18nText[]) => raw(parts.join(" · "));

const madeOfKind = (record: PackInstallRecord, kind: PackItemKind) =>
  packItems(record).filter((item) => item.kind === kind && isMade(item)).length;

const countsLine = (row: LibraryRow): I18nText => {
  const flow = flowOf(row);
  const made = row.record && !isSettingUp(row) ? row.record : null;
  const parts: Array<[string, number]> = made
    ? [
        ["starterPacks.findMore.countDashboards", madeOfKind(made, "dashboard")],
        ["starterPacks.countAlerts", madeOfKind(made, "alert")],
        ["starterPacks.countViews", madeOfKind(made, "savedView")],
      ]
    : [
        ["starterPacks.findMore.countDashboards", flow.dashboardCount.value],
        ["starterPacks.countAlerts", flow.alertCount.value],
        ["starterPacks.countViews", flow.viewCount.value],
      ];
  return join(
    parts
      .filter(([, value]) => value > 0)
      .map(([key, value]) => t(key as "starterPacks.countAlerts", { count: value }, value)),
  );
};

const installedMeta = (row: LibraryRow, record: PackInstallRecord): I18nText => {
  if (isSettingUp(row)) {
    return t("starterPacks.libraryTabs.settingUpMeta", {
      made: madeCount(record),
      total: packItems(record).length,
    });
  }
  if (updateAvailable(row)) return t("starterPacks.libraryTabs.updateAvailable");
  const parts = [installedLine(record)];
  if (!isComplete(record)) {
    parts.push(t("starterPacks.libraryTabs.statusIncomplete"));
  } else if (alertsOff(row) > 0) {
    parts.push(t("starterPacks.libraryTabs.alertsOff", { count: alertsOff(row) }, alertsOff(row)));
  }
  return join(parts);
};

const metaLine = (row: LibraryRow): I18nText => {
  if (row.record) return installedMeta(row, row.record);
  const live = flowOf(row).record.value;
  if (isSettingUp(row)) {
    return live
      ? t("starterPacks.libraryTabs.settingUpMeta", {
          made: madeCount(live),
          total: packItems(live).length,
        })
      : t("starterPacks.libraryTabs.settingUpPlain");
  }
  const title = raw(row.title);
  if (!row.ready) return t("starterPacks.libraryTabs.needsData", { title });
  const parts = [
    needsLicense(row)
      ? t("starterPacks.libraryTabs.viewNeedsLicense", { title })
      : t("starterPacks.libraryTabs.fits", { matched: row.matched, total: row.total }),
  ];
  if (!isAdmin.value) parts.push(t("starterPacks.libraryTabs.adminsOnly"));
  return join(parts);
};

const openPack = (row: LibraryRow, query: Record<string, string> = {}) =>
  router
    .push({
      name: "starterPack",
      params: { pack: row.pack.id },
      query: { org_identifier: props.org, ...query },
    })
    .catch(() => {});

// The pack page owns the Turn on drawer and opens it from this query.
const turnOn = (row: LibraryRow) => openPack(row, { turnOn: "1" });

const ingestionGuide = (row: LibraryRow) =>
  router
    .push({ name: row.pack.collectorRoute ?? "ingestion", query: { org_identifier: props.org } })
    .catch(() => {});

const setUp = (row: LibraryRow) => {
  drawerPackId.value = row.pack.id;
};

const retry = async (row: LibraryRow) => {
  await flowOf(row).install();
  await load();
};

const askUndoSetup = (row: LibraryRow) => {
  undoPackId.value = row.pack.id;
  undoSetupOpen.value = true;
};

const copyLink = (row: LibraryRow) => copyToClipboard(flowOf(row).packLink(), t);

const packRows = (
  pack: StarterPack,
  match: { ready: boolean; matched: number; total: number },
  live: PackInstallRecord[],
): LibraryRow[] => {
  const base = { pack, title: t(pack.titleKey), ...match };
  // One card per install: the Installed filter owes every installer and date, not only the newest.
  if (!live.length) return [{ ...base, id: pack.id, record: null }];
  return live.map((record) => ({ ...base, id: record.installId, record }));
};

// A failed read only hides the notice, since it offers nothing to act on.
let rawLogRun = 0;
const loadRawLogs = async (logs: Map<string, number>) => {
  rawLogRun += 1;
  const run = rawLogRun;
  const [found, active] = await Promise.all([
    findRawNginxLogs(props.org, logs, readValues).catch(() => []),
    parser.active().catch(() => []),
  ]);
  if (run !== rawLogRun) return;
  rawLogs.value = found;
  repairs.value = active;
};

const openParse = (notice: RawLogNotice) => {
  parsing.value = notice;
  parseOpen.value = true;
};

const loadParse = (notice: RawLogNotice) =>
  Promise.all([parser.preview(notice), parser.readers(notice.stream)]);

// A failed create still leaves a record, so the list shows its Undo either way.
const applyParse = async (notice: RawLogNotice, preview: ParsePreview) => {
  try {
    await parser.confirm(notice, preview.format, store.state.userInfo?.email);
  } finally {
    repairs.value = await parser.active().catch(() => repairs.value);
  }
};

const openUndo = (record: PackInstallRecord) => {
  undoing.value = record;
  undoFailed.value = false;
  undoOpen.value = true;
};

const confirmUndo = async () => {
  if (!undoing.value) return;
  try {
    await parser.undo(undoing.value);
    undoOpen.value = false;
  } catch {
    undoFailed.value = true;
  }
  repairs.value = await parser.active().catch(() => repairs.value);
};

// Alerts-off counts and updates are extras on a card; a failed read leaves the card as it is.
const loadInstallState = async (pack: StarterPack) => {
  const flow = flows.get(pack.id)!;
  await flow.load();
  if (flow.installed.value) await updates.get(pack.id)!.check();
};

// A quiet reload keeps the cards on screen, so the filter, scroll and a running setup stay put.
const load = async ({ quiet = false }: { quiet?: boolean } = {}) => {
  if (!quiet || state.value !== "ready") state.value = "loading";
  try {
    const streams = await readOrgStreams(props.org);
    void loadRawLogs(streams.logs ?? new Map());
    const built = await Promise.all(
      STARTER_PACKS.map(async (pack) => {
        const [match, installs] = await Promise.all([
          matchPack(props.org, pack, streams, { loadManifest, loadAlertFile }),
          records.list(pack.id),
        ]);
        const live = installs.filter(({ status }) => status !== "removed");
        // Without a preview the flow counts every manifest item, not what install would create.
        if (match.ready && !live.length) void flows.get(pack.id)?.loadPreview();
        if (live.length) void loadInstallState(pack).catch(() => {});
        const verdicts = [...match.alerts.values(), ...match.dashboards.values()];
        return packRows(
          pack,
          {
            ready: match.ready,
            matched: verdicts.filter(Boolean).length,
            total: verdicts.length,
          },
          live,
        );
      }),
    );
    rows.value = built.flat();
    state.value = "ready";
  } catch {
    state.value = "error";
  }
};

onMounted(() => void load());
defineExpose({ refresh: () => load({ quiet: true }) });
</script>

<template>
  <div class="px-page-edge flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-2">
    <OEmptyState
      v-if="state === 'error'"
      size="block"
      variant="error"
      illustration="broken-panel"
      :title="t('starterPacks.libraryTabs.loadFailed')"
      :action-label="t('alert_library.retry')"
      action-icon="refresh"
      data-test="library-tab-error"
      @action="load()"
    />
    <div
      v-else-if="state === 'loading'"
      class="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
      data-test="library-tab-loading"
    >
      <OCard
        v-for="index in 3"
        :key="index"
        variant="outlined"
        class="rounded-surface flex flex-col gap-2 p-3"
      >
        <OSkeleton type="text" class="w-1/2" />
        <OSkeleton type="text" class="w-3/4" />
        <OSkeleton type="text" class="w-2/3" />
      </OCard>
    </div>
    <template v-else>
      <OStatStrip
        :items="statItems"
        selectable
        :tray="false"
        :selected-key="facet"
        default-key="all"
        data-test="library-tab-strip"
        @select="onStatSelect"
      />
      <OEmptyState
        v-if="visibleRows.length === 0"
        size="block"
        class="py-8"
        illustration="no-results"
        variant="no-results"
        :title="t('starterPacks.libraryTabs.emptyTitle')"
        :description="
          facet === 'installed'
            ? t('starterPacks.libraryTabs.emptyInstalled')
            : t('starterPacks.libraryTabs.emptyFilter')
        "
        data-test="library-tab-empty"
      />
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-test="library-tab-grid">
        <OCard
          v-for="row in visibleRows"
          :key="row.id"
          variant="outlined"
          class="rounded-surface flex flex-col gap-2 p-3"
          :data-test="`library-tab-row-${row.id}`"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="flex min-w-0 items-center gap-2">
              <img
                v-if="row.pack.logo"
                :src="getImageURL(row.pack.logo)"
                class="size-4 shrink-0 object-contain"
                alt=""
              />
              <OIcon v-else name="inventory-2" size="sm" class="text-text-secondary" />
              <OText class="text-text-heading truncate font-medium">{{ row.title }}</OText>
            </span>
            <OBadge
              :variant="row.ready ? 'success-soft' : 'warning-soft'"
              :data-test="`library-tab-state-${row.id}`"
            >
              {{ row.ready ? t("alert_library.statReady") : t("alert_library.statNeedsData") }}
            </OBadge>
          </div>
          <OText
            v-if="countsLine(row)"
            class="text-text-body text-sm"
            :data-test="`library-tab-counts-${row.id}`"
            >{{ countsLine(row) }}</OText
          >
          <OText variant="meta" :data-test="`library-tab-meta-${row.id}`">{{
            metaLine(row)
          }}</OText>
          <div class="mt-auto flex min-w-0 items-center gap-2">
            <template v-if="isSettingUp(row)">
              <OButton variant="primary" size="sm" loading disabled>
                {{ t("starterPacks.libraryTabs.settingUpBtn") }}
              </OButton>
            </template>
            <template v-else-if="row.record || !row.ready">
              <OButton
                variant="outline"
                size="sm"
                :data-test="`library-tab-open-${row.id}`"
                @click="openPack(row)"
              >
                {{ t("starterPacks.libraryTabs.openPack") }}
              </OButton>
              <OButton
                v-if="!row.record"
                variant="ghost-primary"
                size="sm"
                :data-test="`library-tab-guide-${row.id}`"
                @click="ingestionGuide(row)"
              >
                {{ t("starterPacks.libraryTabs.ingestionGuide") }}
              </OButton>
              <OButton
                v-else-if="failedCount(row.record) > 0 && flowOf(row).canManage.value"
                variant="ghost-primary"
                size="sm"
                :data-test="`library-tab-retry-${row.id}`"
                @click="retry(row)"
              >
                {{
                  t(
                    "starterPacks.libraryTabs.retryItems",
                    { count: failedCount(row.record) },
                    failedCount(row.record),
                  )
                }}
              </OButton>
              <OButton
                v-else-if="updateAvailable(row)"
                variant="ghost-primary"
                size="sm"
                :data-test="`library-tab-review-update-${row.id}`"
                @click="openPack(row)"
              >
                {{ t("starterPacks.libraryTabs.reviewUpdate") }}
              </OButton>
              <OButton
                v-else-if="
                  isComplete(row.record) && alertsOff(row) > 0 && flowOf(row).canManage.value
                "
                variant="ghost-primary"
                size="sm"
                :data-test="`library-tab-turn-on-${row.id}`"
                @click="turnOn(row)"
              >
                {{
                  t(
                    "starterPacks.libraryTabs.turnOnAlerts",
                    { count: alertsOff(row) },
                    alertsOff(row),
                  )
                }}
              </OButton>
              <OButton
                v-else-if="canUndoSetup(row)"
                variant="ghost-primary"
                size="sm"
                :data-test="`library-tab-undo-${row.id}`"
                @click="askUndoSetup(row)"
              >
                {{ t("starterPacks.libraryTabs.undoSetup") }}
              </OButton>
            </template>
            <OButton
              v-else-if="!isAdmin"
              variant="outline"
              size="sm"
              icon-left="content-copy"
              :data-test="`library-tab-copy-link-${row.id}`"
              @click="copyLink(row)"
            >
              {{ t("starterPacks.copyLink") }}
            </OButton>
            <template v-else-if="needsLicense(row)">
              <OButton
                variant="outline"
                size="sm"
                :data-test="`library-tab-open-${row.id}`"
                @click="openPack(row)"
              >
                {{ t("starterPacks.libraryTabs.openPack") }}
              </OButton>
            </template>
            <template v-else>
              <OButton
                variant="primary"
                size="sm"
                class="min-w-0"
                :title="t('starterPacks.libraryTabs.setUpPack', { title: raw(row.title) })"
                :data-test="`library-tab-install-${row.id}`"
                @click="setUp(row)"
              >
                <span class="truncate">{{
                  t("starterPacks.libraryTabs.setUpPack", { title: raw(row.title) })
                }}</span>
              </OButton>
            </template>
          </div>
        </OCard>
        <template v-if="facet === 'all'">
          <OCard
            v-for="notice in unrepaired"
            :key="notice.stream"
            variant="outlined"
            class="rounded-surface flex flex-col gap-2 p-3"
            :data-test="`library-tab-raw-log-${notice.stream}`"
          >
            <span class="flex min-w-0 items-center gap-2">
              <OIcon name="inventory-2" size="sm" class="text-text-secondary" />
              <OText class="text-text-heading truncate font-medium">{{
                t("starterPacks.libraryTabs.nginxLogs")
              }}</OText>
            </span>
            <OText variant="meta">{{
              t("starterPacks.libraryTabs.rawLogs", { stream: raw(notice.stream) })
            }}</OText>
            <div v-if="isAdmin" class="mt-auto flex flex-wrap items-center gap-2">
              <OButton
                variant="outline"
                size="sm"
                :data-test="`library-tab-parse-${notice.stream}`"
                @click="openParse(notice)"
              >
                {{ t("starterPacks.libraryTabs.parse") }}
              </OButton>
            </div>
          </OCard>
          <OCard
            v-for="record in repairs"
            :key="record.installId"
            variant="outlined"
            class="rounded-surface flex flex-col gap-2 p-3"
            :data-test="`library-tab-parsing-${repairStream(record)}`"
          >
            <span class="flex min-w-0 items-center gap-2">
              <OIcon name="inventory-2" size="sm" class="text-text-secondary" />
              <OText class="text-text-heading truncate font-medium">{{
                t("starterPacks.libraryTabs.nginxLogs")
              }}</OText>
            </span>
            <OText
              variant="meta"
              :class="record.status === 'complete' ? '' : 'text-text-warning'"
              >{{
                t(
                  record.status === "complete"
                    ? "starterPacks.libraryTabs.parsing"
                    : "starterPacks.libraryTabs.parsingIncomplete",
                  { stream: raw(repairStream(record)) },
                )
              }}</OText
            >
            <div v-if="isAdmin" class="mt-auto flex flex-wrap items-center gap-2">
              <OButton
                variant="ghost-primary"
                size="sm"
                :data-test="`library-tab-parse-undo-${repairStream(record)}`"
                @click="openUndo(record)"
              >
                {{ t("starterPacks.parse.undo") }}
              </OButton>
            </div>
          </OCard>
        </template>
      </div>
    </template>
    <StarterPackDrawer
      v-if="drawerFlow"
      :open="true"
      :flow="drawerFlow"
      :clusters="[]"
      @update:open="drawerPackId = null"
      @done="load({ quiet: true })"
    />
    <StarterPackUndoDialog
      v-if="undoPackFlow"
      v-model:open="undoSetupOpen"
      :flow="undoPackFlow"
      mode="undo"
      @done="load()"
    />
    <StarterPackParseDialog
      v-if="parsing"
      v-model:open="parseOpen"
      :notice="parsing"
      :load="loadParse"
      :apply="applyParse"
    />
    <ODialog
      v-model:open="undoOpen"
      size="sm"
      :title="t('starterPacks.parse.undoTitle')"
      :primary-button-label="t('starterPacks.parse.undo')"
      primary-button-variant="destructive"
      primary-button-data-test="starter-pack-parse-undo-confirm-btn"
      :secondary-button-label="t('common.cancel')"
      initial-focus="secondary"
      data-test="starter-pack-parse-undo-dialog"
      @click:primary="confirmUndo"
      @click:secondary="undoOpen = false"
    >
      <div class="flex flex-col gap-2 text-sm">
        <p>{{ t("starterPacks.parse.undoRemoves") }}</p>
        <OText variant="meta">{{ t("starterPacks.parse.undoNote") }}</OText>
        <OText
          v-if="undoFailed"
          class="text-text-error"
          data-test="starter-pack-parse-undo-failed"
          >{{ t("starterPacks.parse.undoFailed") }}</OText
        >
      </div>
    </ODialog>
  </div>
</template>
