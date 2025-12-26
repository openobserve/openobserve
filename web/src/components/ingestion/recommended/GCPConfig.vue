<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="q-ma-md">
    <CopyContent class="q-mt-sm" :content="content" />
    <div class="tw:text-[16px]">
      <div class="tw:font-bold tw:pt-6 tw:pb-2">
        Check further documentation at:
      </div>
      <ol class="tw:list-decimal q-pl-md">
        <li class="tw:py-1">
          <a
            href="https://openobserve.ai/blog/send-gcp-logs-to-openobserve"
            class="tw:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
          {{ t("ingestion.pubsub") }}
          </a>
        </li>
        <li class="tw:py-1">
          <a
            href="https://short.openobserve.ai/security/google-workspace"
            class="tw:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
          {{ t("ingestion.gworkspace") }}
          </a>
        </li>
      </ol>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import config from "../../../aws-exports";
import { useStore } from "vuex";
import { getEndPoint, getImageURL, getIngestionURL } from "../../../utils/zincutils";
import CopyContent from "@/components/CopyContent.vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "GCPConfig",
  props: {
    currOrgIdentifier: {
      type: String,
    },
    currUserEmail: {
      type: String,
    },
  },
  components: { CopyContent },
  setup(props) {
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

    const content = `URL: ${endpoint.value.url}/gcp/${store.state.selectedOrganization.identifier}/default/_sub?API-Key=[BASIC_PASSCODE]`;
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
