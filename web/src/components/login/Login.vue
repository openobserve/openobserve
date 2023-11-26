<!-- Copyright 2023 Zinc Labs Inc.

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
  <q-layout view="hHh lpR fFf">
    <q-page-container>
      <q-page class="fullscreen bg-grey-7 flex flex-center">
        <q-card square class="my-card shadow-24 bg-white text-white">
          <q-card-section class="bg-primary">
            <div class="text-h5 q-my-md">OpenObserve</div>
          </q-card-section>
          <q-card>
            <q-card-section class="bg-white">
              <q-form ref="loginform" class="q-gutter-md" @submit.prevent="">
                <q-input
                  v-model="name"
                  data-cy="login-user-id"
                  :label="t('login.email') + ' *'"
                >
                  <template #prepend>
                    <q-icon name="email" />
                  </template>
                </q-input>

                <q-input
                  v-model="password"
                  data-cy="login-password"
                  type="password"
                  :label="t('login.password') + ' *'"
                >
                  <template #prepend>
                    <q-icon name="lock" />
                  </template>
                </q-input>

                <q-card-actions class="q-px-lg q-mt-md q-mb-xl">
                  <q-btn
                    data-cy="login-sign-in"
                    unelevated
                    size="lg"
                    class="full-width"
                    color="primary"
                    type="submit"
                    :label="t('login.signIn')"
                    :loading="submitting"
                    no-caps
                    @click="onSignIn()"
                  />
                </q-card-actions>
              </q-form>
            </q-card-section>
          </q-card>
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script lang="ts">
import { defineComponent, ref, type Ref } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";

import { useI18n } from "vue-i18n";
import authService from "@/services/auth";
import organizationsService from "@/services/organizations";
import {
  useLocalToken,
  getBasicAuth,
  b64EncodeUnicode,
  useLocalUserInfo,
  useLocalCurrentUser,
  useLocalOrganization,
} from "@/utils/zincutils";
import { getDefaultOrganization, redirectUser } from "@/utils/common";

export default defineComponent({
  name: "PageLogin",

  setup() {
    const store = useStore();
    const router = useRouter();
    const $q = useQuasar();
    const { t } = useI18n();
    const name = ref("");
    const password = ref("");
    const confirmpassword = ref("");
    const email = ref("");
    const loginform = ref();

    const submitting = ref(false);

    const onSignIn = () => {
      if (name.value == "" || password.value == "") {
        $q.notify({
          position: "top",
          color: "warning",
          textColor: "white",
          icon: "warning",
          message: "Please input",
        });
      } else {
        submitting.value = true;
        try {
          //authorize user using username and password
          authService
            .sign_in_user({
              name: name.value,
              password: password.value,
            })
            .then(async (res: any) => {
              //if user is authorized, get user info
              if (res.data.status == true) {
                //get user info from backend and extract auth token and set it into localstorage
                const authToken = getBasicAuth(name.value, password.value);
                useLocalToken(authToken);
                const userInfo = {
                  given_name: name.value,
                  auth_time: Math.floor(Date.now() / 1000),
                  name: name.value,
                  exp: Math.floor(
                    (new Date().getTime() + 1000 * 60 * 60 * 24 * 30) / 1000
                  ),
                  family_name: "",
                  email: name.value,
                  role: res.data.role,
                };
                const encodedUserInfo = b64EncodeUnicode(
                  JSON.stringify(userInfo)
                );

                //set user info into localstorage & store
                useLocalUserInfo(encodedUserInfo);
                store.dispatch("setUserInfo", encodedUserInfo);

                useLocalCurrentUser(JSON.stringify(userInfo));
                store.dispatch("setCurrentUser", userInfo);

                //check for redirect URI and redirect user to that page
                const redirectURI =
                  window.sessionStorage.getItem("redirectURI");
                window.sessionStorage.removeItem("redirectURI");

                const selectedOrg: Ref<{
                  label: string;
                  id: string;
                  type: string;
                  identifier: string;
                  user_email: string;
                  ingest_threshold: string;
                  search_threshold: string;
                } | null> = ref(null);

                //check organization information stored in localstorage along with email
                //if email is different, remove organization information from localstorage
                const localOrg: any = useLocalOrganization();
                if (
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
                } else {
                  await organizationsService
                    .os_list(0, 1000, "id", false, "", "default")
                    .then((res: any) => {
                      if (res.data.data.length) {
                        const firstOrg = res.data.data[0];
                        selectedOrg.value = {
                          label: firstOrg.name,
                          id: firstOrg.id,
                          type: firstOrg.type,
                          identifier: firstOrg.identifier,
                          user_email: firstOrg.user_email,
                          ingest_threshold: firstOrg.ingest_threshold,
                          search_threshold: firstOrg.search_threshold,
                        };
                      }
                    });
                }

                //if selected organization is available, set it into localstorage and store
                if (selectedOrg.value) {
                  useLocalOrganization(selectedOrg.value);
                  store.dispatch("setSelectedOrganization", selectedOrg.value);
                  redirectUser(redirectURI);
                }
              } else {
                //if user is not authorized, show error message and reset form.
                submitting.value = false;
                loginform.value.resetValidation();
                $q.notify({
                  color: "negative",
                  message: res.data.message,
                });
              }
            })
            .catch((e: Error) => {
              //if any error occurs, show error message and reset form.
              submitting.value = false;
              loginform.value.resetValidation();
              $q.notify({
                color: "negative",
                message: "Invalid username or password",
              });
              console.log(e);
            });
        } catch (e) {
          submitting.value = false;
          loginform.value.resetValidation();
          $q.notify({
            color: "negative",
            message: "Please fill all the fields and try again.",
          });
          console.log(e);
        }
      }
    };

    return {
      t,
      name,
      password,
      confirmpassword,
      email,
      loginform,
      submitting,
      onSignIn,
      tab: ref("signin"),
      innerTab: ref("signup"),
    };
  },
  methods: {
    selected(item: any) {
      this.$q.notify(`Selected suggestion "${item.label}"`);
    },
  },
});
</script>

<style lang="scss">
.my-card {
  width: 400px;
}
</style>
