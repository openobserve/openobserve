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
    <CopyContent class="copy-content-container-cls" :content="raw(content)" />
  </IngestionContent>
</template>

<script lang="ts">
import { raw } from "@/types/i18n";
import { defineComponent } from "vue";
import { useStore } from "vuex";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import CopyContent from "@/components/CopyContent.vue";
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
  components: { CopyContent, IngestionContent },
  setup() {
    const store = useStore();
    const endpoint = getEndPoint(getIngestionURL());
    const content = `HTTP Endpoint: ${endpoint.url}/aws/${store.state.selectedOrganization.identifier}/default/_kinesis_firehose
Access Key: [BASIC_PASSCODE]`;
    return {
      raw,
      content,
    };
  },
});
</script>
