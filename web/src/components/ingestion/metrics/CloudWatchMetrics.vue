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
      href="https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-metric-streams-setup-datalake.html"
    >
      {{ t('ingestion.cloudwatchMetrics.docLinkText') }}</IngestionDocLink
    >
    <div class="italic">
      {{ t('ingestion.cloudwatchMetrics.outputNote') }}
    </div>
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
  name: "cloudwatchMetrics",
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

    const content = `HTTP Endpoint: ${endpoint.value.url}/aws/${store.state.selectedOrganization.identifier}/cloudwatch_metrics/_kinesis_firehose
Access Key: [BASIC_PASSCODE]`;
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
