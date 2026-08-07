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
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ExtensionSetupChecklist from "@/components/synthetics/ExtensionSetupChecklist.vue";

const props = defineProps<{
  open: boolean;
  /** Extension detected and connectable — flips live when the toolbar icon is clicked. */
  connected?: boolean;
  /** Which action resumes on the primary button — drives its label. */
  action: "record" | "replay";
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  /** The extension is connected and the author chose to proceed with `action`. */
  continue: [];
}>();

const { t } = useI18nTyped();

// Persists across opens on purpose: the incognito toggle survives a dismissed
// dialog, so re-opening does not ask the author to confirm the same step twice.
const incognitoDone = ref(false);

const primaryLabel = computed(() =>
  props.action === "record" ? t("synthetics.journey.record") : t("synthetics.journey.replay"),
);

function onContinue() {
  emit("continue");
  emit("update:open", false);
}
</script>

<template>
  <ODialog
    :open="open"
    size="md"
    :title="t('synthetics.createBrowserTest.setupRecorder')"
    :primary-button-label="primaryLabel"
    :primary-button-disabled="!connected || !incognitoDone"
    :secondary-button-label="t('common.cancel')"
    data-test="synthetics-journey-extension-setup-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="onContinue"
    @click:secondary="emit('update:open', false)"
  >
    <p class="text-text-secondary m-0 mb-4 text-sm">
      {{ t("synthetics.journey.extensionDialogDescription") }}
    </p>
    <ExtensionSetupChecklist v-model:incognito-done="incognitoDone" :connected="connected" />
  </ODialog>
</template>
