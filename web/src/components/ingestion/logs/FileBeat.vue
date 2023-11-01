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
  <div class="tabContent q-ma-md">
    <div class="tabContent__head">
      <div class="copy_action">
        <q-btn
          data-test="fluent-bit-copy-btn"
          flat
          round
          size="0.5rem"
          padding="0.6rem"
          color="grey"
          icon="content_copy"
          @click="$emit('copy-to-clipboard-fn', fluentbitContent)"
        />
      </div>
    </div>
    <pre ref="fluentbitContent" data-test="fluent-bit-content-text">
setup.ilm.enabled: false
setup.template.enabled: true
setup.template.name: "nginx-log"
setup.template.pattern: "nginx-log-*"
setup.template.overwrite: true

filebeat.inputs:
- type: log
  enabled: true
  paths:
    - /var/log/nginx/*.log

output.elasticsearch:
  hosts: ["{{ endpoint.protocol }}://{{ endpoint.host }}:{{ endpoint.port }}"]
  timeout: 10
  path: "/api/{{ currOrgIdentifier }}/"
  index: default
  username: "{{ currUserEmail }}"
  password: "{{ store.state.organizationData.organizationPasscode }}"</pre
    >
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, type Ref } from "vue";
import config from "../../../aws-exports";
import { useStore } from "vuex";
import { getImageURL } from "../../../utils/zincutils";
import type { Endpoint } from "@/ts/interfaces";
export default defineComponent({
  name: "FileBeat",
  props: {
    currOrgIdentifier: {
      type: String,
    },
    currUserEmail: {
      type: String,
    },
  },
  setup() {
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
    const fluentbitContent = ref(null);
    return {
      store,
      config,
      endpoint,
      fluentbitContent,
      getImageURL,
    };
  },
});
</script>
