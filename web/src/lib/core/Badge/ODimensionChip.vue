<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
// Copyright 2026 OpenObserve Inc.
//
// ODimensionChip — the standard key|value dimension chip (k8s-cluster=prod,
// service=api, …). A two-segment OTag: a muted KEY segment + a bold VALUE
// segment. Colour comes from `dimensionVariant()` (exact → SUBSTRING → stable
// hash) so prefixed keys like "k8s-cluster"/"k8s-namespace" resolve to the same
// colour as "cluster"/"namespace" — the same logic the incident list uses, so a
// dimension is the same colour everywhere (incident, home overview, correlation).
// NOTE: do NOT use `type="dimensionKey"` here — that only EXACT-matches, so
// prefixed keys fall through to grey.
//
//   <ODimensionChip dim-key="service" value="openobserve" />
//   <ODimensionChip dim-key="k8s-cluster" key-label="cluster" :value="v" />
//   <ODimensionChip dim-key="service" :value="v" removable @remove="drop(i)" />
//
// Single source of truth — do NOT hand-roll the two-segment markup again.

import OTag from "./OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { dimensionVariant } from "./badgeGroups";

const { t } = useI18nTyped();

withDefaults(
  defineProps<{
    /** Dimension key — drives the colour via the `dimensionKey` group. */
    dimKey: string;
    /** Dimension value (shown in the bold segment). */
    value: string | number;
    /** Optional display override for the key segment (e.g. a shortened key). */
    keyLabel?: string;
    /** Show a `key=value` hover tooltip. Default false. */
    tooltip?: boolean;
    /**
     * Render a dismiss affordance inside the chip and emit `remove` on click.
     * A dismissable condition is the chip itself, not a button parked beside
     * it — the two read as one control and stay the same height.
     */
    removable?: boolean;
    /** Accessible name for the dismiss affordance. */
    removeLabel?: I18nText;
  }>(),
  { tooltip: false, removable: false, removeLabel: undefined },
);

const emit = defineEmits<{ (e: "remove"): void }>();
</script>

<template>
  <span class="inline-flex max-w-full min-w-0">
    <OTag :variant="dimensionVariant(dimKey)" shape="rounded" class="min-w-0 overflow-hidden !p-0">
      <span class="inline-flex min-w-0 items-stretch">
        <span class="shrink-0 bg-current/8 py-1.5 ps-2.5 pe-1 whitespace-nowrap opacity-90">{{
          keyLabel ?? dimKey
        }}</span>
        <span
          class="min-w-0 truncate py-1.5 ps-1 font-semibold"
          :class="removable ? 'pe-1' : 'pe-2.5'"
          >{{ value }}</span
        >
        <button
          v-if="removable"
          type="button"
          :aria-label="removeLabel ?? t('common.remove')"
          class="inline-flex shrink-0 cursor-pointer items-center ps-0.5 pe-1.5 hover:opacity-70"
          @click.stop="emit('remove')"
        >
          <OIcon name="close" size="xs" />
        </button>
      </span>
    </OTag>
    <OTooltip v-if="tooltip" :delay="300" :content="raw(`${dimKey}=${value}`)" />
  </span>
</template>
