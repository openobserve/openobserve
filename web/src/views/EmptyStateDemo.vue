<!-- Copyright 2026 OpenObserve Inc.

  TEMPORARY review page for the empty-state system. Reachable at
  /empty-state-demo. Each card renders a real OEmptyState preset exactly as it
  would appear in the app. Remove this file + its route once approved.
-->
<template>
  <div :class="['es-demo-page', { dark: localDark }]">
    <div class="tw:p-8 tw:flex tw:flex-col tw:gap-8 tw:bg-surface-base tw:min-h-screen">
      <div class="tw:flex tw:items-start tw:justify-between tw:gap-4 tw:flex-wrap">
        <div>
          <h1 class="tw:text-2xl tw:font-semibold tw:text-text-primary">
            Empty states — full set for review
          </h1>
          <p class="tw:text-sm tw:text-text-secondary tw:mt-1 tw:max-w-2xl">
            Every preset below is a real
            <code class="tw:text-text-primary">&lt;OEmptyState&gt;</code> with its
            production copy, illustration, and action. Each detailed scene has its
            own character micro-animation and pauses under OS "reduce motion".
            Nothing is wired into real pages yet.
          </p>
        </div>
        <div class="tw:flex tw:items-center tw:gap-2">
          <OButton
            variant="outline"
            size="sm"
            icon-left="filter-list"
            @click="filteredPreview = !filteredPreview"
          >
            {{ filteredPreview ? "First-run state" : "Filtered state" }}
          </OButton>
          <OButton variant="outline" size="sm" icon-left="dark-mode" @click="localDark = !localDark">
            {{ localDark ? "Light preview" : "Dark preview" }}
          </OButton>
        </div>
      </div>

      <div class="tw:grid tw:grid-cols-1 tw:xl:grid-cols-2 tw:gap-6">
        <section v-for="p in presets" :key="p.preset" class="tw:flex tw:flex-col tw:gap-2">
          <div class="tw:flex tw:items-baseline tw:gap-2">
            <span class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wider tw:text-text-secondary">
              {{ p.label }}
            </span>
            <code class="tw:text-[0.7rem] tw:text-text-disabled">preset="{{ p.preset }}"</code>
          </div>
          <div class="tw:rounded-xl tw:border tw:border-border-default tw:h-110 tw:overflow-hidden">
            <OEmptyState
              :preset="p.preset"
              size="hero"
              :filtered="filteredPreview"
              @action="onAction(p.preset)"
              @secondary-action="onAction(p.preset + ':secondary')"
            />
          </div>
        </section>
      </div>

      <div>
        <h2 class="tw:text-lg tw:font-semibold tw:text-text-primary tw:mb-1">
          Character — optional, only where it adds value
        </h2>
        <p class="tw:text-sm tw:text-text-secondary tw:mb-3 tw:max-w-2xl">
          The illustration is just a named choice, so a scene can opt into a
          character (e.g. a prominent first-run hero) while everything else stays
          object-only. Same component, <code class="tw:text-text-primary">illustration="explorer"</code>.
        </p>
        <div class="tw:rounded-xl tw:border tw:border-border-default tw:h-110 tw:overflow-hidden">
          <OEmptyState
            size="hero"
            variant="create"
            illustration="explorer"
            title="We couldn't find any data"
            description="Nothing matches yet — try a different stream, widen the time range, or create something new."
            action-label="Clear filters"
            action-icon="filter-list"
            @action="onAction('explorer')"
          />
        </div>
      </div>

      <div>
        <h2 class="tw:text-lg tw:font-semibold tw:text-text-primary tw:mb-3">
          Sizes — the same system at block &amp; inline scale
        </h2>
        <div class="tw:grid tw:grid-cols-1 tw:xl:grid-cols-2 tw:gap-6">
          <section class="tw:flex tw:flex-col tw:gap-2">
            <span class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wider tw:text-text-secondary">
              size="block" (inside a card / dashboard panel)
            </span>
            <div class="tw:rounded-xl tw:border tw:border-border-default tw:overflow-hidden">
              <OEmptyState preset="no-search-results" size="block" @action="onAction('block')" />
            </div>
          </section>
          <section class="tw:flex tw:flex-col tw:gap-2">
            <span class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wider tw:text-text-secondary">
              size="inline" (table body / dropdown)
            </span>
            <div class="tw:rounded-xl tw:border tw:border-border-default tw:overflow-hidden">
              <OEmptyState preset="no-search-results" size="inline" @action="onAction('inline')" />
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

import { OEmptyState, type EmptyStatePresetName } from "@/lib/core/EmptyState";
import OButton from "@/lib/core/Button/OButton.vue";

// local dark-mode preview wrapper so reviewers can flip themes without changing
// their global setting (mirrors the app's `.dark` class on a scoped root).
const localDark = ref(false);
// toggles the filtered/search "no results" state for every preset below
const filteredPreview = ref(false);

const presets: { preset: EmptyStatePresetName; label: string }[] = [
  { preset: "no-search-results", label: "No search results" },
  { preset: "no-logs", label: "No logs in range" },
  { preset: "no-dashboards", label: "No dashboards (first run)" },
  { preset: "no-pipelines", label: "No pipelines (first run)" },
  { preset: "no-functions", label: "No functions (first run)" },
  { preset: "no-streams", label: "No data ingested" },
  { preset: "no-alerts", label: "No alerts (create / define)" },
  { preset: "no-incidents", label: "No incidents (all caught up)" },
  { preset: "load-error", label: "Failed to load" },
  { preset: "no-data", label: "Generic — no data (NoData fallback)" },
  { preset: "no-traces", label: "No traces" },
  { preset: "no-search-history", label: "No search history" },
  { preset: "no-users", label: "No users" },
  { preset: "no-reports", label: "No reports" },
  { preset: "no-queries", label: "No running queries" },
  { preset: "no-service-accounts", label: "No service accounts" },
  { preset: "no-invitations", label: "No invitations" },
];

const onAction = (which: string) => {
   
  console.log("OEmptyState action:", which);
};
</script>

<style scoped>
/* Scope a `.dark` so the dark-preview toggle works locally regardless of the
   app's global theme. The token overrides live under :global(.dark). */
.es-demo-page.dark {
  color-scheme: dark;
}
</style>
