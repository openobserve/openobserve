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
  <ODrawer
    :open="open"
    side="right"
    size="lg"
    :title="t('synthetics.privateLocations.setup.title')"
    :sub-title="raw(locationName || undefined)"
    data-test="synthetics-agent-setup-drawer"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-6 p-4">
      <AgentRunnerNotice
        :agents="agents ?? []"
        :min-runner-version="minRunnerVersion ?? undefined"
        :lease-deadline-us="leaseDeadlineUs ?? undefined"
      />
      <!-- Step 1: deploy -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <OTag variant="primary-soft" size="sm" shape="pill">{{ "1" }}</OTag>
          <span class="text-text-heading font-medium">
            {{ t("synthetics.privateLocations.setup.step1Title") }}
          </span>
        </div>
        <p class="text-text-secondary text-sm">
          {{ t("synthetics.privateLocations.setup.step1Body") }}
        </p>

        <!-- Composer: location inputs + platform tabs + composed command -->
        <template v-if="canCompose">
          <div class="rounded-default border-border-default flex flex-col gap-3 border p-3">
            <OInput
              v-if="!locationId"
              v-model="draftLocation"
              :label="t('synthetics.privateLocations.setup.locationNameLabel')"
              :placeholder="t('synthetics.privateLocations.setup.locationNamePlaceholder')"
              required
              size="sm"
              data-test="synthetics-agent-setup-location-input"
            />
            <div class="flex flex-col gap-1">
              <OInput
                v-model="draftAgentName"
                :label="t('synthetics.privateLocations.setup.agentNameLabel')"
                :placeholder="t('synthetics.privateLocations.setup.agentNamePlaceholder')"
                size="sm"
                data-test="synthetics-agent-setup-agent-name-input"
              />
              <p class="text-text-muted text-xs">
                {{ t("synthetics.privateLocations.setup.agentNameHint") }}
              </p>
            </div>
          </div>

          <!-- Which agent to install. The two are different programs, not two
               modes of one: net probe = Go binary/image, browser = Playwright
               image. Both register into the SAME location when given the same
               location name, so an operator who wants a private location that
               serves every check type installs one of each. -->
          <div class="flex flex-col gap-1">
            <span class="text-text-muted text-xs font-medium uppercase">
              {{ t("synthetics.privateLocations.setup.typeTitle") }}
            </span>
            <OTabs
              v-model="selectedAgentType"
              dense
              bordered
              data-test="synthetics-agent-setup-type-tabs"
            >
              <OTab name="protocol" :label="t('synthetics.privateLocations.setup.typeProtocol')" />
              <OTab name="browser" :label="t('synthetics.privateLocations.setup.typeBrowser')" />
            </OTabs>
            <p class="text-text-muted text-xs" data-test="synthetics-agent-setup-type-hint">
              {{
                isBrowser
                  ? t("synthetics.privateLocations.setup.typeBrowserHint")
                  : t("synthetics.privateLocations.setup.typeProtocolHint")
              }}
            </p>
          </div>

          <OTabs v-model="platform" dense bordered data-test="synthetics-agent-setup-platform-tabs">
            <OTab name="docker" :label="t('synthetics.privateLocations.setup.tabDocker')" />
            <OTab name="k8s" :label="t('synthetics.privateLocations.setup.tabK8s')" />
            <!-- Native-binary platforms ship the Go agent only — install.sh's
                 linux path downloads a release binary and the Windows path is
                 install.ps1, neither of which can run Chromium. -->
            <OTab
              v-if="!isBrowser"
              name="linux"
              :label="t('synthetics.privateLocations.setup.tabLinux')"
            />
            <OTab
              v-if="!isBrowser"
              name="windows"
              :label="t('synthetics.privateLocations.setup.tabWindows')"
            />
          </OTabs>

          <div class="relative">
            <pre
              class="bg-surface-subtle border-border-default rounded-default overflow-x-auto border p-3 font-mono text-xs whitespace-pre"
              data-test="synthetics-agent-setup-install-cmd"
              >{{ composedCommand }}</pre>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="content-copy"
              class="absolute top-1 right-1"
              :title="t('common.copy')"
              data-test="synthetics-agent-setup-copy-btn"
              @click="copyCommand"
            />
          </div>
        </template>

        <!-- Legacy fallback: server-composed docker one-liner -->
        <div v-else-if="install" class="relative">
          <pre
            class="bg-surface-subtle border-border-default rounded-default overflow-x-auto border p-3 font-mono text-xs whitespace-pre"
            data-test="synthetics-agent-setup-install-cmd"
            >{{ install }}</pre>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="content-copy"
            class="absolute top-1 right-1"
            :title="t('common.copy')"
            data-test="synthetics-agent-setup-copy-btn"
            @click="copyCommand"
          />
        </div>
        <p v-else class="text-text-muted text-sm">
          {{ t("synthetics.privateLocations.setup.noToken") }}
        </p>

        <template v-if="isAdmin">
          <div
            class="flex flex-wrap items-end gap-2"
            data-test="synthetics-agent-setup-token-insert"
          >
            <OSelect
              v-model="tokenToInsert"
              class="w-60"
              size="sm"
              :label="t('synthetics.secretRunner.tokenLabel')"
              :options="tokenOptions"
              data-test="synthetics-agent-setup-token-select"
            />
            <OButton
              variant="primary"
              size="sm"
              icon-left="key"
              :disabled="!tokenToInsert"
              :loading="viewToken.isPending.value"
              data-test="synthetics-agent-setup-insert-token"
              @click="insertToken"
            >
              {{ t("synthetics.secretRunner.insertToken") }}
            </OButton>
            <OButton
              variant="outline"
              size="sm"
              icon-left="add"
              :loading="createToken.isPending.value"
              data-test="synthetics-agent-setup-new-token"
              @click="newToken"
            >
              {{ t("synthetics.secretRunner.newToken") }}
            </OButton>
          </div>
          <span class="text-text-secondary text-xs">{{
            t("synthetics.secretRunner.shownFor")
          }}</span>
        </template>
        <OBanner
          v-else
          variant="info"
          icon="info"
          :content="t('synthetics.secretRunner.askAdmin')"
          data-test="synthetics-agent-setup-ask-admin"
        />

        <div
          v-if="rotateAgents.length"
          class="border-border-default rounded-default flex flex-col gap-2 border p-3"
          data-test="synthetics-agent-setup-rotate-required"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span v-for="a in rotateAgents" :key="a.id" class="flex items-center gap-1 text-sm">
              <span class="text-text-body">{{ agentLabel(a) }}</span>
              <OTag
                size="xs"
                variant="warning-soft"
                icon=""
                :label="t('synthetics.secretRunner.rotateRequired')"
              />
            </span>
          </div>
          <span class="text-text-secondary text-xs">{{
            t("synthetics.secretRunner.rotateHint")
          }}</span>
        </div>
      </div>

      <!-- Step 2: wait for the agent to register -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <OTag variant="primary-soft" size="sm" shape="pill">{{ "2" }}</OTag>
          <span class="text-text-heading font-medium">
            {{ t("synthetics.privateLocations.setup.step2Title") }}
          </span>
        </div>
        <p class="text-text-secondary text-sm">
          {{ t("synthetics.privateLocations.setup.step2Body") }}
        </p>
      </div>

      <!-- Step 3: assign in checks -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <OTag variant="primary-soft" size="sm" shape="pill">{{ "3" }}</OTag>
          <span class="text-text-heading font-medium">
            {{ t("synthetics.privateLocations.setup.step3Title") }}
          </span>
        </div>
        <p class="text-text-secondary text-sm">
          {{ t("synthetics.privateLocations.setup.step3Body") }}
        </p>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useOrgRole } from "@/composables/useOrgRole";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  agentTokensQuery,
  createAgentTokenMutation,
  viewAgentTokenMutation,
} from "@/services/synthetics.queries";
import type { SyntheticLocationAgent } from "@/types/synthetics";
import AgentRunnerNotice from "./AgentRunnerNotice.vue";

const props = defineProps<{
  open: boolean;
  /** Legacy server-composed command — fallback when ingredients are absent. */
  install?: string | null;
  locationName?: string | null;
  /** Pinned mode: compose with --location-id instead of a typed name. */
  locationId?: string | null;
  /** Composer ingredients from GET /synthetics/agent-setup. */
  token?: string | null;
  org?: string | null;
  o2Url?: string | null;
  scriptUrl?: string | null;
  /** Pre-fills the agent name — used when recovering a specific known agent. */
  agentName?: string | null;
  /** Which agent the type tabs open on. `browser` adds `--type=browser`, which
   *  selects the Playwright browser-probe image; default `protocol` installs the
   *  Go agent. The operator can switch tabs either way once open. */
  agentType?: "protocol" | "browser";
  /** Agents on this location: drive the old-runner notice and Rotate required. */
  agents?: SyntheticLocationAgent[] | null;
  minRunnerVersion?: string | null;
  leaseDeadlineUs?: number | null;
}>();
const emit = defineEmits<{ (e: "update:open", open: boolean): void }>();

const { t } = useI18nTyped();
const orgId = useOrgId();

// Agent tokens are org-admin only since P1-7 (V31); the server refuses everyone else.
const { isAdmin } = useOrgRole();
const tokensQuery = useQuery(() =>
  Object.assign(agentTokensQuery(orgId.value), {
    enabled: props.open && isAdmin.value && !!orgId.value,
  }),
);
type TokenRow = { name: string; enabled?: boolean };
// The list route answers `{tokens}`; a bare array is tolerated for older servers.
const tokenOptions = computed(() => {
  const data = tokensQuery.data.value as { tokens?: TokenRow[] } | TokenRow[] | undefined;
  const rows = Array.isArray(data) ? data : (data?.tokens ?? []);
  return rows
    .filter((tok) => tok.enabled !== false)
    .map((tok) => ({ label: raw(tok.name), value: tok.name }));
});
const tokenToInsert = ref<string | null>(null);
const insertedToken = ref<string | null>(null);
// The viewed token stays in the command for 30 s; each view is audited server-side.
const TOKEN_SHOWN_MS = 30_000;
let tokenTimer: ReturnType<typeof setTimeout> | null = null;
// gcTime 0 + reset: the mutation cache would otherwise keep the token after it is hidden.
const viewToken = useMutation(() => ({ ...viewAgentTokenMutation(orgId.value), gcTime: 0 }));
const createToken = useMutation(() => ({ ...createAgentTokenMutation(orgId.value), gcTime: 0 }));
const hideToken = () => {
  if (tokenTimer) clearTimeout(tokenTimer);
  tokenTimer = null;
  insertedToken.value = null;
  viewToken.reset();
  createToken.reset();
};
const showForAWhile = (token: string) => {
  insertedToken.value = token;
  if (tokenTimer) clearTimeout(tokenTimer);
  tokenTimer = setTimeout(hideToken, TOKEN_SHOWN_MS);
};
const insertToken = async () => {
  if (!tokenToInsert.value) return;
  try {
    const res = await viewToken.mutateAsync(tokenToInsert.value);
    showForAWhile(res.data.token);
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.response?.data?.message) || t("synthetics.secretRunner.viewFailed"),
    });
  }
};
/** One click: the name says where the token went, so the tokens page can tell it apart. */
const newToken = async () => {
  const where = props.locationName || props.locationId || "agent";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  try {
    const res = await createToken.mutateAsync(`${where}-${stamp}`);
    tokenToInsert.value = res.data.name;
    showForAWhile(res.data.token);
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.response?.data?.message) || t("synthetics.tokens.createError"),
    });
  }
};
onBeforeUnmount(hideToken);
watch(
  () => props.open,
  (open) => !open && hideToken(),
);
const effectiveToken = computed(() => insertedToken.value || props.token);

const rotateAgents = computed(() => (props.agents ?? []).filter((a) => a.token_pre_cutover));
const agentLabel = (a: SyntheticLocationAgent) =>
  a.token_name ? raw(`${a.name} · ${a.token_name}`) : raw(a.name);

const platform = ref<string | number>("docker");
const selectedAgentType = ref<string | number>("protocol");
const draftLocation = ref("");
const draftAgentName = ref("");

const isBrowser = computed(() => selectedAgentType.value === "browser");

// The browser probe is container-only, so switching to it while sitting on a
// native-binary tab has to move the platform too — otherwise the hidden tab
// stays selected and the command composes an install that cannot work.
watch(isBrowser, (browser) => {
  if (browser && (platform.value === "linux" || platform.value === "windows")) {
    platform.value = "docker";
  }
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    // The caller's agentType is the opening default (the browser check page
    // opens this wanting a browser agent), not a lock — the operator can flip
    // tabs to install the other kind for the same location.
    selectedAgentType.value = props.agentType || "protocol";
    // Start BLANK (not an auto-generated `private-location-XXXX`) so the operator
    // deliberately names the location — and reuses that name across agents (a
    // location is a pool of interchangeable agents, not one location per agent).
    // `required` on the input + the copy guard below stop a blank from shipping.
    draftLocation.value = props.locationName || "";
    draftAgentName.value = props.agentName || "";
  },
  // immediate: a caller that mounts the drawer already open (or re-mounts it on
  // route entry) never fires the transition, and would otherwise show a command
  // seeded from the defaults instead of its own props.
  { immediate: true },
);

const canCompose = computed(() => !!props.scriptUrl && !!props.o2Url);

/** One public script per platform-family, parameterized — the bash branch
 *  picks docker/k8s/linux via --platform; Windows is a wholly separate
 *  script (install.ps1, bash can't run there) with PowerShell-idiomatic
 *  params, not a --platform=windows flag (install.sh explicitly rejects
 *  that — see its own header comment). */
const composedCommand = computed(() => {
  if (platform.value === "windows") {
    // install.ps1 always lives next to install.sh (o2-datasource/synthetics/),
    // same mirroring convention — no separate backend field needed for this.
    const psScriptUrl = (props.scriptUrl || "").replace(/install\.sh$/, "install.ps1");
    const lines = [
      `& ([scriptblock]::Create((irm ${psScriptUrl}))) \``,
      `  -O2Url "${props.o2Url}" \``,
      `  -Org "${props.org || "<org>"}" \``,
      `  -Token "${effectiveToken.value || "<o2syn-token>"}" \``,
    ];
    if (props.locationId) {
      lines.push(`  -LocationId "${props.locationId}" \``);
    } else {
      lines.push(`  -Location "${draftLocation.value || "<location-name>"}" \``);
    }
    if (draftAgentName.value) lines.push(`  -AgentName "${draftAgentName.value}"`);
    // Join continuation lines; the last line carries no trailing backtick.
    return lines.map((l, i) => (i === lines.length - 1 ? l.replace(/ `$/, "") : l)).join("\n");
  }

  const lines = [
    `curl -sSL ${props.scriptUrl} | bash -s -- \\`,
    `  --platform=${platform.value} \\`,
    `  --o2-url=${props.o2Url} \\`,
    `  --org=${props.org || "<org>"} \\`,
    `  --token=${effectiveToken.value || "<o2syn-token>"} \\`,
  ];
  if (props.locationId) {
    lines.push(`  --location-id=${props.locationId} \\`);
  } else {
    lines.push(`  --location="${draftLocation.value || "<location-name>"}" \\`);
  }
  // Browser agents run the Playwright image (container-only — docker/k8s).
  if (isBrowser.value) lines.push(`  --type=browser \\`);
  if (draftAgentName.value) lines.push(`  --agent-name="${draftAgentName.value}"`);
  // Join continuation lines; the last line carries no trailing backslash.
  return lines.map((l, i) => (i === lines.length - 1 ? l.replace(/ \\$/, "") : l)).join("\n");
});

async function copyCommand() {
  // Guard the unpinned flow: a blank location would copy the literal
  // "<location-name>" placeholder into a real install command.
  if (canCompose.value && !props.locationId && !draftLocation.value.trim()) {
    toast({ variant: "error", message: t("synthetics.privateLocations.toast.locationRequired") });
    return;
  }
  const text = canCompose.value ? composedCommand.value : props.install;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast({ variant: "success", message: t("synthetics.privateLocations.toast.copied") });
  } catch {
    toast({ variant: "error", message: t("synthetics.privateLocations.toast.copyFailed") });
  }
}
</script>
