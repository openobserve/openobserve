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
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import ExtensionSetupChecklist from "@/components/synthetics/ExtensionSetupChecklist.vue";
import { CHROME_UI_LABELS } from "@/constants/synthetics";

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

// Session-only on purpose: persisting the attestations would keep tasks
// pre-completed after the extension is removed. They survive dialog re-opens
// (component-lifetime refs) but reset with the page — after a reload, the
// install task re-completes itself through live detection anyway.
const installAck = ref(false);
const incognitoDone = ref(false);

const installDone = computed(() => Boolean(props.connected) || installAck.value);
const allDone = computed(() => Boolean(props.connected) && incognitoDone.value);
const doneCount = computed(
  () =>
    [installDone.value, installDone.value && incognitoDone.value, allDone.value].filter(Boolean)
      .length,
);

const actionLabel = computed(() =>
  props.action === "record" ? t("synthetics.journey.record") : t("synthetics.journey.replay"),
);
const primaryLabel = computed(() =>
  allDone.value
    ? actionLabel.value
    : t("synthetics.createBrowserTest.setupCtaLocked", { action: actionLabel.value }),
);
const blockingHint = computed(() => {
  if (!installDone.value) return t("synthetics.createBrowserTest.setupHintInstall");
  if (!incognitoDone.value)
    return t("synthetics.createBrowserTest.setupHintIncognito", {
      setting: CHROME_UI_LABELS.allowIncognito,
    });
  if (!allDone.value)
    return t("synthetics.createBrowserTest.setupHintConnect", { action: actionLabel.value });
  return null;
});

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
    :sub-title="
      action === 'record'
        ? t('synthetics.createBrowserTest.setupSubtitleRecord')
        : t('synthetics.createBrowserTest.setupSubtitleReplay')
    "
    data-test="synthetics-journey-extension-setup-dialog"
    @update:open="emit('update:open', $event)"
  >
    <template #header-right>
      <OBadge variant="default-soft" data-test="synthetics-setup-progress">
        {{ t("synthetics.createBrowserTest.setupProgress", { done: doneCount, total: 3 }) }}
      </OBadge>
    </template>

    <ExtensionSetupChecklist
      v-model:install-ack="installAck"
      v-model:incognito-done="incognitoDone"
      :connected="connected"
    />

    <template #footer>
      <div class="flex w-full flex-col items-stretch gap-3">
        <OButton
          variant="primary"
          size="lg"
          class="w-full"
          :disabled="!allDone"
          :icon-left="action === 'record' ? 'smart-display' : 'replay'"
          data-test="synthetics-setup-continue-btn"
          @click="onContinue"
        >
          {{ primaryLabel }}
        </OButton>
        <p v-if="blockingHint" class="text-text-secondary m-0 text-center text-xs">
          {{ blockingHint }}
        </p>
        <div v-if="action === 'record'" class="text-center">
          <OButton
            variant="ghost"
            size="sm"
            class="text-text-link underline"
            data-test="synthetics-setup-dialog-skip"
            @click="emit('update:open', false)"
          >
            {{ t("synthetics.createBrowserTest.setupSkip") }}
          </OButton>
        </div>
      </div>
    </template>
  </ODialog>
</template>
