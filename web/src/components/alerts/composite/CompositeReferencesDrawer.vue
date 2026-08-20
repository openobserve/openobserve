<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { useId } from "vue";

import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import type { CompositeAlertReference } from "@/ts/interfaces/alert";
import { raw, useI18nTyped } from "@/types/i18n";

withDefaults(
  defineProps<{
    open?: boolean;
    referenceCount?: number;
    references?: CompositeAlertReference[];
    hiddenReferenceCount?: number;
    conflictCode?: string;
    showTrigger?: boolean;
  }>(),
  {
    open: false,
    referenceCount: 0,
    references: () => [],
    hiddenReferenceCount: 0,
    conflictCode: undefined,
    showTrigger: true,
  },
);

const emit = defineEmits<{
  (event: "update:open", value: boolean): void;
  (event: "navigate", reference: CompositeAlertReference): void;
}>();

const { t } = useI18nTyped();
const hostId = `alerts-composite-reference-host-${useId().replaceAll(":", "")}`;
const titleId = `${hostId}-title`;
</script>

<template>
  <span class="inline-flex items-center">
    <OButton
      v-if="showTrigger"
      variant="ghost-primary"
      size="xs"
      data-test="alerts-composite-reference-chip"
      :aria-label="t('alerts.composite.openReferences', { count: referenceCount })"
      @click="emit('update:open', true)"
    >
      {{ t("alerts.composite.referencedByCount", { count: referenceCount }) }}
    </OButton>
    <ODrawer
      :open="open"
      inline
      size="md"
      :title="t('alerts.composite.referencesTitle')"
      :title-data-test="titleId"
      :show-close="false"
      :aria-labelledby="titleId"
      data-test="alerts-composite-reference-drawer"
      @update:open="emit('update:open', $event)"
    >
      <template #header-right>
        <OButton
          variant="ghost-muted"
          size="icon-sm"
          icon-left="close"
          autofocus
          data-test="alerts-composite-reference-close"
          :aria-label="t('alerts.composite.closeReferences')"
          @click="emit('update:open', false)"
        />
      </template>

      <div class="flex flex-col gap-3">
        <div
          v-if="conflictCode === 'child_referenced'"
          data-test="alerts-composite-reference-conflict"
        >
          <OBadge variant="warning-soft">{{ t("alerts.composite.deleteBlocked") }}</OBadge>
        </div>

        <OButton
          v-for="reference in references"
          :key="reference.alert_id"
          variant="ghost"
          size="sm"
          class="justify-start!"
          :aria-label="t('alerts.composite.openParent', { name: reference.name })"
          :data-test="`alerts-composite-reference-parent-${reference.alert_id}`"
          @click="emit('navigate', reference)"
        >
          <span class="min-w-0 truncate" :title="reference.name">
            {{ raw(reference.name) }}
          </span>
        </OButton>

        <div
          v-if="hiddenReferenceCount > 0"
          class="text-text-secondary text-sm"
          data-test="alerts-composite-reference-hidden-count"
        >
          {{ t("alerts.composite.hiddenReferenceCount", { count: hiddenReferenceCount }) }}
        </div>
      </div>
    </ODrawer>
  </span>
</template>
