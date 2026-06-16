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
    class="left-drawer navbar-links tw:flex tw:flex-col tw:bg-[var(--color-surface-chrome-deeper)] tw:shrink-0 tw:min-h-0 tw:overflow-hidden tw:w-[10rem] tw:py-2"
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
      <organization-selector
        v-if="organizations && organizations.length > 0"
        :organizations="organizations"
        :current="currentOrg ?? null"
        data-test="navbar-org-switcher"
        @select="(org) => emit('update:org', org.identifier)"
      />
    </div>

    <!-- MIDDLE: Flat nav links -->
    <div class="tw:flex tw:flex-col tw:flex-1">
      <menu-link
        v-for="(nav, index) in visibleLinks"
        :key="nav.title"
        :link-name="nav.name"
        :animation-index="index"
        v-bind="{ ...nav, mini: miniMode }"
        @mouseenter="emit('menu-hover', nav.link)"
      />
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

      <!-- User row dropdown -->
      <ODropdown
        v-if="userName || userEmail"
        side="top"
        align="start"
        @update:open="(open) => { if (!open) showLanguageSubmenu = false; }"
      >
        <template #trigger>
          <button
            class="tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-2 tw:mt-1 tw:rounded-md tw:w-full tw:text-left tw:transition-colors tw:hover:bg-tabs-hover-bg tw:border-t tw:border-border-default tw:cursor-pointer tw:bg-transparent tw:border-none"
            data-test="navbar-user-menu"
          >
            <div class="tw:w-7 tw:h-7 tw:rounded-full tw:bg-primary-600 tw:flex tw:items-center tw:justify-center tw:text-white tw:text-[10px] tw:font-bold tw:shrink-0">
              {{ userInitials }}
            </div>
            <div class="tw:flex tw:flex-col tw:min-w-0">
              <span class="tw:text-[10.5px] tw:font-medium tw:text-text-primary tw:truncate">{{ userName }}</span>
              <span class="tw:text-[9.5px] tw:text-text-tertiary tw:truncate">{{ userEmail }}</span>
            </div>
          </button>
        </template>
        <div class="tw:min-w-[220px]">
          <!-- User info (non-clickable) -->
          <div class="tw:flex tw:items-center tw:gap-2.5 tw:px-3 tw:py-2.5">
            <div class="tw:w-6 tw:h-6 tw:rounded-full tw:bg-primary-600 tw:flex tw:items-center tw:justify-center tw:text-white tw:text-[9px] tw:font-bold tw:shrink-0">
              {{ userInitials }}
            </div>
            <span class="tw:text-[11px] tw:truncate tw:text-text-primary">{{ userName || userEmail }}</span>
          </div>
          <ODropdownSeparator />
          <!-- Language submenu -->
          <div
            v-if="langList && langList.length > 0"
            class="tw:relative tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:cursor-pointer tw:text-[11px] tw:text-text-primary tw:hover:bg-tabs-hover-bg tw:select-none"
            data-test="navbar-language-trigger"
            @click.stop="showLanguageSubmenu = !showLanguageSubmenu"
          >
            <OIcon size="xs" name="language" class="tw:shrink-0" />
            <span class="tw:flex-1">{{ selectedLanguage?.label ?? 'Language' }}</span>
            <OIcon size="xs" name="chevron-right" />
            <div
              v-if="showLanguageSubmenu"
              class="tw:absolute tw:left-full tw:bottom-0 tw:bg-surface-base tw:border tw:border-border-default tw:rounded-lg tw:shadow-lg tw:z-50 tw:min-w-[140px] tw:py-1"
              @click.stop
            >
              <button
                v-for="lang in langList"
                :key="lang.code"
                type="button"
                class="tw:flex tw:items-center tw:gap-2 tw:w-full tw:px-3 tw:py-2 tw:text-[11px] tw:text-text-primary tw:hover:bg-tabs-hover-bg tw:cursor-pointer tw:bg-transparent tw:border-none tw:text-left"
                :class="{ 'tw:text-primary-600': selectedLanguage?.code === lang.code }"
                @click="emit('change-language', lang); showLanguageSubmenu = false"
              >
                <img
                  v-if="lang.icon && lang.icon.startsWith('img:')"
                  :src="lang.icon.slice(4)"
                  :alt="lang.label"
                  class="tw:w-4 tw:h-4 tw:object-contain tw:shrink-0"
                />
                <OIcon v-else-if="lang.icon" size="xs" :name="lang.icon" class="tw:shrink-0" />
                <span class="tw:flex-1">{{ lang.label }}</span>
                <OIcon v-if="selectedLanguage?.code === lang.code" size="xs" name="check" />
              </button>
            </div>
          </div>
          <ODropdownSeparator />
          <!-- Theme -->
          <ODropdownItem data-test="navbar-theme-in-user-menu" @select="emit('open-predefined-themes')">
            <template #icon-left>
              <OIcon size="xs" :name="theme === 'dark' ? 'light-mode' : 'dark-mode'" />
            </template>
            Theme
          </ODropdownItem>
          <ODropdownSeparator />
          <!-- Signout -->
          <ODropdownItem variant="destructive" data-test="navbar-signout" @select="emit('signout')">
            <template #icon-left>
              <OIcon size="xs" name="exit-to-app" />
            </template>
            Sign out
          </ODropdownItem>
        </div>
      </ODropdown>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { NavbarProps, NavbarEmits, NavbarSlots } from "./ONavbar.types";
import MenuLink from "@/components/MenuLink.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OrganizationSelector from "@/components/OrganizationSelector.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";

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

const showLanguageSubmenu = ref(false);

const visibleLinks = computed(() =>
  props.linksList.filter((item) => item.hide !== true && item.display !== false),
);

const userInitials = computed(() => {
  if (!props.userName) return '?';
  return props.userName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
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
      if (target) target.focus();
      break;
    }
  }
}
</script>

<style scoped>
:global(.body--dark) nav[data-o2-navbar] {
  border-right: 1px solid var(--o2-border-color);
}
</style>
