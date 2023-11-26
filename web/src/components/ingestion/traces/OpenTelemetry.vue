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
    <div class="tabContent q-ma-md">
      <div class="tabContent__head">
        <div class="copy_action">
          <q-btn
            data-test="traces-copy-btn"
            flat
            round
            color="grey"
            icon="content_copy"
            @click="$emit('copy-to-clipboard-fn', copyHTTPTracesContent)"
          />
        </div>
      </div>
      <pre ref="copyHTTPTracesContent" data-test="traces-http-content-text">
HTTP Endpoint: {{ endpoint.url }}/api/{{ currOrgIdentifier }}/v1/traces
Authorization: Basic {{ accessKey }}</pre
      >
    </div>

    <div class="title q-pl-md q-pt-md" data-test="vector-title-text">
      <b>OTLP gRPC</b> <br /><b>Note:</b> Not supported in clustered
      installation of OpenObserve yet.
    </div>
    <div class="tabContent q-ma-md">
      <div class="tabContent__head">
        <div class="copy_action">
          <q-btn
            data-test="traces-copy-btn"
            flat
            round
            color="grey"
            icon="content_copy"
            @click="$emit('copy-to-clipboard-fn', copyGRPCTracesContent)"
          />
        </div>
      </div>
      <pre ref="copyGRPCTracesContent" data-test="traces-grpc-content-text">
endpoint: {{ endpoint.host }}
headers: 
  Authorization: "Basic {{ accessKey }}"
  organization: {{ currOrgIdentifier }}
  stream-name: default
tls:
  insecure: {{ endpoint.protocol == "https" ? false : true }}</pre
      >
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, type Ref } from "vue";
import config from "../../../aws-exports";
import { useStore } from "vuex";
import { getImageURL, b64EncodeUnicode } from "../../../utils/zincutils";
import type { Endpoint } from "@/ts/interfaces";
import { computed } from "vue";
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
    const accessKey = computed(() => {
      return b64EncodeUnicode(
        `${props.currUserEmail}:${store.state.organizationData.organizationPasscode}`
      );
    });
    const copyHTTPTracesContent = ref(null);
    const copyGRPCTracesContent = ref(null);
    return {
      store,
      config,
      endpoint,
      copyHTTPTracesContent,
      copyGRPCTracesContent,
      accessKey,
      getImageURL,
    };
  },
});
</script>
