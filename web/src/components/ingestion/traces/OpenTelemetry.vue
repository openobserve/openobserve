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
  <div class="title q-pl-md q-pt-md" data-test="vector-title-text"><b>OTLP HTTP</b></div>
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
HTTP Endpoint: {{ endpoint.url }}/api/{{ currOrgIdentifier }}/traces
Authorization: Basic {{ accessKey }}</pre>
  </div>

  <div class="title q-pl-md q-pt-md" data-test="vector-title-text"><b>OTLP gRPC</b> <br />(<b>Note:</b> Only available for single node. Not supported in distributed mode.)</div>
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
  insecure: {{endpoint.protocol == "https" ? false : true}}</pre>
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
