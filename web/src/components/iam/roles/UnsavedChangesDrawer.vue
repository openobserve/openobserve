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
    data-test="edit-role-unsaved-drawer"
    size="md"
    bleed
    :open="open"
    :title="t('iam.editRole.summaryPendingTitle')"
    :sub-title="t('iam.editRole.summaryPendingHint')"
    :secondary-button-label="changes.length ? t('iam.editRole.undoAllChanges') : undefined"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('undo', allKeys)"
  >
    <OEmptyState
      v-if="!changes.length"
      size="block"
      preset="no-data"
      :title="t('iam.editRole.noUnsavedChanges')"
      data-test="edit-role-unsaved-empty"
    />
    <ul v-else class="divide-border-default flex flex-col divide-y">
      <li
        v-for="change in changes"
        :key="change.id"
        class="flex min-h-14 items-center gap-3 px-4 py-2"
        :data-test="`edit-role-unsaved-${change.id}`"
      >
        <OBadge
          :variant="change.state === 'added' ? 'success-soft' : 'error-soft'"
          size="sm"
          class="shrink-0"
        >
          {{
            change.state === "added"
              ? t("iam.editRole.summaryChangeAdded")
              : t("iam.editRole.summaryChangeRemoved")
          }}
        </OBadge>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-text-body truncate text-sm" :title="change.label">
            {{ change.label }}
          </span>
          <div class="flex min-w-0 flex-wrap items-center gap-1">
            <span class="text-text-secondary me-1 truncate text-xs">{{ change.moduleLabel }}</span>
            <OBadge
              v-for="action in change.actions"
              :key="action.action"
              variant="primary-soft"
              size="sm"
            >
              {{ action.label }}
            </OBadge>
          </div>
        </div>
        <OButton
          variant="ghost"
          size="sm"
          icon-left="undo"
          :data-test="`edit-role-unsaved-undo-${change.id}`"
          @click="emit('undo', change.keys)"
        >
          {{ t("iam.editRole.summaryUndoRemove") }}
        </OButton>
      </li>
    </ul>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";

export type PendingChange = {
  id: string;
  state: "added" | "removed";
  label: I18nText;
  moduleLabel: I18nText;
  actions: { action: string; label: I18nText }[];
  keys: string[];
};

const props = defineProps<{ open: boolean; changes: PendingChange[] }>();

const emit = defineEmits<{ "update:open": [value: boolean]; undo: [keys: string[]] }>();

const { t } = useI18nTyped();

const allKeys = computed(() => props.changes.flatMap((change) => change.keys));
</script>
