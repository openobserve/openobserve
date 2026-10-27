<!--
Copyright 2026 OpenObserve Inc.

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
  <ODialog
    :open="open"
    size="sm"
    :persistent="saving"
    :title="t('dashboard.panelDraft.leaveTitle')"
    :primary-button-label="canSave ? t('panel.save') : undefined"
    primary-button-data-test="dashboard-panel-leave-save"
    :primary-button-loading="saving"
    :secondary-button-label="canKeepDraft ? t('dashboard.panelDraft.keepDraft') : undefined"
    :neutral-button-label="t('panel.discard')"
    neutral-button-variant="ghost-destructive"
    data-test="dashboard-panel-leave-dialog"
    @update:open="onOpenChange"
    @click:primary="emit('choose', 'save')"
    @click:secondary="emit('choose', 'keep')"
    @click:neutral="emit('choose', 'discard')"
  >
    <div class="flex flex-col gap-3">
      <p class="text-text-body text-sm" data-test="dashboard-panel-leave-message">
        {{
          !canSave
            ? t("dashboard.panelDraft.leaveMessageDiscardOnly")
            : canKeepDraft
              ? t("dashboard.panelDraft.leaveMessage")
              : t("dashboard.panelDraft.leaveMessageNoDraft")
        }}
      </p>
      <p
        v-if="signingOut"
        class="text-text-secondary text-sm"
        data-test="dashboard-panel-leave-sign-out"
      >
        {{ t("common.editorDraft.signOutDiscards") }}
      </p>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { PanelLeaveChoice } from "./panelDraft.types";

withDefaults(
  defineProps<{
    open: boolean;
    saving?: boolean;
    canKeepDraft?: boolean;
    signingOut?: boolean;
    canSave?: boolean;
  }>(),
  { canSave: true },
);

const emit = defineEmits<{
  choose: [choice: PanelLeaveChoice];
}>();

const { t } = useI18nTyped();

const onOpenChange = (value: boolean) => {
  if (!value) emit("choose", "stay");
};
</script>
