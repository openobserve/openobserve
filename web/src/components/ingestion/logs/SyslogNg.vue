<!-- Copyright 2023 Zinc Labs Inc.

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
  <div>
    <div class="tabContent q-ma-md">
      <div class="tabContent__head">
        <div class="copy_action">
          <q-btn
            data-test="fluentd-copy-btn"
            flat
            round
            size="0.5rem"
            padding="0.6rem"
            color="grey"
            icon="content_copy"
            @click="$emit('copy-to-clipboard-fn', syslogNgContent)"
          />
        </div>
      </div>
      <pre ref="syslogNgContent" data-test="syslog-ng-content-text">
destination d_openobserve_http {
    openobserve-log(
        url("{{ endpoint.url }}")
        organization("{{ currOrgIdentifier }}")
        stream("syslog-ng")
        user("{{ currUserEmail }}")
        password("{{ store.state.organizationData.organizationPasscode }}")
    );
};


log {
    source(src);
    destination(d_openobserve_http);
    flags(flow-control);
};</pre
      >
    </div>
    <div style="margin-left: 20px;" >
      Check further documentation at
      <a target="_blank"
        href="https://axoflow.com/docs/axosyslog-core/chapter-destinations/openobserve/"
        >https://axoflow.com/docs/axosyslog-core/chapter-destinations/openobserve/</a
      >
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, type Ref } from "vue";
import config from "../../../aws-exports";
import { useStore } from "vuex";
import { getImageURL } from "../../../utils/zincutils";
import type { Endpoint } from "@/ts/interfaces";
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
  setup() {
    const store = useStore();
    const endpoint: any = ref({
      url: "",
      host: "",
      port: "",
      protocol: "",
      tls: "",
    });
    const url = new URL(store.state.API_ENDPOINT);
    endpoint.value = {
      url: store.state.API_ENDPOINT,
      host: url.hostname,
      port: url.port || (url.protocol === "https:" ? "443" : "80"),
      protocol: url.protocol.replace(":", ""),
      tls: url.protocol === "https:" ? "On" : "Off",
    };
    const syslogNgContent = ref(null);
    return {
      store,
      config,
      endpoint,
      syslogNgContent,
      getImageURL,
    };
  },
});
</script>
