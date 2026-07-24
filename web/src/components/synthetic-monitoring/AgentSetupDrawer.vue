// Copyright 2026 OpenObserve Inc.
<template>
  <ODrawer
    :open="open"
    side="right"
    size="lg"
    :title="t('synthetics.privateLocations.setup.title')"
    :sub-title="locationName || undefined"
    data-test="synthetics-agent-setup-drawer"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-6 p-4">
      <!-- Step 1: deploy -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <OTag variant="primary-soft" size="sm" shape="pill">1</OTag>
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
            <OInput
              v-if="!locationId"
              v-model="draftLocation"
              :label="t('synthetics.privateLocations.setup.locationNameLabel')"
              :placeholder="t('synthetics.privateLocations.setup.locationNamePlaceholder')"
              required
              size="sm"
              data-test="synthetics-agent-setup-location-input"
            />
          </div>

          <OTabs v-model="platform" dense bordered data-test="synthetics-agent-setup-platform-tabs">
            <OTab name="docker" :label="t('synthetics.privateLocations.setup.tabDocker')" />
            <OTab name="k8s" :label="t('synthetics.privateLocations.setup.tabK8s')" />
            <OTab name="linux" :label="t('synthetics.privateLocations.setup.tabLinux')" />
            <OTab name="windows" :label="t('synthetics.privateLocations.setup.tabWindows')" />
          </OTabs>

          <div class="relative">
            <pre
              class="bg-surface-subtle border-border-default rounded-default overflow-x-auto border p-3 font-mono text-xs whitespace-pre"
              data-test="synthetics-agent-setup-install-cmd"
              >{{ composedCommand }}</pre
            >
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
            >{{ install }}</pre
          >
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
      </div>

      <!-- Step 2: wait for the agent to register -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <OTag variant="primary-soft" size="sm" shape="pill">2</OTag>
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
          <OTag variant="primary-soft" size="sm" shape="pill">3</OTag>
          <span class="text-text-heading font-medium">
            {{ t("synthetics.privateLocations.setup.step3Title") }}
          </span>
        </div>
        <p class="text-text-secondary text-sm">
          {{ t("synthetics.privateLocations.setup.step3Body") }}
        </p>
      </div>

      <p class="text-text-muted border-border-default border-t pt-3 text-xs">
        {{ t("synthetics.privateLocations.setup.browserNote") }}
      </p>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

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
}>();
const emit = defineEmits<{ (e: "update:open", open: boolean): void }>();

const { t } = useI18n();

const platform = ref<string | number>("docker");
const draftLocation = ref("");
const draftAgentName = ref("");

/** A non-empty starting point for the org-level composer — never blank, so a
 *  user who copies without editing still gets a usable command. Regenerated
 *  on every fresh open (not sticky), so two agents set up back-to-back don't
 *  default to the same location name. */
function generateDefaultLocationName(): string {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `private-location-${suffix}`;
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    draftLocation.value =
      props.locationName || (props.locationId ? "" : generateDefaultLocationName());
    draftAgentName.value = props.agentName || "";
  },
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
      `  -Token "${props.token || "<o2syn-token>"}" \``,
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
    `  --token=${props.token || "<o2syn-token>"} \\`,
  ];
  if (props.locationId) {
    lines.push(`  --location-id=${props.locationId} \\`);
  } else {
    lines.push(`  --location="${draftLocation.value || "<location-name>"}" \\`);
  }
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
