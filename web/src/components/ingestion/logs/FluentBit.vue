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
  <div class="q-ma-md">
    <CopyContent class="q-mt-sm" :content="content" />
  </div>
  <div>
    <a
      href="https://openobserve.ai/blog/how-to-send-kubernetes-logs-using-fluent-bit"
      class="q-ml-lg text-bold"
      style="padding-right: 2px"
      target="_blank"
      title="Harnessing the Power of FluentBit to Stream Kubernetes Logs to OpenObserve!"
    >
      Click here</a
    >
    to explore the process of sending logs from Kubernetes to OpenObserve using
    FluentBit.
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, type Ref } from "vue";
import config from "../../../aws-exports";
import { useStore } from "vuex";
import { getEndPoint, getImageURL, getIngestionURL } from "../../../utils/zincutils";
import CopyContent from "@/components/CopyContent.vue";
export default defineComponent({
  name: "fluentbit-mechanism",
  props: {
    currOrgIdentifier: {
      type: String,
    },
    currUserEmail: {
      type: String,
    },
  },
  components: { CopyContent },
  setup() {
    const store = useStore();
    const endpoint: any = ref({
      url: "",
      host: "",
      port: "",
      protocol: "",
      tls: "",
    });

    const ingestionURL = getIngestionURL();
    endpoint.value = getEndPoint(ingestionURL);
    const content = `[OUTPUT]
  Name http
  Match *
  URI /api/${store.state.selectedOrganization.identifier}/default/_json
  Host ${endpoint.value.host}
  Port ${endpoint.value.port}
  tls ${endpoint.value.tls}
  Format json
  Json_date_key    ${store.state.zoConfig.timestamp_column}
  Json_date_format iso8601
  HTTP_User [EMAIL]
  HTTP_Passwd [PASSCODE]
  compress gzip`;
    return {
      store,
      config,
      endpoint,
      content,
      getImageURL,
    };
  },
});
</script>
