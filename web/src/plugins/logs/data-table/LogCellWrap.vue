<script setup lang="ts">
import { onBeforeUnmount, onUpdated, ref, useId, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useI18nTyped } from "@/types/i18n";

defineProps<{
  wrap: boolean;
  expanded: boolean;
}>();

defineEmits<{
  "update:expanded": [expanded: boolean];
}>();

const { t } = useI18nTyped();
const contentId = useId();
const preview = ref<HTMLElement | null>(null);
const overflowing = ref(false);
let observer: ResizeObserver | undefined;

const measureOverflow = () => {
  const content = preview.value?.firstElementChild;
  if (!(content instanceof HTMLElement)) return;
  const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight);
  overflowing.value = content.scrollHeight > Math.ceil(lineHeight * 4);
};

watch(
  preview,
  (element) => {
    observer?.disconnect();
    if (!element) return;
    observer = new ResizeObserver(measureOverflow);
    observer.observe(element);
    measureOverflow();
  },
  { flush: "post" },
);

onUpdated(measureOverflow);
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div v-if="wrap" ref="preview" class="min-w-0" data-test="logs-cell-wrap">
    <div v-if="expanded" :id="contentId"><slot /></div>
    <OTruncatedText v-else :id="contentId" as="div" :lines="4" :tooltip="false">
      <slot />
    </OTruncatedText>
    <OButton
      v-if="overflowing"
      variant="ghost"
      size="xs"
      :aria-controls="contentId"
      :aria-expanded="expanded"
      data-test="logs-cell-wrap-toggle"
      @click.stop="$emit('update:expanded', !expanded)"
    >
      <span class="grid">
        <span
          class="col-start-1 row-start-1"
          :class="expanded ? 'invisible' : ''"
          :aria-hidden="expanded"
          >{{ t("common.showMore") }}</span
        >
        <span
          class="col-start-1 row-start-1"
          :class="expanded ? '' : 'invisible'"
          :aria-hidden="!expanded"
          >{{ t("common.collapse") }}</span
        >
      </span>
    </OButton>
  </div>
  <slot v-else />
</template>
