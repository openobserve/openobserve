<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OCodeCell — monospace rendering for identifiers / SQL / tokens with an
// optional copy-on-hover affordance. Truncates with ellipsis and shows
// the full value on hover only when it is cut.
//
//   <OCodeCell :value="row.trace_id" />
//   <OCodeCell :value="row.query" :copy="false" />

import { computed, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    value: unknown;
    /** Show the hover copy button. Default true. */
    copy?: boolean;
    emptyLabel?: I18nText;
    /** Hover text in place of the value; `false` for secrets, which must never show on hover. */
    tooltip?: I18nText | false;
    /** Mask the value until the eye toggle reveals it; copy always copies the full value. */
    secret?: boolean;
  }>(),
  { copy: true, emptyLabel: raw("—"), tooltip: undefined, secret: false },
);

const text = computed(() => {
  const v = props.value;
  if (v === null || v === undefined || v === "") return null;
  return String(v);
});

const revealed = ref(false);
watch(text, () => (revealed.value = false));
const MASK = "••••••••••••";
const shown = computed(() => {
  if (text.value === null || !props.secret || revealed.value) return text.value;
  return text.value.startsWith("Basic ") ? `Basic ${MASK}` : MASK;
});

const copied = ref(false);
async function handleCopy(e: MouseEvent) {
  e.stopPropagation();
  if (text.value === null) return;
  try {
    await navigator.clipboard.writeText(text.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1200);
  } catch {
    /* clipboard unavailable — no-op */
  }
}

const { t } = useI18nTyped();
</script>

<template>
  <span v-if="text === null" class="text-text-muted text-xs">{{ emptyLabel }}</span>
  <span v-else class="group/code inline-flex max-w-full min-w-0 items-center gap-1">
    <OTruncatedText
      class="font-mono text-xs"
      :class="{ 'select-none': secret && !revealed }"
      :tooltip="tooltip"
      >{{ shown }}</OTruncatedText
    >
    <OButton
      v-if="secret"
      variant="ghost"
      size="icon-xs-sq"
      :aria-label="revealed ? t('common.hide') : t('common.show')"
      data-test="o-code-cell-reveal"
      @click.stop="revealed = !revealed"
    >
      <OIcon :name="revealed ? 'visibility-off' : 'visibility'" size="xs" />
      <OTooltip :content="revealed ? t('common.hide') : t('common.show')" side="top" />
    </OButton>
    <button
      v-if="copy"
      type="button"
      class="text-text-body shrink-0 cursor-pointer leading-none opacity-0 transition-opacity group-hover/code:opacity-60 hover:opacity-100! focus-visible:opacity-100 max-md:opacity-60"
      :title="copied ? t('common.copiedExclaim') : t('common.copy')"
      @click="handleCopy"
    >
      <OIcon :name="copied ? 'check' : 'content-copy'" size="xs" />
    </button>
  </span>
</template>
