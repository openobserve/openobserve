<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    :class="[
      'flex w-full min-w-0 flex-col items-center justify-center text-center',
      isInline ? 'gap-1 px-4 py-6' : 'gap-2 px-6 py-10 max-md:px-4 max-md:py-6',
    ]"
    :data-kind="kind"
    data-test="o2-empty-state"
  >
    <span
      aria-hidden="true"
      :class="[
        'mb-1 inline-flex shrink-0 items-center justify-center',
        isInline ? 'rounded-menu size-8' : 'rounded-surface size-10',
        kind === 'error'
          ? 'bg-status-error-bg text-status-error-text'
          : 'bg-surface-subtle text-text-secondary',
      ]"
      data-test="o2-empty-state-icon"
    >
      <OIcon :name="resolvedIcon" size="sm" :class="isInline ? '' : 'size-5!'" />
    </span>

    <component
      :is="isInline ? 'p' : 'h2'"
      v-if="title"
      :class="[
        'text-text-heading font-semibold wrap-break-word',
        isInline ? 'text-sm' : 'text-base',
      ]"
      data-test="o2-empty-state-title"
    >
      {{ title }}
    </component>

    <p
      v-if="text || $slots.text"
      :class="[
        'text-text-secondary max-w-[44ch] wrap-break-word',
        isInline ? 'text-compact' : 'text-sm',
      ]"
      data-test="o2-empty-state-text"
    >
      <slot name="text">{{ text }}</slot>
    </p>

    <p
      v-if="contact"
      :class="['text-text-secondary max-w-[44ch]', isInline ? 'text-compact' : 'text-sm']"
      data-test="o2-empty-state-contact"
    >
      {{ contact }}
    </p>

    <p
      v-if="requestId"
      class="text-text-muted font-mono text-xs"
      data-test="o2-empty-state-request-id"
    >
      {{ t("emptyState.requestId", { id: raw(requestId) }) }}
    </p>

    <div
      v-if="$slots.actions || primaryLabel || secondaryActionLabel"
      class="mt-2 flex flex-wrap items-center justify-center gap-2"
    >
      <slot name="actions">
        <OButton
          v-if="primaryLabel"
          size="lg"
          :variant="kind === 'first-run' ? 'primary' : 'secondary'"
          :icon="primaryIcon"
          data-test="o2-empty-state-action"
          @click="onAction?.()"
        >
          {{ primaryLabel }}
        </OButton>
        <OButton
          v-if="secondaryActionLabel"
          size="lg"
          variant="secondary"
          data-test="o2-empty-state-secondary-action"
          @click="onSecondaryAction?.()"
        >
          {{ secondaryActionLabel }}
        </OButton>
      </slot>
    </div>

    <div v-if="$slots.extra" class="mt-2 flex w-full flex-col items-center gap-2">
      <slot name="extra" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

import type { EmptyStateKind, EmptyStateProps, EmptyStateSlots } from "./OEmptyState.types";

const KIND_ICON: Record<EmptyStateKind, IconName> = {
  "first-run": "inbox",
  filtered: "search-off",
  denied: "lock",
  error: "warning-amber",
};

const props = withDefaults(defineProps<EmptyStateProps>(), {
  kind: "first-run",
  size: "page",
});

defineSlots<EmptyStateSlots>();

const { t } = useI18nTyped();

const isInline = computed(() => props.size === "inline");
const resolvedIcon = computed<IconName>(() => props.icon ?? KIND_ICON[props.kind]);

// A default label only appears when someone listens, so a dead button never renders.
const primaryLabel = computed<I18nText | undefined>(() => {
  if (props.actionLabel) return props.actionLabel;
  if (!props.onAction) return undefined;
  if (props.kind === "error") return t("emptyState.loadError.action");
  if (props.kind === "filtered") return t("emptyState.filtered.action");
  return undefined;
});
const primaryIcon = computed<IconName | undefined>(() =>
  props.kind === "error" && !props.actionLabel ? "refresh" : undefined,
);
</script>
