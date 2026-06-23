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
  SectionRail — the grouped left navigation rail (prototype ".l2") shared by the
  admin modules (IAM, Settings/Management). Renders the SAME SectionHubGroup data
  the hub uses, so a module is *configured* once and can show either the hub grid
  or this persistent rail. Each item is a <RouterLink>; the active section gets the
  tinted-active treatment. Sentence-case group headings, soft single-line items.
-->
<template>
  <nav
    class="tw:flex tw:flex-col tw:h-full tw:min-h-0 tw:bg-surface-panel"
    data-test="section-rail"
  >
    <div
      v-if="title"
      class="tw:shrink-0 tw:px-3.5 tw:pt-3 tw:pb-1 tw:text-sm tw:font-semibold tw:text-text-primary tw:truncate"
    >
      {{ title }}
    </div>

    <div class="tw:flex-1 tw:overflow-y-auto tw:px-2 tw:pt-1 tw:pb-3">
      <OTabs
        :model-value="activeKey ?? ''"
        orientation="vertical"
        class="tw:w-full"
        @change="onTabChange"
      >
        <template v-for="group in visibleGroups" :key="group.label">
          <div
            class="tw:px-2 tw:py-1 tw:text-[0.72rem] tw:font-semibold tw:text-text-secondary"
          >
            {{ group.label }}
          </div>
          <OTab
            v-for="item in group.items"
            :key="item.key"
            :name="item.key"
            :label="item.label"
            :icon="item.icon"
            :data-test="item.dataTest"
            class="tw:w-full"
            @click="navigate(item.to)"
          />
        </template>
      </OTabs>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import type { SectionHubGroup } from "@/components/common/SectionHub.vue";

const router = useRouter();

// Guarded navigation: a rejected push (e.g. an already-active route, or a
// unit-test router without the target registered) must not surface as an error.
function navigate(to: RouteLocationRaw) {
  Promise.resolve(router.push(to)).catch(() => {});
}

// OTabs emits change when a tab is clicked; navigation is handled by navigate()
// above, so this is a no-op that satisfies the required @change binding.
function onTabChange(_key: string | number) {}

const props = defineProps<{
  /** The same grouped sections the hub uses. */
  groups: SectionHubGroup[];
  /** Currently-active section key (highlighted). */
  activeKey?: string;
  /** Optional small heading shown above the groups (e.g. the module name). */
  title?: string;
}>();

// Drop hidden items/empty groups (each item may carry a `visible` flag).
const visibleGroups = computed(() =>
  props.groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => i.visible !== false),
    }))
    .filter((g) => g.items.length > 0),
);

</script>
