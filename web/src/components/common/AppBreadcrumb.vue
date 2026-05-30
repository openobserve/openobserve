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
  AppBreadcrumb — the standard ancestor-path navigation for detail (Level-3+)
  views. Render it inside AppPageHeader's #subtitle slot (or pass AppPageHeader
  a `breadcrumb` prop), with the current item also shown as the header title.

  Each crumb links to its parent via `to` (router) or `onClick`; the terminal
  crumb (no `to`/`onClick`) is the current page — non-interactive, bold, and
  marked aria-current.

  ADAPTIVE OVERFLOW: the chain is depth-bounded. When the number of crumbs
  exceeds `maxInline`, the middle crumbs collapse into a "…" dropdown so the
  rendered shape is always Root › … › Parent › Current — it never overflows or
  reflows the header at any depth.

  Use the default slot for trailing content (e.g. a loading spinner).
-->
<template>
  <nav
    class="tw:flex tw:items-center tw:gap-0.5 tw:-ms-1.5 tw:min-w-0"
    aria-label="Breadcrumb"
    data-test="app-breadcrumb"
  >
    <template v-for="(node, idx) in nodes" :key="idx">
      <OIcon
        v-if="idx > 0"
        name="chevron-right"
        size="sm"
        class="tw:text-text-disabled tw:shrink-0"
      />

      <!-- Collapsed middle crumbs → overflow dropdown -->
      <ODropdown v-if="node.kind === 'overflow'" align="start">
        <template #trigger>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="more-horiz"
            data-test="app-breadcrumb-overflow"
            :aria-label="`Show ${node.items.length} hidden levels`"
          />
        </template>
        <ODropdownItem
          v-for="(item, i) in node.items"
          :key="i"
          :data-test="item.dataTest"
          @select="onCrumbClick(item)"
        >
          {{ item.label }}
        </ODropdownItem>
      </ODropdown>

      <!-- Interactive ancestor crumb -->
      <button
        v-else-if="node.item.to || node.item.onClick"
        type="button"
        class="tw:text-text-secondary tw:max-w-48 tw:truncate tw:px-1.5 tw:py-0.5 tw:rounded-md tw:outline-none tw:transition-colors tw:hover:text-text-primary tw:hover:bg-surface-subtle tw:focus-visible:ring-4 tw:focus-visible:ring-primary-500/25 tw:focus-visible:ring-inset tw:shrink-0"
        :title="node.item.title ?? node.item.label"
        :data-test="node.item.dataTest"
        @click="onCrumbClick(node.item)"
      >
        {{ node.item.label }}
      </button>

      <!-- Current (terminal) crumb — non-interactive -->
      <span
        v-else
        class="tw:text-text-primary tw:font-medium tw:max-w-64 tw:truncate tw:px-1.5 tw:py-0.5 tw:shrink"
        :class="{ 'tw:min-w-0': node.isCurrent }"
        :aria-current="node.isCurrent ? 'page' : undefined"
        :title="node.item.title ?? node.item.label"
        :data-test="node.item.dataTest"
      >
        {{ node.item.label }}
      </span>
    </template>
    <slot />
  </nav>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";
import { computed } from "vue";
import { useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";

export interface BreadcrumbItem {
  label: string;
  to?: RouteLocationRaw;
  onClick?: () => void;
  title?: string;
  dataTest?: string;
}

type CrumbNode =
  | { kind: "crumb"; item: BreadcrumbItem; isCurrent: boolean }
  | { kind: "overflow"; items: BreadcrumbItem[] };

const props = withDefaults(
  defineProps<{
    items: BreadcrumbItem[];
    /** Max crumbs rendered inline before middles collapse into a "…" menu. */
    maxInline?: number;
  }>(),
  {
    maxInline: 3,
  },
);

const router = useRouter();

// Depth-driven (not width-measured, so it's SSR-safe and stable): once the
// chain exceeds `maxInline`, keep Root + Parent + Current inline and fold every
// crumb strictly between Root and Parent into a single overflow node.
const nodes = computed<CrumbNode[]>(() => {
  const items = props.items;
  const n = items.length;
  if (n === 0) return [];

  const mark = (item: BreadcrumbItem, i: number): CrumbNode => ({
    kind: "crumb",
    item,
    isCurrent: i === n - 1,
  });

  if (n <= props.maxInline) {
    return items.map(mark);
  }

  return [
    mark(items[0], 0),
    { kind: "overflow", items: items.slice(1, n - 2) },
    mark(items[n - 2], n - 2),
    mark(items[n - 1], n - 1),
  ];
});

const onCrumbClick = (item: BreadcrumbItem) => {
  if (item.onClick) item.onClick();
  else if (item.to) router.push(item.to);
};
</script>
