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
    class="left-drawer navbar-links o2-navbar-scroll tw:flex tw:flex-col tw:bg-[var(--color-surface-chrome-deeper)] tw:shrink-0 tw:min-h-0 tw:overflow-y-auto tw:w-[5.5rem] tw:pb-1"
    @keydown="handleKeydown"
  >
    <!-- Three rail-entry shapes (see navGroups.ts):
         - link:      plain navigating MenuLink.
         - linkGroup: a tile that navigates to its main page AND reveals its
                      sub-pages on hover (Data, Dashboards).
         - group:     a pure flyout group with no page of its own (click toggles);
                      supported here but not currently emitted by groupNavLinks.
         `pinBottom` groups float to the foot of the rail via the flex spacer. -->
    <div class="tw:flex tw:flex-col tw:flex-1 tw:min-h-0">
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
      <div v-if="bottomEntries.length" class="nav-rail-spacer tw:flex-1 tw:min-h-2" aria-hidden="true" />

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
import { computed } from "vue";
import type {
  NavbarProps,
  NavbarEmits,
  NavbarSlots,
  RailEntry,
} from "./ONavbar.types";
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

// Reshape the flat link list into rail entries: daily-use links stay top-level,
// config / occasional items fold into flyout groups. Split out pinned-bottom
// groups so the template can float them to the foot of the rail.
const railEntries = computed<RailEntry[]>(() => groupNavLinks(props.linksList));
const topEntries = computed(() =>
  railEntries.value.filter((e) => !(e.type === "group" && e.pinBottom)),
);
const bottomEntries = computed(
  () =>
    railEntries.value.filter(
      (e) => e.type === "group" && e.pinBottom,
    ) as Extract<RailEntry, { type: "group" }>[],
);

const NAV_KEYS = ["ArrowDown", "ArrowUp", "Tab"] as const;

function handleKeydown(event: KeyboardEvent) {
  if (!(NAV_KEYS as readonly string[]).includes(event.key)) return;

  const nav = event.currentTarget as HTMLElement;
  const menuLinks = Array.from(
    nav.querySelectorAll<HTMLElement>("a[data-test^='menu-link-']"),
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
/* Thin overlay scrollbar: hidden at rest, revealed on hover, and — crucially —
   it never reserves layout width, so there is no empty strip beside the labels.

   A styled WebKit scrollbar is normally a classic, space-reserving bar (that is
   what previously pushed the labels inward and clipped "Management"). The only
   way a native scrollbar floats *over* content instead of reserving space is
   `overflow: overlay`, which Blink/WebKit honor. Firefox doesn't support it, so
   it falls back to `scrollbar-width: none` — a hidden bar that also reserves
   nothing. Either way the rail keeps its full width and still scrolls via
   wheel, trackpad, and the ArrowUp/ArrowDown keyboard handler above. */
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
  width: 6px;
}
.o2-navbar-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.o2-navbar-scroll::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: 9999px;
  transition: background-color 150ms ease;
}
/* Reveal the thumb only while the rail is hovered. */
.o2-navbar-scroll:hover::-webkit-scrollbar-thumb {
  background-color: var(--color-border-soft, rgba(148, 163, 184, 0.5));
}

/* Right border only in dark mode — light mode uses shadow on the content card */
:global(.body--dark) .o2-navbar-scroll {
  border-right: 1px solid var(--o2-border-color);
}
</style>
