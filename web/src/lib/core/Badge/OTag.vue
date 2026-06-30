<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OTag — the standard typed badge for the whole app. Give it a registry group
// via `type` and a raw `value`; it looks up colour / icon / dot / label from
// badgeGroups.ts and renders an OBadge. See badgeGroups.ts for the catalogue.
//
//   <OTag type="alertType"   value="realtime" />   → blue + bolt icon
//   <OTag type="alertStatus" value="active"   />   → green + leading dot
//   <OTag type="logLevel"    value="error"    />   → red, colour only
//   <OTag value="whatever" />                       → generic semantic mapping
//
// Per-call overrides (`label`, `variant`, `icon`, `dot`, `size`) win over the
// registry when you need a one-off tweak.

import { computed } from "vue";
import OBadge from "./OBadge.vue";
import type { BadgeVariant, BadgeSize } from "./OBadge.types";
import { resolveBadge, normalizeKey, type BadgeGroupName } from "./badgeGroups";

const props = withDefaults(
  defineProps<{
    /** Registry group (e.g. "alertType"). Omit for generic semantic mapping. */
    type?: BadgeGroupName | string;
    /** Raw value (string | boolean | number). */
    value: unknown;
    size?: BadgeSize;
    /** Override the resolved label. */
    label?: string;
    /** Override the resolved colour variant. */
    variant?: BadgeVariant;
    /** Override the resolved icon (OIcon name). Pass "" to suppress. */
    icon?: string;
    /** Override the leading dot. */
    dot?: boolean;
    /** Text shown when value is empty. Default "—". */
    emptyLabel?: string;
  }>(),
  { size: "sm", emptyLabel: "—" },
);

const isEmpty = computed(() => normalizeKey(props.value) === "");

const resolved = computed(() => resolveBadge(props.type, props.value));

const variant = computed<BadgeVariant>(() => props.variant ?? resolved.value.variant);
const label = computed(() => props.label ?? resolved.value.label);
const icon = computed(() =>
  props.icon !== undefined ? props.icon || undefined : resolved.value.icon,
);
const dot = computed(() => props.dot ?? resolved.value.dot);
</script>

<template>
  <!-- Empty value: a plain dash in PRIMARY text (never the disabled grey). -->
  <span v-if="isEmpty" class="tw:text-text-primary">{{ emptyLabel }}</span>
  <OBadge
    v-else
    :variant="variant"
    :size="size"
    :dot="dot"
    :icon="icon"
  >
    {{ label }}
  </OBadge>
</template>
