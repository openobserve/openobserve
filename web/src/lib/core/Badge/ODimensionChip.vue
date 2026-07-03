<script setup lang="ts">
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
//
// Single source of truth — do NOT hand-roll the two-segment markup again.

import OTag from "./OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { dimensionVariant } from "./badgeGroups";

withDefaults(
  defineProps<{
    /** Dimension key — drives the colour via the `dimensionKey` group. */
    dimKey: string;
    /** Dimension value (shown in the bold segment). */
    value: string | number;
    /** Optional display override for the key segment (e.g. a shortened key). */
    keyLabel?: string;
    /** Show a `key=value` hover tooltip. Default false (main had none). */
    tooltip?: boolean;
  }>(),
  { tooltip: false },
);
</script>

<template>
  <span class="tw:inline-flex tw:min-w-0 tw:max-w-full">
    <OTag
      :variant="dimensionVariant(dimKey)"
      shape="rounded"
      class="tw:min-w-0 tw:!p-0 tw:overflow-hidden"
    >
      <span class="tw:inline-flex tw:items-stretch tw:min-w-0">
        <span
          class="tw:ps-2.5 tw:pe-1 tw:py-1.5 tw:shrink-0 tw:whitespace-nowrap tw:bg-current/8 tw:opacity-90"
        >{{ keyLabel ?? dimKey }}</span>
        <span
          class="tw:ps-1 tw:pe-2.5 tw:py-1.5 tw:truncate tw:min-w-0 tw:font-semibold"
        >{{ value }}</span>
      </span>
    </OTag>
    <OTooltip v-if="tooltip" :delay="300" :content="`${dimKey}=${value}`" />
  </span>
</template>
