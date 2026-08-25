<!-- Copyright 2026 OpenObserve Inc.

  One hand-written row. Expected output stays collapsed: most rows added by hand
  are a quick "what does it say to this?", and a field for the golden answer
  implies you were supposed to have one.
-->
<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('aiObservability.playground.addRowTitle')"
    :primary-button-label="t('aiObservability.playground.addRow')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-disabled="!input.trim()"
    data-test="ai-playground-add-row-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="submit"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-3">
      <OTextarea
        v-model="input"
        :label="t('aiObservability.playground.addRowInput')"
        :placeholder="t('aiObservability.playground.addRowInputPlaceholder')"
        :rows="4"
        size="sm"
        fill
        required
        data-test="ai-playground-add-row-input"
      />

      <OButton
        variant="ghost-primary"
        size="xs"
        class="self-start"
        data-test="ai-playground-add-row-toggle-expected"
        @click="showExpected = !showExpected"
      >
        {{
          showExpected
            ? t("aiObservability.playground.addRowHideExpected")
            : t("aiObservability.playground.addRowShowExpected")
        }}
      </OButton>

      <OTextarea
        v-if="showExpected"
        v-model="expected"
        :placeholder="t('aiObservability.playground.addRowExpectedPlaceholder')"
        :rows="3"
        size="sm"
        fill
        data-test="ai-playground-add-row-expected"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  add: [input: string, expectedOutput: string | null];
}>();

const { t } = useI18nTyped();

const input = ref("");
const expected = ref("");
const showExpected = ref(false);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    input.value = "";
    expected.value = "";
    showExpected.value = false;
  },
);

function submit() {
  const text = input.value.trim();
  if (!text) return;
  emit("add", text, expected.value.trim() || null);
  emit("update:open", false);
}
</script>
