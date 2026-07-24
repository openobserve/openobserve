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
  <IngestionContent>
    <CopyContent class="copy-content-container-cls" :content="content" />
    <IngestionDocLink
      href="https://openobserve.ai/blog/send-metrics-using-kube-prometheus-stack-to-openobserve"
    >
      {{ t('ingestion.prometheusDocLinkText') }}</IngestionDocLink
    >
  </IngestionContent>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import config from "../../../aws-exports";
import { useStore } from "vuex";
import { getEndPoint, getImageURL, getIngestionURL } from "../../../utils/zincutils";
import CopyContent from "@/components/CopyContent.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";
import { useI18n } from "vue-i18n";

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
  components: { CopyContent, IngestionContent, IngestionDocLink },
  setup() {
    const { t } = useI18n();
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
    const content = `remote_write:
  - url: ${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/prometheus/api/v1/write
    queue_config:
      max_samples_per_send: 10000
    basic_auth:
      username: [EMAIL]
      password: [PASSCODE]`;
    return {
      t,
      store,
      config,
      endpoint,
      content,
      getImageURL,
    };
  },
});
</script>
