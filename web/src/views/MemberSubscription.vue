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
  <div class="rounded-default">
    <div
      class="text-center w-full"
      style="font-size: var(--text-3xl); margin: 40px 0px"
    >
      Member Subscription
    </div>
    <div v-if="status == 'processing'">{{ message }}</div>
    <div
      v-else-if="status == 'error' && error == ''"
      class="text-center"
    >
      Error while processing member subscription request.<br /><br />
    </div>

    <SanitizedHtmlRenderer
      v-else-if="status == 'error' && error !== ''"
      :htmlContent="error"
      class="text-base leading-7.5 w-[70%] mx-auto text-left"
    />

    <div v-else>Thank you for your subscription.</div>

    <!-- <div
      v-if="status == 'error' && error !== ''"
      class="subscription_message"
    >
      <b>Please click the button below to proceed with your subscription after taking above mentioned action.</b><br />
      <OButton variant="primary" class="mt-3" @click="ProcessSubscription(queryString, 'confirm')">Confirm Member Subscription</OButton>
    </div> -->
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useLocalOrganization, getPath } from "../utils/zincutils";

import organizationsService from "../services/organizations";
import SanitizedHtmlRenderer from "@/components/SanitizedHtmlRenderer.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "PageUser",
  components: {
    SanitizedHtmlRenderer,
  },
  data() {
    return {
      status: "processing",
      message: "Please wait while we process your request...",
      error: "",
      queryString: this.$route.hash.split("=")[1],
    };
  },
  created() {
    const propArr = this.$route.hash.substring(1);
    const params = new URLSearchParams(propArr);
    const sub_key = params.get("sub_key");
    this.ProcessSubscription(sub_key, "confirm");
  },
  methods: {
    async ProcessSubscription(s: any, action: string) {
      const baseURL = getPath();
      const route = this.$router.resolve({ name: "organizations" });
      const redirectURI = route.href || baseURL;
      const hash = this.$route.hash.substring(1);
      const params = new URLSearchParams(hash);
      const invited_org_id = params.get("org_id");
      await organizationsService
        .process_subscription(s, action, invited_org_id ?? "")
        .then((res) => {
          this.status = "completed";
          toast({
            variant: "success",
            message: res.data.message,
          });

          if (Object.prototype.hasOwnProperty.call(res.data, "data")) {
            res.data.data.label = res.data.data.name;
            useLocalOrganization(res.data.data);

            window.location.href = redirectURI + "?org_identifier=" + invited_org_id;
          } else {
            window.location.href = redirectURI + "?org_identifier=" + invited_org_id;
          }
          return res;
        })
        .catch((e) => {
          this.status = "error";
          this.error = e.response.data.message.replaceAll("[BASE_URL]", baseURL);
        });
    },
  },
  setup() {
    const $store = useStore();
    const $router = useRouter();

    return {
      $router,
      $store,
    };
  },
});
</script>

