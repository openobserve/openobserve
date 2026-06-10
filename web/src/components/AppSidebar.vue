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
  <aside
    class="app-sidebar"
    :class="{
      'app-sidebar--collapsed': collapsed,
      'app-sidebar--context-ready': showContextDetails,
    }"
    data-test="app-sidebar"
    @transitionend="handleSidebarTransitionEnd"
  >
    <div class="app-sidebar__brand">
      <button
        type="button"
        class="app-sidebar__brand-control"
        :class="{ 'app-sidebar__brand-control--collapsed': collapsed }"
        data-test="app-sidebar-brand-home"
        aria-label="OpenObserve home"
        @click="goToHome"
      >
        <template v-if="!collapsed">
          <template v-if="hasCustomBrand">
            <span v-if="customLogoText" class="app-sidebar__custom-logo-text">
              {{ customLogoText }}
            </span>
            <img
              v-if="customLogoSrc"
              :src="customLogoSrc"
              class="app-sidebar__custom-logo-img"
              alt=""
            />
            <img
              v-if="showOpenObserveLogo"
              :src="openObserveLogo"
              class="app-sidebar__logo"
              alt="OpenObserve"
            />
          </template>
          <img
            v-else
            :src="openObserveLogo"
            class="app-sidebar__logo"
            alt="OpenObserve"
          />
        </template>
        <template v-else>
          <img
            v-if="collapsedBrandSrc"
            :src="collapsedBrandSrc"
            class="app-sidebar__mark-img"
            alt=""
          />
          <span v-else class="app-sidebar__mark-text">{{ brandInitial }}</span>
        </template>
        <span
          class="app-sidebar__brand-edition"
          :class="{ 'app-sidebar__brand-edition--collapsed': collapsed }"
          :title="enterpriseButtonText"
          aria-hidden="true"
        >
          {{ collapsed ? editionShort : editionBadgeText }}
        </span>
      </button>

      <OButton
        class="app-sidebar__collapse-button"
        variant="ghost-muted"
        size="icon-toolbar"
        data-test="app-sidebar-collapse-btn"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggleCollapsed"
      >
        <OIcon
          :name="
            collapsed
              ? 'keyboard-double-arrow-right'
              : 'keyboard-double-arrow-left'
          "
          size="xs"
        />
        <OTooltip
          :content="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          :side="collapsed ? 'right' : 'bottom'"
        />
      </OButton>
    </div>

    <div class="app-sidebar__context">
      <ODropdown
        v-model:open="orgMenuOpen"
        side="right"
        align="start"
        :side-offset="collapsed ? 12 : 8"
      >
        <template #trigger>
          <button
            type="button"
            class="app-sidebar__org"
            :class="{ 'app-sidebar__org--collapsed': collapsed }"
            data-test="navbar-organizations-select-trigger"
            :aria-label="orgAriaLabel"
            :title="collapsed ? orgAriaLabel : undefined"
          >
            <span class="app-sidebar__org-avatar" aria-hidden="true">
              {{ orgInitials }}
              <span
                v-if="hasWarnings"
                class="app-sidebar__warning-dot"
                aria-hidden="true"
              />
            </span>
            <span class="app-sidebar__org-copy" :aria-hidden="collapsed">
              <span class="app-sidebar__org-name">{{ orgName }}</span>
              <span class="app-sidebar__org-id">{{ orgIdentifier }}</span>
            </span>
            <OIcon
              name="chevron-right"
              size="sm"
              class="app-sidebar__org-chevron"
              aria-hidden="true"
            />
            <OTooltip v-if="collapsed" side="right" :content="orgAriaLabel" />
          </button>
        </template>

        <div data-test="organization-menu-list" class="app-sidebar__org-menu">
          <OTable
            data-test="organization-menu-table"
            :data="filteredOrganizations"
            row-key="identifier"
            :columns="orgColumns"
            :show-header="false"
            :show-global-filter="false"
            pagination="client"
            :page-size="rowsPerPage"
            :page-size-options="[]"
            class="org-table"
            row-class="tw:cursor-pointer"
            style="width: 470px; min-height: 420px; height: 420px"
            @row-click="handleOrgSelection"
          >
            <template #top>
              <div class="tw:w-full">
                <OSearchInput
                  data-test="organization-search-input"
                  v-model="searchQuery"
                  clearable
                  :debounce="1"
                  autofocus
                  placeholder="Search Organization"
                />
              </div>
            </template>

            <template #cell-label="{ row, value }">
              <div
                class="org-menu-item"
                data-test="organization-menu-item-label-item-label"
                :data-test-org-identifier="row.identifier"
                :class="{
                  'org-menu-item--active':
                    row.identifier === userClickedOrg?.identifier,
                }"
              >
                {{
                  value.length > 30
                    ? value.substring(0, 30) + "... | " + row.identifier
                    : value + " | " + row.identifier
                }}
                <OTooltip
                  v-if="value.length > 30"
                  side="bottom"
                  align="start"
                  :content="value"
                />
              </div>
            </template>

            <template #empty>
              <div
                data-test="organization-menu-no-data"
                class="tw:text-center tw:p-2 tw:w-full tw:flex tw:justify-center"
              >
                No organizations found
              </div>
            </template>

            <template #bottom>
              <div v-if="!isPaidEdition" class="app-sidebar__org-menu-footer">
                <span>{{ enterpriseButtonText }}</span>
                <OButton
                  variant="ghost-primary"
                  size="xs"
                  @click="openEnterpriseDialog"
                >
                  Get Enterprise
                </OButton>
              </div>
            </template>
          </OTable>
        </div>
      </ODropdown>

      <div v-if="quotaWarning" class="app-sidebar__warning-row">
        <OIcon name="warning" size="xs" />
        <span v-if="!collapsed">{{ quotaWarning }}</span>
        <OTooltip v-if="collapsed" side="right" :content="quotaWarning" />
      </div>

      <div v-if="ingestionQuotaWarning" class="app-sidebar__warning-row">
        <OIcon
          name="warning"
          size="xs"
          :style="{ color: ingestionQuotaColor }"
        />
        <span v-if="!collapsed">
          {{ ingestionQuotaWarning }}
        </span>
        <OTooltip
          v-if="collapsed"
          side="right"
          :content="ingestionQuotaWarning"
        />
      </div>

      <button
        v-if="showAiButton"
        type="button"
        class="app-sidebar__ai"
        :class="{
          'app-sidebar__ai--active': store.state.isAiChatEnabled,
          'app-sidebar__ai--collapsed': collapsed,
        }"
        data-test="menu-link-ai-item"
        :aria-label="aiAriaLabel"
        @click="toggleAIChat"
      >
        <img :src="sidebarAiLogo" class="app-sidebar__ai-icon ai-icon" alt="" />
        <span class="app-sidebar__ai-label" :aria-hidden="collapsed">
          Ask O2 AI
        </span>
        <span
          v-if="store.state.isAiChatEnabled"
          class="app-sidebar__active-indicator"
        />
        <OTooltip v-if="collapsed" side="right" content="Ask O2 AI" />
      </button>
    </div>

    <nav
      ref="navRef"
      class="app-sidebar__nav"
      role="navigation"
      aria-label="Main navigation"
      data-test="navbar-main-nav"
      @keydown="handleNavKeydown"
      @scroll="handleSidebarNavScroll"
    >
      <span
        class="app-sidebar__nav-active-indicator"
        :class="{
          'app-sidebar__nav-active-indicator--ready':
            activeNavIndicatorReady,
        }"
        :style="activeNavIndicatorStyle"
        aria-hidden="true"
      />

      <template v-for="nav in visibleLinks" :key="nav.name || nav.title">
        <a
          v-if="nav.external"
          href="#"
          :target="nav.target || '_blank'"
          data-sidebar-nav-link
          :data-test="`menu-link-${nav.link}-item`"
          class="app-sidebar__nav-link"
          :class="{
            'app-sidebar__nav-link--collapsed': collapsed,
            'app-sidebar__nav-link--active': isNavActive(nav),
          }"
          :aria-current="isNavActive(nav) ? 'page' : undefined"
          :aria-label="getNavAriaLabel(nav)"
          @click.prevent="
            closeSidebarPopovers();
            openWebPage(nav.link);
          "
          @mouseenter="emit('menu-hover', nav.link)"
        >
          <span class="app-sidebar__nav-icon">
            <OIcon v-if="nav.icon" :name="nav.icon" size="md" />
            <component
              v-else-if="nav.iconComponent"
              :is="nav.iconComponent"
              class="app-sidebar__custom-icon"
            />
            <span
              v-if="nav.badge && nav.badge > 0"
              class="app-sidebar__badge"
              aria-live="polite"
              :aria-label="`${nav.badge} notifications`"
            >
              {{ nav.badge > 99 ? "99+" : nav.badge }}
            </span>
          </span>
          <span v-if="!collapsed" class="app-sidebar__nav-label">
            {{ nav.title }}
          </span>
          <OTooltip v-if="collapsed" side="right" :content="nav.title" />
        </a>

        <router-link
          v-else
          :to="{
            path: nav.link,
            query: {
              org_identifier: store.state.selectedOrganization?.identifier,
            },
          }"
          data-sidebar-nav-link
          :data-test="`menu-link-${nav.link}-item`"
          class="app-sidebar__nav-link"
          :class="{
            'app-sidebar__nav-link--collapsed': collapsed,
            'app-sidebar__nav-link--active': isNavActive(nav),
          }"
          :aria-current="isNavActive(nav) ? 'page' : undefined"
          :aria-label="getNavAriaLabel(nav)"
          @click="closeSidebarPopovers"
          @mouseenter="emit('menu-hover', nav.link)"
        >
          <span class="app-sidebar__nav-icon">
            <OIcon v-if="nav.icon" :name="nav.icon" size="md" />
            <component
              v-else-if="nav.iconComponent"
              :is="nav.iconComponent"
              class="app-sidebar__custom-icon"
            />
            <span
              v-if="nav.badge && nav.badge > 0"
              class="app-sidebar__badge"
              aria-live="polite"
              :aria-label="`${nav.badge} notifications`"
            >
              {{ nav.badge > 99 ? "99+" : nav.badge }}
            </span>
          </span>
          <span v-if="!collapsed" class="app-sidebar__nav-label">
            {{ nav.title }}
          </span>
          <OTooltip v-if="collapsed" side="right" :content="nav.title" />
        </router-link>
      </template>
    </nav>

    <div class="app-sidebar__utilities">
      <button
        type="button"
        class="app-sidebar__utility"
        :class="{ 'app-sidebar__utility--collapsed': collapsed }"
        data-test="navbar-theme-toggle-btn"
        :aria-label="themeToggleLabel"
        @click="toggleTheme"
      >
        <span class="app-sidebar__utility-icon">
          <OIcon
            :name="store.state.theme === 'dark' ? 'light-mode' : 'dark-mode'"
            size="md"
          />
        </span>
        <span v-if="!collapsed" class="app-sidebar__utility-label">
          {{ themeModeLabel }}
        </span>
        <OTooltip v-if="collapsed" side="right" :content="themeToggleLabel" />
      </button>

      <button
        type="button"
        class="app-sidebar__utility"
        :class="{ 'app-sidebar__utility--collapsed': collapsed }"
        data-test="menu-link-slack-item"
        :aria-label="t('menu.slack')"
        @click="openSlack"
      >
        <span class="app-sidebar__utility-icon">
          <component :is="slackIcon" class="app-sidebar__slack-icon" />
        </span>
        <span v-if="!collapsed" class="app-sidebar__utility-label">
          {{ t("menu.slack") }}
        </span>
        <OTooltip v-if="collapsed" side="right" :content="t('menu.slack')" />
      </button>

      <ODropdown side="right" align="end" :side-offset="10">
        <template #trigger>
          <button
            type="button"
            class="app-sidebar__utility"
            :class="{ 'app-sidebar__utility--collapsed': collapsed }"
            data-test="menu-link-help-item"
            :aria-label="t('menu.help')"
          >
            <span class="app-sidebar__utility-icon">
              <OIcon name="help-outline" size="md" />
            </span>
            <span v-if="!collapsed" class="app-sidebar__utility-label">
              {{ t("menu.help") }}
            </span>
            <OTooltip v-if="collapsed" side="right" :content="t('menu.help')" />
          </button>
        </template>
        <div class="app-sidebar__menu">
          <template
            v-if="
              config.isCloud !== 'true' &&
              !store.state.zoConfig?.custom_hide_menus
                ?.split(',')
                ?.includes('openapi')
            "
          >
            <ODropdownItem
              data-test="menu-link-openapi-item"
              @select="navigateToOpenAPI(zoBackendUrl)"
            >
              {{ t("menu.openapi") }}
            </ODropdownItem>
            <ODropdownSeparator />
          </template>
          <ODropdownItem
            data-test="menu-link-docs-item"
            @select="navigateToDocs"
          >
            {{ t("menu.docs") }}
          </ODropdownItem>
          <ODropdownSeparator />
          <ODropdownItem data-test="menu-link-about-item" @select="goToAbout">
            {{ t("menu.about") }}
          </ODropdownItem>
        </div>
      </ODropdown>

      <ODropdown
        side="right"
        align="end"
        :side-offset="10"
        @update:open="
          (open) => {
            if (!open) showLanguageSubmenu = false;
          }
        "
      >
        <template #trigger>
          <button
            type="button"
            class="app-sidebar__account"
            :class="{ 'app-sidebar__account--collapsed': collapsed }"
            data-test="header-my-account-profile-icon"
            :aria-label="userDisplayName"
          >
            <span class="app-sidebar__account-avatar">
              <OIcon :name="user.picture ? user.picture : 'person'" size="sm" />
            </span>
            <span v-if="!collapsed" class="app-sidebar__account-copy">
              <span class="app-sidebar__account-name">{{
                userDisplayName
              }}</span>
              <span class="app-sidebar__account-email">{{ user.email }}</span>
            </span>
            <OTooltip
              v-if="collapsed"
              side="right"
              :content="userDisplayName"
            />
          </button>
        </template>
        <div class="app-sidebar__menu app-sidebar__account-menu">
          <div class="app-sidebar__menu-user">
            <OIcon :name="user.picture ? user.picture : 'person'" size="xs" />
            <span>{{ userDisplayName }}</span>
          </div>
          <ODropdownSeparator />
          <div
            data-test="header-language-submenu-trigger"
            class="app-sidebar__language-item"
            @click.stop="showLanguageSubmenu = !showLanguageSubmenu"
          >
            <OIcon size="xs" name="language" />
            <span class="app-sidebar__language-label">{{
              t("menu.language")
            }}</span>
            <span class="app-sidebar__language-current">
              {{ selectedLanguage.label }}
            </span>
            <OIcon size="xs" name="chevron-right" />

            <div
              v-if="showLanguageSubmenu"
              class="app-sidebar__language-submenu"
              data-test="language-dropdown-item"
              @click.stop
            >
              <button
                v-for="lang in langList"
                :key="lang.code"
                type="button"
                :data-test="`language-dropdown-item-${lang.code}`"
                class="app-sidebar__language-submenu-item"
                :class="{
                  'is-selected': selectedLanguage.code === lang.code,
                }"
                @click="
                  changeLanguage(lang);
                  showLanguageSubmenu = false;
                "
              >
                <span>{{ lang.label }}</span>
                <OIcon
                  v-if="selectedLanguage.code === lang.code"
                  size="xs"
                  name="check"
                />
              </button>
            </div>
          </div>
          <ODropdownSeparator />
          <ODropdownItem
            data-test="menu-link-logout-item"
            variant="destructive"
            @select="signout"
          >
            <template #icon-left>
              <OIcon size="xs" name="exit-to-app" />
            </template>
            {{ t("menu.signOut") }}
          </ODropdownItem>
        </div>
      </ODropdown>
    </div>

    <EnterpriseUpgradeDialog v-model="showEnterpriseDialog" />
  </aside>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import EnterpriseUpgradeDialog from "@/components/EnterpriseUpgradeDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import { getImageURL } from "@/utils/zincutils";

type SidebarNavLink = {
  title: string;
  icon?: string;
  iconComponent?: unknown;
  link: string;
  exact?: boolean;
  name?: string;
  display?: boolean;
  hide?: boolean;
  external?: boolean;
  target?: string;
  badge?: number;
};

const props = defineProps<{
  store: any;
  router: any;
  config: any;
  user: any;
  slackIcon: any;
  zoBackendUrl: string;
  langList: any[];
  selectedLanguage: any;
  selectedOrg: any;
  userClickedOrg: any;
  organizations: any[];
  linksList: SidebarNavLink[];
  isHovered: boolean;
  getBtnLogo: string;
  collapsed: boolean;
}>();

const emit = defineEmits<{
  (e: "update:selectedOrg", value: any): void;
  (e: "update:isHovered", value: boolean): void;
  (e: "update:collapsed", value: boolean): void;
  (e: "updateOrganization"): void;
  (e: "goToHome"): void;
  (e: "goToAbout"): void;
  (e: "toggleAIChat"): void;
  (e: "openSlack"): void;
  (e: "navigateToOpenAPI", value: string): void;
  (e: "navigateToDocs"): void;
  (e: "changeLanguage", value: any): void;
  (e: "signout"): void;
  (e: "menu-hover", value: string): void;
}>();

const { t } = useI18n();

const searchQuery = ref("");
const rowsPerPage = 10;
const orgMenuOpen = ref(false);
const showEnterpriseDialog = ref(false);
const showLanguageSubmenu = ref(false);
const navRef = ref<HTMLElement | null>(null);
const sidebarScrollTick = ref(0);
const showContextDetails = ref(!props.collapsed);
const activeNavIndicatorStyle = ref<Record<string, string>>({
  opacity: "0",
});
const activeNavIndicatorReady = ref(false);
const NAV_BAR_MIN = 20;
const NAV_BAR_MAX = 34;
let contextDetailsTimer: ReturnType<typeof setTimeout> | null = null;

provide("sidebarScrollTick", sidebarScrollTick);

const orgColumns = [
  {
    id: "label",
    header: "Organization",
    accessorKey: "label",
    meta: { align: "left" },
  },
];

watch(orgMenuOpen, async (isOpen) => {
  if (isOpen) {
    await nextTick();
    const input = document.querySelector(
      '[data-test="organization-search-input"] input',
    ) as HTMLInputElement | null;
    input?.focus();
  }
});

const editionKind = computed<"cloud" | "enterprise" | "opensource">(() => {
  const buildType = props.store.state.zoConfig?.build_type;

  if (props.config.isCloud === "true" || buildType === "cloud") {
    return "cloud";
  }

  if (buildType === "enterprise") {
    return "enterprise";
  }

  if (buildType === "opensource") {
    return "opensource";
  }

  return props.config.isEnterprise === "true" ? "enterprise" : "opensource";
});

const isEnterpriseEdition = computed(() => editionKind.value === "enterprise");
const isPaidEdition = computed(() => editionKind.value !== "opensource");

const enterpriseButtonText = computed(() => {
  if (editionKind.value === "cloud") {
    return t("about.header_button.cloud_features");
  }

  if (isEnterpriseEdition.value) {
    return t("about.header_button.enterprise_edition");
  }

  return t("about.header_button.get_enterprise_free");
});

const editionShort = computed(() => {
  if (editionKind.value === "cloud") return "CLD";
  if (isEnterpriseEdition.value) return "ENT";
  return "OSS";
});

const editionBadgeText = computed(() => {
  if (editionKind.value === "cloud") return "Cloud";
  if (isEnterpriseEdition.value) return "Enterprise";
  return "OSS";
});

const orgName = computed(
  () =>
    props.userClickedOrg?.label ||
    props.selectedOrg?.label ||
    props.store.state.selectedOrganization?.label ||
    "Organization",
);

const orgIdentifier = computed(
  () =>
    props.userClickedOrg?.identifier ||
    props.selectedOrg?.identifier ||
    props.store.state.selectedOrganization?.identifier ||
    "",
);

const orgInitials = computed(() => {
  const text = orgName.value || orgIdentifier.value || "O";
  return text
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase())
    .join("");
});

const orgAriaLabel = computed(() => {
  const pieces = [`Organization: ${orgName.value}`, orgIdentifier.value];

  if (quotaWarning.value) pieces.push(quotaWarning.value);
  if (ingestionQuotaWarning.value) pieces.push(ingestionQuotaWarning.value);

  return pieces.filter(Boolean).join(", ");
});

const filteredOrganizations = computed(() => {
  if (!searchQuery.value) return props.organizations;
  const q = searchQuery.value.toLowerCase();
  return props.organizations.filter(
    (org: any) =>
      org.label?.toLowerCase().includes(q) ||
      org.identifier?.toLowerCase().includes(q),
  );
});

const quotaWarning = computed(
  () => props.store.state.organizationData?.quotaThresholdMsg || "",
);

const ingestionQuotaPercentage = computed(() => {
  return (
    Math.ceil((props.store.state.zoConfig?.ingestion_quota_used || 0) * 100) /
      100 || 0
  );
});

const ingestionQuotaWarning = computed(() => {
  if (
    !isEnterpriseEdition.value ||
    (props.store.state.zoConfig?.ingestion_quota_used || 0) < 85
  ) {
    return "";
  }

  return `Warning: ${ingestionQuotaPercentage.value}% of ingestion limit used`;
});

const ingestionQuotaColor = computed(() => {
  return (props.store.state.zoConfig?.ingestion_quota_used || 0) >= 95
    ? "var(--o2-status-error-text, #dc2626)"
    : "var(--o2-status-warning-text, #b45309)";
});

const hasWarnings = computed(
  () => Boolean(quotaWarning.value) || Boolean(ingestionQuotaWarning.value),
);

const showAiButton = computed(
  () => isEnterpriseEdition.value && props.store.state.zoConfig.ai_enabled,
);

const aiAriaLabel = computed(() =>
  props.store.state.isAiChatEnabled ? "Close O2 AI" : "Ask O2 AI",
);

const sidebarAiLogo = computed(() =>
  getImageURL("images/common/ai_icon_gradient.svg"),
);

const visibleLinks = computed(() =>
  props.linksList.filter(
    (link) => link.display !== false && link.hide !== true,
  ),
);

async function syncActiveNavIndicator() {
  await nextTick();

  const nav = navRef.value;
  const activeLink = nav?.querySelector<HTMLElement>(
    ".app-sidebar__nav-link--active",
  );

  if (!nav || !activeLink) {
    activeNavIndicatorStyle.value = { opacity: "0" };
    return;
  }

  const navRect = nav.getBoundingClientRect();
  const activeRect = activeLink.getBoundingClientRect();
  const fullHeight = activeLink.offsetHeight;
  const barHeight = Math.min(
    Math.max(Math.round(fullHeight * 0.6), NAV_BAR_MIN),
    NAV_BAR_MAX,
  );

  activeNavIndicatorStyle.value = {
    opacity: "1",
    height: `${barHeight}px`,
    transform: `translateY(${
      activeRect.top -
      navRect.top +
      nav.scrollTop +
      Math.round((fullHeight - barHeight) / 2)
    }px)`,
  };
}

watch(
  [
    () => props.router.currentRoute.value.path,
    () => props.collapsed,
    () => visibleLinks.value.length,
  ],
  ([, collapsed], [, previousCollapsed]) => {
    closeSidebarPopovers();
    if (collapsed !== previousCollapsed) {
      sidebarScrollTick.value++;
    }
    syncActiveNavIndicator();
  },
);

watch(
  () => props.collapsed,
  (collapsed) => {
    if (contextDetailsTimer) {
      clearTimeout(contextDetailsTimer);
      contextDetailsTimer = null;
    }

    if (collapsed) {
      showContextDetails.value = false;
      return;
    }

    contextDetailsTimer = setTimeout(() => {
      showContextDetails.value = true;
      contextDetailsTimer = null;
    }, 120);
  },
  { immediate: true },
);

watch(
  () => props.store.state.selectedOrganization?.identifier,
  () => {
    closeSidebarPopovers();
  },
);

onMounted(() => {
  syncActiveNavIndicator();
  requestAnimationFrame(() => {
    activeNavIndicatorReady.value = true;
  });
  window.addEventListener("resize", syncActiveNavIndicator);
});

onBeforeUnmount(() => {
  if (contextDetailsTimer) clearTimeout(contextDetailsTimer);
  window.removeEventListener("resize", syncActiveNavIndicator);
});

const userDisplayName = computed(() => {
  return props.user.given_name
    ? `${props.user.given_name} ${props.user.family_name || ""}`.trim()
    : props.user.email;
});

const customLogoText = computed(() => {
  return isEnterpriseEdition.value
    ? props.store.state.zoConfig?.custom_logo_text || ""
    : "";
});

const customLogoSrc = computed(() => {
  if (!isEnterpriseEdition.value) return "";
  const config = props.store.state.zoConfig || {};

  if (props.store.state.theme === "dark" && config.custom_logo_dark_img) {
    return `data:image; base64, ${config.custom_logo_dark_img}`;
  }

  if (props.store.state.theme === "light" && config.custom_logo_img) {
    return `data:image; base64, ${config.custom_logo_img}`;
  }

  if (config.custom_logo_dark_img) {
    return `data:image; base64, ${config.custom_logo_dark_img}`;
  }

  if (config.custom_logo_img) {
    return `data:image; base64, ${config.custom_logo_img}`;
  }

  return "";
});

const hasCustomBrand = computed(
  () => Boolean(customLogoText.value) || Boolean(customLogoSrc.value),
);

const showOpenObserveLogo = computed(() => {
  return props.store.state.zoConfig?.custom_hide_self_logo === false;
});

const openObserveLogo = computed(() =>
  getImageURL(
    props.store.state.theme === "dark"
      ? "images/common/openobserve_latest_dark_2.svg"
      : "images/common/openobserve_latest_light_2.svg",
  ),
);

const collapsedBrandSrc = computed(() => {
  if (customLogoSrc.value) return customLogoSrc.value;
  return getImageURL("images/common/openobserve_favicon.png");
});

const brandInitial = computed(() => {
  return (
    (customLogoText.value || "OpenObserve").trim()[0]?.toUpperCase() || "O"
  );
});

const themeToggleLabel = computed(() => {
  const nextMode =
    props.store.state.theme === "dark"
      ? t("common.lightMode")
      : t("common.darkMode");
  return `${t("common.switchTo")} ${nextMode}`;
});

const themeModeLabel = computed(() =>
  props.store.state.theme === "dark"
    ? t("common.lightMode")
    : t("common.darkMode"),
);

function toggleCollapsed() {
  emit("update:collapsed", !props.collapsed);
}

async function handleOrgSelection(org: any) {
  closeSidebarPopovers();
  await nextTick();
  emit("update:selectedOrg", org);
  await nextTick();
  emit("updateOrganization");
}

function openEnterpriseDialog() {
  showEnterpriseDialog.value = true;
}

function goToHome() {
  emit("goToHome");
}

function goToAbout() {
  emit("goToAbout");
}

function toggleAIChat() {
  emit("toggleAIChat");
}

function openSlack() {
  emit("openSlack");
}

function navigateToOpenAPI(url: string) {
  emit("navigateToOpenAPI", url);
}

function navigateToDocs() {
  emit("navigateToDocs");
}

function changeLanguage(lang: any) {
  emit("changeLanguage", lang);
}

function signout() {
  emit("signout");
}

function openWebPage(url: string) {
  window.open(url, "_blank");
}

function closeSidebarPopovers() {
  orgMenuOpen.value = false;
  searchQuery.value = "";
  showLanguageSubmenu.value = false;
}

function handleSidebarNavScroll() {
  sidebarScrollTick.value++;
  closeSidebarPopovers();
}

function handleSidebarTransitionEnd(event: TransitionEvent) {
  if (event.propertyName !== "width") return;
  syncActiveNavIndicator();
}

function isNavActive(nav: SidebarNavLink) {
  const route = props.router.currentRoute.value;

  if (nav.link === "/") {
    return route.name === "home" || route.path === "/" || route.path === "";
  }

  return route.path.indexOf(nav.link) === 0;
}

function getNavAriaLabel(nav: SidebarNavLink) {
  let label = nav.title || "Navigation link";

  if (nav.badge && nav.badge > 0) {
    label += ` (${nav.badge} notifications)`;
  }

  if (isNavActive(nav)) {
    label += " - Current page";
  }

  return label;
}

function handleNavKeydown(event: KeyboardEvent) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

  const nav = event.currentTarget as HTMLElement;
  const menuLinks = Array.from(
    nav.querySelectorAll<HTMLElement>("[data-sidebar-nav-link]"),
  );

  if (!menuLinks.length) return;

  event.preventDefault();
  const focusedEl = document.activeElement as HTMLElement;
  const currentIndex = menuLinks.indexOf(focusedEl);

  if (event.key === "ArrowDown") {
    const next =
      currentIndex < 0 || currentIndex + 1 >= menuLinks.length
        ? 0
        : currentIndex + 1;
    menuLinks[next]?.focus();
  } else {
    const prev =
      currentIndex < 0 || currentIndex - 1 < 0
        ? menuLinks.length - 1
        : currentIndex - 1;
    menuLinks[prev]?.focus();
  }
}

function toggleTheme() {
  const nextTheme = props.store.state.theme === "dark" ? "light" : "dark";

  try {
    localStorage.setItem("theme", nextTheme);
  } catch (error) {
    console.warn("localStorage not available for theme storage:", error);
  }

  document.documentElement.classList.toggle("dark", nextTheme === "dark");
  props.store.dispatch("appTheme", nextTheme);
}
</script>

<style scoped lang="scss">
.app-sidebar {
  --app-sidebar-panel: var(
    --color-surface-panel,
    var(--o2-card-bg-solid, #ffffff)
  );
  --app-sidebar-muted: var(--color-surface-base, rgba(148, 163, 184, 0.08));
  --app-sidebar-hover: var(--color-surface-hover, rgba(148, 163, 184, 0.14));
  --app-sidebar-border: var(
    --color-border-default,
    var(--o2-border-color, rgba(0, 0, 0, 0.12))
  );
  --app-sidebar-text: var(
    --color-text-primary,
    var(--o2-text-primary, #111827)
  );
  --app-sidebar-text-muted: var(
    --color-text-secondary,
    var(--o2-text-secondary, #64748b)
  );
  --app-sidebar-active-bg: var(
    --color-tabs-active-bg,
    var(--o2-tab-bg, rgba(63, 121, 148, 0.14))
  );
  --app-sidebar-active-text: var(
    --color-tabs-active-text,
    var(--o2-primary-btn-bg, #2563eb)
  );

  display: flex;
  width: 15.5rem;
  height: 100%;
  min-height: 0;
  flex: 0 0 auto;
  flex-direction: column;
  border: 1px solid var(--app-sidebar-border);
  border-radius: 0.875rem;
  background: var(--app-sidebar-panel);
  box-shadow:
    0 1px 3px rgba(16, 40, 55, 0.06),
    0 10px 28px rgba(16, 40, 55, 0.08);
  color: var(--app-sidebar-text);
  overflow: hidden;
  transition: width 300ms ease-out;
  z-index: 210;
}

.app-sidebar--collapsed {
  width: 4rem;
}

.app-sidebar__brand {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: "brand toggle";
  align-items: center;
  gap: 0.5rem;
  min-height: 3.5rem;
  overflow: visible;
  padding: 0.625rem 0.625rem 0.5rem 0.75rem;
  border-bottom: 1px solid var(--app-sidebar-border);
}

.app-sidebar--collapsed .app-sidebar__brand {
  grid-template-columns: 1fr;
  grid-template-areas:
    "brand"
    "toggle";
  gap: 0.375rem;
  justify-items: center;
  min-height: 5.25rem;
  padding: 0.625rem 0.5rem 0.5rem;
}

.app-sidebar__collapse-button {
  grid-area: toggle;
  z-index: 6;
  width: 1.375rem !important;
  height: 1.375rem !important;
  min-width: 1.375rem !important;
  min-height: 1.375rem !important;
  border: 1px solid var(--app-sidebar-border);
  border-radius: 0.375rem !important;
  background: var(--app-sidebar-panel);
  color: var(--app-sidebar-text-muted);
  box-shadow: 0 1px 3px rgba(16, 40, 55, 0.1);
}

.app-sidebar__collapse-button:hover,
.app-sidebar__collapse-button:focus-visible {
  background: var(--app-sidebar-hover);
  color: var(--app-sidebar-active-text);
}

.app-sidebar--collapsed .app-sidebar__collapse-button {
  width: 1.25rem !important;
  height: 1.25rem !important;
  min-width: 1.25rem !important;
  min-height: 1.25rem !important;
}

.app-sidebar__brand-control {
  position: relative;
  grid-area: brand;
  display: flex;
  width: 100%;
  min-width: 0;
  height: 2.25rem;
  align-items: center;
  gap: 0.5rem;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.app-sidebar__brand-control--collapsed {
  width: 2.25rem;
  height: 2.25rem;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
}

.app-sidebar__brand-control--collapsed:hover,
.app-sidebar__brand-control--collapsed:focus-visible {
  background: transparent;
}

.app-sidebar__logo {
  display: block;
  width: auto;
  max-width: 9.25rem;
  max-height: 2rem;
}

.app-sidebar__custom-logo-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1rem;
  font-weight: 700;
}

.app-sidebar__custom-logo-img {
  display: block;
  width: auto;
  max-width: 8.75rem;
  max-height: 2rem;
  object-fit: contain;
}

.app-sidebar__mark-img {
  width: 2rem;
  height: 2rem;
  object-fit: contain;
}

.app-sidebar__mark-text {
  font-size: 0.875rem;
  font-weight: 800;
}

.app-sidebar__brand-edition {
  display: inline-flex;
  max-width: 5.75rem;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex: 0 1 auto;
  padding: 0.125rem 0.4375rem;
  border: 1px solid
    color-mix(in srgb, var(--app-sidebar-active-text) 36%, transparent);
  border-radius: 999px;
  background: color-mix(
    in srgb,
    var(--app-sidebar-active-text) 10%,
    transparent
  );
  color: var(--app-sidebar-active-text);
  font-size: 0.625rem;
  font-weight: 800;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-sidebar__brand-edition--collapsed {
  position: absolute;
  right: -0.5rem;
  bottom: -0.4rem;
  min-width: 1.35rem;
  height: 0.825rem;
  padding: 0 0.1875rem;
  border: 2px solid var(--app-sidebar-panel);
  background: linear-gradient(135deg, #0f766e, #2563eb);
  color: #ffffff;
  font-size: 0.5rem;
  letter-spacing: 0;
}

.app-sidebar__context {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem;
  border-bottom: 1px solid var(--app-sidebar-border);
}

.app-sidebar--collapsed .app-sidebar__context {
  align-items: center;
  padding-inline: 0.5rem;
}

.app-sidebar__org {
  position: relative;
  display: grid;
  box-sizing: border-box;
  width: 100%;
  min-height: 3.625rem;
  grid-template-columns: 2.25rem minmax(0, 1fr) 1rem;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem;
  border: 1px solid var(--app-sidebar-border);
  border-radius: 0.5rem;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    width 240ms cubic-bezier(0.16, 1, 0.3, 1),
    min-height 240ms cubic-bezier(0.16, 1, 0.3, 1),
    padding 240ms cubic-bezier(0.16, 1, 0.3, 1),
    border-color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.app-sidebar__org:hover,
.app-sidebar__org:focus-visible,
.app-sidebar__utility:hover,
.app-sidebar__utility:focus-visible,
.app-sidebar__account:hover,
.app-sidebar__account:focus-visible,
.app-sidebar__nav-link:hover,
.app-sidebar__nav-link:focus-visible {
  outline: none;
  background: var(--app-sidebar-hover);
}

.app-sidebar__org--collapsed {
  width: 2.625rem;
  height: 2.625rem;
  min-height: 2.625rem;
  grid-template-columns: 1fr;
  justify-items: center;
  border-color: color-mix(in srgb, var(--app-sidebar-border) 65%, transparent);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--app-sidebar-muted) 38%, transparent);
  padding: 0;
  box-shadow: none;
}

.app-sidebar__org--collapsed:hover,
.app-sidebar__org--collapsed:focus-visible {
  background: var(--app-sidebar-hover);
}

.app-sidebar__org-avatar,
.app-sidebar__account-avatar {
  position: relative;
  display: inline-flex;
  width: 2.25rem;
  height: 2.25rem;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 0.5rem;
  background: linear-gradient(145deg, #0f766e, #2563eb);
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: 800;
  transition:
    transform 180ms ease,
    border-radius 180ms ease,
    box-shadow 180ms ease;
}

.app-sidebar__warning-dot {
  position: absolute;
  top: -0.25rem;
  right: -0.25rem;
  width: 0.625rem;
  height: 0.625rem;
  border: 2px solid var(--app-sidebar-panel);
  border-radius: 999px;
  background: var(--o2-status-warning-text, #b45309);
}

.app-sidebar__org-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.125rem;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
  transform: translateX(-0.25rem);
  transition:
    opacity 160ms ease,
    transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.app-sidebar--context-ready:not(.app-sidebar--collapsed) .app-sidebar__org-copy {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}

.app-sidebar__org-chevron {
  color: var(--app-sidebar-text-muted);
  opacity: 0;
  transform: translateX(-0.25rem);
  transition:
    opacity 160ms ease,
    transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.app-sidebar--context-ready:not(.app-sidebar--collapsed)
  .app-sidebar__org-chevron {
  opacity: 1;
  transform: translateX(0);
}

.app-sidebar__org--collapsed .app-sidebar__org-copy,
.app-sidebar__org--collapsed .app-sidebar__org-chevron {
  width: 0;
}

.app-sidebar__org-name,
.app-sidebar__account-name,
.app-sidebar__nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-sidebar__org-name {
  font-size: 0.875rem;
  font-weight: 700;
}

.app-sidebar__org-id,
.app-sidebar__account-email {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--app-sidebar-text-muted);
  font-size: 0.6875rem;
}

.app-sidebar__org-menu {
  padding: 0;
}

.app-sidebar__org-menu-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.25rem 0.25rem;
  color: var(--app-sidebar-text-muted);
  font-size: 0.75rem;
}

.app-sidebar__warning-row {
  display: flex;
  width: 100%;
  min-height: 1.875rem;
  align-items: center;
  gap: 0.5rem;
  overflow: hidden;
  border-radius: 0.375rem;
  background: var(--o2-status-warning-bg, #fef3c7);
  color: var(--o2-status-warning-text, #92400e);
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  line-height: 1.2;
}

.app-sidebar--collapsed .app-sidebar__warning-row {
  width: 2.25rem;
  justify-content: center;
  padding-inline: 0;
}

.app-sidebar__ai {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 2.5rem;
  align-items: center;
  gap: 0.625rem;
  border: 1px solid rgba(14, 165, 233, 0.24);
  border-radius: 0.5rem;
  background:
    linear-gradient(
      135deg,
      rgba(14, 165, 233, 0.14),
      rgba(168, 85, 247, 0.14) 52%,
      rgba(20, 184, 166, 0.12)
    ),
    var(--app-sidebar-panel);
  color: var(--app-sidebar-text);
  cursor: pointer;
  padding: 0.5rem 0.625rem;
  text-align: left;
  font-weight: 700;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  transition:
    width 240ms cubic-bezier(0.16, 1, 0.3, 1),
    min-height 240ms cubic-bezier(0.16, 1, 0.3, 1),
    padding 240ms cubic-bezier(0.16, 1, 0.3, 1),
    border-color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.app-sidebar__ai:hover,
.app-sidebar__ai:focus-visible {
  outline: none;
  border-color: rgba(168, 85, 247, 0.44);
  background:
    linear-gradient(
      135deg,
      rgba(14, 165, 233, 0.2),
      rgba(168, 85, 247, 0.2) 52%,
      rgba(20, 184, 166, 0.16)
    ),
    var(--app-sidebar-panel);
}

.app-sidebar__ai--collapsed {
  width: 2.5rem;
  min-height: 2.25rem;
  justify-content: center;
  padding-inline: 0;
}

.app-sidebar__ai--active {
  border-color: rgba(168, 85, 247, 0.54);
  background:
    linear-gradient(
      135deg,
      rgba(14, 165, 233, 0.24),
      rgba(168, 85, 247, 0.24) 52%,
      rgba(20, 184, 166, 0.18)
    ),
    var(--app-sidebar-active-bg);
  color: var(--app-sidebar-text);
}

.app-sidebar__ai-icon {
  width: 1.5rem;
  height: 1.5rem;
  flex: 0 0 auto;
  transition: transform 0.6s ease;
}

.app-sidebar__ai-label {
  min-width: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-0.25rem);
  transition:
    opacity 160ms ease,
    transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
  white-space: nowrap;
}

.app-sidebar--context-ready:not(.app-sidebar--collapsed)
  .app-sidebar__ai-label {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}

.app-sidebar--collapsed .app-sidebar__ai-label {
  width: 0;
}

.app-sidebar__ai:hover .app-sidebar__ai-icon,
.app-sidebar__ai:focus-visible .app-sidebar__ai-icon {
  transform: rotate(180deg);
}

.app-sidebar__active-indicator {
  position: absolute;
  left: -0.625rem;
  width: 0.1875rem;
  height: 1.375rem;
  border-radius: 999px;
  background: linear-gradient(180deg, #0ea5e9, #a855f7 55%, #14b8a6);
}

.app-sidebar__nav {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.125rem;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0.625rem;
}

.app-sidebar__nav-active-indicator {
  position: absolute;
  top: 0;
  left: 0.5rem;
  z-index: 2;
  width: 0.25rem;
  border-radius: 999px;
  background: var(--app-sidebar-active-text);
  opacity: 0;
  pointer-events: none;
}

.app-sidebar__nav-active-indicator--ready {
  transition:
    transform 300ms ease-out 70ms,
    height 300ms ease-out 70ms,
    opacity 120ms ease;
}

.app-sidebar--collapsed .app-sidebar__nav {
  align-items: center;
  padding-inline: 0.5rem;
}

.app-sidebar__nav-link {
  position: relative;
  z-index: 1;
  display: flex;
  width: 100%;
  min-height: 2.375rem;
  align-items: center;
  gap: 0.75rem;
  border-radius: 0.5rem;
  color: var(--app-sidebar-text-muted);
  padding: 0.5rem 0.625rem 0.5rem 0.875rem;
  text-decoration: none;
  transition:
    background-color 150ms ease,
    box-shadow 150ms ease,
    color 150ms ease;
}

.app-sidebar__nav-link--collapsed {
  width: 2.75rem;
  justify-content: center;
  padding-inline: 0;
}

.app-sidebar__nav-link--active {
  background: var(--color-surface-base, #ffffff);
  box-shadow:
    0 1px 2px rgba(16, 40, 55, 0.06),
    0 4px 12px rgba(16, 40, 55, 0.08);
  color: var(--app-sidebar-active-text);
  font-weight: 700;
}

.app-sidebar__nav-link--active:hover,
.app-sidebar__nav-link--active:focus-visible {
  background: var(--color-surface-base, #ffffff);
}

.app-sidebar__nav-icon {
  position: relative;
  display: inline-flex;
  width: 1.5rem;
  height: 1.5rem;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.app-sidebar__custom-icon,
.app-sidebar__slack-icon {
  width: 1.25rem;
  height: 1.25rem;
  opacity: 0.76;
}

.app-sidebar__badge {
  position: absolute;
  top: -0.35rem;
  right: -0.55rem;
  display: inline-flex;
  min-width: 1rem;
  height: 1rem;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--app-sidebar-panel);
  border-radius: 999px;
  background: #dc2626;
  color: #ffffff;
  font-size: 0.5625rem;
  font-weight: 800;
  line-height: 1;
}

.app-sidebar__utilities {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.625rem;
  border-top: 1px solid var(--app-sidebar-border);
}

.app-sidebar--collapsed .app-sidebar__utilities {
  align-items: center;
  padding-inline: 0.5rem;
}

.app-sidebar__utility,
.app-sidebar__account {
  display: flex;
  width: 100%;
  min-height: 2.25rem;
  align-items: center;
  gap: 0.75rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--app-sidebar-text-muted);
  cursor: pointer;
  padding: 0.375rem 0.625rem;
  text-align: left;
}

.app-sidebar__utility {
  height: 2.25rem;
  line-height: 1;
}

.app-sidebar__utility-icon {
  display: inline-flex;
  width: 1.5rem;
  height: 1.5rem;
  align-items: center;
  justify-content: center;
  flex: 0 0 1.5rem;
}

.app-sidebar__utility-label {
  min-width: 0;
  overflow: hidden;
  color: inherit;
  font-size: 0.8125rem;
  line-height: 1.25rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-sidebar__utility--collapsed,
.app-sidebar__account--collapsed {
  width: 2.75rem;
  justify-content: center;
  padding-inline: 0;
}

.app-sidebar__utility--collapsed {
  gap: 0;
}

.app-sidebar__utility--active {
  background: var(--app-sidebar-active-bg);
  box-shadow: inset 3px 0 0 var(--app-sidebar-active-text);
  color: var(--app-sidebar-active-text);
  font-weight: 700;
}

.app-sidebar__utility--active:hover,
.app-sidebar__utility--active:focus-visible {
  background: var(--app-sidebar-active-bg);
  color: var(--app-sidebar-active-text);
}

.app-sidebar__account {
  margin-top: 0.25rem;
  min-height: 3rem;
}

.app-sidebar__account-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.app-sidebar__menu {
  min-width: 15.625rem;
}

.app-sidebar__account-menu {
  min-width: 17.5rem;
}

.app-sidebar__menu-user {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
}

.app-sidebar__language-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border-radius: 0.375rem;
  cursor: pointer;
  padding: 0.375rem 0.75rem;
  user-select: none;
}

.app-sidebar__language-item:hover {
  background: var(--app-sidebar-hover);
}

.app-sidebar__language-label {
  flex: 1;
}

.app-sidebar__language-current {
  max-width: 7rem;
  overflow: hidden;
  color: var(--app-sidebar-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-sidebar__language-submenu {
  position: absolute;
  left: 100%;
  right: auto;
  bottom: 0;
  z-index: 7000;
  min-width: 12.5rem;
  max-height: min(24rem, calc(100vh - 2rem));
  overflow-y: auto;
  margin-left: 0.25rem;
  border: 1px solid var(--app-sidebar-border);
  border-radius: 0.5rem;
  background: var(--app-sidebar-panel);
  box-shadow: 0 0.75rem 2rem rgba(15, 23, 42, 0.18);
  padding: 0.25rem;
}

.app-sidebar__language-submenu-item {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 0;
  border-radius: 0.375rem;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0.375rem 0.5rem;
  text-align: left;
}

.app-sidebar__language-submenu-item:hover,
.app-sidebar__language-submenu-item.is-selected {
  background: var(--app-sidebar-hover);
}

body.body--dark .app-sidebar {
  --app-sidebar-panel: var(--color-surface-panel, #181a20);
  --app-sidebar-muted: rgba(255, 255, 255, 0.055);
  --app-sidebar-hover: rgba(255, 255, 255, 0.08);
  --app-sidebar-border: var(--color-border-default, rgba(255, 255, 255, 0.12));
  --app-sidebar-text: var(--color-text-primary, #f4f6f8);
  --app-sidebar-text-muted: var(--color-text-secondary, #aab3c2);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.2),
    0 12px 28px rgba(0, 0, 0, 0.24);
}

@media (prefers-reduced-motion: reduce) {
  .app-sidebar__nav-active-indicator {
    transition: none;
  }

  .app-sidebar__ai-icon {
    transition: none;
  }

  .app-sidebar__ai:hover .app-sidebar__ai-icon,
  .app-sidebar__ai:focus-visible .app-sidebar__ai-icon {
    transform: none;
  }
}
</style>
