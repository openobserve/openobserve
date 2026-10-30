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

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { AlertEditHeader } from "@/composables/alerts/useAlertEditHeader";
import { alertsToTerraform } from "@/utils/alerts/alertTerraform";
import { toast } from "@/lib/feedback/Toast/useToast";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ExportResourceDialog from "@/components/common/ExportResourceDialog.vue";

const props = defineProps<{
  header: AlertEditHeader;
  name: string;
  folderId?: string;
  /** Renders only the Fire now button, or only the More menu; header slots place them apart. */
  part: "fire" | "more";
  /** Below lg the header has no room for the inline actions, so the More menu carries Fire now too. */
  compact?: boolean;
}>();

const emit = defineEmits<{ (e: "edit-json"): void }>();

const { t } = useI18nTyped();

const confirmFire = async () => {
  props.header.setFireOpen(false);
  await props.header.fireNow();
};

const cloneOpen = ref(false);
const cloneName = ref("");
const cloning = ref(false);
const openClone = () => {
  cloneName.value = t("alerts.editMode.cloneDefaultName", { name: raw(props.name) });
  cloneOpen.value = true;
};
const submitClone = async () => {
  const name = cloneName.value.trim();
  if (!name) return;
  cloning.value = true;
  try {
    if (await props.header.clone(name)) cloneOpen.value = false;
  } finally {
    cloning.value = false;
  }
};

const exportOpen = ref(false);
const exportItems = ref<Record<string, unknown>[]>([]);
const exportTerraform = computed(() =>
  alertsToTerraform(exportItems.value, { folderId: props.folderId ?? "default" }),
);
const openExport = async () => {
  const definition = await props.header.exportDefinition();
  if (!definition) return;
  exportItems.value = [definition];
  exportOpen.value = true;
};
const onExported = ({ count }: { count: number }) =>
  toast({
    variant: "success",
    message: t("toastMessages.alerts.successfullyExportedAlert", { count }, count),
  });
</script>

<template>
  <template v-if="part === 'fire'">
    <OButton
      variant="outline"
      size="sm-action"
      icon-left="play-arrow"
      :disabled="header.pending.value"
      data-test="add-alert-fire-now-btn"
      @click="header.setFireOpen(true)"
      >{{ t("alerts.editMode.fireNow") }}</OButton
    >
  </template>

  <template v-else>
    <ODropdown align="end">
      <template #trigger>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="more-horiz"
          data-test="add-alert-more-btn"
          >{{ t("alerts.editMode.more") }}</OButton
        >
      </template>
      <template v-if="compact">
        <ODropdownItem
          icon-left="play-arrow"
          :disabled="header.pending.value"
          data-test="add-alert-more-fire-now"
          @select="header.setFireOpen(true)"
        >
          {{ t("alerts.editMode.fireNow") }}
        </ODropdownItem>
        <slot name="menu-start" />
        <ODropdownSeparator />
      </template>
      <ODropdownItem
        :icon-left="header.enabled.value ? 'pause' : 'play-arrow'"
        data-test="add-alert-more-toggle-enabled"
        @select="header.toggleEnabled()"
      >
        {{ header.enabled.value ? t("alerts.editMode.disable") : t("alerts.editMode.enable") }}
      </ODropdownItem>
      <ODropdownItem icon-left="content-copy" data-test="add-alert-more-clone" @select="openClone">
        {{ t("alerts.editMode.clone") }}
      </ODropdownItem>
      <ODropdownItem icon-left="download" data-test="add-alert-more-export" @select="openExport">
        {{ t("common.export") }}
      </ODropdownItem>
      <ODropdownSeparator />
      <ODropdownItem
        icon-left="data-object"
        data-test="add-alert-more-edit-json"
        @select="emit('edit-json')"
      >
        {{ t("alerts.editJson") }}
      </ODropdownItem>
    </ODropdown>

    <ODialog
      :open="header.fireOpen.value"
      @update:open="header.setFireOpen"
      size="sm"
      :title="t('alerts.editMode.fireTitle')"
      :secondary-button-label="t('alerts.cancel')"
      :primary-button-label="t('alerts.editMode.fireConfirm')"
      primary-button-data-test="add-alert-fire-now-confirm"
      data-test="add-alert-fire-now-dialog"
      @click:secondary="header.setFireOpen(false)"
      @click:primary="confirmFire"
    >
      <p class="text-text-body m-0 text-sm">
        {{ t("alerts.editMode.fireBody", { name: raw(name) }) }}
      </p>
    </ODialog>

    <ODialog
      v-model:open="cloneOpen"
      persistent
      size="sm"
      :title="t('alerts.cloneTitle')"
      :secondary-button-label="t('alerts.cancel')"
      :primary-button-label="t('alerts.editMode.clone')"
      :primary-button-disabled="cloning || !cloneName.trim()"
      :primary-button-loading="cloning"
      primary-button-data-test="add-alert-clone-confirm"
      data-test="add-alert-clone-dialog"
      @click:secondary="cloneOpen = false"
      @click:primary="submitClone"
    >
      <OInput
        v-model="cloneName"
        :label="t('alerts.editMode.cloneName')"
        data-test="add-alert-clone-name"
      />
    </ODialog>

    <ExportResourceDialog
      v-model:open="exportOpen"
      :items="exportItems"
      :terraform="exportTerraform"
      :title="t('alerts.exportDialogTitle', { count: 1 }, 1)"
      :sub-title="t('alerts.exportDialogSubtitle')"
      file-prefix="alerts"
      data-test="add-alert-export-dialog"
      @download="onExported"
    />
  </template>
</template>
