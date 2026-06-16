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
    class="left-drawer navbar-links o2-navbar-scroll tw:flex tw:flex-col tw:bg-[var(--color-surface-chrome-deeper)] tw:shrink-0 tw:min-h-0 tw:overflow-y-auto tw:w-[5.25rem] tw:py-1"
    @keydown="handleKeydown"
  >
    <!-- Each active item carries its own left accent border (see MenuLink), so
         no separate floating indicator bar is needed. -->
    <div class="tw:flex tw:flex-col">
      <menu-link
        v-for="(nav, index) in linksList"
        :key="nav.title"
        :link-name="nav.name"
        :animation-index="index"
        v-bind="{ ...nav, mini: miniMode }"
        @mouseenter="emit('menu-hover', nav.link)"
      />

      <!-- Manage group — flyout opens to the right -->
      <ODropdown
        v-if="manageLinks && manageLinks.length > 0"
        side="right"
        align="start"
        :side-offset="4"
      >
        <template #trigger>
          <button
            type="button"
            :class="[
              'nav-menu-item',
              'tw:group tw:flex tw:flex-col tw:items-center tw:gap-0.5 tw:mx-1 tw:px-0 tw:py-1 tw:min-h-0 tw:rounded-lg tw:transition-colors tw:duration-150 tw:ease-out tw:cursor-pointer tw:select-none tw:w-[calc(100%-0.5rem)] tw:border-0 tw:bg-transparent tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500',
              isManageActive
                ? manageTriggerActiveClass
                : 'tw:text-tabs-inactive-text tw:border-l-2 tw:border-transparent tw:hover:bg-tabs-hover-bg',
            ]"
          >
            <div
              class="icon-wrapper tw:relative tw:inline-flex tw:items-center tw:justify-center tw:rounded-lg tw:p-0.5 tw:transition-colors tw:duration-250"
              :class="isManageActive
                ? (isDark ? 'tw:text-tabs-active-text!' : 'tw:text-primary-700!')
                : 'tw:text-tabs-inactive-text tw:group-hover:text-primary-600'"
            >
              <OIcon name="more-horiz" size="md" />
            </div>
            <div
              class="nav-menu-item-label tw:text-[14px] tw:font-medium tw:tracking-[0.01em] tw:transition-colors tw:duration-250 tw:w-full tw:text-center tw:leading-tight"
              :class="isManageActive
                ? (isDark ? 'tw:font-semibold tw:text-tabs-active-text!' : 'tw:font-semibold tw:text-primary-600!')
                : 'tw:text-tabs-inactive-text tw:group-hover:text-primary-600'"
            >{{ t('menu.more') }}</div>
          </button>
        </template>
        <div class="tw:min-w-[180px] tw:bg-[var(--color-surface-chrome-deeper)] tw:rounded-lg tw:overflow-hidden tw:py-1">
          <menu-link
            v-for="(link, index) in manageLinks"
            :key="link.name"
            :link-name="link.name"
            :animation-index="index"
            v-bind="{ ...link, mini: miniMode, inline: true }"
            @mouseenter="emit('menu-hover', link.link)"
          />
        </div>
      </ODropdown>
    </div>
  </nav>
</template>

<script setup lang="ts">
/**
 * Left sidebar navigation bar. Renders a list of MenuLink items with keyboard
 * navigation (ArrowUp/ArrowDown) and Tab trapping.
 */
import type { NavbarProps, NavbarEmits, NavbarSlots } from "./ONavbar.types";
import MenuLink from "@/components/MenuLink.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<NavbarProps>(), {
  miniMode: false,
  visible: true,
  manageLinks: () => [],
});

const { t } = useI18n();
const router = useRouter();
const store = useStore();

const isDark = computed(() => store.state.theme === "dark");

const manageTriggerActiveClass = computed(() =>
  isDark.value
    ? "tw:text-tabs-active-text tw:bg-tabs-active-bg tw:shadow-sm tw:border-l-2 tw:border-primary-400"
    : "tw:text-primary-700 tw:bg-surface-base tw:shadow-sm tw:border-l-2 tw:border-primary-600"
);

function isLinkActive(link: string): boolean {
  return router.currentRoute.value.path.indexOf(link) === 0;
}

const isManageActive = computed(() =>
  (props.manageLinks ?? []).some((l) => isLinkActive(l.link))
);

const emit = defineEmits<NavbarEmits>();

defineSlots<NavbarSlots>();

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
