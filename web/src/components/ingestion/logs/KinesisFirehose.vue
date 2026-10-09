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
    <CredentialCodeBlock slug="kinesis-firehose" :content="content" />
  </IngestionContent>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useStore } from "vuex";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";

export default defineComponent({
  name: "KinesisFirehose",
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
    const endpoint = getEndPoint(getIngestionURL());
    const targetStream = "default";
    const content = `HTTP Endpoint: ${endpoint.url}/aws/${store.state.selectedOrganization.identifier}/${targetStream}/_kinesis_firehose
Access Key: [BASIC_PASSCODE]`;
    return {
      targetStream,
      content,
    };
  },
});
</script>
