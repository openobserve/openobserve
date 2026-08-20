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

<!--
  AlertLibrary — the curated alert catalog: browse, filter, and see which alerts
  can actually run against the streams this org already receives.

  Two roles, deliberately not mixed: the RAIL navigates (pack → category →
  severity) and the STAT STRIP filters (ready / needs data / all). Mixing them
  overflowed the rail and pushed a facet group below the fold.

  Read-only in this phase. Install arrives with the drawer and wizard, so there
  is no selection UI here — a checkbox that leads nowhere is worse than none.
-->
<template>
  <div data-test="alert-library-page" class="flex h-full flex-col">
    <OPageLayout
      bleed
      :title="t('alert_library.header')"
      icon="menu-book"
      title-data-test="alert-library-title"
    >
      <!-- Fixed-width, subtitle-free title so the peer tabs anchor at the same
           x on all four alerting pages — see AlertList.vue for the rationale. -->
      <template #title>
        <span class="inline-block w-52 truncate">{{ t("alert_library.header") }}</span>
      </template>
      <template #header-tabs>
        <AlertSectionTabs />
      </template>

      <template #actions>
        <ORefreshButton
          :last-run-at="lastFetched"
          :loading="isLoading"
          data-test="alert-library-refresh"
          @click="refresh"
        />
        <OButton
          variant="outline"
          size="sm"
          icon-left="open-in-new"
          data-test="alert-library-contribute"
          @click="openContribute"
        >
          {{ t("alert_library.contribute") }}
        </OButton>
      </template>

      <div class="flex min-h-0 flex-1">
        <div class="w-rail border-border-default h-full shrink-0 border-r">
          <LibraryRail
            :packs="packFacets"
            :pack="activePack"
            :categories="categoryFacets"
            :category="category"
            :severities="severityFacets"
            :severity="severity"
            @update:pack="onPackChange"
            @update:category="category = $event"
            @update:severity="severity = $event"
          />
        </div>

        <div class="flex h-full min-w-0 flex-1 flex-col">
          <!-- Load failure replaces the whole body: a toolbar over an empty grid
               reads as "there is nothing here", which is a different claim. -->
          <OEmptyState
            v-if="loadFailed"
            size="hero"
            variant="error"
            illustration="broken-panel"
            class="min-h-0 flex-1"
            :title="t('alert_library.loadFailedTitle')"
            :description="errorDescription"
            :action-label="t('alert_library.retry')"
            action-icon="refresh"
            data-test="alert-library-error"
            @action="refresh"
          />

          <template v-else>
            <div class="border-border-default px-page-edge shrink-0 border-b py-2">
              <OSearchInput
                v-model="search"
                size="sm"
                :debounce="200"
                :placeholder="t('alert_library.searchPlaceholder')"
                data-test="alert-library-search"
              />
            </div>

            <div class="px-page-edge shrink-0 py-2">
              <OStatStrip
                :items="statItems"
                selectable
                :selected-key="facet"
                data-test="alert-library-strip"
                @select="onStatSelect"
              />
            </div>

            <div v-if="showCollectorBanner" class="px-page-edge shrink-0 pb-2">
              <LibraryEmptyState
                :pack-label="activePackLabel"
                :count="packEntries.length"
                @action="goToIngestion"
              />
            </div>

            <div
              class="px-page-edge min-h-0 flex-1 overflow-y-auto pb-4"
              data-test="alert-library-grid"
            >
              <div v-if="isBusy" class="grid gap-3 py-1 md:grid-cols-2 xl:grid-cols-3">
                <OSkeleton
                  v-for="index in 6"
                  :key="index"
                  type="rect"
                  class="rounded-surface h-32 w-full"
                />
              </div>

              <OEmptyState
                v-else-if="groupedEntries.length === 0"
                size="block"
                class="py-8"
                illustration="no-results"
                variant="no-results"
                :title="t('alert_library.noMatchesTitle')"
                :description="t('alert_library.noMatchesDescription')"
                :action-label="hasActiveFilters ? t('alert_library.clearFilters') : undefined"
                action-icon="filter-list"
                data-test="alert-library-no-results"
                @action="clearFilters"
              />

              <template v-else>
                <section v-for="group in groupedEntries" :key="group.id" class="pt-3">
                  <h2
                    class="text-text-secondary text-2xs flex items-center gap-2 pb-2 font-semibold uppercase"
                    :data-test="`alert-library-group-${group.id}`"
                  >
                    <span>{{ group.label }}</span>
                    <span class="tabular-nums opacity-70">{{ group.entries.length }}</span>
                  </h2>
                  <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <LibraryCard
                      v-for="entry in group.entries"
                      :key="entry.id"
                      :entry="entry"
                      :ready="entryReady(entry)"
                      @open="openEntry(entry)"
                    />
                  </div>
                </section>
              </template>
            </div>
          </template>
        </div>
      </div>
    </OPageLayout>

    <LibraryDrawer
      v-model:open="drawerOpen"
      :entry="selectedEntry"
      :ready="selectedEntry ? entryReady(selectedEntry) : false"
      @install="onInstall"
    />

    <!-- `installed` is deliberately unlistened here: Phase 5 consumes it to
         mark entries as installed. Do not delete it as dead code. -->
    <LibraryInstallDialog
      :open="installOpen"
      :entries="visibleEntries"
      :seed="installSeed"
      @update:open="onInstallOpenChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

import AlertSectionTabs from "@/components/alerts/AlertSectionTabs.vue";
import LibraryCard from "@/components/alertLibrary/LibraryCard.vue";
import LibraryDrawer from "@/components/alertLibrary/LibraryDrawer.vue";
import LibraryEmptyState from "@/components/alertLibrary/LibraryEmptyState.vue";
import LibraryInstallDialog from "@/components/alertLibrary/LibraryInstallDialog.vue";
import LibraryRail from "@/components/alertLibrary/LibraryRail.vue";
import {
  categoryLabel,
  packLabel,
  severityLabel,
  severityRank,
  SEVERITY_ORDER,
  type LibraryFacet,
} from "@/components/alertLibrary/libraryFacets";
import { useAlertLibrary, toStreamsByType } from "@/composables/alerts/useAlertLibrary";
import type { AlertLibraryErrorCode } from "@/composables/alerts/useAlertLibrary";
import useStreams from "@/composables/useStreams";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { AlertLibraryEntry, AlertLibraryFile, StreamsByType } from "@/types/alertLibrary";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

/** Where the alerts are authored. Not the serving URL — that is a constant. */
const CONTRIBUTE_URL = "https://github.com/openobserve/o2-alerts-library";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const { manifest, isLoading, error, loadManifest, isReady } = useAlertLibrary();
const { getStreams } = useStreams(t);

const selectedPack = ref("");
const category = ref("all");
const severity = ref("all");
/** Stat-strip facet. `null` = no availability filter; "all" never sticks. */
const facet = ref<"ready" | "missing" | null>(null);
const search = ref("");

/** Kept after close so the drawer can animate out with its content intact. */
const selectedEntry = ref<AlertLibraryEntry | null>(null);
const drawerOpen = ref(false);

const installOpen = ref(false);
const installSeed = ref<{ entry: AlertLibraryEntry; file: AlertLibraryFile } | null>(null);

const streamsByType = ref<StreamsByType>({});
const streamsPending = ref(true);
/**
 * False until the org's stream list has actually been read. A failed stream
 * request must not be reported as "none of your data matches" — that is the
 * request failing, not the org missing telemetry.
 */
const readinessKnown = ref(false);

const entries = computed<AlertLibraryEntry[]>(() => manifest.value?.alerts ?? []);
const lastFetched = computed<number | null>(() => store.state.alertLibrary?.lastFetched ?? null);
const loadFailed = computed(() => !!error.value && !manifest.value);
const isBusy = computed(() => (isLoading.value || streamsPending.value) && !manifest.value);

const errorDescription = computed(() => {
  const code = (error.value?.code ?? "malformed") as AlertLibraryErrorCode;
  const keys: Record<AlertLibraryErrorCode, I18nKey> = {
    network: "alert_library.error.network",
    http: "alert_library.error.http",
    unparseable: "alert_library.error.unparseable",
    unsupported_version: "alert_library.error.unsupported_version",
    malformed: "alert_library.error.malformed",
  };
  return t(keys[code] ?? keys.malformed);
});

// ── pack ───────────────────────────────────────────────────────────────────
/** Manifest pack order, with any pack that only the alerts mention appended. */
const packIds = computed<string[]>(() => {
  const ids = (manifest.value?.packs ?? []).map((pack) => pack.id).filter(Boolean);
  for (const entry of entries.value) {
    if (entry.pack && !ids.includes(entry.pack)) ids.push(entry.pack);
  }
  return ids;
});

const activePack = computed(() => {
  if (selectedPack.value && packIds.value.includes(selectedPack.value)) return selectedPack.value;
  return packIds.value[0] ?? "";
});
const activePackLabel = computed(() => packLabel(activePack.value));

const packEntries = computed(() => entries.value.filter((e) => e.pack === activePack.value));

const packFacets = computed<LibraryFacet[]>(() =>
  packIds.value.map((id) => ({
    id,
    label: packLabel(id),
    count: entries.value.filter((entry) => entry.pack === id).length,
  })),
);

// ── readiness ──────────────────────────────────────────────────────────────
const entryReady = (entry: AlertLibraryEntry): boolean =>
  readinessKnown.value ? isReady(entry, streamsByType.value) : true;

const readyCount = computed(() => packEntries.value.filter(entryReady).length);
const missingCount = computed(() => packEntries.value.length - readyCount.value);

/**
 * The one case a number cannot express: not a single alert in this pack can
 * run, so the answer is a CTA rather than a count. Anything else and the strip
 * already says it.
 */
const showCollectorBanner = computed(
  () => readinessKnown.value && packEntries.value.length > 0 && readyCount.value === 0,
);

// ── facets ─────────────────────────────────────────────────────────────────
/** Availability filter applies before the rail facets, so rail counts are stable. */
const availableEntries = computed(() =>
  packEntries.value.filter((entry) => {
    if (facet.value === "ready") return entryReady(entry);
    if (facet.value === "missing") return !entryReady(entry);
    return true;
  }),
);

const categoryFacets = computed<LibraryFacet[]>(() => {
  const counts = new Map<string, number>();
  for (const entry of packEntries.value) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  return [
    { id: "all", label: t("alert_library.allCategories"), count: packEntries.value.length },
    ...[...counts.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({ id, label: categoryLabel(id), count: counts.get(id) ?? 0 })),
  ];
});

const severityFacets = computed<LibraryFacet[]>(() => [
  { id: "all", label: t("alert_library.severityAll"), count: packEntries.value.length },
  ...SEVERITY_ORDER.map((id) => ({
    id: id as string,
    label: severityLabel(t, id),
    count: packEntries.value.filter((entry) => entry.severity === id).length,
  })),
]);

const statItems = computed<StatItem[]>(() => [
  {
    key: "ready",
    label: t("alert_library.statReady"),
    value: readyCount.value,
    icon: "check-circle",
    tone: "success",
    max: packEntries.value.length,
    dataTest: "alert-library-stat-ready",
  },
  {
    key: "missing",
    label: t("alert_library.statNeedsData"),
    value: missingCount.value,
    icon: "sensors-off",
    tone: "neutral",
    max: packEntries.value.length,
    dataTest: "alert-library-stat-missing",
  },
  // Last, and never highlighted: it is the way OUT of a filter, not a filter.
  {
    key: "all",
    label: t("alert_library.statAll"),
    value: packEntries.value.length,
    icon: "widgets",
    tone: "neutral",
    dataTest: "alert-library-stat-all",
  },
]);

// ── visible set ────────────────────────────────────────────────────────────
const visibleEntries = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return availableEntries.value
    .filter((entry) => category.value === "all" || entry.category === category.value)
    .filter((entry) => severity.value === "all" || entry.severity === severity.value)
    .filter((entry) => {
      if (!needle) return true;
      const haystack = `${entry.title} ${entry.id} ${entry.description} ${entry.stream}`;
      return haystack.toLowerCase().includes(needle);
    })
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) || a.title.localeCompare(b.title),
    );
});

const groupedEntries = computed(() => {
  const groups = new Map<string, AlertLibraryEntry[]>();
  for (const entry of visibleEntries.value) {
    const bucket = groups.get(entry.category);
    if (bucket) bucket.push(entry);
    else groups.set(entry.category, [entry]);
  }
  return [...groups.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, label: categoryLabel(id), entries: groups.get(id) ?? [] }));
});

const hasActiveFilters = computed(
  () =>
    category.value !== "all" ||
    severity.value !== "all" ||
    facet.value !== null ||
    search.value.trim() !== "",
);

// ── actions ────────────────────────────────────────────────────────────────
const onPackChange = (id: string) => {
  selectedPack.value = id;
  // A category belongs to a pack; carrying it across would land on an empty grid.
  category.value = "all";
};

const onStatSelect = (key: string) => {
  if (key === "all") {
    facet.value = null;
    return;
  }
  const next = key as "ready" | "missing";
  facet.value = facet.value === next ? null : next;
};

const clearFilters = () => {
  category.value = "all";
  severity.value = "all";
  facet.value = null;
  search.value = "";
};

const openEntry = (entry: AlertLibraryEntry) => {
  selectedEntry.value = entry;
  drawerOpen.value = true;
};

/**
 * The drawer hands over the file it already tuned; the wizard answers the rest.
 * Closing the drawer keeps one overlay on screen at a time — the wizard offers
 * the whole visible set, so the single-alert view behind it is finished.
 */
const onInstall = (payload: { entry: AlertLibraryEntry; file: AlertLibraryFile }) => {
  installSeed.value = payload;
  drawerOpen.value = false;
  installOpen.value = true;
};

const onInstallOpenChange = (open: boolean) => {
  installOpen.value = open;
  // Drop the tuned file on close so a later open cannot reuse a stale one.
  if (!open) installSeed.value = null;
};

const openContribute = () => {
  window.open(CONTRIBUTE_URL, "_blank", "noopener");
};

const goToIngestion = () => {
  void router.push({
    name: "ingestion",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
};

const loadStreams = async () => {
  streamsPending.value = true;
  try {
    // `notify: false` — the gallery draws its own skeleton; a global toast for
    // a background readiness check is noise.
    const payload = (await getStreams("all", false, false)) as {
      list?: Array<{ name?: string; stream_type?: string }>;
    };
    streamsByType.value = toStreamsByType(payload?.list);
    readinessKnown.value = true;
  } catch {
    // Leave readiness unknown: see readinessKnown.
    readinessKnown.value = false;
  } finally {
    streamsPending.value = false;
  }
};

const refresh = () => {
  void loadManifest({ force: true }).catch(() => {
    // Surfaced through `error`; the empty state offers Retry.
  });
  void loadStreams();
};

onMounted(() => {
  void loadManifest().catch(() => {
    /* see refresh */
  });
  void loadStreams();
});
</script>
