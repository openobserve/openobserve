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
    :primary-button-label="t('panel.save')"
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
    <p class="text-text-body text-sm" data-test="dashboard-panel-leave-message">
      {{ t("dashboard.panelDraft.leaveMessage") }}
    </p>
  </ODialog>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { PanelLeaveChoice } from "./panelDraft.types";

defineProps<{
  open: boolean;
  saving?: boolean;
  canKeepDraft?: boolean;
}>();

const emit = defineEmits<{
  choose: [choice: PanelLeaveChoice];
}>();

const { t } = useI18nTyped();

const onOpenChange = (value: boolean) => {
  if (!value) emit("choose", "stay");
};
</script>
