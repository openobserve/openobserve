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

<!-- The drawer's content remounts on every open, so the draft and its dialogs live here: one draft session per open, its dialogs inside the drawer's focus layer. -->
<template>
  <div class="contents" data-test="dashboard-settings-draft-scope">
    <slot />
    <EditorDraftDialogs :draft="draft" />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useEditorDraft, type UseEditorDraftOptions } from "@/composables/useEditorDraft";
import EditorDraftDialogs from "@/components/common/drafts/EditorDraftDialogs.vue";
import type { DashboardSettingsDraft } from "./dashboardSettingsDraft";

const props = defineProps<{
  options: UseEditorDraftOptions<DashboardSettingsDraft>;
  /** Loads what `base` reads; resolves false when there is no dashboard to draft. */
  beforeStart: () => Promise<boolean>;
}>();

const draft = useEditorDraft(props.options);

onMounted(async () => {
  if (await props.beforeStart()) await draft.start();
});

defineExpose({ draft });
</script>
