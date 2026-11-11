<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Bulk triage buttons for OTable's #selection-actions slot, so it renders siblings, not a wrapper. -->
<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type { CasePriority } from "@/services/securityCases";

export interface BulkAssignee {
  label: I18nText;
  /** Empty string unassigns. */
  value: string;
}

defineProps<{
  assignees: BulkAssignee[];
  priorities: { label: I18nText; value: CasePriority }[];
  busy: boolean;
  /** Null when the selection can be merged, else why not. */
  mergeBlocked: I18nText | null;
}>();
const emit = defineEmits<{
  close: [];
  closeSuppress: [];
  assign: [assignee: string];
  priority: [priority: CasePriority];
  merge: [];
  clear: [];
}>();

const { t } = useI18nTyped();
</script>

<template>
  <OButton
    variant="outline"
    size="sm"
    icon-left="task-alt"
    :disabled="busy"
    data-test="security-cases-bulk-close"
    @click="emit('close')"
    >{{ t("siem.cases.bulk.close") }}</OButton
  >
  <OButton
    variant="outline"
    size="sm"
    icon-left="volume-off"
    :disabled="busy"
    data-test="security-cases-bulk-close-suppress"
    @click="emit('closeSuppress')"
    >{{ t("siem.cases.bulk.closeSuppress") }}</OButton
  >
  <ODropdown side="top">
    <template #trigger>
      <OButton
        variant="outline"
        size="sm"
        icon-left="person"
        :disabled="busy"
        data-test="security-cases-bulk-assign"
        >{{ t("siem.cases.bulk.assign") }}</OButton
      >
    </template>
    <div class="max-h-80 overflow-y-auto">
      <ODropdownItem
        v-for="a in assignees"
        :key="a.value"
        :data-test="`security-cases-bulk-assign-${a.value || 'none'}`"
        @select="emit('assign', a.value)"
        >{{ a.label }}</ODropdownItem
      >
    </div>
  </ODropdown>
  <ODropdown side="top">
    <template #trigger>
      <OButton
        variant="outline"
        size="sm"
        icon-left="tune"
        :disabled="busy"
        data-test="security-cases-bulk-priority"
        >{{ t("siem.cases.bulk.priority") }}</OButton
      >
    </template>
    <ODropdownItem
      v-for="p in priorities"
      :key="p.value"
      :data-test="`security-cases-bulk-priority-${p.value}`"
      @select="emit('priority', p.value)"
      >{{ p.label }}</ODropdownItem
    >
  </ODropdown>
  <OButton
    variant="outline"
    size="sm"
    icon-left="call-merge"
    :disabled="busy || !!mergeBlocked"
    data-test="security-cases-bulk-merge"
    @click="emit('merge')"
    >{{ t("siem.cases.bulk.merge") }}<OTooltip v-if="mergeBlocked" :content="mergeBlocked"
  /></OButton>
  <OButton
    variant="ghost"
    size="sm"
    icon-left="close"
    data-test="security-cases-bulk-clear"
    @click="emit('clear')"
    >{{ t("siem.cases.selection.clear") }}</OButton
  >
</template>
