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
    ref="navRef"
    v-show="visible"
    v-bind="$attrs"
    role="navigation"
    aria-label="Main navigation"
    data-test="navbar-main-nav"
    data-o2-navbar
    class="left-drawer navbar-links tw:flex tw:flex-col tw:bg-[var(--color-surface-chrome-deeper)] tw:shrink-0 tw:min-h-0 tw:overflow-y-auto tw:w-[5.25rem]"
    @keydown="handleKeydown"
  >
    <!-- Single shared accent bar — slides to whichever item is active so the
         indicator animates from the previously selected item to the new one. -->
    <div class="tw:relative tw:flex tw:flex-col">
      <span
        v-show="indicator.visible"
        aria-hidden="true"
        data-test="navbar-active-indicator"
        class="tw:absolute tw:left-1 tw:w-0.75 tw:rounded-r-full tw:bg-primary-600 tw:pointer-events-none tw:z-10"
        :class="indicatorReady ? 'tw:transition-[transform,height] tw:duration-300 tw:ease-out' : ''"
        :style="{
          transform: `translateY(${indicator.top}px)`,
          height: `${indicator.height}px`,
        }"
      />
      <menu-link
        v-for="(nav, index) in linksList"
        :key="nav.title"
        :link-name="nav.name"
        :animation-index="index"
        v-bind="{ ...nav, mini: miniMode }"
        @mouseenter="emit('menu-hover', nav.link)"
      />
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
import { onMounted, reactive, ref, watch, nextTick } from "vue";
import { useRoute } from "vue-router";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<NavbarProps>(), {
  miniMode: false,
  visible: true,
});

const emit = defineEmits<NavbarEmits>();

defineSlots<NavbarSlots>();

// ── Sliding active indicator ────────────────────────────────────
// A single accent bar (in the template) is positioned over the active item.
// On route change it animates (translateY + height) from the previously
// selected item to the new one, instead of each item drawing its own bar.
const navRef = ref<HTMLElement | null>(null);
const indicator = reactive({ top: 0, height: 0, visible: false });
// Suppress the transition on the very first paint so the bar doesn't fly in
// from the top on initial load — only subsequent moves animate.
const indicatorReady = ref(false);
const route = useRoute();

// Vertical inset (px) so the bar is a touch shorter than the item height.
const BAR_INSET = 6;

const updateIndicator = async () => {
  await nextTick();
  const root = navRef.value;
  if (!root) return;
  const active = root.querySelector<HTMLElement>('[aria-current="page"]');
  if (!active) {
    indicator.visible = false;
    return;
  }
  indicator.top = active.offsetTop + BAR_INSET;
  indicator.height = Math.max(0, active.offsetHeight - BAR_INSET * 2);
  indicator.visible = true;
};

watch(() => route.fullPath, updateIndicator);
// The menu list is built/filtered asynchronously — re-measure when it changes.
watch(() => props.linksList, updateIndicator, { deep: true });

onMounted(async () => {
  await updateIndicator();
  requestAnimationFrame(() => {
    indicatorReady.value = true;
  });
});

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
