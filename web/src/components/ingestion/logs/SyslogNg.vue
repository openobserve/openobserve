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
    <CredentialCodeBlock slug="syslog-ng" :content="content" />
    <IngestionDocLink
      href="https://axoflow.com/docs/axosyslog-core/chapter-destinations/openobserve/"
    />
  </IngestionContent>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import config from "../../../aws-exports";
import { useStore } from "vuex";
import { getEndPoint, getImageURL, getIngestionURL } from "../../../utils/zincutils";
import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";
export default defineComponent({
  name: "SyslogNg",
  props: {
    currOrgIdentifier: {
      type: String,
    },
    currUserEmail: {
      type: String,
    },
  },
  components: { CredentialCodeBlock, IngestionContent, IngestionDocLink },
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
    const syslogStream = "syslog-ng";
    // the server's format_stream_name stores the dash as an underscore
    const targetStream = syslogStream.replace(/[^a-zA-Z0-9_:]+/g, "_");
    const content = `destination d_openobserve_http {
    openobserve-log(
        url("${endpoint.value.url}")
        organization("${store.state.selectedOrganization.identifier}")
        stream("${syslogStream}")
        user("[EMAIL]")
        password("[PASSCODE]")
    );
};


log {
    source(s_src);
    destination(d_openobserve_http);
    flags(flow-control);
};`;
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
