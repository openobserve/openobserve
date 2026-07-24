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
    <div class="flex flex-col gap-2">
      <div class="text-base font-semibold">{{ t('ingestion.vmagent.singleTargetTitle') }}</div>
      <CopyContent :content="singleTargetContent" />
    </div>

    <div class="flex flex-col gap-2">
      <div class="text-base font-semibold">{{ t('ingestion.vmagent.fanoutTitle') }}</div>
      <CopyContent :content="fanoutContent" />
      <div class="italic">
        {{ t('ingestion.vmagent.tipPrefix') }}
        <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- CLI flag name must stay identical in every language -->
        <code>-remoteWrite.url</code> {{ t('ingestion.vmagent.tipSuffix') }}
      </div>
    </div>

    <IngestionDocLink href="https://docs.victoriametrics.com/vmagent/">
      {{ t('ingestion.vmagent.docLinkText') }}
    </IngestionDocLink>
  </IngestionContent>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { getEndPoint, getIngestionURL } from "../../../utils/zincutils";
import CopyContent from "@/components/CopyContent.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";

export default defineComponent({
  name: "vmagent",
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
    const store = useStore();
    const { t } = useI18n();
    const endpoint: any = ref({
      url: "",
      host: "",
      port: "",
      protocol: "",
      tls: "",
    });

    const ingestionURL = getIngestionURL();
    endpoint.value = getEndPoint(ingestionURL);
    const openObserveRemoteWriteURL = `${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/prometheus/api/v1/write`;

    const singleTargetContent = `./vmagent-prod \\
  -promscrape.config=scrape.yml \\
  -remoteWrite.tmpDataPath=./vmagent-buffer \\
  -remoteWrite.url=${openObserveRemoteWriteURL} \\
  -remoteWrite.basicAuth.username=[EMAIL] \\
  -remoteWrite.basicAuth.password=[PASSCODE]`;

    const fanoutContent = `./vmagent-prod \\
  -promscrape.config=scrape.yml \\
  -remoteWrite.tmpDataPath=./vmagent-buffer \\
  -remoteWrite.url=http://127.0.0.1:8428/api/v1/write \\
  -remoteWrite.url=${openObserveRemoteWriteURL} \\
  -remoteWrite.basicAuth.username=[EMAIL] \\
  -remoteWrite.basicAuth.password=[PASSCODE]`;

    return {
      t,
      singleTargetContent,
      fanoutContent,
    };
  },
});
</script>

