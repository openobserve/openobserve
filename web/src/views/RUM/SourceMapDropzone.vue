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
          class="upload-area"
          :class="{ 'drag-over': isDragging, 'has-file': field.state.value }"
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
            style="display: none"
            @change="onFileInput(field, $event)"
          />

          <div v-if="!field.state.value" class="upload-content">
            <OIcon name="backup" size="xl" class="tw:mb-3" />
            <div class="tw:text-xl tw:font-semibold tw:text-gray-500 tw:mb-2">Drop your file here</div>
            <div class="tw:text-sm tw:text-gray-400 tw:mb-3">or click to browse</div>
            <div class="tw:text-xs tw:text-gray-400">.zip files only</div>
          </div>

          <div v-else class="file-info">
            <div class="tw:flex tw:items-center tw:justify-between">
              <div class="tw:flex tw:items-center tw:gap-3">
                <OIcon name="draft" size="lg" />
                <div>
                  <div class="tw:text-sm tw:font-medium text-weight-medium">{{ field.state.value.name }}</div>
                  <div class="tw:text-xs tw:text-gray-400">{{ formatFileSize(field.state.value.size) }}</div>
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
          class="tw:text-xs tw:text-file-error-text tw:mt-1"
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

<style lang="scss" scoped>
.upload-area {
  border: 2px dashed var(--q-border-color, #e0e0e0);
  border-radius: 8px;
  padding: 2rem 2rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background-color: var(--q-background);

  &:hover {
    border-color: var(--q-primary);
    background-color: rgba(var(--q-primary-rgb), 0.02);
  }

  &.drag-over {
    border-color: var(--q-primary);
    background-color: rgba(var(--q-primary-rgb), 0.05);
    border-style: solid;
  }

  &.has-file {
    padding: 1.5rem;
    text-align: left;
    border-style: solid;
    border-color: var(--q-positive);
    background-color: rgba(var(--q-positive-rgb), 0.02);
  }
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

:deep(.q-dark) {
  .upload-area {
    border-color: rgba(255, 255, 255, 0.1);

    &:hover {
      background-color: rgba(var(--q-primary-rgb), 0.05);
    }

    &.drag-over {
      background-color: rgba(var(--q-primary-rgb), 0.1);
    }

    &.has-file {
      background-color: rgba(var(--q-positive-rgb), 0.05);
    }
  }
}
</style>
