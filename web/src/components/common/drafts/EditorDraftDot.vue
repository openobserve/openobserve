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
  <!-- A button's children are presentational, so the corner dot's meaning lives in the button's own name. -->
  <span
    v-if="corner"
    class="bg-button-pending-bg ring-button-pending-bg/30 pointer-events-none absolute -end-1 -top-1 size-2.5 rounded-full ring-4"
    aria-hidden="true"
    :data-test="dataTest"
  />
  <OTooltip v-else :content="label" side="right">
    <span
      role="img"
      :aria-label="label"
      class="bg-button-pending-bg ring-button-pending-bg/30 inline-block size-2 shrink-0 rounded-full ring-2"
      :data-test="dataTest"
    />
  </OTooltip>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { formatEditorDraftTime } from "@/utils/drafts/editorDraftStore";

const props = withDefaults(
  defineProps<{
    /** When the row's draft was written; the inline dot's tooltip shows it. */
    savedAt?: number | null;
    /** Pins the dot to the top-end corner of a positioned parent such as an OButton. */
    corner?: boolean;
    dataTest?: string;
  }>(),
  { savedAt: null, corner: false, dataTest: "editor-draft-dot" },
);

const { t, locale } = useI18nTyped();
const store = useStore();

const label = computed(() =>
  t("common.editorDraft.rowDot", {
    date:
      props.savedAt === null
        ? ""
        : formatEditorDraftTime(props.savedAt, locale.value, store.state.timezone || undefined),
  }),
);
</script>
