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
    :title="t('dashboard.panelDraft.leaveTitle')"
    :primary-button-label="canSave ? t('panel.save') : undefined"
    primary-button-data-test="dashboard-panel-leave-save"
    :primary-button-loading="saving"
    :secondary-button-label="secondaryLabel"
    :neutral-button-label="t('common.editorDraft.discard')"
    neutral-button-variant="ghost-destructive"
    data-test="dashboard-panel-leave-dialog"
    @update:open="onOpenChange"
    @click:primary="emit('choose', 'save')"
    @click:secondary="emit('choose', canKeepDraft ? 'keep' : 'stay')"
    @click:neutral="emit('choose', 'discard')"
  >
    <div class="flex items-start gap-1">
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <p class="text-text-body text-sm" data-test="dashboard-panel-leave-message">
          {{
            !canSave
              ? t("dashboard.panelDraft.leaveMessageDiscardOnly")
              : canKeepDraft
                ? t("dashboard.panelDraft.leaveMessage")
                : t("dashboard.panelDraft.leaveMessageNoDraft")
          }}
        </p>
        <p
          v-if="signingOut && otherDraftCount > 0"
          class="text-text-body text-sm"
          data-test="dashboard-panel-leave-sign-out-others"
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
        v-if="signingOut"
        :content="t('common.editorDraft.signOutDiscardsOthers', { count: 0 }, 0)"
        data-test="dashboard-panel-leave-sign-out"
      />
      <EditorDraftInfoHint
        v-else-if="canKeepDraft"
        :content="retention"
        data-test="dashboard-panel-leave-retention"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import EditorDraftInfoHint from "@/components/common/drafts/EditorDraftInfoHint.vue";
import type { PanelLeaveChoice } from "./panelDraft.types";
import { PANEL_DRAFT_MAX, PANEL_DRAFT_TTL_MS } from "@/composables/dashboard/usePanelDraft";

const props = withDefaults(
  defineProps<{
    open: boolean;
    saving?: boolean;
    canKeepDraft?: boolean;
    signingOut?: boolean;
    canSave?: boolean;
    /** While signing out, how many of the user's other drafts the sign-out discards. */
    otherDraftCount?: number;
  }>(),
  { canSave: true, otherDraftCount: 0 },
);

const emit = defineEmits<{
  choose: [choice: PanelLeaveChoice];
}>();

const { t } = useI18nTyped();

const retention = computed(() =>
  t("common.editorDraft.retention", {
    days: PANEL_DRAFT_TTL_MS / 86_400_000,
    max: PANEL_DRAFT_MAX,
  }),
);

// The discard-only copy offers to stay, so it carries a button for it.
const secondaryLabel = computed<I18nText | undefined>(() => {
  if (props.canKeepDraft) return t("dashboard.panelDraft.keepDraft");
  return props.canSave ? undefined : t("common.editorDraft.stay");
});

const onOpenChange = (value: boolean) => {
  if (!value) emit("choose", "stay");
};
</script>
