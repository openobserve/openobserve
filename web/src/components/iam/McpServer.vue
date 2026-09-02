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
  Canonical home for the inbound MCP server (served by every edition). Lives in IAM
  because MCP is credentialed programmatic access to the org — the recommended
  credential is a service account, which sits one card over. Renders the shared
  McpServerCard (copy/paste client configs) under the standard IAM page header.
-->
<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import McpServerCard from "@/components/ingestion/ai/McpServerCard.vue";
import useIngestion from "@/composables/useIngestion";
import type { CardSubstitutions } from "@/components/ingestion/ai/content/renderMarkdown";

const { t } = useI18nTyped();
const store = useStore();
const { endpoint } = useIngestion();

const docUrl = "https://openobserve.ai/docs/integration/ai/mcp/";

// Unused by the card: the org ingestion passcode that used to fill it is rejected on /mcp.
const subs = computed<CardSubstitutions>(() => ({
  url: store.state.zoConfig?.web_url || endpoint.value?.url || "",
  org: store.state.selectedOrganization?.identifier ?? "",
  token: "",
}));
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
