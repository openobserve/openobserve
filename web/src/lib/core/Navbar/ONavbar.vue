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
    class="left-drawer navbar-links o2-navbar-scroll tw:flex tw:flex-col tw:bg-[var(--color-surface-chrome-deeper)] tw:shrink-0 tw:min-h-0 tw:overflow-y-auto tw:w-[10rem] tw:py-2"
    @keydown="handleKeydown"
  >
    <!-- TOP: Logo + org switcher -->
    <div class="tw:flex tw:flex-col tw:px-3 tw:pb-2 tw:border-b tw:border-border-default tw:mb-2">
      <img
        v-if="logoSrc"
        :src="logoSrc"
        alt="OpenObserve"
        class="tw:h-7 tw:max-w-[120px] tw:cursor-pointer tw:mb-2 tw:object-contain tw:object-left"
        data-test="navbar-logo"
        @click="emit('go-to-home')"
      />
      <button
        v-if="orgName"
        class="tw:flex tw:items-center tw:gap-1.5 tw:text-[10.5px] tw:text-text-secondary tw:hover:text-text-primary tw:transition-colors tw:truncate tw:max-w-full tw:text-left tw:cursor-pointer tw:bg-transparent tw:border-none tw:p-0"
        data-test="navbar-org-switcher"
        @click="orgMenuOpen = !orgMenuOpen"
      >
        <span class="tw:truncate tw:flex-1">{{ orgName }}</span>
        <OIcon name="expand-more" size="xs" class="tw:shrink-0" />
      </button>
      <!-- org dropdown -->
      <div
        v-if="orgMenuOpen && orgOptions && orgOptions.length > 0"
        class="tw:absolute tw:left-[10.5rem] tw:top-10 tw:bg-surface-base tw:border tw:border-border-default tw:rounded-lg tw:shadow-lg tw:z-50 tw:min-w-[160px] tw:max-h-64 tw:overflow-y-auto tw:py-1"
        data-test="navbar-org-menu"
      >
        <button
          v-for="org in orgOptions"
          :key="org.identifier"
          class="tw:w-full tw:text-left tw:px-3 tw:py-2 tw:text-[11px] tw:hover:bg-surface-hover tw:transition-colors tw:truncate tw:cursor-pointer tw:bg-transparent tw:border-none"
          @click="selectOrg(org.identifier)"
        >
          {{ org.label }}
        </button>
      </div>
    </div>

    <!-- MIDDLE: Grouped nav links -->
    <div class="tw:flex tw:flex-col tw:flex-1">
      <template v-for="group in orderedGroups" :key="group">
        <template v-if="itemsByGroup[group] && itemsByGroup[group]!.length > 0">
          <div
            class="tw:text-[9px] tw:font-semibold tw:uppercase tw:tracking-[0.08em] tw:text-text-tertiary tw:px-3 tw:pt-3 tw:pb-1"
            :data-test="`navbar-group-${group}`"
          >
            {{ groupLabels[group] }}
          </div>
          <menu-link
            v-for="(nav, index) in itemsByGroup[group]"
            :key="nav.title"
            :link-name="nav.name"
            :animation-index="index"
            v-bind="{ ...nav, mini: miniMode }"
            @mouseenter="emit('menu-hover', nav.link)"
          />
        </template>
      </template>
    </div>

    <!-- FOOTER: utility controls + user -->
    <div class="tw:flex tw:flex-col tw:border-t tw:border-border-default tw:pt-2 tw:mt-2 tw:px-1 tw:gap-0.5">
      <!-- AI Chat toggle -->
      <button
        v-if="isAiEnabled"
        class="tw:flex tw:items-center tw:gap-2.5 tw:px-2 tw:py-1.5 tw:rounded-md tw:text-[11px] tw:w-full tw:text-left tw:transition-colors tw:cursor-pointer tw:border-none"
        :class="isAiChatActive ? 'tw:text-primary-600 tw:bg-tabs-active-bg' : 'tw:text-text-secondary tw:hover:bg-tabs-hover-bg tw:hover:text-text-primary tw:bg-transparent'"
        data-test="navbar-ai-chat-toggle"
        @click="emit('toggle-ai-chat')"
      >
        <OIcon name="auto-awesome" size="sm" class="tw:shrink-0" />
        <span>AI Chat</span>
      </button>

      <!-- Theme toggle -->
      <button
        class="tw:flex tw:items-center tw:gap-2.5 tw:px-2 tw:py-1.5 tw:rounded-md tw:text-[11px] tw:text-text-secondary tw:hover:bg-tabs-hover-bg tw:hover:text-text-primary tw:transition-colors tw:w-full tw:text-left tw:cursor-pointer tw:bg-transparent tw:border-none"
        data-test="navbar-theme-toggle"
        @click="emit('open-predefined-themes')"
      >
        <OIcon :name="theme === 'dark' ? 'light-mode' : 'dark-mode'" size="sm" class="tw:shrink-0" />
        <span>Theme</span>
      </button>

      <!-- Slack -->
      <button
        class="tw:flex tw:items-center tw:gap-2.5 tw:px-2 tw:py-1.5 tw:rounded-md tw:text-[11px] tw:text-text-secondary tw:hover:bg-tabs-hover-bg tw:hover:text-text-primary tw:transition-colors tw:w-full tw:text-left tw:cursor-pointer tw:bg-transparent tw:border-none"
        data-test="navbar-slack"
        @click="emit('open-slack')"
      >
        <OIcon name="forum" size="sm" class="tw:shrink-0" />
        <span>Community</span>
      </button>

      <!-- Help -->
      <button
        class="tw:flex tw:items-center tw:gap-2.5 tw:px-2 tw:py-1.5 tw:rounded-md tw:text-[11px] tw:text-text-secondary tw:hover:bg-tabs-hover-bg tw:hover:text-text-primary tw:transition-colors tw:w-full tw:text-left tw:cursor-pointer tw:bg-transparent tw:border-none"
        data-test="navbar-help"
        @click="emit('open-help')"
      >
        <OIcon name="help-outline" size="sm" class="tw:shrink-0" />
        <span>Help</span>
      </button>

      <!-- User row -->
      <button
        v-if="userName || userEmail"
        class="tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-2 tw:mt-1 tw:rounded-md tw:w-full tw:text-left tw:transition-colors tw:hover:bg-tabs-hover-bg tw:border-t tw:border-border-default tw:cursor-pointer tw:bg-transparent"
        data-test="navbar-user-menu"
        @click="emit('signout')"
      >
        <div class="tw:w-7 tw:h-7 tw:rounded-full tw:bg-primary-600 tw:flex tw:items-center tw:justify-center tw:text-white tw:text-[10px] tw:font-bold tw:shrink-0">
          {{ userInitials }}
        </div>
        <div class="tw:flex tw:flex-col tw:min-w-0">
          <span class="tw:text-[10.5px] tw:font-medium tw:text-text-primary tw:truncate">{{ userName }}</span>
          <span class="tw:text-[9.5px] tw:text-text-tertiary tw:truncate">{{ userEmail }}</span>
        </div>
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { NavbarProps, NavbarEmits, NavbarSlots, NavGroup } from "./ONavbar.types";
import MenuLink from "@/components/MenuLink.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<NavbarProps>(), {
  miniMode: false,
  visible: true,
  isAiEnabled: false,
  isAiChatActive: false,
  theme: 'light',
});

const emit = defineEmits<NavbarEmits>();
defineSlots<NavbarSlots>();

const orgMenuOpen = ref(false);

const orderedGroups: NavGroup[] = ['observe', 'analyze', 'manage', 'admin'];

const groupLabels: Record<NavGroup, string> = {
  observe: 'Observe',
  analyze: 'Analyze',
  manage: 'Manage',
  admin: 'Admin',
};

const itemsByGroup = computed(() => {
  const map: Partial<Record<NavGroup, typeof props.linksList>> = {};
  for (const item of props.linksList) {
    const g = item.group ?? 'manage';
    if (!map[g]) map[g] = [];
    map[g]!.push(item);
  }
  return map;
});

const userInitials = computed(() => {
  if (!props.userName) return '?';
  return props.userName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
});

function selectOrg(identifier: string) {
  orgMenuOpen.value = false;
  emit('update:org', identifier);
}

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
      if (target) target.focus();
      break;
    }
  }
}
</script>

<style scoped>
.o2-navbar-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
@supports (overflow: overlay) {
  .o2-navbar-scroll {
    overflow-y: overlay;
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
.o2-navbar-scroll:hover::-webkit-scrollbar-thumb {
  background-color: var(--color-border-soft, rgba(148, 163, 184, 0.5));
}
:global(.body--dark) .o2-navbar-scroll {
  border-right: 1px solid var(--o2-border-color);
}
</style>
