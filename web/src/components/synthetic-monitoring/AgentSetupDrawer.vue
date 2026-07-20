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
        <div v-if="install" class="relative">
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
            @click="copyInstall"
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
import { useI18n } from "vue-i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

const props = defineProps<{
  open: boolean;
  install?: string | null;
  locationName?: string | null;
}>();
const emit = defineEmits<{ (e: "update:open", open: boolean): void }>();

const { t } = useI18n();

async function copyInstall() {
  if (!props.install) return;
  try {
    await navigator.clipboard.writeText(props.install);
    toast({ variant: "success", message: t("synthetics.privateLocations.toast.copied") });
  } catch {
    toast({ variant: "error", message: t("synthetics.privateLocations.toast.copyFailed") });
  }
}
</script>
