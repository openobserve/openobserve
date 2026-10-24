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

  ONE selection state, several surfaces: the card checkbox, the group heading
  and the toolbar control all write `selectedIds`. Add freezes it into
  `pendingBatch`; the drawer's own Add ignores it, so reading one alert never
  drags in whatever else is ticked behind it.
-->
<template>
  <div data-test="alert-library-page" class="flex h-full flex-col">
    <OPageLayout
      bleed
      :title="t('alerts.header')"
      icon="shield-alert-outline"
      title-data-test="alert-library-title"
      :subtitle="t('alerts.subtitle')"
      tabs-below
    >
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
      </template>
      <template #actions-overflow>
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
        <div class="w-rail border-border-default h-full shrink-0 border-e max-md:hidden">
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
        <ODrawer
          v-if="isMobile"
          v-model:open="mobileFiltersOpen"
          side="left"
          :width="80"
          bleed
          :title="t('common.filters')"
          anchor='[data-test="alert-library-toolbar"]'
          data-test="alert-library-mobile-filters-drawer"
        >
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
        </ODrawer>

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
            <!-- Selection shares the search row, which has the slack for it. Its own
                 row would push the grid down; the stat strip would re-flow its tiles.
                 Here the only thing that resizes is an empty text field. -->
            <div
              class="border-border-default px-page-edge flex shrink-0 flex-wrap items-center gap-3 border-b py-2"
              data-test="alert-library-toolbar"
            >
              <OButton
                variant="outline"
                size="icon-toolbar"
                icon-left="filter-list"
                class="md:hidden"
                data-test="alert-library-mobile-filters-btn"
                @click="mobileFiltersOpen = true"
              >
                <OTooltip :content="t('common.filters')" />
              </OButton>
              <OSearchInput
                v-model="search"
                size="sm"
                class="min-w-0 flex-1"
                :debounce="200"
                :placeholder="t('alert_library.searchPlaceholder')"
                data-test="alert-library-search"
              />

              <!-- Absent when the catalogue offers one kind only: a filter with one answer is noise. -->
              <OToggleGroup
                v-if="alertTypeOptions.length > 0"
                type="single"
                :model-value="alertType"
                :aria-label="t('alert_library.alertType')"
                class="shrink-0"
                data-test="alert-library-alert-type"
                @update:model-value="onAlertTypeChange"
              >
                <OToggleGroupItem
                  v-for="item in alertTypeOptions"
                  :key="item.id"
                  :value="item.id"
                  size="sm"
                  :data-test="`alert-library-alert-type-${item.id}`"
                >
                  {{ item.label }}
                </OToggleGroupItem>
              </OToggleGroup>

              <!-- The tri-state is LAST and always present, so it never moves: the
                   selection controls grow leftward into the search field's width. -->
              <div
                class="flex shrink-0 items-center gap-3"
                data-test="alert-library-toolbar-actions"
              >
                <div
                  v-if="selectedCount > 0"
                  class="border-border-default flex shrink-0 items-center gap-2 border-e pe-3"
                  data-test="alert-library-selection-bar"
                  :data-selected="selectedCount"
                  :data-offscreen="offscreenCount"
                >
                  <!-- Only the counts are live: wrapping the buttons too would re-read every label. -->
                  <span role="status" class="text-text-heading text-sm font-medium">
                    {{ t("alert_library.selectionCount", { count: selectedCount }, selectedCount) }}
                  </span>
                  <span v-if="offscreenCount > 0" role="status" class="text-text-secondary text-xs">
                    &middot;
                    {{
                      t(
                        "alert_library.selectionOffscreen",
                        { count: offscreenCount },
                        offscreenCount,
                      )
                    }}
                  </span>
                  <OButton
                    variant="outline"
                    size="sm"
                    data-test="alert-library-clear-selection"
                    @click="clearSelection"
                  >
                    {{ t("alert_library.clearSelection") }}
                  </OButton>
                  <OButton
                    variant="primary"
                    size="sm"
                    data-test="alert-library-add-selected"
                    @click="addSelected"
                  >
                    {{ t("alert_library.addSelected", { count: selectedCount }, selectedCount) }}
                  </OButton>
                </div>

                <!-- Hidden over an empty view: that set is neither none nor all. -->
                <OCheckbox
                  v-if="!isBusy && visibleEntries.length > 0"
                  ref="selectAllBox"
                  size="sm"
                  :model-value="viewSelectionState"
                  :disabled="selectableVisible.length === 0"
                  :title="
                    selectableVisible.length === 0 ? t('alert_library.enterpriseHint') : undefined
                  "
                  :label="t('alert_library.selectAllInView')"
                  :aria-label="t('alert_library.selectAllInView')"
                  class="shrink-0"
                  data-test="alert-library-select-all-in-view"
                  @update:model-value="toggleViewSelection"
                />
              </div>
            </div>

            <div class="px-page-edge shrink-0 py-2">
              <OStatStrip
                :items="statItems"
                selectable
                :selected-key="facet"
                default-key="all"
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
                  <!-- A sibling of the heading: inside it, it would rename the heading. -->
                  <div class="flex items-center gap-2 pb-2">
                    <h2
                      :id="`alert-library-group-heading-${group.id}`"
                      class="text-text-secondary flex items-center gap-2 text-xs font-semibold"
                      :data-test="`alert-library-group-${group.id}`"
                    >
                      <span v-if="group.packLabel" class="opacity-70"
                        >{{ group.packLabel }} &middot;</span
                      >
                      <span>{{ group.label }}</span>
                      <span class="tabular-nums opacity-70">{{ group.entries.length }}</span>
                    </h2>
                    <!-- Suppressed at one group, where it duplicates the toolbar control. -->
                    <OButton
                      v-if="groupedEntries.length > 1 && group.selectable.length > 0"
                      :id="`alert-library-select-group-id-${group.id}`"
                      variant="ghost"
                      size="xs"
                      class="ms-auto"
                      :aria-labelledby="`alert-library-select-group-id-${group.id} alert-library-group-heading-${group.id}`"
                      :data-test="`alert-library-select-group-${group.id}`"
                      @click="toggleGroup(group.selectable)"
                    >
                      {{ groupToggleLabel(group.selectable) }}
                    </OButton>
                  </div>
                  <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <LibraryCard
                      v-for="entry in group.entries"
                      :key="entry.id"
                      :entry="entry"
                      :ready="entryReady(entry)"
                      :selected="selectedIds.has(entry.id)"
                      :locked="isLocked(entry)"
                      :highlight="searchTerms"
                      @open="openEntry(entry)"
                      @update:selected="onCardSelected(entry, $event)"
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

    <ConfirmDialog
      v-model="selectAllConfirmOpen"
      :title="t('alert_library.selectAllConfirmTitle', { count: selectableVisible.length })"
      :message="t('alert_library.selectAllConfirmMessage', { count: selectableVisible.length })"
      :ok-label="t('alert_library.selectAllConfirmOk', { count: selectableVisible.length })"
      data-test="alert-library-select-all-confirm"
      @update:ok="applyViewSelection(true)"
    />

    <!-- `installed` fires mid-run, so its handler must not touch `pendingBatch`. -->
    <LibraryInstallDialog
      :open="installOpen"
      :entries="visibleEntries"
      :seed="installSeed"
      :preselect="pendingBatch"
      @update:open="onInstallOpenChange"
      @installed="onInstalled"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { AcceptableValue } from "reka-ui";
import { useStore } from "vuex";
import { useRoute, useRouter, type LocationQuery } from "vue-router";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import AlertSectionTabs from "@/components/alerts/AlertSectionTabs.vue";
import LibraryCard from "@/components/alertLibrary/LibraryCard.vue";
import LibraryDrawer from "@/components/alertLibrary/LibraryDrawer.vue";
import LibraryEmptyState from "@/components/alertLibrary/LibraryEmptyState.vue";
import LibraryInstallDialog from "@/components/alertLibrary/LibraryInstallDialog.vue";
import LibraryRail from "@/components/alertLibrary/LibraryRail.vue";
import {
  ALERT_TYPE_ORDER,
  alertTypeLabel,
  alertTypeOf,
  categoryLabel,
  packLabel,
  severityLabel,
  severityRank,
  SEVERITY_ORDER,
  type LibraryCategoryFacet,
  type LibraryFacet,
} from "@/components/alertLibrary/libraryFacets";
import {
  useAlertLibrary,
  useAnomalyLibraryAccess,
  toStreamsByType,
  streamDataState,
} from "@/composables/alerts/useAlertLibrary";
import type { AlertLibraryErrorCode } from "@/composables/alerts/useAlertLibrary";
import useStreams from "@/composables/useStreams";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { AlertLibraryEntry, AlertLibraryFile, StreamsByType } from "@/types/alertLibrary";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { matchesSearchWords, searchWords } from "@/utils/alerts/librarySearch";

/** Where the alerts are authored. Not the serving URL — that is a constant. */
const CONTRIBUTE_URL = "https://github.com/openobserve/o2-alerts-library";

/** Strip facets; "ready" is "For your data", the default view. */
const FACETS = ["ready", "missing", "all"] as const;
const DEFAULT_FACET: Facet = "ready";
/** Above this many alerts, "Select all in view" asks first. */
const SELECT_ALL_CONFIRM_ABOVE = 50;

type Facet = (typeof FACETS)[number];

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

const { manifest, isLoading, error, loadManifest, isReady } = useAlertLibrary();
const anomalyAccess = useAnomalyLibraryAccess();
const { open: openUpgradeDialog } = useEnterpriseUpgradeDialog();
const { getStreams } = useStreams(t);

/** `<pack>/<category>` keys; empty = every category. The rail narrows, it does not gate. */
const selectedCategories = ref<string[]>(queryList(route.query.categories));
/** The rail's own list filter, held here so clearFilters can reset it too. */
const railSearch = ref("");
const { isMobile } = useBreakpoint();
const mobileFiltersOpen = ref(false);
const severity = ref(querySeverity(route.query.severity));
const alertType = ref("all");
const facet = ref<Facet>(queryFacet(route.query.facet));
const search = ref(queryText(route.query.q));
const selectAllConfirmOpen = ref(false);

/** Kept after close so the drawer can animate out with its content intact. */
const selectedEntry = ref<AlertLibraryEntry | null>(null);
const drawerOpen = ref(false);

const installOpen = ref(false);
const installSeed = ref<{ entry: AlertLibraryEntry; file: AlertLibraryFile } | null>(null);
// Frozen at Add: `installed` fires mid-run, so a live binding would rewrite the wizard's own list.
const pendingBatch = ref<AlertLibraryEntry[]>([]);

/** A Set, not an array: every card asks this on every render. */
const selectedIds = ref<Set<string>>(new Set());

const streamsByType = ref<StreamsByType>({});
const streamsPending = ref(true);
/**
 * False until the org's stream list has actually been read. A failed stream
 * request must not be reported as "none of your data matches" — that is the
 * request failing, not the org missing telemetry.
 */
const readinessKnown = ref(false);

const entries = computed<AlertLibraryEntry[]>(() => {
  const scheduled = manifest.value?.alerts ?? [];
  if (anomalyAccess.value === "hidden") return scheduled;
  // Stamped, since the list an entry came from is what makes it an anomaly alert.
  const anomaly = (manifest.value?.anomaly_alerts ?? []).map((entry) => ({
    ...entry,
    alert_type: "anomaly_detection" as const,
  }));
  return [...scheduled, ...anomaly];
});
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

// "For your data": the streams exist AND received data in the last 24 h.
const entryFits = (entry: AlertLibraryEntry): boolean =>
  readinessKnown.value
    ? isReady(entry, streamsByType.value) &&
      streamDataState(entry, streamsByType.value).state === "fresh"
    : true;

const isLocked = (entry: AlertLibraryEntry): boolean =>
  anomalyAccess.value !== "enabled" && alertTypeOf(entry) === "anomaly";

// ── scope ──────────────────────────────────────────────────────────────────
/**
 * Everything the rail and the search have narrowed to, BEFORE the stat strip's
 * availability filter. That order matters both ways round: the strip counts
 * this set, so its numbers describe the grid underneath it, and the strip's own
 * filter is excluded so that clicking "Needs data" cannot change the totals
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

// Rail rows are pack-scoped: two packs can ship a category of the same name.
const categoryKey = (entry: AlertLibraryEntry): string =>
  `${text(entry.pack)}/${text(entry.category)}`;

const searchTerms = computed(() => searchWords(search.value));

const matchesSearch = (entry: AlertLibraryEntry): boolean =>
  matchesSearchWords(entry, searchTerms.value);

const matchesCategory = (entry: AlertLibraryEntry): boolean =>
  selectedCategories.value.length === 0 || selectedCategories.value.includes(categoryKey(entry));

const matchesSeverity = (entry: AlertLibraryEntry): boolean =>
  severity.value === "all" || entry.severity === severity.value;

const matchesAlertType = (entry: AlertLibraryEntry): boolean =>
  alertType.value === "all" || alertTypeOf(entry) === alertType.value;

const matchesFacet = (entry: AlertLibraryEntry): boolean => {
  if (facet.value === "ready") return entryFits(entry);
  if (facet.value === "missing") return !entryFits(entry);
  return true;
};

const searchScoped = computed(() =>
  entries.value.filter(
    (entry) => matchesCategory(entry) && matchesSearch(entry) && matchesAlertType(entry),
  ),
);

const scopedEntries = computed(() => searchScoped.value.filter(matchesSeverity));

// The drawer's freshness line for the open alert; the strip asks the same question through entryFits.
const selectedDataState = computed(() =>
  selectedEntry.value && readinessKnown.value
    ? streamDataState(selectedEntry.value, streamsByType.value)
    : { state: "fresh" as const, lastIngestedMicros: null },
);

const readyCount = computed(() => scopedEntries.value.filter(entryFits).length);
const missingCount = computed(() => scopedEntries.value.length - readyCount.value);

/** Non-null only when one category is in view — see showCollectorBanner. */
const soleCategoryLabel = computed(() => {
  // Pack-scoped keys: two packs sharing a category name are two things to send.
  const keys = new Set(scopedEntries.value.map(categoryKey));
  return keys.size === 1 ? categoryLabel(scopedEntries.value[0].category) : null;
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
    // Not over an empty grid. With the "For your data" tile active and
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
const categoryFacets = computed<LibraryCategoryFacet[]>(() => {
  const rows = new Map<string, LibraryCategoryFacet>();
  const row = (key: string): LibraryCategoryFacet => {
    const existing = rows.get(key);
    if (existing) return existing;
    const slash = key.indexOf("/");
    const pack = slash === -1 ? "" : key.slice(0, slash);
    const created: LibraryCategoryFacet = {
      id: key,
      label: categoryLabel(key.slice(slash + 1)),
      count: 0,
      pack,
      packLabel: packLabel(pack),
      ready: 0,
      total: 0,
    };
    rows.set(key, created);
    return created;
  };
  for (const id of selectedCategories.value) row(id);
  for (const entry of entries.value) {
    if (!matchesSearch(entry) || !matchesSeverity(entry) || !matchesAlertType(entry)) continue;
    const target = row(categoryKey(entry));
    target.total += 1;
    if (entryFits(entry)) target.ready += 1;
    if (matchesFacet(entry)) target.count += 1;
  }
  return [...rows.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));
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

// Empty when only one kind is on offer.
const alertTypeOptions = computed<Array<{ id: string; label: I18nText }>>(() => {
  if (!entries.value.some((entry) => alertTypeOf(entry) === "anomaly")) return [];
  return [
    { id: "all", label: t("alert_library.alertTypeAll") },
    ...ALERT_TYPE_ORDER.map((id) => ({ id: id as string, label: alertTypeLabel(t, id) })),
  ];
});

// The toggle hides with the options, which would leave a type filter nobody can see or lift.
watch(alertTypeOptions, (options) => {
  if (alertType.value !== "all" && !options.some((item) => item.id === alertType.value)) {
    alertType.value = "all";
  }
});

/**
 * Readiness is a claim about the org's data, and when the stream check failed
 * we have no claim to make. The cards deliberately stay undimmed — refusing to
 * say "none of your data matches" — but the strip was making the OPPOSITE
 * assertion just as loudly: `entryReady` answers true while readiness is
 * unknown, so a failed /streams call read as "Ready to use 42 / Not
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
// One order for the grid and for the batch handed to the wizard, so step 2 reads as the grid did.
const byGridOrder = (a: AlertLibraryEntry, b: AlertLibraryEntry) =>
  severityRank(a.severity) - severityRank(b.severity) || text(a.title).localeCompare(text(b.title));

/** Every filter has already been applied by `availableEntries`; this orders it. */
const visibleEntries = computed(() => [...availableEntries.value].sort(byGridOrder));

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
  return [...groups.entries()]
    .map(([key, entriesInGroup]) => {
      const { pack, category } = entriesInGroup[0];
      return {
        id: key,
        label: categoryLabel(category),
        packLabel: packsOnScreen.size > 1 ? packLabel(pack) : null,
        entries: entriesInGroup,
        selectable: entriesInGroup.filter((entry) => !isLocked(entry)),
        fit: entriesInGroup.filter(entryFits).length,
        topSeverity: Math.min(...entriesInGroup.map((entry) => severityRank(entry.severity))),
      };
    })
    .sort(
      (a, b) =>
        b.fit - a.fit || a.topSeverity - b.topSeverity || text(a.id).localeCompare(text(b.id)),
    );
});

// ── selection ──────────────────────────────────────────────────────────────
const selectedCount = computed(() => selectedIds.value.size);

/** What the batch holds that the current filters do not show. */
const offscreenCount = computed(() => {
  const onScreen = new Set(visibleEntries.value.map((entry) => entry.id));
  return [...selectedIds.value].filter((id) => !onScreen.has(id)).length;
});

// Locked cards can never be ticked, so counting them would leave "all" forever indeterminate.
const selectableVisible = computed(() => visibleEntries.value.filter((entry) => !isLocked(entry)));

const viewSelectionState = computed<boolean | "indeterminate">(() => {
  const ticked = selectableVisible.value.filter((entry) => selectedIds.value.has(entry.id)).length;
  if (ticked === 0) return false;
  return ticked === selectableVisible.value.length ? true : "indeterminate";
});

const groupFullySelected = (groupEntries: AlertLibraryEntry[]) =>
  groupEntries.every((entry) => selectedIds.value.has(entry.id));

const groupToggleLabel = (groupEntries: AlertLibraryEntry[]) =>
  groupFullySelected(groupEntries)
    ? t("alert_library.clearGroupSelection", { count: groupEntries.length }, groupEntries.length)
    : t("alert_library.selectAllInGroup", { count: groupEntries.length }, groupEntries.length);

const setSelected = (id: string, selected: boolean) => {
  const next = new Set(selectedIds.value);
  if (selected) next.add(id);
  else next.delete(id);
  selectedIds.value = next;
};

const onCardSelected = (entry: AlertLibraryEntry, selected: boolean) => {
  if (isLocked(entry)) {
    openUpgradeDialog();
    return;
  }
  setSelected(entry.id, selected);
};

const selectAllBox = ref<{ $el: HTMLElement } | null>(null);

// Clearing unmounts the button that was clicked, so focus would fall to <body>
// and a keyboard user would restart above the whole grid.
const clearSelection = async () => {
  selectedIds.value = new Set();
  await nextTick();
  selectAllBox.value?.$el?.querySelector<HTMLElement>('[role="checkbox"]')?.focus();
};

// Writes only the visible set: dropping a cross-filter batch is what the action row's Clear is for.
const applyViewSelection = (selectAll: boolean) => {
  const next = new Set(selectedIds.value);
  for (const entry of selectableVisible.value) {
    if (selectAll) next.add(entry.id);
    else next.delete(entry.id);
  }
  selectedIds.value = next;
};

const toggleViewSelection = () => {
  const selectAll = viewSelectionState.value !== true;
  if (selectAll && selectableVisible.value.length > SELECT_ALL_CONFIRM_ABOVE) {
    selectAllConfirmOpen.value = true;
    return;
  }
  applyViewSelection(selectAll);
};

/** Additive: a partly-selected group gains the rest rather than starting over. */
const toggleGroup = (groupEntries: AlertLibraryEntry[]) => {
  const next = new Set(selectedIds.value);
  const clearing = groupFullySelected(groupEntries);
  for (const entry of groupEntries) {
    if (clearing) next.delete(entry.id);
    else next.add(entry.id);
  }
  selectedIds.value = next;
};

// Resolved against the whole manifest: the off-screen part of the batch must survive the hand-off.
const addSelected = () => {
  pendingBatch.value = entries.value
    .filter((entry) => selectedIds.value.has(entry.id) && !isLocked(entry))
    .sort(byGridOrder);
  installSeed.value = null;
  installOpen.value = true;
};

const onInstalled = ({ entryIds }: { entryIds: string[] }) => {
  const added = new Set(entryIds);
  selectedIds.value = new Set([...selectedIds.value].filter((id) => !added.has(id)));
};

// A dropped alert would fail its row for a reason nobody can act on; pruning nothing is a no-op.
watch(entries, (available) => {
  // Locked too: a ticked card that became locked could not be unticked, since its box opens the upsell.
  const live = new Set(available.filter((entry) => !isLocked(entry)).map((entry) => entry.id));
  if (selectedIds.value.size > 0) {
    const kept = [...selectedIds.value].filter((id) => live.has(id));
    if (kept.length !== selectedIds.value.size) selectedIds.value = new Set(kept);
  }
  // The open wizard must not be left listing an alert the catalog just dropped.
  if (pendingBatch.value.some((entry) => !live.has(entry.id))) {
    pendingBatch.value = pendingBatch.value.filter((entry) => live.has(entry.id));
  }
});

const hasActiveFilters = computed(
  () =>
    selectedCategories.value.length > 0 ||
    severity.value !== "all" ||
    alertType.value !== "all" ||
    facet.value !== "all" ||
    search.value.trim() !== "",
);

// Re-clicking the active chip yields ""; like severity, the type is widened with All, never cleared.
const onAlertTypeChange = (value: AcceptableValue | AcceptableValue[] | boolean) => {
  if (typeof value === "string" && value !== "") alertType.value = value;
};

const onStatSelect = (key: string) => {
  const next = isFacet(key) ? key : "all";
  facet.value = next === "all" || facet.value === next ? "all" : next;
};

// Lands on All, not the default facet: on an org with no data yet, "For your data" is the empty view.
const clearFilters = () => {
  selectedCategories.value = [];
  railSearch.value = "";
  severity.value = "all";
  alertType.value = "all";
  facet.value = "all";
  search.value = "";
};

/** The filters as URL query values; defaults are left out so a plain link stays plain. */
const filterQuery = computed<Record<string, string | undefined>>(() => ({
  facet: facet.value === DEFAULT_FACET ? undefined : facet.value,
  q: search.value.trim() || undefined,
  severity: severity.value === "all" ? undefined : severity.value,
  categories: selectedCategories.value.length > 0 ? selectedCategories.value.join(",") : undefined,
}));

watch(filterQuery, (next) => {
  const query: LocationQuery = { ...route.query };
  let changed = false;
  for (const [key, value] of Object.entries(next)) {
    if ((queryText(query[key]) || undefined) === value) continue;
    changed = true;
    if (value === undefined) delete query[key];
    else query[key] = value;
  }
  if (changed) void router.replace({ query });
});

const openEntry = (entry: AlertLibraryEntry) => {
  if (isLocked(entry)) {
    openUpgradeDialog();
    return;
  }
  selectedEntry.value = entry;
  drawerOpen.value = true;
};

/**
 * The drawer hands over the file it already tuned; the wizard answers the rest.
 * Closing the drawer keeps one overlay on screen at a time — the wizard offers
 * the whole visible set, so the single-alert view behind it is finished.
 */
const onInstall = (payload: { entry: AlertLibraryEntry; file: AlertLibraryFile }) => {
  pendingBatch.value = [];
  installSeed.value = payload;
  drawerOpen.value = false;
  installOpen.value = true;
};

const onInstallOpenChange = (open: boolean) => {
  installOpen.value = open;
  // Batch and file are per-open; the selection survives, because rebuilding it is manual work.
  if (!open) {
    installSeed.value = null;
    pendingBatch.value = [];
  }
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

function isFacet(value: string): value is Facet {
  return (FACETS as readonly string[]).includes(value);
}

function queryText(value: LocationQuery[string] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : "";
}

function queryFacet(value: LocationQuery[string] | undefined): Facet {
  const candidate = queryText(value);
  return isFacet(candidate) ? candidate : DEFAULT_FACET;
}

function querySeverity(value: LocationQuery[string] | undefined): string {
  const candidate = queryText(value);
  return (SEVERITY_ORDER as readonly string[]).includes(candidate) ? candidate : "all";
}

function queryList(value: LocationQuery[string] | undefined): string[] {
  return queryText(value).split(",").filter(Boolean);
}
</script>
