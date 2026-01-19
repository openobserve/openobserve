<!-- Copyright 2023 OpenObserve Inc.

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
  <q-toolbar>
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
          style="max-width: 150px; max-height: 32px;"
        />
        <!-- Light mode: Show light logo, fallback to dark logo -->
        <img
          v-else-if="
            store.state.theme === 'light' &&
            store.state.zoConfig.hasOwnProperty('custom_logo_img') &&
            store.state.zoConfig?.custom_logo_img != null
          "
          :src="
            `data:image; base64, ` + store.state.zoConfig?.custom_logo_img
          "
          style="max-width: 150px; max-height: 32px;"
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
          style="max-width: 150px; max-height: 32px;"
        />
        <img
          v-else-if="
            store.state.zoConfig.hasOwnProperty('custom_logo_img') &&
            store.state.zoConfig?.custom_logo_img != null
          "
          :src="
            `data:image; base64, ` + store.state.zoConfig?.custom_logo_img
          "
          style="max-width: 150px; max-height: 32px;"
        />
       </div>


      <!-- OpenObserve logo (shown alongside custom logo if configured) -->
      <div
        v-if="store.state.zoConfig.custom_hide_self_logo == false"
        class="logo-container"
      >
        <img
          class="openobserve-logo cursor-pointer"
          :src="getImageURL(
            store.state.theme === 'dark'
              ? 'images/common/openobserve_latest_dark_2.svg'
              : 'images/common/openobserve_latest_light_2.svg'
          )"
          @click="goToHome"
          alt="OpenObserve"
        />
      </div>
    </div>

    <!-- Default OpenObserve logo (when no custom logo) -->
    <div v-else class="flex relative-position q-mr-sm logo-container">
      <img
        class="openobserve-logo cursor-pointer"
        :src="getImageURL(
          store.state.theme === 'dark'
            ? 'images/common/openobserve_latest_dark_2.svg'
            : 'images/common/openobserve_latest_light_2.svg'
        )"
        @click="goToHome"
        alt="OpenObserve"
      />
    </div>

    <q-toolbar-title></q-toolbar-title>

    <!-- QUOTA WARNING SECTION: Shows warning when quota threshold is reached -->
    <div
      class="headerMenu float-left"
      v-if="store.state.organizationData.quotaThresholdMsg"
    >
      <div
        type="warning"
        icon="cloud"
        class="warning-msg"
        style="display: inline"
      >
        <q-icon name="warning" size="xs" class="warning" />{{
          store.state.organizationData.quotaThresholdMsg
        }}
      </div>
      <q-btn
        color="secondary"
        size="sm"
        style="display: inline; padding: 5px 10px"
        rounded
        borderless
        dense
        class="q-ma-xs"
        @click="router.replace('/billings/plans')"
        >Upgrade to PRO Plan</q-btn
      >
    </div>

    <!-- HEADER MENU: Contains all header navigation and user controls -->
    <div class="header-menu">
      <!-- UPGRADE TO ENTERPRISE BUTTON: Shows for non-enterprise users -->
      <q-btn
        no-caps
        flat
        dense
        class="upgrade-enterprise-btn q-px-sm q-mx-xs"
        @click="openEnterpriseDialog"
        data-test="upgrade-to-enterprise-btn"
      >
        <div class="row items-center no-wrap">
          <q-icon name="card_giftcard" size="16px" class="q-mr-xs" />
          <span class="text-weight-medium">{{ enterpriseButtonText }}</span>
        </div>
      </q-btn>

      <!-- INGESTION QUOTA WARNING: Shows when 85%+ of ingestion limit is used -->
      <q-btn
        v-if="
          config.isEnterprise == 'true' &&
          store.state.zoConfig.ingestion_quota_used >= 85
        "
        round
        flat
        dense
        :ripple="false"
        data-test="ingestion-quota-warning-icon"
      >
        <div class="row items-center no-wrap">
          <q-icon
            name="warning"
            size="24px"
            class="header-icon"
            :style="{ color: ingestionQuotaColor }"
          ></q-icon>
        </div>
        <q-tooltip anchor="top middle" self="bottom middle">
          Warning: {{ ingestionQuotaPercentage }}% of ingestion limit used
        </q-tooltip>
      </q-btn>

      <!-- AI CHAT TOGGLE: Enterprise feature to toggle AI chat panel -->
      <q-btn
        v-if="
          config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled
        "
        :ripple="false"
        @click="toggleAIChat"
        data-test="menu-link-ai-item"
        no-caps
        :borderless="true"
        flat
        dense
        class="o2-button ai-hover-btn q-px-sm q-py-sm"
        :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
        style="border-radius: 100%"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave"
      >
        <div class="row items-center no-wrap tw:gap-2">
          <img :src="getBtnLogo" class="header-icon ai-icon" />
        </div>
      </q-btn>

      <!-- ORGANIZATION SELECTOR: Dropdown to switch between organizations -->
      <div data-test="navbar-organizations-select" class="q-mx-sm row">
        <q-btn
          style="max-width: 250px"
          dense
          no-caps
          flat
          class="tw:text-ellipsis tw:overflow-hidden"
        >
          <div class="row items-center no-wrap full-width">
            <div class="col tw:truncate">
              {{ userClickedOrg?.label || "" }}
            </div>
            <q-icon name="arrow_drop_down" class="q-ml-xs" />
          </div>

          <!-- Organization selection menu -->
          <q-menu
            anchor="bottom middle"
            self="top middle"
            class="organization-menu-o2"
          >
            <q-list data-test="organization-menu-list" style="width: 100%">
              <q-item data-test="organization-menu-item" style="padding: 0">
                <q-item-section data-test="organization-menu-item-section" class="column" style="padding: 0px">
                  <!-- Organization table with search functionality -->
                  <q-table
                    data-test="organization-menu-table"
                    :rows="filteredOrganizations"
                    :row-key="(row) => 'org_' + row.identifier"
                    :columns="[{ name: 'label', label: 'Organization', field: 'label', align: 'left' }]"
                    :visible-columns="['label']"
                    hide-header
                    :pagination="{ rowsPerPage }"
                    :rows-per-page-options="[]"
                    class="org-table"
                    style="width: 470px"
                  >
                    <!-- Search input for filtering organizations -->
                    <template #top>
                      <div class="full-width">
                        <q-input
                          data-test="organization-search-input"
                          :model-value="searchQuery"
                          @update:model-value="(val) => $emit('update:searchQuery', val)"
                          data-cy="index-field-search-input"
                          borderless
                          dense
                          clearable
                          debounce="1"
                          autofocus
                          :placeholder="'Search Organization'"
                        >
                          <template #prepend>
                            <q-icon name="search" />
                          </template>
                        </q-input>
                      </div>
                    </template>

                    <!-- Organization list item -->
                    <template v-slot:body-cell-label="props">
                      <q-td
                        :props="props"
                        class="org-list-item-cell"
                        @click="handleOrgSelection(props.row)"
                      >
                        <div
                          class="org-menu-item"
                          v-close-popup
                          data-test="organization-menu-item-label-item-label"
                          :class="{
                            'org-menu-item--active':
                              props.row.identifier === userClickedOrg?.identifier,
                          }"
                        >
                          {{
                            props.row.label.length > 30
                              ? props.row.label.substring(0, 30) +
                                "... | " +
                                props.row.identifier
                              : props.row.label + " | " + props.row.identifier
                          }}
                          <q-tooltip
                            v-if="props.row.label.length > 30"
                            anchor="bottom middle"
                            self="top start"
                          >
                            {{ props.row.label }}
                          </q-tooltip>
                        </div>
                      </q-td>
                    </template>

                    <!-- No data message -->
                    <template v-slot:no-data>
                      <div
                        data-test="organization-menu-no-data"
                        class="text-center q-pa-sm tw:w-full tw:flex tw:justify-center"
                      >
                        No organizations found
                      </div>
                    </template>
                  </q-table>
                </q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </div>

      <!-- THEME SWITCHER: Toggle between light and dark mode -->
      <ThemeSwitcher></ThemeSwitcher>

      <!-- SLACK COMMUNITY LINK -->
      <q-btn
        round
        flat
        dense
        :ripple="false"
        @click="openSlack"
        data-test="menu-link-slack-item"
      >
        <div class="row items-center no-wrap">
          <q-icon
            ><component :is="slackIcon" size="32px" class="header-icon"
          /></q-icon>
        </div>
        <q-tooltip anchor="top middle" self="bottom middle">
          {{ t("menu.slack") }}
        </q-tooltip>
      </q-btn>

      <!-- HELP MENU: Contains links to docs, API, and about page -->
      <q-btn
        round
        flat
        dense
        :ripple="false"
        data-test="menu-link-help-item"
      >
        <div class="row items-center no-wrap">
          <q-icon name="help_outline" class="header-icon"></q-icon>
          <q-tooltip anchor="top middle" self="bottom middle">
            {{ t("menu.help") }}
          </q-tooltip>
        </div>

        <q-menu
          fit
          anchor="bottom right"
          self="top right"
          transition-show="jump-down"
          transition-hide="jump-up"
          class="header-menu-bar"
        >
          <q-list style="min-width: 250px">
            <!-- OpenAPI link (only for non-cloud deployments) -->
            <div
              v-if="
                config.isCloud !== 'true' &&
                !store.state.zoConfig?.custom_hide_menus
                  ?.split(',')
                  ?.includes('openapi')
              "
            >
              <q-item clickable @click="navigateToOpenAPI(zoBackendUrl)">
                <q-item-section>
                  <q-item-label>
                    {{ t(`menu.openapi`) }}
                  </q-item-label>
                </q-item-section>
              </q-item>
              <q-separator />
            </div>

            <!-- Documentation link -->
            <q-item clickable @click="navigateToDocs()">
              <q-item-section>
                <q-item-label>
                  {{ t(`menu.docs`) }}
                </q-item-label>
              </q-item-section>
            </q-item>
            <q-separator />

            <!-- About page link -->
            <q-item clickable @click="goToAbout" data-test="menu-link-about-item">
              <q-item-section>
                <q-item-label>
                  {{ t(`menu.about`) }}
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>

      <!-- SETTINGS BUTTON -->
      <q-btn
        data-test="menu-link-settings-item"
        round
        flat
        dense
        :ripple="false"
        @click="router.push({ name: 'settings' })"
      >
        <div class="row items-center no-wrap">
          <q-icon :name="outlinedSettings" class="header-icon"></q-icon>
        </div>
        <q-tooltip anchor="top middle" self="bottom middle">
          {{ t("menu.settings") }}
        </q-tooltip>
      </q-btn>

      <!-- USER PROFILE MENU: Profile, language, theme, and logout -->
      <q-btn
        round
        flat
        dense
        :ripple="false"
        data-test="header-my-account-profile-icon"
      >
        <div class="row items-center no-wrap">
          <q-icon
            :name="user.picture ? user.picture : 'person'"
            class="header-icon"
          ></q-icon>
          <q-tooltip anchor="top middle" self="bottom middle">
            {{
              user.given_name
                ? user.given_name + " " + user.family_name
                : user.email
            }}</q-tooltip
          >
        </div>

        <q-menu
          fit
          anchor="bottom right"
          self="top right"
          transition-show="jump-down"
          transition-hide="jump-up"
          class="header-menu-bar"
        >
          <q-list style="min-width: 250px">
            <!-- User information -->
            <q-item>
              <q-item-section avatar>
                <q-icon
                  :name="user.picture ? user.picture : 'person'"
                  size="xs"
                ></q-icon>
              </q-item-section>
              <q-item-section>
                <q-item-label>{{
                  user.given_name
                    ? user.given_name + " " + user.family_name
                    : user.email
                }}</q-item-label>
              </q-item-section>
            </q-item>
            <q-separator />

            <!-- Language selector -->
            <q-item clickable>
              <q-item-section avatar>
                <q-icon size="xs" name="language" class="padding-none" />
              </q-item-section>
              <q-item-section>
                <q-item-label class="tw:w-[180px]">{{
                  t("menu.language")
                }}</q-item-label>
              </q-item-section>
              <q-item-section></q-item-section>
              <q-item-section side>
                <div class="q-gutter-xs">
                  <q-icon
                    size="xs"
                    :name="selectedLanguage.icon"
                    class="padding-none"
                  />
                  <span
                    class="cursor-pointer vertical-bottom q-mt-sm selected-lang-label"
                    >{{ selectedLanguage.label }}</span
                  >
                </div>
              </q-item-section>
              <q-item-section side style="padding-left: 0px">
                <q-icon
                  class="icon-ley-arrow-right"
                  name="keyboard_arrow_right"
                />
              </q-item-section>

              <!-- Language selection submenu -->
              <q-menu
                auto-close
                anchor="top end"
                self="top start"
                data-test="language-dropdown-item"
                class="header-menu-bar"
              >
                <q-list>
                  <q-item
                    v-for="lang in langList"
                    :key="lang.code"
                    v-bind="lang"
                    dense
                    clickable
                    @click="changeLanguage(lang)"
                  >
                    <q-item-section avatar>
                      <q-icon
                        size="xs"
                        :name="lang.icon"
                        class="padding-none"
                      />
                    </q-item-section>

                    <q-item-section
                      :data-test="`language-dropdown-item-${lang.code}`"
                    >
                      <q-item-label>{{ lang.label }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-item>
            <q-separator />

            <!-- Theme management -->
            <q-item
              data-test="menu-link-predefined-themes-item"
              v-ripple="true"
              v-close-popup="true"
              clickable
              @click="openPredefinedThemes"
            >
              <q-item-section avatar>
                <q-icon size="xs" name="color_lens" class="padding-none" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ t("common.manageTheme") }}</q-item-label>
              </q-item-section>
            </q-item>
            <q-separator />

            <!-- Logout -->
            <q-item
              data-test="menu-link-logout-item"
              v-ripple="true"
              v-close-popup="true"
              clickable
              @click="signout"
            >
              <q-item-section avatar>
                <q-icon size="xs" name="exit_to_app" class="padding-none" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ t("menu.signOut") }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
    </div>

    <!-- Enterprise Upgrade Dialog -->
    <EnterpriseUpgradeDialog v-model="showEnterpriseDialog" />
  </q-toolbar>
</template>

<script lang="ts">
import { defineComponent, PropType, computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import ThemeSwitcher from "./ThemeSwitcher.vue";
import EnterpriseUpgradeDialog from "./EnterpriseUpgradeDialog.vue";
import { outlinedSettings } from "@quasar/extras/material-icons-outlined";
import { getImageURL } from "@/utils/zincutils";

export default defineComponent({
  name: "HeaderComponent",
  components: {
    ThemeSwitcher,
    EnterpriseUpgradeDialog,
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
    // Filtered list of organizations based on search
    filteredOrganizations: {
      type: Array as PropType<any[]>,
      required: true,
    },
    // Search query for organization filter
    searchQuery: {
      type: String,
      required: true,
    },
    // Rows per page for organization table
    rowsPerPage: {
      type: Number,
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
    "update:searchQuery",
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
      const isEnterprise = props.config.isEnterprise === 'true';
      const isCloud = props.config.isCloud === 'true';

      if (isCloud) {
        return t('about.header_button.cloud_features');
      } else if (isEnterprise) {
        return t('about.header_button.enterprise_edition');
      } else {
        return t('about.header_button.get_enterprise_free');
      }
    });

    // Computed property for ingestion quota percentage
    const ingestionQuotaPercentage = computed(() => {
      return Math.ceil(props.store.state.zoConfig.ingestion_quota_used * 100) / 100 || 0;
    });

    // Computed property for ingestion quota warning color
    const ingestionQuotaColor = computed(() => {
      return props.store.state.zoConfig.ingestion_quota_used >= 95 ? 'red' : 'orange';
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

    // Handle organization selection from dropdown
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
      outlinedSettings,
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
      handleOrgSelection,
      openEnterpriseDialog,
    };
  },
});
</script>

<style scoped lang="scss">
.upgrade-enterprise-btn {
  background: var(--q-primary) !important;
  color: white !important;
  border-radius: 4px !important;
  padding: 0 10px !important;
  transition: all 0.2s ease !important;
  height: 28px !important;
  min-height: 28px !important;
  font-size: 12px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  align-self: center !important;
  vertical-align: middle !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;

  &:hover {
    opacity: 0.85;
    filter: brightness(0.9);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .q-icon {
    color: white !important;
    font-size: 14px !important;
    margin-right: 4px;
  }

  span {
    font-size: 12px;
    font-weight: 500;
    line-height: 28px;
    display: inline-block;
  }
}
</style>
