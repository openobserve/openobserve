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
    :title="title ?? t('common.editorDraft.restoreTitle')"
    :primary-button-label="
      serverDraftItem
        ? t('common.editorDraft.continueEditing')
        : t('common.editorDraft.continueDraft')
    "
    primary-button-data-test="editor-draft-continue"
    :secondary-button-label="t('common.editorDraft.startFresh')"
    data-test="editor-draft-restore-dialog"
    @update:open="onOpenChange"
    @click:primary="emit('continue')"
    @click:secondary="emit('fresh')"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-start gap-1">
        <p class="text-text-body min-w-0 flex-1 text-sm" data-test="editor-draft-restore-message">
          {{ t("common.editorDraft.restoreMessage", { entity: entityLabel, date: savedAtText }) }}
        </p>
        <EditorDraftInfoHint v-if="note" :content="note" data-test="editor-draft-restore-note" />
      </div>
      <OBanner
        v-if="notices.length"
        :variant="changedOnServer ? 'warning' : 'info'"
        :icon="changedOnServer ? 'warning' : 'info'"
        data-test="editor-draft-restore-notices"
      >
        <ul class="flex flex-col gap-1">
          <li v-for="notice in notices" :key="notice.id" :data-test="notice.id">
            {{ notice.text }}
          </li>
        </ul>
      </OBanner>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import EditorDraftInfoHint from "./EditorDraftInfoHint.vue";
import { formatEditorDraftTime } from "@/utils/drafts/editorDraftStore";

const props = defineProps<{
  open: boolean;
  savedAt: number;
  entityLabel: I18nText;
  title?: I18nText;
  changedOnServer?: boolean;
  credentialsNotSaved?: boolean;
  notKeptFields?: I18nText[];
  /** The item has a server-side draft of its own, so the copy avoids the word "draft". */
  serverDraftItem?: boolean;
  note?: I18nText | null;
}>();

const emit = defineEmits<{
  continue: [];
  fresh: [];
  dismiss: [];
}>();

const { t, locale } = useI18nTyped();
const store = useStore();

const savedAtText = computed(() =>
  formatEditorDraftTime(props.savedAt, locale.value, store.state.timezone || undefined),
);

const credentialsNote = computed(() => {
  const fields = props.notKeptFields ?? [];
  if (fields.length) {
    const list = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(fields);
    return t("common.editorDraft.changesNotKept", { fields: list }, fields.length);
  }
  return props.serverDraftItem
    ? t("common.editorDraft.credentialsNotSavedInBrowser")
    : t("common.editorDraft.credentialsNotSaved");
});

const notices = computed(() => {
  const entity = props.entityLabel;
  const list: { id: string; text: I18nText }[] = [];
  if (props.changedOnServer) {
    list.push({
      id: "editor-draft-changed-on-server",
      text: props.serverDraftItem
        ? t("common.editorDraft.changedOnServerInBrowser", { entity })
        : t("common.editorDraft.changedOnServer", { entity }),
    });
  }
  if (props.credentialsNotSaved) {
    list.push({ id: "editor-draft-credentials-not-saved", text: credentialsNote.value });
  }
  return list;
});

const onOpenChange = (value: boolean) => {
  if (!value) emit("dismiss");
};
</script>
