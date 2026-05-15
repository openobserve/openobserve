<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  FileProps,
  FileEmits,
  FileSlots,
  FileValue,
} from "./OFile.types";
import { computed, ref, useAttrs, useId } from "vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

const props = withDefaults(defineProps<FileProps>(), {
  multiple: false,
  size: "md",
  disabled: false,
  dropZone: false,
});

const emit = defineEmits<FileEmits>();

defineSlots<FileSlots>();

const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);
const inputRef = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);

const files = computed<File[]>(() => {
  const v = props.modelValue;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
});

const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
);
const hasError = computed(() => !!effectiveError.value);

const heightClasses: Record<NonNullable<FileProps["size"]>, string> = {
  sm: "tw:min-h-8 tw:text-xs",
  md: "tw:min-h-10 tw:text-sm",
};

function emitFiles(fileList: FileList | File[] | null) {
  const list = fileList ? Array.from(fileList) : [];

  if (list.length === 0) {
    emit("update:modelValue", null);
    emit("change", null);
    return;
  }

  if (props.maxFileSize !== undefined) {
    const tooBig = list.filter((f) => f.size > props.maxFileSize!);
    if (tooBig.length > 0) {
      emit("size-error", tooBig);
      return;
    }
  }

  const next: FileValue = props.multiple ? list : list[0];
  emit("update:modelValue", next);
  emit("change", next);
}

function handleChange(event: Event) {
  const target = event.target as HTMLInputElement;
  emitFiles(target.files);
}

function handleClear(event?: Event) {
  event?.stopPropagation();
  if (inputRef.value) inputRef.value.value = "";
  emit("update:modelValue", null);
  emit("clear");
}

function removeFile(index: number, event?: Event) {
  event?.stopPropagation();
  const next = files.value.filter((_, i) => i !== index);
  if (next.length === 0) {
    handleClear();
    return;
  }
  const value: FileValue = props.multiple ? next : next[0];
  emit("update:modelValue", value);
  emit("change", value);
}

function openPicker() {
  if (props.disabled) return;
  inputRef.value?.click();
}

function onDragOver(event: DragEvent) {
  if (props.disabled || !props.dropZone) return;
  event.preventDefault();
  isDragging.value = true;
}

function onDragLeave(event: DragEvent) {
  if (!props.dropZone) return;
  // `dragleave` fires every time the pointer crosses into a child element
  // (file chip, upload icon). If we cleared `isDragging` unconditionally,
  // the active-border state would flicker on/off as the user drags across
  // the drop zone. Only clear when leaving the wrapper itself — i.e. the
  // event's `relatedTarget` (the element being entered) is outside the
  // wrapper or null (dragged out of the window).
  const wrapper = event.currentTarget as HTMLElement | null;
  const related = event.relatedTarget as Node | null;
  if (wrapper && related && wrapper.contains(related)) return;
  event.preventDefault();
  isDragging.value = false;
}

function filterByAccept(files: File[], accept: string): File[] {
  const tokens = accept
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return files.filter((file) => {
    const mime = file.type.toLowerCase();
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    return tokens.some((token) => {
      if (token.startsWith(".")) return ext === token;
      if (token.endsWith("/*")) return mime.startsWith(token.slice(0, -1));
      return mime === token;
    });
  });
}

function onDrop(event: DragEvent) {
  if (props.disabled || !props.dropZone) return;
  event.preventDefault();
  isDragging.value = false;
  const dropped = event.dataTransfer?.files ?? null;
  if (dropped && props.accept) {
    emitFiles(filterByAccept(Array.from(dropped), props.accept));
  } else {
    emitFiles(dropped);
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const wrapperClasses = computed(() => [
  "tw:relative tw:flex tw:items-center tw:gap-2 tw:w-full tw:rounded-md tw:border tw:px-3 tw:py-2 tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150",
  "tw:ring-offset-1 tw:ring-offset-surface-base",
  heightClasses[props.size ?? "md"],
  isDragging.value
    ? "tw:bg-file-drag-bg tw:border-file-drag-border"
    : hasError.value
      ? "tw:bg-file-bg tw:border-file-error-border"
      : "tw:bg-file-bg tw:border-file-border tw:hover:border-file-hover-border",
  props.disabled
    ? "tw:bg-file-disabled-bg tw:border-file-disabled-border tw:opacity-60 tw:cursor-not-allowed"
    : "tw:cursor-pointer",
  "tw:focus-within:border-file-focus-border tw:focus-within:ring-2 tw:focus-within:ring-file-focus-ring",
]);
</script>

<template>
  <div v-bind="$attrs" class="tw:flex tw:flex-col tw:gap-1 tw:w-full">
    <label
      v-if="$slots.label || label || $slots.tooltip"
      :for="inputId"
      class="tw:text-xs tw:font-medium tw:text-file-label tw:leading-none tw:flex tw:items-center tw:gap-1"
    >
      <slot name="label">{{ label }}</slot>
      <q-icon
        v-if="$slots.tooltip"
        name="info"
        size="16px"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="tw:cursor-help tw:text-file-label"
      ><slot name="tooltip" /></q-icon>
    </label>

    <div
      :class="wrapperClasses"
      @click="openPicker"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <input
        :id="inputId"
        ref="inputRef"
        type="file"
        :name="name"
        :multiple="multiple"
        :accept="accept"
        :disabled="disabled"
        class="tw:sr-only"
        :aria-invalid="hasError || undefined"
        @change="handleChange"
      />

      <!-- Upload icon -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        class="tw:size-4 tw:text-file-icon tw:shrink-0"
        aria-hidden="true"
      >
        <path
          d="M7.293 1.5a1 1 0 0 1 1.414 0l3.5 3.5a1 1 0 0 1-1.414 1.414L9 4.621V10a1 1 0 1 1-2 0V4.621L4.207 6.414A1 1 0 0 1 2.793 5L7.293 1.5Z"
        />
        <path d="M2 12a1 1 0 0 1 2 0v1.5h8V12a1 1 0 0 1 2 0v2a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14v-2Z" />
      </svg>

      <!-- Selected files / placeholder -->
      <div
        v-if="files.length === 0"
        class="tw:flex-1 tw:min-w-0 tw:text-file-placeholder tw:truncate"
      >
        {{
          placeholder ||
          (dropZone
            ? "Drop files here or click to choose"
            : multiple
              ? "Choose files"
              : "Choose a file")
        }}
      </div>

      <div
        v-else
        class="tw:flex-1 tw:min-w-0 tw:flex tw:flex-wrap tw:gap-1.5 tw:items-center"
      >
        <span
          v-for="(file, i) in files"
          :key="`${file.name}-${i}`"
          class="tw:inline-flex tw:items-center tw:gap-1 tw:rounded-md tw:bg-file-chip-bg tw:text-file-chip-text tw:px-2 tw:py-0.5 tw:text-xs tw:max-w-full"
          :data-test="`o-file-chip-${i}`"
        >
          <span class="tw:truncate" :title="`${file.name} (${formatSize(file.size)})`">
            {{ file.name }}
          </span>
          <span class="tw:text-[0.65rem] tw:opacity-70 tw:shrink-0">
            {{ formatSize(file.size) }}
          </span>
          <button
            v-if="!disabled"
            type="button"
            tabindex="-1"
            aria-label="Remove file"
            class="tw:flex tw:items-center tw:text-file-chip-remove tw:hover:opacity-80"
            @click.stop="removeFile(i, $event)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 12 12"
              fill="currentColor"
              class="tw:size-2.5"
              aria-hidden="true"
            >
              <path
                d="M2.72 2.72a.75.75 0 0 1 1.06 0L6 4.94l2.22-2.22a.75.75 0 1 1 1.06 1.06L7.06 6l2.22 2.22a.75.75 0 1 1-1.06 1.06L6 7.06 3.78 9.28a.75.75 0 0 1-1.06-1.06L4.94 6 2.72 3.78a.75.75 0 0 1 0-1.06Z"
              />
            </svg>
          </button>
        </span>
      </div>

      <button
        v-if="files.length > 0 && !disabled"
        type="button"
        tabindex="-1"
        aria-label="Clear all"
        class="tw:flex tw:items-center tw:text-file-icon tw:hover:opacity-80 tw:shrink-0"
        @click.stop="handleClear($event)"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          class="tw:size-3.5"
          aria-hidden="true"
        >
          <path
            d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
          />
        </svg>
      </button>
    </div>

    <div
      v-if="effectiveError || helpText"
      class="tw:flex tw:items-center tw:justify-between tw:gap-2"
    >
      <span
        v-if="effectiveError && effectiveError.trim()"
        class="tw:text-xs tw:text-file-error-text tw:leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span
        v-else-if="helpText"
        class="tw:text-xs tw:text-file-label tw:leading-none"
      >
        {{ helpText }}
      </span>
    </div>
  </div>
</template>
