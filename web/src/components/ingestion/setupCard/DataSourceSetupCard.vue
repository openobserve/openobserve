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
  DataSourceSetupCard — the generic, slug-driven setup card for (non-AI) data
  sources whose content lives in this repo (see ./registry.ts, ./content/*).

  Drop it on any data-source detail page with a `slug`. If that slug has a
  registered card it renders the shared rich card (the same presentational
  component the AI integrations use); otherwise it falls back to the legacy
  CopyContent + doc link so un-migrated data sources keep working unchanged.
-->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { b64EncodeStandard } from "@/utils/zincutils";
import useIngestion from "@/composables/useIngestion";
import CopyContent from "@/components/CopyContent.vue";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";
import SetupCardRenderer from "./SetupCardRenderer.vue";
import type { CardSubstitutions } from "./types";
import { getDataSourceCard } from "./registry";

const props = defineProps<{
  /**
   * Data-source route slug, e.g. "sqlServer". Resolves card content from
   * setupCard/registry.ts; if the slug isn't registered, the legacy
   * fallbackContent/fallbackDocUrl is shown instead.
   */
  slug: string;
  /** Legacy CopyContent body, shown when the slug has no registered card. */
  fallbackContent?: string;
  /** Legacy doc link, shown alongside the fallback content. */
  fallbackDocUrl?: string;
}>();

const store = useStore();
const { endpoint } = useIngestion();

// Per-org url/org/token — the same Basic-auth token every Data Sources card
// uses: base64(email:<org ingestion passcode>) WITHOUT the "Basic " prefix.
const subs = computed<CardSubstitutions>(() => {
  const email = store.state.userInfo?.email ?? "";
  const passcode = store.state.organizationData?.organizationPasscode ?? "";
  return {
    url: endpoint.value?.url ?? "",
    org: store.state.selectedOrganization?.identifier ?? "",
    token: b64EncodeStandard(`${email}:${passcode}`) ?? "",
  };
});

const content = computed(() => getDataSourceCard(props.slug, subs.value));
</script>

<template>
  <!-- Mirrors AIIntegrationDetail's wrapper padding so data-source cards and AI
       integration cards sit identically in their panels. -->
  <div class="tw:p-2">
    <SetupCardRenderer
      v-if="content"
      :content="content"
      :subs="subs"
      data-test="data-source-setup-card"
    />
    <template v-else>
      <CopyContent v-if="fallbackContent" :content="fallbackContent" />
      <IngestionDocLink v-if="fallbackDocUrl" :href="fallbackDocUrl" />
    </template>
  </div>
</template>
