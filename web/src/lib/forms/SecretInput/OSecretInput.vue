<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { computed, nextTick, ref, useId, watch } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

import type { SecretInputEmits, SecretInputProps } from "./OSecretInput.types";

const props = withDefaults(defineProps<SecretInputProps>(), {
  required: false,
  disabled: false,
  error: false,
  errorMessage: undefined,
});
const emit = defineEmits<SecretInputEmits>();

const id = useId();
const labelId = `${id}-label`;
const inputId = `${id}-input`;
const unchangedId = `${id}-unchanged`;
const willReplaceId = `${id}-will-replace`;

const input = ref<InstanceType<typeof OInput> | null>(null);
const replaceButton = ref<InstanceType<typeof OButton> | null>(null);
const revealed = ref(false);

// An empty replacement keeps the stored secret, so only a typed value will replace it.
const willReplace = computed(() => props.state === "replacing" && !!props.modelValue);

const describedBy = computed(() => {
  const ids: string[] = [];
  if (willReplace.value) ids.push(willReplaceId);
  if (props.error && props.errorMessage) ids.push(`${inputId}-error`);
  return ids.length ? ids.join(" ") : undefined;
});

// A revealed value must not survive the field closing or reopening.
watch(
  () => props.state,
  () => {
    revealed.value = false;
  },
);

async function replace() {
  emit("update:state", "replacing");
  await nextTick();
  input.value?.focus();
}

async function keep() {
  emit("update:state", "unchanged");
  emit("update:modelValue", null);
  await nextTick();
  (replaceButton.value?.$el as HTMLElement | undefined)?.focus();
}

function onInput(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  emit("update:modelValue", text === "" && props.state === "replacing" ? null : text);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.isComposing || props.state !== "replacing") return;
  event.stopPropagation();
  void keep();
}
</script>

<template>
  <div :data-test="dataTest" :data-state="state" class="flex flex-col gap-1">
    <template v-if="state === 'unchanged'">
      <span
        :id="labelId"
        :class="[
          'text-compact leading-tight',
          disabled
            ? 'text-input-label-text-disabled font-normal'
            : 'text-input-label-text font-medium',
        ]"
        >{{ label }}</span
      >
      <div role="group" :aria-labelledby="labelId" class="flex flex-wrap items-center gap-2">
        <OTag
          :id="unchangedId"
          variant="default-soft"
          :label="unchangedLabel"
          :data-test="`${dataTest}-unchanged`"
        />
        <OButton
          ref="replaceButton"
          variant="outline"
          size="sm"
          :disabled="disabled"
          :aria-describedby="unchangedId"
          :data-test="`${dataTest}-replace`"
          @click="replace"
          >{{ replaceLabel }}</OButton
        >
      </div>
    </template>
    <div v-else class="flex flex-col gap-1" @keydown="onKeydown">
      <OInput
        :id="inputId"
        ref="input"
        :model-value="modelValue ?? ''"
        :type="revealed ? 'text' : 'password'"
        :label="label"
        :required="required"
        :disabled="disabled"
        :error="error"
        :error-message="errorMessage"
        autocomplete="new-password"
        :data-test="`${dataTest}-input`"
        :input-attrs="{
          'aria-describedby': describedBy,
          spellcheck: 'false',
          autocapitalize: 'off',
          autocorrect: 'off',
        }"
        @update:model-value="onInput"
        @blur="emit('blur')"
      >
        <template #icon-right>
          <OButton
            variant="ghost"
            size="icon-sm"
            :icon-left="revealed ? 'visibility-off' : 'visibility'"
            :aria-label="revealed ? hideLabel : showLabel"
            :disabled="disabled"
            :data-test="`${dataTest}-visibility`"
            @click="revealed = !revealed"
          />
        </template>
      </OInput>
      <div v-if="state === 'replacing'" class="flex flex-wrap items-center gap-2">
        <OTag
          v-if="willReplace"
          :id="willReplaceId"
          variant="default-soft"
          :label="willReplaceLabel"
          :data-test="`${dataTest}-will-replace`"
        />
        <OButton
          variant="ghost-primary"
          size="xs"
          :disabled="disabled"
          :data-test="`${dataTest}-keep`"
          @click="keep"
          >{{ keepLabel }}</OButton
        >
      </div>
    </div>
  </div>
</template>
