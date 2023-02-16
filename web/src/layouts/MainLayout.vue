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
          src="/src/assets/images/common/app_logo_zo.png"
          @click="goToHome"
        />
        <img
          v-else
          class="appLogo__mini"
          src="/src/assets/images/common/mini_logo.svg"
        />
        <q-btn
          dense
          flat
          round
          icon="img:/src/assets/images/common/menu_icon.svg"
          @click="toggleLeftDrawer"
        />

        <q-toolbar-title></q-toolbar-title>
        <q-btn
          class="q-ml-xs text-bold no-border"
          size="13px"
          no-caps
          :label="t(`menu.openapi`)"
          @click="navigateToOpenAPI(zoBackendUrl)"
        />
        <q-btn
          class="q-ml-xs text-bold no-border"
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
            :icon="languageFlag"
            dropdown-icon="img:/src/assets/images/common/language_menu_arrow.svg"
          >
            <template #label>
              <div class="row no-wrap">
                {{ selectedLanguage.label }}
              </div>
            </template>
            <q-list>
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
            class="q-px-none q-py-none q-mx-none q-my-none"
            @update:model-value="updateOrganization()"
          />
        </div>

        <div class="q-mr-xs">
          <q-btn-dropdown
            flat
            unelevated
            no-caps
            padding="xs sm"
            dropdown-icon="img:/src/assets/images/common/user_menu_arrow.svg"
          >
            <template #label>
              <div class="row items-center no-wrap">
                <q-avatar size="md" color="grey" text-color="white">
                  <img
                    :src="
                      user.picture
                        ? user.picture
                        : `/src/assets/images/common/profile.svg`
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

              <q-item v-ripple v-close-popup clickable @click="signout">
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
import MenuLink from "../components/MenuLink.vue";
import { useI18n } from "vue-i18n";
import { getLocale } from "../locales";
import { setLanguage } from "../utils/cookies";
import {
  useLocalCurrentUser,
  useLocalOrganization,
  useLocalUserInfo,
  useLocalToken,
  getUserInfo,
} from "../utils/zincutils";

import { ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import organizationService from "../services/organizations";
import config from "../aws-exports";
import Tracker from "@openreplay/tracker";
import configService from "../services/config";

export default {
  name: "MainLayout",

  components: {
    MenuLink,
  },
  methods: {
    navigateToDocs() {
      window.open("https://docs.zinc.dev", "_blank");
    },
    navigateToOpenAPI(zoBackendUrl: string) {
      window.open(zoBackendUrl + "/swagger/index.html", "_blank");
    },
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const quotaThresholdMsg = ref();
    let quotaAlertClass = "warning";
    let user = store.state.userInfo;
    const languageFlag = ref("img:/src/assets/images/language_flags/en-gb.svg");
    const zoBackendUrl = store.state.API_ENDPOINT;
    var linksList = ref([
      {
        title: t("menu.home"),
        icon: "home",
        link: "/",
        exact: true,
      },
      {
        title: t("menu.search"),
        icon: "img:/src/assets/images/left_nav/search_icon.svg",
        link: "/logs",
      },
      {
        title: t("menu.user"),
        icon: "img:/src/assets/images/left_nav/user_icon.svg",
        link: "/users",
        display: store.state.currentuser.role == "Admin" ? true : false,
      },
      {
        title: t("menu.index"),
        icon: "img:/src/assets/images/left_nav/index_icon.svg",
        link: "/logstreams",
      },
      // {
      //   title: t("menu.function"),
      //   icon: "transform",
      //   link: "/function",
      // },
      {
        title: t("menu.ingestion"),
        icon: "filter_alt",
        link: "/ingestion/",
      },
      {
        title: t("menu.alerts"),
        icon: "img:/src/assets/images/left_nav/warning_icon.svg",
        link: "/alerts",
      },
      {
        title: t("menu.about"),
        icon: "img:/src/assets/images/left_nav/about_icon.svg",
        link: "/about",
      },
      {
        title: t("menu.slack"),
        icon: "img:/src/assets/images/common/slack.svg",
        link: "https://join.slack.com/t/zincsearch/shared_invite/zt-11r96hv2b-UwxUILuSJ1duzl_6mhJwVg",
        target: "_blank",
        external: true,
      },
    ]);

    const getConfig = async () => {
      await configService.get_config().then((res: any) => {
        store.dispatch("setConfig", res.data);
        if (res.data.functions_enabled) {
          linksList.value.splice(4, 0, {
            title: t("menu.function"),
            icon: "transform",
            link: "/functions",
          });
        }
      });
    };

    getConfig();

    const langList = [
      {
        label: "English",
        code: "en-gb",
        icon: "img:/src/assets/images/language_flags/en-gb.svg",
      },
      {
        label: "Türkçe",
        code: "tr-turk",
        icon: "img:/src/assets/images/language_flags/tr-turk.svg",
      },
      {
        label: "简体中文",
        code: "zh-cn",
        icon: "img:/src/assets/images/language_flags/zh-cn.svg",
      },
    ];

    const local = ref(getLocale());
    const selectedLanguage = ref(langList.find((l) => l.code == local.value));

    if (user.picture == "") {
      user.picture = "/src/assets/images/common/profile.svg";
    }

    if (!selectedLanguage.value && langList.length > 0) {
      selectedLanguage.value = langList[0];
      languageFlag.value =
        "img:/src/assets/images/language_flags/" + langList[0].code + ".svg";
    } else {
      const langDetail = selectedLanguage.value;
      languageFlag.value =
        "img:/src/assets/images/language_flags/" + langDetail?.code + ".svg";
    }

    const changeLanguage = (item: any) => {
      setLanguage(item.code);
      selectedLanguage.value = item;
      languageFlag.value =
        "img:/src/assets/images/language_flags/" + item.code + ".svg";
      router.go(0);
    };
    const signout = () => {
      store.dispatch("logout");
      useLocalToken("", true);
      useLocalCurrentUser("", true);
      useLocalUserInfo("", true);
      router.push("/logout");
    };
    const miniMode = ref(false);

    if (
      store.state.currentuser.hasOwnProperty("miniMode") &&
      store.state.currentuser.miniMode != miniMode.value
    ) {
      miniMode.value = !miniMode.value;
    }

    const selectedOrg = ref("");
    let orgOptions = ref([{ label: Number, value: String }]);
    const getDefaultOrganization = async () => {
      await organizationService
        .os_list(
          0,
          1000,
          "id",
          false,
          "",
          store.state.selectedOrganization.identifier
        )
        .then((res: any) => {
          const localOrg: any = useLocalOrganization();
          store.dispatch("setOrganizations", res.data.data);
          orgOptions.value = res.data.data.map(
            (data: {
              id: any;
              name: any;
              type: any;
              identifier: any;
              UserObj: any;
              ingest_threshold: number;
              search_threshold: number;
            }) => {
              let optiondata: any = {
                label: data.name,
                id: data.id,
                identifier: data.identifier,
                user_email: store.state.userInfo.email,
                ingest_threshold: data.ingest_threshold,
                search_threshold: data.search_threshold,
              };

              if (
                (selectedOrg.value == "" &&
                  data.type == "default" &&
                  store.state.userInfo.email == data.UserObj.email) ||
                res.data.data.length == 1
              ) {
                selectedOrg.value = localOrg.value
                  ? localOrg.value
                  : optiondata;
                useLocalOrganization(selectedOrg.value);
                store.dispatch("setSelectedOrganization", selectedOrg.value);
              }
              return optiondata;
            }
          );
        });
    };

    getDefaultOrganization();

    const updateOrganization = () => {
      useLocalOrganization(selectedOrg.value);
      store.state.selectedOrganization = selectedOrg;
    };

    if (store.state.hasOwnProperty("userInfo") && store.state.userInfo.email) {
      const d = new Date();
      const timeoutinterval = Math.floor(d.getTime() / 1000);
      const timeout = (store.state.userInfo.exp - timeoutinterval - 30) * 1000;
    }

    const link: any = ref("inbox");

    if (config.enableAnalytics == "true") {
      const tracker = new Tracker({
        projectKey: config.openReplayKey,
      });

      tracker.start();
      tracker.setUserID(store.state.userInfo.email);
    }

    const goToHome = () => {
      router.push("/");
    };

    return {
      t,
      goToHome,
      store,
      quotaThresholdMsg,
      link,
      quotaAlertClass,
      linksList,
      leftDrawerOpen: true,
      miniMode,
      toggleLeftDrawer() {
        miniMode.value = !miniMode.value;
        const leftDrawer = miniMode.value;
        store.state.currentuser.miniMode = leftDrawer;
        store.dispatch("setCurrentUser", store.state.currentuser);
        useLocalCurrentUser(store.state.currentuser);
        window.dispatchEvent(new Event("resize"));
      },
      user,
      langList,
      selectedLanguage,
      changeLanguage,
      languageFlag,
      getDefaultOrganization,
      getConfig,
      signout,
      orgOptions,
      updateOrganization,
      selectedOrg,
      zoBackendUrl,
    };
  },
};
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

.current-organization {
  text-transform: capitalize;
}
</style>
