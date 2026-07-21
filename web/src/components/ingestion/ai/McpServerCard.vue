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
  (Enterprise-only) MCP server at /api/{org}/mcp.

  Two authentication paths:
   • OAuth (default) — the client signs in via the browser (Dex). The snippet is
     just the URL, no header; the server's OAuth discovery drives the login.
   • Access token — Basic auth. Defaults to the user's own credentials
     ([BASIC_PASSCODE], masked by CopyContent) as a quick start; a one-click
     "Generate" creates a scoped, read-only service account and injects its
     show-once token into every snippet.

  Each client's config is produced by a single build(endpoint, auth) function so
  the OAuth (auth=null → no header) and token variants can never drift.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import CopyContent from "@/components/CopyContent.vue";
import type { CardSubstitutions } from "./content/renderMarkdown";
import { safeHttpUrl } from "./content/renderMarkdown";
import { b64EncodeStandard } from "@/utils/zincutils";
import { useMcpCredential } from "@/composables/useMcpCredential";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";

const props = defineProps<{
  subs: CardSubstitutions;
  docUrl?: string;
}>();

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const { generate, generating, error: genError, credential, canGenerate } =
  useMcpCredential();

const endpoint = computed(
  () => `${props.subs.url}/api/${props.subs.org}/mcp`,
);

// "oauth" (default, recommended) | "token".
const authMode = ref<"oauth" | "token">("oauth");

// The Authorization header VALUE injected into token-mode snippets:
//  • generated credential → real base64(email:token), shown once;
//  • otherwise → the [BASIC_PASSCODE] placeholder, which CopyContent masks on
//    screen and substitutes with the user's own passcode on copy.
// OAuth mode passes null so build() omits the header entirely.
const tokenAuthValue = computed(() => {
  if (credential.value) {
    return `Basic ${b64EncodeStandard(
      `${credential.value.email}:${credential.value.token}`,
    )}`;
  }
  return "Basic [BASIC_PASSCODE]";
});
const authValue = computed(() =>
  authMode.value === "oauth" ? null : tokenAuthValue.value,
);

// The `Basic <base64>` line for the generated credential's reveal + download.
const credentialHeader = computed(() =>
  credential.value
    ? `Basic ${b64EncodeStandard(
        `${credential.value.email}:${credential.value.token}`,
      )}`
    : "",
);

interface ClientDef {
  id: string;
  build: (endpoint: string, auth: string | null) => string;
  // One-click install deep link (vscode: / cursor: / https:) — the client
  // receives the config and asks the user to confirm, no copy/paste. Return
  // null when the link can't carry the current auth mode (hides the button).
  deepLink?: (endpoint: string, auth: string | null) => string | null;
}

// mcpServers-shaped config (url + optional headers) shared by Cursor, Claude
// Desktop and Windsurf.
const mcpServersUrl = (ep: string, auth: string | null) => `{
  "mcpServers": {
    "openobserve": {
      "url": "${ep}"${
  auth
    ? `,
      "headers": {
        "Authorization": "${auth}"
      }`
    : ``
}
    }
  }
}`;

const CLIENTS: ClientDef[] = [
  {
    id: "claudeCode",
    build: (ep, auth) =>
      auth
        ? `claude mcp add openobserve ${ep} \\
  -t http \\
  --header "${auth}"`
        : `claude mcp add openobserve ${ep} -t http`,
  },
  {
    // Codex reads ~/.codex/config.toml (TOML); remote HTTP servers use `url`
    // plus an optional `http_headers` map.
    id: "codex",
    build: (ep, auth) => `[mcp_servers.openobserve]
url = "${ep}"${
      auth
        ? `
http_headers = { "Authorization" = "${auth}" }`
        : ``
    }`,
  },
  {
    id: "cursor",
    build: mcpServersUrl,
    deepLink: (ep, auth) => {
      const cfg: Record<string, unknown> = { url: ep };
      if (auth) cfg.headers = { Authorization: auth };
      return `cursor://anysphere.cursor-deeplink/mcp/install?name=openobserve&config=${b64EncodeStandard(JSON.stringify(cfg))}`;
    },
  },
  {
    id: "vscode",
    deepLink: (ep, auth) => {
      const cfg: Record<string, unknown> = {
        name: "openobserve",
        type: "http",
        url: ep,
      };
      if (auth) cfg.headers = { Authorization: auth };
      return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(cfg))}`;
    },
    build: (ep, auth) => `{
  "servers": {
    "openobserve": {
      "type": "http",
      "url": "${ep}"${
      auth
        ? `,
      "headers": {
        "Authorization": "${auth}"
      }`
        : ``
    }
    }
  }
}`,
  },
  {
    id: "claudeDesktop",
    build: mcpServersUrl,
    // Prefills claude.ai's "Add custom connector" modal. Custom connectors
    // authenticate via OAuth only, so no link in token mode.
    deepLink: (ep, auth) =>
      auth
        ? null
        : `https://claude.ai/settings/connectors?modal=add-custom-connector&mcpName=OpenObserve&mcpServerUrl=${encodeURIComponent(ep)}`,
  },
  { id: "windsurf", build: mcpServersUrl },
  {
    id: "chatgpt",
    build: (ep, auth) =>
      auth
        ? `Server URL: ${ep}
Authorization: ${auth}`
        : `Server URL: ${ep}
Authentication: OAuth (sign in when prompted)`,
  },
  {
    // Antigravity uses `serverUrl` (not `url`) for remote HTTP servers.
    id: "antigravity",
    build: (ep, auth) => `{
  "mcpServers": {
    "openobserve": {
      "serverUrl": "${ep}"${
      auth
        ? `,
      "headers": {
        "Authorization": "${auth}"
      }`
        : ``
    }
    }
  }
}`,
  },
  {
    id: "opencode",
    build: (ep, auth) => `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "openobserve": {
      "type": "remote",
      "url": "${ep}",
      "enabled": true${
        auth
          ? `,
      "headers": {
        "Authorization": "${auth}"
      }`
          : ``
      }
    }
  }
}`,
  },
  {
    id: "openclaw",
    build: (ep, auth) => `{
  "mcp": {
    "servers": {
      "openobserve": {
        "url": "${ep}",
        "transport": "streamable-http"${
          auth
            ? `,
        "headers": {
          "Authorization": "${auth}"
        }`
            : ``
        }
      }
    }
  }
}`,
  },
  {
    // Hermes config is YAML (~/.hermes/config.yaml).
    id: "hermes",
    build: (ep, auth) => `mcp_servers:
  openobserve:
    url: "${ep}"${
      auth
        ? `
    headers:
      Authorization: "${auth}"`
        : ``
    }`,
  },
];

const selectedClient = ref("claudeCode");
const activeClient = computed(
  () => CLIENTS.find((c) => c.id === selectedClient.value) ?? CLIENTS[0],
);
const activeConfig = computed(() =>
  activeClient.value.build(endpoint.value, authValue.value),
);
const activeDeepLink = computed(
  () => activeClient.value.deepLink?.(endpoint.value, authValue.value) ?? null,
);
const openDeepLink = () => {
  const link = activeDeepLink.value;
  if (!link) return;
  if (link.startsWith("https://")) {
    window.open(link, "_blank", "noopener,noreferrer");
  } else {
    // Custom-protocol links (vscode:, cursor:) must navigate the current
    // window — the OS hands them to the editor without leaving the page.
    window.location.href = link;
  }
};

const onGenerate = () => generate();

const downloadCredential = () => {
  if (!credentialHeader.value) return;
  const blob = new Blob([credentialHeader.value], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "openobserve_mcp_credential.txt";
  link.click();
  URL.revokeObjectURL(link.href);
};

const goToServiceAccounts = () => {
  router.push({
    name: "serviceAccounts",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
};

const safeDocUrl = computed(() => safeHttpUrl(props.docUrl ?? ""));
const openDocs = () => {
  if (safeDocUrl.value) {
    window.open(safeDocUrl.value, "_blank", "noopener,noreferrer");
  }
};
</script>

<template>
  <div class="flex flex-col gap-6 text-sm" data-test="ai-integrations-mcp-card">
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

    <!-- Authentication method -->
    <div class="flex flex-col gap-2">
      <div class="font-semibold">{{ t("ingestion.mcp.authLabel") }}</div>
      <OTabs v-model="authMode" dense>
        <OTab
          name="oauth"
          :label="t('ingestion.mcp.auth.oauth')"
          data-test="ai-integrations-mcp-auth-oauth"
        />
        <OTab
          name="token"
          :label="t('ingestion.mcp.auth.token')"
          data-test="ai-integrations-mcp-auth-token"
        />
      </OTabs>
      <p v-if="authMode === 'oauth'" class="text-text-secondary">
        {{ t("ingestion.mcp.auth.oauthNote") }}
      </p>
    </div>

    <!-- Token mode: credential management -->
    <div
      v-if="authMode === 'token'"
      class="rounded-surface border border-border-default bg-surface-panel p-3 flex flex-col gap-3"
      data-test="ai-integrations-mcp-credential"
    >
      <!-- Before generation: quick-start note + generate button -->
      <template v-if="!credential">
        <div class="flex items-start justify-between gap-3">
          <div class="flex flex-col gap-1">
            <div class="font-semibold">
              {{ t("ingestion.mcp.credential.quickStartTitle") }}
            </div>
            <p class="text-text-secondary">
              {{ t("ingestion.mcp.credential.quickStartBody") }}
            </p>
          </div>
          <OButton
            v-if="canGenerate()"
            variant="primary"
            size="sm-action"
            :loading="generating"
            data-test="ai-integrations-mcp-generate-btn"
            @click="onGenerate"
          >
            {{ t("ingestion.mcp.credential.generate") }}
          </OButton>
        </div>
        <p v-if="genError" class="text-error" data-test="ai-integrations-mcp-credential-error">
          {{ genError }}
        </p>
      </template>

      <!-- After generation: show-once reveal + manage -->
      <template v-else>
        <div class="flex items-center gap-2">
          <OIcon name="check-circle" size="sm" class="text-success" />
          <span class="font-semibold">
            {{ t("ingestion.mcp.credential.created") }}
          </span>
        </div>
        <p class="text-text-secondary">
          {{ t("ingestion.mcp.credential.shownOnce", { email: credential.email }) }}
        </p>
        <CopyContent :content="credentialHeader" />
        <div class="flex gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            data-test="ai-integrations-mcp-download-btn"
            @click="downloadCredential"
          >
            <OIcon name="download" size="sm" />
            {{ t("ingestion.mcp.credential.download") }}
          </OButton>
          <OButton
            variant="ghost"
            size="sm-action"
            data-test="ai-integrations-mcp-manage-btn"
            @click="goToServiceAccounts"
          >
            <OIcon name="open-in-new" size="sm" />
            {{ t("ingestion.mcp.credential.manage") }}
          </OButton>
        </div>
        <p
          v-if="!credential.readonlyApplied"
          class="text-warning"
          data-test="ai-integrations-mcp-readonly-warn"
        >
          {{ t("ingestion.mcp.credential.readonlyWarn") }}
        </p>
      </template>
    </div>

    <!-- Client picker -->
    <div class="flex flex-col gap-2">
      <div class="font-semibold">{{ t("ingestion.mcp.clientLabel") }}</div>
      <OTabs v-model="selectedClient" dense>
        <OTab
          v-for="c in CLIENTS"
          :key="c.id"
          :name="c.id"
          :label="t(`ingestion.mcp.clients.${c.id}`)"
          :data-test="`ai-integrations-mcp-client-${c.id}`"
        />
      </OTabs>
    </div>

    <!-- Config for the selected client -->
    <div class="flex flex-col gap-2">
      <div class="font-semibold">{{ t("ingestion.mcp.configLabel") }}</div>
      <p class="text-text-secondary">
        {{ t(`ingestion.mcp.desc.${selectedClient}`) }}
      </p>
      <div v-if="activeDeepLink">
        <OButton
          variant="primary"
          size="sm-action"
          data-test="ai-integrations-mcp-install-btn"
          @click="openDeepLink"
        >
          <OIcon name="open-in-new" size="sm" />
          {{
            t("ingestion.mcp.installOneClick", {
              client: t(`ingestion.mcp.clients.${selectedClient}`),
            })
          }}
        </OButton>
      </div>
      <CopyContent :content="activeConfig" />
    </div>

    <!-- Security note (token mode only) -->
    <div
      v-if="authMode === 'token'"
      class="rounded-surface border border-border-default bg-surface-panel p-3 flex gap-2"
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
