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
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { STARTER_PACKS } from "@/composables/starterPacks/kubernetesPack";
import { matchPack, readOrgStreams } from "@/composables/starterPacks/packMatchData";
import type { PackInstallRecord, StarterPack } from "@/composables/starterPacks/types";
import { useInstallRecords } from "@/composables/starterPacks/useInstallRecords";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

type Facet = "ready" | "missing" | "installed" | null;

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
const records = useInstallRecords(props.org);
const { loadManifest, loadAlertFile } = useAlertLibrary();

const rows = ref<LibraryRow[]>([]);
const state = ref<"loading" | "ready" | "error">("loading");
const facet = ref<Facet>(null);

const count = (test: (row: LibraryRow) => boolean) => rows.value.filter(test).length;
const isReadyRow = (row: LibraryRow) => row.ready;
const isInstalledRow = (row: LibraryRow) => row.record !== null;

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
    value: count((row) => !row.ready),
    icon: "sensors-off",
    tone: "warning",
    max: rows.value.length,
    dataTest: "library-tab-stat-missing",
  },
  {
    key: "installed",
    label: t("starterPacks.libraryTabs.statInstalled"),
    value: count(isInstalledRow),
    icon: "check-circle",
    tone: "neutral",
    max: rows.value.length,
    dataTest: "library-tab-stat-installed",
  },
  {
    key: "all",
    label: t("alert_library.statAll"),
    value: rows.value.length,
    icon: "widgets",
    tone: "neutral",
    dataTest: "library-tab-stat-all",
  },
]);

const visibleRows = computed(() => {
  if (facet.value === "ready") return rows.value.filter(isReadyRow);
  if (facet.value === "missing") return rows.value.filter((row) => !row.ready);
  if (facet.value === "installed") return rows.value.filter(isInstalledRow);
  return rows.value;
});

const onStatSelect = (key: string) => {
  const next = key === "all" ? null : (key as Facet);
  facet.value = facet.value === next ? null : next;
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

const load = async () => {
  state.value = "loading";
  try {
    const streams = await readOrgStreams(props.org);
    const built = await Promise.all(
      STARTER_PACKS.map(async (pack) => {
        const [match, installs] = await Promise.all([
          matchPack(props.org, pack, streams, { loadManifest, loadAlertFile }),
          records.list(pack.id),
        ]);
        const live = installs.filter(({ status }) => status !== "removed");
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
    <div v-else-if="state === 'loading'" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <OSkeleton v-for="index in 3" :key="index" type="rect" class="rounded-surface h-32 w-full" />
    </div>
    <template v-else>
      <OStatStrip
        :items="statItems"
        selectable
        :selected-key="facet ?? 'all'"
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
      <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="row in visibleRows"
          :key="row.id"
          class="border-border-default rounded-surface flex flex-col gap-2 border p-3"
          :data-test="`library-tab-row-${row.id}`"
        >
          <div class="flex items-center justify-between gap-2">
            <OText class="text-text-heading font-medium">{{ row.title }}</OText>
            <OBadge
              :variant="row.ready ? 'success-soft' : 'warning-soft'"
              :data-test="`library-tab-state-${row.id}`"
            >
              {{ row.ready ? t("alert_library.statReady") : t("alert_library.statNeedsData") }}
            </OBadge>
          </div>
          <OText class="text-text-secondary text-sm">{{ row.description }}</OText>
          <OText
            v-if="row.record"
            class="text-text-secondary text-xs"
            :data-test="`library-tab-installed-${row.id}`"
          >
            {{ installedLine(row.record) }}
            <template v-if="row.record.status !== 'complete'">
              &middot; {{ t("starterPacks.libraryTabs.statusIncomplete") }}
            </template>
          </OText>
          <div>
            <OButton
              variant="outline"
              size="sm"
              :data-test="`library-tab-open-${row.id}`"
              @click="openPack(row.packId)"
            >
              {{ t("starterPacks.libraryTabs.open") }}
            </OButton>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
