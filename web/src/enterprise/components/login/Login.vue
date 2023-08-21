<!-- Copyright 2023 Zinc Labs Inc.

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
  <div class="justify align-center">
    <h5>Wait while redirecting...</h5>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref } from "vue";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getUserInfo, getDecodedUserInfo, getPath } from "@/utils/zincutils";

import usersService from "@/services/users";
import organizationsService from "@/services/organizations";
import { useLocalCurrentUser, useLocalOrganization } from "@/utils/zincutils";
import segment from "@/services/segment_analytics";
import moment from "moment";

export default defineComponent({
  name: "PageLoginCallback",
  setup() {
    const store = useStore();
    const q = useQuasar();
    const router = useRouter();
    const selectedOrg = ref("");
    let orgOptions = ref([{ label: Number, value: String }]);

    /**
     * Get all organizations for the user
     * check local storage for the default organization if user email is not same as local storage user email reset the local storage
     * there is no organization in localstorage, check for default organization of that user by using user email and set the default organization
     * if there is only one organization set that as default organization
     * redirect user to the page where user was redirected from
     */
    const getDefaultOrganization = () => {
      organizationsService.list(0, 1000, "id", false, "").then((res: any) => {
        const localOrg: any = useLocalOrganization();
        if (
          localOrg.value != null &&
          localOrg.value.user_email !== store.state.userInfo.email
        ) {
          localOrg.value = null;
          useLocalOrganization("");
        }

        store.dispatch("setOrganizations", res.data.data);
        orgOptions.value = res.data.data.map(
          (data: {
            id: any;
            name: any;
            type: any;
            identifier: any;
            UserObj: any;
          }) => {
            let optiondata: any = {
              label: data.name,
              id: data.id,
              identifier: data.identifier,
              user_email: store.state.userInfo.email,
            };

            if (
              (selectedOrg.value == "" &&
                data.type == "default" &&
                store.state.userInfo.email == data.UserObj.email) ||
              res.data.data.length == 1
            ) {
              selectedOrg.value = localOrg.value ? localOrg.value : optiondata;
              useLocalOrganization(selectedOrg.value);
              store.dispatch("setSelectedOrganization", selectedOrg.value);
            }
            return optiondata;
          }
        );

        const redirectURI = window.sessionStorage.getItem("redirectURI");
        window.sessionStorage.removeItem("redirectURI");
        redirectUser(redirectURI);
      });
    };

    /**
     * Redirect user to the page where user was redirected from
     * @param redirectURI
     */
    const redirectUser = (redirectURI) => {
      const path = getPath();
      if (redirectURI != null && redirectURI != "") {
        // router.push({ path: redirectURI });
        window.location.replace(path);
      } else {
        // router.push({ path: "/" });
        window.location.replace(path);
      }
    };

    return {
      store,
      redirectUser,
      getDefaultOrganization,
    };
  },
  data() {
    return {
      user: {
        email: "",
        cognito_sub: "",
        first_name: "",
        last_name: "",
      },
      userInfo: {},
    };
  },
  created() {
    /**
     * Get the user info from the url hash
     * if user info is not null and user email is not null
     * set the user info to the user object
     * check the local storage for the user info
     * if user info is not null and user info has property pgdata
     * set the user info to the vuex store
     * else call the verify and create user method as user is not registered
     */
    const token = getUserInfo(this.$route.hash);
    if (token !== null && token.email != null) {
      this.user.email = token.email;
      this.user.cognito_sub = token.sub;
      this.user.first_name = token.given_name ? token.given_name : "";
      this.user.last_name = token.family_name ? token.family_name : "";
    } else {
      //redirect to error page
    }

    const sessionUserInfo = getDecodedUserInfo();
    const d = new Date();
    this.userInfo =
      sessionUserInfo !== null ? JSON.parse(sessionUserInfo) : null;
    if (this.userInfo !== null && this.userInfo.hasOwnProperty("pgdata")) {
      this.store.dispatch("login", {
        loginState: true,
        userInfo: this.userInfo,
      });
    } else {
      this.VerifyAndCreateUser();
    }
  },
  methods: {
    /**
     * Verify the user by using user email
     * if user id is 0 then call the add new user method
     * else set the user info to the vuex store
     * get the default organization for the user
     */
    VerifyAndCreateUser() {
      usersService.verifyUser(this.userInfo.email).then((res) => {
        useLocalCurrentUser(res.data.data);
        this.store.dispatch("setCurrentUser", res.data.data);

        if (res.data.data.id == 0) {
          const dismiss = this.q.notify({
            spinner: true,
            message: "Please wait while creating new user...",
          });

          usersService.addNewUser(this.user).then((res) => {
            this.userInfo.pgdata = res.data.data;
            this.store.dispatch("login", {
              loginState: true,
              userInfo: this.userInfo,
            });
            dismiss();

            this.getDefaultOrganization();

            //analytics
            segment.identify(
              "Log In",
              {
                email: this.userInfo.email,
                name:
                  this.userInfo.given_name + " " + this.userInfo.family_name,
                firstName: this.userInfo.given_name,
                lastName: this.userInfo.family_name,
              },
              { originalTimestamp: moment.utc().format() }
            );
            //analytics
          });
        } else {
          this.userInfo.pgdata = res.data.data;
          this.store.dispatch("login", {
            loginState: true,
            userInfo: this.userInfo,
          });

          //analytics
          const userId = this.userInfo.email;
          segment.identify(
            "Log In",
            {
              email: userId,
              name: this.userInfo.given_name + " " + this.userInfo.family_name,
              firstName: this.userInfo.given_name,
              lastName: this.userInfo.family_name,
            },
            { originalTimestamp: moment.utc().format() }
          );
          //analytics

          this.getDefaultOrganization();
        }
      });
    },
  },
});
</script>
