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
  <template v-if="drafts">
    <OBadge
      v-if="count > 0"
      clickable
      variant="primary-soft"
      size="md"
      icon="edit-note"
      class="shrink-0"
      data-test="dashboard-drafts-chip"
      @click="open = true"
    >
      <span class="inline-flex items-center">{{ t("panelDraft.count", { count }, count) }}</span>
      <OTooltip :content="t('panelDraft.countTooltip')" side="bottom" />
    </OBadge>
    <ODrawer
      v-model:open="open"
      size="sm"
      :title="t('panelDraft.trayTitle')"
      :sub-title="t('panelDraft.traySubtitle')"
      data-test="dashboard-drafts-drawer"
    >
      <OEmptyState
        v-if="count === 0"
        size="compact"
        icon="edit-note"
        :title="t('panelDraft.emptyTitle')"
        :description="t('panelDraft.emptyMessage')"
        data-test="dashboard-drafts-empty"
      />
      <ul v-else class="flex flex-col gap-2" data-test="dashboard-drafts-list">
        <li
          v-for="entry in sortedEntries"
          :key="entry.record.key"
          class="border-border-default rounded-default flex items-center gap-3 border p-3"
          :data-test="`dashboard-drafts-item-${entry.record.panelId ?? entry.record.draftId}`"
        >
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <OTruncatedText
              as="div"
              class="text-text-heading text-sm font-medium"
              data-test="dashboard-drafts-item-name"
            >
              {{ entry.record.data?.title || t("panelDraft.untitled") }}
            </OTruncatedText>
            <div class="text-text-secondary flex flex-wrap items-center gap-1.5 text-xs">
              <OBadge
                :variant="kindVariant(entry.status)"
                size="xs"
                :icon="
                  entry.status === 'stale' || entry.status === 'deleted' ? 'warning' : undefined
                "
                data-test="dashboard-drafts-item-kind"
                >{{ kindLabel(entry.status) }}</OBadge
              >
              <OBadge variant="default-outline" size="xs" data-test="dashboard-drafts-item-tab">{{
                tabName(entry.tabId)
              }}</OBadge>
              <span data-test="dashboard-drafts-item-time">{{
                formatPanelDraftTime(entry.record.updatedAt, locale, now, t("panelDraft.justNow"))
                  .relative
              }}</span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <OButton
              variant="outline"
              size="xs"
              data-test="dashboard-drafts-item-continue"
              @click="continueDraft(entry)"
              >{{ t("panelDraft.continue") }}</OButton
            >
            <OButton
              variant="ghost-destructive"
              size="icon-sm"
              icon-left="delete"
              :aria-label="t('panelDraft.delete')"
              data-test="dashboard-drafts-item-delete"
              @click="askDelete(entry)"
            >
              <OTooltip :content="t('panelDraft.delete')" side="left" />
            </OButton>
          </div>
        </li>
      </ul>
    </ODrawer>
    <ConfirmDialog
      v-model="deleteDialogOpen"
      :title="t('panelDraft.deleteConfirmTitle')"
      :message="
        t('panelDraft.deleteConfirmMessage', {
          name: pendingDelete?.record.data?.title || t('panelDraft.untitled'),
        })
      "
      :ok-label="t('panelDraft.delete')"
      ok-variant="destructive"
      focus-cancel
      data-test="dashboard-drafts-delete-confirm"
      @update:ok="confirmDelete"
    />
  </template>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import {
  PANEL_DRAFTS_KEY,
  formatPanelDraftTime,
  type PanelDraftEntry,
  type PanelDraftStatus,
} from "@/composables/dashboard/usePanelDraft";

const props = defineProps<{ tabs: Array<{ tabId: string; name?: string }> }>();

const { t, locale } = useI18nTyped();
const drafts = inject(PANEL_DRAFTS_KEY, null);
const open = ref(false);
const pendingDelete = ref<PanelDraftEntry | null>(null);
const deleteDialogOpen = ref(false);
const askDelete = (entry: PanelDraftEntry) => {
  pendingDelete.value = entry;
  deleteDialogOpen.value = true;
};
const now = ref(Date.now());
const clock = setInterval(() => {
  now.value = Date.now();
}, 30_000);
onBeforeUnmount(() => clearInterval(clock));

const count = computed(() => drafts?.entries.value.length ?? 0);
const sortedEntries = computed(() =>
  [...(drafts?.entries.value ?? [])].sort((a, b) => b.record.updatedAt - a.record.updatedAt),
);

const tabName = (tabId: string) =>
  raw(props.tabs.find((tab) => tab.tabId === tabId)?.name ?? tabId);

const kindVariant = (status: PanelDraftStatus): BadgeVariant => {
  if (status === "new") return "success-soft";
  if (status === "edited") return "primary-soft";
  return "warning-soft";
};

const kindLabel = (status: PanelDraftStatus) => {
  if (status === "new") return t("panelDraft.kindNew");
  if (status === "stale") return t("panelDraft.kindStale");
  if (status === "deleted") return t("panelDraft.kindDeleted");
  return t("panelDraft.kindEdited");
};

const confirmDelete = async () => {
  const entry = pendingDelete.value;
  pendingDelete.value = null;
  if (entry) await drafts?.remove(entry);
};

const continueDraft = (entry: PanelDraftEntry) => {
  open.value = false;
  drafts?.open(entry);
};
</script>
