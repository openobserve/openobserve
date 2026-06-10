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
      <div
        v-for="group in visibleGroups"
        :key="group.label"
        class="tw:mt-1.5 tw:first:mt-0"
      >
        <div
          class="tw:px-2 tw:pt-2 tw:pb-1 tw:text-[0.72rem] tw:font-semibold tw:text-text-secondary"
        >
          {{ group.label }}
        </div>
        <button
          v-for="item in group.items"
          :key="item.key"
          type="button"
          :data-test="item.dataTest"
          :title="item.label"
          :aria-current="item.key === activeKey ? 'page' : undefined"
          class="tw:flex tw:w-full tw:items-center tw:gap-2.5 tw:px-2.5 tw:py-1.5 tw:my-0.5 tw:rounded-lg tw:text-sm tw:font-medium tw:text-left tw:transition-colors"
          :class="item.key === activeKey
            ? 'tw:bg-tabs-active-bg tw:text-tabs-active-text'
            : 'tw:text-text-secondary tw:hover:bg-surface-subtle tw:hover:text-text-primary'"
          @click="navigate(item.to)"
        >
          <OIcon
            v-if="item.icon"
            :name="(item.icon as any)"
            size="sm"
            class="tw:shrink-0"
          />
          <span class="tw:leading-snug tw:whitespace-nowrap tw:truncate tw:min-w-0">{{ item.label }}</span>
        </button>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { SectionHubGroup } from "@/components/common/SectionHub.vue";

const router = useRouter();

// Guarded navigation: a rejected push (e.g. an already-active route, or a
// unit-test router without the target registered) must not surface as an error.
function navigate(to: RouteLocationRaw) {
  Promise.resolve(router.push(to)).catch(() => {});
}

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

// Group labels in the data are sometimes ALL-CAPS ("ACCESS"); the design system
</script>
