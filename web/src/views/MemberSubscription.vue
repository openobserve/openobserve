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
  <q-page class="row justify-center items-center">
    <h6 v-if="status == 'processing'">{{ message }}</h6>
    <h6 v-else-if="status == 'error'">
      Error while processing member subscription request.
    </h6>
    <h2 v-else>Thank you for your subscription.</h2>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getSessionStorageVal, useLocalOrganization } from "../utils/zincutils";

import organizationsService from "../services/organizations";

export default defineComponent({
  name: "PageUser",
  data() {
    return {
      status: "processing",
      message: "Please wait while we process your request...",
    };
  },
  created() {
    const propArr = this.$route.hash.split("=");
    this.ProcessSubscription(propArr[1]);
  },
  methods: {
    async ProcessSubscription(s: any) {
      await organizationsService
        .process_subscription(s)
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
        });
    },
  },
  setup() {
    const $store = useStore();
    const $q = useQuasar();
    const $router = useRouter();

    return {
      $store,
    };
  },
});
</script>
