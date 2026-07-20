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

<!--
  FrontendRumConfig — the Data Sources > RUM (browser) setup page.

  Renders the shared rich setup card (SetupCardRenderer) with NPM / CDN install
  variants built by setupCard/content/rum. RUM authenticates with the org's RUM
  token — generated from this page's header (see Ingestion.vue) — so the card
  only appears once that token exists.
-->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { getIngestionURL, maskText } from "@/utils/zincutils";
import SetupCardRenderer from "@/components/ingestion/setupCard/SetupCardRenderer.vue";
import type { CardSubstitutions } from "@/components/ingestion/setupCard/types";
import rumCard from "@/components/ingestion/setupCard/content/rum";

defineProps<{
  currOrgIdentifier?: string;
  currUserEmail?: string;
}>();

const store = useStore();
const { t } = useI18n();

const rumToken = computed<string>(
  () => store.state.organizationData?.rumToken?.rum_token ?? "",
);

// Full origin (preconnect/CSP hints) and the protocol-less `site` SDK option.
const endpoint = computed(() =>
  (getIngestionURL() as string).replace(/\/$/, ""),
);
const site = computed(() => endpoint.value.replace(/^https?:\/\//, ""));
const insecureHTTP = computed(
  () => !String(store.state.API_ENDPOINT ?? "").startsWith("https://"),
);

const content = computed(() =>
  rumCard({
    site: site.value,
    endpoint: endpoint.value,
    org: store.state.selectedOrganization?.identifier ?? "",
    rumToken: rumToken.value,
    rumTokenMasked: maskText(rumToken.value),
    insecureHTTP: insecureHTTP.value,
  }),
);

// The renderer's subs drive detection (org) — RUM never exposes the Basic-auth
// ingestion token, so `token` stays empty (no .env download on this card).
const subs = computed<CardSubstitutions>(() => ({
  url: endpoint.value,
  org: store.state.selectedOrganization?.identifier ?? "",
  token: "",
}));
</script>

<template>
  <div class="p-2">
    <SetupCardRenderer
      v-if="rumToken"
      :content="content"
      :subs="subs"
      data-test="rum-web-setup-card"
    />
    <p v-else class="mt-1" data-test="rum-web-no-token-message">
      {{ t("ingestion.generateRUMTokenMessage") }}
    </p>
  </div>
</template>
