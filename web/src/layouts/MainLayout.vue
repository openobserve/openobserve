<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <q-layout view="hHh lpR fFf" :class="miniMode ? 'miniMode' : ''">
    <q-header>
      <q-toolbar>
        <img
          v-if="!miniMode"
          class="appLogo"
          :src="getImageURL('images/common/app_logo_zo.png')"
          @click="goToHome"
        />
        <img
          v-else
          class="appLogo__mini"
          :src="getImageURL('images/common/mini_logo.svg')"
        />
        <q-btn
          dense
          flat
          round
          :icon="'img:' + getImageURL('images/common/menu_icon.svg')"
          @click="toggleLeftDrawer"
        />

        <q-toolbar-title></q-toolbar-title>
        <div class="headerMenu float-left" v-if="store.state.quotaThresholdMsg">
          <div
            type="warning"
            icon="cloud"
            class="warning-msg"
            style="display: inline"
          >
            <q-icon name="warning" size="xs"
class="warning" />{{
              store.state.quotaThresholdMsg
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
        <q-btn
          class="q-ml-xs no-border"
          size="13px"
          no-caps
          :label="t(`menu.openapi`)"
          @click="navigateToOpenAPI(zoBackendUrl)"
        />
        <q-btn
          class="q-ml-xs no-border"
          size="13px"
          no-caps
          :label="t(`menu.docs`)"
          @click="navigateToDocs()"
        />
        <div class="languageWrapper">
          <q-btn-dropdown
            unelevated
            no-caps
            flat
            class="languageDdl"
            :icon="selectedLanguage.icon"
            :dropdown-icon="
              'img:' + getImageURL('images/common/language_menu_arrow.svg')
            "
          >
            <template #label>
              <div class="row no-wrap">
                {{ selectedLanguage.label }}
              </div>
            </template>
            <q-list class="languagelist">
              <q-item
                v-for="lang in langList"
                :key="lang.code"
                v-ripple
                v-close-popup
                clickable
                v-bind="lang"
                active-class="activeLang"
                @click="changeLanguage(lang)"
              >
                <q-item-section avatar>
                  <q-icon :name="lang.icon" class="flagIcon" />
                </q-item-section>

                <q-item-section>
                  <q-item-label>{{ lang.label }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>

        <div class="q-ml-md current-organization">
          <q-select
            v-model="selectedOrg"
            borderless
            :options="orgOptions"
            class="q-px-none q-py-none q-mx-none q-my-none organizationlist"
            @update:model-value="updateOrganization()"
          />
        </div>

        <div class="q-mr-xs">
          <q-btn-dropdown
            flat
            unelevated
            no-caps
            padding="xs sm"
            :dropdown-icon="
              'img:' + getImageURL('images/common/user_menu_arrow.svg')
            "
          >
            <template #label>
              <div class="row items-center no-wrap">
                <q-avatar size="md" color="grey"
text-color="white">
                  <img
                    :src="
                      user.picture
                        ? user.picture
                        : getImageURL('images/common/profile.svg')
                    "
                  />
                </q-avatar>
                <div class="userInfo">
                  <div class="userName">
                    {{
                      user.given_name
                        ? user.given_name + " " + user.family_name
                        : user.email
                    }}
                  </div>
                </div>
              </div>
            </template>
            <q-list>
              <q-item-label header>{{ t("menu.account") }}</q-item-label>

              <q-item v-ripple
v-close-popup clickable
@click="signout">
                <q-item-section avatar>
                  <q-avatar
                    size="md"
                    icon="exit_to_app"
                    color="red"
                    text-color="white"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ t("menu.signOut") }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="leftDrawerOpen"
      :mini="miniMode"
      :width="210"
      :breakpoint="500"
      bordered
    >
      <q-list class="leftNavList">
        <menu-link
          v-for="nav in linksList"
          :key="nav.title"
          v-bind="{ ...nav, mini: miniMode }"
        />
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component
            :is="Component"
            v-if="$route.meta.keepAlive"
            :key="$route.name"
          />
        </keep-alive>
        <component
          :is="Component"
          v-if="!$route.meta.keepAlive"
          :key="$route.name"
        />
      </router-view>
    </q-page-container>
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
} from "quasar";
import MenuLink from "../components/MenuLink.vue";
import { useI18n } from "vue-i18n";
import {
  useLocalCurrentUser,
  useLocalOrganization,
  useLocalUserInfo,
  useLocalToken,
  getImageURL,
} from "../utils/zincutils";

import { ref, defineComponent, KeepAlive, computed } from "vue";
import { useStore } from "vuex";
import { useRouter, RouterView } from "vue-router";
import config from "../aws-exports";

import { setLanguage } from "../utils/cookies";
import { getLocale } from "../locales";

import MainLayoutOpenSourceMixin from "@/mixins/mainLayout.mixin";
import MainLayoutCloudMixin from "@/enterprise/mixins/mainLayout.mixin";

import configService from "@/services/config";
import Tracker from "@openreplay/tracker";

let mainLayoutMixin: any = null;
if (config.isZincObserveCloud == "true") {
  mainLayoutMixin = MainLayoutCloudMixin;
} else {
  mainLayoutMixin = MainLayoutOpenSourceMixin;
}

export default defineComponent({
  name: "MainLayout",
  mixins: [mainLayoutMixin],
  components: {
    "menu-link": MenuLink,
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
  },
  methods: {
    navigateToDocs() {
      window.open("https://docs.zinc.dev", "_blank");
    },
    navigateToOpenAPI(zoBackendUrl: string) {
      window.open(zoBackendUrl + "/swagger/index.html", "_blank");
    },
    signout() {
      this.store.dispatch("logout");
      useLocalToken("", true);
      useLocalCurrentUser("", true);
      useLocalUserInfo("", true);
      this.$router.push("/logout");
    },
    goToHome() {
      this.$router.push("/");
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
    const miniMode = ref(false);
    const zoBackendUrl = store.state.API_ENDPOINT;
    let customOrganization = router.currentRoute.value.query.hasOwnProperty(
      "org_identifier"
    )
      ? router.currentRoute.value.query.org_identifier
      : undefined;
    const selectedOrg = ref(store.state.selectedOrganization);

    const orgOptions = ref([{ label: Number, value: String }]);

    let user = store.state.userInfo;

    var linksList = ref([
      {
        title: t("menu.home"),
        icon: "home",
        link: "/",
        exact: true,
      },
      {
        title: t("menu.search"),
        icon: "img:" + getImageURL("images/left_nav/search_icon.svg"),
        link: "/logs",
      },
      {
        title: t("menu.metrics"),
        icon: "img:" + getImageURL("images/left_nav/metrics.svg"),
        link: "/metrics",
      },
      {
        title: t("menu.traces"),
        icon: "img:" + getImageURL("images/left_nav/traces.svg"),
        link: "/traces",
      },
      {
        title: t("menu.dashboard"),
        icon: "dashboard",
        link: "/dashboards",
      },
      {
        title: t("menu.index"),
        icon: "img:" + getImageURL("images/left_nav/index_icon.svg"),
        link: "/logstreams",
      },
      {
        title: t("menu.alerts"),
        icon: "img:" + getImageURL("images/left_nav/warning_icon.svg"),
        link: "/alerts",
      },
      {
        title: t("menu.ingestion"),
        icon: "filter_alt",
        link: "/ingestion/",
      },
      {
        title: t("menu.user"),
        icon: "img:" + getImageURL("images/left_nav/user_icon.svg"),
        link: "/users",
        display: store.state.currentuser.role == "admin" ? true : false,
      },
      {
        title: t("menu.slack"),
        icon: "img:" + getImageURL("images/common/slack.svg"),
        link: "https://join.slack.com/t/zincsearch/shared_invite/zt-11r96hv2b-UwxUILuSJ1duzl_6mhJwVg",
        target: "_blank",
        external: true,
      },
      {
        title: t("menu.about"),
        icon: "img:" + getImageURL("images/left_nav/about_icon.svg"),
        link: "/about",
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
        label: "French",
        code: "fr",
        icon: "img:" + getImageURL("images/language_flags/fr.svg"),
      },
      {
        label: "Spanish",
        code: "es",
        icon: "img:" + getImageURL("images/language_flags/es.svg"),
      },
      {
        label: "German",
        code: "de",
        icon: "img:" + getImageURL("images/language_flags/de.svg"),
      },
      {
        label: "Italian",
        code: "it",
        icon: "img:" + getImageURL("images/language_flags/it.svg"),
      },
      {
        label: "Japanese",
        code: "ja",
        icon: "img:" + getImageURL("images/language_flags/ja.svg"),
      },
      {
        label: "Korean",
        code: "ko",
        icon: "img:" + getImageURL("images/language_flags/ko.svg"),
      },
      {
        label: "Dutch",
        code: "nl",
        icon: "img:" + getImageURL("images/language_flags/nl.svg"),
      },
      {
        label: "Portuguese",
        code: "pt",
        icon: "img:" + getImageURL("images/language_flags/pt.svg"),
      },
    ];

    const selectedLanguage: any =
      langList.find((l) => l.code == getLocale()) || langList[0];

    //additional links based on environment and conditions
    if (config.isZincObserveCloud == "true") {
      linksList.value = mainLayoutMixin
        .setup()
        .leftNavigationLinks(linksList, t);
    }

    //orgIdentifier query param exists then clear the localstorage and store.
    if (store.state.selectedOrganization != null) {
      if (
        mainLayoutMixin.setup().customOrganization != undefined &&
        mainLayoutMixin.setup().customOrganization !=
          store.state.selectedOrganization.identifier
      ) {
        useLocalOrganization("");
        store.dispatch("setSelectedOrganization", {});
      }
    }

    if (
      store.state.currentuser.hasOwnProperty("miniMode") &&
      store.state.currentuser.miniMode != miniMode.value
    ) {
      miniMode.value = !miniMode.value;
    }

    //get refresh token for cloud environment
    if (store.state.hasOwnProperty("userInfo") && store.state.userInfo.email) {
      const d = new Date();
      const timeoutinterval = Math.floor(d.getTime() / 1000);
      const timeout = (store.state.userInfo.exp - timeoutinterval - 30) * 1000;

      if (config.isZincObserveCloud == "true") {
        setTimeout(() => {
          mainLayoutMixin.setup().getRefreshToken(store);
        }, timeout);
      }
    }

    const updateOrganization = () => {
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
      store.state.selectedOrganization = selectedOrg;
    };

    const setSelectedOrganization = () => {
      customOrganization = router.currentRoute.value.query.hasOwnProperty("org_identifier")
        ? router.currentRoute.value.query.org_identifier
        : "";
      if (store.state.organizations.length > 0) {
        const localOrg: any = useLocalOrganization();
        orgOptions.value = store.state.organizations.map(
          (data: {
            id: any;
            name: any;
            type: any;
            identifier: any;
            UserObj: any;
            ingest_threshold: number;
            search_threshold: number;
            CustomerBillingObj: { subscription_type: string };
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
            };

            if (
              config.isZincObserveCloud == "true" &&
              localOrg.value.identifier == data.identifier &&
              (customOrganization == "" || customOrganization == undefined)
            ) {
              // localOrg.value.subscription_type =
              //   data.CustomerBillingObj.subscription_type;
              // useLocalOrganization(localOrg.value);
              useLocalOrganization(optiondata);
            }

            if (
              ((selectedOrg.value == "" || selectedOrg.value == undefined) &&
                data.type == "default" &&
                store.state.userInfo.email == data.UserObj.email &&
                (customOrganization == "" ||
                  customOrganization == undefined)) ||
              (store.state.organizations.length == 1 &&
                (customOrganization == "" || customOrganization == undefined))
            ) {
              selectedOrg.value = localOrg.value ? localOrg.value : optiondata;
              useLocalOrganization(optiondata);
              store.dispatch("setSelectedOrganization", optiondata);
            } else if (data.identifier == customOrganization) {
              selectedOrg.value = optiondata;
              useLocalOrganization(optiondata);
              store.dispatch("setSelectedOrganization", optiondata);
            }
            return optiondata;
          }
        );
      }

      if (router.currentRoute.value.query.action == "subscribe") {
        router.push({
          name: "plans",
        });
      }

      if (
        selectedOrg.value.identifier != "" &&
        config.isZincObserveCloud == "true"
      ) {
        mainLayoutMixin.setup().getOrganizationThreshold(store);
      }
    };

    /**
     * Get configuration from the backend.
     * @return {"version":"","instance":"","commit_hash":"","build_date":"","functions_enabled":true,"default_fts_keys":["field1","field2"],"telemetry_enabled":true,"default_functions":[{"name":"function name","text":"match_all('v')"}}
     * @throws {Error} If the request fails.
     */
    const getConfig = async () => {
      await configService
        .get_config()
        .then((res: any) => {
          if (
            res.data.functions_enabled &&
            config.isZincObserveCloud == "false"
          ) {
            linksList.value = mainLayoutMixin
              .setup()
              .leftNavigationLinks(linksList, t);
          }
          store.dispatch("setConfig", res.data);
        })
        .catch((error) => console.log(error));
    };

    getConfig();

    if (config.isZincObserveCloud == "true") {
      mainLayoutMixin.setup().getDefaultOrganization(store);

      const tracker = new Tracker({
        projectKey: config.openReplayKey,
      });
      tracker.start();
      tracker.setUserID(store.state.userInfo.email);
    }

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
      leftDrawerOpen: true,
      miniMode,
      toggleLeftDrawer() {
        miniMode.value = !miniMode.value;
        const leftDrawer = miniMode.value;
        const currentUser: any = useLocalCurrentUser();
        currentUser.miniMode = leftDrawer;
        store.dispatch("setCurrentUser", currentUser);
        useLocalCurrentUser(currentUser);
        window.dispatchEvent(new Event("resize"));
      },
      user,
      zoBackendUrl,
      getImageURL,
      updateOrganization,
      setSelectedOrganization,
    };
  },
  computed: {
    changeOrganization() {
      return this.store.state.organizations;
    },
    forceFetchOrganization() {
      return this.router.currentRoute.value.query.update_org;
    },
  },
  watch: {
    forceFetchOrganization() {
      mainLayoutMixin.setup().getDefaultOrganization(this.store);
    },
    changeOrganization() {
      setTimeout(() => {
        this.setSelectedOrganization();
      }, 500);
    },
  },
});
</script>

<style lang="scss">
@import "../styles/app.scss";

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
  @extend .border-bottom;
  @extend .bg-white;

  .appLogo {
    margin-left: 1.75rem;
    margin-right: 2rem;
    width: 109px;
    cursor: pointer;

    &__mini {
      margin-right: 0.25rem;
      // margin-left: 0.25rem;
      height: 30px;
      width: 30px;
    }
  }
}

.miniMode {
  .q-page-container {
    padding-left: 5rem !important;
  }
}

.q-drawer {
  @extend .border-right;
  @extend .bg-white;
  min-width: 5rem;
  color: unset;

  &--mini {
    .leftNavList {
      padding: 1.5rem 0.625rem;
    }
  }
}

.headerMenu {
  margin-right: 1rem;

  .block {
    font-weight: 700;
    color: #404040;
  }
}

.languageWrapper {
  .q-btn__content {
    color: #646464;
  }
}

.languageDdl {
  padding-right: 0.75rem;
  padding-left: 0.75rem;

  &.q-btn {
    .q-icon {
      &.q-btn-dropdown__arrow {
        margin-left: 0.5rem;
        height: 0.875rem;
        width: 0.875rem;
      }

      & + .row {
        margin-left: 0.875rem;
        margin-right: 0.5rem;
      }
    }
  }
}

.q-item {
  min-height: 30px;
  padding: 8px 8px;
}

.q-list {
  &.leftNavList {
    padding-bottom: 1.5rem;
    padding-top: 1.5rem;

    .q-item {
      margin-bottom: 0.5rem;

      .q-icon {
        height: 1.5rem;
        width: 1.5rem;
      }

      &.q-router-link--active {
        .q-icon img {
          filter: brightness(100);
        }
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
        padding-right: 0.875rem;
        min-width: 1.5rem;
      }
    }

    &__label {
      color: $dark-page;
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
    color: #404040;
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

.languageWrapper {
  margin-right: 0.75rem;
  margin-left: 1rem;

  .q-btn__content {
    color: #646464;
  }
}

.languageDdl {
  padding-right: 0.75rem;
  padding-left: 0.75rem;

  &.q-btn {
    .q-icon {
      &.q-btn-dropdown__arrow {
        margin-left: 0.5rem;
        height: 0.875rem;
        width: 0.875rem;
      }

      & + .row {
        margin-left: 0.875rem;
        margin-right: 0.5rem;
      }
    }
  }
}

.q-list {
  &.leftNavList {
    .q-item {
      .q-icon {
        height: 1.5rem;
        width: 1.5rem;
      }

      &.q-router-link--active {
        .q-icon img {
          filter: brightness(100);
        }
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
        padding-right: 0.875rem;
        min-width: 1.5rem;
      }
    }

    &__label {
      color: $dark-page;
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
    color: #404040;
    font-weight: 700;
  }

  .userRole {
    font-size: 0.75rem;
    line-height: 1rem;
    color: #565656;
    font-weight: 600;
  }
}
</style>
