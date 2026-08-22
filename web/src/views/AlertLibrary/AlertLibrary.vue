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

  No bulk selection in the GALLERY. Install is entered per-alert from the
  drawer, and the wizard it opens offers the whole visible set from there — so
  a second selection model here would be a checkbox competing with that one.
-->
<template>
  <div data-test="alert-library-page" class="flex h-full flex-col">
    <OPageLayout
      bleed
      :title="t('alerts.header')"
      icon="shield-alert-outline"
      title-data-test="alert-library-title"
    >
      <!-- Section-level title, identical on all four alerting pages, so the
           peer tabs anchor at the same x — see AlertList.vue for the rationale.
           Subtitle-free for the same reason. -->
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
            :categories="categoryFacets"
            :selected-categories="selectedCategories"
            :severities="severityFacets"
            :severity="severity"
            :search="railSearch"
            @update:search="railSearch = $event"
            @update:selected-categories="selectedCategories = $event"
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
                :label="soleCategoryLabel ?? raw('')"
                :count="scopedEntries.length"
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

              <!-- A catalog that loaded but holds nothing is not a filter
                   problem, and "try another category" is not advice when there
                   are no categories. Offering Clear filters there would be a
                   button that changes nothing. -->
              <OEmptyState
                v-else-if="entries.length === 0"
                size="block"
                class="py-8"
                illustration="no-results"
                variant="no-results"
                :title="t('alert_library.emptyLibraryTitle')"
                :description="t('alert_library.emptyLibraryDescription')"
                :action-label="t('alert_library.retry')"
                action-icon="refresh"
                data-test="alert-library-empty-catalog"
                @action="refresh"
              />

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
                    <span v-if="group.packLabel" class="opacity-70"
                      >{{ group.packLabel }} &middot;</span
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
      :data-state="selectedDataState.state"
      :last-ingested-micros="selectedDataState.lastIngestedMicros"
      @install="onInstall"
    />

    <!-- `installed` is deliberately unlistened here: Phase 5 consumes it to mark
         gallery entries as installed. Do not delete it as dead code. -->
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
import {
  useAlertLibrary,
  toStreamsByType,
  streamDataState,
} from "@/composables/alerts/useAlertLibrary";
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
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";

/** Where the alerts are authored. Not the serving URL — that is a constant. */
const CONTRIBUTE_URL = "https://github.com/openobserve/o2-alerts-library";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const { manifest, isLoading, error, loadManifest, isReady } = useAlertLibrary();
const { getStreams } = useStreams(t);

/** Empty = every category. The rail narrows, it does not gate. */
const selectedCategories = ref<string[]>([]);
/** The rail's own list filter, held here so clearFilters can reset it too. */
const railSearch = ref("");
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
/**
 * Skeleton until there is something honest to draw.
 *
 * The manifest and the org's streams load in parallel, and the manifest wins —
 * it is a small cached S3 object, the streams are a backend query. Gating only
 * on `!manifest` therefore painted the grid the instant the manifest landed,
 * while readiness was still unknown; `entryReady` optimistically answers `true`
 * then, so every card rendered solid and full-opacity and then dimmed to
 * `border-dashed opacity-65` a moment later when the streams arrived. That read
 * as the borders getting lighter on their own.
 *
 * Also requiring `readinessKnown` holds the skeleton until the verdict is real.
 * It cannot stick: a failed stream load clears `streamsPending` in its `finally`,
 * so the grid renders with readiness deliberately unknown (cards undimmed). And
 * a background refresh keeps `readinessKnown` true, so the grid is never blanked
 * under the user.
 */
const isBusy = computed(
  () => (isLoading.value || streamsPending.value) && (!manifest.value || !readinessKnown.value),
);

const errorDescription = computed(() => {
  const code = (error.value?.code ?? "malformed") as AlertLibraryErrorCode;
  const keys: Record<AlertLibraryErrorCode, I18nKey> = {
    network: "alert_library.error.network",
    http: "alert_library.error.http",
    unparseable: "alert_library.error.unparseable",
    unsupported_version: "alert_library.error.unsupported_version",
    malformed: "alert_library.error.malformed",
  };
  // hasOwn, not `??`: a code of "constructor" or "toString" would otherwise
  // return an inherited function and hand t() something that is not a key.
  return t(Object.hasOwn(keys, code) ? keys[code] : keys.malformed);
});

// ── readiness ──────────────────────────────────────────────────────────────
const entryReady = (entry: AlertLibraryEntry): boolean =>
  readinessKnown.value ? isReady(entry, streamsByType.value) : true;

// ── scope ──────────────────────────────────────────────────────────────────
/**
 * Everything the rail and the search have narrowed to, BEFORE the stat strip's
 * availability filter. That order matters both ways round: the strip counts
 * this set, so its numbers describe the grid underneath it, and the strip's own
 * filter is excluded so that clicking "Not ingested" cannot change the totals
 * it is being read against.
 */
/**
 * The manifest is fetched content, and only five fields are validated on the
 * way in (see assertManifest) — `title`, `category` and `description` are not
 * among them. Every read of them here is therefore defensive: an entry
 * published without a title must not blank the gallery, which is the same
 * posture `isReady` and `categoryLabel` already take.
 */
const text = (value: unknown): string => (typeof value === "string" ? value : "");

const matchesSearch = (entry: AlertLibraryEntry, needle: string): boolean => {
  if (!needle) return true;
  // Joined from the fields that exist, so a missing description cannot put the
  // literal string "undefined" into the haystack and make it searchable.
  const haystack = [entry.title, entry.id, entry.description, entry.stream]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  return haystack.toLowerCase().includes(needle);
};

const matchesCategory = (entry: AlertLibraryEntry): boolean =>
  selectedCategories.value.length === 0 || selectedCategories.value.includes(entry.category);

const matchesSeverity = (entry: AlertLibraryEntry): boolean =>
  severity.value === "all" || entry.severity === severity.value;

const matchesFacet = (entry: AlertLibraryEntry): boolean => {
  if (facet.value === "ready") return entryReady(entry);
  if (facet.value === "missing") return !entryReady(entry);
  return true;
};

const searchScoped = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return entries.value.filter((entry) => matchesCategory(entry) && matchesSearch(entry, needle));
});

const scopedEntries = computed(() => searchScoped.value.filter(matchesSeverity));

// Readiness is "the streams exist"; this is what they would actually give the
// alert. Only the drawer reads it — the gallery's ready/needs-data facets stay
// on stream existence, which is the question the stat strip asks.
const selectedDataState = computed(() =>
  selectedEntry.value && readinessKnown.value
    ? streamDataState(selectedEntry.value, streamsByType.value)
    : { state: "fresh" as const, lastIngestedMicros: null },
);

const readyCount = computed(() => scopedEntries.value.filter(entryReady).length);
const missingCount = computed(() => scopedEntries.value.length - readyCount.value);

/** Non-null only when one category is in view — see showCollectorBanner. */
const soleCategoryLabel = computed(() => {
  const ids = new Set(scopedEntries.value.map((entry) => entry.category));
  const [only] = [...ids];
  return ids.size === 1 ? categoryLabel(only) : null;
});

/**
 * The one case a number cannot express: not a single alert in view can run, so
 * the answer is a CTA rather than a count. Anything else and the strip already
 * says it.
 *
 * Gated on ONE category being in view because the copy names the telemetry to
 * send — "send Kafka telemetry" is only advice while there is one thing to send.
 */
const showCollectorBanner = computed(
  () =>
    readinessKnown.value &&
    soleCategoryLabel.value !== null &&
    scopedEntries.value.length > 0 &&
    readyCount.value === 0 &&
    // Not over an empty grid. With the "Ready to install" tile active and
    // nothing ready, this banner and the no-results state both rendered — two
    // different explanations for one blank area, and this one citing a count of
    // alerts that were not on screen.
    availableEntries.value.length > 0,
);

// ── facets ─────────────────────────────────────────────────────────────────
const availableEntries = computed(() => scopedEntries.value.filter(matchesFacet));

/**
 * Counted against every OTHER active filter, never against the category
 * selection itself — the metrics explorer's rule, where the comment reads
 * "how many more would this add".
 *
 * Absolute counts read as a promise the rail cannot keep: with "kafka" typed in
 * the toolbar it still advertised "Cassandra 30", and ticking it produced an
 * empty grid. Counting within the selection would be the opposite mistake,
 * dropping every other row to zero the moment you ticked one.
 *
 * A selected category is seeded at 0 so it stays listed even when the other
 * filters leave it with nothing — otherwise the rail would hide the row you
 * need in order to untick it. That is what the rail's dead-end rule is for.
 */
const categoryFacets = computed<LibraryFacet[]>(() => {
  const needle = search.value.trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const id of selectedCategories.value) counts.set(id, 0);
  for (const entry of entries.value) {
    if (!matchesSearch(entry, needle) || !matchesSeverity(entry) || !matchesFacet(entry)) continue;
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  return [...counts.keys()]
    .sort((a, b) => text(a).localeCompare(text(b)))
    .map((id) => ({ id, label: categoryLabel(id), count: counts.get(id) ?? 0 }));
});

/**
 * Counted BEFORE the severity filter itself, or picking Critical would drop
 * Warning to zero and make the chip you are standing on look like the only
 * one with anything behind it.
 */
const severityFacets = computed<LibraryFacet[]>(() => {
  // One pass, not one per severity. The rail renders these chips without
  // counts by design, so this ran four filters over the whole scope on every
  // keystroke to produce numbers nothing displayed.
  const tally = new Map<string, number>();
  for (const entry of searchScoped.value) {
    tally.set(entry.severity, (tally.get(entry.severity) ?? 0) + 1);
  }
  return [
    { id: "all", label: t("alert_library.severityAll"), count: searchScoped.value.length },
    ...SEVERITY_ORDER.map((id) => ({
      id: id as string,
      label: severityLabel(t, id),
      count: tally.get(id) ?? 0,
    })),
  ];
});

/**
 * Readiness is a claim about the org's data, and when the stream check failed
 * we have no claim to make. The cards deliberately stay undimmed — refusing to
 * say "none of your data matches" — but the strip was making the OPPOSITE
 * assertion just as loudly: `entryReady` answers true while readiness is
 * unknown, so a failed /streams call read as "Ready to install 42 / Not
 * ingested 0". An em dash says the honest thing.
 */
const statItems = computed<StatItem[]>(() => [
  {
    key: "ready",
    label: t("alert_library.statReady"),
    value: readinessKnown.value ? readyCount.value : "—",
    icon: "check-circle",
    tone: "success",
    max: scopedEntries.value.length,
    dataTest: "alert-library-stat-ready",
  },
  {
    key: "missing",
    label: t("alert_library.statNeedsData"),
    value: readinessKnown.value ? missingCount.value : "—",
    icon: "sensors-off",
    // Same tone as the chip on every card this tile selects — StatTone exists
    // so one semantic state reads as one colour across the screen.
    tone: "warning",
    max: scopedEntries.value.length,
    dataTest: "alert-library-stat-missing",
  },
  // Last, and never highlighted: it is the way OUT of a filter, not a filter.
  {
    key: "all",
    label: t("alert_library.statAll"),
    value: scopedEntries.value.length,
    icon: "widgets",
    tone: "neutral",
    dataTest: "alert-library-stat-all",
  },
]);

// ── visible set ────────────────────────────────────────────────────────────
/** Every filter has already been applied by `availableEntries`; this orders it. */
const visibleEntries = computed(() =>
  [...availableEntries.value].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      text(a.title).localeCompare(text(b.title)),
  ),
);

/**
 * Grouped by pack AND category, never category alone: category names are
 * pack-scoped in the manifest, so two packs can both ship a "connections"
 * category and merging them under one heading would assert a relationship that
 * does not exist. The pack is named in the heading only when more than one is
 * on screen — with a single pack it would repeat on every group.
 */
const groupedEntries = computed(() => {
  const groups = new Map<string, AlertLibraryEntry[]>();
  for (const entry of visibleEntries.value) {
    const key = `${entry.pack}/${entry.category}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }
  const packsOnScreen = new Set(visibleEntries.value.map((entry) => entry.pack));
  return [...groups.keys()]
    .sort((a, b) => text(a).localeCompare(text(b)))
    .map((key) => {
      const entriesInGroup = groups.get(key) ?? [];
      const { pack, category } = entriesInGroup[0];
      return {
        id: key,
        label: categoryLabel(category),
        packLabel: packsOnScreen.size > 1 ? packLabel(pack) : null,
        entries: entriesInGroup,
      };
    });
});

const hasActiveFilters = computed(
  () =>
    selectedCategories.value.length > 0 ||
    severity.value !== "all" ||
    facet.value !== null ||
    search.value.trim() !== "",
);

const onStatSelect = (key: string) => {
  if (key === "all") {
    facet.value = null;
    return;
  }
  const next = key as "ready" | "missing";
  facet.value = facet.value === next ? null : next;
};

const clearFilters = () => {
  selectedCategories.value = [];
  railSearch.value = "";
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
    // Keep whatever verdict we already had. Clearing it here meant a failed
    // REFRESH threw away a correct answer: streamsByType still held the good
    // data, but every card lost its "Not ingested" chip and the strip flipped
    // to "Ready 42 / Not ingested 0". A transient timeout must not rewrite what
    // the page already knew — on a first load there is nothing to keep, so
    // readiness simply stays unknown.
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
