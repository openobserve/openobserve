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
  LibraryRail — what am I looking at (packs × categories × severity).

  Packs and categories are MULTI-SELECT, on the metrics-explorer rail pattern:
  one segmented control switching which axis is listed, a search box over that
  list, tick boxes with counts, and a "N selected / Clear" footer per axis. An
  empty selection means "all of them", so the rail opens showing everything and
  narrows from there rather than forcing one pack at a time.

  Severity stays single-select. It is one question with one answer, and four
  chips cost less height than four more rows.

  Purely presentational — every choice is emitted, nothing is decided here.
-->
<template>
  <nav
    class="flex h-full flex-col gap-4 overflow-y-auto py-3"
    :aria-label="t('alert_library.header')"
    data-test="alert-library-rail"
  >
    <section class="flex min-h-0 flex-col gap-1">
      <!-- Stacking both axes cost roughly a screen of height on a 14-category
           pack and pushed severity below the fold; only one axis is being
           narrowed at a time anyway.

           The per-tab count is the SELECTION, not the number of choices: the
           question a hidden axis raises is "have I left a filter on over
           there?". It sits in a fixed-width slot so 2 → 14 never nudges the
           label. -->
      <div class="px-2">
        <OToggleGroup
          type="single"
          :model-value="axis"
          data-test="alert-library-rail-axis"
          @update:model-value="onAxisChange"
        >
          <OToggleGroupItem
            v-for="tab in axisTabs"
            :key="tab.id"
            :value="tab.id"
            size="xs"
            :data-test="`alert-library-rail-axis-${tab.id}`"
          >
            <span class="flex items-center gap-1">
              <span>{{ tab.label }}</span>
              <span
                class="text-2xs text-primary w-4 shrink-0 text-right font-semibold tabular-nums"
                :data-test="`alert-library-rail-axis-count-${tab.id}`"
                >{{ tab.selected || "" }}</span
              >
            </span>
          </OToggleGroupItem>
        </OToggleGroup>
      </div>

      <div class="px-2">
        <OInput
          v-model="searchTerm"
          size="sm"
          clearable
          :placeholder="active.searchPlaceholder"
          :aria-label="active.searchAria"
          :data-test="`alert-library-rail-search-${axis}`"
        />
      </div>

      <div class="flex items-center justify-between gap-2 px-2">
        <span
          class="text-text-secondary text-2xs tabular-nums"
          :data-test="`alert-library-rail-selected-${axis}`"
          >{{ t("alert_library.selectedCount", { count: active.selected.length }) }}</span
        >
        <OButton
          variant="ghost-primary"
          size="xs"
          :disabled="active.selected.length === 0"
          :data-test="`alert-library-rail-clear-${axis}`"
          @click="clearAxis"
        >
          {{ t("alert_library.clearFilters") }}
        </OButton>
      </div>

      <OEmptyState
        v-if="visibleItems.length === 0"
        size="inline"
        illustration="no-results"
        variant="no-results"
        class="px-2"
        :title="active.emptyTitle"
        :data-test="`alert-library-rail-empty-${axis}`"
      />

      <div
        v-for="item in visibleItems"
        :key="item.id"
        class="rounded-default hover:bg-surface-subtle flex items-center justify-between gap-2 px-2 py-1"
        :class="active.selected.includes(item.id) ? 'bg-surface-subtle' : ''"
      >
        <OCheckbox
          size="sm"
          class="min-w-0 flex-1"
          :model-value="active.selected.includes(item.id)"
          :aria-label="t('alert_library.facetAria', { label: item.label, count: item.count })"
          :data-active="String(active.selected.includes(item.id))"
          :data-test="`alert-library-rail-${active.rowPrefix}-${item.id}`"
          @update:model-value="toggleItem(item.id)"
        >
          <template #label>
            <span class="truncate text-xs" :title="item.label">{{ item.label }}</span>
          </template>
        </OCheckbox>

        <OTag
          type="countChip"
          value="neutral"
          size="xs"
          shape="rounded"
          :data-test="`alert-library-rail-count-${item.id}`"
          >{{ item.count }}</OTag
        >
      </div>
    </section>

    <section class="flex flex-col gap-1">
      <h2 class="text-text-secondary text-2xs px-2 font-semibold uppercase">
        {{ t("alert_library.severity") }}
      </h2>
      <!-- A compact chip row rather than four more stacked rail items: those
           cost ~7.5rem of height and pushed the rail past the fold. The chips
           carry no counts and no colour — four coloured chips would be
           colouring the norm; the per-card severity tag is where it means
           something. -->
      <div class="px-2">
        <OToggleGroup
          type="single"
          :model-value="severity"
          data-test="alert-library-rail-severity"
          @update:model-value="onSeverityChange"
        >
          <OToggleGroupItem
            v-for="item in severities"
            :key="item.id"
            :value="item.id"
            size="xs"
            :data-test="`alert-library-rail-severity-${item.id}`"
          >
            {{ item.label }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>
    </section>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { AcceptableValue } from "reka-ui";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { useI18nTyped } from "@/types/i18n";

import type { LibraryFacet } from "./libraryFacets";

const props = defineProps<{
  packs: LibraryFacet[];
  /** Empty means every pack — the rail opens unfiltered. */
  selectedPacks: string[];
  categories: LibraryFacet[];
  /** Empty means every category in the packs currently in scope. */
  selectedCategories: string[];
  /** Includes the "all" pseudo-facet, built by the caller. */
  severities: LibraryFacet[];
  severity: string;
}>();

const emit = defineEmits<{
  "update:selectedPacks": [ids: string[]];
  "update:selectedCategories": [ids: string[]];
  "update:severity": [id: string];
}>();

const { t } = useI18nTyped();

/**
 * Which axis the shared list is showing. Local, not a prop: it is a view
 * preference over the same filter state, and the parent's selections for BOTH
 * axes survive switching tabs.
 */
const axis = ref<"packs" | "categories">("packs");

/**
 * One term per axis, so switching tabs to check something does not throw away
 * what you had typed. They answer different questions and never share a value.
 */
const terms = ref<Record<"packs" | "categories", string>>({ packs: "", categories: "" });
const searchTerm = computed({
  get: () => terms.value[axis.value],
  set: (value: string) => {
    terms.value[axis.value] = value;
  },
});

/** Everything that differs between the two axes, resolved once. */
const active = computed(() =>
  axis.value === "packs"
    ? {
        rowPrefix: "pack" as const,
        items: props.packs,
        selected: props.selectedPacks,
        searchPlaceholder: t("alert_library.searchPacks"),
        searchAria: t("alert_library.searchPacksAria"),
        emptyTitle: t("alert_library.noPackMatch"),
      }
    : {
        rowPrefix: "category" as const,
        items: props.categories,
        selected: props.selectedCategories,
        searchPlaceholder: t("alert_library.searchCategories"),
        searchAria: t("alert_library.searchCategoriesAria"),
        emptyTitle: t("alert_library.noCategoryMatch"),
      },
);

const axisTabs = computed(() => [
  {
    id: "packs" as const,
    label: t("alert_library.packs"),
    selected: props.selectedPacks.length,
  },
  {
    id: "categories" as const,
    label: t("alert_library.categories"),
    selected: props.selectedCategories.length,
  },
]);

/**
 * Search matches the LABEL, not the id: the box filters the list you can see,
 * so matching a string the row never shows would look broken ("kube" finds
 * Kubernetes; "k8s" does not).
 *
 * A zero-count row is a dead end and is dropped — except when it is selected,
 * since hiding it would strand the user with a filter they cannot lift.
 */
const visibleItems = computed(() => {
  const needle = searchTerm.value.trim().toLowerCase();
  return active.value.items.filter((item) => {
    if (needle && !String(item.label).toLowerCase().includes(needle)) return false;
    if (item.count === 0 && !active.value.selected.includes(item.id)) return false;
    return true;
  });
});

/**
 * Emit against whichever axis is on screen. A named branch rather than a
 * computed event name: the emit overloads are keyed on the literal name, so a
 * computed one widens to `string` and matches none of them.
 */
const emitSelection = (ids: string[]) => {
  if (axis.value === "packs") emit("update:selectedPacks", ids);
  else emit("update:selectedCategories", ids);
};

const toggleItem = (id: string) => {
  const selected = active.value.selected;
  emitSelection(selected.includes(id) ? selected.filter((it) => it !== id) : [...selected, id]);
};

const clearAxis = () => emitSelection([]);

const onAxisChange = (value: AcceptableValue | AcceptableValue[] | boolean) => {
  // Re-clicking the active tab yields "" — keep the current axis rather than
  // emptying the list, since there is no "neither axis" state to show.
  if (value === "packs" || value === "categories") axis.value = value;
};

const onSeverityChange = (value: AcceptableValue | AcceptableValue[] | boolean) => {
  if (typeof value === "string" && value !== "") emit("update:severity", value);
};
</script>
