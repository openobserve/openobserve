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
  <ODialog
    :open="open"
    size="xs"
    :title="t('alerts.incidents.rcaRun.cancelConfirmTitle')"
    :show-close="false"
    :secondary-button-label="t('alerts.incidents.rcaRun.keepRunning')"
    :primary-button-label="t('alerts.incidents.rcaRun.cancelRun')"
    primary-button-variant="destructive"
    primary-button-data-test="rca-cancel-confirm-btn"
    :primary-button-loading="cancelling"
    initial-focus="secondary"
    data-test="rca-cancel-dialog"
    @update:open="(value) => !value && emit('update:open', false)"
    @click:secondary="emit('update:open', false)"
    @click:primary="confirm"
  >
    <OText as="p" class="break-words" data-test="rca-cancel-dialog-body">{{
      t("alerts.incidents.rcaRun.cancelConfirmBody", { number: incidentNumber })
    }}</OText>
  </ODialog>
</template>

<script setup lang="ts">
import { nextTick, watch } from "vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** How the incident is named after "#". */
    incidentNumber: string;
    cancelling?: boolean;
  }>(),
  { cancelling: false },
);

const emit = defineEmits<{ "update:open": [open: boolean]; confirm: [] }>();

const { t } = useI18nTyped();

// The dialog shows the cancel's progress and closes once the request settles.
const confirm = async () => {
  emit("confirm");
  await nextTick();
  if (!props.cancelling) emit("update:open", false);
};

watch(
  () => props.cancelling,
  (now, was) => {
    if (was && !now && props.open) emit("update:open", false);
  },
);
</script>
