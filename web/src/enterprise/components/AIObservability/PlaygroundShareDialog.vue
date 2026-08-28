<!-- Copyright 2026 OpenObserve Inc.

  What sharing the bench means, said once before the first link is created.

  A snapshot is a copy, not a live document: someone who expects their next edit
  to reach the person they sent it to has been misled by the word "share". The
  checkbox retires this dialog, after which Share creates the link and copies it
  with nothing in the way.
-->
<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('aiObservability.playground.shareTitle')"
    :primary-button-label="t('aiObservability.playground.shareCreate')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-loading="creating"
    data-test="ai-playground-share-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="emit('confirm', skipIntro)"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-3">
      <p class="m-0 text-sm leading-relaxed">
        {{ t("aiObservability.playground.shareBody") }}
      </p>
      <p class="text-text-secondary m-0 text-xs leading-relaxed">
        {{ t("aiObservability.playground.shareFork") }}
      </p>
      <OCheckbox
        v-model="skipIntro"
        :label="t('aiObservability.playground.shareDontAsk')"
        data-test="ai-playground-share-skip"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";

const props = defineProps<{
  open: boolean;
  /** The snapshot is being created and the link copied. */
  creating: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  /** Create and copy. Carries whether to stop asking from now on. */
  confirm: [skipIntro: boolean];
}>();

const { t } = useI18nTyped();

const skipIntro = ref(false);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) skipIntro.value = false;
  },
);
</script>
