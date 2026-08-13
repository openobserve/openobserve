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

<!--
  Hosts the one alert-creation confirm dialog, mounted at the app root beside
  ConfirmDialogProvider.

  It lives here rather than inside CreateAlertAction because most entry points
  are dropdown items: reka-ui unmounts a dropdown's content as soon as an item
  is selected, so a dialog owned by the action was destroyed in the same tick it
  appeared — it flashed open and vanished. Mounted at the root, the dialog
  outlives whatever triggered it.
-->

<template>
  <CreateAlertFromSourceDialog
    v-if="dialog"
    :open="dialog.open"
    :prefill="dialog.prefill"
    @update:open="onOpenChange"
    @confirm="onConfirm"
    @rebuild="rebuildAlertPrefill"
    @cancel="closeAlertCreationDialog"
  />
</template>

<script setup lang="ts">
import CreateAlertFromSourceDialog from "@/components/alerts/CreateAlertFromSourceDialog.vue";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import {
  alertCreationDialog as dialog,
  closeAlertCreationDialog,
  rebuildAlertPrefill,
  useAlertCreation,
} from "@/composables/alerts/useAlertCreation";

const { openAlertCreation } = useAlertCreation();

const onConfirm = (prefill: AlertPrefill) => {
  openAlertCreation(prefill, dialog.value?.options ?? {});
  closeAlertCreationDialog();
};

const onOpenChange = (open: boolean) => {
  if (!open) closeAlertCreationDialog();
};
</script>
