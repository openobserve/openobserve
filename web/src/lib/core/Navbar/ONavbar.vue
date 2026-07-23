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

<template>
  <nav
    v-show="visible"
    v-bind="$attrs"
    role="navigation"
    aria-label="Main navigation"
    data-test="navbar-main-nav"
    data-o2-navbar
    class="left-drawer o2-navbar-scroll flex flex-col bg-surface-chrome-deeper shrink-0 min-h-0 overflow-y-auto w-[5.5rem] pb-1"
    @keydown="handleKeydown"
  >
    <!-- Three rail-entry shapes (see navGroups.ts):
         - link:      plain navigating MenuLink.
         - linkGroup: a tile that navigates to its main page AND reveals its
                      sub-pages on hover (Data, Dashboards).
         - group:     a pure flyout group with no page of its own (click toggles);
                      supported here but not currently emitted by groupNavLinks.
         `pinBottom` groups float to the foot of the rail via the flex spacer. -->
    <div class="relative flex flex-col flex-1 min-h-0 gap-y-1">
      <!-- Single sliding-selection pill: tracks the active rail tile and slides to
           it on navigation. Active MenuLinks defer their fill to this (see
           RailIndicatorActiveKey). Snaps (no slide) on mount/reflow/reveal. -->
      <div
        ref="indicatorRef"
        aria-hidden="true"
        :class="indicatorClass"
        :style="indicatorStyle"
      />
      <template
        v-for="entry in topEntries"
        :key="
          entry.type === 'group'
            ? `g-${entry.key}`
            : `l-${entry.item.name}`
        "
      >
        <menu-link
          v-if="entry.type === 'link'"
          :link-name="entry.item.name"
          v-bind="{ ...entry.item, mini: miniMode }"
          @mouseenter="emit('menu-hover', entry.item.link)"
        />
        <ONavGroup
          v-else-if="entry.type === 'linkGroup'"
          :group-key="entry.item.name"
          :title="entry.item.title"
          :icon="entry.item.icon"
          :children="entry.children"
          :parent-item="entry.item"
          @mouseenter="emit('menu-hover', entry.item.link)"
        />
        <ONavGroup
          v-else
          :group-key="entry.key"
          :title="entry.title"
          :icon="entry.icon"
          :children="entry.children"
        />
      </template>

      <!-- Spacer floats any pinned-bottom groups to the foot of the rail -->
      <div v-if="bottomEntries.length" class="nav-rail-spacer flex-1 min-h-2" aria-hidden="true" />

      <ONavGroup
        v-for="entry in bottomEntries"
        :key="`g-${entry.key}`"
        :group-key="entry.key"
        :title="entry.title"
        :icon="entry.icon"
        :children="entry.children"
      />
    </div>
  </nav>
</template>

<script setup lang="ts">
/**
 * Left sidebar navigation bar. Renders a list of MenuLink items with keyboard
 * navigation (ArrowUp/ArrowDown) and Tab trapping.
 */
import {
  computed,
  provide,
  ref,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import type {
  NavbarProps,
  NavbarEmits,
  NavbarSlots,
  RailEntry,
} from "./ONavbar.types";
import { RailIndicatorActiveKey } from "./ONavbar.types";
import { groupNavLinks } from "./navGroups";
import MenuLink from "@/components/MenuLink.vue";
import ONavGroup from "./ONavGroup.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<NavbarProps>(), {
  miniMode: false,
  visible: true,
});

const emit = defineEmits<NavbarEmits>();

defineSlots<NavbarSlots>();

const { t } = useI18n();

// Reshape the flat link list into rail entries: daily-use links stay top-level,
// config / occasional items fold into flyout groups. Split out pinned-bottom
// groups so the template can float them to the foot of the rail. `t` is passed
// so group tile labels are localized (and re-resolve on language change).
const railEntries = computed<RailEntry[]>(() =>
  groupNavLinks(props.linksList, t),
);
const topEntries = computed(() =>
  railEntries.value.filter((e) => !(e.type === "group" && e.pinBottom)),
);
const bottomEntries = computed(
  () =>
    railEntries.value.filter(
      (e) => e.type === "group" && e.pinBottom,
    ) as Extract<RailEntry, { type: "group" }>[],
);

// ── Sliding-selection pill ──────────────────────────────────────────────────
// One indicator tracks the active rail tile (.nav-menu-item--active) and slides
// to it when the route changes. Same approach as OToggleGroup: animate only real
// selection changes; snap on mount, reflow and reveal; skip measuring while the
// rail is hidden so a bogus 0-position is never stored.
const router: any = useRouter();

const indicatorRef = ref<HTMLElement | null>(null);
const indicatorStyle = ref<Record<string, string>>({});
const indicatorVisible = ref(false);
const hasValidPosition = ref(false);
const transitionOn = ref(false);

let resizeObserver: ResizeObserver | null = null;

const measure = (animated: boolean) => {
  const indicator = indicatorRef.value;
  const list = indicator?.parentElement;
  if (!indicator || !list) return;

  const active = list.querySelector<HTMLElement>(".nav-menu-item--active");
  // Skip while hidden/unlaid-out (e.g. the rail is v-show'd off) — measuring here
  // would store a 0-position and slide the pill in from the corner on reveal.
  if (!active || active.offsetParent === null) {
    indicatorVisible.value = false;
    return;
  }

  const listRect = list.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  if (activeRect.height === 0) {
    indicatorVisible.value = false;
    return;
  }

  transitionOn.value = animated && hasValidPosition.value;
  hasValidPosition.value = true;
  indicatorVisible.value = true;
  indicatorStyle.value = {
    width: `${activeRect.width}px`,
    height: `${activeRect.height}px`,
    transform: `translate(${activeRect.left - listRect.left}px, ${activeRect.top - listRect.top}px)`,
  };
};

// Slide to the newly-active tile when the route changes …
watch(
  () => router.currentRoute.value.fullPath,
  async () => {
    await nextTick();
    measure(true);
  },
);

// … and re-measure (snap) when the rail's items change. The flex-constrained
// list doesn't resize on insert/remove, so the ResizeObserver won't catch it.
watch(railEntries, async () => {
  await nextTick();
  measure(false);
});

onMounted(async () => {
  await nextTick();
  measure(false);
  // … but snap (not slide) when tile sizes/visibility change — reflow, the rail
  // being revealed, labels rewrapping — none of which are user selections.
  const list = indicatorRef.value?.parentElement;
  if (list && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => measure(false));
    resizeObserver.observe(list);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

// Theme-aware pill via `dark:` utilities (no JS theme branch, so ONavbar needs no
// store): mirrors MenuLink's own active pill — white + primary accent in light;
// tinted selected pill + lighter accent in dark, where a white pill would vanish
// on the near-black rail.
const indicatorClass = computed(() => [
  "pointer-events-none absolute left-0 top-0 z-0 rounded-surface border-l-2",
  "bg-surface-base border-primary-600 dark:bg-tabs-active-bg dark:border-primary-400",
  transitionOn.value &&
    "transition-[transform,width,height] duration-300 ease-out motion-reduce:transition-none",
  indicatorVisible.value ? "opacity-100" : "opacity-0",
]);

// Tiles read this to know whether to defer their fill to the sliding pill.
provide(
  RailIndicatorActiveKey,
  computed(() => indicatorVisible.value),
);

const NAV_KEYS = ["ArrowDown", "ArrowUp", "Tab"] as const;

function handleKeydown(event: KeyboardEvent) {
  if (!(NAV_KEYS as readonly string[]).includes(event.key)) return;

  const nav = event.currentTarget as HTMLElement;
  // Match link tiles (<a>) and group triggers (<button>) so a focused group tile is found.
  const menuLinks = Array.from(
    nav.querySelectorAll<HTMLElement>(
      "a[data-test^='menu-link-'], button[data-test^='menu-link-']",
    ),
  );

  if (menuLinks.length === 0) return;

  const focusedEl = document.activeElement as HTMLElement;
  const currentIndex = menuLinks.indexOf(focusedEl);

  switch (event.key) {
    case "ArrowDown": {
      event.preventDefault();
      const next =
        currentIndex < 0 || currentIndex + 1 >= menuLinks.length
          ? 0
          : currentIndex + 1;
      menuLinks[next]?.focus();
      break;
    }
    case "ArrowUp": {
      event.preventDefault();
      const prev =
        currentIndex < 0 || currentIndex - 1 < 0
          ? menuLinks.length - 1
          : currentIndex - 1;
      menuLinks[prev]?.focus();
      break;
    }
    case "Tab": {
      event.preventDefault();
      const target = event.shiftKey
        ? document.querySelector<HTMLElement>(
            '.o2-app-header a[href], .o2-app-header button, .o2-app-header [tabindex]:not([tabindex="-1"])',
          )
        : document.querySelector<HTMLElement>(
            '.o2-content-scroll a[href]:not([tabindex="-1"]), .o2-content-scroll button:not([disabled]):not([tabindex="-1"]), .o2-content-scroll input:not([disabled]):not([tabindex="-1"]), .o2-content-scroll select:not([disabled]):not([tabindex="-1"]), .o2-content-scroll [tabindex]:not([tabindex="-1"])',
          );
      if (target) {
        target.focus();
      }
      break;
    }
  }
}
</script>

<style scoped>
/* keep(scrollbar): thin overlay scrollbar — hidden at rest, revealed on hover,
   and never reserves layout width (so no empty strip beside the labels).
   `overflow: overlay` (Blink/WebKit) floats the bar over content; Firefox falls
   back to `scrollbar-width: none`. WebKit scrollbar pseudo-elements and the
   @supports/overlay behaviour can't be expressed as utilities. */
.o2-navbar-scroll {
  scrollbar-width: none; /* Firefox: hidden, reserves nothing */
  -ms-overflow-style: none; /* legacy Edge/IE */
}
@supports (overflow: overlay) {
  .o2-navbar-scroll {
    overflow-y: overlay; /* Blink/WebKit: scrollbar floats over content */
  }
}
.o2-navbar-scroll::-webkit-scrollbar {
  width: 0.375rem;
}
.o2-navbar-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.o2-navbar-scroll::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: var(--radius-full);
  transition: background-color 150ms ease;
}
/* Reveal the thumb only while the rail is hovered. */
.o2-navbar-scroll:hover::-webkit-scrollbar-thumb {
  background-color: var(--color-scrollbar-thumb);
}
</style>
