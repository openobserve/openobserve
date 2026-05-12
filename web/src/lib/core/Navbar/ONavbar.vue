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
    role="navigation"
    aria-label="Main navigation"
    class="oo_sidebar oo_left left-drawer tw:flex tw:flex-col tw:bg-[var(--o2-card-bg)] tw:rounded-md tw:shadow-[0_0_5px_1px_var(--o2-hover-shadow)] tw:mt-1 tw:mb-[0.675rem] tw:shrink-0 tw:overflow-y-auto"
    @keydown="handleKeydown"
  >
    <q-list class="leftNavList">
      <menu-link
        v-for="(nav, index) in linksList"
        :key="nav.title"
        :link-name="nav.name"
        :animation-index="index"
        v-bind="{ ...nav, mini: miniMode }"
        @mouseenter="emit('menu-hover', nav.link)"
      />
    </q-list>
  </nav>
</template>

<script setup lang="ts">
import { QList } from "quasar";
import MenuLink from "@/components/MenuLink.vue";
import type { NavbarProps, NavbarEmits } from "./ONavbar.types";

withDefaults(defineProps<NavbarProps>(), {
  miniMode: false,
  visible: true,
});

const emit = defineEmits<NavbarEmits>();

const NAV_KEYS = ["ArrowDown", "ArrowUp", "Tab"] as const;

function handleKeydown(event: KeyboardEvent) {
  if (!(NAV_KEYS as readonly string[]).includes(event.key)) return;

  const nav = event.currentTarget as HTMLElement;
  const menuLinks = Array.from(
    nav.querySelectorAll<HTMLElement>("a.q-item"),
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
            '.oo_header a[href], .oo_header button, .oo_header [tabindex]:not([tabindex="-1"])',
          )
        : document.querySelector<HTMLElement>(
            '.oo_content-scroll a[href]:not([tabindex="-1"]), .oo_content-scroll button:not([disabled]):not([tabindex="-1"]), .oo_content-scroll input:not([disabled]):not([tabindex="-1"]), .oo_content-scroll select:not([disabled]):not([tabindex="-1"]), .oo_content-scroll [tabindex]:not([tabindex="-1"])',
          );
      if (target) {
        target.focus();
      }
      break;
    }
  }
}
</script>
