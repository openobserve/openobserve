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
import { computed, onBeforeUnmount, ref, watch } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import type { FileRejection, FileValidator, FileValue } from "@/lib/forms/File/OFile.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

type TestIds = {
  card: string;
  image: string;
  preview: string;
  file: string;

  remove: string;
  status: string;
};

const props = withDefaults(
  defineProps<{
    title: I18nText;
    description?: I18nText;
    /** Accessible name when the visible title is short ("Light mode"). */
    ariaLabel?: I18nText;
    /** The background the logo is shown on: a light header, a dark header, or neither. */
    surface?: "light" | "dark";
    icon?: IconName;
    /** URL of the logo already set (saved, or held by the page), or null. */
    currentSrc: string | null;
    /** A newly picked file that is not saved yet. */
    modelValue?: File | null;
    accept?: string;
    removeLabel?: I18nText;
    /** Show the Saved / Not saved tag; off where the page tracks saving itself. */
    showStatus?: boolean;
    locked?: boolean;
    /** Takes no picks or drops, e.g. while the feature is locked. */
    disabled?: boolean;
    disabledReason?: I18nText;
    dataTest: string;
    testIds?: Partial<TestIds>;
  }>(),
  {
    description: undefined,
    ariaLabel: undefined,
    surface: "light",
    icon: undefined,
    modelValue: null,
    accept: ".png, .jpg, .jpeg, .gif, .bmp, .webp, .svg",
    removeLabel: undefined,
    showStatus: true,
    locked: false,
    disabled: false,
    disabledReason: undefined,
    testIds: () => ({}),
  },
);

const emit = defineEmits<{
  (_e: "update:modelValue", _value: File | null): void;
  (_e: "remove"): void;
  (_e: "rejected", _rejections: FileRejection[]): void;
}>();

const { t } = useI18nTyped();

const ids = computed<TestIds>(() => ({
  card: `${props.dataTest}_card`,
  image: props.dataTest,
  preview: `${props.dataTest}_preview`,
  file: `${props.dataTest}_file_upload`,
  remove: `${props.dataTest}_delete_btn`,
  status: `${props.dataTest}_status`,
  ...props.testIds,
}));

const pickedUrl = ref<string | null>(null);
watch(
  () => props.modelValue,
  (file) => {
    if (pickedUrl.value) URL.revokeObjectURL(pickedUrl.value);
    pickedUrl.value = file ? URL.createObjectURL(file) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (pickedUrl.value) URL.revokeObjectURL(pickedUrl.value);
});

const previewSrc = computed(() => pickedUrl.value ?? props.currentSrc);

const size = ref<{ width: number; height: number } | null>(null);
watch(previewSrc, () => (size.value = null));
function onPreviewLoad(event: Event) {
  const img = event.target as HTMLImageElement;
  size.value = { width: img.naturalWidth, height: img.naturalHeight };
}

const details = computed<I18nText | null>(() => {
  const dims = size.value ? t("settings.general.logoDimensions", size.value) : null;
  if (!props.modelValue) return dims;
  return dims ? raw(`${props.modelValue.name} · ${dims}`) : raw(props.modelValue.name);
});

// The type check trusts the file name, so a renamed non-image would otherwise reach the preview broken.
function decodesAsImage(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(true);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

const validateImage: FileValidator = async (file) =>
  (await decodesAsImage(file)) ? null : t("components.file.invalidImage");

function onPicked(value: FileValue) {
  emit("update:modelValue", value instanceof File ? value : null);
}

// A pick that is not saved yet is only dropped; anything already set is the page's to remove.
function onRemove() {
  if (props.modelValue) emit("update:modelValue", null);
  else emit("remove");
}
</script>

<template>
  <div
    class="border-border-default rounded-surface flex min-w-0 flex-col gap-3 border p-3"
    :data-test="ids.card"
  >
    <div class="flex items-start gap-2">
      <OIcon v-if="icon" :name="icon" size="sm" class="text-text-secondary mt-0.5" />
      <div class="min-w-0 flex-1">
        <div class="text-text-heading flex items-center gap-1.5 text-sm font-medium">
          {{ title }}
          <OIcon
            v-if="locked"
            name="lock"
            size="xs"
            class="lock-chip"
            aria-hidden="true"
            :data-test="`${dataTest}-lock`"
          />
        </div>
        <div v-if="description" class="text-text-secondary text-xs">{{ description }}</div>
      </div>
      <OBadge
        v-if="showStatus && previewSrc"
        :variant="modelValue ? 'warning-soft' : 'success-soft'"
        size="sm"
        :data-test="ids.status"
      >
        {{ modelValue ? t("settings.general.logoNotSaved") : t("settings.general.logoSaved") }}
      </OBadge>
    </div>

    <OFile
      v-show="!previewSrc"
      :model-value="modelValue"
      :aria-label="ariaLabel ?? title"
      :accept="accept"
      :disabled="disabled"
      :disabled-reason="disabledReason"
      :validate="validateImage"
      :data-test="ids.file"
      @update:model-value="onPicked"
      @rejected="emit('rejected', $event)"
    />

    <template v-if="previewSrc">
      <div
        :class="[
          'border-border-default rounded-surface flex min-h-19 items-center justify-center border p-3',
          surface === 'dark' ? 'bg-logo-preview-dark-bg' : 'bg-logo-preview-light-bg',
        ]"
        :data-test="ids.preview"
      >
        <img
          :src="previewSrc"
          :alt="ariaLabel ?? title"
          class="max-h-7.5 max-w-37.5 object-contain"
          :data-test="ids.image"
          @load="onPreviewLoad"
        />
      </div>
      <div v-if="!locked" class="flex min-w-0 flex-wrap items-center gap-2">
        <OTruncatedText class="text-text-secondary min-w-0 flex-1 text-xs">{{
          details
        }}</OTruncatedText>
        <OButton
          variant="ghost-destructive"
          size="sm"
          icon-left="delete"
          :data-test="ids.remove"
          @click="onRemove"
        >
          {{ removeLabel ?? t("common.remove") }}
        </OButton>
      </div>
    </template>
  </div>
</template>
