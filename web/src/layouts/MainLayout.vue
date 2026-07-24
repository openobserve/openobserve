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
  <div
    :class="[store.state.printMode === true ? 'printMode' : '', 'o2-app-root', 'w-full', 'transition-[width]', 'duration-300', 'ease-[ease]', 'min-h-screen', 'h-screen', 'flex', 'flex-col']"
  >
    <header class="o2-app-header shrink-0" :class="store.state.printMode === true ? 'hidden' : ''">
      <!-- Webinar announcement bar: shown above toolbar for cloud users -->
      <div
        v-if="config.isCloud === 'true'"
        class="bg-button-primary text-button-primary-foreground text-center"
      >
        <WebinarBanner variant="header" />
      </div>

      <!-- Header component containing logo, navigation, and user controls -->
      <AppHeader
        :store="store"
        :router="router"
        :config="config"
        :user="user"
        :slack-icon="slackIcon"
        :zo-backend-url="zoBackendUrl"
        :lang-list="langList"
        :selected-language="selectedLanguage"
        :selected-org="selectedOrg"
        :user-clicked-org="userClickedOrg"
        :organizations="orgOptions"
        :is-hovered="isHovered"
        :get-btn-logo="getBtnLogo"
        @update:selected-org="selectedOrg = $event"
        @update:is-hovered="isHovered = $event"
        @update-organization="updateOrganization"
        @go-to-home="goToHome"
        @go-to-about="goToAbout"
        @toggleAIChat="toggleAIChat"
        @open-slack="openSlack"
        @navigateToOpenAPI="navigateToOpenAPI"
        @navigate-to-docs="navigateToDocs"
        @change-language="changeLanguage"
        @open-predefined-themes="openPredefinedThemes"
        @open-shortcuts="openShortcutsList"
        @signout="signout"
      />
    </header>

    <div class="flex-1 flex min-h-0">
      <ONavbar
        v-if="store.state.printMode !== true"
        :links-list="navLinks"
        :mini-mode="miniMode"
        :visible="leftDrawerOpen"
        @menu-hover="handleMenuHover"
      />

      <div class="flex-1 min-w-0 flex min-h-0 h-full">
        <!-- Main Panel -->
        <main
          data-test="main-content"
          class="flex flex-col min-h-0 bg-surface-chrome-deeper pr-2 pb-2"
          :style="{
            width:
              store.state.isAiChatEnabled && !store.state.isAiChatExpanded
                ? '75%'
                : '100%',
          }"
        >
          <!-- Content card — all pages render inside this. The border stays present in both
               themes (transparent in light) so toggling dark mode can't shift page content by 1px. -->
          <div
            class="flex-1 flex flex-col min-h-0 bg-surface-base rounded-surface overflow-hidden border shadow-[0_1px_3px_rgba(16,40,55,0.06),0_6px_20px_rgba(16,40,55,0.08)]"
            :class="isDark ? 'border-border-default' : 'border-transparent'"
          >
            <div
              v-if="isLoading"
              :key="store.state.selectedOrganization?.identifier"
              class="o2-content-scroll flex-1 overflow-y-auto h-full"
            >
              <router-view v-slot="{ Component }">
                <component :is="Component" class="h-full" @sendToAiChat="sendToAiChat" />
              </router-view>
            </div>
          </div>
        </main>

        <!-- Right Panel (AI Chat - unified for both general and context-specific usage) -->
        <aside
          v-show="store.state.isAiChatEnabled && isLoading"
          class="o2-sidebar o2-sidebar-right overflow-y-auto sticky top-[var(--navbar-height,2.25rem)] self-start shrink-0"
          :class="[
            isDark
              ? 'dark-mode-chat-container'
              : 'light-mode-chat-container',
            { 'o2-sidebar--expanded': store.state.isAiChatExpanded },
          ]"
          :style="[
            {
              height: 'calc(100vh - var(--navbar-height, 2.25rem))',
            },
            store.state.isAiChatExpanded
              ? {
                  position: 'fixed',
                  top: 0,
                  right: 0,
                  width: '50%',
                  maxWidth: '100%',
                  minWidth: '18.75rem',
                  height: '100vh',
                  zIndex: 200,
                }
              : {
                  width: '25%',
                  maxWidth: '100%',
                  minWidth: '4.688rem',
                },
          ]"
        >
          <O2AIChat
            :header-height="42.5"
            :is-open="store.state.isAiChatEnabled"
            @close="closeChat"
            :aiChatInputContext="aiChatInputContext"
            :appendMode="aiChatAppendMode"
            :aiChatPayload="aiChatPayload"
          />
        </aside>
    </div>
    </div>

    <ODialog data-test="main-layout-get-started-dialog" v-model:open="showGetStarted" size="full" :show-close="false">
      <GetStarted @removeFirstTimeLogin="removeFirstTimeLogin" />
    </ODialog>
    <CommunitySlackInvite />
    <PredefinedThemes />
    <ShortcutCheatsheet v-model:open="showShortcuts" />
  </div>
</template>

<script lang="ts">
import ONavbar from "@/lib/core/Navbar/ONavbar.vue";
import type { NavItem } from "@/lib/core/Navbar/ONavbar.types";
import AppHeader from "../components/Header.vue";
import { useI18n } from "vue-i18n";
import {
  useLocalCurrentUser,
  useLocalOrganization,
  useLocalUserInfo,
  getImageURL,
  invalidateLoginData,
  getDueDays,
  trialPeriodAllowedPath,
  emptyDataAllowedPaths,
} from "../utils/zincutils";

import {
  ref,
  defineComponent,
  KeepAlive,
  computed,
  onMounted,
  watch,
  markRaw,
  nextTick,
  onBeforeMount,
} from "vue";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { useRouter, RouterView } from "vue-router";
import config from "../aws-exports";

import { setLanguage } from "../utils/cookies";
import { getLocale } from "../locales";

import MainLayoutOpenSourceMixin from "@/mixins/mainLayout.mixin";
import MainLayoutCloudMixin from "@/enterprise/mixins/mainLayout.mixin";

import configService from "@/services/config";
import ThemeSwitcher from "../components/ThemeSwitcher.vue";
import PredefinedThemes from "../components/PredefinedThemes.vue";
import { usePredefinedThemes } from "@/composables/usePredefinedThemes";
import GetStarted from "@/components/login/GetStarted.vue";
import CommunitySlackInvite from "@/components/CommunitySlackInvite.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import SlackIcon from "@/components/icons/SlackIcon.vue";
import ManagementIcon from "@/components/icons/ManagementIcon.vue";
import organizations from "@/services/organizations";
import useStreams from "@/composables/useStreams";
import { openobserveRum } from "@openobserve/browser-rum";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import O2AIChat from "@/components/O2AIChat.vue";
import WebinarBanner from "@/components/WebinarBanner.vue";
import useRoutePrefetch from "@/composables/useRoutePrefetch";
import { toast, dismissAll } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { ShortcutCheatsheet } from "@/lib/vue-shortcut-manager";
import { useHomeDashboard } from "@/composables/useHomeDashboard";

let mainLayoutMixin: any = null;
if (config.isCloud == "true") {
  mainLayoutMixin = MainLayoutCloudMixin;
} else {
  mainLayoutMixin = MainLayoutOpenSourceMixin;
}

export default defineComponent({
  name: "MainLayout",
  mixins: [mainLayoutMixin],
  components: {
    AppHeader,
    WebinarBanner,
    "keep-alive": KeepAlive,
    ONavbar,
    "router-view": RouterView,
    SlackIcon,
    ManagementIcon,
    ThemeSwitcher,
    PredefinedThemes,
    O2AIChat,
    ShortcutCheatsheet,
    GetStarted,
    CommunitySlackInvite,
    ODialog,
  },
  methods: {
    navigateToDocs() {
      let docURL = "https://openobserve.ai/docs";
      if (
        this.config.isEnterprise == "true" &&
        this.store.state.zoConfig.custom_docs_url != ""
      ) {
        docURL = this.store.state.zoConfig.custom_docs_url;
      }
      window.open(docURL, "_blank");
    },
    navigateToOpenAPI(zoBackendUrl: string) {
      window.open(zoBackendUrl + "/swagger/index.html", "_blank");
    },
    signout() {
      this.closeSocket();

      // AI chat streams outlive their component by design, so navigating away
      // doesn't kill an answer. Logout has to stop them explicitly — otherwise
      // they keep streaming and writing chat history after sign-out.
      window.dispatchEvent(new Event("o2:abort-ai-streams"));

      // Clear any open notifications so they don't carry over past logout.
      dismissAll();

      // Stop session replay recording on logout
      if (this.store.state.zoConfig?.rum?.enabled) {
        openobserveRum.stopSessionReplayRecording();
      }

      // Always call backend logout to clear auth cookies (auth_tokens, auth_ext)
      // before clearing local state — prevents stale credentials from causing
      // 401 errors on the next login attempt (see #10900)
      invalidateLoginData();

      this.store.dispatch("logout");

      useLocalCurrentUser("", true);
      useLocalUserInfo("", true);

      this.$router.push("/logout");
    },
    goToHome() {
      this.$router.push({
        path: "/",
        query: {
          org_identifier: this.store.state.selectedOrganization.identifier,
        },
      });
    },
    goToAbout() {
      this.$router.push({
        path: "/about",
        query: {
          org_identifier: this.store.state.selectedOrganization.identifier,
        },
      });
    },
    changeLanguage(item: { code: string; label: string }) {
      setLanguage(item.code);
      window.location.reload();
    },
  },
  setup() {
    const store: any = useStore();
    const { isDark } = useTheme();
    const router: any = useRouter();
    const { t } = useI18n();
    const miniMode = ref(false);
    const zoBackendUrl = store.state.API_ENDPOINT;
    const isLoading = ref(false);

    const { getStreams, resetStreams } = useStreams();
    const { closeSocket } = useSearchWebSocket();
    const { isOpen: isPredefinedThemesOpen, toggleThemes } =
      usePredefinedThemes();
    const { prefetchRoute } = useRoutePrefetch();

    const isMonacoEditorLoaded = ref(false);
    const showGetStarted = ref(
      (localStorage.getItem("isFirstTimeLogin") ?? "false") === "true",
    );
    const isHovered = ref(false);
    const aiChatInputContext = ref("");
    const aiChatAppendMode = ref(true);
    const aiChatPayload = ref<{
      text: string;
      autoSend: boolean;
      id: number;
    } | null>(null);
    let customOrganization = Object.prototype.hasOwnProperty.call(
      router.currentRoute.value.query,
      "org_identifier",
    )
      ? router.currentRoute.value.query.org_identifier
      : undefined;
    const selectedOrg = ref(store.state.selectedOrganization);
    const userClickedOrg = ref(store.state.selectedOrganization);
    const isActionsEnabled = computed(() => {
      return (
        (config.isEnterprise == "true" || config.isCloud == "true") &&
        store.state.zoConfig.actions_enabled
      );
    });

    const isIncidentsEnabled = computed(() => {
      return (
        (config.isEnterprise == "true" || config.isCloud == "true") &&
        store.state.zoConfig.incidents_enabled
      );
    });

    // Workflows — enterprise/cloud only (FD3). Build-time gate, no runtime flag.
    // Enterprise/cloud build AND the backend `/config` flag `workflows_enabled`
    // (enterprise `O2_WORKFLOWS_ENABLED`). Reactive so the menu picks it up
    // regardless of whether the config response arrived before or after mount.
    // `=== true`, not truthy: /config is fetched without await, so the flag is
    // briefly undefined and the entry must stay hidden rather than flash in.
    const isWorkflowsEnabled = computed(
      () =>
        (config.isEnterprise == "true" || config.isCloud == "true") &&
        store.state.zoConfig?.workflows_enabled === true,
    );

    // Backend `/config` flag `online_evals_enabled` — controlled by
    // enterprise `O2_ONLINE_EVALS_ENABLED`. Reactive so the menu picks it up regardless
    // of whether the config response arrived before or after this component
    // mounted.
    const isOnlineEvalsEnabled = computed(() => {
      return (
        (config.isEnterprise == "true" || config.isCloud == "true") &&
        Boolean(store.state.zoConfig?.online_evals_enabled)
      );
    });

    // Backend `/config` flag `synthetics_enabled` — controlled by enterprise
    // `O2_SYNTHETICS_ENABLED`. Reactive so the menu picks it up regardless of
    // whether the config response arrived before or after mount.
    const isSyntheticsEnabled = computed(() => {
      return (
        (config.isEnterprise == "true" || config.isCloud == "true") &&
        Boolean(store.state.zoConfig?.synthetics_enabled)
      );
    });

    // Real entries carry `identifier`; the placeholder literal only sets label/value.
    const orgOptions = ref<Array<{ identifier?: string; [key: string]: unknown }>>(
      [{ label: Number, value: String }],
    );
    let slackURL = "https://short.openobserve.ai/community";
    if (
      config.isEnterprise == "true" &&
      store.state.zoConfig.custom_slack_url
    ) {
      slackURL = store.state.zoConfig.custom_slack_url;
    }

    let user = store.state.userInfo;

    var linksList = ref<NavItem[]>([
      {
        title: t("menu.home"),
        icon: "home",
        link: "/",
        exact: true,
        name: "home",
      },
      {
        title: t("menu.search"),
        icon: "search",
        link: "/logs",
        name: "logs",
      },
      {
        title: t("menu.metrics"),
        icon: "bar-chart",
        link: "/metrics",
        name: "metrics",
      },
      {
        title: t("menu.traces"),
        icon: "account-tree",
        link: "/traces",
        name: "traces",
      },
      {
        title: t("menu.rum"),
        icon: "devices",
        link: "/rum",
        name: "rum",
      },
      {
        title: t("menu.dashboard"),
        icon: "dashboard",
        link: "/dashboards",
        name: "dashboards",
      },
      {
        title: t("menu.index"),
        icon: "window",
        link: "/streams",
        name: "streams",
      },
      {
        title: t("menu.alerts"),
        icon: "shield-alert-outline",
        link: "/alerts",
        name: "alertList",
      },
      {
        title: t("menu.ingestion"),
        icon: "data-plus-line",
        link: "/ingestion",
        name: "ingestion",
      },
      {
        title: t("menu.iam"),
        icon: "manage-accounts",
        link: "/iam",
        display: store.state?.currentuser?.role == "admin" ? true : false,
        name: "iam",
      },
      {
        title: t("menu.settings"),
        icon: "settings",
        link: "/settings",
        name: "settings",
      },
    ]);

    // Reveal the rail only once its item list is settled — true immediately when
    // config is cached, else set when getConfig() resolves. Avoids config-driven
    // tiles popping in and shifting the layout.
    const menuReady = ref(
      !!(
        store.state.zoConfig &&
        Object.prototype.hasOwnProperty.call(store.state.zoConfig, "version") &&
        store.state.zoConfig.version != ""
      ),
    );
    const navLinks = computed(() => (menuReady.value ? linksList.value : []));

    const langList = [
      {
        label: "English",
        code: "en-us",
      },
      {
        label: "Türkçe",
        code: "tr-turk",
      },
      {
        label: "简体中文",
        code: "zh-cn",
      },
      {
        label: "繁體中文",
        code: "zh-tw",
      },
      {
        label: "Français",
        code: "fr",
      },
      {
        label: "Español",
        code: "es",
      },
      {
        label: "Deutsch",
        code: "de",
      },
      {
        label: "Italiano",
        code: "it",
      },
      {
        label: "日本語",
        code: "ja",
      },
      {
        label: "한국어",
        code: "ko",
      },
      {
        label: "Nederlands",
        code: "nl",
      },
      {
        label: "Português",
        code: "pt",
      },
      {
        label: "Русский",
        code: "ru",
      },
      {
        label: "Polski",
        code: "pl",
      },
      {
        label: "Tiếng Việt",
        code: "vi",
      },
    ];

    onBeforeMount(() => {
      try {
        const url = new URL(window.location.href);
        const localOrg: any = useLocalOrganization();
        if (
          Object.keys(localOrg.value).length == 0 &&
          url.searchParams.get("org_identifier") != null
        ) {
          localOrg.value = {
            identifier: url.searchParams.get("org_identifier"),
            user_email: store.state.userInfo.email,
          };

          selectedOrg.value = localOrg.value;
          useLocalOrganization(localOrg.value);
          store.dispatch("setSelectedOrganization", localOrg.value);
        }
      } catch (error) {
        console.error("Error in onBeforeMount:", error);
      }
    });

    watch(
      () => store.state.isWebinarBannerVisible,
      (visible) => {
        const navbarHeight = visible ? "calc(2.5rem + 1.688rem)" : "2.5rem";
        document.documentElement.style.setProperty(
          "--navbar-height",
          navbarHeight,
        );
      },
      { immediate: true },
    );

    onMounted(async () => {
      filterMenus();

      // TODO OK : Clean get config functions which sets rum user and functions menu. Move it to common method.
      if (
        !Object.prototype.hasOwnProperty.call(store.state.zoConfig, "version") ||
        store.state.zoConfig.version == ""
      ) {
        getConfig();
      } else {
        if (config.isCloud == "false") {
          linksList.value = mainLayoutMixin
            .setup()
            .leftNavigationLinks(linksList, t);
          filterMenus();
        }
        menuReady.value = true;
        await nextTick();
        // if rum enabled then setUser to capture session details.
        if (store.state.zoConfig.rum?.enabled) {
          setRumUser();
        }
      }
    });

    const updateIncidentsMenu = () => {
      if (isIncidentsEnabled.value) {
        const alertIndex = linksList.value.findIndex(
          (link) => link.name === "alertList",
        );

        const incidentExists = linksList.value.some(
          (link) => link.name === "incidentList",
        );

        if (alertIndex !== -1 && !incidentExists) {
          linksList.value.splice(alertIndex + 1, 0, {
            title: t("menu.incidents"),
            icon: "notifications-active",
            link: "/incidents",
            name: "incidentList",
          });
        }
      }
    };

    const updateActionsMenu = () => {
      if (isActionsEnabled.value) {
        const incidentIndex = linksList.value.findIndex(
          (link) => link.name === "incidentList",
        );

        const actionExists = linksList.value.some(
          (link) => link.name === "actionScripts",
        );

        if (incidentIndex !== -1 && !actionExists) {
          linksList.value.splice(incidentIndex + 1, 0, {
            title: t("menu.actions"),
            icon: "code",
            link: "/actions",
            name: "actionScripts",
          });
        }
      }
    };

    // Insert the Workflows entry after Actions (fallback: Alerts). Idempotent.
    const updateWorkflowsMenu = () => {
      const existingIndex = linksList.value.findIndex(
        (link) => link.name === "workflows",
      );

      if (isWorkflowsEnabled.value) {
        if (existingIndex !== -1) return;

        const actionIndex = linksList.value.findIndex(
          (link) => link.name === "actionScripts",
        );
        const alertIndex = linksList.value.findIndex(
          (link) => link.name === "alertList",
        );
        const anchor = actionIndex !== -1 ? actionIndex : alertIndex;
        if (anchor === -1) return;

        linksList.value.splice(anchor + 1, 0, {
          title: t("menu.workflows"),
          icon: "schema",
          link: "/workflows",
          name: "workflows",
        });
      } else if (existingIndex !== -1) {
        // The entry must be REMOVED, not just skipped: the menu is rebuilt on
        // org switch and `workflows_enabled` can differ per deployment, so an
        // add-only guard would leave a stale entry behind.
        linksList.value.splice(existingIndex, 1);
      }
    };

    // If `/config` resolves after this component mounted (or the flag flips),
    // keep the menu in sync — same contract as the other flag-driven entries.
    watch(isWorkflowsEnabled, () => updateWorkflowsMenu(), { immediate: false });
    const splitterModel = ref(100);
    const selectedLanguage: any =
      langList.find((l) => l.code == getLocale()) || langList[0];

    // Insert / remove the AI Observability menu entry based on the live config
    // flag. Position: directly after Traces. Idempotent — safe to call from
    // multiple lifecycle hooks.
    const updateAIObservabilityMenu = () => {
      const existingIndex = linksList.value.findIndex(
        (link: any) => link.name === "aiObservability",
      );

      if (isOnlineEvalsEnabled.value) {
        if (existingIndex !== -1) return;
        const tracesIndex = linksList.value.findIndex(
          (link: any) => link.name === "traces",
        );
        const insertAt = tracesIndex === -1 ? linksList.value.length : tracesIndex + 1;
        linksList.value.splice(insertAt, 0, {
          title: t("menu.aiObservability"),
          icon: "auto-awesome",
          link: "/ai",
          name: "aiObservability",
        });
      } else if (existingIndex !== -1) {
        linksList.value.splice(existingIndex, 1);
      }
    };

    // If `/config` resolves after this component mounted (or if the flag
    // ever flips at runtime), keep the menu in sync.
    watch(isOnlineEvalsEnabled, () => updateAIObservabilityMenu(), { immediate: false });

    const updateSyntheticMenu = () => {
      const existingIndex = linksList.value.findIndex(
        (l: any) => l.name === "synthetics",
      );

      if (!isSyntheticsEnabled.value) {
        if (existingIndex !== -1) linksList.value.splice(existingIndex, 1);
        return;
      }
      if (existingIndex !== -1) return;

      const incidentIndex = linksList.value.findIndex(
        (l: any) => l.name === "incidentList",
      );
      const alertIndex = linksList.value.findIndex(
        (l: any) => l.name === "alertList",
      );
      const insertAt =
        incidentIndex !== -1
          ? incidentIndex + 1
          : alertIndex !== -1
            ? alertIndex + 1
            : linksList.value.length;

      linksList.value.splice(insertAt, 0, {
        title: t("menu.synthetic"),
        icon: "radar",
        link: "/synthetics",
        name: "synthetics",
      });
    };

    // Keep the menu in sync if /config resolves after mount.
    watch(isSyntheticsEnabled, () => updateSyntheticMenu(), {
      immediate: false,
    });

    const filterMenus = () => {
      updateIncidentsMenu();
      updateActionsMenu();
      updateWorkflowsMenu();
      updateSyntheticMenu();
      updateAIObservabilityMenu();

      const disableMenus = new Set(
        store.state.zoConfig?.custom_hide_menus
          ?.split(",")
          ?.filter((val: string) => val?.trim()) || [],
      );

      store.dispatch("setHiddenMenus", disableMenus);

      linksList.value = linksList.value.filter((link: any) => {
        const hide = link.hide === undefined ? false : link.hide;

        return !disableMenus.has(link.name) && !hide;
      });
    };

    // additional links based on environment and conditions
    if (config.isCloud == "true") {
      linksList.value = mainLayoutMixin
        .setup()
        .leftNavigationLinks(linksList, t);
      filterMenus();
    } else {
      linksList.value.splice(7, 0, {
        title: t("menu.report"),
        icon: "description",
        link: "/reports",
        name: "reports",
      });
      filterMenus();
    }

    //orgIdentifier query param exists then clear the localstorage and store.
    if (store.state.selectedOrganization != null) {
      if (
        mainLayoutMixin.setup().customOrganization != undefined &&
        mainLayoutMixin.setup().customOrganization !=
          store.state.selectedOrganization?.identifier
      ) {
        useLocalOrganization("");
        store.dispatch("setSelectedOrganization", {});
      }
    }

    const updateOrganization = async () => {
      resetStreams();
      store.dispatch("logs/resetLogs");
      store.dispatch("setIsDataIngested", false);
      const orgIdentifier = selectedOrg.value.identifier;
      const queryParams =
        router.currentRoute.value.path.indexOf(".logs") > -1
          ? router.currentRoute.value.query
          : {};
      router.push({
        path: router.currentRoute.value.path,
        query: {
          ...queryParams,
          org_identifier: orgIdentifier,
        },
      });
      useLocalOrganization(selectedOrg.value);
      store.dispatch("setSelectedOrganization", { ...selectedOrg.value });
      // setSelectedOrganization();
      // if (
      //   config.isCloud &&
      //   selectedOrg.value.subscription_type == config.freePlan
      // ) {
      //   await billings
      //     .list_subscription(selectedOrg.value.identifier)
      //     .then(async (res: any) => {
      //       if (res.data.data.length == 0) {
      //         router.push({ name: "plans" });
      //       } else if (
      //         res.data.data.CustomerBillingObj.customer_id == null ||
      //         res.data.data.CustomerBillingObj.customer_id == ""
      //       ) {
      //         router.push({ name: "plans" });
      //       } else {
      //         await verifyStreamExist(selectedOrg.value);
      //       }
      //     });
      // } else {
      if (
        Object.prototype.hasOwnProperty.call(
          store.state.zoConfig,
          "restricted_routes_on_empty_data",
        ) &&
        store.state.zoConfig.restricted_routes_on_empty_data == true &&
        store.state.organizationData.isDataIngested == false
      ) {
        await verifyStreamExist(selectedOrg.value);
      }
    };

    const verifyStreamExist = async (selectedOrgData: any) => {
      await getStreams("", false).then((response: any) => {
        store.dispatch("setSelectedOrganization", {
          ...selectedOrgData,
        });
        if (response.list.length == 0) {
          store.dispatch("setIsDataIngested", false);
          // IAM is org-setup, not data consumption — don't bounce out of IAM
          // screens just because no streams exist yet. General Settings is exempt
          // because it hosts the Danger Zone: switching to an empty org must still
          // leave the admin able to delete it. Mirrors the routeGuard exemptions —
          // General only, not the rest of the Settings tree.
          const currentPath = router.currentRoute.value.path || "";
          if (
            currentPath.indexOf("/iam") !== -1 ||
            emptyDataAllowedPaths.indexOf(currentPath.replace(/\/$/, "")) !== -1
          ) {
            return;
          }
          toast({
            variant: "warning",
            message:
              "You haven't initiated the data ingestion process yet. To explore other pages, please start the data ingestion.",
            timeout: 5000,
          });
          router.push({ name: "ingestion" });
        } else {
          store.dispatch("setIsDataIngested", true);
        }
      });
    };

    const setSelectedOrganization = async () => {
      try {
        customOrganization = Object.prototype.hasOwnProperty.call(
          router.currentRoute.value.query,
          "org_identifier",
        )
          ? router.currentRoute.value.query.org_identifier
          : "";
        let tempDefaultOrg = {};
        let localOrgFlag = false;
        const url = new URL(window.location.href);

        // If the org the user is currently on (URL or stored) is no longer in the
        // available list, it is being deleted (the backend hides deleting orgs from
        // this list). Warn the user, then fall through to default-org selection and
        // redirect home so the stale org_identifier query param is dropped.
        const intendedOrgId =
          customOrganization ||
          (useLocalOrganization()?.value?.identifier ?? "");
        const orgs = store.state.organizations || [];
        if (
          intendedOrgId &&
          orgs.length > 0 &&
          !orgs.some((o: any) => o.identifier === intendedOrgId)
        ) {
          toast({
            variant: "warning",
            message: t("organization.orgBeingDeletedSwitching"),
          });
          // Clear stale selection so the logic below picks the default org.
          customOrganization = "";
          useLocalOrganization("");
          selectedOrg.value = {};
          store.dispatch("setSelectedOrganization", {});
          if (router.currentRoute.value.query.org_identifier) {
            router.replace({ path: "/", query: {} });
          }
        }
        if (store.state.organizations?.length > 0) {
          const localOrg: any = useLocalOrganization();
          if (
            Object.keys(localOrg.value).length == 0 &&
            url.searchParams.get("org_identifier") != null
          ) {
            localOrg.value = {
              identifier: url.searchParams.get("org_identifier"),
              user_email: store.state.userInfo.email,
            };
          }
          orgOptions.value = store.state.organizations
            .map(
              (data: {
                id: any;
                name: any;
                type: any;
                identifier: any;
                UserObj: any;
                ingest_threshold: number;
                search_threshold: number;
                CustomerBillingObj: { subscription_type: string; note: string };
                status: string;
              }) => {
                const optiondata: any = {
                  label: data.name,
                  id: data.id,
                  identifier: data.identifier,
                  user_email: store.state.userInfo.email,
                  ingest_threshold: data.ingest_threshold,
                  search_threshold: data.search_threshold,
                  subscription_type: Object.prototype.hasOwnProperty.call(data, "CustomerBillingObj")
                    ? data.CustomerBillingObj.subscription_type
                    : "",
                  status: data.status,
                  note: Object.prototype.hasOwnProperty.call(data, "CustomerBillingObj")
                    ? data.CustomerBillingObj.note
                    : "",
                };

                if (
                  config.isCloud == "true" &&
                  localOrg.value?.identifier == data?.identifier &&
                  (customOrganization == "" || customOrganization == undefined)
                ) {
                  // localOrg.value.subscription_type =
                  //   data.CustomerBillingObj.subscription_type;
                  // useLocalOrganization(localOrg.value);
                  useLocalOrganization(optiondata);
                }

                if (
                  localOrg.value.identifier == data.identifier ||
                  url.searchParams.get("org_identifier") == data.identifier
                ) {
                  localOrgFlag = true;
                }

                if (
                  (Object.keys(selectedOrg.value).length == 0 &&
                    data.type == "default" &&
                    store.state.userInfo.email == data.UserObj.email &&
                    (customOrganization == "" ||
                      customOrganization == undefined)) ||
                  (store.state.organizations?.length == 1 &&
                    (customOrganization == "" ||
                      customOrganization == undefined))
                ) {
                  selectedOrg.value = localOrg.value
                    ? localOrg.value
                    : optiondata;
                  useLocalOrganization(optiondata);
                  store.dispatch("setSelectedOrganization", optiondata);
                } else if (data.identifier == customOrganization) {
                  selectedOrg.value = optiondata;
                  useLocalOrganization(optiondata);
                  store.dispatch("setSelectedOrganization", optiondata);
                }

                if (data.type == "default") {
                  tempDefaultOrg = optiondata;
                }

                return optiondata;
              },
            )
            .sort((a: any, b: any) => a.label.localeCompare(b.label));
        }

        if (localOrgFlag == false) {
          selectedOrg.value = tempDefaultOrg;
          useLocalOrganization(tempDefaultOrg);
          store.dispatch("setSelectedOrganization", tempDefaultOrg);
        }

        if (
          Object.keys(selectedOrg.value).length == 0 &&
          store.state.organizations.length > 0
        ) {
          let data = store.state.organizations[0];
          let optiondata = {
            label: data.name,
            id: data.id,
            identifier: data.identifier,
            user_email: store.state.userInfo.email,
            ingest_threshold: data.ingest_threshold,
            search_threshold: data.search_threshold,
            subscription_type: Object.prototype.hasOwnProperty.call(data, "CustomerBillingObj")
              ? data.CustomerBillingObj.subscription_type
              : "",
            status: data.status,
            note: Object.prototype.hasOwnProperty.call(data, "CustomerBillingObj")
              ? data.CustomerBillingObj.note
              : "",
          };
          selectedOrg.value = optiondata;
          useLocalOrganization(optiondata);
          store.dispatch("setSelectedOrganization", optiondata);
        }

        if (router.currentRoute.value.query.action == "subscribe") {
          router.push({
            name: "plans",
            query: {
              org_identifier: selectedOrg.value.identifier,
            },
          });
        }

        if (
          Object.keys(selectedOrg.value).length > 0 &&
          selectedOrg.value.identifier != "" &&
          selectedOrg.value.identifier != undefined
        ) {
          await getOrganizationSettings();
          isLoading.value = true;
        }
      } catch (error) {
        console.error("Error in setSelectedOrganization:", error);
      }
    };

    // get organizations settings on first load and identifier change
    const getOrganizationSettings = async () => {
      // Default settings to use if API call fails
      const defaultSettings = {
        scrape_interval: 15,
        span_id_field_name: "spanId",
        trace_id_field_name: "traceId",
        toggle_ingestion_logs: false,
        usage_stream_enabled: false,
        enable_websocket_search: false,
        enable_streaming_search: false,
        streaming_aggregation_enabled: false,
        free_trial_expiry: "",
        light_mode_theme_color: undefined,
        dark_mode_theme_color: undefined,
        claim_parser_function: "",
        org_storage_enabled: false,
      };

      try {
        //get organizations settings
        const orgSettings: any = await organizations.get_organization_settings(
          store.state?.selectedOrganization?.identifier,
        );

        //set settings in store
        //scrape interval will be in number
        store.dispatch("setOrganizationSettings", {
          scrape_interval:
            orgSettings?.data?.data?.scrape_interval ??
            defaultSettings.scrape_interval,
          span_id_field_name:
            orgSettings?.data?.data?.span_id_field_name ??
            defaultSettings.span_id_field_name,
          trace_id_field_name:
            orgSettings?.data?.data?.trace_id_field_name ??
            defaultSettings.trace_id_field_name,
          toggle_ingestion_logs:
            orgSettings?.data?.data?.toggle_ingestion_logs ??
            defaultSettings.toggle_ingestion_logs,
          usage_stream_enabled:
            orgSettings?.data?.data?.usage_stream_enabled ??
            defaultSettings.usage_stream_enabled,
          enable_websocket_search:
            orgSettings?.data?.data?.enable_websocket_search ??
            defaultSettings.enable_websocket_search,
          enable_streaming_search:
            orgSettings?.data?.data?.enable_streaming_search ??
            defaultSettings.enable_streaming_search,
          streaming_aggregation_enabled:
            orgSettings?.data?.data?.streaming_aggregation_enabled ??
            defaultSettings.streaming_aggregation_enabled,
          free_trial_expiry:
            orgSettings?.data?.data?.free_trial_expiry ??
            defaultSettings.free_trial_expiry,
          light_mode_theme_color:
            orgSettings?.data?.data?.light_mode_theme_color,
          dark_mode_theme_color: orgSettings?.data?.data?.dark_mode_theme_color,
          claim_parser_function:
            orgSettings?.data?.data?.claim_parser_function ??
            defaultSettings.claim_parser_function,
          cross_links: orgSettings?.data?.data?.cross_links ?? [],
          org_storage_enabled:
            orgSettings?.data?.data?.org_storage_enabled ??
            defaultSettings.org_storage_enabled,
        });

        // Load the org's home dashboard (settings/v2 KV) alongside the legacy org
        // settings so it's available on boot and every org switch.
        await useHomeDashboard().load(
          store.state?.selectedOrganization?.identifier,
        );

        if (
          orgSettings?.data?.data?.free_trial_expiry != null &&
          orgSettings?.data?.data?.free_trial_expiry != ""
        ) {
          const trialDueDays = getDueDays(
            orgSettings?.data?.data?.free_trial_expiry,
          );
          if (
            trialDueDays <= 0 &&
            trialPeriodAllowedPath.indexOf(router.currentRoute.value.name) == -1
          ) {
            router.push({
              name: "plans",
              query: {
                org_identifier: selectedOrg.value.identifier,
              },
            });
          }
        }
      } catch (error: any) {
        // Handle permission errors gracefully (403 = Forbidden)
        if (error?.response?.status === 403) {
          console.warn(
            "Organization settings access denied (403). Using default settings.",
          );
          // Set default settings when access is denied
          store.dispatch("setOrganizationSettings", defaultSettings);
        } else {
          console.error("Error in getOrganizationSettings:", error);
          // Still set defaults for other errors to prevent undefined values
          store.dispatch("setOrganizationSettings", defaultSettings);
        }
      }
      return;
    };

    /**
     * Get configuration from the backend.
     * @return {"version":"","instance":"","commit_hash":"","build_date":"","default_fts_keys":["field1","field2"],"telemetry_enabled":true,"default_functions":[{"name":"function name","text":"match_all('v')"}}
     * @throws {Error} If the request fails.
     */
    const getConfig = async () => {
      await configService
        .get_config()
        .then(async (res: any) => {
          if (config.isCloud == "false") {
            linksList.value = mainLayoutMixin
              .setup()
              .leftNavigationLinks(linksList, t);
          }

          store.dispatch("setConfig", res.data);
          await nextTick();

          filterMenus();
          menuReady.value = true;
          // if rum enabled then setUser to capture session details.
          if (res.data.rum.enabled) {
            setRumUser();
          }
        })
        .catch((error) => {
          console.log(error);
          // Fail open: reveal the base menu even if /config never resolves.
          menuReady.value = true;
        });
    };

    if (config.isCloud == "true") {
      mainLayoutMixin.setup().getDefaultOrganization(store);
    }

    const setRumUser = () => {
      if (store.state.zoConfig?.rum?.enabled == true) {
        const userInfo = store.state.userInfo;
        // Set user information first
        openobserveRum.setUser({
          name: userInfo.given_name + " " + userInfo.family_name,
          email: userInfo.email,
        });
        // Start session replay recording after user is identified
        // This handles cases where user refreshes the page or accesses app directly
        openobserveRum.startSessionReplayRecording({ force: true });
      }
    };

    const prefetch = () => {
      const href = "/web/assets/editor.api.v1.js";
      const existingLink = document.querySelector(
        `link[rel="prefetch"][href="${href}"]`,
      );

      if (!existingLink) {
        // Create a new link element
        isMonacoEditorLoaded.value = true;
        const link = document.createElement("link");
        link.rel = "prefetch";
        link.href = href;
        document.head.appendChild(link);
      }
    };

    const expandMenu = () => {
      // miniMode.value = false;
      if (!isMonacoEditorLoaded.value) prefetch();
    };

    const openSlack = () => {
      window.open(slackURL, "_blank");
    };

    const toggleAIChat = () => {
      // On the home page, switch to the AI tab instead of opening the side panel
      if (router.currentRoute.value.name === "home") {
        window.dispatchEvent(
          new CustomEvent("o2:home-switch-tab", { detail: "ai" }),
        );
        return;
      }
      if (!store.state.isAiChatEnabled) {
        // Closed → Open inline sidebar
        store.dispatch("setIsAiChatEnabled", true);
        store.dispatch("setIsAiChatExpanded", false);
      } else if (!store.state.isAiChatExpanded) {
        // Inline sidebar → Close
        store.dispatch("setIsAiChatEnabled", false);
        store.dispatch("setIsAiChatExpanded", false);
      } else {
        // Expanded overlay → Back to inline sidebar
        store.dispatch("setIsAiChatExpanded", false);
      }
      window.dispatchEvent(new Event("resize"));
    };

    const closeChat = () => {
      store.dispatch("setIsAiChatEnabled", false);
      store.dispatch("setIsAiChatExpanded", false);
      window.dispatchEvent(new Event("resize"));
    };

    const getBtnLogo = computed(() => {
      if (isDark.value) {
        return getImageURL("images/common/ai_icon_dark.svg");
      }

      if (isHovered.value) {
        return getImageURL("images/common/ai_icon_dark.svg");
      }

      return getImageURL("images/common/ai_icon_gradient.svg");
    });
    //this will be the function used to cancel the get started dialog and remove the isFirstTimeLogin from local storage
    //this will be called from the get started component whenever users clicks on the submit button
    const removeFirstTimeLogin = (val: boolean) => {
      showGetStarted.value = val;
      localStorage.removeItem("isFirstTimeLogin");
    };

    const sendToAiChat = (
      value: any,
      append: boolean = true,
      autoSend: boolean = false,
    ) => {
      if (!store.state.isAiChatEnabled) {
        store.dispatch("setIsAiChatEnabled", true);
      }

      // Support object payload { query, autoSend } from OverviewTab
      let text = value;
      let shouldAutoSend = autoSend;
      if (value && typeof value === "object" && "query" in value) {
        text = value.query;
        shouldAutoSend = value.autoSend ?? false;
      }

      aiChatAppendMode.value = append;

      // Deliver text + autoSend atomically in a single object so O2AIChat
      // watcher always sees both values together — no timing race.
      aiChatPayload.value = { text, autoSend: shouldAutoSend, id: Date.now() };

      // Keep legacy aiChatInputContext in sync for other callers
      aiChatInputContext.value = "";
      nextTick(() => {
        aiChatInputContext.value = text;
        nextTick(() => {
          aiChatInputContext.value = "";
        });
      });
    };

    const openPredefinedThemes = () => {
      toggleThemes();
    };

    /**
     * Prefetch route module on menu hover
     * @param routePath - The route path from the menu link
     */
    const handleMenuHover = (routePath: string) => {
      prefetchRoute(routePath);
    };

    // Sync the user-clicked org with the selected org
    watch(
      selectedOrg,
      (newVal) => {
        userClickedOrg.value = newVal;
      },
      { immediate: true },
    );

    // Home page has its own inline AI tab (see toggleAIChat's home special-case
    // above), so the sidebar chat panel is redundant there — close it on
    // arrival so we don't show both the sidebar and the home AI tab at once.
    watch(
      () => router.currentRoute.value.name,
      (routeName) => {
        if (routeName === "home" && store.state.isAiChatEnabled) {
          closeChat();
        }
      },
    );

    const showShortcuts = ref(false);
    const openShortcutsList = () => { showShortcuts.value = true; };

    // ── Global shortcuts: AI Chat ─────────────────────────────────────────
    useShortcuts([{ id: "aiChatToggle", handler: () => toggleAIChat() }]);

    return {
      isDark,
      t,
      router,
      store,
      config,
      langList,
      selectedLanguage,
      linksList,
      navLinks,
      selectedOrg,
      orgOptions,
      leftDrawerOpen: true,
      miniMode,
      user,
      zoBackendUrl,
      isLoading,
      getImageURL,
      updateOrganization,
      setSelectedOrganization,
      getOrganizationSettings,
      resetStreams,
      prefetch,
      expandMenu,
      slackIcon: markRaw(SlackIcon),
      openSlack,
      "settings": "settings",
      closeSocket,
      splitterModel,
      toggleAIChat,
      closeChat,
      getBtnLogo,
      isHovered,
      showGetStarted,
      removeFirstTimeLogin,
      sendToAiChat,
      aiChatInputContext,
      aiChatAppendMode,
      aiChatPayload,
      userClickedOrg,
      verifyStreamExist,
      filterMenus,
      updateActionsMenu,
      getConfig,
      setRumUser,
      openPredefinedThemes,
      showShortcuts,
      openShortcutsList,
      isPredefinedThemesOpen,
      handleMenuHover,
    };
  },
  computed: {
    changeOrganization() {
      return this.store?.state?.organizations;
    },
    changeOrganizationIdentifier() {
      return this.store?.state?.selectedOrganization?.identifier;
    },
    forceFetchOrganization() {
      return this.router?.currentRoute?.value?.query?.update_org;
    },
    changeUserInfo() {
      return this.store?.state?.userInfo;
    },
  },
  watch: {
    forceFetchOrganization() {
      mainLayoutMixin.setup().getDefaultOrganization(this.store);
    },
    changeOrganization: {
      handler() {
        this.setSelectedOrganization();
      },
      deep: true,
      immediate: true,
    },
    async changeOrganizationIdentifier() {
      this.isLoading = false;
      this.resetStreams();
      // Clear notifications from the previous org — they no longer apply.
      dismissAll();
      this.store.dispatch("setOrganizationPasscode", "");
      this.store.dispatch("resetOrganizationData", {});

      // Clear temporary theme colors when switching organizations
      // This ensures each org shows its own theme colors without preview colors from another org
      this.store.commit("clearTempThemeColors");

      await this.getOrganizationSettings();

      this.isLoading = true;
      // Find the matching organization from orgOptions
      const matchingOrg = this.orgOptions.find(
        (org) =>
          org.identifier === this.store.state.selectedOrganization.identifier,
      );

      if (matchingOrg) {
        this.selectedOrg = matchingOrg;
      }
    },
  },
});
</script>

<style scoped>
/* keep(print): This layout's root is the ONLY writer of `.printMode` (store.state.printMode,
   above), so the rule can only ever fire on descendants of that root — but
   `.hideOnPrintMode` is placed by other components (VariableAdHocValueSelector,
   pipeline/PipelineEditor, Dashboards/ViewDashboard) that render through
   <router-view> and so do not carry this scope id. :deep() pierces to them while
   keeping the ancestor condition scoped to the owner. */
.printMode :deep(.hideOnPrintMode) {
  display: none;
}
</style>


