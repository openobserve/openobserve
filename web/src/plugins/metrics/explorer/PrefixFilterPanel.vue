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
    class="flex flex-col min-h-0 border border-border-default rounded-md"
    :data-test="`metrics-explorer-${mode}-panel`"
  >
    <!-- Header -->
    <div class="flex items-center justify-between gap-2 px-3 py-2">
      <span class="text-xs font-semibold text-text-primary">{{ title }}</span>
      <OButton
        variant="ghost-primary"
        size="xs"
        :disabled="!hasSelection"
        :data-test="`metrics-explorer-${mode}-clear`"
        @click="$emit('clear')"
      >
        Clear
      </OButton>
    </div>

    <!-- The rail's own search — narrows the facet list, not the grid. -->
    <div class="px-3 pb-2">
      <OInput
        v-model="search"
        size="sm"
        clearable
        :placeholder="`Search ${mode}es`"
        :aria-label="`Search ${mode} filters`"
        :data-test="`metrics-explorer-${mode}-search`"
      />
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
        class="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-surface-subtle"
      >
        <OCheckbox
          size="sm"
          class="min-w-0 flex-1"
          :model-value="selected.has(facet.id)"
          :data-test="`metrics-explorer-${mode}-facet-${facet.id}`"
          :aria-label="`${facet.label}, ${facet.count} metrics`"
          @update:model-value="toggle(facet.id)"
        >
          <template #label>
            <span class="truncate text-xs" :title="facet.label">{{
              facet.label
            }}</span>
          </template>
        </OCheckbox>

        <OTag
          variant="default"
          size="xs"
          shape="rounded"
          :label="String(facet.count)"
          :data-test="`metrics-explorer-${mode}-count-${facet.id}`"
        />
      </div>

      <div
        v-if="!visibleFacets.length"
        class="px-2 py-3 text-xs text-text-secondary"
        :data-test="`metrics-explorer-${mode}-empty`"
      >
        No {{ mode }}es match.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTag from "@/lib/core/Badge/OTag.vue";

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
}>();

const emit = defineEmits<{
  /** Always a NEW Set — never a mutation of the prop. */
  (e: "update:selected", value: Set<string>): void;
  (e: "clear"): void;
}>();

const search = ref("");

const title = computed(() =>
  props.mode === "prefix" ? "Filter by prefix" : "Filter by suffix",
);

const hasSelection = computed(() => props.selected.size > 0);

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
