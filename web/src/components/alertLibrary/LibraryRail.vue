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
  LibraryRail — what am I looking at (pack → category → severity).

  The rail NAVIGATES; the stat strip FILTERS. Install/availability status
  deliberately lives in the strip: putting both here overflowed the rail and
  pushed a whole facet group below the fold.

  Purely presentational — every choice is emitted, nothing is decided here.
-->
<template>
  <nav
    class="flex h-full flex-col gap-4 overflow-y-auto py-3"
    :aria-label="t('alert_library.header')"
    data-test="alert-library-rail"
  >
    <!-- Packs and categories share one list, switched by a segmented control —
         the Prefix/Suffix/Type pattern from the metrics explorer rail. Stacking
         both cost roughly a screen of height on a 14 category pack and pushed
         severity below the fold; only one axis is being navigated at a time
         anyway.

         The active-tab count sits in a FIXED-WIDTH slot so a count changing
         2 → 14 never nudges the label, matching the metrics rail. -->
    <section class="flex flex-col gap-1">
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
                >{{ tab.count || "" }}</span
              >
            </span>
          </OToggleGroupItem>
        </OToggleGroup>
      </div>

      <OButton
        v-for="item in axis === 'packs' ? packs : categories"
        :key="item.id"
        variant="ghost"
        size="sm"
        block
        :active="item.id === (axis === 'packs' ? pack : category)"
        :data-active="String(item.id === (axis === 'packs' ? pack : category))"
        :data-test="`alert-library-rail-${axis === 'packs' ? 'pack' : 'category'}-${item.id}`"
        @click="selectItem(item.id)"
      >
        <OIcon v-if="axis === 'packs'" name="layers" size="sm" class="shrink-0" />
        <span class="min-w-0 flex-1 truncate text-left">{{ item.label }}</span>
        <span class="text-2xs tabular-nums opacity-70">{{ item.count }}</span>
      </OButton>
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

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { useI18nTyped } from "@/types/i18n";

import type { LibraryFacet } from "./libraryFacets";

const props = defineProps<{
  packs: LibraryFacet[];
  pack: string;
  /** Includes the "all" pseudo-facet, built by the caller. */
  categories: LibraryFacet[];
  category: string;
  /** Includes the "all" pseudo-facet, built by the caller. */
  severities: LibraryFacet[];
  severity: string;
}>();

const emit = defineEmits<{
  "update:pack": [id: string];
  "update:category": [id: string];
  "update:severity": [id: string];
}>();

const { t } = useI18nTyped();

/**
 * Which axis the shared list is showing. Local, not a prop: it is a view
 * preference over the same navigation state, and the parent's selections for
 * BOTH axes survive switching tabs — a pack chosen on one tab stays chosen
 * while the user browses categories on the other.
 */
const axis = ref<"packs" | "categories">("packs");

/**
 * Counts are the number of choices on each tab, not the number of alerts —
 * the tab answers "how many options are behind this", which is what makes a
 * tab worth opening. `categories` carries an "all" pseudo-facet from the
 * caller, so it is discounted to avoid advertising a choice that is the
 * absence of one.
 */
const axisTabs = computed(() => [
  { id: "packs" as const, label: t("alert_library.packs"), count: props.packs.length },
  {
    id: "categories" as const,
    label: t("alert_library.categories"),
    count: Math.max(props.categories.length - 1, 0),
  },
]);

/**
 * Emit against whichever axis is on screen. A named branch rather than a
 * ternary inside `emit()`: the emit overloads are keyed on the literal event
 * name, so a computed name widens to `string` and matches none of them.
 */
const selectItem = (id: string) => {
  if (axis.value === "packs") emit("update:pack", id);
  else emit("update:category", id);
};

const onAxisChange = (value: AcceptableValue | AcceptableValue[] | boolean) => {
  // Re-clicking the active tab yields "" — keep the current axis rather than
  // emptying the list, since there is no "neither axis" state to show.
  if (value === "packs" || value === "categories") axis.value = value;
};

const onSeverityChange = (value: AcceptableValue | AcceptableValue[] | boolean) => {
  if (typeof value === "string" && value !== "") emit("update:severity", value);
};
</script>
