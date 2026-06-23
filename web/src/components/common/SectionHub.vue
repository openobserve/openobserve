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
  SectionHub — a Stripe-style landing "hub" for a module that has many
  section pages (Settings, IAM). Renders the module title and its sections as
  grouped cards (icon + name + one-line description). Clicking a card routes to
  that section full-width.

  Use it as the module's index page; each section page then publishes a chrome
  breadcrumb ("Module › Section ▾") for fast lateral navigation + a link back to
  this hub. This keeps section pages full-width for their CRUD content while
  staying easy to navigate and discover.

  Data-driven: pass `title` and `groups` (each with a label + items). Items are
  the same shape used by the rail/switcher, with an added `description`.
-->
<template>
  <ConstrainedPage size="lg" class="o2-section-hub" data-test="section-hub">
    <div>
      <header v-if="title || description" class="tw:mb-6">
        <h1
          v-if="title"
          class="tw:text-xl! tw:font-semibold! tw:text-text-primary"
        >
          {{ title }}
        </h1>
        <p
          v-if="description"
          class="tw:text-sm tw:text-text-secondary tw:mt-1"
        >
          {{ description }}
        </p>
      </header>

      <section
        v-for="group in visibleGroups"
        :key="group.label || '_'"
        class="tw:mb-8"
        :data-test="`section-hub-group-${group.label}`"
      >
        <h2
          v-if="group.label"
          class="tw:text-sm! tw:font-semibold! tw:text-text-primary tw:mb-3"
        >
          {{ group.label }}
        </h2>
        <div
          class="tw:grid tw:grid-cols-1 tw:sm:grid-cols-2 tw:lg:grid-cols-3 tw:gap-4"
        >
          <button
            v-for="item in group.items"
            :key="item.key"
            type="button"
            class="o2-hub-card tw:group tw:flex tw:items-start tw:gap-3 tw:text-left tw:p-4 tw:rounded-lg tw:border tw:border-border-default tw:bg-surface-panel tw:transition-colors tw:hover:border-primary-500 tw:hover:bg-surface-subtle tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500"
            :data-test="item.dataTest || `section-hub-card-${item.key}`"
            @click="router.push(item.to)"
          >
            <span
              class="tw:shrink-0 tw:mt-0.5 tw:inline-flex tw:items-center tw:justify-center tw:w-8 tw:h-8 tw:rounded-md tw:bg-surface-subtle tw:text-text-secondary tw:transition-colors tw:group-hover:bg-primary-50 tw:group-hover:text-primary-600"
            >
              <img
                v-if="item.icon && isImg(item.icon)"
                :src="item.icon.slice(4)"
                class="tw:h-4 tw:w-4 tw:object-contain"
                aria-hidden="true"
                alt=""
              />
              <OIcon v-else-if="item.icon" :name="item.icon as any" size="sm" />
            </span>
            <span class="tw:flex tw:flex-col tw:min-w-0">
              <span
                class="tw:text-sm tw:font-semibold tw:text-text-primary tw:transition-colors tw:group-hover:text-primary-600"
                >{{ item.label }}</span
              >
              <span
                v-if="item.description"
                class="tw:text-xs tw:text-text-secondary tw:mt-0.5 tw:leading-snug"
                >{{ item.description }}</span
              >
            </span>
          </button>
        </div>
      </section>
    </div>
  </ConstrainedPage>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ConstrainedPage from "@/components/common/ConstrainedPage.vue";

const router = useRouter();

export interface SectionHubItem {
  key: string;
  label: string;
  description?: string;
  icon?: string;
  to: RouteLocationRaw;
  visible?: boolean;
  dataTest?: string;
}

export interface SectionHubGroup {
  label: string;
  items: SectionHubItem[];
}

const props = defineProps<{
  title?: string;
  /** Optional one-line description shown under the hub title. */
  description?: string;
  groups: SectionHubGroup[];
}>();

const isImg = (icon: string) => icon.startsWith("img:");

// Drop items hidden by feature flags, then drop now-empty groups.
const visibleGroups = computed(() =>
  props.groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.visible !== false) }))
    .filter((g) => g.items.length > 0),
);
</script>
