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
    v-if="isCompact"
    class="flex w-full min-w-0 items-start gap-2 py-2 text-start"
    :data-kind="kind"
    data-o2-empty="compact"
    data-test="o2-empty-state"
  >
    <OIcon
      :name="resolvedIcon"
      size="sm"
      :class="['mt-0.5 shrink-0', iconTone]"
      aria-hidden="true"
      data-test="o2-empty-state-icon"
    />
    <div class="flex min-w-0 flex-1 flex-col items-start gap-0.5">
      <p
        v-if="resolvedTitle"
        class="text-text-heading text-compact leading-5 font-medium wrap-break-word"
        data-test="o2-empty-state-title"
      >
        {{ resolvedTitle }}
      </p>
      <p
        v-if="resolvedText || $slots.text"
        class="text-text-secondary text-compact wrap-break-word"
        data-test="o2-empty-state-text"
      >
        <slot name="text">{{ resolvedText }}</slot>
      </p>
      <p v-if="contact" class="text-text-secondary text-compact" data-test="o2-empty-state-contact">
        {{ contact }}
      </p>
      <p
        v-if="requestId"
        class="text-text-muted font-mono text-xs"
        data-test="o2-empty-state-request-id"
      >
        {{ t("emptyState.requestId", { id: raw(requestId) }) }}
      </p>
      <div v-if="$slots.actions || primaryLabel" class="mt-1.5 flex items-center gap-2">
        <slot name="actions">
          <OButton
            size="sm"
            variant="secondary"
            data-test="o2-empty-state-action"
            @click="onAction?.()"
          >
            {{ primaryLabel }}
          </OButton>
        </slot>
      </div>
      <div v-if="$slots.extra" class="mt-2 w-full">
        <slot name="extra" />
      </div>
    </div>
  </div>

  <div
    v-else
    class="flex w-full min-w-0 flex-col items-center self-start px-6 pt-16 pb-10 text-center max-md:px-4"
    :data-kind="kind"
    data-o2-empty="region"
    data-test="o2-empty-state"
  >
    <span
      aria-hidden="true"
      :class="[
        'bg-surface-subtle rounded-surface mb-3 inline-flex size-10 shrink-0 items-center justify-center',
        iconTone,
      ]"
      data-test="o2-empty-state-icon"
    >
      <OIcon :name="resolvedIcon" size="sm" class="size-5!" />
    </span>

    <h2
      v-if="resolvedTitle"
      class="text-text-heading font-title text-sm wrap-break-word"
      data-test="o2-empty-state-title"
    >
      {{ resolvedTitle }}
    </h2>

    <p
      v-if="resolvedText || $slots.text"
      class="text-text-secondary text-compact mt-1 max-w-105 wrap-break-word"
      data-test="o2-empty-state-text"
    >
      <slot name="text">{{ resolvedText }}</slot>
    </p>

    <p
      v-if="contact"
      class="text-text-secondary text-compact mt-1 max-w-105"
      data-test="o2-empty-state-contact"
    >
      {{ contact }}
    </p>

    <p
      v-if="requestId"
      class="text-text-muted mt-1 font-mono text-xs"
      data-test="o2-empty-state-request-id"
    >
      {{ t("emptyState.requestId", { id: raw(requestId) }) }}
    </p>

    <div
      v-if="$slots.actions || primaryLabel || secondaryActionLabel"
      class="mt-4 flex flex-wrap items-center justify-center gap-2"
    >
      <slot name="actions">
        <OButton
          v-if="primaryLabel"
          :variant="kind === 'first-run' ? 'primary' : 'secondary'"
          data-test="o2-empty-state-action"
          @click="onAction?.()"
        >
          {{ primaryLabel }}
        </OButton>
        <OButton
          v-if="secondaryActionLabel"
          variant="secondary"
          data-test="o2-empty-state-secondary-action"
          @click="onSecondaryAction?.()"
        >
          {{ secondaryActionLabel }}
        </OButton>
      </slot>
    </div>

    <div v-if="$slots.extra" class="mt-6 flex w-full flex-col items-center gap-2">
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
  size: "region",
});

defineSlots<EmptyStateSlots>();

const { t } = useI18nTyped();

const isCompact = computed(() => props.size === "compact");
const resolvedIcon = computed<IconName>(() => props.icon ?? KIND_ICON[props.kind]);
const iconTone = computed(() =>
  props.kind === "error" ? "text-status-error-text" : "text-text-secondary",
);

// The kind's own copy fills in only when the caller names nothing, so a set title keeps its own text.
const kindCopy = computed<{ title: I18nText; text: I18nText } | null>(() => {
  if (props.kind === "error")
    return { title: t("emptyState.loadError.title"), text: t("emptyState.loadError.description") };
  if (props.kind === "denied")
    return { title: t("emptyState.noAccess.title"), text: t("emptyState.noAccess.description") };
  if (props.kind === "filtered")
    return {
      title: t("emptyState.filtered.noMatches"),
      text: t("emptyState.filtered.noMatchesText"),
    };
  return null;
});
const resolvedTitle = computed(() => props.title ?? kindCopy.value?.title);
const resolvedText = computed(() => props.text ?? (props.title ? undefined : kindCopy.value?.text));

// A default label only appears when someone listens, so a dead button never renders.
const primaryLabel = computed<I18nText | undefined>(() => {
  if (props.actionLabel) return props.actionLabel;
  if (!props.onAction) return undefined;
  if (props.kind === "error") return t("emptyState.loadError.action");
  if (props.kind === "filtered") return t("emptyState.filtered.action");
  return undefined;
});
</script>
