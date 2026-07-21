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

<template>
  <div
    class="flex flex-col min-h-0"
    :data-test="`metrics-explorer-${mode}-panel`"
  >
    <!-- The rail's own search — narrows the facet LIST, not the grid. Its own
         inline ✕ clears the SEARCH TEXT only. Clearing the selected FILTERS is a
         separate, explicitly-labelled row below, so the two are never confused. -->
    <!-- px-2 matches the facet toggle's horizontal padding above, so the search
         box's edges line up with the Prefix/Suffix/Type control. -->
    <div class="px-2 pb-2">
      <OInput
        v-model="search"
        size="sm"
        clearable
        :placeholder="searchPlaceholder"
        :aria-label="searchAriaLabel"
        :data-test="`metrics-explorer-${mode}-search`"
      />
    </div>

    <!-- "Clear filters" — acts on the SELECTED facets (not the search box). Both
         the count and the button are ALWAYS present (no disappearing controls):
         the count reads "0 selected" and the button is disabled when nothing is
         selected, so the row never changes size and the control is always
         discoverable. Distinct from the search box's own inline ✕, which clears
         the search text. -->
    <div class="flex items-center justify-between gap-2 px-3 pb-2">
      <span class="text-xs text-text-secondary tabular-nums">
        {{ t("metrics.explorer.facets.selectedCount", { count: selected.size }) }}
      </span>
      <OButton
        variant="ghost-primary"
        size="xs"
        :disabled="!hasSelection"
        :data-test="`metrics-explorer-${mode}-clear`"
        @click="emit('clear')"
      >
        {{ t("metrics.explorer.facets.clearFilters") }}
      </OButton>
    </div>

    <!-- Scrollable, keyboard-navigable checkbox list. -->
    <div
      role="group"
      :aria-label="title"
      class="flex-1 min-h-0 overflow-y-auto px-1 pb-2"
      :data-test="`metrics-explorer-${mode}-facets`"
    >
      <div
        v-for="facet in visibleFacets"
        :key="facet.id"
        class="flex items-center justify-between gap-2 px-2 py-1 rounded-default hover:bg-surface-subtle"
        :class="{ 'bg-surface-subtle': selected.has(facet.id) }"
      >
        <OCheckbox
          size="sm"
          class="min-w-0 flex-1"
          :model-value="selected.has(facet.id)"
          :data-test="`metrics-explorer-${mode}-facet-${facet.id}`"
          :aria-label="
            t('metrics.explorer.facets.facetAria', {
              label: facet.label,
              count: facet.count,
            })
          "
          @update:model-value="toggle(facet.id)"
        >
          <template #label>
            <span class="truncate text-xs" :title="facet.label">{{
              facet.label
            }}</span>
          </template>
        </OCheckbox>

        <!-- The registry's countChip, as every other count in the app. -->
        <OTag
          type="countChip"
          value="neutral"
          size="xs"
          shape="rounded"
          :data-test="`metrics-explorer-${mode}-count-${facet.id}`"
          >{{ facet.count }}</OTag
        >
      </div>

      <OEmptyState
        v-if="!visibleFacets.length"
        size="inline"
        icon="search-off"
        :title="emptyLabel"
        :data-test="`metrics-explorer-${mode}-empty`"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

/** A rail facet. Counts are recomputed by the caller against the OTHER active
 *  filters, so this component only ever renders them. */
export interface Facet {
  id: string;
  label: string;
  count: number;
}

const props = defineProps<{
  mode: "prefix" | "suffix";
  facets: Facet[];
  selected: Set<string>;
  /** Whether this facet has any selection — drives the "Clear filters" row. */
  hasSelection?: boolean;
}>();

const emit = defineEmits<{
  /** Always a NEW Set — never a mutation of the prop. */
  (e: "update:selected", value: Set<string>): void;
  /** Clear THIS facet's selection (distinct from the search box's own clear). */
  (e: "clear"): void;
}>();

const { t } = useI18n();

const search = ref("");

const isPrefix = computed(() => props.mode === "prefix");

const title = computed(() =>
  t(
    isPrefix.value
      ? "metrics.explorer.filterByPrefix"
      : "metrics.explorer.filterBySuffix",
  ),
);

const searchPlaceholder = computed(() =>
  t(
    isPrefix.value
      ? "metrics.explorer.facets.searchPrefixes"
      : "metrics.explorer.facets.searchSuffixes",
  ),
);

const searchAriaLabel = computed(() =>
  t(
    isPrefix.value
      ? "metrics.explorer.facets.searchPrefixesAria"
      : "metrics.explorer.facets.searchSuffixesAria",
  ),
);

const emptyLabel = computed(() =>
  t(
    isPrefix.value
      ? "metrics.explorer.facets.noPrefixMatch"
      : "metrics.explorer.facets.noSuffixMatch",
  ),
);

const visibleFacets = computed(() => {
  const term = search.value.trim().toLowerCase();

  return props.facets.filter((facet) => {
    if (term && !facet.label.toLowerCase().includes(term)) return false;

    // A zero-count row is a filter option that leads nowhere: the other active
    // filters already exclude everything in the group, so ticking it could only
    // empty the grid. Always hidden — a switch to reveal guaranteed dead ends is
    // not a feature. (The grid's own "Hide no-data" is a different thing: it
    // hides CARDS whose query returned no samples.)
    //
    // A SELECTED facet stays visible even at count 0 — hiding it would strand
    // the selection with no way to switch it back off from the rail.
    if (facet.count === 0 && !props.selected.has(facet.id)) return false;

    return true;
  });
});

const toggle = (id: string) => {
  const next = new Set(props.selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  emit("update:selected", next);
};
</script>
