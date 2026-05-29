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
  AppBreadcrumb — the standard ancestor-path navigation used in detail (Level-3)
  views. Render it inside AppPageHeader's #subtitle slot, with the current item
  as the header title. Each crumb links back to its parent via `to` (router) or
  `onClick`; a crumb without either renders as plain (current) text.

  Use the default slot for trailing content (e.g. a loading spinner).
-->
<template>
  <nav
    class="tw:flex tw:items-center tw:gap-0.5 tw:-ms-1.5 tw:min-w-0"
    aria-label="Breadcrumb"
    data-test="app-breadcrumb"
  >
    <template v-for="(item, idx) in items" :key="idx">
      <OIcon
        v-if="idx > 0"
        name="chevron-right"
        size="sm"
        class="tw:text-text-disabled tw:shrink-0"
      />
      <button
        v-if="item.to || item.onClick"
        type="button"
        class="tw:text-text-secondary tw:max-w-[12rem] tw:truncate tw:px-1.5 tw:py-0.5 tw:rounded-md tw:outline-none tw:transition-colors tw:hover:text-text-primary tw:hover:bg-surface-subtle tw:focus-visible:ring-4 tw:focus-visible:ring-primary-500/25 tw:focus-visible:ring-inset tw:shrink-0"
        :title="item.title ?? item.label"
        :data-test="item.dataTest"
        @click="onCrumbClick(item)"
      >
        {{ item.label }}
      </button>
      <span
        v-else
        class="tw:text-text-primary tw:max-w-[12rem] tw:truncate tw:px-1.5 tw:py-0.5 tw:shrink-0"
        :title="item.title ?? item.label"
        :data-test="item.dataTest"
      >
        {{ item.label }}
      </span>
    </template>
    <slot />
  </nav>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";
import { useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export interface BreadcrumbItem {
  label: string;
  to?: RouteLocationRaw;
  onClick?: () => void;
  title?: string;
  dataTest?: string;
}

defineProps<{ items: BreadcrumbItem[] }>();

const router = useRouter();

const onCrumbClick = (item: BreadcrumbItem) => {
  if (item.onClick) item.onClick();
  else if (item.to) router.push(item.to);
};
</script>
