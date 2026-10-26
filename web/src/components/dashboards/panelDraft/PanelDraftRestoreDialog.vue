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
    :title="t('dashboard.panelDraft.restoreTitle')"
    :primary-button-label="t('dashboard.panelDraft.continueDraft')"
    primary-button-data-test="dashboard-panel-draft-continue"
    :secondary-button-label="t('dashboard.panelDraft.startFresh')"
    data-test="dashboard-panel-draft-restore-dialog"
    @update:open="onOpenChange"
    @click:primary="emit('continue')"
    @click:secondary="emit('fresh')"
  >
    <div class="flex flex-col gap-3">
      <p class="text-text-body text-sm" data-test="dashboard-panel-draft-restore-message">
        {{ t("dashboard.panelDraft.restoreMessage", { date: savedAtText }) }}
      </p>
      <OBanner
        v-if="changedOnServer"
        variant="warning"
        icon="warning"
        :content="t('dashboard.panelDraft.changedOnServer')"
        data-test="dashboard-panel-draft-changed-on-server"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { formatPanelDraftTime } from "@/composables/dashboard/usePanelDraft";

const props = defineProps<{
  open: boolean;
  savedAt: number;
  changedOnServer?: boolean;
}>();

const emit = defineEmits<{
  continue: [];
  fresh: [];
  dismiss: [];
}>();

const { t, locale } = useI18nTyped();
const store = useStore();

const savedAtText = computed(() =>
  formatPanelDraftTime(props.savedAt, locale.value, store.state.timezone || undefined),
);

const onOpenChange = (value: boolean) => {
  if (!value) emit("dismiss");
};
</script>
