<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OTag — the app-facing chip; OBadge is its renderer and is used only through OTag.
// Typed:  <OTag type="alertStatus" value="active" />  (tone, icon, dot, label from badgeGroups.ts)
// Manual: <OTag tone="ok" icon="check">Passed</OTag>; per-call props win over the registry.

import { computed, useSlots } from "vue";
import { raw } from "@/types/i18n";
import OBadge from "./OBadge.vue";
import type { ChipTone, ChipSize } from "./OBadge.types";
import type { TagProps, TagEmits } from "./OTag.types";
import { resolveBadge, normalizeKey } from "./badgeGroups";
import { translateBadgeLabel } from "./badgeI18n";

// Two possible roots (empty dash vs OBadge), so attrs are forwarded by hand.
defineOptions({ inheritAttrs: false });

// `dot` must default to undefined, not Vue's absent-boolean false, or the auto dot never runs.
const props = withDefaults(defineProps<TagProps>(), {
  emptyLabel: raw("—"),
  dot: undefined,
  mono: false,
  toggle: false,
  pressed: false,
  disabled: false,
  removable: false,
});

const emit = defineEmits<TagEmits>();

const slots = useSlots();

const resolved = computed(() => resolveBadge(props.type, props.value));

const hasManualContent = computed(
  () => !!slots.default || props.label !== undefined || props.tone !== undefined,
);
// The "—" dash is for a typed chip whose value is missing.
const isEmpty = computed(() => !hasManualContent.value && normalizeKey(props.value) === "");

const tone = computed<ChipTone>(() => {
  if (props.tone) return props.tone;
  if (!props.type && normalizeKey(props.value) === "") return "neutral";
  return resolved.value.tone;
});
const size = computed<ChipSize>(() => props.size ?? resolved.value.size ?? "sm");
const label = computed(() => {
  if (props.label !== undefined) return props.label;
  const key = resolved.value.labelKey;
  return key ? translateBadgeLabel(key) : resolved.value.label;
});
const icon = computed(() =>
  props.icon !== undefined ? props.icon || undefined : resolved.value.icon,
);
// A registry dot forces one on; otherwise OBadge decides (status tones get a dot).
const dot = computed(() => props.dot ?? (props.type && resolved.value.dot ? true : undefined));
</script>

<template>
  <span v-if="isEmpty" class="text-text-body" v-bind="$attrs">{{ emptyLabel }}</span>
  <OBadge
    v-else
    :tone="tone"
    :size="size"
    :class="resolved.class"
    :dot="dot"
    :icon="icon"
    :mono="mono"
    :toggle="toggle"
    :pressed="pressed"
    :disabled="disabled"
    :removable="removable"
    :remove-label="removeLabel"
    v-bind="$attrs"
    @click="emit('click', $event)"
    @remove="emit('remove', $event)"
  >
    <template v-if="slots.icon" #icon><slot name="icon" /></template>
    <slot>{{ label }}</slot>
    <template v-if="slots.trailing" #trailing><slot name="trailing" /></template>
  </OBadge>
</template>
