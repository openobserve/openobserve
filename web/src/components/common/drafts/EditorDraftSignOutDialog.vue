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
    :title="t('common.editorDraft.signOutTitle')"
    :primary-button-label="t('common.editorDraft.signOutConfirm')"
    primary-button-variant="destructive"
    primary-button-data-test="editor-draft-signout-confirm"
    :secondary-button-label="t('common.cancel')"
    data-test="editor-draft-signout-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="confirm"
    @click:secondary="emit('update:open', false)"
  >
    <p class="text-text-body text-sm" data-test="editor-draft-signout-message">
      {{ t("common.editorDraft.signOutMessage", { count }, count) }}
    </p>
  </ODialog>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";

defineProps<{
  open: boolean;
  count: number;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  confirm: [];
}>();

const { t } = useI18nTyped();

const confirm = () => {
  emit("update:open", false);
  emit("confirm");
};
</script>
