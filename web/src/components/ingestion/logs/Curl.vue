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
    <CredentialCodeBlock slug="curl" lang="bash" :content="content" />
  </IngestionContent>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import config from "../../../aws-exports";
import { useStore } from "vuex";
import { getEndPoint, getImageURL, getIngestionURL, maskText } from "../../../utils/zincutils";
import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
export default defineComponent({
  name: "curl-mechanism",
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
    //here we can use the getIngestionURL function to get the ingestion URL
    //it calls the store.state.API_ENDPOINT if it is not present in the store.state.zoConfig.ingestion_url
    const ingestionURL = getIngestionURL();
    endpoint.value = getEndPoint(ingestionURL);

    // Cloud endpoints carry valid certificates, so -k there only teaches users to skip TLS checks.
    const insecureFlag = config.isCloud === "true" ? "" : " -k";
    const content = `curl -u [EMAIL]:[PASSCODE]${insecureFlag} ${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/default/_json -d "[{\\"level\\":\\"info\\",\\"job\\":\\"test\\",\\"log\\":\\"test message for openobserve\\"}]"`;

    return {
      store,
      config,
      endpoint,
      getImageURL,
      maskText,
      content,
    };
  },
});
</script>
