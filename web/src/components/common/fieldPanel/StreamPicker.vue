<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="px-page-edge flex shrink-0 flex-col gap-1.5 pt-1.5" data-test="stream-picker">
    <OSelect
      v-if="streamType !== 'hidden'"
      :model-value="type"
      :options="typeOptions"
      :disabled="streamType === 'disabled'"
      :label="t('alerts.streamType')"
      label-position="inside"
      size="xs"
      :data-test="typeTestId"
      @update:model-value="onTypeChange"
    />
    <div class="flex max-w-full items-center gap-2">
      <slot name="before" />
      <div class="min-w-0 flex-1" data-recent-searches-avoid>
        <!-- A slot-less OTooltip anchors to its previous sibling, so the live region sits before the select. -->
        <span
          v-if="announcement !== undefined"
          aria-live="polite"
          data-test="log-search-index-list-stream-picker-announcement"
          class="sr-only"
          >{{ announcement }}</span
        >
        <OSelect
          ref="select"
          :model-value="mode === 'multi' ? selected : (selected[0] ?? null)"
          :options="streams"
          :multiple="mode === 'multi'"
          :row-click-single-select="mode === 'multi'"
          pin-selected-in-groups
          :search-debounce="searchDebounce"
          :aria-label="t('search.selectStream')"
          :placeholder="t('search.selectStream')"
          :loading="loading"
          :disabled="locked"
          :option-tooltip="optionTooltip"
          size="xs"
          class="w-full"
          :data-test="streamTestId"
          @update:model-value="onStreamChange"
          @open="emit('open')"
          @close="emit('close')"
          @search="emit('search', $event)"
          @header-action="onHeaderAction"
        >
          <template v-if="$slots['before-options']" #before-options>
            <slot name="before-options" />
          </template>
          <template v-if="$slots['after-options']" #after-options>
            <slot name="after-options" />
          </template>
        </OSelect>
        <OTooltip
          v-if="mode === 'multi' && selected.length > 1"
          :delay="500"
          side="bottom"
          align="start"
          max-width="17.5rem"
          :content="raw(selected.join(', '))"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import type { StreamOption, StreamTypeMode } from "./fieldPanel.types";

const props = withDefaults(
  defineProps<{
    mode: "single" | "multi";
    streamType?: StreamTypeMode;
    streams: StreamOption[];
    selected: string[];
    type: string;
    loading?: boolean;
    types?: string[];
    /** Screen-reader text for picker-side changes, such as internal streams being hidden. */
    announcement?: I18nText | "";
    searchDebounce?: number;
    /** Every change closes the popover. */
    closeSignal?: number;
    locked?: boolean;
    optionTooltip?: boolean;
    streamTestId?: string;
    typeTestId?: string;
  }>(),
  {
    streamType: "hidden",
    loading: false,
    types: () => ["logs", "metrics", "traces"],
    announcement: undefined,
    searchDebounce: 0,
    closeSignal: 0,
    locked: false,
    optionTooltip: false,
    streamTestId: "log-search-index-list-select-stream",
    typeTestId: "stream-picker-stream-type",
  },
);

const emit = defineEmits<{
  "update:selected": [names: string[]];
  "update:type": [type: string];
  open: [];
  close: [];
  search: [term: string];
  "header-action": [option: StreamOption];
}>();

const { t } = useI18nTyped();

const select = ref<InstanceType<typeof OSelect> | null>(null);

// Stream types are API identifiers, so they stay verbatim.
const typeOptions = computed(() => props.types.map((type) => ({ label: raw(type), value: type })));

watch(
  () => props.closeSignal,
  () => select.value?.close?.(),
);

// OSelect hands back the option as it was passed in, which here is always a stream option.
function onHeaderAction(option: unknown) {
  emit("header-action", option as StreamOption);
}

function onTypeChange(value: SelectModelValue) {
  if (typeof value === "string" && value !== props.type) emit("update:type", value);
}

function onStreamChange(value: SelectModelValue) {
  if (Array.isArray(value)) {
    emit(
      "update:selected",
      value.filter((v): v is string => typeof v === "string"),
    );
    return;
  }
  emit("update:selected", typeof value === "string" && value ? [value] : []);
}
</script>
