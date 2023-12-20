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
  <div>
    <div class="title q-pl-md q-pt-md" data-test="vector-title-text">
      <b>OTLP HTTP</b>
    </div>
    <div class="q-ma-md">
      <CopyContent class="q-mt-sm" :content="copyHTTPTracesContent" />
    </div>

    <div class="title q-pl-md q-pt-md" data-test="vector-title-text">
      <b>OTLP gRPC</b> <br /><b>Note:</b> Not supported in clustered
      installation of OpenObserve yet.
    </div>
    <div class="q-ma-md">
      <CopyContent class="q-mt-sm" :content="copyGRPCTracesContent" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, type Ref } from "vue";
import config from "../../../aws-exports";
import { useStore } from "vuex";
import { getImageURL } from "../../../utils/zincutils";
import CopyContent from "@/components/CopyContent.vue";

export default defineComponent({
  name: "traces-otlp",
  props: {
    currOrgIdentifier: {
      type: String,
    },
    currUserEmail: {
      type: String,
    },
  },
  components: { CopyContent },
  setup(props) {
    const store = useStore();
    const endpoint: any = ref({
      url: "",
      host: "",
      port: "",
      protocol: "",
      tls: "",
    });
    const url = new URL(store.state.API_ENDPOINT);
    endpoint.value = {
      url: store.state.API_ENDPOINT,
      host: url.hostname,
      port: url.port || (url.protocol === "https:" ? "443" : "80"),
      protocol: url.protocol.replace(":", ""),
      tls: url.protocol === "https:" ? "On" : "Off",
    };

    const copyHTTPTracesContent = `HTTP Endpoint: ${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/v1/traces
Authorization: Basic [BASIC_PASSCODE]`;
    const copyGRPCTracesContent = `endpoint: ${endpoint.value.host}
headers: 
  Authorization: "Basic [BASIC_PASSCODE]"
  organization: ${store.state.selectedOrganization.identifier}
  stream-name: default
tls:
  insecure: ${endpoint.value.protocol == "https" ? false : true }`;
    return {
      store,
      config,
      endpoint,
      copyHTTPTracesContent,
      copyGRPCTracesContent,
      getImageURL,
    };
  },
});
</script>
