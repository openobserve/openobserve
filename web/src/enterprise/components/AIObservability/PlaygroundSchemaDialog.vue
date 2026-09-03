<!-- Copyright 2026 OpenObserve Inc.

  Structured output for one variant. The toggle and the schema are one decision:
  turning it off keeps the text you wrote, so flipping back does not cost you
  the schema.

  A provider that cannot carry a schema still gets the full dialog rather than a
  disabled one — the variant keeps the schema either way, and swapping the model
  is what makes it live. The banner says so instead.
-->
<template>
  <ODialog
    :open="open"
    size="md"
    :title="t('aiObservability.playground.schemaTitle')"
    :primary-button-label="t('common.apply')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-disabled="enabled && invalid"
    data-test="ai-playground-schema-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="apply"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-3">
      <!-- Read before the schema is written rather than after an answer comes
           back as prose: the request drops it with nothing else to say so. -->
      <OBanner v-if="dropped" variant="warning" data-test="ai-playground-schema-unsupported">
        {{ t("aiObservability.playground.schemaUnsupported") }}
      </OBanner>
      <OCheckbox
        v-model="enabled"
        :label="t('aiObservability.playground.schemaToggle')"
        data-test="ai-playground-schema-toggle"
      />
      <OTextarea
        v-model="text"
        :rows="12"
        size="sm"
        fill
        :disabled="!enabled"
        :error="enabled && invalid"
        :error-message="t('aiObservability.playground.schemaInvalidJson')"
        :help-text="t('aiObservability.playground.schemaHelp')"
        data-test="ai-playground-schema-input"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";

const props = defineProps<{
  open: boolean;
  schema: string | null;
  /** The selected provider has no field to carry a schema, so one set here is
   *  kept on the variant and left out of the request. */
  dropped?: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  apply: [schema: string | null];
}>();

const { t } = useI18nTyped();

const DEFAULT_SCHEMA = `{
  "type": "object",
  "properties": {
    "answer": { "type": "string" },
    "grounded": { "type": "boolean" },
    "citations": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["answer", "grounded"]
}`;

const enabled = ref(false);
const text = ref(DEFAULT_SCHEMA);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    enabled.value = props.schema !== null;
    text.value = props.schema ?? DEFAULT_SCHEMA;
  },
  { immediate: true },
);

const invalid = computed(() => {
  try {
    JSON.parse(text.value);
    return false;
  } catch {
    return true;
  }
});

function apply() {
  emit("apply", enabled.value ? text.value : null);
  emit("update:open", false);
}
</script>
