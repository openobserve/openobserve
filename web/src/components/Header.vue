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
  <div class="tw:flex tw:flex-nowrap tw:items-center tw:h-10 tw:w-full tw:bg-surface-chrome-deeper tw:shrink-0">
    <!-- LEFT SIDE: Logo -->
    <div class="tw:flex tw:items-center tw:justify-start tw:shrink-0 tw:pl-3">
    <!-- LOGO SECTION: Displays custom or default OpenObserve logo -->
    <!-- Shows custom logo/text if configured in enterprise mode -->
    <div
      class="tw:flex relative-position"
      v-if="
        (config.isEnterprise == 'true' &&
          store.state.zoConfig.hasOwnProperty('custom_logo_text') &&
          store.state.zoConfig.custom_logo_text != '') ||
        (config.isEnterprise == 'true' &&
          store.state.zoConfig.hasOwnProperty('custom_logo_img') &&
          store.state.zoConfig.custom_logo_img != null) ||
        (config.isEnterprise == 'true' &&
          store.state.zoConfig.hasOwnProperty('custom_logo_dark_img') &&
          store.state.zoConfig.custom_logo_dark_img != null)
      "
    >
      <!-- Custom logo text -->
      <span
        v-if="
          store.state.zoConfig.hasOwnProperty('custom_logo_text') &&
          store.state.zoConfig?.custom_logo_text != ''
        "
        class="tw:text-xl tw:font-semibold tw:font-bold tw:p-0 tw:cursor-pointer tw:mr-2 tw:flex tw:items-center"
        @click="goToHome"
        >{{ store.state.zoConfig.custom_logo_text }}</span
      >

      <!-- Custom logo image - shows appropriate logo based on current theme -->
      <div class="tw:flex tw:items-center">
        <!-- Dark mode: Show dark logo, fallback to light logo -->
        <img
          v-if="
            store.state.theme === 'dark' &&
            store.state.zoConfig.hasOwnProperty('custom_logo_dark_img') &&
            store.state.zoConfig?.custom_logo_dark_img != null
          "
          :src="
            `data:image; base64, ` + store.state.zoConfig?.custom_logo_dark_img
          "
          style="max-width: 150px; max-height: 32px"
        />
        <!-- Light mode: Show light logo, fallback to dark logo -->
        <img
          v-else-if="
            store.state.theme === 'light' &&
            store.state.zoConfig.hasOwnProperty('custom_logo_img') &&
            store.state.zoConfig?.custom_logo_img != null
          "
          :src="`data:image; base64, ` + store.state.zoConfig?.custom_logo_img"
          style="max-width: 150px; max-height: 32px"
        />
        <!-- Fallback: Show whichever logo exists (dark or light) -->
        <img
          v-else-if="
            store.state.zoConfig.hasOwnProperty('custom_logo_dark_img') &&
            store.state.zoConfig?.custom_logo_dark_img != null
          "
          :src="
            `data:image; base64, ` + store.state.zoConfig?.custom_logo_dark_img
          "
          style="max-width: 150px; max-height: 32px"
        />
        <img
          v-else-if="
            store.state.zoConfig.hasOwnProperty('custom_logo_img') &&
            store.state.zoConfig?.custom_logo_img != null
          "
          :src="`data:image; base64, ` + store.state.zoConfig?.custom_logo_img"
          style="max-width: 150px; max-height: 32px"
        />
      </div>

      <!-- OpenObserve logo (shown alongside custom logo if configured) -->
      <div
        v-if="store.state.zoConfig.custom_hide_self_logo == false"
        class="tw:relative tw:inline-flex tw:items-center tw:min-h-10"
      >
        <img
          data-test="header-openobserve-logo"
          class="openobserve-logo tw:cursor-pointer tw:h-8 tw:max-w-[150px] tw:block tw:transition-opacity tw:duration-200 tw:hover:opacity-80"
          :src="
            getImageURL(
              store.state.theme === 'dark'
                ? 'images/common/openobserve_latest_dark_2.svg'
                : 'images/common/openobserve_latest_light_2.svg',
            )
          "
          @click="goToHome"
          alt="OpenObserve"
        />
      </div>
    </div>

    <!-- Default OpenObserve logo (when no custom logo) -->
    <div v-else class="relative-position tw:relative tw:inline-flex tw:items-center tw:min-h-10">
      <img
        data-test="header-openobserve-logo"
        class="openobserve-logo tw:cursor-pointer tw:h-8 tw:max-w-[150px] tw:block tw:transition-opacity tw:duration-200 tw:hover:opacity-80"
        :src="
          getImageURL(
            store.state.theme === 'dark'
              ? 'images/common/openobserve_latest_dark_2.svg'
              : 'images/common/openobserve_latest_light_2.svg',
          )
        "
        @click="goToHome"
        alt="OpenObserve"
      />
    </div>
    </div><!-- end left side -->

    <!-- CENTER: elastic spacer so the right-side controls stay right-aligned. -->
    <div class="tw:flex-1 tw:min-w-0" />

    <!-- RIGHT SIDE: Controls -->
    <div class="tw:flex tw:items-center tw:justify-end tw:shrink-0 tw:pr-3 tw:gap-1">
    <!-- QUOTA WARNING SECTION: Shows warning when quota threshold is reached -->
    <div
      class="tw:mr-4 tw:flex tw:items-center tw:gap-1"
      v-if="store.state.organizationData.quotaThresholdMsg"
    >
      <div
        type="warning"
        icon="cloud"
        class="warning-msg"
        style="display: inline"
      >
        <OIcon name="warning"
size="xs" class="warning" />{{
          store.state.organizationData.quotaThresholdMsg
        }}
      </div>
      <OButton
        variant="secondary"
        size="sm"
        class="tw:m-1"
        @click="router.replace('/billings/plans')"
      >
        Upgrade to PRO Plan
      </OButton>
    </div>

    <!-- HEADER MENU: Contains all header navigation and user controls -->
    <div class="header-menu tw:flex tw:items-center tw:gap-x-2">
      <!-- INGESTION QUOTA WARNING: Shows when 85%+ of ingestion limit is used -->
      <OButton
        v-if="
          config.isEnterprise == 'true' &&
          store.state.zoConfig.ingestion_quota_used >= 85
        "
        variant="ghost"
        size="icon-toolbar"
        data-test="ingestion-quota-warning-icon"
      >
        <OIcon
          name="warning"
          size="sm"
          class="tw:opacity-60"
          :style="{ color: ingestionQuotaColor }"
        />
        <OTooltip side="top" align="center" :content="`Warning: ${ingestionQuotaPercentage}% of ingestion limit used`" />
      </OButton>

      <!-- EDITION BADGE / UPGRADE BUTTON -->
      <!-- Enterprise/Cloud: ghost-muted badge (informational, opens about dialog) -->
      <!-- Open Source: primary CTA to drive upgrades -->
      <OButton
        :variant="config.isEnterprise === 'true' || config.isCloud === 'true' ? 'outline-primary' : 'primary'"
        size="xs"
        data-test="upgrade-to-enterprise-btn"
        @click="openEnterpriseDialog"
      >
        <template #icon-left>
          <OIcon :name="config.isEnterprise === 'true' || config.isCloud === 'true' ? 'verified' : 'card-giftcard'" size="sm" />
        </template>
        {{ enterpriseButtonText }}
      </OButton>

      <!-- ORGANIZATION SELECTOR: Dropdown to switch between organizations -->
      <OrganizationSelector
        :organizations="organizations"
        :current="userClickedOrg"
        @select="handleOrgSelection"
      />

      <div class="header-utility-icons tw:flex tw:items-center tw:gap-x-2">
      <!-- AI CHAT TOGGLE: Enterprise feature to toggle AI chat panel.
           Leads the utility-icon cluster, set off by a separator from the
           org selector so it reads as the primary action in this group. -->
      <template v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled">
        <OButton
          variant="ghost"
          size="icon-toolbar"
          @click="toggleAIChat"
          data-test="menu-link-ai-item"
          class="ai-hover-btn"
          :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
          @mouseenter="handleMouseEnter"
          @mouseleave="handleMouseLeave"
        >
          <img :src="getBtnLogo" class="ai-icon tw:w-5 tw:h-5 tw:shrink-0" />
          <OTooltip
            side="bottom"
            align="center"
            :content="t('menu.aiAssistant')"
            shortcut-id="aiChatToggle"
          />
        </OButton>
      </template>

      <!-- THEME SWITCHER: Toggle between light and dark mode -->
      <ThemeSwitcher></ThemeSwitcher>

      <!-- SLACK COMMUNITY LINK -->
      <OButton
        variant="ghost"
        size="icon-toolbar"
        data-test="menu-link-slack-item"
        @click="openSlack"
      >
        <component :is="slackIcon" class="tw:size-5 tw:shrink-0" />
        <OTooltip side="top" align="center" :content="t('menu.slack')" />
      </OButton>

      <!-- HELP MENU: Contains links to docs, API, and about page -->
      <ODropdown side="bottom" align="end">
        <template #trigger>
          <OButton variant="ghost" size="icon-toolbar" data-test="menu-link-help-item">
            <OIcon name="help-outline" size="sm" class="tw:size-5!" />
            <OTooltip side="top" align="center" :content="t('menu.help')" />
          </OButton>
        </template>
        <div class="header-menu-bar tw:min-w-[250px]">
          <!-- OpenAPI link (only for non-cloud deployments) -->
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
              {{ t(`menu.openapi`) }}
            </ODropdownItem>
            <ODropdownSeparator />
          </template>

          <!-- Documentation link -->
          <ODropdownItem
            data-test="menu-link-docs-item"
            @select="navigateToDocs()"
          >
            {{ t(`menu.docs`) }}
          </ODropdownItem>
          <ODropdownSeparator />

          <!-- Keyboard shortcuts -->
          <ODropdownItem
            data-test="menu-link-shortcuts-item"
            shortcut-id="openCheatsheet"
            @select="openShortcuts"
          >
            {{ t("menu.keyboardShortcuts") }}
          </ODropdownItem>
          <ODropdownSeparator />

          <!-- About page link -->
          <ODropdownItem
            data-test="menu-link-about-item"
            @select="goToAbout"
          >
            {{ t(`menu.about`) }}
          </ODropdownItem>
        </div>
      </ODropdown>

      <!-- USER PROFILE MENU: Profile, language, theme, and logout -->
      <ODropdown
        side="bottom"
        align="end"
        @update:open="(open) => { if (!open) showLanguageSubmenu = false; }"
      >
        <template #trigger>
          <OButton
            variant="ghost"
            size="icon-toolbar"
            data-test="header-my-account-profile-icon"
          >
            <OIcon
              :name="user.picture ? user.picture : 'person'"
              size="sm"
              class="tw:size-5!"
            />
            <OTooltip side="top" align="center" :content="user.given_name ? user.given_name + ' ' + user.family_name : user.email" />
          </OButton>
        </template>
        <div class="header-menu-bar tw:min-w-[250px]">
          <!-- User information (non-clickable info row) -->
          <div class="tw:flex tw:items-center tw:gap-3 tw:px-3 tw:py-2">
            <OIcon
              :name="user.picture ? user.picture : 'person'"
              size="xs"
            />
            <span class="tw:text-sm tw:truncate">{{
              user.given_name
                ? user.given_name + " " + user.family_name
                : user.email
            }}</span>
          </div>
          <ODropdownSeparator />

          <!-- Language selector — nested sub-dropdown (click to open) -->
          <div
            data-test="header-language-submenu-trigger"
            class="tw:relative tw:flex tw:items-center tw:gap-3 tw:py-1.5 tw:px-3 tw:text-sm tw:leading-[1.2] tw:cursor-pointer tw:select-none tw:hover:bg-[rgba(0,0,0,0.05)] tw:dark:hover:bg-[rgba(255,255,255,0.08)]"
            @click.stop="showLanguageSubmenu = !showLanguageSubmenu"
          >
            <OIcon size="xs" name="language" class="padding-none" />
            <span class="tw:flex-1 tw:whitespace-nowrap">{{ t("menu.language") }}</span>
            <span class="tw:inline-flex tw:items-center tw:gap-1.5 tw:opacity-75 tw:whitespace-nowrap">
              <img
                v-if="selectedLanguage.icon && selectedLanguage.icon.startsWith('img:')"
                :src="selectedLanguage.icon.slice(4)"
                :alt="selectedLanguage.label"
                class="tw:w-4 tw:h-3 tw:object-cover tw:rounded-xs tw:inline-block tw:shrink-0"
              />
              <OIcon
                v-else-if="selectedLanguage.icon"
                size="xs"
                :name="selectedLanguage.icon"
                class="padding-none"
              />
              <span>{{ selectedLanguage.label }}</span>
            </span>
            <OIcon size="xs" name="chevron-right" />

            <!-- Submenu — absolutely positioned to the left of parent dropdown -->
            <div
              v-if="showLanguageSubmenu"
              class="tw:absolute tw:right-full tw:top-0 tw:mr-1 tw:min-w-50 tw:border tw:rounded-md tw:py-1 tw:z-9999"
              :class="store.state.theme === 'dark'
                ? 'tw:bg-[#1f2937] tw:border-[rgba(255,255,255,0.12)] tw:shadow-[0_8px_24px_rgba(0,0,0,0.5)]'
                : 'tw:bg-white tw:border-black/12 tw:shadow-[0_8px_24px_rgba(0,0,0,0.15)]'"
              data-test="language-dropdown-item"
              @click.stop
            >
              <button
                v-for="lang in langList"
                :key="lang.code"
                type="button"
                :data-test="`language-dropdown-item-${lang.code}`"
                class="tw:flex tw:items-center tw:gap-2.5 tw:w-full tw:py-1.5 tw:px-3 tw:text-sm tw:leading-[1.2] tw:text-left tw:bg-transparent tw:border-0 tw:cursor-pointer tw:text-inherit"
                :class="[
                  store.state.theme === 'dark'
                    ? 'tw:hover:bg-[rgba(255,255,255,0.08)]'
                    : 'tw:hover:bg-[rgba(0,0,0,0.05)]',
                  { 'tw:font-semibold': selectedLanguage.code === lang.code },
                ]"
                @click="changeLanguage(lang); showLanguageSubmenu = false"
              >
                <img
                  v-if="lang.icon && lang.icon.startsWith('img:')"
                  :src="lang.icon.slice(4)"
                  :alt="lang.label"
                  class="tw:w-4 tw:h-3 tw:object-cover tw:rounded-xs tw:inline-block tw:shrink-0"
                />
                <OIcon v-else-if="lang.icon" size="xs" :name="lang.icon" />
                <span class="tw:flex-1">{{ lang.label }}</span>
                <OIcon
                  v-if="selectedLanguage.code === lang.code"
                  size="xs"
                  name="check"
                />
              </button>
            </div>
          </div>
          <ODropdownSeparator />

          <!-- Theme management -->
          <ODropdownItem
            data-test="menu-link-predefined-themes-item"
            @select="openPredefinedThemes"
          >
            <template #icon-left>
              <OIcon size="xs" name="color-lens" class="padding-none" />
            </template>
            {{ t("common.manageTheme") }}
          </ODropdownItem>
          <ODropdownSeparator />

          <!-- Logout -->
          <ODropdownItem
            data-test="menu-link-logout-item"
            variant="destructive"
            @select="signout"
          >
            <template #icon-left>
              <OIcon size="xs" name="exit-to-app" class="padding-none" />
            </template>
            {{ t("menu.signOut") }}
          </ODropdownItem>
        </div>
      </ODropdown>
      </div>
    </div>
    </div><!-- end right side -->

    <!-- Enterprise Upgrade Dialog -->
    <EnterpriseUpgradeDialog v-model="showEnterpriseDialog" />
  </div>
</template>

<script lang="ts">

import { defineComponent, PropType, computed, ref, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import ThemeSwitcher from "./ThemeSwitcher.vue";
import EnterpriseUpgradeDialog from "./EnterpriseUpgradeDialog.vue";
import OrganizationSelector from "./OrganizationSelector.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";

import { getImageURL } from "@/utils/zincutils";

export default defineComponent({
  name: "HeaderComponent",
  components: {
    ThemeSwitcher,
    EnterpriseUpgradeDialog,
    OrganizationSelector,
    OButton,
    OIcon,
    OTooltip,
    ODropdown,
    ODropdownItem,
    ODropdownSeparator,
    ODropdownGroup,
  },
  props: {
    // Store instance
    store: {
      type: Object as PropType<any>,
      required: true,
    },
    // Router instance
    router: {
      type: Object as PropType<any>,
      required: true,
    },
    // Configuration object
    config: {
      type: Object as PropType<any>,
      required: true,
    },
    // Current user information
    user: {
      type: Object as PropType<any>,
      required: true,
    },
    // Slack icon component
    slackIcon: {
      type: Object as PropType<any>,
      required: true,
    },
    // Backend URL
    zoBackendUrl: {
      type: String,
      required: true,
    },
    // List of available languages
    langList: {
      type: Array as PropType<any[]>,
      required: true,
    },
    // Currently selected language
    selectedLanguage: {
      type: Object as PropType<any>,
      required: true,
    },
    // Selected organization
    selectedOrg: {
      type: Object as PropType<any>,
      required: true,
    },
    // User clicked organization (for UI sync)
    userClickedOrg: {
      type: Object as PropType<any>,
      required: true,
    },
    // Full list of organizations for the selector
    organizations: {
      type: Array as PropType<any[]>,
      required: true,
    },
    // AI button hover state
    isHovered: {
      type: Boolean,
      required: true,
    },
    // AI button logo based on state
    getBtnLogo: {
      type: String,
      required: true,
    },
  },
  emits: [
    "update:selectedOrg",
    "update:isHovered",
    "updateOrganization",
    "goToHome",
    "goToAbout",
    "toggleAIChat",
    "openSlack",
    "navigateToOpenAPI",
    "navigateToDocs",
    "changeLanguage",
    "openPredefinedThemes",
    "openShortcuts",
    "signout",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();

    // Enterprise upgrade dialog state
    const showEnterpriseDialog = ref(false);

    // Language sub-menu state (nested submenu pattern matching original UX)
    const showLanguageSubmenu = ref(false);

    // Computed property for enterprise button text based on deployment type
    const enterpriseButtonText = computed(() => {
      const isEnterprise = props.config.isEnterprise === "true";
      const isCloud = props.config.isCloud === "true";

      if (isCloud) {
        return t("about.header_button.cloud_features");
      } else if (isEnterprise) {
        return t("about.header_button.enterprise_edition");
      } else {
        return t("about.header_button.get_enterprise_free");
      }
    });

    // Computed property for ingestion quota percentage
    const ingestionQuotaPercentage = computed(() => {
      return (
        Math.ceil(props.store.state.zoConfig.ingestion_quota_used * 100) /
          100 || 0
      );
    });

    // Computed property for ingestion quota warning color
    const ingestionQuotaColor = computed(() => {
      return props.store.state.zoConfig.ingestion_quota_used >= 95
        ? "red"
        : "orange";
    });

    // Event handlers that emit to parent component
    const updateOrganization = () => {
      emit("updateOrganization");
    };

    const goToHome = () => {
      emit("goToHome");
    };

    const goToAbout = () => {
      emit("goToAbout");
    };

    const toggleAIChat = () => {
      emit("toggleAIChat");
    };

    const openSlack = () => {
      emit("openSlack");
    };

    const navigateToOpenAPI = (url: string) => {
      emit("navigateToOpenAPI", url);
    };

    const navigateToDocs = () => {
      emit("navigateToDocs");
    };

    const changeLanguage = (lang: any) => {
      emit("changeLanguage", lang);
    };

    const openPredefinedThemes = () => {
      emit("openPredefinedThemes");
    };

    const openShortcuts = () => {
      emit("openShortcuts");
    };

    const signout = () => {
      emit("signout");
    };

    // Handle mouse hover events for AI button
    const handleMouseEnter = () => {
      emit("update:isHovered", true);
    };

    const handleMouseLeave = () => {
      emit("update:isHovered", false);
    };

    // Handle organization selection from the OrganizationSelector menu
    const handleOrgSelection = (org: any) => {
      emit("update:selectedOrg", org);
      emit("updateOrganization");
    };

    // Open enterprise upgrade dialog
    const openEnterpriseDialog = () => {
      showEnterpriseDialog.value = true;
    };

    return {
      t,
      getImageURL,
      enterpriseButtonText,
      ingestionQuotaPercentage,
      ingestionQuotaColor,
      showEnterpriseDialog,
      showLanguageSubmenu,
      updateOrganization,
      goToHome,
      goToAbout,
      toggleAIChat,
      openSlack,
      navigateToOpenAPI,
      navigateToDocs,
      changeLanguage,
      openPredefinedThemes,
      openShortcuts,
      signout,
      handleMouseEnter,
      handleMouseLeave,
      handleOrgSelection,
      openEnterpriseDialog,
    };
  },
});
</script>

