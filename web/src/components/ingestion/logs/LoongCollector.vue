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
    <IngestionDocLink href="https://github.com/alibaba/loongcollector">
      {{ t('ingestion.loongCollectorDocLinkText') }}
    </IngestionDocLink>
  </IngestionContent>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useStore } from "vuex";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import CopyContent from "@/components/CopyContent.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "LoongCollector",
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

    const content = `enable: true
inputs:
  - Type: input_file
    FilePaths:
      - /var/log/*.log
processors:
  - Type: processor_json
    SourceKey: content
flushers:
  - Type: flusher_http
    RemoteURL: ${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/default/_json
    Method: POST
    Headers:
      Authorization: Basic [BASIC_PASSCODE]
    Compress: gzip`;

    return {
      t,
      content,
    };
  },
});
</script>

