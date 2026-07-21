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
  Canonical home for the (Enterprise-only) inbound MCP server. Lives in IAM
  because MCP is credentialed programmatic access to the org — the recommended
  credential is a service account, which sits one card over. Renders the shared
  McpServerCard (copy/paste client configs) under the standard IAM page header.
-->
<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import McpServerCard from "@/components/ingestion/ai/McpServerCard.vue";
import useIngestion from "@/composables/useIngestion";
import organizationsService from "@/services/organizations";
import { b64EncodeStandard } from "@/utils/zincutils";
import type { CardSubstitutions } from "@/components/ingestion/ai/content/renderMarkdown";

const { t } = useI18n();
const store = useStore();
const { endpoint } = useIngestion();

const docUrl = "https://openobserve.ai/docs/integration/ai/mcp/";

const subs = computed<CardSubstitutions>(() => {
  const email = store.state.userInfo?.email ?? "";
  const passcode = store.state.organizationData?.organizationPasscode ?? "";
  return {
    url: endpoint.value?.url ?? "",
    org: store.state.selectedOrganization?.identifier ?? "",
    token: b64EncodeStandard(`${email}:${passcode}`) ?? "",
  };
});

onMounted(() => {
  // The card's Basic-auth token is the org ingestion passcode (masked in the
  // snippet, copied in full). IAM can be opened without visiting Ingestion
  // first, so fetch it if the store doesn't already have it.
  if (!store.state.organizationData?.organizationPasscode) {
    organizationsService
      .get_organization_passcode(store.state.selectedOrganization.identifier)
      .then((res: any) => {
        if (res.data?.data?.passcode) {
          store.dispatch("setOrganizationPasscode", res.data.data.passcode);
          store.dispatch("setOrganizationPasscodeUser", res.data.data.user);
        }
      })
      .catch(() => {
        // Non-critical: the card still shows the endpoint + a placeholder token.
      });
  }
});
</script>

<template>
  <OPageLayout
    data-test="iam-mcp-server"
    :title="t('iam.mcpServerHeader')"
    icon="mcp"
    :subtitle="t('iam.mcpServerHeaderSubtitle')"
    scroll
    pad-y
  >
    <McpServerCard :subs="subs" :doc-url="docUrl" />
  </OPageLayout>
</template>
