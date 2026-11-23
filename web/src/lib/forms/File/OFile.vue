<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  FileEmits,
  FileProps,
  FileRejection,
  FileSlots,
  FileSource,
  FileValue,
} from "./OFile.types";
import { computed, reactive, ref, useAttrs, useId, watch } from "vue";
import { useLockedDisabled } from "@/composables/useFeatureLock";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

interface UploadState {
  progress: number;
  status: "uploading" | "done" | "error";
  error?: I18nText;
}

interface FileRow {
  key: string;
  file: File;
  error?: I18nText;
  upload?: UploadState;
  rejection?: FileRejection;
  index?: number;
}

const SOURCE_ICONS: Record<FileSource, IconName> = {
  file: "upload",
  url: "link",
  paste: "content-paste",
};

const { t } = useI18nTyped();

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);
const testId = (suffix: string) => `${parentDataTest.value ?? "o-file"}-${suffix}`;

const props = withDefaults(defineProps<FileProps>(), {
  multiple: false,
  variant: "zone",
  sources: () => ["file"],
  disabled: false,
});

const emit = defineEmits<FileEmits>();

defineSlots<FileSlots>();

const isDisabled = useLockedDisabled(() => props.disabled);

const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);
const inputRef = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);
const rejections = ref<FileRejection[]>([]);
const uploads = reactive(new Map<File, UploadState>());
let dragDepth = 0;
let lastEmitted: FileValue | undefined;

const files = computed<File[]>(() => {
  const v = props.modelValue;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
});

const effectiveError = computed(() => props.errorMessage || (props.error ? " " : null) || null);
const hasError = computed(() => !!effectiveError.value);

// ── Sources ────────────────────────────────────────────────────────────────
const localSource = ref<FileSource>(props.source ?? props.sources[0] ?? "file");
const activeSource = computed<FileSource>(() => props.source ?? localSource.value);
const switchable = computed(() => props.variant === "zone" && props.sources.length > 1);
const localUrl = ref(props.url ?? "");
const localText = ref(props.text ?? "");
watch(
  () => props.url,
  (v) => (localUrl.value = v ?? ""),
);
watch(
  () => props.text,
  (v) => (localText.value = v ?? ""),
);

function setSource(value: unknown) {
  if (typeof value !== "string" || !props.sources.includes(value as FileSource)) return;
  localSource.value = value as FileSource;
  emit("update:source", value as FileSource);
}
function setUrl(value: string | number) {
  localUrl.value = String(value ?? "");
  emit("update:url", localUrl.value);
}
function setText(value: string) {
  localText.value = value;
  emit("update:text", value);
}
function sourceLabel(source: FileSource): I18nText {
  if (source === "url") return t("components.file.sourceUrl");
  if (source === "paste") return t("components.file.sourcePaste");
  return t("components.file.sourceFile");
}

// ── Constraints ────────────────────────────────────────────────────────────
const acceptTokens = computed(() =>
  (props.accept ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean),
);
const acceptLabel = computed(() => raw(acceptTokens.value.join(", ")));
const fileLimit = computed(() => props.maxFiles ?? (props.multiple ? Infinity : 1));

function formatSize(bytes: number): I18nText {
  if (bytes < 1024) return raw(`${bytes} B`);
  if (bytes < 1024 * 1024) return raw(`${(bytes / 1024).toFixed(1)} KB`);
  return raw(`${(bytes / (1024 * 1024)).toFixed(1)} MB`);
}

const constraints = computed(() => {
  const parts: I18nText[] = [];
  if (acceptTokens.value.length) parts.push(acceptLabel.value);
  if (props.maxSize !== undefined) {
    const size = formatSize(props.maxSize);
    parts.push(
      props.multiple
        ? t("components.file.upToSizeEach", { size })
        : t("components.file.upToSize", { size }),
    );
  }
  if (!props.multiple) parts.push(t("components.file.oneFile"));
  else if (Number.isFinite(fileLimit.value))
    parts.push(t("components.file.upToFiles", { count: fileLimit.value }));
  return raw(parts.join(" · "));
});

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
  const rejected: FileRejection[] = [];
  let accepted: File[] = [];
  for (const file of picked) {
    const reason = await checkFile(file);
    if (reason) rejected.push({ file, reason });
    else accepted.push(file);
  }
  const limit = fileLimit.value;
  if (accepted.length > limit) {
    const reason = t("components.file.countRejected", { count: limit }, limit);
    accepted.slice(limit).forEach((file) => rejected.push({ file, reason }));
    accepted = accepted.slice(0, limit);
  }
  rejections.value = rejected;
  uploads.clear();
  if (rejected.length) emit("rejected", rejected);
  const next: FileValue = accepted.length === 0 ? null : props.multiple ? accepted : accepted[0];
  setValue(next);
  if (props.upload) accepted.forEach(startUpload);
}

function setValue(next: FileValue) {
  lastEmitted = next;
  emit("update:modelValue", next);
  emit("change", next);
}

async function startUpload(file: File) {
  uploads.set(file, { progress: 0, status: "uploading" });
  try {
    await props.upload!(file, (fraction) => {
      const state = uploads.get(file);
      if (state) state.progress = Math.min(1, Math.max(0, fraction));
    });
    uploads.set(file, { progress: 1, status: "done" });
  } catch (err) {
    const error = typeof err === "string" && err ? raw(err) : t("components.file.uploadFailed");
    uploads.set(file, { progress: 0, status: "error", error });
  }
}

function handleChange(event: Event) {
  const target = event.target as HTMLInputElement;
  void takeFiles(target.files);
  // The browser skips `change` for the same path; clearing lets a re-pick fire again.
  target.value = "";
}

function removeFile(index: number) {
  const removed = files.value[index];
  if (removed) uploads.delete(removed);
  const next = files.value.filter((_, i) => i !== index);
  if (next.length === 0) {
    clearAll();
    return;
  }
  setValue(props.multiple ? next : next[0]);
}

function clearAll() {
  if (inputRef.value) inputRef.value.value = "";
  uploads.clear();
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
// A depth counter, because dragleave fires each time the pointer crosses a child.
function onDragEnter(event: DragEvent) {
  event.preventDefault();
  if (isDisabled.value) return;
  dragDepth += 1;
  isDragging.value = true;
}
function onDragOver(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = isDisabled.value ? "none" : "copy";
}
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) isDragging.value = false;
}
function onDrop(event: DragEvent) {
  event.preventDefault();
  dragDepth = 0;
  isDragging.value = false;
  if (isDisabled.value) return;
  void takeFiles(event.dataTransfer?.files ?? null);
}

// ── Rows ───────────────────────────────────────────────────────────────────
const rows = computed<FileRow[]>(() => [
  ...files.value.map((file, index) => {
    const upload = uploads.get(file);
    return { key: `f-${index}-${file.name}`, file, index, upload, error: upload?.error };
  }),
  ...rejections.value.map((rejection, index) => ({
    key: `r-${index}-${rejection.file.name}`,
    file: rejection.file,
    rejection,
    error: rejection.reason,
  })),
]);

function rowIcon(row: FileRow): IconName {
  if (row.error) return "error-outline";
  if (row.upload?.status === "done") return "check-circle";
  return "attach-file";
}

function rowIconClass(row: FileRow) {
  if (row.error) return "text-status-error-text";
  if (row.upload?.status === "done") return "text-status-success-text";
  return "text-text-muted";
}

const compactSummary = computed(() => raw(files.value.map((f) => f.name).join(", ")));
const compactSize = computed(() => formatSize(files.value.reduce((sum, f) => sum + f.size, 0)));
const compactError = computed(() => rejections.value[0]?.reason ?? null);
const bottomError = computed<I18nText | null>(() => {
  const own = effectiveError.value;
  if (own && own.trim()) return raw(own);
  return props.variant === "compact" ? compactError.value : null;
});

const zoneClasses = computed(() => [
  "flex flex-col items-center justify-center gap-2 rounded-surface border border-dashed p-4 text-center text-compact transition-colors duration-(--duration-control) ease-(--ease-control)",
  switchable.value && "h-full",
  isDragging.value
    ? "border-file-drag-border bg-file-drag-bg text-text-body"
    : isDisabled.value
      ? "border-border-default bg-surface-subtle text-text-disabled cursor-not-allowed"
      : hasError.value
        ? "border-file-error-border bg-status-error-bg text-text-secondary"
        : "border-border-strong bg-surface-subtle text-text-secondary hover:border-file-hover-border",
  !isDisabled.value && "cursor-pointer",
]);

const compactBoxClasses = computed(() => [
  "flex h-control-md min-w-0 flex-1 items-center gap-2 rounded-default border ps-2.5 pe-1 text-compact transition-colors duration-(--duration-control) ease-(--ease-control)",
  isDragging.value
    ? "border-file-drag-border bg-file-drag-bg"
    : isDisabled.value
      ? "border-input-disabled-border bg-input-disabled-bg cursor-not-allowed border-dashed"
      : hasError.value || compactError.value
        ? "border-file-error-border bg-input-bg"
        : "border-input-border bg-input-bg",
]);
</script>

<template>
  <div
    v-bind="$attrs"
    class="flex w-full min-w-0 flex-col gap-1"
    :data-variant="variant"
    :data-dragging="isDragging || undefined"
  >
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
      :aria-required="required || undefined"
      :aria-invalid="hasError || undefined"
      class="sr-only"
      @change="handleChange"
    />

    <div
      v-if="variant === 'compact'"
      class="flex min-w-0 items-center gap-2"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div :class="compactBoxClasses" :data-test="testId('box')">
        <OTruncatedText v-if="files.length === 0" class="text-input-placeholder min-w-0 flex-1">
          {{ placeholder || t("components.file.noFileChosen") }}
        </OTruncatedText>
        <template v-else>
          <OTruncatedText class="text-input-text min-w-0 flex-1">{{
            compactSummary
          }}</OTruncatedText>
          <span class="text-text-muted shrink-0 text-xs tabular-nums">{{ compactSize }}</span>
          <OButton
            icon-only
            variant="ghost"
            size="xs"
            icon="close"
            :aria-label="t('components.file.removeNamed', { name: compactSummary })"
            :disabled="isDisabled"
            data-test="o-file-chip-0-remove-btn"
            @click="clearAll"
          />
        </template>
      </div>
      <OButton
        icon="upload"
        :disabled="isDisabled"
        :disabled-reason="disabledReason"
        :data-test="testId('choose-btn')"
        @click="openPicker"
      >
        {{
          multiple ? t("components.file.chooseFilesButton") : t("components.file.chooseFileButton")
        }}
      </OButton>
    </div>

    <div v-else class="flex min-w-0 flex-col gap-2">
      <OToggleGroup
        v-if="switchable"
        :model-value="activeSource"
        type="single"
        size="sm"
        class="self-start"
        :aria-label="t('components.file.sourceLabel')"
        :disabled="isDisabled"
        :data-test="testId('source')"
        @update:model-value="setSource"
      >
        <OToggleGroupItem
          v-for="source in sources"
          :key="source"
          :value="source"
          :icon-left="SOURCE_ICONS[source]"
          :data-test="testId(`source-${source}`)"
        >
          {{ sourceLabel(source) }}
        </OToggleGroupItem>
      </OToggleGroup>

      <div :class="switchable ? 'h-43 min-h-0' : ''">
        <div
          v-if="activeSource === 'file'"
          :class="zoneClasses"
          :data-test="testId('zone')"
          @click="openPicker"
          @dragenter="onDragEnter"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <OIcon name="cloud-upload" size="md" class="text-text-muted" />
          <span v-if="isDragging">{{ t("components.file.dropToUpload") }}</span>
          <span v-else-if="isDisabled && disabledReason">{{ disabledReason }}</span>
          <slot v-else name="hint">
            <span :data-test="testId('prompt')">{{
              multiple ? t("components.file.dropHereMultiple") : t("components.file.dropHere")
            }}</span>
            <template v-if="!isDisabled">
              <span class="text-text-muted text-xs">{{ t("components.file.or") }}</span>
              <!-- .stop: the zone's own click handler would open the picker a second time -->
              <OButton
                size="sm"
                icon="upload"
                :data-test="testId('choose-btn')"
                @click.stop="openPicker"
              >
                {{
                  multiple
                    ? t("components.file.chooseFilesButton")
                    : t("components.file.chooseFileButton")
                }}
              </OButton>
            </template>
          </slot>
          <span v-if="constraints && !isDragging" class="text-text-muted text-xs tabular-nums">{{
            constraints
          }}</span>
        </div>

        <div v-else-if="activeSource === 'url'" class="flex h-full flex-col justify-center gap-1">
          <OInput
            type="url"
            :model-value="localUrl"
            :placeholder="urlPlaceholder || t('components.file.urlPlaceholder')"
            :aria-label="t('components.file.sourceUrl')"
            :disabled="isDisabled"
            :data-test="testId('url')"
            @update:model-value="setUrl"
          />
          <span class="text-text-muted text-xs">{{ t("components.file.urlHelp") }}</span>
        </div>

        <OTextarea
          v-else
          fill
          class="font-mono"
          :model-value="localText"
          :placeholder="textPlaceholder || t('components.file.textPlaceholder')"
          :aria-label="t('components.file.sourcePaste')"
          :disabled="isDisabled"
          :data-test="testId('paste')"
          @update:model-value="setText"
        />
      </div>

      <ul v-if="activeSource === 'file' && rows.length" class="flex flex-col gap-1.5">
        <li
          v-for="(row, i) in rows"
          :key="row.key"
          :data-test="`o-file-chip-${i}`"
          :data-state="row.error ? 'error' : (row.upload?.status ?? 'ready')"
          :class="[
            'rounded-default text-compact flex h-11 min-w-0 items-center gap-3 border ps-3 pe-1',
            row.error
              ? 'border-file-error-border bg-status-error-bg'
              : 'border-border-default bg-surface-base',
          ]"
        >
          <OIcon :name="rowIcon(row)" size="sm" :class="['shrink-0', rowIconClass(row)]" />
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
            <template v-if="row.upload?.status === 'uploading'">
              <OProgressBar
                class="min-w-10 flex-1"
                :value="Math.round(row.upload.progress * 100)"
                :label="raw(row.file.name)"
              />
              <span class="text-text-muted shrink-0 text-xs tabular-nums">{{
                raw(`${Math.round(row.upload.progress * 100)}%`)
              }}</span>
            </template>
            <span v-else-if="row.upload?.status === 'done'" class="text-text-muted flex-1 text-xs">
              {{ t("components.file.uploaded") }}
            </span>
            <span v-else class="flex-1" />
          </template>
          <OButton
            icon-only
            variant="ghost"
            size="xs"
            icon="close"
            :aria-label="t('components.file.removeNamed', { name: raw(row.file.name) })"
            :disabled="isDisabled"
            :data-test="`o-file-chip-${i}-remove-btn`"
            @click="removeRow(row)"
          />
        </li>
      </ul>
    </div>

    <div v-if="bottomError || helpText" class="flex items-center justify-between gap-2">
      <span
        v-if="bottomError"
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
