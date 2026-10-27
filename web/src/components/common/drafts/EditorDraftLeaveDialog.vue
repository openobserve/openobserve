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
    :title="t('common.editorDraft.leaveTitle')"
    :primary-button-label="canSave ? t('common.save') : undefined"
    primary-button-data-test="editor-draft-leave-save"
    :primary-button-loading="saving"
    :secondary-button-label="canKeepDraft ? t('common.editorDraft.keepDraft') : undefined"
    :neutral-button-label="t('panel.discard')"
    neutral-button-variant="ghost-destructive"
    data-test="editor-draft-leave-dialog"
    @update:open="onOpenChange"
    @click:primary="emit('choose', 'save')"
    @click:secondary="emit('choose', 'keep')"
    @click:neutral="emit('choose', 'discard')"
  >
    <div class="flex flex-col gap-3">
      <p class="text-text-body text-sm" data-test="editor-draft-leave-message">
        {{
          !canSave
            ? t("common.editorDraft.leaveMessageDiscardOnly", { entity: entityLabel })
            : canKeepDraft
              ? t("common.editorDraft.leaveMessage", { entity: entityLabel })
              : t("common.editorDraft.leaveMessageNoDraft", { entity: entityLabel })
        }}
      </p>
      <p
        v-if="signingOut"
        class="text-text-secondary text-sm"
        data-test="editor-draft-leave-sign-out"
      >
        {{ t("common.editorDraft.signOutDiscards") }}
      </p>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { EditorDraftLeaveChoice } from "@/composables/useEditorDraft";

withDefaults(
  defineProps<{
    open: boolean;
    entityLabel: I18nText;
    saving?: boolean;
    canKeepDraft?: boolean;
    signingOut?: boolean;
    canSave?: boolean;
  }>(),
  { canSave: true },
);

const emit = defineEmits<{
  choose: [choice: EditorDraftLeaveChoice];
}>();

const { t } = useI18nTyped();

const onOpenChange = (value: boolean) => {
  if (!value) emit("choose", "stay");
};
</script>
