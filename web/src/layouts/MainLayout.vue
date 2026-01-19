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
  <q-layout
    view="hHh Lpr lff"
    :class="[store.state.printMode === true ? 'printMode' : '']"
  >
    <q-header>
      <!-- Header component containing logo, navigation, and user controls -->
      <Header
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
        :filtered-organizations="filteredOrganizations"
        :search-query="searchQuery"
        :rows-per-page="rowsPerPage"
        :is-hovered="isHovered"
        :get-btn-logo="getBtnLogo"
        @update:selected-org="selectedOrg = $event"
        @update:search-query="searchQuery = $event"
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
        @signout="signout"
      />
    </q-header>

    <q-drawer
      v-model="drawer"
      show-if-above
      :width="84"
      :breakpoint="500"
      role="navigation"
      aria-label="Main navigation"
      class="card-container q-mt-xs tw:mb-[0.675rem]"
    >
      <q-list class="leftNavList">
        <menu-link
          v-for="(nav, index) in linksList"
          :key="nav.title"
          :link-name="nav.name"
          :animation-index="index"
          v-bind="{ ...nav, mini: miniMode }"
          @mouseenter="handleMenuHover(nav.link)"
        />
      </q-list>
    </q-drawer>
    <div class="row full-height no-wrap">
      <!-- Left Panel -->
      <div
        class="col"
        v-show="isLoading"
        :style="{ width: store.state.isAiChatEnabled ? '75%' : '100%' }"
        :key="store.state.selectedOrganization?.identifier"
      >
        <q-page-container v-if="isLoading">
          <router-view v-slot="{ Component }">
            <component :is="Component" @sendToAiChat="sendToAiChat" />
          </router-view>
        </q-page-container>
      </div>

      <!-- Right Panel (AI Chat) -->

      <div
        class="col-auto"
        v-show="store.state.isAiChatEnabled && isLoading"
        style="width: 25%; max-width: 100%; min-width: 75px; z-index: 10"
        :class="
          store.state.theme == 'dark'
            ? 'dark-mode-chat-container'
            : 'light-mode-chat-container'
        "
      >
        <O2AIChat
          :header-height="82.5"
          :is-open="store.state.isAiChatEnabled"
          @close="closeChat"
          :aiChatInputContext="aiChatInputContext"
        />
      </div>

      <!-- Right Panel (SRE Chat) -->
      <div
        class="col-auto"
        v-show="store.state.isSREChatOpen"
        style="width: 25%; max-width: 100%; min-width: 75px; z-index: 10"
        :class="
          store.state.theme == 'dark'
            ? 'dark-mode-chat-container'
            : 'light-mode-chat-container'
        "
      >
        <SREChat
          :header-height="82.5"
          :context-type="store.state.sreChatContext.type"
          :context-data="store.state.sreChatContext.data"
          @close="closeSREChat"
        />
      </div>
    </div>

    <q-dialog v-model="showGetStarted" maximized
full-height>
      <GetStarted @removeFirstTimeLogin="removeFirstTimeLogin" />
    </q-dialog>
    <PredefinedThemes />
  </q-layout>
</template>

<script lang="ts">
import {
  QPage,
  QPageContainer,
  QLayout,
  QDrawer,
  QList,
  QItem,
  QItemLabel,
  QItemSection,
  QBtn,
  QBtnDropdown,
  QToolbarTitle,
  QHeader,
  QToolbar,
  QAvatar,
  QIcon,
  QSelect,
  useQuasar,
} from "quasar";
import MenuLink from "../components/MenuLink.vue";
import Header from "../components/Header.vue";
import { useI18n } from "vue-i18n";
import {
  useLocalCurrentUser,
  useLocalOrganization,
  useLocalUserInfo,
  getImageURL,
  invalidateLoginData,
  getDueDays,
  trialPeriodAllowedPath,
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
import { useRouter, RouterView } from "vue-router";
import config from "../aws-exports";

import { setLanguage } from "../utils/cookies";
import { getLocale } from "../locales";

import MainLayoutOpenSourceMixin from "@/mixins/mainLayout.mixin";
import MainLayoutCloudMixin from "@/enterprise/mixins/mainLayout.mixin";

import configService from "@/services/config";
import streamService from "@/services/stream";
import billings from "@/services/billings";
import ThemeSwitcher from "../components/ThemeSwitcher.vue";
import PredefinedThemes from "../components/PredefinedThemes.vue";
import { usePredefinedThemes } from "@/composables/usePredefinedThemes";
import GetStarted from "@/components/login/GetStarted.vue";
import {
  outlinedHome,
  outlinedSearch,
  outlinedBarChart,
  outlinedAccountTree,
  outlinedDashboard,
  outlinedWindow,
  outlinedReportProblem,
  outlinedFilterAlt,
  outlinedPerson,
  outlinedFormatListBulleted,
  outlinedSettings,
  outlinedManageAccounts,
  outlinedDescription,
  outlinedCode,
  outlinedDevices,
  outlinedNotificationsActive,
} from "@quasar/extras/material-icons-outlined";
import SlackIcon from "@/components/icons/SlackIcon.vue";
import ManagementIcon from "@/components/icons/ManagementIcon.vue";
import organizations from "@/services/organizations";
import useStreams from "@/composables/useStreams";
import { openobserveRum } from "@openobserve/browser-rum";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import O2AIChat from "@/components/O2AIChat.vue";
import SREChat from "@/components/SREChat.vue";
import useRoutePrefetch from "@/composables/useRoutePrefetch";

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
    "menu-link": MenuLink,
    Header,
    "keep-alive": KeepAlive,
    "q-page": QPage,
    "q-page-container": QPageContainer,
    "q-layout": QLayout,
    "q-drawer": QDrawer,
    "q-list": QList,
    "q-item": QItem,
    "q-item-label": QItemLabel,
    "q-item-section": QItemSection,
    "q-btn": QBtn,
    "q-btn-dropdown": QBtnDropdown,
    "q-toolbar-title": QToolbarTitle,
    "q-header": QHeader,
    "q-toolbar": QToolbar,
    "router-view": RouterView,
    "q-avatar": QAvatar,
    "q-icon": QIcon,
    "q-select": QSelect,
    SlackIcon,
    ManagementIcon,
    ThemeSwitcher,
    PredefinedThemes,
    O2AIChat,
    SREChat,
    GetStarted,
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

      if (config.isEnterprise == "true") {
        invalidateLoginData();
      }
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
    changeLanguage(item: { code: string; label: string; icon: string }) {
      setLanguage(item.code);
      window.location.reload();
    },
  },
  setup() {
    const store: any = useStore();
    const router: any = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const miniMode = ref(false);
    const zoBackendUrl = store.state.API_ENDPOINT;
    const isLoading = ref(false);

    const { getStreams, resetStreams } = useStreams();
    const { closeSocket } = useSearchWebSocket();
    const { isOpen: isPredefinedThemesOpen, toggleThemes } = usePredefinedThemes();
    const { prefetchRoute } = useRoutePrefetch();

    const isMonacoEditorLoaded = ref(false);
    const showGetStarted = ref(
      (localStorage.getItem("isFirstTimeLogin") ?? "false") === "true",
    );
    const isHovered = ref(false);
    const aiChatInputContext = ref("");
    const rowsPerPage = ref(10);
    const searchQuery = ref("");

    const filteredOrganizations = computed(() => {
      //we will return all organizations if searchQuery is empty
      //else we will search based upon label or identifier that we get from the search query
      //if anyone of the orgs matches either label or identifier then we will return that orgs
      if (!searchQuery.value) return orgOptions.value;
      const toBeSearched = searchQuery.value.toLowerCase().trim();
      return orgOptions.value.filter((org: any) => {
        const labelMatch = org.label?.toLowerCase().includes(toBeSearched);
        const identifierMatch = org.identifier
          ?.toLowerCase()
          .includes(toBeSearched);
        return labelMatch || identifierMatch;
      });
    });

    let customOrganization = router.currentRoute.value.query.hasOwnProperty(
      "org_identifier",
    )
      ? router.currentRoute.value.query.org_identifier
      : undefined;
    const selectedOrg = ref(store.state.selectedOrganization);
    const userClickedOrg = ref(store.state.selectedOrganization);
    const excludeParentRedirect = [
      "pipeline",
      "functionList",
      "streamFunctions",
      "enrichmentTables",
      "alertList",
      "alertDestinations",
      "alertTemplates",
      "/ingestion/",
    ];

    const isActionsEnabled = computed(() => {
      return (
        (config.isEnterprise == "true" || config.isCloud == "true") &&
        store.state.zoConfig.actions_enabled
      );
    });

    const orgOptions = ref([{ label: Number, value: String }]);
    let slackURL = "https://short.openobserve.ai/community";
    if (
      config.isEnterprise == "true" &&
      store.state.zoConfig.custom_slack_url != ""
    ) {
      slackURL = store.state.zoConfig.custom_slack_url;
    }

    let user = store.state.userInfo;

    var linksList = ref([
        {
          title: t("menu.home"),
          icon: outlinedHome,
          link: "/",
          exact: true,
          name: "home",
        },
        {
          title: t("menu.search"),
          icon: outlinedSearch,
          link: "/logs",
          name: "logs",
        },
        {
          title: t("menu.metrics"),
          icon: outlinedBarChart,
          link: "/metrics",
          name: "metrics",
        },
        {
          title: t("menu.traces"),
          icon: outlinedAccountTree,
          link: "/traces",
          name: "traces",
        },
        {
          title: t("menu.rum"),
          icon: outlinedDevices,
          link: "/rum",
          name: "rum",
        },
        {
          title: t("menu.dashboard"),
          icon: outlinedDashboard,
          link: "/dashboards",
          name: "dashboards",
        },
        {
          title: t("menu.index"),
          icon: outlinedWindow,
          link: "/streams",
          name: "streams",
        },
        {
          title: t("menu.alerts"),
          icon: outlinedReportProblem,
          link: "/alerts",
          name: "alertList",
        },
        {
          title: t("menu.incidents"),
          icon: outlinedNotificationsActive,
          link: "/incidents",
          name: "incidentList",
        },
        {
          title: t("menu.ingestion"),
          icon: outlinedFilterAlt,
          link: "/ingestion",
          name: "ingestion",
        },
        {
          title: t("menu.iam"),
          icon: outlinedManageAccounts,
          link: "/iam",
          display: store.state?.currentuser?.role == "admin" ? true : false,
          name: "iam",
        },
      ]);


    const langList = [
      {
        label: "English",
        code: "en-gb",
        icon: "img:" + getImageURL("images/language_flags/en-gb.svg"),
      },
      {
        label: "Türkçe",
        code: "tr-turk",
        icon: "img:" + getImageURL("images/language_flags/tr-turk.svg"),
      },
      {
        label: "简体中文",
        code: "zh-cn",
        icon: "img:" + getImageURL("images/language_flags/zh-cn.svg"),
      },
      {
        label: "Français",
        code: "fr",
        icon: "img:" + getImageURL("images/language_flags/fr.svg"),
      },
      {
        label: "Español",
        code: "es",
        icon: "img:" + getImageURL("images/language_flags/es.svg"),
      },
      {
        label: "Deutsch",
        code: "de",
        icon: "img:" + getImageURL("images/language_flags/de.svg"),
      },
      {
        label: "Italiano",
        code: "it",
        icon: "img:" + getImageURL("images/language_flags/it.svg"),
      },
      {
        label: "日本語",
        code: "ja",
        icon: "img:" + getImageURL("images/language_flags/ja.svg"),
      },
      {
        label: "한국어",
        code: "ko",
        icon: "img:" + getImageURL("images/language_flags/ko.svg"),
      },
      {
        label: "Nederlands",
        code: "nl",
        icon: "img:" + getImageURL("images/language_flags/nl.svg"),
      },
      {
        label: "Português",
        code: "pt",
        icon: "img:" + getImageURL("images/language_flags/pt.svg"),
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

    onMounted(async () => {
      filterMenus();

      // TODO OK : Clean get config functions which sets rum user and functions menu. Move it to common method.
      if (
        !store.state.zoConfig.hasOwnProperty("version") ||
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
        await nextTick();
        // if rum enabled then setUser to capture session details.
        if (store.state.zoConfig.rum?.enabled) {
          setRumUser();
        }
      }
    });

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
            icon: outlinedCode,
            link: "/actions",
            name: "actionScripts",
          });
        }
      }
    };
    const splitterModel = ref(100);
    const selectedLanguage: any =
      langList.find((l) => l.code == getLocale()) || langList[0];

    const filterMenus = () => {
      updateActionsMenu();

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
        icon: outlinedDescription,
        link: "/reports",
        name: "reports",
      });
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

    const triggerRefreshToken = () => {
      const expirationTimeUnix = store.state.userInfo.exp;

      // Convert the expiration time to milliseconds
      const expirationTimeMilliseconds = expirationTimeUnix * 1000;

      // Get the current time in milliseconds
      const currentTimeMilliseconds = Date.now();

      // Calculate the time difference
      const timeUntilNextAPICall =
        expirationTimeMilliseconds - currentTimeMilliseconds - 100;

      // Convert the time difference from milliseconds to seconds
      const timeUntilNextAPICallInSeconds = timeUntilNextAPICall / 1000;

      // setTimeout(() => {
      //   mainLayoutMixin.setup().getRefreshToken();
      // }, timeUntilNextAPICallInSeconds);
    };

    //get refresh token for cloud environment
    if (store.state.hasOwnProperty("userInfo") && store.state.userInfo.email) {
      if (config.isCloud == "true") {
        triggerRefreshToken();
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
        store.state.zoConfig.hasOwnProperty(
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
          $q.notify({
            type: "warning",
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
        customOrganization = router.currentRoute.value.query.hasOwnProperty(
          "org_identifier",
        )
          ? router.currentRoute.value.query.org_identifier
          : "";
        let tempDefaultOrg = {};
        let localOrgFlag = false;
        const url = new URL(window.location.href);
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
                  subscription_type: data.hasOwnProperty("CustomerBillingObj")
                    ? data.CustomerBillingObj.subscription_type
                    : "",
                  status: data.status,
                  note: data.hasOwnProperty("CustomerBillingObj")
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
            subscription_type: data.hasOwnProperty("CustomerBillingObj")
              ? data.CustomerBillingObj.subscription_type
              : "",
            status: data.status,
            note: data.hasOwnProperty("CustomerBillingObj")
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
        enable_websocket_search: false,
        enable_streaming_search: false,
        streaming_aggregation_enabled: false,
        free_trial_expiry: "",
        light_mode_theme_color: undefined,
        dark_mode_theme_color: undefined,
        claim_parser_function: "",
      };

      try {
        //get organizations settings
        const orgSettings: any = await organizations.get_organization_settings(
          store.state?.selectedOrganization?.identifier,
        );

        //set settings in store
        //scrape interval will be in number
        store.dispatch("setOrganizationSettings", {
          scrape_interval: orgSettings?.data?.data?.scrape_interval ?? defaultSettings.scrape_interval,
          span_id_field_name:
            orgSettings?.data?.data?.span_id_field_name ?? defaultSettings.span_id_field_name,
          trace_id_field_name:
            orgSettings?.data?.data?.trace_id_field_name ?? defaultSettings.trace_id_field_name,
          toggle_ingestion_logs:
            orgSettings?.data?.data?.toggle_ingestion_logs ?? defaultSettings.toggle_ingestion_logs,
          enable_websocket_search:
            orgSettings?.data?.data?.enable_websocket_search ?? defaultSettings.enable_websocket_search,
          enable_streaming_search:
            orgSettings?.data?.data?.enable_streaming_search ?? defaultSettings.enable_streaming_search,
          streaming_aggregation_enabled:
            orgSettings?.data?.data?.streaming_aggregation_enabled ?? defaultSettings.streaming_aggregation_enabled,
          free_trial_expiry: orgSettings?.data?.data?.free_trial_expiry ?? defaultSettings.free_trial_expiry,
          light_mode_theme_color: orgSettings?.data?.data?.light_mode_theme_color,
          dark_mode_theme_color: orgSettings?.data?.data?.dark_mode_theme_color,
          claim_parser_function: orgSettings?.data?.data?.claim_parser_function ?? defaultSettings.claim_parser_function,
        });

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
          console.warn("Organization settings access denied (403). Using default settings.");
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
          // if rum enabled then setUser to capture session details.
          if (res.data.rum.enabled) {
            setRumUser();
          }
        })
        .catch((error) => console.log(error));
    };

    if (config.isCloud == "true") {
      mainLayoutMixin.setup().getDefaultOrganization(store);
    }

    const setRumUser = () => {
      if (store.state.zoConfig?.rum?.enabled == true) {
        const userInfo = store.state.userInfo;
        openobserveRum.setUser({
          name: userInfo.given_name + " " + userInfo.family_name,
          email: userInfo.email,
        });
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
      const isEnabled = !store.state.isAiChatEnabled;
      store.dispatch("setIsAiChatEnabled", isEnabled);
      window.dispatchEvent(new Event("resize"));
    };

    const closeChat = () => {
      store.dispatch("setIsAiChatEnabled", false);
      window.dispatchEvent(new Event("resize"));
    };

    const closeSREChat = () => {
      store.dispatch("setIsSREChatOpen", false);
      window.dispatchEvent(new Event("resize"));
    };

    const getBtnLogo = computed(() => {
      if (isHovered.value || store.state.isAiChatEnabled) {
        return getImageURL("images/common/ai_icon_dark.svg");
      }

      return store.state.theme === "dark"
        ? getImageURL("images/common/ai_icon_dark.svg")
        : getImageURL("images/common/ai_icon.svg");
    });
    //this will be the function used to cancel the get started dialog and remove the isFirstTimeLogin from local storage
    //this will be called from the get started component whenever users clicks on the submit button
    const removeFirstTimeLogin = (val: boolean) => {
      showGetStarted.value = val;
      localStorage.removeItem("isFirstTimeLogin");
    };

    const sendToAiChat = (value: any) => {
      if (!store.state.isAiChatEnabled) {
        store.dispatch("setIsAiChatEnabled", true);
      }
      //here we reset the value befoere setting it because if user clears the input then again click on the same value it wont trigger the watcher that is there in the child component
      //so to force trigger we do this
      aiChatInputContext.value = "";
      nextTick(() => {
        aiChatInputContext.value = value;
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

    //this is the used to set the selected org to the user clicked org because all the operations are happening on the selected org
    //to make sync with the user clicked org
    //we dont need search query after selectedOrg has been changed so resetting it
    watch(
      selectedOrg,
      (newVal) => {
        userClickedOrg.value = newVal;
        searchQuery.value = "";
      },
      { immediate: true },
    );

    return {
      t,
      router,
      store,
      config,
      langList,
      selectedLanguage,
      linksList,
      selectedOrg,
      orgOptions,
      leftDrawerOpen: false,
      miniMode,
      user,
      zoBackendUrl,
      isLoading,
      getImageURL,
      updateOrganization,
      setSelectedOrganization,
      getOrganizationSettings,
      resetStreams,
      triggerRefreshToken,
      prefetch,
      expandMenu,
      slackIcon: markRaw(SlackIcon),
      openSlack,
      outlinedSettings,
      closeSocket,
      splitterModel,
      toggleAIChat,
      closeChat,
      closeSREChat,
      getBtnLogo,
      isHovered,
      showGetStarted,
      removeFirstTimeLogin,
      sendToAiChat,
      aiChatInputContext,
      userClickedOrg,
      searchQuery,
      filteredOrganizations,
      rowsPerPage,
      verifyStreamExist,
      filterMenus,
      updateActionsMenu,
      getConfig,
      setRumUser,
      openPredefinedThemes,
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
    changeUserInfo(newVal) {
      if (JSON.stringify(newVal) != "{}") {
        this.triggerRefreshToken();
      }
    },
  },
});
</script>

<style lang="scss">
@import "../styles/app.scss";
@import "../styles/menu-variables";
@import "../styles/menu-animations";

// Logo container
.logo-container {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  min-width: 150px;
}

// OpenObserve logo styling
.openobserve-logo {
  height: 32px;
  width: auto;
  max-width: 150px;
  display: block;
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 0.8;
  }
}

.printMode {
  body {
    overflow: auto !important;
  }
  .q-header {
    display: none;
  }

  .q-drawer {
    display: none;
  }

  .q-page-container {
    padding-left: 0px !important;
  }
}

@media print {
  .tw:h-full,
  .tw:h-\[calc\(100vh-105px\)\],
  .tw:overflow-y-auto {
    overflow: visible !important;
  }
}

.q-drawer {
  border-radius: 0.625rem;
}

.warning-msg {
  background-color: var(--q-warning);
  padding: 5px;
  border-radius: 5px;
}

.alert-msg {
  background-color: var(--q-alert);
  padding: 5px;
  border-radius: 5px;
}

.q-header .q-btn-dropdown__arrow {
  margin-left: -4px;
}

.q-header {
  color: unset;

  .beta-text {
    font-size: 11px;
    right: 1px;
    bottom: -9px;
  }

  .appLogo {
    width: 120px;
    max-width: 150px;
    max-height: 31px;
    cursor: pointer;

    &__mini {
      margin-right: 0.25rem;
      // margin-left: 0.25rem;
      height: 30px;
      width: 30px;
    }
  }
}

.q-toolbar {
  min-height: 40px;
}

.headerMenu {
  margin-right: 1rem;

  .block {
    font-weight: 700;
    color: #404040;
  }
}

.q-item {
  min-height: 30px;
  padding: 3px 8px;
}

.o2-bg-color {
  // background-color: rgba(89, 96, 178, 0.08);
  background: transparent;
}

.q-list {
  &.leftNavList {
    padding: 4px 0px 0px 0px;

    .q-item {
      margin: 0px 5px;
      display: list-item;
      text-align: center;
      list-style: none;
      padding: 2px 2px;
      border-radius: 5px;

      .q-icon {
        height: 1.3rem;
        width: 1.3rem;
      }

      .q-item__label{
        padding-bottom: 4px;
      }

      &.q-router-link--active {
        .q-icon img {
          filter: brightness(100);
        }

        .q-item__label {
          color: var(--o2-menu-color);

          // Light mode: make text blue for readability
          body.body--light & {
            color: #19191e !important;
          }
          // Dark mode: make text blue for readability
          body.body--dark & {
            color: #ffffff !important;
          }

        }
        color: var(--o2-menu-color);

        // Light mode: make item text blue
        body.body--light & {
          color: var(--o2-menu-color) !important;

          .q-icon {
            color: #19191e !important;
          }
        }

        // Dark mode: make item text blue
        body.body--dark & {
          color: var(--o2-menu-color) !important;

          .q-icon {
            color: #ffffff !important;
          }
        }

        
      }

      &__label {
        font-size: 12px;
        font-weight: 600;
        color: var(--o2-text-secondary);
      }
    }
  }

  .flagIcon img {
    border-radius: 3px;
    object-fit: cover;
    display: block;
    height: 16px;
    width: 24px;
  }

  .q-item {
    &__section {
      &--avatar {
        padding-right: 0px !important;
        min-width: 1.5rem;
        display: list-item;
        text-align: center;
        list-style: none;
      }
    }

    &__label {
      font-weight: 400;
    }

    &.activeLang {
      &__label {
        font-weight: 600;
        color: $primary;
      }
    }
  }
}

.userInfo {
  align-items: flex-start;
  flex-direction: column;
  margin-left: 0.875rem;
  margin-right: 1rem;
  display: flex;

  .userName {
    line-height: 1.25rem;
    font-weight: 700;
  }

  .userRole {
    font-size: 0.75rem;
    line-height: 1rem;
    color: #565656;
    font-weight: 600;
  }
}

.headerMenu {
  margin-right: 1rem;

  .block {
    font-weight: 700;
    color: #404040;
  }
}
.q-list {
  // &.leftNavList {
  //   .q-item {
  //     .q-icon {
  //       height: 1rem;
  //       width: 1rem;
  //     }

  //     &.q-router-link--active {
  //       .q-icon img {
  //         filter: brightness(100);
  //       }
  //     }
  //   }
  // }

  .flagIcon img {
    border-radius: 3px;
    object-fit: cover;
    display: block;
    height: 16px;
    width: 24px;
  }

  .q-item {
    &__section {
      &--avatar {
        padding-right: 0.875rem;
        min-width: 1.5rem;
      }
    }

    &__label {
      font-weight: 400;
    }

    &.activeLang {
      &__label {
        font-weight: 600;
        color: $primary;
      }
    }
  }
}

.userInfo {
  align-items: flex-start;
  flex-direction: column;
  margin-left: 0.875rem;
  margin-right: 1rem;
  display: flex;

  .userName {
    line-height: 1.25rem;
    font-weight: 700;
  }

  .userRole {
    font-size: 0.75rem;
    line-height: 1rem;
    color: #565656;
    font-weight: 600;
  }
}

.dark-mode {
  background-color: $dark-page;
}

.languagelist {
  .q-item {
    padding: 4px 8px;
  }
}

.text-powered-by {
  float: left;
  display: inline-block;
  position: absolute;
  margin-top: 16px;
  margin-left: 0px;
}

.custom-text-logo {
  display: inline-block;
  float: left;
  position: absolute;
  margin-left: 72px !important;
  margin-top: 16px !important;
  width: 80px !important;
}

.header-menu {
  .q-btn {
    transition: transform 0.2s ease;

    &:hover {
      transform: translateY(-2px);
    }

    // Skip bounce effect for AI button and org selector
    &.ai-hover-btn {
      &:hover {
        transform: none;
      }
    }
  }

  // Skip bounce for org selector (inside div)
  [data-test="navbar-organizations-select"] .q-btn {
    &:hover {
      transform: none;
    }
  }
}

.header-icon {
  opacity: 0.7;
}

body.ai-chat-open {
  .q-layout {
    width: 75%;
    transition: width 0.3s ease;
  }
}

.q-layout {
  width: 100%;
  transition: width 0.3s ease;
}

.o2-button {
  border-radius: 4px;
  padding: 0px 8px;
  color: white;
}
.dark-mode-chat-container {
  border-left: 1.5px solid #232323ff;
  box-shadow: -0rem 0.1rem 0.3rem var(--hover-shadow);
}
.light-mode-chat-container {
  border-left: 1.5px solid #f7f7f7;
  box-shadow: -0rem 0.1rem 0.3rem var(--hover-shadow);
}

.ai-btn-active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
}
.ai-hover-btn {
  transition: background 0.3s ease;
}

.ai-hover-btn:hover {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
}

.ai-icon {
  transition: transform 0.6s ease;
}

.ai-hover-btn:hover .ai-icon {
  transform: rotate(180deg);
}

.theme-btn-active {
  background: color-mix(
    in srgb,
    var(--o2-theme-color) 15%,
    transparent 85%
  ) !important;

  .header-icon {
    opacity: 1 !important;
    color: var(--o2-theme-color) !important;
  }
}

.organization-menu-o2 {
  // Disable hover for organization menu dropdown
  // Disable table row hover
  .q-tr:hover,
  tr:hover,
  tbody tr:hover,
  tbody .q-tr:hover {
    background-color: transparent !important;
    background: transparent !important;
  }

  td:hover,
  .q-td:hover {
    background-color: transparent !important;
    background: transparent !important;
  }

  // Disable default q-item hover
  .q-item:hover {
    background-color: transparent !important;
    background: transparent !important;
    color: inherit !important;
  }

  .org-table {
    // Disable global table row hover
    tbody .q-tr:hover {
      background: transparent !important;
    }

    td {
      padding: 0 !important;
      height: 32px !important;
      min-height: 32px !important;
    }

    .q-table__top {
      padding: 10px !important;

      .q-field__control {
        height: 40px;
      }

      input {
        font-size: 14px;
      }
    }

    .q-table__bottom {
      padding: 8px 12px !important;
      min-height: 40px;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;

      .q-table__control {
        display: flex !important;
        align-items: center !important;
      }

      // Ensure pagination arrows are visible
      .q-btn {
        display: inline-flex !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
    }

    // Table cell with no padding
    .org-list-item-cell {
      padding: 0 !important;
      cursor: pointer;
    }

    // Individual org menu item
    .org-menu-item {
      padding: 6px 12px;
      width: 100%;
      display: block;
      transition: background-color 0.2s ease;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;

      // Enable hover only for individual org menu items
      &:hover {
        background-color: var(--o2-hover-accent) !important;
        border-radius: 4px;
      }

      // Active/selected state
      &--active {
        color: var(--q-primary) !important;
        font-weight: 500;
        background: rgba(89, 96, 178, 0.08);

        &:hover {
          background: rgba(89, 96, 178, 0.12) !important;
        }
      }
    }
  }
}
.q-drawer {
  margin-bottom: 0.675rem;
}
</style>