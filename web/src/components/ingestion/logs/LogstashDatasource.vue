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
  <IngestionContent :target-stream="targetStream">
    <CredentialCodeBlock slug="logstash" :content="content" />
  </IngestionContent>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import config from "../../../aws-exports";
import { useStore } from "vuex";
import { getEndPoint, getImageURL, getIngestionURL } from "../../../utils/zincutils";
import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
export default defineComponent({
  name: "logstash-datasource",
  props: {
    currOrgIdentifier: {
      type: String,
    },
    currUserEmail: {
      type: String,
    },
  },
  components: { CredentialCodeBlock, IngestionContent },
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
    const targetStream = "default";
    const content = `output {
  http {
    url => "${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/${targetStream}/_json"
    http_method => "post"
    format => "json_batch"
    headers => {
      "Authorization" => "Basic [BASIC_PASSCODE]"
      "Content-Type" => "application/json"
    }
  }
}`;
    return {
      targetStream,
      store,
      config,
      endpoint,
      content,
      getImageURL,
    };
  },
});
</script>
