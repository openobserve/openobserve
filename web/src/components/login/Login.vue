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
  <div class="bg-card-glass-bg w-[100vw] h-[100vh]">
    <div style="max-width: 400px; padding-top: 100px" class="mx-auto p-3">
      <div
        class="flex justify-center text-center"
        v-if="
          (config.isEnterprise == 'true' &&
            store.state.zoConfig.hasOwnProperty('custom_logo_text') &&
            store.state.zoConfig.custom_logo_text != '') ||
          (config.isEnterprise == 'true' &&
            store.state.zoConfig.hasOwnProperty('custom_logo_img') &&
            store.state.zoConfig.custom_logo_img != null)
        "
      >
        <span
          v-if="
            store.state.zoConfig.hasOwnProperty('custom_logo_text') &&
            store.state.zoConfig?.custom_logo_text != ''
          "
          class="text-xl font-semibold font-bold p-0 cursor-pointer mr-2 w-full"
          >{{ store.state.zoConfig.custom_logo_text }}</span
        >
        <span class="w-full flex justify-center">
          <img
            v-if="
              store.state.zoConfig.hasOwnProperty('custom_logo_img') &&
              store.state.zoConfig?.custom_logo_img != null
            "
            :src="`data:image; base64, ` + store.state.zoConfig?.custom_logo_img"
            style="max-width: 150px; max-height: 31px"
          />
        </span>
        <img
          v-if="store.state.zoConfig.custom_hide_self_logo == false"
          class="appLogo h-auto"
          :style="
            store.state.zoConfig.custom_logo_text != ''
              ? 'width: 150px;'
              : 'width: 250px;'
          "
          :src="
            isDark
              ? getImageURL('images/common/openobserve_latest_dark_2.svg')
              : getImageURL('images/common/openobserve_latest_light_2.svg')
          "
        />
      </div>
      <div class="flex justify-center mb-4" v-else>
        <img
          class="appLogo h-auto"
          :style="
            store.state.zoConfig.custom_logo_text != ''
              ? 'width: 150px;'
              : 'width: 250px;'
          "
          :src="
            isDark
              ? getImageURL('images/common/openobserve_latest_dark_2.svg')
              : getImageURL('images/common/openobserve_latest_light_2.svg')
          "
        />
      </div>

      <div v-if="autoRedirectDexLogin">
        <p>
          Redirecting to SSO login page. If you are not redirected, please
          <a href="#" @click="loginWithSSo" class="cursor-pointer underline">click here</a>.
        </p>
      </div>

      <div v-else>
        <div style="font-size: var(--text-xl)" class="w-full text-center pb-3">
          Login
        </div>

        <div v-if="showSSO" class="flex justify-center">
          <OButton
            data-test="sso-login-btn"
            variant="primary"
            size="sm-action"
            style="width: 400px"
            @click="loginWithSSo"
          >
            <div
              class="flex items-center justify-center w-full text-center relative"
            >
              <img
                class="absolute"
                style="width: 30px; left: 16px"
                :src="getImageURL('images/common/sso.svg')"
              />
              <span class="text-center"> Login with SSO</span>
            </div>
          </OButton>
        </div>

        <div v-if="showSSO && showInternalLogin" class="py-3 text-center">
          <a
            class="cursor-pointer py-3 hover:text-text-secondary"
            style="text-decoration: underline"
            data-test="login-as-internal-user"
            @click="loginAsInternalUser = !loginAsInternalUser"
            >Login as internal user</a
          >
        </div>

        <div
          v-if="!showSSO || (showSSO && loginAsInternalUser && showInternalLogin)"
          class="login-inputs"
        >
          <OForm
            :schema="loginSchema"
            :default-values="loginDefaults"
            @submit="onSignIn"
            class="flex flex-col gap-3"
          >
            <OFormInput
              name="name"
              data-cy="login-user-id"
              data-test="login-user-id"
              :label="t('login.userEmail')"
              :placeholder="t('login.email')"
              type="email"
              required
            />

            <OFormInput
              name="password"
              data-cy="login-password"
              data-test="login-password"
              :label="t('login.password')"
              :placeholder="t('login.password')"
              type="password"
              required
            />

            <OButton
              data-cy="login-sign-in"
              data-test="login-sign-in"
              variant="primary"
              size="sm-action"
              block
              type="submit"
              :loading="submitting"
            >
              {{ t('login.login') }}
            </OButton>
          </OForm>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

import { useI18n } from "vue-i18n";
import authService from "@/services/auth";
import organizationsService from "@/services/organizations";
import {
  getBasicAuth,
  b64EncodeStandard,
  useLocalUserInfo,
  useLocalCurrentUser,
  useLocalOrganization,
  getImageURL,
} from "@/utils/zincutils";
import { redirectUser } from "@/utils/common";
import { computed } from "vue";
import { useTheme } from "@/composables/useTheme";
import config from "@/aws-exports";
import OButton from '@/lib/core/Button/OButton.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import OFormInput from '@/lib/forms/Input/OFormInput.vue';
import { openobserveRum } from "@openobserve/browser-rum";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import { makeLoginSchema, loginDefaults, type LoginForm } from "./Login.schema";

export default defineComponent({
  name: "PageLogin",
  components: { OButton, OForm, OFormInput },

  setup() {
    const store = useStore();
    const router = useRouter();
    const { isDark } = useTheme();
    const { t } = useI18n();
    const name = ref("");
    const password = ref("");
    const confirmpassword = ref("");
    const email = ref("");
    const selectedOrg = ref({});
    const autoRedirectDexLogin = ref(false);
    let orgOptions = ref([{ label: Number, value: String }]);
    useReo();

    const submitting = ref(false);

    const loginAsInternalUser = ref(false);

    // Zod schema for the internal-user login form (email + required password).
    // Built via the i18n factory and RETURNED from setup() so `:schema` resolves
    // in the Options-API template (a module-scope import is out of the template's
    // scope, which would silently disable validation).
    const loginSchema = makeLoginSchema(t);

    onBeforeMount(() => {

      if (
        config.isCloud == "true" &&
        router.currentRoute.value.path != "/cb"
      ) {
        autoRedirectDexLogin.value = true;
        loginWithSSo();
      }

      if (router.currentRoute.value.query.login_as_internal_user === "true") {
        loginAsInternalUser.value = true;
      }
    });

    const showSSO = computed(() => {
      return store.state.zoConfig.sso_enabled && config.isEnterprise === "true";
    });

    const showInternalLogin = computed(() => {
      return store.state.zoConfig.native_login_enabled;
    });

    const loginWithSSo = async () => {
      try {
        authService.get_dex_login().then((res) => {
          if (res) {
            window.location.href = res;
            return;
          }
        });
      } catch (error) {
        console.error("Error during redirection:");
      }
    };

    // Called by OForm's @submit with the schema-validated values. Still accepts
    // no argument (falls back to the name/password refs) so it can be invoked
    // directly — the empty-field guard below stays as defense in depth even
    // though the schema now blocks empty/invalid submits before we get here.
    const onSignIn = (values?: LoginForm) => {
      const nameValue = values?.name ?? name.value;
      const passwordValue = values?.password ?? password.value;
      if (nameValue == "" || passwordValue == "") {
        toast({
          variant: "warning",
          message: "Please input valid username or password.",
        });
      } else {
        submitting.value = true;
        try {
          //authorize user using username and password
          authService
            .sign_in_user({
              name: nameValue,
              password: passwordValue,
            })
            .then(async (res: any) => {
              //if user is authorized, get user info
              if (res.data.status == true) {
                //get user info from backend and extract auth token and set it into localstorage
                const authToken = getBasicAuth(name.value, password.value);
                const userInfo = {
                  given_name: nameValue,
                  auth_time: Math.floor(Date.now() / 1000),
                  name: nameValue,
                  exp: Math.floor(
                    (new Date().getTime() + 1000 * 60 * 60 * 24 * 30) / 1000,
                  ),
                  family_name: "",
                  email: nameValue,
                  role: res.data.role,
                };
                const encodedUserInfo: any = b64EncodeStandard(
                  JSON.stringify(userInfo),
                );
                //set user info into localstorage & store
                useLocalUserInfo(encodedUserInfo);
                store.dispatch("setUserInfo", encodedUserInfo);

                useLocalCurrentUser(JSON.stringify(userInfo));
                store.dispatch("setCurrentUser", userInfo);

                if(store.state.zoConfig?.rum?.enabled) {
                  // Set user information first
                  openobserveRum.setUser({
                    name: userInfo.given_name + " " + userInfo.family_name,
                    email: userInfo.email,
                  });
                  // Now start session replay recording after user is identified
                  openobserveRum.startSessionReplayRecording({ force: true });
                }

                //check for redirect URI and redirect user to that page
                const redirectURI =
                  window.sessionStorage.getItem("redirectURI");
                window.sessionStorage.removeItem("redirectURI");

                //check organization information stored in localstorage along with email
                //if email is different, remove organization information from localstorage
                const localOrg: any = useLocalOrganization();
                let tempDefaultOrg = {};
                let localOrgFlag = false;
                if (
                  Object.keys(localOrg.value).length > 0 &&
                  localOrg.value != null &&
                  localOrg.value.user_email !== userInfo.email
                ) {
                  localOrg.value = null;
                  useLocalOrganization("");
                }

                //if organization information is not available in localstorage, get all organizations from backend
                //and set first organization as selected organization
                if (localOrg.value) {
                  selectedOrg.value = localOrg.value;
                  useLocalOrganization(selectedOrg.value);
                  store.dispatch("setSelectedOrganization", selectedOrg.value);
                } else {
                  await organizationsService
                    .os_list(0, 100000, "id", false, "", "default")
                    .then((res: any) => {
                      orgOptions.value = res.data.data.map(
                        (data: {
                          id: any;
                          name: any;
                          type: any;
                          identifier: any;
                          UserObj: any;
                          ingest_threshold: any;
                          search_threshold: any;
                          CustomerBillingObj: any;
                          status: any;
                        }) => {
                          let optiondata: any = {
                            label: data.name,
                            id: data.id,
                            identifier: data.identifier,
                            user_email: store.state.userInfo.email,
                            ingest_threshold: data.ingest_threshold,
                            search_threshold: data.search_threshold,
                            subscription_type:
                              Object.prototype.hasOwnProperty.call(
                                data,
                                "CustomerBillingObj",
                              )
                                ? data.CustomerBillingObj.subscription_type
                                : "",
                            status: data.status,
                            note: Object.prototype.hasOwnProperty.call(
                              data,
                              "CustomerBillingObj",
                            )
                              ? data.CustomerBillingObj.note
                              : "",
                          };

                          if (
                            (Object.keys(selectedOrg.value).length == 0 &&
                              (data.type == "default" || data.id == "1") &&
                              store.state.userInfo.email ==
                                data.UserObj.email) ||
                            res.data.data.length == 1
                          ) {
                            localOrgFlag = true;
                            selectedOrg.value = localOrg.value
                              ? localOrg.value
                              : optiondata;
                            useLocalOrganization(selectedOrg.value);
                            store.dispatch(
                              "setSelectedOrganization",
                              selectedOrg.value,
                            );
                          }

                          if (data.type == "default") {
                            tempDefaultOrg = optiondata;
                          }

                          return optiondata;
                        },
                      );

                      if (localOrgFlag == false) {
                        selectedOrg.value = tempDefaultOrg;
                        useLocalOrganization(tempDefaultOrg);
                        store.dispatch(
                          "setSelectedOrganization",
                          tempDefaultOrg,
                        );
                      }
                    });
                }
                  redirectUser(redirectURI);
              } else {
                //if user is not authorized, show error message and reset form.
                submitting.value = false;
                toast({
                  variant: "error",
                  message: res.data.message,
                });
              }
            })
            .catch(() => {
              //if any error occurs, show error message and reset form.
              submitting.value = false;
              toast({
                variant: "error",
                message: "Invalid username or password",
              });
            });
        } catch (e) {
          submitting.value = false;
          toast({
            variant: "warning",
            message: "Please fill all the fields and try again.",
          });
        }
      }
    };

    return {
      t,
      name,
      password,
      confirmpassword,
      email,
      submitting,
      onSignIn,
      loginSchema,
      loginDefaults,
      tab: ref("signin"),
      innerTab: ref("signup"),
      store,
      getImageURL,
      loginAsInternalUser,
      showSSO,
      showInternalLogin,
      loginWithSSo,
      config,
      autoRedirectDexLogin,
      isDark,
    };
  },
  methods: {
    selected(item: any) {
      toast({ message: `Selected suggestion "${item.label}"` });
    },
  },
});
</script>
