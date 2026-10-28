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
  <EditorDraftRestoreDialog
    :open="draft.state.restoreOpen"
    :saved-at="draft.state.restoreSavedAt"
    :entity-label="draft.state.entityLabel"
    :title="draft.state.restoreTitle"
    :changed-on-server="draft.state.changedOnServer"
    :credentials-not-saved="draft.state.credentialsNotSaved"
    :not-kept-fields="draft.state.notKeptFields"
    :note="draft.state.restoreNote"
    :server-draft-item="draft.state.serverDraftItem"
    @continue="draft.chooseRestore('continue')"
    @fresh="draft.chooseRestore('fresh')"
    @dismiss="draft.chooseRestore('dismiss')"
  />
  <EditorDraftLeaveDialog
    :open="draft.state.leaveOpen"
    :entity-label="draft.state.entityLabel"
    :saving="draft.state.leaveSaving"
    :can-keep-draft="draft.state.canKeepDraft"
    :signing-out="draft.state.signingOut"
    :can-save="draft.state.canSave"
    :server-draft-item="draft.state.serverDraftItem"
    :save-label="draft.state.saveLabel"
    @choose="draft.chooseLeave"
  />
</template>

<script setup lang="ts">
import type { EditorDraftController } from "@/composables/useEditorDraft";
import EditorDraftRestoreDialog from "./EditorDraftRestoreDialog.vue";
import EditorDraftLeaveDialog from "./EditorDraftLeaveDialog.vue";

defineProps<{
  draft: EditorDraftController;
}>();
</script>
