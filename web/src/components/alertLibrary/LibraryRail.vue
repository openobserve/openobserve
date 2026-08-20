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
    <section class="flex flex-col gap-1">
      <h2 class="text-text-secondary text-2xs px-2 font-semibold uppercase">
        {{ t("alert_library.packs") }}
      </h2>
      <OButton
        v-for="item in packs"
        :key="item.id"
        variant="ghost"
        size="sm"
        block
        :active="item.id === pack"
        :data-active="String(item.id === pack)"
        :data-test="`alert-library-rail-pack-${item.id}`"
        @click="emit('update:pack', item.id)"
      >
        <OIcon name="layers" size="sm" class="shrink-0" />
        <span class="min-w-0 flex-1 truncate text-left">{{ item.label }}</span>
        <span class="text-2xs tabular-nums opacity-70">{{ item.count }}</span>
      </OButton>
    </section>

    <section class="flex flex-col gap-1">
      <h2 class="text-text-secondary text-2xs px-2 font-semibold uppercase">
        {{ t("alert_library.categories") }}
      </h2>
      <OButton
        v-for="item in categories"
        :key="item.id"
        variant="ghost"
        size="sm"
        block
        :active="item.id === category"
        :data-active="String(item.id === category)"
        :data-test="`alert-library-rail-category-${item.id}`"
        @click="emit('update:category', item.id)"
      >
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
import type { AcceptableValue } from "reka-ui";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { useI18nTyped } from "@/types/i18n";

import type { LibraryFacet } from "./libraryFacets";

defineProps<{
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

const onSeverityChange = (value: AcceptableValue | AcceptableValue[] | boolean) => {
  if (typeof value === "string" && value !== "") emit("update:severity", value);
};
</script>
