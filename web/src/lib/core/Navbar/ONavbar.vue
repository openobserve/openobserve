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
    class="left-drawer navbar-links o2-navbar-scroll tw:flex tw:flex-col tw:bg-[var(--color-surface-chrome-deeper)] tw:shrink-0 tw:h-screen tw:w-[5.25rem] tw:py-0 tw:overflow-visible"
    @keydown="handleKeydown"
  >
    <!-- Logo / home button -->
    <button
      type="button"
      class="tw:flex tw:items-center tw:justify-center tw:py-2 tw:px-1 tw:w-full tw:border-b tw:border-[var(--o2-border-color)] tw:cursor-pointer tw:bg-transparent tw:border-x-0 tw:border-t-0 tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500 tw:shrink-0"
      :title="t('menu.home')"
      @click="emit('go-to-home')"
    >
      <img
        class="tw:h-8 tw:max-w-[4.5rem] tw:block tw:transition-opacity tw:duration-200 hover:tw:opacity-80"
        :src="logoSrc"
        alt="OpenObserve"
      />
    </button>

    <!-- Org switcher -->
    <OrganizationSelector
      v-if="organizations && organizations.length > 0"
      :organizations="organizations"
      :current="userClickedOrg"
      class="tw:border-b tw:border-[var(--o2-border-color)] tw:shrink-0"
      @select="handleOrgSelection"
    />

    <!-- Primary nav items + Manage group -->
    <div class="nav-scroll tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:py-1">
      <menu-link
        v-for="(nav, index) in linksList"
        :key="nav.title"
        :link-name="nav.name"
        :animation-index="index"
        v-bind="{ ...nav, mini: miniMode }"
        @mouseenter="emit('menu-hover', nav.link)"
      />

      <!-- Manage group — ODropdown opens to the right, same as Help -->
      <ODropdown
        v-if="manageLinks && manageLinks.length > 0"
        side="right"
        align="start"
        :side-offset="4"
      >
        <template #trigger>
          <div
            :class="[
              'nav-menu-item',
              'tw:group tw:flex tw:flex-col tw:items-center tw:gap-0.5 tw:mx-1 tw:px-0 tw:py-1 tw:min-h-0 tw:rounded-lg tw:transition-colors tw:duration-150 tw:ease-out tw:cursor-pointer tw:select-none tw:w-[calc(100%-0.5rem)]',
              isManageActive
                ? (isDark
                    ? 'tw:text-tabs-active-text tw:bg-tabs-active-bg tw:shadow-sm tw:border-l-2 tw:border-primary-400'
                    : 'tw:text-primary-700 tw:bg-surface-base tw:shadow-sm tw:border-l-2 tw:border-primary-600')
                : 'tw:text-tabs-inactive-text tw:border-l-2 tw:border-transparent tw:hover:bg-tabs-hover-bg',
            ]"
          >
            <div
              class="tw:relative tw:inline-flex tw:items-center tw:justify-center tw:rounded-lg tw:p-0.5 tw:transition-colors tw:duration-250"
              :class="isManageActive
                ? (isDark ? 'tw:text-tabs-active-text!' : 'tw:text-primary-700!')
                : 'tw:text-tabs-inactive-text tw:group-hover:text-primary-600'"
            >
              <OIcon name="settings" size="md" />
              <span class="tw:absolute tw:-right-1 tw:top-0 tw:text-[9px] tw:leading-none tw:opacity-50">›</span>
            </div>
            <div
              class="tw:text-[10.5px] tw:font-medium tw:tracking-[0.01em] tw:transition-colors tw:duration-250 tw:w-full tw:text-center tw:leading-tight"
              :class="isManageActive
                ? (isDark ? 'tw:font-semibold tw:text-tabs-active-text!' : 'tw:font-semibold tw:text-primary-600!')
                : 'tw:text-tabs-inactive-text tw:group-hover:text-primary-600'"
            >{{ t('menu.manage') }}</div>
          </div>
        </template>
        <div class="tw:min-w-[180px]">
          <div class="tw:px-3 tw:py-1.5 tw:text-[9px] tw:font-semibold tw:uppercase tw:tracking-widest tw:text-text-tertiary">
            {{ t('menu.manage') }}
          </div>
          <router-link
            v-for="link in manageLinks"
            :key="link.name"
            :data-test="`menu-link-${link.link}-item`"
            :to="{
              path: link.link,
              query: { org_identifier: store?.state?.selectedOrganization?.identifier },
            }"
            class="tw:flex tw:items-center tw:gap-2.5 tw:px-3 tw:py-2 tw:mx-1 tw:rounded-md tw:text-[11px] tw:font-medium tw:text-tabs-inactive-text tw:[text-decoration:none]! tw:transition-colors tw:duration-150 tw:hover:bg-tabs-hover-bg tw:hover:text-primary-600"
            :class="isLinkActive(link.link)
              ? (isDark ? 'tw:bg-tabs-active-bg tw:text-tabs-active-text' : 'tw:bg-surface-base tw:text-primary-700')
              : ''"
          >
            <OIcon :name="link.icon" size="sm" class="tw:shrink-0 tw:opacity-75" />
            <span>{{ link.title }}</span>
          </router-link>
        </div>
      </ODropdown>
    </div>

    <!-- Bottom utility strip -->
    <div class="tw:flex tw:flex-col tw:border-t tw:border-[var(--o2-border-color)] tw:py-1 tw:shrink-0">
      <!-- AI Chat toggle (enterprise) -->
      <template v-if="config?.isEnterprise == 'true' && store?.state?.zoConfig?.ai_enabled">
        <button
          type="button"
          :class="[
            'tw:group tw:flex tw:flex-col tw:items-center tw:gap-0.5 tw:mx-1 tw:py-1 tw:rounded-lg tw:transition-colors tw:duration-150 tw:cursor-pointer tw:bg-transparent tw:border-0 tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500',
            store?.state?.isAiChatEnabled ? 'tw:bg-tabs-active-bg' : 'tw:hover:bg-tabs-hover-bg',
          ]"
          data-test="menu-link-ai-item"
          :title="t('menu.aiAssistant')"
          @click="emit('toggleAIChat')"
          @mouseenter="emit('update:is-hovered', true)"
          @mouseleave="emit('update:is-hovered', false)"
        >
          <img :src="getBtnLogo" class="tw:w-5 tw:h-5 tw:shrink-0" />
        </button>
      </template>

      <!-- Theme switcher -->
      <div class="tw:flex tw:justify-center tw:mx-1 tw:py-0.5">
        <ThemeSwitcher />
      </div>

      <!-- Slack -->
      <button
        type="button"
        class="tw:group tw:flex tw:flex-col tw:items-center tw:gap-0.5 tw:mx-1 tw:py-1 tw:rounded-lg tw:transition-colors tw:duration-150 tw:cursor-pointer tw:bg-transparent tw:border-0 tw:outline-none tw:hover:bg-tabs-hover-bg tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500"
        data-test="menu-link-slack-item"
        :title="t('menu.slack')"
        @click="emit('open-slack')"
      >
        <component :is="slackIcon" class="tw:size-4 tw:shrink-0 tw:text-tabs-inactive-text tw:group-hover:text-primary-600" />
      </button>

      <!-- Help dropdown -->
      <ODropdown side="right" align="end">
        <template #trigger>
          <button
            type="button"
            class="tw:group tw:flex tw:flex-col tw:items-center tw:gap-0.5 tw:mx-1 tw:py-1 tw:rounded-lg tw:transition-colors tw:duration-150 tw:cursor-pointer tw:bg-transparent tw:border-0 tw:outline-none tw:w-[calc(100%-0.5rem)] tw:hover:bg-tabs-hover-bg tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500"
            data-test="menu-link-help-item"
            :title="t('menu.help')"
          >
            <OIcon name="help-outline" size="sm" class="tw:text-tabs-inactive-text tw:group-hover:text-primary-600" />
          </button>
        </template>
        <div class="tw:min-w-[200px]">
          <template v-if="config?.isCloud !== 'true' && !store?.state?.zoConfig?.custom_hide_menus?.split(',')?.includes('openapi')">
            <ODropdownItem data-test="menu-link-openapi-item" @select="emit('navigateToOpenAPI', zoBackendUrl || '')">
              {{ t('menu.openapi') }}
            </ODropdownItem>
            <ODropdownSeparator />
          </template>
          <ODropdownItem data-test="menu-link-docs-item" @select="emit('navigate-to-docs')">
            {{ t('menu.docs') }}
          </ODropdownItem>
          <ODropdownSeparator />
          <ODropdownItem data-test="menu-link-about-item" @select="emit('go-to-about')">
            {{ t('menu.about') }}
          </ODropdownItem>
        </div>
      </ODropdown>
    </div>

    <!-- User avatar — very bottom -->
    <ODropdown
      side="right"
      align="end"
      @update:open="(open: boolean) => { if (!open) showLanguageSubmenu = false; }"
    >
      <template #trigger>
        <button
          type="button"
          class="tw:group tw:flex tw:items-center tw:justify-center tw:w-full tw:py-2 tw:px-1 tw:border-t tw:border-[var(--o2-border-color)] tw:cursor-pointer tw:bg-transparent tw:border-x-0 tw:border-b-0 tw:outline-none tw:hover:bg-tabs-hover-bg tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500 tw:shrink-0"
          data-test="header-my-account-profile-icon"
          :title="user?.given_name ? user.given_name + ' ' + user.family_name : user?.email"
        >
          <div class="tw:w-7 tw:h-7 tw:rounded-full tw:bg-primary-600 tw:flex tw:items-center tw:justify-center tw:text-white tw:text-[10px] tw:font-semibold tw:shrink-0">
            {{ userInitials }}
          </div>
        </button>
      </template>
      <div class="tw:min-w-[220px]">
        <div class="tw:flex tw:items-center tw:gap-3 tw:px-3 tw:py-2">
          <OIcon :name="user?.picture ? user.picture : 'person'" size="xs" />
          <span class="tw:text-sm tw:truncate">{{ user?.given_name ? user.given_name + ' ' + user.family_name : user?.email }}</span>
        </div>
        <ODropdownSeparator />

        <!-- Language selector -->
        <div
          data-test="header-language-submenu-trigger"
          class="header-language-item"
          @click.stop="showLanguageSubmenu = !showLanguageSubmenu"
        >
          <OIcon size="xs" name="language" class="padding-none" />
          <span class="header-language-label">{{ t('menu.language') }}</span>
          <span class="header-language-current">
            <img
              v-if="selectedLanguage?.icon && selectedLanguage.icon.startsWith('img:')"
              :src="selectedLanguage.icon.slice(4)"
              :alt="selectedLanguage.label"
              class="header-language-flag"
            />
            <OIcon v-else-if="selectedLanguage?.icon" size="xs" :name="selectedLanguage.icon" class="padding-none" />
            <span>{{ selectedLanguage?.label }}</span>
          </span>
          <OIcon size="xs" name="chevron-right" />
          <div
            v-if="showLanguageSubmenu"
            class="language-submenu"
            data-test="language-dropdown-item"
            @click.stop
          >
            <button
              v-for="lang in langList"
              :key="lang.code"
              type="button"
              :data-test="`language-dropdown-item-${lang.code}`"
              class="language-submenu-item"
              :class="{ 'is-selected': selectedLanguage?.code === lang.code }"
              @click="emit('change-language', lang); showLanguageSubmenu = false"
            >
              <img v-if="lang.icon && lang.icon.startsWith('img:')" :src="lang.icon.slice(4)" :alt="lang.label" class="header-language-flag" />
              <OIcon v-else-if="lang.icon" size="xs" :name="lang.icon" />
              <span class="tw:flex-1">{{ lang.label }}</span>
              <OIcon v-if="selectedLanguage?.code === lang.code" size="xs" name="check" />
            </button>
          </div>
        </div>
        <ODropdownSeparator />

        <ODropdownItem @select="emit('open-predefined-themes')">
          {{ t('menu.theme') }}
        </ODropdownItem>
        <ODropdownSeparator />
        <ODropdownItem data-test="header-logout-btn" @select="emit('signout')">
          {{ t('menu.logout') }}
        </ODropdownItem>
      </div>
    </ODropdown>
  </nav>
</template>

<script setup lang="ts">
import { ref, computed } from "vue"; // computed used by isManageActive, isDark, logoSrc, userInitials
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import type { NavbarProps, NavbarEmits, NavbarSlots } from "./ONavbar.types";
import MenuLink from "@/components/MenuLink.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OrganizationSelector from "@/components/OrganizationSelector.vue";
import ThemeSwitcher from "@/components/ThemeSwitcher.vue";
import { getImageURL } from "@/utils/zincutils";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<NavbarProps>(), {
  miniMode: false,
  visible: true,
  manageLinks: () => [],
});

const emit = defineEmits<NavbarEmits>();
defineSlots<NavbarSlots>();

const { t } = useI18n();
const router = useRouter();


// Language submenu
const showLanguageSubmenu = ref(false);

// Active state helpers
function isLinkActive(link: string): boolean {
  const route = router.currentRoute.value;
  return route.path.indexOf(link) === 0;
}

const isManageActive = computed(() =>
  (props.manageLinks ?? []).some((l) => isLinkActive(l.link))
);


const isDark = computed(() => props.store?.state?.theme === "dark");

// Logo src — respects enterprise custom logos
const logoSrc = computed(() => {
  const dark = props.store?.state?.theme === "dark";
  if (props.config?.isEnterprise === "true") {
    if (dark && props.store?.state?.zoConfig?.custom_logo_dark_img)
      return `data:image; base64, ${props.store.state.zoConfig.custom_logo_dark_img}`;
    if (!dark && props.store?.state?.zoConfig?.custom_logo_img)
      return `data:image; base64, ${props.store.state.zoConfig.custom_logo_img}`;
  }
  return getImageURL(dark
    ? "images/common/openobserve_latest_dark_2.svg"
    : "images/common/openobserve_latest_light_2.svg"
  );
});

// User initials for avatar
const userInitials = computed(() => {
  const u = props.user;
  if (!u) return "?";
  if (u.given_name && u.family_name) return (u.given_name[0] + u.family_name[0]).toUpperCase();
  if (u.given_name) return u.given_name[0].toUpperCase();
  if (u.email) return u.email[0].toUpperCase();
  return "?";
});

// Org selection — forward both events MainLayout needs
function handleOrgSelection(org: any) {
  emit("update:selected-org", org);
  emit("update-organization");
}

// Keyboard navigation (unchanged from original)
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
      const next = currentIndex < 0 || currentIndex + 1 >= menuLinks.length ? 0 : currentIndex + 1;
      menuLinks[next]?.focus();
      break;
    }
    case "ArrowUp": {
      event.preventDefault();
      const prev = currentIndex < 0 || currentIndex - 1 < 0 ? menuLinks.length - 1 : currentIndex - 1;
      menuLinks[prev]?.focus();
      break;
    }
    case "Tab": {
      event.preventDefault();
      const target = event.shiftKey
        ? document.querySelector<HTMLElement>('[data-o2-navbar] button:first-of-type')
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
/* Scrollbar on the inner nav items area only — outer nav is overflow:visible for flyout */
.nav-scroll {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  transition: scrollbar-color 150ms ease;
}
.nav-scroll:hover {
  scrollbar-color: var(--color-border-soft, rgba(148, 163, 184, 0.5)) transparent;
}
.nav-scroll::-webkit-scrollbar { width: 4px; }
.nav-scroll::-webkit-scrollbar-track { background: transparent; }
.nav-scroll::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: 9999px;
  transition: background-color 150ms ease;
}
.nav-scroll:hover::-webkit-scrollbar-thumb {
  background-color: var(--color-border-soft, rgba(148, 163, 184, 0.5));
}

:global(.body--dark) .o2-navbar-scroll {
  border-right: 1px solid var(--o2-border-color);
}

</style>
