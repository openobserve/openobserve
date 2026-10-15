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

<template>
  <OContent v-if="newDrafts.length" class="pt-3">
    <OBanner
      variant="info"
      icon="edit-note"
      dense
      inline-actions
      data-test="dashboard-empty-tab-drafts-hint"
    >
      {{ t("panelDraft.emptyTabHint", { count: newDrafts.length }, newDrafts.length) }}
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          data-test="dashboard-empty-tab-drafts-continue"
          @click="drafts?.open(newDrafts[0])"
          >{{ t("panelDraft.continue") }}</OButton
        >
      </template>
    </OBanner>
  </OContent>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { PANEL_DRAFTS_KEY } from "@/composables/dashboard/usePanelDraft";

const props = defineProps<{ tabId: string | null | undefined }>();

const { t } = useI18nTyped();
const drafts = inject(PANEL_DRAFTS_KEY, null);

// Unsaved new panels are otherwise invisible on an empty tab, which is exactly where the user looks for them.
const newDrafts = computed(() =>
  (drafts?.entries.value ?? [])
    .filter((entry) => entry.status === "new" && entry.tabId === props.tabId)
    .sort((a, b) => b.record.updatedAt - a.record.updatedAt),
);
</script>
