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
  Setup for connecting an MCP client to OpenObserve's INBOUND MCP server at
  /api/{org}/mcp, which every edition serves. It renders through the shared
  SetupCardRenderer, so it inherits the stepper, code chrome and footer every
  other ingestion setup card uses; this file owns only the MCP-specific state
  (auth mode, credential, selected client) and fills the two steps' slots. The
  hero is dropped because the hosting page's header already names the card.

  Two authentication paths:
   • OAuth (default) — the client signs in via the browser (Dex). The snippet is
     just the URL, no header; the server's OAuth discovery drives the login.
     Needs Enterprise/Cloud AND SSO enabled: the discovery endpoints are compiled
     out of the OSS build and 404 while Dex is off, so the tab is hidden in both
     cases and token mode is the default.
   • Access token — Basic auth. Until "Generate" is pressed the snippets show a
     placeholder header, never a real credential. Generating mints a service
     account — joined to the shared mcp_readonly role when rbac is on — and
     injects its show-once token into every snippet, masked behind the code
     block's reveal toggle so the page stays safe to screenshot.

  Each client's config is produced by a single build(endpoint, auth) function so
  the OAuth (auth=null → no header) and token variants can never drift.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import type { CardSubstitutions } from "./content/renderMarkdown";
import { b64EncodeStandard } from "@/utils/zincutils";
import config from "@/aws-exports";
import { MCP_READONLY_ROLE, useMcpCredential } from "@/composables/useMcpCredential";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import SetupCardRenderer from "@/components/ingestion/setupCard/SetupCardRenderer.vue";
import type { RichCardContent } from "@/components/ingestion/setupCard/types";

const props = defineProps<{
  subs: CardSubstitutions;
  docUrl?: string;
}>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { generate, generating, error: genError, credential } = useMcpCredential();

const endpoint = computed(() => `${props.subs.url}/api/${props.subs.org}/mcp`);

// OAuth discovery 404s on OSS builds and whenever SSO (Dex) is off, so it needs both.
const oauthAvailable = computed(
  () =>
    (config.isEnterprise == "true" || config.isCloud == "true") &&
    !!store.state.zoConfig?.sso_enabled,
);

// "oauth" (default, recommended where available) | "token".
const selectedAuthMode = ref<"oauth" | "token">("oauth");

// zoConfig arrives asynchronously, so derive the mode rather than latch a stale default.
const authMode = computed<"oauth" | "token">(() =>
  oauthAvailable.value ? selectedAuthMode.value : "token",
);

// OAuth needs no credential, so only token mode can leave the first step outstanding.
const authSettled = computed(() => authMode.value === "oauth" || !!credential.value);

// Not [BASIC_PASSCODE]: CopyContent expands it to the user's real credential, which
// then renders in cleartext because maskText is a no-op.
const TOKEN_PLACEHOLDER = "Basic <base64 of service-account-email:token>";
const MASKED_AUTH = "Basic ••••••••••••••••";

// The Authorization header VALUE injected into token-mode snippets. OAuth mode
// passes null so build() omits the header entirely.
const tokenAuthValue = computed(() =>
  credential.value
    ? `Basic ${b64EncodeStandard(`${credential.value.email}:${credential.value.token}`)}`
    : TOKEN_PLACEHOLDER,
);
const authValue = computed(() => (authMode.value === "oauth" ? null : tokenAuthValue.value));

// The `Basic <base64>` line for the generated credential's reveal + download.
const credentialHeader = computed(() =>
  credential.value
    ? `Basic ${b64EncodeStandard(`${credential.value.email}:${credential.value.token}`)}`
    : "",
);

interface ClientDef {
  id: string;
  /** Tab label + the name the one-click install button is built from. */
  labelKey: I18nKey;
  /** "Add to ~/.cursor/mcp.json, then reload Cursor" — the note under the code. */
  descKey: I18nKey;
  /** Fence language for the config block's highlighting and its toolbar label. */
  lang: string;
  /** Config file the snippet belongs in — shown as the block's chrome tab. */
  filename?: string;
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
    labelKey: "ingestion.mcp.clients.claudeCode",
    descKey: "ingestion.mcp.desc.claudeCode",
    lang: "bash",
    build: (ep, auth) =>
      auth
        ? `claude mcp add openobserve ${ep} \\
  -t http \\
  --header "Authorization: ${auth}"`
        : `claude mcp add openobserve ${ep} -t http`,
  },
  {
    // Codex reads ~/.codex/config.toml (TOML); remote HTTP servers use `url`
    // plus an optional `http_headers` map.
    id: "codex",
    labelKey: "ingestion.mcp.clients.codex",
    descKey: "ingestion.mcp.desc.codex",
    lang: "toml",
    filename: "~/.codex/config.toml",
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
    labelKey: "ingestion.mcp.clients.cursor",
    descKey: "ingestion.mcp.desc.cursor",
    lang: "json",
    filename: "~/.cursor/mcp.json",
    build: mcpServersUrl,
    deepLink: (ep, auth) => {
      const cfg: Record<string, unknown> = { url: ep };
      if (auth) cfg.headers = { Authorization: auth };
      return `cursor://anysphere.cursor-deeplink/mcp/install?name=openobserve&config=${b64EncodeStandard(JSON.stringify(cfg))}`;
    },
  },
  {
    id: "vscode",
    labelKey: "ingestion.mcp.clients.vscode",
    descKey: "ingestion.mcp.desc.vscode",
    lang: "json",
    filename: ".vscode/mcp.json",
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
    labelKey: "ingestion.mcp.clients.claudeDesktop",
    descKey: "ingestion.mcp.desc.claudeDesktop",
    lang: "json",
    filename: "claude_desktop_config.json",
    build: mcpServersUrl,
    // Prefills claude.ai's "Add custom connector" modal. Custom connectors
    // authenticate via OAuth only, so no link in token mode.
    deepLink: (ep, auth) =>
      auth
        ? null
        : `https://claude.ai/settings/connectors?modal=add-custom-connector&mcpName=OpenObserve&mcpServerUrl=${encodeURIComponent(ep)}`,
  },
  {
    id: "windsurf",
    labelKey: "ingestion.mcp.clients.windsurf",
    descKey: "ingestion.mcp.desc.windsurf",
    lang: "json",
    filename: "~/.codeium/windsurf/mcp_config.json",
    build: mcpServersUrl,
  },
  {
    id: "chatgpt",
    labelKey: "ingestion.mcp.clients.chatgpt",
    descKey: "ingestion.mcp.desc.chatgpt",
    lang: "text",
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
    labelKey: "ingestion.mcp.clients.antigravity",
    descKey: "ingestion.mcp.desc.antigravity",
    lang: "json",
    filename: "~/.gemini/config/mcp_config.json",
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
    labelKey: "ingestion.mcp.clients.opencode",
    descKey: "ingestion.mcp.desc.opencode",
    lang: "json",
    filename: "opencode.json",
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
    labelKey: "ingestion.mcp.clients.openclaw",
    descKey: "ingestion.mcp.desc.openclaw",
    lang: "json",
    filename: "~/.openclaw/openclaw.json",
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
    labelKey: "ingestion.mcp.clients.hermes",
    descKey: "ingestion.mcp.desc.hermes",
    lang: "yaml",
    filename: "~/.hermes/config.yaml",
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
const activeConfig = computed(() => activeClient.value.build(endpoint.value, authValue.value));

// Shown in place of the real token so the page stays safe to screenshot; the
// block's copy button still copies `activeConfig`. Only when the snippet really
// carries the credential — OAuth snippets have no header to mask.
const activeConfigMasked = computed(() =>
  authValue.value && credential.value
    ? activeClient.value.build(endpoint.value, MASKED_AUTH)
    : undefined,
);

// A terminal command gets terminal chrome; a config snippet gets its file's tab.
const isTerminalClient = computed(
  () => !activeClient.value.filename && activeClient.value.lang === "bash",
);

const content = computed<RichCardContent>(() => ({
  provider: {
    name: t("ingestion.mcp.shortName"),
    tagline: t("ingestion.mcp.tagline", {
      product: raw("Model Context Protocol"),
      client1: raw("Claude"),
      client2: raw("Cursor"),
      client3: raw("VS Code"),
    }),
    logo: "",
    tone: "",
  },
  steps: [
    {
      id: "connect",
      titleKey: "ingestion.mcp.connectLabel",
      descriptionKey: "ingestion.mcp.connectHint",
      code: {
        lang: "http",
        raw: endpoint.value,
        dataTest: "ai-integrations-mcp-endpoint",
      },
      completeOn: "copy",
      done: authSettled.value,
    },
    {
      id: "configure",
      titleKey: "ingestion.mcp.configLabel",
      descriptionKey: "ingestion.mcp.configHint",
      chip: {
        kind: isTerminalClient.value ? "terminal" : "editor",
        labelKey: isTerminalClient.value
          ? "ingestion.setupCard.chipTerminal"
          : "ingestion.setupCard.chipEditor",
      },
      code: {
        lang: activeClient.value.lang,
        raw: activeConfig.value,
        masked: activeConfigMasked.value,
        filename: activeClient.value.filename,
        dataTest: "ai-integrations-mcp-config",
      },
      note: t(activeClient.value.descKey),
      completeOn: "copy",
    },
  ],
  docUrl: props.docUrl,
}));

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
</script>

<template>
  <SetupCardRenderer :content="content" :subs="subs" hide-hero data-test="ai-integrations-mcp-card">
    <!-- Authentication sits under the endpoint it authenticates against. -->
    <template #step-connect>
      <div class="flex flex-col gap-3">
        <!-- Without OAuth there is only one method, so the picker is just noise. -->
        <OTabs v-if="oauthAvailable" v-model="selectedAuthMode" dense>
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

        <OBanner
          v-if="authMode === 'oauth'"
          icon="login"
          data-test="ai-integrations-mcp-oauth-note"
        >
          <div class="flex flex-col gap-1">
            <OText variant="body-strong">
              {{ t("ingestion.mcp.auth.oauthTitle") }}
            </OText>
            <OText variant="meta" as="p" class="leading-snug">
              {{ t("ingestion.mcp.auth.oauthNote") }}
            </OText>
          </div>
        </OBanner>

        <div v-else class="flex flex-col gap-3" data-test="ai-integrations-mcp-credential">
          <!-- No dedicated credential: the snippets carry a placeholder header -->
          <template v-if="!credential">
            <OBanner icon="key" inline-actions>
              <div class="flex flex-col gap-1">
                <OText variant="body-strong">
                  {{ t("ingestion.mcp.credential.quickStartTitle") }}
                </OText>
                <OText variant="meta" as="p" class="leading-snug">
                  {{ t("ingestion.mcp.credential.quickStartBody") }}
                </OText>
              </div>
              <template #actions>
                <OButton
                  variant="primary"
                  size="sm-action"
                  :loading="generating"
                  data-test="ai-integrations-mcp-generate-btn"
                  @click="onGenerate"
                >
                  {{ t("ingestion.mcp.credential.generate") }}
                </OButton>
              </template>
            </OBanner>

            <OBanner
              v-if="genError"
              variant="error"
              dense
              icon="warning"
              :content="raw(genError)"
              data-test="ai-integrations-mcp-credential-error"
            />

            <OBanner
              variant="info"
              dense
              icon="info-outline"
              :content="t('ingestion.mcp.securityBody')"
              data-test="ai-integrations-mcp-security"
            />
          </template>

          <!-- After generation: show-once reveal + manage -->
          <template v-else>
            <OBanner variant="success" icon="check-circle">
              <div class="flex flex-col gap-1">
                <OText variant="body-strong">{{ t("ingestion.mcp.credential.created") }}</OText>
                <OText variant="meta" as="p" class="leading-snug">
                  {{ t("ingestion.mcp.credential.shownOnce", { email: credential.email }) }}
                </OText>
              </div>
            </OBanner>

            <OCodeBlock
              :code="credentialHeader"
              :code-masked="MASKED_AUTH"
              lang="http"
              :reveal-tooltip="t('ingestion.setupCard.revealToken')"
              :hide-tooltip="t('ingestion.setupCard.hideToken')"
              data-test="ai-integrations-mcp-credential-header"
            />

            <div class="flex flex-wrap gap-2">
              <OButton
                variant="outline"
                size="sm-action"
                icon-left="download"
                data-test="ai-integrations-mcp-download-btn"
                @click="downloadCredential"
              >
                {{ t("ingestion.mcp.credential.download") }}
              </OButton>
              <OButton
                variant="ghost"
                size="sm-action"
                icon-left="open-in-new"
                data-test="ai-integrations-mcp-manage-btn"
                @click="goToServiceAccounts"
              >
                {{ t("ingestion.mcp.credential.manage") }}
              </OButton>
            </div>

            <OBanner
              v-if="credential.scope === 'unscoped'"
              variant="warning"
              dense
              icon="warning"
              :content="t('ingestion.mcp.credential.readonlyWarn', { role: MCP_READONLY_ROLE })"
              data-test="ai-integrations-mcp-readonly-warn"
            />
            <OText
              v-else-if="credential.scope === 'rbacDisabled'"
              variant="meta"
              as="p"
              class="leading-snug"
              data-test="ai-integrations-mcp-rbac-note"
            >
              {{ t("ingestion.mcp.credential.rbacNote") }}
            </OText>
            <OText
              v-else
              variant="meta"
              as="p"
              class="leading-snug"
              data-test="ai-integrations-mcp-readonly-note"
            >
              {{ t("ingestion.mcp.credential.readonlyNote", { role: credential.role }) }}
            </OText>
          </template>
        </div>
      </div>
    </template>

    <!-- The client picker drives the snippet below it, so it renders above it. -->
    <template #step-configure-controls>
      <div class="flex flex-col gap-3">
        <OTabs v-model="selectedClient" dense>
          <OTab
            v-for="c in CLIENTS"
            :key="c.id"
            :name="c.id"
            :label="t(c.labelKey)"
            :data-test="`ai-integrations-mcp-client-${c.id}`"
          />
        </OTabs>

        <OButton
          v-if="activeDeepLink"
          variant="primary"
          size="sm-action"
          icon-left="open-in-new"
          class="self-start"
          data-test="ai-integrations-mcp-install-btn"
          @click="openDeepLink"
        >
          {{ t("ingestion.mcp.installOneClick", { client: t(activeClient.labelKey) }) }}
        </OButton>
      </div>
    </template>
  </SetupCardRenderer>
</template>
