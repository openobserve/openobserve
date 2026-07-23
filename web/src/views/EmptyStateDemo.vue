<!-- Copyright 2026 OpenObserve Inc.

  TEMPORARY review page for the empty-state system. Reachable at
  /empty-state-demo. Each card renders a real OEmptyState preset exactly as it
  would appear in the app. Remove this file + its route once approved.
-->
<template>
  <div :class="['es-demo-page', { dark: localDark, '[color-scheme:dark]': localDark }]">
    <div class="bg-surface-base flex min-h-screen flex-col gap-8 p-8">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-text-heading text-2xl font-semibold">
            Empty states — full set for review
          </h1>
          <p class="text-text-secondary mt-1 max-w-2xl text-sm">
            Every preset below is a real
            <code class="text-text-body">&lt;OEmptyState&gt;</code> with its production copy,
            illustration, and action. Each detailed scene has its own character micro-animation and
            pauses under OS "reduce motion". Nothing is wired into real pages yet.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <OButton
            variant="outline"
            size="sm"
            icon-left="filter-list"
            @click="filteredPreview = !filteredPreview"
          >
            {{ filteredPreview ? "First-run state" : "Filtered state" }}
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            icon-left="dark-mode"
            @click="localDark = !localDark"
          >
            {{ localDark ? "Light preview" : "Dark preview" }}
          </OButton>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section v-for="p in presets" :key="p.preset" class="flex flex-col gap-2">
          <div class="flex items-baseline gap-2">
            <span class="text-text-secondary text-xs font-semibold tracking-wider uppercase">
              {{ p.label }}
            </span>
            <code class="text-2xs text-text-disabled">preset="{{ p.preset }}"</code>
          </div>
          <div class="rounded-default border-border-default h-110 overflow-hidden border">
            <OEmptyState
              :preset="p.preset"
              size="hero"
              :filtered="filteredPreview"
              @action="onAction()"
              @secondary-action="onAction()"
            />
          </div>
        </section>
      </div>

      <div>
        <h2 class="text-text-heading mb-1 text-lg font-semibold">
          Character — optional, only where it adds value
        </h2>
        <p class="text-text-secondary mb-3 max-w-2xl text-sm">
          The illustration is just a named choice, so a scene can opt into a character (e.g. a
          prominent first-run hero) while everything else stays object-only. Same component,
          <code class="text-text-body">illustration="explorer"</code>.
        </p>
        <div class="rounded-default border-border-default h-110 overflow-hidden border">
          <OEmptyState
            size="hero"
            variant="create"
            illustration="explorer"
            title="We couldn't find any data"
            description="Nothing matches yet — try a different stream, widen the time range, or create something new."
            action-label="Clear filters"
            action-icon="filter-list"
            @action="onAction()"
          />
        </div>
      </div>

      <div>
        <h2 class="text-text-heading mb-3 text-lg font-semibold">
          Sizes — the same system at block &amp; inline scale
        </h2>
        <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section class="flex flex-col gap-2">
            <span class="text-text-secondary text-xs font-semibold tracking-wider uppercase">
              size="block" (inside a card / dashboard panel)
            </span>
            <div class="rounded-default border-border-default overflow-hidden border">
              <OEmptyState preset="no-search-results" size="block" @action="onAction('block')" />
            </div>
          </section>
          <section class="flex flex-col gap-2">
            <span class="text-text-secondary text-xs font-semibold tracking-wider uppercase">
              size="inline" (table body / dropdown)
            </span>
            <div class="rounded-default border-border-default overflow-hidden border">
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

const onAction = (_source?: string) => {};
</script>
