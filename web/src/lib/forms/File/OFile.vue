<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { FileProps, FileEmits, FileSlots, FileValue } from "./OFile.types";
import { computed, ref, useAttrs, useId } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

// Forward tabindex to the real file input; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex: _tabindex, ...rest } = $attrs;
  return rest;
});

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

const effectiveError = computed(() => props.errorMessage || (props.error ? " " : null) || null);
const hasError = computed(() => !!effectiveError.value);

const heightClasses: Record<NonNullable<FileProps["size"]>, string> = {
  sm: "h-6 text-xs",
  md: "h-8 text-sm",
};

function emitFiles(fileList: FileList | File[] | null) {
  let list = fileList ? Array.from(fileList) : [];

  // Filter by accept before anything else — enforces the restriction for both
  // the native file picker and drag-and-drop sources.
  if (list.length > 0 && props.accept) {
    const accepted = filterByAccept(list, props.accept);
    const rejected = list.filter((f) => !accepted.includes(f));

    if (rejected.length > 0) {
      const names = rejected.map((f) => f.name).join(", ");
      const allowed = props.accept
        .split(",")
        .map((t) => t.trim())
        .join(", ");
      toast({
        message: `"${names}" is not a supported file type. Only ${allowed} files are allowed.`,
        variant: "error",
      });
      emit("type-error", rejected);
    }

    list = accepted;
  }

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
  // Reset the native input so picking the *same* file again still fires
  // `change`. Browsers suppress the event when the selected path is unchanged;
  // the component's state lives entirely in `modelValue`, so clearing the raw
  // input here is safe and keeps re-selection working after an external clear.
  target.value = "";
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
  emitFiles(dropped);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const wrapperClasses = computed(() => [
  "relative flex items-center gap-2 w-full rounded-default border px-3 py-1 transition-[color,background-color,border-color,box-shadow] duration-150",
  "ring-offset-1 ring-offset-surface-base",
  heightClasses[props.size ?? "md"],
  isDragging.value
    ? "bg-file-drag-bg border-file-drag-border"
    : hasError.value
      ? "bg-file-bg border-file-error-border"
      : "bg-file-bg border-file-border hover:border-file-hover-border",
  props.disabled
    ? "bg-file-disabled-bg border-file-disabled-border opacity-60 cursor-not-allowed"
    : "cursor-pointer",
  "focus-within:border-file-focus-border focus-within:ring-2 focus-within:ring-file-focus-ring",
]);
</script>

<template>
  <div v-bind="wrapperAttrs" class="flex w-full flex-col gap-1">
    <label
      v-if="$slots.label || label || $slots.tooltip"
      :for="inputId"
      class="o-input-label text-compact text-input-label-text flex items-center gap-1 leading-tight font-medium"
    >
      <slot name="label">{{ label }}</slot
      ><span v-if="required" aria-hidden="true" class="select-none">*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="text-file-label cursor-help"
        ><slot name="tooltip"
      /></OIcon>
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
        :data-test="parentDataTest ? `${parentDataTest}-field` : 'o-file-field'"
        :name="name"
        :multiple="multiple"
        :accept="accept"
        :disabled="disabled"
        :tabindex="inputTabindex"
        class="sr-only"
        :aria-invalid="hasError || undefined"
        @change="handleChange"
      />

      <!-- Upload icon -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        class="text-file-icon size-4 shrink-0"
        aria-hidden="true"
      >
        <path
          d="M7.293 1.5a1 1 0 0 1 1.414 0l3.5 3.5a1 1 0 0 1-1.414 1.414L9 4.621V10a1 1 0 1 1-2 0V4.621L4.207 6.414A1 1 0 0 1 2.793 5L7.293 1.5Z"
        />
        <path
          d="M2 12a1 1 0 0 1 2 0v1.5h8V12a1 1 0 0 1 2 0v2a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14v-2Z"
        />
      </svg>

      <!-- Selected files / placeholder -->
      <div v-if="files.length === 0" class="text-file-placeholder min-w-0 flex-1 truncate">
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
        class="o-file-chips flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto"
      >
        <span
          v-for="(file, i) in files"
          :key="`${file.name}-${i}`"
          class="rounded-default bg-file-chip-bg text-file-chip-text inline-flex max-w-48 shrink-0 items-center gap-1 px-2 py-0.5 text-xs"
          :data-test="`o-file-chip-${i}`"
        >
          <span class="truncate" :title="`${file.name} (${formatSize(file.size)})`">
            {{ file.name }}
          </span>
          <span class="text-3xs shrink-0 opacity-70">
            {{ formatSize(file.size) }}
          </span>
          <button
            v-if="!disabled"
            type="button"
            tabindex="-1"
            :aria-label="t('components.file.removeFile')"
            :data-test="`o-file-chip-${i}-remove-btn`"
            class="text-file-chip-remove flex items-center hover:opacity-80"
            @click.stop="removeFile(i, $event)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 12 12"
              fill="currentColor"
              class="size-2.5"
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
        :aria-label="t('components.file.clearAll')"
        class="text-file-icon flex shrink-0 items-center hover:opacity-80"
        @click.stop="handleClear($event)"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          class="size-3.5"
          aria-hidden="true"
        >
          <path
            d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
          />
        </svg>
      </button>
    </div>

    <div v-if="effectiveError || helpText" class="flex items-center justify-between gap-2">
      <span
        v-if="effectiveError && effectiveError.trim()"
        :data-test="parentDataTest ? `${parentDataTest}-error` : undefined"
        class="text-file-error-text text-xs leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span v-else-if="helpText" class="text-file-label text-xs leading-none">
        {{ helpText }}
      </span>
    </div>
  </div>
</template>

<style scoped>
/* keep(scrollbar): single-line file chips — keep horizontal scrolling but hide
   the scrollbar so the row stays a clean one-line input regardless of how many
   files are chosen. `scrollbar-width`/`-ms-overflow-style` and the
   `::-webkit-scrollbar` pseudo-element are native-control surfaces with no
   Tailwind utility equivalent. */
.o-file-chips {
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge legacy */
}
.o-file-chips::-webkit-scrollbar {
  display: none; /* Chrome/Safari */
}
</style>
