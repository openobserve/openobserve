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
  <div class="flex flex-nowrap items-center h-10 w-full bg-surface-chrome-deeper shrink-0">
    <!-- LEFT SIDE: Logo -->
    <div class="flex items-center justify-start shrink-0 pl-3">
    <!-- LOGO SECTION: Displays custom or default OpenObserve logo -->
    <!-- Shows custom logo/text if configured in enterprise mode -->
    <div
      class="flex relative-position"
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
      <a
        v-if="
          store.state.zoConfig.hasOwnProperty('custom_logo_text') &&
          store.state.zoConfig?.custom_logo_text != ''
        "
        :href="homeUrl"
        @click.prevent="goToHome"
        class="text-xl font-semibold font-bold p-0 cursor-pointer mr-2 flex items-center no-underline text-inherit"
        >{{ store.state.zoConfig.custom_logo_text }}</a
      >

      <!-- Custom logo image - shows appropriate logo based on current theme -->
      <a :href="homeUrl" @click.prevent="goToHome" class="inline-flex items-center">
        <!-- Dark mode: Show dark logo, fallback to light logo -->
        <img
          v-if="
            isDark &&
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
            !isDark &&
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
      </a>

      <!-- OpenObserve logo (shown alongside custom logo if configured) -->
      <div
        v-if="store.state.zoConfig.custom_hide_self_logo == false"
        class="relative inline-flex items-center min-h-10"
      >
        <a :href="homeUrl" @click.prevent="goToHome" class="inline-flex items-center">
          <img
            data-test="header-openobserve-logo"
            class="openobserve-logo cursor-pointer h-8 max-w-37.5 block transition-opacity duration-200 hover:opacity-80"
            :src="
              getImageURL(
                isDark
                  ? 'images/common/openobserve_latest_dark_2.svg'
                  : 'images/common/openobserve_latest_light_2.svg',
              )
            "
            alt="OpenObserve"
          />
        </a>
      </div>
    </div>

    <!-- Default OpenObserve logo (when no custom logo) -->
    <div v-else class="relative-position relative inline-flex items-center min-h-10">
      <a :href="homeUrl" @click.prevent="goToHome" class="inline-flex items-center">
        <img
          data-test="header-openobserve-logo"
          class="openobserve-logo cursor-pointer h-8 max-w-37.5 block transition-opacity duration-200 hover:opacity-80"
          :src="
            getImageURL(
              isDark
                ? 'images/common/openobserve_latest_dark_2.svg'
                : 'images/common/openobserve_latest_light_2.svg',
            )
          "
          alt="OpenObserve"
        />
      </a>
    </div>
    </div><!-- end left side -->

    <!-- CENTER: elastic spacer so the right-side controls stay right-aligned. -->
    <div class="flex-1 min-w-0" />

    <!-- RIGHT SIDE: Controls -->
    <div class="flex items-center justify-end shrink-0 pr-3 gap-1">
    <!-- QUOTA WARNING SECTION: Shows warning when quota threshold is reached -->
    <div
      class="mr-4 flex items-center gap-1"
      v-if="store.state.organizationData.quotaThresholdMsg"
    >
      <div
        type="warning"
        icon="cloud"
        class="inline bg-status-warning-bg p-1.25 rounded-default"
      >
        <OIcon name="warning"
size="xs" class="text-warning" />{{
          store.state.organizationData.quotaThresholdMsg
        }}
      </div>
      <OButton
        variant="secondary"
        size="sm"
        class="m-1"
        @click="router.replace('/billings/plans')"
      >
        Upgrade to PRO Plan
      </OButton>
    </div>

    <!-- HEADER MENU: Contains all header navigation and user controls -->
    <div class="header-menu flex items-center gap-x-2">
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
          class="opacity-60"
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

      <div class="header-utility-icons flex items-center gap-x-2">
      <!-- AI CHAT TOGGLE: Enterprise feature to toggle AI chat panel.
           Leads the utility-icon cluster, set off by a separator from the
           org selector so it reads as the primary action in this group. -->
      <template v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled">
        <OButton
          variant="ghost"
          size="icon-toolbar"
          @click="toggleAIChat"
          data-test="menu-link-ai-item"
          class="group [background:var(--color-gradient-ai-subtle)]! text-ai-accent! dark:text-white! [transition:background_0.3s_ease,box-shadow_0.3s_ease,color_0.3s_ease] dark:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_20%,transparent)] hover:[background:var(--color-gradient-ai)]! hover:text-white! hover:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_35%,transparent)] dark:hover:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_35%,transparent)]"
          :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
          @mouseenter="handleMouseEnter"
          @mouseleave="handleMouseLeave"
        >
          <img :src="getBtnLogo" class="w-5 h-5 shrink-0 [transition:transform_0.6s_ease] group-hover:rotate-180 group-hover:brightness-0 group-hover:invert group-hover:[transition:filter_0.3s_ease]" />
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
        <component :is="slackIcon" class="size-5 shrink-0" />
        <OTooltip side="top" align="center" :content="t('menu.slack')" />
      </OButton>

      <!-- HELP MENU: Contains links to docs, API, and about page -->
      <ODropdown side="bottom" align="end">
        <template #trigger>
          <OButton variant="ghost" size="icon-toolbar" data-test="menu-link-help-item">
            <OIcon name="help-outline" size="sm" class="size-5!" />
            <OTooltip side="top" align="center" :content="t('menu.help')" />
          </OButton>
        </template>
        <div class="header-menu-bar min-w-62.5">
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
              class="size-5!"
            />
            <OTooltip side="top" align="center" :content="user.given_name ? user.given_name + ' ' + user.family_name : user.email" />
          </OButton>
        </template>
        <div class="header-menu-bar min-w-62.5">
          <!-- User information (non-clickable info row) -->
          <div class="flex items-center gap-3 px-3 py-2">
            <OIcon
              :name="user.picture ? user.picture : 'person'"
              size="xs"
            />
            <span class="text-sm truncate">{{
              user.given_name
                ? user.given_name + " " + user.family_name
                : user.email
            }}</span>
          </div>
          <ODropdownSeparator />

          <!-- Language selector — nested sub-dropdown (click to open) -->
          <div
            data-test="header-language-submenu-trigger"
            class="relative flex items-center gap-3 py-1.5 px-3 text-sm leading-[1.2] cursor-pointer select-none hover:bg-dropdown-item-hover-bg"
            @click.stop="showLanguageSubmenu = !showLanguageSubmenu"
          >
            <OIcon size="xs" name="language" class="padding-none" />
            <span class="flex-1 whitespace-nowrap">{{ t("menu.language") }}</span>
            <span class="inline-flex items-center gap-1.5 opacity-75 whitespace-nowrap">
              <img
                v-if="selectedLanguage.icon && selectedLanguage.icon.startsWith('img:')"
                :src="selectedLanguage.icon.slice(4)"
                :alt="selectedLanguage.label"
                class="w-4 h-3 object-cover rounded-default inline-block shrink-0"
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
              class="absolute right-full top-0 mr-1 min-w-50 border rounded-default py-1 z-9999 bg-dropdown-bg border-dropdown-border shadow-[0_8px_24px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
              data-test="language-dropdown-item"
              @click.stop
            >
              <button
                v-for="lang in langList"
                :key="lang.code"
                type="button"
                :data-test="`language-dropdown-item-${lang.code}`"
                class="flex items-center gap-2.5 w-full py-1.5 px-3 text-sm leading-[1.2] text-left bg-transparent border-0 cursor-pointer text-inherit"
                :class="[
                  'hover:bg-dropdown-item-hover-bg',
                  { 'font-semibold': selectedLanguage.code === lang.code },
                ]"
                @click="changeLanguage(lang); showLanguageSubmenu = false"
              >
                <img
                  v-if="lang.icon && lang.icon.startsWith('img:')"
                  :src="lang.icon.slice(4)"
                  :alt="lang.label"
                  class="w-4 h-3 object-cover rounded-default inline-block shrink-0"
                />
                <OIcon v-else-if="lang.icon" size="xs" :name="lang.icon" />
                <span class="flex-1">{{ lang.label }}</span>
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

import { defineComponent, PropType, computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useTheme } from "@/composables/useTheme";
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
import { chartColor } from "@/utils/chartTheme";

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
    const router = useRouter();
    const { isDark } = useTheme();

    const homeUrl = computed(() => {
      if (!router) return "/";
      return router.resolve({
        path: "/",
        query: {
          org_identifier: props.store.state.selectedOrganization?.identifier,
        },
      }).href;
    });

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
        ? chartColor("--color-status-negative")
        : chartColor("--color-status-warning-text");
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
      isDark,
      t,
      getImageURL,
      enterpriseButtonText,
      ingestionQuotaPercentage,
      ingestionQuotaColor,
      showEnterpriseDialog,
      showLanguageSubmenu,
      updateOrganization,
      goToHome,
      homeUrl,
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

<style scoped>
/* keep(lib-override:o2-button): dark-only, element-scoped re-point of OButton's
   ghost-primary tokens for the navbar upgrade CTA. The custom properties are READ by OButton's
   own internal DOM, so they have to be declared on the button element itself —
   there is no utility that sets them. Scoping appends [data-v] to the
   [data-test] compound, which is OButton's root and therefore carries this
   component's scope id. Was a global in styles/utilities.css (W1.d). */
.dark [data-test="upgrade-to-enterprise-btn"] {
  --color-button-ghost-primary-active-bg: var(--color-primary-900);
  --color-button-ghost-primary-text: var(--color-primary-200);
}
</style>
