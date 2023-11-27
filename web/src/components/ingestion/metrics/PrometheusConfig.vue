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
    <div class="tabContent q-ma-md">
      <div class="tabContent__head">
        <div class="copy_action">
          <q-btn
            data-test="traces-copy-btn"
            flat
            round
            size="0.5rem"
            padding="0.6rem"
            color="grey"
            icon="content_copy"
            @click="$emit('copy-to-clipboard-fn', copyTracesContent)"
          />
        </div>
      </div>
      <pre ref="copyTracesContent" data-test="traces-content-text">
remote_write:
  - url: {{ endpoint.url }}/api/{{ currOrgIdentifier }}/prometheus/api/v1/write
    basic_auth:
      username: {{ currUserEmail }}
      password: {{ store.state.organizationData.organizationPasscode }}</pre
      >
    </div>
    <div>
      <a
        href="https://openobserve.ai/blog/send-metrics-using-kube-prometheus-stack-to-openobserve"
        class="q-ml-lg text-bold"
        style="padding-right: 2px"
        target="_blank"
        title="Send Kubernetes Metrics Using Prometheus to OpenObserve"
      >
        Click here</a
      >
      to learn how to ingest metrics using Prometheus
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
    const copyTracesContent = ref(null);
    return {
      store,
      config,
      endpoint,
      copyTracesContent,
      accessKey,
      getImageURL,
    };
  },
});
</script>
