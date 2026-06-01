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
  OCrumbTrail — the presentational breadcrumb chain (no wrapper chrome): the
  `Module › Section ▾ › Detail` sequence with per-level link / dropdown-switcher /
  current rendering. It owns NO border/height/padding, so it can be dropped into
  the slim top chrome bar (ChromeBreadcrumb) identically to anywhere else a bare
  crumb chain is needed.

  THE MODEL: a breadcrumb is a PATH of levels. Each `Crumb` is one level:
    • `to`/`onClick` → a link (navigate up to that level)
    • `dropdown` (+ `activeKey`) → a click-to-open ▾ switcher of siblings
    • last / `current` → the current item (non-interactive, aria-current)
  A crumb can be both current and a switcher (the active section, "General ▾").

  FLUID OVERFLOW (Google-Drive style): the trail is width-measured. When the
  crumbs don't fit the available width, the middle levels fold into a leading "…"
  dropdown so the shape becomes `Root › … › Current` and never overflows. The
  "…" menu lists the hidden levels (each still navigable).
-->
<template>
  <div
    ref="trailRef"
    class="o2-crumb-trail tw:flex tw:items-center tw:gap-0.5 tw:min-w-0 tw:flex-1 tw:overflow-hidden"
  >
    <template v-for="(node, di) in displayNodes" :key="node.type === 'overflow' ? 'ov' : node.index">
      <OIcon
        v-if="di > 0"
        name="chevron-right"
        size="sm"
        class="tw:text-text-disabled tw:shrink-0"
      />

      <!-- Collapsed middle levels → "…" overflow dropdown -->
      <ODropdown v-if="node.type === 'overflow'" side="bottom" align="start">
        <template #trigger>
          <button
            type="button"
            class="tw:flex tw:items-center tw:shrink-0 tw:px-1 tw:py-0.5 tw:rounded-md tw:text-text-secondary tw:transition-colors tw:hover:text-text-primary tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500"
            data-test="breadcrumb-overflow"
            :aria-label="`Show ${node.crumbs.length} hidden levels`"
          >
            <OIcon name="more-horiz" size="sm" />
          </button>
        </template>
        <div class="tw:min-w-48 tw:py-1">
          <ODropdownItem
            v-for="o in node.crumbs"
            :key="o.index"
            :data-test="o.crumb.dataTest"
            @select="onCrumb(o.crumb)"
          >
            {{ crumbLabel(o.crumb) }}
          </ODropdownItem>
        </div>
      </ODropdown>

      <!-- 1) Dropdown switcher crumb -->
      <ODropdown
        v-else-if="node.crumb.dropdown && node.crumb.dropdown.length"
        side="bottom"
        align="start"
      >
        <template #trigger>
          <button
            type="button"
            class="tw:flex tw:items-center tw:gap-1 tw:px-1 tw:py-0.5 tw:rounded-md tw:text-sm tw:font-normal tw:text-text-primary tw:transition-colors tw:hover:text-primary-600 tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500"
            :data-test="node.crumb.dataTest || 'breadcrumb-switcher'"
          >
            <span class="tw:truncate tw:max-w-56">{{ activeLabel(node.crumb) }}</span>
            <OIcon name="arrow-drop-down" size="sm" class="tw:shrink-0 tw:opacity-70" />
          </button>
        </template>

        <div class="tw:min-w-56 tw:py-1">
          <template
            v-for="group in visibleGroups(node.crumb.dropdown)"
            :key="group.label || '_'"
          >
            <div
              v-if="group.label"
              class="tw:px-3 tw:pt-2 tw:pb-1 tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-wide tw:text-text-disabled tw:select-none"
            >
              {{ group.label }}
            </div>
            <ODropdownItem
              v-for="option in group.items"
              :key="option.key"
              :data-test="`breadcrumb-option-${option.key}`"
              @select="selectOption(option)"
            >
              <span class="tw:flex tw:items-center tw:gap-2 tw:w-full">
                <img
                  v-if="option.icon && isImg(option.icon)"
                  :src="option.icon.slice(4)"
                  class="tw:h-4 tw:w-4 tw:shrink-0 tw:object-contain"
                  aria-hidden="true"
                  alt=""
                />
                <OIcon
                  v-else-if="option.icon"
                  :name="option.icon as any"
                  size="sm"
                  class="tw:shrink-0 tw:opacity-80"
                />
                <span class="tw:truncate">{{ option.label }}</span>
                <OIcon
                  v-if="option.key === node.crumb.activeKey"
                  name="check"
                  size="sm"
                  class="tw:ml-auto tw:shrink-0 tw:text-primary-600"
                />
              </span>
            </ODropdownItem>
          </template>
        </div>
      </ODropdown>

      <!-- 2) Interactive link crumb (navigates up to this level) -->
      <button
        v-else-if="(node.crumb.to || node.crumb.onClick) && !isCurrent(node.crumb, node.index)"
        type="button"
        class="tw:flex tw:items-center tw:px-1 tw:py-0.5 tw:rounded-md tw:text-sm tw:text-text-secondary tw:max-w-48 tw:transition-colors tw:hover:text-text-primary tw:hover:underline tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500"
        :data-test="node.crumb.dataTest"
        :title="node.crumb.title || node.crumb.label"
        @click="onCrumb(node.crumb)"
      >
        <span class="tw:truncate">{{ node.crumb.label }}</span>
      </button>

      <!-- 3) Current / plain crumb -->
      <span
        v-else
        class="tw:flex tw:items-center tw:px-1 tw:py-0.5 tw:text-sm tw:font-normal tw:text-text-primary tw:truncate tw:max-w-64"
        :data-test="node.crumb.dataTest"
        :title="node.crumb.title || node.crumb.label"
        :aria-current="isCurrent(node.crumb, node.index) ? 'page' : undefined"
      >
        {{ node.crumb.label }}
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type {
  SectionHubGroup,
  SectionHubItem,
} from "@/components/common/SectionHub.vue";

/** A selectable sibling inside a crumb's dropdown (SectionHubItem + an onClick escape hatch). */
export type CrumbOption = SectionHubItem & { onClick?: () => void };
/** A grouped set of sibling options (pass one `{ label: '', items }` for ungrouped). */
export type CrumbGroup = SectionHubGroup;

export interface Crumb {
  /** Text shown for this level. For a dropdown crumb, the active option's label
   *  is used when `label` is omitted. */
  label?: string;
  /** Navigate-up target for the crumb itself. */
  to?: RouteLocationRaw;
  onClick?: () => void;
  /** Optional leading icon (NOT rendered inline in the chrome trail; kept for the
   *  dropdown-option list and any other consumer). */
  icon?: IconName;
  /** Sibling switcher — presence makes this crumb a ▾ dropdown. */
  dropdown?: CrumbGroup[];
  /** Active sibling key (drives the ▾ label + the check mark). */
  activeKey?: string;
  /** Force the terminal "current" rendering (aria-current, non-interactive). */
  current?: boolean;
  title?: string;
  dataTest?: string;
}

const props = defineProps<{ crumbs: Crumb[] }>();

const router = useRouter();

const isImg = (icon: string) => icon.startsWith("img:");

const lastIndex = () => props.crumbs.length - 1;

const isCurrent = (crumb: Crumb, i: number) =>
  crumb.current === true ||
  (i === lastIndex() && !crumb.dropdown?.length && !crumb.to && !crumb.onClick);

const visibleGroups = (groups: CrumbGroup[]) =>
  groups
    .map((g) => ({ ...g, items: g.items.filter((o) => o.visible !== false) }))
    .filter((g) => g.items.length > 0);

const activeLabel = (crumb: Crumb) => {
  if (crumb.dropdown)
    for (const g of crumb.dropdown)
      for (const o of g.items) if (o.key === crumb.activeKey) return o.label;
  return crumb.label ?? "";
};

const crumbLabel = (crumb: Crumb) => crumb.label || activeLabel(crumb);

const onCrumb = (crumb: Crumb) => {
  if (crumb.onClick) crumb.onClick();
  else if (crumb.to) router.push(crumb.to);
};

const selectOption = (option: CrumbOption) => {
  if (option.onClick) option.onClick();
  else if (option.to) router.push(option.to);
};

// ── Fluid overflow ────────────────────────────────────────────────────────
// Width-measured (not depth-bounded): when the full trail overflows the space
// the chrome bar gives it, fold the middle levels into a "…" dropdown. We always
// MEASURE the full layout (reset collapse → measure → re-collapse), so the
// decision is stable and never depends on the already-collapsed width.
type DisplayNode =
  | { type: "crumb"; crumb: Crumb; index: number }
  | { type: "overflow"; crumbs: { crumb: Crumb; index: number }[] };

const trailRef = ref<HTMLElement | null>(null);
const collapsed = ref(false);

const displayNodes = computed<DisplayNode[]>(() => {
  const cs = props.crumbs;
  const n = cs.length;
  if (n === 0) return [];
  if (!collapsed.value || n <= 2)
    return cs.map((crumb, index) => ({ type: "crumb", crumb, index }) as const);
  return [
    { type: "crumb", crumb: cs[0], index: 0 },
    {
      type: "overflow",
      crumbs: cs.slice(1, n - 1).map((crumb, i) => ({ crumb, index: i + 1 })),
    },
    { type: "crumb", crumb: cs[n - 1], index: n - 1 },
  ];
});

const measure = () => {
  const el = trailRef.value;
  if (!el) return;
  collapsed.value = false; // measure the full (uncollapsed) layout
  nextTick(() => {
    const node = trailRef.value;
    if (!node) return;
    collapsed.value = node.scrollWidth > node.clientWidth + 1;
  });
};

let ro: ResizeObserver | null = null;
onMounted(() => {
  if (typeof ResizeObserver !== "undefined" && trailRef.value) {
    ro = new ResizeObserver(() => measure());
    ro.observe(trailRef.value);
  }
  measure();
});
onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
});
watch(() => props.crumbs, () => measure(), { deep: true });
</script>
