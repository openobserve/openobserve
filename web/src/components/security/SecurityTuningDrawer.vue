<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import SecurityAllowlists from "./SecurityAllowlists.vue";
import SecuritySuppressions from "./SecuritySuppressions.vue";

defineProps<{
  open: boolean;
  orgId: string;
  canAuthor: boolean;
  canAdmin: boolean;
  detectionNames: Readonly<Record<string, string>>;
}>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18nTyped();
const tab = ref<string | number>("allowlists");
</script>

<template>
  <ODrawer
    :open="open"
    size="lg"
    bleed
    :title="t('siem.tuning.title')"
    :sub-title="t('siem.tuning.subtitle')"
    data-test="security-tuning-drawer"
    @update:open="emit('update:open', $event)"
  >
    <OTabs v-model="tab" class="border-border-default border-b" data-test="security-tuning-tabs">
      <OTab
        name="allowlists"
        icon="checklist"
        :label="t('siem.tuning.allowlists.tab')"
        data-test="security-tuning-tab-allowlists"
      />
      <OTab
        name="suppressions"
        icon="notifications-paused"
        :label="t('siem.tuning.suppressions.tab')"
        data-test="security-tuning-tab-suppressions"
      />
    </OTabs>
    <OContent class="flex flex-col gap-4">
      <SecurityAllowlists
        v-if="tab === 'allowlists'"
        :org-id="orgId"
        :can-author="canAuthor"
        :can-admin="canAdmin"
      />
      <SecuritySuppressions
        v-else
        :org-id="orgId"
        :can-admin="canAdmin"
        :detection-names="detectionNames"
      />
    </OContent>
  </ODrawer>
</template>
