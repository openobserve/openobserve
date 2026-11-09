<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OAccessLock from "@/components/access/OAccessLock.vue";
import { JOB_PRESETS } from "@/components/iam/roles/jobPresets";
import { canManageRoles, securityPresetFor } from "@/composables/security/useSecurityAccess";
import type { AccessDenial } from "@/composables/useAccessStore";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    denials: AccessDenial[];
    size?: "hero" | "block";
    dataTest?: string;
    /** The server's own reason, such as the streams it could not read. */
    reason?: I18nText;
  }>(),
  { size: "block", dataTest: "security-access-lock", reason: undefined },
);

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const preset = computed(() => {
  const id = securityPresetFor(props.denials);
  return id ? JOB_PRESETS.find((p) => p.id === id) : undefined;
});
const presetTitle = computed(() => (preset.value ? t(preset.value.titleKey) : undefined));
const manages = computed(() => canManageRoles(store.state));

function openPreset() {
  if (!preset.value) return;
  router.push({
    name: "roles",
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
      startFrom: preset.value.id,
    },
  });
}
</script>

<template>
  <div class="flex flex-col items-center gap-2" :data-test="dataTest">
    <OAccessLock
      :denials="denials"
      :size="size"
      covers
      :action-label="
        presetTitle && manages ? t('siem.access.openPreset', { preset: presetTitle }) : undefined
      "
      action-icon="manage-accounts"
      @action="openPreset"
    />
    <p
      v-if="reason"
      class="text-text-secondary max-w-xl text-center text-xs break-words"
      :data-test="`${dataTest}-reason`"
    >
      {{ reason }}
    </p>
    <p
      v-if="presetTitle && !manages"
      class="text-text-secondary text-sm"
      :data-test="`${dataTest}-ask-admin`"
    >
      {{ t("siem.access.askPreset", { preset: presetTitle }) }}
    </p>
  </div>
</template>
