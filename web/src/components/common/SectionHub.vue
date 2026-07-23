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
      <header v-if="title || description" class="mb-6">
        <h1 v-if="title" class="text-text-heading text-xl! font-semibold!">
          {{ title }}
        </h1>
        <p v-if="description" class="text-text-secondary mt-1 text-sm">
          {{ description }}
        </p>
      </header>

      <section
        v-for="group in visibleGroups"
        :key="group.label || '_'"
        class="mb-8"
        :data-test="`section-hub-group-${group.label}`"
      >
        <h2 v-if="group.label" class="text-text-heading mb-3 text-sm! font-semibold!">
          {{ group.label }}
        </h2>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            v-for="item in group.items"
            :key="item.key"
            type="button"
            class="o2-hub-card group rounded-default border-border-default bg-surface-panel hover:border-primary-500 hover:bg-surface-subtle focus-visible:ring-primary-500 flex items-start gap-3 border p-4 text-left transition-colors outline-none focus-visible:ring-2"
            :data-test="item.dataTest || `section-hub-card-${item.key}`"
            @click="router.push(item.to)"
          >
            <span
              class="rounded-default bg-surface-subtle text-text-secondary group-hover:bg-primary-50 group-hover:text-primary-600 mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center transition-colors"
            >
              <img
                v-if="item.icon && isImg(item.icon)"
                :src="item.icon.slice(4)"
                class="h-4 w-4 object-contain"
                aria-hidden="true"
                alt=""
              />
              <OIcon v-else-if="item.icon" :name="item.icon as any" size="sm" />
            </span>
            <span class="flex min-w-0 flex-col">
              <span
                class="text-text-heading group-hover:text-primary-600 text-sm font-semibold transition-colors"
                >{{ item.label }}</span
              >
              <span
                v-if="item.description"
                class="text-text-secondary mt-0.5 text-xs leading-snug"
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
