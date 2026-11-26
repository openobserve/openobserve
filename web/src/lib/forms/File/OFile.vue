<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { FileEmits, FileProps, FileRejection, FileSlots, FileValue } from "./OFile.types";
import { computed, inject, ref, useAttrs, useId, watch } from "vue";
import { useLockedDisabled } from "@/composables/useFeatureLock";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { DIALOG_DEPTH_KEY } from "@/lib/overlay/Dialog/dialogStacking";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

interface FileRow {
  key: string;
  file: File;
  error?: I18nText;
  rejection?: FileRejection;
  index?: number;
}

const { t } = useI18nTyped();

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);
const testId = (suffix: string) => `${parentDataTest.value ?? "o-file"}-${suffix}`;
// The caller's aria-label names the field; it belongs on the browse button, not the wrapper.
const fieldName = computed(() => $attrs["aria-label"] as I18nText | undefined);
const rootAttrs = computed(() => {
  const { "aria-label": _ariaLabel, ...rest } = $attrs;
  return rest;
});

const props = withDefaults(defineProps<FileProps>(), {
  multiple: false,
  disabled: false,
});

const emit = defineEmits<FileEmits>();

const slots = defineSlots<FileSlots>();

const isDisabled = useLockedDisabled(() => props.disabled);

const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);
const labelId = computed(() => `${inputId.value}-label`);
const nameId = computed(() => `${inputId.value}-name`);
const browseId = computed(() => `${inputId.value}-browse`);
const errorId = computed(() => `${inputId.value}-error`);
const inputRef = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);
const rejections = ref<FileRejection[]>([]);
let lastEmitted: FileValue | undefined;
// Each pick gets a number; a slower, older pick finishing late must not overwrite a newer one.
let pickSeq = 0;

const files = computed<File[]>(() => {
  const v = props.modelValue;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
});

const effectiveError = computed(() => props.errorMessage || (props.error ? " " : null) || null);
const hasError = computed(() => !!effectiveError.value);

// In a dialog a single-file zone keeps room for its file row and message, so the dialog never resizes.
const inDialog = inject<number>(DIALOG_DEPTH_KEY, 0) > 0;
const reserveSpace = computed(() => inDialog && !props.multiple);

// ── Constraints ────────────────────────────────────────────────────────────
const acceptTokens = computed(() =>
  (props.accept ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean),
);
const acceptLabel = computed(() => raw(acceptTokens.value.join(", ")));
// The zone lists the types as ".png, .jpg & .webp".
const acceptList = computed(() => {
  const tokens = acceptTokens.value;
  if (tokens.length < 2) return raw(tokens.join(""));
  return raw(`${tokens.slice(0, -1).join(", ")} & ${tokens[tokens.length - 1]}`);
});
const fileLimit = computed(() => props.maxFiles ?? (props.multiple ? Infinity : 1));

function formatSize(bytes: number): I18nText {
  if (bytes < 1024) return raw(`${bytes} B`);
  if (bytes < 1024 * 1024) return raw(`${(bytes / 1024).toFixed(1)} KB`);
  return raw(`${(bytes / (1024 * 1024)).toFixed(1)} MB`);
}

function matchesAccept(file: File): boolean {
  const mime = file.type.toLowerCase();
  const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
  return acceptTokens.value.some((entry) => {
    const token = entry.toLowerCase();
    if (token.startsWith(".")) return ext === token;
    if (token.endsWith("/*")) return mime.startsWith(token.slice(0, -1));
    return mime === token;
  });
}

async function checkFile(file: File): Promise<I18nText | null> {
  if (acceptTokens.value.length && !matchesAccept(file)) {
    return t("components.file.typeRejected", { allowed: acceptLabel.value });
  }
  if (props.maxSize !== undefined && file.size > props.maxSize) {
    return t("components.file.sizeRejected", {
      size: formatSize(file.size),
      max: formatSize(props.maxSize),
    });
  }
  return (await props.validate?.(file)) ?? null;
}

// ── Selection ──────────────────────────────────────────────────────────────
async function takeFiles(fileList: FileList | File[] | null) {
  const picked = fileList ? Array.from(fileList) : [];
  if (picked.length === 0) return;
  const seq = ++pickSeq;
  const rejected: FileRejection[] = [];
  let accepted: File[] = [];
  for (const file of picked) {
    const reason = await checkFile(file);
    if (reason) rejected.push({ file, reason });
    else accepted.push(file);
  }
  if (seq !== pickSeq) return;
  const limit = fileLimit.value;
  if (accepted.length > limit) {
    const reason = t("components.file.countRejected", { count: limit }, limit);
    accepted.slice(limit).forEach((file) => rejected.push({ file, reason }));
    accepted = accepted.slice(0, limit);
  }
  rejections.value = rejected;
  if (rejected.length) emit("rejected", rejected);
  const next: FileValue = accepted.length === 0 ? null : props.multiple ? accepted : accepted[0];
  setValue(next);
}

function setValue(next: FileValue) {
  lastEmitted = next;
  emit("update:modelValue", next);
  emit("change", next);
}

function handleChange(event: Event) {
  const target = event.target as HTMLInputElement;
  void takeFiles(target.files);
  // The browser skips `change` for the same path; clearing lets a re-pick fire again.
  target.value = "";
}

function removeFile(index: number) {
  const next = files.value.filter((_, i) => i !== index);
  if (next.length === 0) {
    clearAll();
    return;
  }
  setValue(props.multiple ? next : next[0]);
}

function clearAll() {
  if (inputRef.value) inputRef.value.value = "";
  lastEmitted = null;
  emit("update:modelValue", null);
  emit("clear");
}

function removeRow(row: FileRow) {
  if (row.rejection) {
    rejections.value = rejections.value.filter((r) => r !== row.rejection);
    return;
  }
  if (row.index !== undefined) removeFile(row.index);
}

// An outside reset (form reset, tab switch) also drops the error rows of the last pick.
watch(
  () => props.modelValue,
  (value) => {
    if (value === lastEmitted) return;
    if (!value || (Array.isArray(value) && value.length === 0)) rejections.value = [];
  },
);

function openPicker() {
  if (isDisabled.value) return;
  inputRef.value?.click();
}

// ── Drag and drop ──────────────────────────────────────────────────────────
// The zone swaps its content while dragging, and a removed child never fires its dragleave,
// so a depth counter can stick; a leave counts only when the pointer really exits the zone.
function onDragEnter(event: DragEvent) {
  event.preventDefault();
  if (isDisabled.value) return;
  isDragging.value = true;
}
function onDragOver(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = isDisabled.value ? "none" : "copy";
}
function onDragLeave(event: DragEvent) {
  const zone = event.currentTarget as Node | null;
  const to = event.relatedTarget as Node | null;
  if (zone && to && zone.contains(to)) return;
  isDragging.value = false;
}
function onDrop(event: DragEvent) {
  event.preventDefault();
  isDragging.value = false;
  if (isDisabled.value) return;
  void takeFiles(event.dataTransfer?.files ?? null);
}

// ── Rows ───────────────────────────────────────────────────────────────────
const rows = computed<FileRow[]>(() => [
  ...files.value.map((file, index) => ({ key: `f-${index}-${file.name}`, file, index })),
  ...rejections.value.map((rejection, index) => ({
    key: `r-${index}-${rejection.file.name}`,
    file: rejection.file,
    rejection,
    error: rejection.reason,
  })),
]);
const hasErrorRow = computed(() => rows.value.some((row) => row.error));

const bottomError = computed<I18nText | null>(() => {
  const own = effectiveError.value;
  return own && own.trim() ? raw(own) : null;
});
// In a dialog the kept space holds the field's own error; with an error row it is already explained.
const errorInSpace = computed(
  () => reserveSpace.value && !rows.value.length && !!bottomError.value,
);
const errorBelow = computed(
  () =>
    !!bottomError.value && (!reserveSpace.value || (rows.value.length > 0 && !hasErrorRow.value)),
);

// One sentence per language with a {browse} slot, so translators can put the link anywhere.
const BROWSE_MARK = "\u0000";
const prompt = computed(() => {
  const key = props.multiple
    ? "components.file.attachPromptMultiple"
    : "components.file.attachPrompt";
  const [before = "", after = ""] = t(key, { browse: raw(BROWSE_MARK) }).split(BROWSE_MARK);
  return { before: raw(before), after: raw(after) };
});

const browseLabelledBy = computed(() => {
  const name =
    props.label || slotsHaveLabel.value ? labelId.value : fieldName.value ? nameId.value : "";
  return [name, browseId.value].filter(Boolean).join(" ");
});
const slotsHaveLabel = computed(() => !!slots.label);

// The zone's dashed outline is drawn by an SVG (see the template) so the gap
// between dashes can be wider than a CSS `border-dashed` allows. Its colour
// comes from the zone's `--zone-dash` variable set here.
const zoneClasses = computed(() => [
  "group relative flex min-h-16 flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-surface px-5 py-4 text-center text-compact transition-colors duration-(--duration-control) ease-(--ease-control)",
  isDragging.value
    ? "bg-file-zone-drag-bg text-text-body [--zone-dash:var(--color-file-drag-border)]"
    : isDisabled.value
      ? "bg-surface-subtle text-text-disabled cursor-not-allowed [--zone-dash:var(--color-border-default)]"
      : hasError.value
        ? "bg-status-error-bg text-text-secondary [--zone-dash:var(--color-file-error-border)]"
        : "bg-surface-subtle text-text-secondary [--zone-dash:var(--color-border-strong)] hover:[--zone-dash:var(--color-file-hover-border)]",
  !isDisabled.value && "cursor-pointer",
]);
</script>

<template>
  <div
    v-bind="rootAttrs"
    class="flex w-full min-w-0 flex-col gap-1"
    :data-dragging="isDragging || undefined"
  >
    <label
      v-if="$slots.label || label || $slots.tooltip"
      :id="labelId"
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
    <span v-else-if="fieldName" :id="nameId" class="sr-only">{{ fieldName }}</span>

    <!-- Out of the tab order: the browse button is the one keyboard stop and carries the field's name -->
    <input
      :id="inputId"
      ref="inputRef"
      type="file"
      tabindex="-1"
      :data-test="parentDataTest ? `${parentDataTest}-field` : 'o-file-field'"
      :name="name"
      :multiple="multiple"
      :accept="accept"
      :disabled="isDisabled"
      :aria-label="fieldName"
      :aria-required="required || undefined"
      :aria-invalid="hasError || undefined"
      class="sr-only"
      @change="handleChange"
    />

    <div class="flex min-w-0 flex-col gap-2">
      <div
        :class="zoneClasses"
        :data-test="testId('zone')"
        @click="openPicker"
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <svg
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 size-full overflow-visible"
        >
          <rect
            class="[height:calc(100%_-_0.125rem)] [width:calc(100%_-_0.125rem)] fill-none stroke-(--zone-dash) [stroke-width:0.09375rem] transition-[stroke] duration-(--duration-control) [rx:var(--radius-surface)] [stroke-dasharray:8_8] [x:0.0625rem] [y:0.0625rem]"
          />
        </svg>
        <OIcon v-if="!isDragging" name="cloud-upload" size="md" class="text-text-heading" />
        <template v-if="isDragging">
          <!-- An invisible copy of the resting content keeps the zone's size, so the page
               below doesn't jump; the drop message sits centred on top of it. -->
          <span
            aria-hidden="true"
            class="invisible flex basis-full flex-wrap items-center justify-center gap-x-2 gap-y-1"
          >
            <OIcon name="cloud-upload" size="md" />
            <span>{{ prompt.before }}{{ t("components.file.browseLink") }}{{ prompt.after }}</span>
            <span v-if="acceptTokens.length" class="basis-full text-xs">{{
              t("components.file.supports", { types: acceptList })
            }}</span>
          </span>
          <span
            class="text-file-chip-text absolute inset-0 flex items-center justify-center gap-2 font-semibold"
          >
            <OIcon name="download" size="md" />
            {{
              multiple
                ? t("components.file.dropFilesToAttach")
                : t("components.file.dropFileToAttach")
            }}
          </span>
        </template>
        <!-- No drop prompt while disabled: it would invite a drop that is ignored -->
        <span v-else-if="isDisabled" :data-test="testId('disabled')">{{
          disabledReason || t("components.file.unavailable")
        }}</span>
        <template v-else>
          <span :data-test="testId('prompt')" class="text-text-body"
            >{{
              prompt.before
            }}<!-- .stop: the zone's own click handler would open the picker a second time --><OButton
              :id="browseId"
              variant="link"
              :aria-labelledby="browseLabelledBy"
              :aria-invalid="hasError || undefined"
              :aria-describedby="errorInSpace || errorBelow ? errorId : undefined"
              :data-test="testId('choose-btn')"
              @click.stop="openPicker"
              >{{ t("components.file.browseLink") }}</OButton
            >{{ prompt.after }}</span
          >
          <span
            v-if="acceptTokens.length"
            class="text-text-secondary basis-full text-xs"
            :data-test="testId('types')"
            >{{ t("components.file.supports", { types: acceptList }) }}</span
          >
        </template>
      </div>

      <div v-if="reserveSpace && !rows.length" class="h-11" :data-test="testId('empty-row')">
        <span
          v-if="errorInSpace"
          :id="errorId"
          :data-test="parentDataTest ? `${parentDataTest}-error` : undefined"
          class="text-file-error-text text-xs leading-4"
          role="alert"
        >
          {{ bottomError }}
        </span>
      </div>
      <ul v-if="rows.length" class="flex flex-col gap-1.5">
        <li
          v-for="(row, i) in rows"
          :key="row.key"
          :data-test="`o-file-chip-${i}`"
          :data-state="row.error ? 'error' : 'ready'"
          :class="[
            'rounded-default text-compact flex h-11 min-w-0 items-center gap-3 border ps-3 pe-1',
            row.error
              ? 'border-file-error-border bg-status-error-bg'
              : 'border-border-default bg-surface-base',
          ]"
        >
          <OIcon
            :name="row.error ? 'error-outline' : 'attach-file'"
            size="sm"
            :class="['shrink-0', row.error ? 'text-status-error-text' : 'text-text-muted']"
          />
          <OTruncatedText class="text-text-heading min-w-0 font-medium">{{
            row.file.name
          }}</OTruncatedText>
          <OTruncatedText v-if="row.error" class="text-status-error-text min-w-0 flex-1 text-xs">{{
            row.error
          }}</OTruncatedText>
          <template v-else>
            <span class="text-text-muted shrink-0 text-xs tabular-nums">{{
              formatSize(row.file.size)
            }}</span>
            <span class="flex-1" />
          </template>
          <OButton
            icon-only
            variant="ghost"
            size="xs"
            icon-left="close"
            :aria-label="t('components.file.removeNamed', { name: raw(row.file.name) })"
            :disabled="isDisabled"
            :data-test="`o-file-chip-${i}-remove-btn`"
            @click="removeRow(row)"
          />
        </li>
      </ul>
    </div>

    <div v-if="errorBelow || helpText" class="flex items-center justify-between gap-2">
      <span
        v-if="errorBelow"
        :id="errorId"
        :data-test="parentDataTest ? `${parentDataTest}-error` : undefined"
        class="text-file-error-text text-xs leading-4"
        role="alert"
      >
        {{ bottomError }}
      </span>
      <span v-else-if="helpText" class="text-file-label text-xs leading-4">
        {{ helpText }}
      </span>
    </div>
  </div>
</template>
