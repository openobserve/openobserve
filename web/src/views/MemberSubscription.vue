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
  <q-page>
    <div
      style="text-align: center; width: 100%; font-size: 30px; margin: 40px 0px"
    >
      Member Subscription
    </div>
    <div v-if="status == 'processing'">{{ message }}</div>
    <div
      v-else-if="status == 'error' && error == ''"
      style="text-align: center"
    >
      Error while processing member subscription request.<br /><br />
    </div>
    <div
      v-else-if="status == 'error' && error !== ''"
      v-html="error"
      class="subscription_message"
    ></div>
    <div v-else>Thank you for your subscription.</div>

    <div
      v-if="status == 'error' && error !== ''"
      class="subscription_message q-btn-primary"
    >
      <b>Please click the button below to proceed with your subscription after taking above mentioned action.</b><br />
      <q-btn @click="ProcessSubscription(queryString, 'confirm')" class="q-mt-md">Confirm Member Subscription</q-btn>
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getSessionStorageVal, useLocalOrganization, getPath } from "../utils/zincutils";

import organizationsService from "../services/organizations";

export default defineComponent({
  name: "PageUser",
  data() {
    return {
      status: "processing",
      message: "Please wait while we process your request...",
      error: "",
      queryString: this.$route.hash.split("=")[1],
    };
  },
  created() {
    const propArr = this.$route.hash.split("=");
    this.ProcessSubscription(propArr[1], "normal");
  },
  methods: {
    async ProcessSubscription(s: any, action: string) {
      const baseURL = getPath();
      alert(baseURL)
      await organizationsService
        .process_subscription(s, action)
        .then((res) => {
          this.status = "completed";
          const dismiss = this.$q.notify({
            type: "positive",
            message: res.data.message,
          });

          if (res.data.hasOwnProperty("data")) {
            res.data.data.label = res.data.data.name;
            useLocalOrganization(res.data.data);

            window.location.href = "/organizations";
          } else {
            window.location.href = "/organizations";
          }
          return res;
        })
        .catch((e) => {
          this.status = "error";
          this.error = e.response.data.error.replaceAll("[BASE_URL]", baseURL);
        });
    },
  },
  setup() {
    const $store = useStore();
    const $q = useQuasar();
    const $router = useRouter();

    return {
      $router,
      $store,
    };
  },
});
</script>

<style lang="scss" scoped>
.subscription_message {
  font-size: 16px;
  line-height: 30px;
  width: 70%;
  margin: auto;
  text-align: left;
}
</style>
