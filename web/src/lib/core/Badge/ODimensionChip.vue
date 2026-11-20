<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
// Copyright 2026 OpenObserve Inc.
//
// ODimensionChip — the key/value tag (env: prod): a mono key on a subtle fill, then the
// mono value in strong text. The key is secondary, the value is the fact.

import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { CHIP_TONE_CLASSES } from "./chipClasses";
import type { ChipTone } from "./OBadge.types";

const { t } = useI18nTyped();

const props = withDefaults(
  defineProps<{
    /** Dimension key, shown in the key segment unless `keyLabel` overrides it. */
    dimKey: string;
    /** Dimension value (shown in the strong segment). */
    value: string | number;
    /** Optional display override for the key segment (e.g. a shortened key). */
    keyLabel?: string;
    /** Show a `key=value` hover tooltip. Default false. */
    tooltip?: boolean;
    /** Give a cut value its own tooltip; turn off when an enclosing element already shows the full value. */
    valueTooltip?: boolean;
    /** Render a ✕ inside the chip that emits `remove`. */
    removable?: boolean;
    /** Accessible name for the dismiss affordance. */
    removeLabel?: I18nText;
    /** `data-test` for the dismiss affordance, so a page can target one chip's remove. */
    removeDataTest?: string;
    /** Tone for a condition that is not a user-picked dimension (an insight filter). */
    tone?: ChipTone;
    /** Third segment naming how the value was derived; a removable chip shows its dismiss affordance instead. */
    qualifier?: I18nText;
    /** `data-test` for the qualifier segment. */
    qualifierDataTest?: string;
    /** Secondary text and a lighter value, for a chip that names an absence rather than a value. */
    muted?: boolean;
    /** Leave out the key segment where a column header or label already names the dimension. */
    hideKey?: boolean;
  }>(),
  {
    tooltip: false,
    valueTooltip: true,
    removable: false,
    removeLabel: undefined,
    removeDataTest: undefined,
    tone: "neutral",
    qualifier: undefined,
    qualifierDataTest: undefined,
    muted: false,
    hideKey: false,
  },
);

const emit = defineEmits<{ (e: "remove"): void }>();

const isNeutral = computed(() => props.tone === "neutral");
const rootTone = computed(() =>
  isNeutral.value ? "border-border-default bg-surface-base" : CHIP_TONE_CLASSES[props.tone],
);
const segmentTone = computed(() =>
  isNeutral.value
    ? "border-border-default bg-surface-subtle text-text-secondary"
    : "border-current/20 bg-current/8",
);
const valueText = computed(() => {
  if (props.muted) return "text-text-secondary font-normal";
  return isNeutral.value ? "text-text-heading font-medium" : "font-medium";
});
</script>

<template>
  <span
    class="rounded-chip inline-flex h-5 max-w-full min-w-0 items-center overflow-hidden border font-mono text-xs leading-none"
    :class="rootTone"
    data-test="o-dimension-chip"
  >
    <!-- First child: with no element before it, the tooltip attaches to the chip root. -->
    <OTooltip v-if="tooltip" :content="raw(`${dimKey}=${value}`)" />
    <span
      v-if="!hideKey"
      class="inline-flex shrink-0 items-center self-stretch border-e px-1.5 font-normal whitespace-nowrap"
      :class="segmentTone"
      >{{ keyLabel ?? dimKey }}</span
    >
    <OTruncatedText
      class="px-1.5"
      :class="[valueText, removable ? 'pe-0.5' : undefined]"
      :tooltip="tooltip || !valueTooltip ? false : undefined"
      >{{ value }}</OTruncatedText
    >
    <button
      v-if="removable"
      type="button"
      :aria-label="removeLabel ?? t('common.remove')"
      class="focus-visible:ring-badge-focus-ring inline-grid shrink-0 cursor-pointer place-items-center self-stretch pe-1 opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
      :data-test="removeDataTest"
      @click.stop="emit('remove')"
    >
      <OIcon name="close" size="xs" class="size-2.5!" />
    </button>
    <span
      v-else-if="qualifier"
      class="inline-flex shrink-0 items-center self-stretch border-s px-1.5 font-sans font-medium whitespace-nowrap"
      :class="segmentTone"
      :data-test="qualifierDataTest"
      >{{ qualifier }}</span
    >
  </span>
</template>
