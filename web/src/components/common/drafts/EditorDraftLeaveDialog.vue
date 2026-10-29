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
    :persistent="saving || forced"
    :show-close="!forced"
    :title="t('common.editorDraft.leaveTitle')"
    :primary-button-label="canSave ? (saveLabel ?? t('common.save')) : undefined"
    primary-button-data-test="editor-draft-leave-save"
    :primary-button-loading="saving"
    :secondary-button-label="secondaryLabel"
    :neutral-button-label="t('common.editorDraft.discard')"
    neutral-button-variant="ghost-destructive"
    data-test="editor-draft-leave-dialog"
    @update:open="onOpenChange"
    @click:primary="emit('choose', 'save')"
    @click:secondary="emit('choose', canKeepDraft ? 'keep' : 'stay')"
    @click:neutral="emit('choose', 'discard')"
  >
    <div class="flex items-start gap-1">
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <p class="text-text-body text-sm" data-test="editor-draft-leave-message">
          {{ leaveMessage }}
        </p>
        <p
          v-if="discardsOthers"
          class="text-text-body text-sm"
          data-test="editor-draft-leave-sign-out-others"
        >
          {{
            t(
              "common.editorDraft.signOutDiscardsOthers",
              { count: otherDraftCount },
              otherDraftCount,
            )
          }}
        </p>
      </div>
      <EditorDraftInfoHint
        v-if="signingOut && !forced"
        :content="t('common.editorDraft.signOutDiscardsOthers', { count: 0 }, 0)"
        data-test="editor-draft-leave-sign-out"
      />
      <EditorDraftInfoHint
        v-else-if="canKeepDraft"
        :content="retention"
        data-test="editor-draft-leave-retention"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import EditorDraftInfoHint from "./EditorDraftInfoHint.vue";
import type { EditorDraftLeaveChoice } from "@/composables/useEditorDraft";
import { EDITOR_DRAFT_MAX_PER_KIND, EDITOR_DRAFT_TTL_MS } from "@/utils/drafts/editorDraftStore";

const props = withDefaults(
  defineProps<{
    open: boolean;
    entityLabel: I18nText;
    saving?: boolean;
    canKeepDraft?: boolean;
    signingOut?: boolean;
    canSave?: boolean;
    /** The sign-out cannot be cancelled (the password changed), so the dialog offers only Discard and cannot be closed. */
    forced?: boolean;
    /** While signing out, how many of the user's other drafts the sign-out discards. */
    otherDraftCount?: number;
    /** The item has a server-side draft of its own, so the copy avoids the word "draft". */
    serverDraftItem?: boolean;
    saveLabel?: I18nText | null;
    /** The host's own message, when the default copy does not fit its buttons. */
    message?: I18nText | null;
  }>(),
  { canSave: true, otherDraftCount: 0 },
);

const emit = defineEmits<{
  choose: [choice: EditorDraftLeaveChoice];
}>();

const { t } = useI18nTyped();

const leaveMessage = computed(() => {
  if (props.message) return props.message;
  const entity = props.entityLabel;
  if (props.forced) return t("common.editorDraft.leaveMessageForced", { entity });
  if (!props.canSave) return t("common.editorDraft.leaveMessageDiscardOnly", { entity });
  if (!props.canKeepDraft) return t("common.editorDraft.leaveMessageNoDraft", { entity });
  return props.serverDraftItem
    ? t("common.editorDraft.leaveMessageInBrowser", { entity })
    : t("common.editorDraft.leaveMessage", { entity });
});

const retention = computed(() => {
  const params = { days: EDITOR_DRAFT_TTL_MS / 86_400_000, max: EDITOR_DRAFT_MAX_PER_KIND };
  return props.serverDraftItem
    ? t("common.editorDraft.retentionInBrowser", params)
    : t("common.editorDraft.retention", params);
});

// Deleting the user's other drafts is destructive, so it is said in the dialog, not only behind the info icon.
const discardsOthers = computed(
  () => !!props.signingOut && !props.forced && props.otherDraftCount > 0,
);

// The discard-only copy offers to stay, so it carries a button for it.
const secondaryLabel = computed<I18nText | undefined>(() => {
  if (props.canKeepDraft) {
    return props.serverDraftItem
      ? t("common.editorDraft.keepInBrowser")
      : t("common.editorDraft.keepDraft");
  }
  return !props.canSave && !props.forced ? t("common.editorDraft.stay") : undefined;
});

const onOpenChange = (value: boolean) => {
  if (!value && !props.forced) emit("choose", "stay");
};
</script>
