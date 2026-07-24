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
  SourceMapDropzone — the source-map ZIP dropzone as an OForm-bound field.

  This is a bespoke "OFormFile": OFormFile's built-in OFile dropzone can't keep
  the page's elaborate drop-area UI or its exact e2e `data-test`s
  (`rum-upload-source-maps-file-dropzone` / `-file-input`). So instead of using
  OFormFile, this component injects the same FORM_CONTEXT_KEY and binds the
  custom dropzone to the `file` field via `form.Field` — the value is fully
  form-owned and schema-validated, and the required / `.zip` errors surface
  INLINE (firstFieldError), not as a toast.
-->
<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <div>
        <div
          data-test="rum-upload-source-maps-file-dropzone"
          class="border-2 border-dashed border-card-glass-border rounded-default p-8 text-center cursor-pointer transition-all duration-300 bg-surface-base hover:border-theme-accent dark:border-[color-mix(in_srgb,var(--color-white)_10%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-theme-accent)_5%,transparent)]"
          :class="[
            isDragging ? 'border-theme-accent! bg-[color-mix(in_srgb,var(--color-theme-accent)_5%,transparent)]! border-solid! dark:bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)]!' : '',
            field.state.value ? 'p-6! text-left! border-solid! border-status-positive! bg-[color-mix(in_srgb,var(--color-status-positive)_2%,transparent)]! dark:bg-[color-mix(in_srgb,var(--color-status-positive)_5%,transparent)]!' : ''
          ]"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="(e) => onDrop(field, e)"
          @click="triggerFileInput"
        >
          <input
            ref="fileInputRef"
            data-test="rum-upload-source-maps-file-input"
            type="file"
            accept=".zip"
            class="hidden"
            @change="onFileInput(field, $event)"
          />

          <div v-if="!field.state.value" class="flex flex-col items-center justify-center">
            <OIcon name="backup" size="xl" class="mb-3" />
            <div class="text-xl font-semibold text-text-secondary mb-2">{{ t('rum.dropFileHere') }}</div>
            <div class="text-sm text-text-secondary mb-3">{{ t('rum.orClickToBrowse') }}</div>
            <div class="text-xs text-text-secondary">{{ t('rum.zipFilesOnly') }}</div>
          </div>

          <div v-else class="file-info">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <OIcon name="draft" size="lg" />
                <div>
                  <div class="text-sm font-medium font-medium">{{ field.state.value.name }}</div>
                  <div class="text-xs text-text-secondary">{{ formatFileSize(field.state.value.size) }}</div>
                </div>
              </div>
              <OButton
                variant="ghost"
                size="icon"
                icon-left="close"
                @click.stop="removeFile(field)"
              />
            </div>
          </div>
        </div>

        <div
          v-if="field.state.meta.errors.length > 0"
          data-test="rum-upload-source-maps-file-error"
          class="text-xs text-file-error-text mt-1"
        >
          {{ firstFieldError(field.state.meta.errors) }}
        </div>
      </div>
    </template>
  </component>
</template>

<script setup lang="ts">
import { inject, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = withDefaults(defineProps<{ name?: string }>(), { name: "file" });

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn(
    "[SourceMapDropzone] must be rendered inside <OForm>. No form context found.",
  );
}

const isDragging = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

const triggerFileInput = () => {
  fileInputRef.value?.click();
};

// The `.zip` rule is enforced by the schema (inline), not pre-filtered here —
// dropping/selecting any file sets it; an invalid type shows the inline error
// on submit (R3 timing).
const onFileInput = (field: any, event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0] ?? null;
  field.handleChange(file);
  field.handleBlur();
};

const onDrop = (field: any, event: DragEvent) => {
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0] ?? null;
  if (file) {
    field.handleChange(file);
    field.handleBlur();
  }
};

const removeFile = (field: any) => {
  field.handleChange(null);
  field.handleBlur();
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};
</script>
