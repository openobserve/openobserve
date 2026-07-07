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
  SecondaryNav — the Level-2 module section nav for modules with MANY sections,
  where horizontal header tabs don't fit (Settings ~15, IAM up to 7). Renders a
  dense, scrollable vertical route-tab rail. Drop it into PageLayout's #sidebar.

  This is the "many sections → vertical rail" half of the unified nav system;
  the "few sections → horizontal tabs" half is AppPageHeader's #tabs slot. Both
  use the same OTabs/ORouteTab primitive — only orientation/placement differ.

  Data-driven: pass `items` (filtered by `visible`) instead of hand-writing one
  <ORouteTab> per section, so feature-flag visibility lives in one declarative
  array. See web/PAGE_LAYOUT_SYSTEM.md §15.

  Props:  items | modelValue (active key) | dense
  Events: update:modelValue
-->
<template>
  <OTabs
    :model-value="modelValue"
    orientation="vertical"
    :dense="dense"
    class="o2-secondary-nav h-full overflow-y-auto"
    data-test="secondary-nav"
    @update:model-value="(v) => emit('update:modelValue', v as string)"
  >
    <ORouteTab
      v-for="item in visibleItems"
      :key="item.key"
      :name="item.key"
      :to="item.to"
      :icon="item.icon"
      :label="item.label"
      :data-test="item.dataTest"
    />
  </OTabs>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";

export interface SecondaryNavItem {
  /** Stable key; must equal the `modelValue` set for this section's route. */
  key: string;
  label: string;
  to: RouteLocationRaw;
  /** OIcon registry name, or an `img:`-prefixed asset path. */
  icon?: string;
  /** Defaults to true; set false to hide behind a feature flag / role. */
  visible?: boolean;
  dataTest?: string;
}

const props = withDefaults(
  defineProps<{
    items: SecondaryNavItem[];
    modelValue?: string;
    dense?: boolean;
  }>(),
  { dense: true },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const visibleItems = computed(() =>
  props.items.filter((i) => i.visible !== false),
);
</script>
