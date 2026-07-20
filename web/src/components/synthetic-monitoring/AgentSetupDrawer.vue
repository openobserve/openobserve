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
          <span class="font-medium text-text-primary">
            {{ t("synthetics.privateLocations.setup.step1Title") }}
          </span>
        </div>
        <p class="text-sm text-text-secondary">
          {{ t("synthetics.privateLocations.setup.step1Body") }}
        </p>

        <!-- Composer: location inputs + platform tabs + composed command -->
        <template v-if="canCompose">
          <div v-if="!locationId" class="flex gap-3">
            <OInput
              v-model="draftLocation"
              :label="t('synthetics.privateLocations.setup.locationNameLabel')"
              :placeholder="t('synthetics.privateLocations.setup.locationNamePlaceholder')"
              size="sm"
              class="flex-1"
              data-test="synthetics-agent-setup-location-input"
            />
            <OInput
              v-model="draftRegion"
              :label="t('synthetics.privateLocations.setup.regionLabel')"
              :placeholder="t('synthetics.privateLocations.setup.regionPlaceholder')"
              size="sm"
              class="flex-1"
              data-test="synthetics-agent-setup-region-input"
            />
          </div>

          <OTabs v-model="platform" dense bordered data-test="synthetics-agent-setup-platform-tabs">
            <OTab name="docker" :label="t('synthetics.privateLocations.setup.tabDocker')" />
            <OTab name="k8s" :label="t('synthetics.privateLocations.setup.tabK8s')" />
            <OTab name="linux" :label="t('synthetics.privateLocations.setup.tabLinux')" />
            <OTab
              name="windows"
              :label="t('synthetics.privateLocations.setup.tabWindows')"
              disable
              :tooltip="t('synthetics.privateLocations.setup.windowsSoon')"
            />
          </OTabs>

          <div class="relative">
            <pre
              class="bg-surface-subtle border border-border-default rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre"
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
            class="bg-surface-subtle border border-border-default rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre"
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
        <p v-else class="text-sm text-text-muted">
          {{ t("synthetics.privateLocations.setup.noToken") }}
        </p>
        <p class="text-xs text-text-muted">
          {{ t("synthetics.privateLocations.setup.imagePlaceholderNote") }}
        </p>
      </div>

      <!-- Step 2: wait for the agent to register -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <OTag variant="primary-soft" size="sm" shape="pill">2</OTag>
          <span class="font-medium text-text-primary">
            {{ t("synthetics.privateLocations.setup.step2Title") }}
          </span>
        </div>
        <p class="text-sm text-text-secondary">
          {{ t("synthetics.privateLocations.setup.step2Body") }}
        </p>
      </div>

      <!-- Step 3: assign in checks -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <OTag variant="primary-soft" size="sm" shape="pill">3</OTag>
          <span class="font-medium text-text-primary">
            {{ t("synthetics.privateLocations.setup.step3Title") }}
          </span>
        </div>
        <p class="text-sm text-text-secondary">
          {{ t("synthetics.privateLocations.setup.step3Body") }}
        </p>
      </div>

      <p class="text-xs text-text-muted border-t border-border-default pt-3">
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
  o2Url?: string | null;
  scriptUrl?: string | null;
}>();
const emit = defineEmits<{ (e: "update:open", open: boolean): void }>();

const { t } = useI18n();

const platform = ref<string | number>("docker");
const draftLocation = ref("");
const draftRegion = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) draftLocation.value = props.locationName ?? "";
  },
);

const canCompose = computed(() => !!props.scriptUrl && !!props.o2Url);

/** One public script, parameterized — the platform flag picks the branch
 *  (docker run / k8s manifest apply / docker-under-systemd). */
const composedCommand = computed(() => {
  const lines = [
    `curl -sSL ${props.scriptUrl} | bash -s -- \\`,
    `  --platform=${platform.value} \\`,
    `  --o2-url=${props.o2Url} \\`,
    `  --token=${props.token || "<o2syn-token>"} \\`,
  ];
  if (props.locationId) {
    lines.push(`  --location-id=${props.locationId}`);
  } else {
    lines.push(`  --location="${draftLocation.value || "<location-name>"}"`);
    if (draftRegion.value) lines.push(`  --region="${draftRegion.value}"`);
  }
  // Join continuation lines; the last line carries no trailing backslash.
  return lines
    .map((l, i) => (i === lines.length - 1 ? l.replace(/ \\$/, "") : l))
    .join("\n");
});

async function copyCommand() {
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
