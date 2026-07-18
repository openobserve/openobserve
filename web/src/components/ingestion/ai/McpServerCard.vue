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
  Copy/paste setup for connecting an MCP client to OpenObserve's INBOUND
  (Enterprise-only) MCP server at /api/{org}/mcp. Distinct from the AI-tool
  telemetry cards (which send data TO OpenObserve) and from the outbound
  `mcp`-kind toolsets (which point OpenObserve's own agent at a remote server).
  The Basic-auth token is rendered via CopyContent's `[BASIC_PASSCODE]`
  placeholder so it is masked on screen but copied in full — the same token
  shown on every Data Sources card.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import CopyContent from "@/components/CopyContent.vue";
import type { CardSubstitutions } from "./content/renderMarkdown";
import { safeHttpUrl } from "./content/renderMarkdown";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";

const props = defineProps<{
  subs: CardSubstitutions;
  docUrl?: string;
}>();

const { t } = useI18n();

// {url} is the org's ingestion endpoint base (no trailing slash); {org} its
// identifier. The token is left as the [BASIC_PASSCODE] placeholder so
// CopyContent masks it on display and substitutes the real value on copy.
const endpoint = computed(
  () => `${props.subs.url}/api/${props.subs.org}/mcp`,
);

// mcpServers-shaped config shared by Cursor, Claude Desktop and Windsurf.
const mcpServersConfig = computed(
  () => `{
  "mcpServers": {
    "openobserve": {
      "url": "${endpoint.value}",
      "headers": {
        "Authorization": "Basic [BASIC_PASSCODE]"
      }
    }
  }
}`,
);

const clients = computed(() => [
  {
    id: "claudeCode",
    label: t("ingestion.mcp.clients.claudeCode"),
    desc: t("ingestion.mcp.desc.claudeCode"),
    config: `claude mcp add openobserve ${endpoint.value} \\
  -t http \\
  --header "Authorization: Basic [BASIC_PASSCODE]"`,
  },
  {
    id: "cursor",
    label: t("ingestion.mcp.clients.cursor"),
    desc: t("ingestion.mcp.desc.cursor"),
    config: mcpServersConfig.value,
  },
  {
    id: "vscode",
    label: t("ingestion.mcp.clients.vscode"),
    desc: t("ingestion.mcp.desc.vscode"),
    config: `{
  "servers": {
    "openobserve": {
      "type": "http",
      "url": "${endpoint.value}",
      "headers": {
        "Authorization": "Basic [BASIC_PASSCODE]"
      }
    }
  }
}`,
  },
  {
    id: "claudeDesktop",
    label: t("ingestion.mcp.clients.claudeDesktop"),
    desc: t("ingestion.mcp.desc.claudeDesktop"),
    config: mcpServersConfig.value,
  },
  {
    id: "windsurf",
    label: t("ingestion.mcp.clients.windsurf"),
    desc: t("ingestion.mcp.desc.windsurf"),
    config: mcpServersConfig.value,
  },
  {
    id: "chatgpt",
    label: t("ingestion.mcp.clients.chatgpt"),
    desc: t("ingestion.mcp.desc.chatgpt"),
    config: `Server URL: ${endpoint.value}
Authorization: Basic [BASIC_PASSCODE]`,
  },
  {
    // Antigravity uses `serverUrl` (not `url`) for remote HTTP servers.
    id: "antigravity",
    label: t("ingestion.mcp.clients.antigravity"),
    desc: t("ingestion.mcp.desc.antigravity"),
    config: `{
  "mcpServers": {
    "openobserve": {
      "serverUrl": "${endpoint.value}",
      "headers": {
        "Authorization": "Basic [BASIC_PASSCODE]"
      }
    }
  }
}`,
  },
  {
    id: "opencode",
    label: t("ingestion.mcp.clients.opencode"),
    desc: t("ingestion.mcp.desc.opencode"),
    config: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "openobserve": {
      "type": "remote",
      "url": "${endpoint.value}",
      "enabled": true,
      "headers": {
        "Authorization": "Basic [BASIC_PASSCODE]"
      }
    }
  }
}`,
  },
  {
    id: "openclaw",
    label: t("ingestion.mcp.clients.openclaw"),
    desc: t("ingestion.mcp.desc.openclaw"),
    config: `{
  "mcp": {
    "servers": {
      "openobserve": {
        "url": "${endpoint.value}",
        "transport": "streamable-http",
        "headers": {
          "Authorization": "Basic [BASIC_PASSCODE]"
        }
      }
    }
  }
}`,
  },
  {
    // Hermes config is YAML (~/.hermes/config.yaml).
    id: "hermes",
    label: t("ingestion.mcp.clients.hermes"),
    desc: t("ingestion.mcp.desc.hermes"),
    config: `mcp_servers:
  openobserve:
    url: "${endpoint.value}"
    headers:
      Authorization: "Basic [BASIC_PASSCODE]"`,
  },
]);

const selectedClient = ref("claudeCode");

const activeClient = computed(
  () =>
    clients.value.find((c) => c.id === selectedClient.value) ??
    clients.value[0],
);

const safeDocUrl = computed(() => safeHttpUrl(props.docUrl ?? ""));

const openDocs = () => {
  if (safeDocUrl.value) {
    window.open(safeDocUrl.value, "_blank", "noopener,noreferrer");
  }
};
</script>

<template>
  <div
    class="flex flex-col gap-6 text-sm"
    data-test="ai-integrations-mcp-card"
  >
    <!-- Hero -->
    <div class="flex flex-col gap-1">
      <h2 class="text-lg font-semibold">{{ t("ingestion.mcp.name") }}</h2>
      <p class="text-text-secondary">{{ t("ingestion.mcp.tagline") }}</p>
      <div class="flex items-center gap-1 text-text-secondary">
        <OIcon name="workspace-premium" size="sm" />
        <span>{{ t("ingestion.mcp.enterpriseNote") }}</span>
      </div>
    </div>

    <!-- Endpoint -->
    <div class="flex flex-col gap-2">
      <div class="font-semibold">{{ t("ingestion.mcp.endpointLabel") }}</div>
      <CopyContent :content="endpoint" />
    </div>

    <!-- Client picker -->
    <div class="flex flex-col gap-2">
      <div class="font-semibold">{{ t("ingestion.mcp.clientLabel") }}</div>
      <OTabs v-model="selectedClient" dense>
        <OTab
          v-for="c in clients"
          :key="c.id"
          :name="c.id"
          :label="c.label"
          :data-test="`ai-integrations-mcp-client-${c.id}`"
        />
      </OTabs>
    </div>

    <!-- Config for the selected client -->
    <div class="flex flex-col gap-2">
      <div class="font-semibold">{{ t("ingestion.mcp.configLabel") }}</div>
      <p class="text-text-secondary">{{ activeClient.desc }}</p>
      <CopyContent :content="activeClient.config" />
    </div>

    <!-- Security note -->
    <div
      class="rounded-lg border border-border-default bg-surface-panel p-3 flex gap-2"
      data-test="ai-integrations-mcp-security"
    >
      <OIcon name="shield" size="sm" class="mt-0.5 shrink-0" />
      <div class="flex flex-col gap-1">
        <div class="font-semibold">{{ t("ingestion.mcp.securityTitle") }}</div>
        <p class="text-text-secondary">{{ t("ingestion.mcp.securityBody") }}</p>
      </div>
    </div>

    <!-- Docs -->
    <div v-if="safeDocUrl">
      <OButton
        variant="outline"
        size="sm-action"
        data-test="ai-integrations-mcp-docs-btn"
        @click="openDocs"
      >
        <OIcon name="menu-book" size="sm" />
        {{ t("ingestion.mcp.docsCta") }}
      </OButton>
    </div>
  </div>
</template>
