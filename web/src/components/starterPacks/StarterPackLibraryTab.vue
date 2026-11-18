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
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import StarterPackParseDialog from "@/components/starterPacks/StarterPackParseDialog.vue";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { STARTER_PACKS } from "@/composables/starterPacks/kubernetesPack";
import { matchPack, readOrgStreams } from "@/composables/starterPacks/packMatchData";
import { findRawNginxLogs, type RawLogNotice } from "@/composables/starterPacks/rawLogs";
import type { PackInstallRecord, StarterPack } from "@/composables/starterPacks/types";
import { useInstallRecords } from "@/composables/starterPacks/useInstallRecords";
import { useNginxParse, type ParsePreview } from "@/composables/starterPacks/useNginxParse";
import { isOrgAdmin, useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useStreamValues } from "@/composables/starterPacks/useStreamValues";
import StarterPackDrawer from "./StarterPackDrawer.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

type Facet = "ready" | "installed" | "all";

interface LibraryRow {
  id: string;
  packId: string;
  title: I18nText;
  description: I18nText;
  ready: boolean;
  record: PackInstallRecord | null;
}

const props = defineProps<{ org: string; view: "packs" | "dashboards" }>();

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
const search = ref("");
const flows = new Map(STARTER_PACKS.map((pack) => [pack.id, useStarterPackFlow(props.org, pack)]));
const drawerPackId = ref<string | null>(null);
const drawerFlow = computed(() => (drawerPackId.value ? flows.get(drawerPackId.value) : undefined));
const rawLogs = ref<RawLogNotice[]>([]);
const repairs = ref<PackInstallRecord[]>([]);
const parsing = ref<RawLogNotice | null>(null);
const parseOpen = ref(false);
const undoing = ref<PackInstallRecord | null>(null);
const undoOpen = ref(false);
const undoFailed = ref(false);

const isAdmin = computed(() => isOrgAdmin(store.state));
const repairStream = (record: PackInstallRecord) => record.items[0]?.stream ?? "";
const unrepaired = computed(() => {
  const repaired = new Set(repairs.value.map(repairStream));
  return rawLogs.value.filter(({ stream }) => !repaired.has(stream));
});

const count = (test: (row: LibraryRow) => boolean) => rows.value.filter(test).length;
const isReadyRow = (row: LibraryRow) => row.ready;
const isInstalledRow = (row: LibraryRow) => row.record !== null;

const chips = computed(() => [
  { key: "ready", label: t("starterPacks.libraryTabs.chipFits", { count: count(isReadyRow) }) },
  {
    key: "installed",
    label: t("starterPacks.libraryTabs.chipInstalled", { count: count(isInstalledRow) }),
  },
  { key: "all", label: t("starterPacks.libraryTabs.chipAll", { count: rows.value.length }) },
]);

const visibleRows = computed(() => {
  const term = search.value.trim().toLowerCase();
  const found = term
    ? rows.value.filter((row) => `${row.title} ${row.description}`.toLowerCase().includes(term))
    : rows.value;
  if (facet.value === "ready") return found.filter(isReadyRow);
  if (facet.value === "installed") return found.filter(isInstalledRow);
  return found;
});
const sections = computed(() =>
  [
    {
      key: "fits",
      title: t("starterPacks.libraryTabs.sectionFits"),
      rows: visibleRows.value.filter(isReadyRow),
    },
    {
      key: "missing",
      title: t("starterPacks.libraryTabs.sectionMissing"),
      rows: visibleRows.value.filter((row) => !row.ready),
    },
  ].filter((section) => section.rows.length),
);

const onChip = (key: unknown) => {
  facet.value = (key as Facet) ?? "all";
};

const packItems = (record: PackInstallRecord) =>
  record.items.filter(({ kind }) => kind !== "folder");
const madeCount = (record: PackInstallRecord) =>
  packItems(record).filter(({ status }) => status === "created" || status === "existing").length;
const failedCount = (record: PackInstallRecord) =>
  packItems(record).filter(({ status }) => status === "failed").length;
const stateBadge = (record: PackInstallRecord) => {
  const failed = failedCount(record);
  if (failed > 0) {
    return {
      variant: "error-soft" as const,
      icon: "error",
      label: t("starterPacks.libraryTabs.stateFailed", { count: failed }, failed),
    };
  }
  if (record.status !== "complete") {
    return {
      variant: "warning-soft" as const,
      icon: undefined,
      label: t("starterPacks.libraryTabs.stateSettingUp"),
    };
  }
  return {
    variant: "success-soft" as const,
    icon: undefined,
    label: t("starterPacks.libraryTabs.statInstalled"),
  };
};
const packTitles = computed(() => rows.value.map(({ title }) => title).join(", "));
const openDashboard = (packId: string) => void flows.get(packId)?.land();
const seeIncluded = (packId: string) => {
  drawerPackId.value = packId;
};
const install = async (packId: string) => {
  const flow = flows.get(packId);
  if (!flow) return;
  drawerPackId.value = packId;
  if (await flow.install()) {
    drawerPackId.value = null;
    await flow.land();
  }
};

const installedLine = (record: PackInstallRecord) => {
  const date = raw(
    record.installedAt
      ? new Date(record.installedAt / 1000).toLocaleString()
      : t("starterPacks.libraryTabs.unknownDate"),
  );
  return record.installedBy
    ? t("starterPacks.libraryTabs.installedBy", { who: raw(record.installedBy), date })
    : t("starterPacks.libraryTabs.installedByUnknown", { date });
};

const openPack = (packId: string) =>
  router
    .push({
      name: "starterPack",
      params: { pack: packId },
      query: { org_identifier: props.org },
    })
    .catch(() => {});

const packRows = (pack: StarterPack, ready: boolean, live: PackInstallRecord[]): LibraryRow[] => {
  const base = {
    packId: pack.id,
    title: t(pack.titleKey),
    description: t(pack.descriptionKey),
    ready,
  };
  // One row per install: the Installed filter owes every installer and date, not only the newest.
  if (!live.length) return [{ ...base, id: pack.id, record: null }];
  return live.map((record) => ({ ...base, id: record.installId, record }));
};

const dashboardRows = (
  pack: StarterPack,
  ready: Map<string, boolean>,
  live: PackInstallRecord[],
): LibraryRow[] =>
  pack.dashboards.flatMap((dashboard): LibraryRow[] => {
    const base = {
      id: `${pack.id}/${dashboard.id}`,
      packId: pack.id,
      title: raw(dashboard.title),
      description: t(pack.titleKey),
      ready: ready.get(dashboard.id) ?? false,
    };
    const holders = live.filter(({ items }) =>
      items.some(
        ({ kind, itemId, status }) =>
          kind === "dashboard" &&
          itemId === dashboard.id &&
          (status === "created" || status === "existing"),
      ),
    );
    if (!holders.length) return [{ ...base, record: null }];
    return holders.map((record) => ({
      ...base,
      id: `${base.id}/${record.installId}`,
      record,
    }));
  });

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

const load = async () => {
  state.value = "loading";
  try {
    const streams = await readOrgStreams(props.org);
    if (props.view === "packs") void loadRawLogs(streams.logs ?? new Map());
    const built = await Promise.all(
      STARTER_PACKS.map(async (pack) => {
        const [match, installs] = await Promise.all([
          matchPack(props.org, pack, streams, { loadManifest, loadAlertFile }),
          records.list(pack.id),
        ]);
        const live = installs.filter(({ status }) => status !== "removed");
        // Without a preview the flow counts every manifest item, not what install would create.
        if (props.view === "packs" && match.ready && !live.length) {
          void flows.get(pack.id)?.loadPreview();
        }
        return props.view === "packs"
          ? packRows(pack, match.ready, live)
          : dashboardRows(pack, match.dashboards, live);
      }),
    );
    rows.value = built.flat();
    state.value = "ready";
  } catch {
    state.value = "error";
  }
};

onMounted(() => void load());
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
      @action="load"
    />
    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <OSearchInput
          v-model="search"
          class="min-w-48 flex-1"
          :placeholder="t('starterPacks.libraryTabs.search')"
          data-test="library-tab-search"
        />
        <OToggleGroup
          :model-value="facet"
          data-test="library-tab-chips"
          @update:model-value="onChip"
        >
          <OToggleGroupItem
            v-for="chip in chips"
            :key="chip.key"
            :value="chip.key"
            size="sm"
            :data-test="`library-tab-chip-${chip.key}`"
          >
            {{ chip.label }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>
      <div
        v-if="state === 'loading'"
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
        <OBanner
          v-for="notice in unrepaired"
          :key="notice.stream"
          variant="default"
          dense
          inline-actions
          :content="t('starterPacks.libraryTabs.rawLogs', { stream: raw(notice.stream) })"
          :data-test="`library-tab-raw-log-${notice.stream}`"
        >
          <template v-if="isAdmin" #actions>
            <OButton
              variant="outline"
              size="sm"
              :data-test="`library-tab-parse-${notice.stream}`"
              @click="openParse(notice)"
            >
              {{ t("starterPacks.libraryTabs.parse") }}
            </OButton>
          </template>
        </OBanner>
        <OBanner
          v-for="record in repairs"
          :key="record.installId"
          :variant="record.status === 'complete' ? 'default' : 'warning'"
          dense
          inline-actions
          :content="
            t(
              record.status === 'complete'
                ? 'starterPacks.libraryTabs.parsing'
                : 'starterPacks.libraryTabs.parsingIncomplete',
              { stream: raw(repairStream(record)) },
            )
          "
          :data-test="`library-tab-parsing-${repairStream(record)}`"
        >
          <template v-if="isAdmin" #actions>
            <OButton
              variant="outline"
              size="sm"
              :data-test="`library-tab-parse-undo-${repairStream(record)}`"
              @click="openUndo(record)"
            >
              {{ t("starterPacks.parse.undo") }}
            </OButton>
          </template>
        </OBanner>
        <OEmptyState
          v-if="visibleRows.length === 0 && search.trim()"
          size="block"
          class="py-8"
          illustration="no-results"
          variant="no-results"
          :title="t('starterPacks.libraryTabs.noMatchTitle', { search: raw(search.trim()) })"
          :description="t('starterPacks.libraryTabs.noMatchBody', { packs: raw(packTitles) })"
          :action-label="t('starterPacks.libraryTabs.clearSearch')"
          action-icon="close"
          data-test="library-tab-empty"
          @action="search = ''"
        />
        <OEmptyState
          v-else-if="visibleRows.length === 0"
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
        <section
          v-for="section in sections"
          :key="section.key"
          class="flex flex-col gap-2"
          :data-test="`library-tab-section-${section.key}`"
        >
          <OText class="text-text-heading font-medium">{{ section.title }}</OText>
          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <OCard
              v-for="row in section.rows"
              :key="row.id"
              variant="outlined"
              class="rounded-surface flex flex-col gap-2 p-3"
              :data-test="`library-tab-row-${row.id}`"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="flex min-w-0 items-center gap-2">
                  <OIcon name="hub" size="sm" class="text-text-secondary" />
                  <OText class="text-text-heading truncate font-medium">{{ row.title }}</OText>
                </span>
                <OBadge
                  v-if="row.record"
                  :variant="stateBadge(row.record).variant"
                  :icon="stateBadge(row.record).icon"
                  :data-test="`library-tab-state-${row.id}`"
                >
                  {{ stateBadge(row.record).label }}
                </OBadge>
              </div>
              <OText class="text-text-body text-sm">{{ row.description }}</OText>
              <OText v-if="row.record" variant="meta">
                <span v-if="view === 'packs'" :data-test="`library-tab-items-${row.id}`"
                  >{{
                    t("starterPacks.libraryTabs.itemsInstalled", {
                      made: madeCount(row.record),
                      total: packItems(row.record).length,
                    })
                  }}<template v-if="failedCount(row.record)"
                    >{{ raw(" · ")
                    }}{{
                      t(
                        "starterPacks.libraryTabs.itemsFailed",
                        { count: failedCount(row.record) },
                        failedCount(row.record),
                      )
                    }}</template
                  >{{ raw(" · ") }}</span
                ><span :data-test="`library-tab-installed-${row.id}`"
                  >{{ installedLine(row.record)
                  }}<template v-if="row.record.status !== 'complete'"
                    >{{ raw(" · ") }}{{ t("starterPacks.libraryTabs.statusIncomplete") }}</template
                  ></span
                >
              </OText>
              <div class="mt-auto flex flex-wrap items-center gap-2">
                <template v-if="view === 'dashboards' || row.record">
                  <OButton
                    variant="outline"
                    size="sm"
                    :data-test="`library-tab-open-${row.id}`"
                    @click="openPack(row.packId)"
                  >
                    {{
                      view === "packs"
                        ? t("starterPacks.libraryTabs.openPack")
                        : t("starterPacks.libraryTabs.open")
                    }}
                  </OButton>
                  <OButton
                    v-if="view === 'packs'"
                    variant="ghost-primary"
                    size="sm"
                    :data-test="`library-tab-open-dashboard-${row.id}`"
                    @click="openDashboard(row.packId)"
                  >
                    {{ t("starterPacks.libraryTabs.openDashboard") }}
                  </OButton>
                </template>
                <template v-else>
                  <OButton
                    variant="primary"
                    size="sm"
                    :data-test="`library-tab-install-${row.id}`"
                    @click="install(row.packId)"
                  >
                    {{ t("starterPacks.libraryTabs.setUpPack", { title: raw(row.title) }) }}
                  </OButton>
                  <OButton
                    variant="ghost-primary"
                    size="sm"
                    :data-test="`library-tab-see-${row.id}`"
                    @click="seeIncluded(row.packId)"
                  >
                    {{ t("starterPacks.libraryTabs.whatGetsCreated") }}
                  </OButton>
                </template>
              </div>
            </OCard>
          </div>
        </section>
      </template>
    </template>
    <StarterPackDrawer
      v-if="drawerFlow"
      :open="true"
      :flow="drawerFlow"
      :clusters="[]"
      @update:open="drawerPackId = null"
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
