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
import {
  getUserInfo,
  getDecodedUserInfo,
  getSessionStorageVal,
  useLocalToken,
} from "../utils/zincutils";

import usersService from "../services/users";
import organizationsService from "../services/organizations";
import { useLocalCurrentUser, useLocalOrganization } from "../utils/zincutils";
import MainLayout from "../layouts/MainLayout.vue";
import { Redirect } from "@aws-sdk/client-s3";

// import segment from "@/services/segment_analytics";

export default defineComponent({
  name: "PageLoginCallback",
  components: { MainLayout },
  setup() {
    const $store = useStore();
    const $q = useQuasar();
    const $router = useRouter();

    const selectedOrg = ref("");
    let orgOptions = ref([{ label: Number, value: String }]);
    const getDefaultOrganization = () => {
      console.log($store.state.userInfo);
      organizationsService.list(0, 1000, "id", false, "").then((res: any) => {
        const localOrg: any = useLocalOrganization();
        if (
          localOrg.value != null &&
          localOrg.value.user_email !== $store.state.userInfo.email
        ) {
          localOrg.value = null;
          useLocalOrganization("");
        }

        $store.dispatch("setOrganizations", res.data.data);
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
              user_email: $store.state.userInfo.email,
            };

            if (
              (selectedOrg.value == "" &&
                data.type == "default" &&
                $store.state.userInfo.email == data.UserObj.email) ||
              res.data.data.length == 1
            ) {
              selectedOrg.value = localOrg.value ? localOrg.value : optiondata;
              useLocalOrganization(selectedOrg.value);
              $store.dispatch("setSelectedOrganization", selectedOrg.value);
            }
            return optiondata;
          }
        );

        const redirectURI = window.sessionStorage.getItem("redirectURI");
        window.sessionStorage.removeItem("redirectURI");
        redirectUser(redirectURI);
      });
    };

    const redirectUser = (redirectURI) => {
      if (redirectURI != null && redirectURI != "") {
        // $router.push({ path: redirectURI });
        window.location.replace(window.location.origin + redirectURI);
      } else {
        // $router.push({ path: "/" });
        window.location.replace(window.location.origin);
      }
    };

    return {
      $store,
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
    // console.log(this.$route.hash.replace("#", ""));
    const token = getUserInfo(this.$route.hash);
    if (token !== null && token.email != null) {
      this.user.email = token.email;
      this.user.cognito_sub = token.sub;
      this.user.first_name = token.given_name ? token.given_name : "";
      this.user.last_name = token.family_name ? token.family_name : "";
      console.log("user assignment", JSON.stringify(this.user));
    } else {
      //redirect to error page
    }

    const sessionUserInfo = getDecodedUserInfo();
    console.log(sessionUserInfo);
    const d = new Date();
    console.log(d.getTime() / 1000);
    this.userInfo =
      sessionUserInfo !== null ? JSON.parse(sessionUserInfo) : null;
    if (this.userInfo !== null && this.userInfo.hasOwnProperty("pgdata")) {
      this.$store.dispatch("login", {
        loginState: true,
        userInfo: this.userInfo,
      });
    } else {
      this.VerifyAndCreateUser();
    }
  },
  methods: {
    VerifyAndCreateUser() {
      console.log(
        "before verify",
        JSON.stringify(this.user),
        JSON.stringify(this.userInfo)
      );
      usersService.verifyUser(this.userInfo.email).then((res) => {
        useLocalCurrentUser(res.data.data);
        this.$store.dispatch("setCurrentUser", res.data.data);

        if (res.data.data.id == 0) {
          const dismiss = this.$q.notify({
            spinner: true,
            message: "Please wait while creating new user...",
          });

          usersService.addNewUser(this.user).then((res) => {
            this.userInfo.pgdata = res.data.data;
            this.$store.dispatch("login", {
              loginState: true,
              userInfo: this.userInfo,
            });
            dismiss();

            this.getDefaultOrganization();

            //analytics
            userId = this.userInfo.email;
            segment.identify(userId, {
              email: this.userInfo.email,
              name: this.userInfo.given_name + " " + this.userInfo.family_name,
              firstName: this.userInfo.given_name,
              lastName: this.userInfo.family_name,
            });
            //amalytics
          });
        } else {
          this.userInfo.pgdata = res.data.data;
          this.$store.dispatch("login", {
            loginState: true,
            userInfo: this.userInfo,
          });

          //analytics
          console.log("this.userInfo: ", this.userInfo);
          const userId = this.userInfo.email;
          // segment.identify(userId, {
          //   email: userId,
          //   name: this.userInfo.given_name + " " + this.userInfo.family_name,
          //   firstName: this.userInfo.given_name,
          //   lastName: this.userInfo.family_name,
          // });
          //amalytics

          this.getDefaultOrganization();
        }
      });
    },
  },
});
</script>
