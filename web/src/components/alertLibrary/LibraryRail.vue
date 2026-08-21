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
  LibraryRail — what am I looking at (severity × category).

  ONE list, no axis switcher. Packs used to be a second axis, but a pack is a
  coarse bucket ("databases", "observability") and the category is the thing
  people actually come looking for — Kafka, Clickhouse, Cilium. Two axes over
  the same catalogue meant a tab to reach the useful one; the pack still names
  itself in the gallery's group headings, which is where it earns its keep.

  Categories are MULTI-SELECT on the metrics-explorer rail pattern: a search
  box over the list, tick boxes with counts, and a "N selected / Clear" footer.
  An empty selection means all of them, so the rail opens showing everything
  and narrows from there.

  Severity sits ON TOP, outside the scrolling list, because it is a different
  kind of question — "how bad", not "what of" — and there are only ever three
  answers. Below the list it collided with the category rows and scrolled out
  of reach after a hundred of them.

  Purely presentational — every choice is emitted, nothing is decided here.
-->
<template>
  <nav
    class="flex h-full flex-col"
    :aria-label="t('alert_library.header')"
    data-test="alert-library-rail"
  >
    <!-- Pinned controls. The list below owns the scroll: with 100+ categories a
         rail that scrolls as one block carries its own controls off-screen. -->
    <div class="flex shrink-0 flex-col gap-3 px-2 pt-3 pb-2">
      <section class="flex flex-col gap-1">
        <h2 class="text-text-secondary text-2xs font-semibold uppercase">
          {{ t("alert_library.severity") }}
        </h2>
        <!-- Chips rather than three more tick rows: it is single-select — one
             question with one answer — and the explicit All chip is how you
             widen it again. No counts and no colour; four coloured chips would
             be colouring the norm, and the per-card severity tag is where the
             colour means something. -->
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
      </section>

      <section class="flex flex-col gap-1">
        <h2 class="text-text-secondary text-2xs font-semibold uppercase">
          {{ t("alert_library.categories") }}
        </h2>

        <OInput
          :model-value="search"
          @update:model-value="emit('update:search', String($event ?? ''))"
          size="sm"
          clearable
          :placeholder="t('alert_library.searchCategories')"
          :aria-label="t('alert_library.searchCategoriesAria')"
          data-test="alert-library-rail-search-categories"
        />

        <div class="flex items-center justify-between gap-2">
          <span
            class="text-text-secondary text-2xs tabular-nums"
            data-test="alert-library-rail-selected-categories"
            >{{ t("alert_library.selectedCount", { count: selectedCategories.length }) }}</span
          >
          <OButton
            variant="ghost-primary"
            size="xs"
            :disabled="selectedCategories.length === 0"
            data-test="alert-library-rail-clear-categories"
            @click="emit('update:selectedCategories', [])"
          >
            {{ t("alert_library.clearFilters") }}
          </OButton>
        </div>
      </section>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <OEmptyState
        v-if="visibleItems.length === 0"
        size="inline"
        illustration="no-results"
        variant="no-results"
        :title="t('alert_library.noCategoryMatch')"
        data-test="alert-library-rail-empty-categories"
      />

      <div
        v-for="item in visibleItems"
        :key="item.id"
        class="rounded-default hover:bg-surface-subtle flex items-center justify-between gap-2 px-2 py-1"
        :class="selectedCategories.includes(item.id) ? 'bg-surface-subtle' : ''"
      >
        <OCheckbox
          size="sm"
          class="min-w-0 flex-1"
          :model-value="selectedCategories.includes(item.id)"
          :aria-label="t('alert_library.facetAria', { label: item.label, count: item.count })"
          :data-active="String(selectedCategories.includes(item.id))"
          :data-test="`alert-library-rail-category-${item.id}`"
          @update:model-value="toggleCategory(item.id)"
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
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";
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
  categories: LibraryFacet[];
  /** Empty means every category — the rail opens unfiltered. */
  selectedCategories: string[];
  /** Includes the "all" pseudo-facet, built by the caller. */
  severities: LibraryFacet[];
  severity: string;
  /**
   * The rail-local list filter. Owned by the page, not by this component, so
   * its "Clear filters" can reset it — leaving it here meant clearing the
   * filters left the rail still narrowed by a term nobody had cleared.
   */
  search: string;
}>();

const emit = defineEmits<{
  "update:selectedCategories": [ids: string[]];
  "update:severity": [id: string];
  "update:search": [term: string];
}>();

const { t } = useI18nTyped();

/**
 * Search matches the LABEL, not the id: the box filters the list you can see,
 * so matching a string the row never shows would look broken.
 *
 * A zero-count row is a dead end and is dropped — except when it is selected,
 * since hiding it would strand the user with a filter they cannot lift.
 */
const visibleItems = computed(() => {
  const needle = props.search.trim().toLowerCase();
  return props.categories.filter((item) => {
    // A ticked row is never hidden — not by the search, not by a zero count.
    // Both used to remove it: typing "redis" while "kafka" was ticked took the
    // kafka row off screen while the grid stayed filtered to kafka, leaving a
    // filter you could see the effect of but not the control for.
    if (props.selectedCategories.includes(item.id)) return true;
    if (needle && !String(item.label).toLowerCase().includes(needle)) return false;
    // A zero-count row filters to nothing, so offering it wastes a click.
    if (item.count === 0) return false;
    return true;
  });
});

const toggleCategory = (id: string) => {
  const selected = props.selectedCategories;
  emit(
    "update:selectedCategories",
    selected.includes(id) ? selected.filter((it) => it !== id) : [...selected, id],
  );
};

const onSeverityChange = (value: AcceptableValue | AcceptableValue[] | boolean) => {
  // Re-clicking the active chip yields "" — the rail is navigation, and you
  // widen it with the explicit All chip, never by accidentally clearing one.
  if (typeof value === "string" && value !== "") emit("update:severity", value);
};
</script>
