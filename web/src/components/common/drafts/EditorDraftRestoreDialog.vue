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
    :primary-button-label="t('common.editorDraft.continueDraft')"
    primary-button-data-test="editor-draft-continue"
    :secondary-button-label="t('common.editorDraft.startFresh')"
    data-test="editor-draft-restore-dialog"
    @update:open="onOpenChange"
    @click:primary="emit('continue')"
    @click:secondary="emit('fresh')"
  >
    <div class="flex flex-col gap-3">
      <p class="text-text-body text-sm" data-test="editor-draft-restore-message">
        {{ t("common.editorDraft.restoreMessage", { entity: entityLabel, date: savedAtText }) }}
      </p>
      <OBanner
        v-if="changedOnServer"
        variant="warning"
        icon="warning"
        :content="t('common.editorDraft.changedOnServer', { entity: entityLabel })"
        data-test="editor-draft-changed-on-server"
      />
      <OBanner
        v-if="credentialsNotSaved"
        variant="info"
        icon="info"
        :content="credentialsNote"
        data-test="editor-draft-credentials-not-saved"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { formatEditorDraftTime } from "@/utils/drafts/editorDraftStore";

const props = defineProps<{
  open: boolean;
  savedAt: number;
  entityLabel: I18nText;
  title?: I18nText;
  changedOnServer?: boolean;
  credentialsNotSaved?: boolean;
  notKeptFields?: I18nText[];
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
  if (!fields.length) return t("common.editorDraft.credentialsNotSaved");
  const list = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(fields);
  return t("common.editorDraft.changesNotKept", { fields: list }, fields.length);
});

const onOpenChange = (value: boolean) => {
  if (!value) emit("dismiss");
};
</script>
