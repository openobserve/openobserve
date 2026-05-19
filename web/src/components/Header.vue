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
  <div class="tw:flex tw:flex-nowrap tw:items-center tw:min-h-10 tw:w-full">
    <!-- LEFT SIDE: Logo -->
    <div class="tw:flex tw:items-center tw:justify-start tw:shrink-0">
    <!-- LOGO SECTION: Displays custom or default OpenObserve logo -->
    <!-- Shows custom logo/text if configured in enterprise mode -->
    <div
      class="flex relative-position q-mr-sm"
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
        class="text-h6 text-bold q-pa-none cursor-pointer q-mr-sm tw:flex tw:items-center"
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
        class="logo-container tw:relative tw:inline-flex tw:items-center tw:min-h-10 tw:min-w-[150px]"
      >
        <img
          class="openobserve-logo cursor-pointer tw:h-8 tw:max-w-[150px] tw:block tw:transition-opacity tw:duration-200 hover:tw:opacity-80"
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
    <div v-else class="flex relative-position q-mr-sm logo-container">
      <img
        class="openobserve-logo cursor-pointer tw:h-8 tw:max-w-[150px] tw:block tw:transition-opacity tw:duration-200 hover:tw:opacity-80"
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

    <!-- RIGHT SIDE: Controls -->
    <div class="tw:flex tw:items-center tw:justify-end tw:flex-1 tw:min-w-0">
    <!-- QUOTA WARNING SECTION: Shows warning when quota threshold is reached -->
    <div
      class="headerMenu tw:flex tw:items-center tw:gap-1"
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
        class="q-ma-xs"
        @click="router.replace('/billings/plans')"
      >
        Upgrade to PRO Plan
      </OButton>
    </div>

    <!-- HEADER MENU: Contains all header navigation and user controls -->
    <div class="header-menu tw:flex tw:items-center tw:gap-1">
      <!-- UPGRADE TO ENTERPRISE BUTTON: Shows for non-enterprise users -->
      <OButton
        variant="primary"
        size="xs"
        data-test="upgrade-to-enterprise-btn"
        @click="openEnterpriseDialog"
      >
        <template #icon-left>
          <OIcon name="card-giftcard" size="sm" />
        </template>
        {{ enterpriseButtonText }}
      </OButton>

      <!-- INGESTION QUOTA WARNING: Shows when 85%+ of ingestion limit is used -->
      <OButton
        v-if="
          config.isEnterprise == 'true' &&
          store.state.zoConfig.ingestion_quota_used >= 85
        "
        variant="ghost"
        size="icon-circle-sm"
        data-test="ingestion-quota-warning-icon"
      >
        <OIcon
          name="warning"
          size="md"
          class="header-icon tw:opacity-70"
          :style="{ color: ingestionQuotaColor }"
        />
        <OTooltip side="top" align="center" :content="`Warning: ${ingestionQuotaPercentage}% of ingestion limit used`" />
      </OButton>

      <!-- AI CHAT TOGGLE: Enterprise feature to toggle AI chat panel -->
      <OButton
        v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
        variant="ghost"
        size="icon-toolbar"
        @click="toggleAIChat"
        data-test="menu-link-ai-item"
        class="ai-hover-btn"
        :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave"
      >
        <img :src="getBtnLogo" class="header-icon ai-icon" style="width: 18px; height: 18px;" />
      </OButton>

      <!-- ORGANIZATION SELECTOR: Dropdown to switch between organizations -->
      <div data-test="navbar-organizations-select" class="tw:flex tw:items-center">
        <OSelect
          :options="selectOptions"
          :model-value="userClickedOrg?.identifier"
          label-key="displayLabel"
          value-key="identifier"
          searchable
          search-placeholder="Search Organization"
          size="sm"
          class="tw:min-w-[200px] tw:max-w-[250px]"
          data-test="navbar-organizations-select"
          @update:model-value="handleOrgSelect"
        >
          <template #empty>No organizations found</template>
        </OSelect>
      </div>

      <!-- THEME SWITCHER: Toggle between light and dark mode -->
      <ThemeSwitcher></ThemeSwitcher>

      <!-- SLACK COMMUNITY LINK -->
      <OButton
        variant="ghost"
        size="icon-circle-sm"
        data-test="menu-link-slack-item"
        @click="openSlack"
      >
        <component :is="slackIcon" size="20px" class="header-icon tw:opacity-70" />
        <OTooltip side="top" align="center" :content="t('menu.slack')" />
      </OButton>

      <!-- HELP MENU: Contains links to docs, API, and about page -->
      <ODropdown side="bottom" align="end">
        <template #trigger>
          <OButton variant="ghost" size="icon-circle-sm" data-test="menu-link-help-item">
            <OIcon name="help-outline" size="md" class="header-icon tw:opacity-70" />
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

          <!-- About page link -->
          <ODropdownItem
            data-test="menu-link-about-item"
            @select="goToAbout"
          >
            {{ t(`menu.about`) }}
          </ODropdownItem>
        </div>
      </ODropdown>

      <!-- SETTINGS BUTTON -->
      <OButton
        variant="ghost"
        size="icon-circle-sm"
        data-test="menu-link-settings-item"
        @click="router.push({ name: 'settings' })"
      >
        <OIcon name="settings" size="sm" class="header-icon" />
        <OTooltip side="top" align="center" :content="t('menu.settings')" />
      </OButton>

      <!-- USER PROFILE MENU: Profile, language, theme, and logout -->
      <ODropdown side="bottom" align="end">
        <template #trigger>
          <OButton
            variant="ghost"
            size="icon-circle-sm"
            data-test="header-my-account-profile-icon"
          >
            <OIcon
              :name="user.picture ? user.picture : 'person'"
              size="20px"
              class="header-icon tw:opacity-70"
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

          <!-- Language selector — flattened group (Workaround A) -->
          <ODropdownGroup :label="t('menu.language')">
            <ODropdownItem
              v-for="lang in langList"
              :key="lang.code"
              :data-test="`language-dropdown-item-${lang.code}`"
              @select="changeLanguage(lang)"
            >
              <template #icon-left>
                <OIcon size="xs" :name="lang.icon" class="padding-none" />
              </template>
              {{ lang.label }}
              <template
                v-if="selectedLanguage.code === lang.code"
                #icon-right
              >
                <OIcon size="xs" name="check" />
              </template>
            </ODropdownItem>
          </ODropdownGroup>
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
    </div><!-- end right side -->

    <!-- Enterprise Upgrade Dialog -->
    <EnterpriseUpgradeDialog v-model="showEnterpriseDialog" />
  </div>
</template>

<script lang="ts">

import { defineComponent, PropType, computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import ThemeSwitcher from "./ThemeSwitcher.vue";
import EnterpriseUpgradeDialog from "./EnterpriseUpgradeDialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import { getImageURL } from "@/utils/zincutils";

export default defineComponent({
  name: "HeaderComponent",
  components: {
    OSeparator,
    ThemeSwitcher,
    EnterpriseUpgradeDialog,
    OButton,
    OIcon,
    OTooltip,
    OSelect,
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
    "signout",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();

    // Enterprise upgrade dialog state
    const showEnterpriseDialog = ref(false);

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

    // Options for OSelect with combined label for display and search
    const selectOptions = computed(() =>
      props.organizations.map((org: any) => ({
        ...org,
        displayLabel:
          org.label?.length > 30
            ? org.label.substring(0, 30) + "... | " + org.identifier
            : org.label + " | " + org.identifier,
      })),
    );

    // Handle organization selection from OSelect dropdown
    const handleOrgSelect = (identifier: string) => {
      const org = props.organizations.find(
        (o: any) => o.identifier === identifier,
      );
      if (org) {
        emit("update:selectedOrg", org);
        emit("updateOrganization");
      }
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
      updateOrganization,
      goToHome,
      goToAbout,
      toggleAIChat,
      openSlack,
      navigateToOpenAPI,
      navigateToDocs,
      changeLanguage,
      openPredefinedThemes,
      signout,
      handleMouseEnter,
      handleMouseLeave,
      selectOptions,
      handleOrgSelect,
      openEnterpriseDialog,
    };
  },
});
</script>

<style scoped lang="scss">
:deep(.header-user-tooltip) {
  width: auto;
  max-width: none;
  white-space: nowrap;
}

.logo-container {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 2.5rem;
  min-width: 9.375rem;
}

.openobserve-logo {
  height: 2rem;
  width: auto;
  max-width: 9.375rem;
  display: block;
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 0.8;
  }
}

.headerMenu {
  margin-right: 1rem;

  .block {
    font-weight: 700;
    color: var(--o2-text-primary);
  }
}
</style>
