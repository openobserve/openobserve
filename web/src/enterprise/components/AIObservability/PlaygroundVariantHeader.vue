<!-- Copyright 2026 OpenObserve Inc.

  The identity strip for one variant — letter, model, temperature, staleness,
  Run, and the overflow menu. Shared by the bench card and the compare-table
  column header so the two never drift.

  In `compact` mode the whole strip is a button that opens the variant config.
  It carries a visible pencil rather than relying on a coach mark: an affordance
  that has to be explained is one that has not been designed.
-->
<template>
  <div
    class="flex min-w-0 gap-1.5"
    :class="compact ? 'flex-col items-start' : 'items-center'"
    :data-test="`ai-playground-variant-header-${label}`"
  >
    <div class="flex w-full min-w-0 items-center gap-1.5">
      <component
        :is="compact ? 'button' : 'div'"
        :type="compact ? 'button' : undefined"
        class="flex min-w-0 items-center gap-1.5"
        :class="
          compact
            ? 'rounded-default hover:border-border-strong hover:bg-surface-base -mx-1.5 cursor-pointer border border-transparent px-1.5 py-0.5 text-left'
            : ''
        "
        :title="compact ? t('aiObservability.playground.editVariant') : undefined"
        :data-test="`ai-playground-variant-open-${label}`"
        @click="compact && emit('open-config')"
      >
        <span
          class="border-border-default bg-surface-secondary text-text-secondary rounded-default text-2xs inline-flex h-5 w-5 shrink-0 items-center justify-center border font-mono font-bold"
        >
          {{ label }}
        </span>
        <span class="text-text-heading truncate font-mono text-xs font-semibold">
          {{ variant.model || t("aiObservability.playground.modelPlaceholder") }}
        </span>
        <span class="text-text-secondary text-2xs shrink-0 font-mono">
          {{ temperatureLabel }}
        </span>
        <OBadge
          v-if="variant.stale"
          variant="warning"
          size="sm"
          :label="t('aiObservability.playground.stale')"
          :title="t('aiObservability.playground.staleTooltip')"
          :data-test="`ai-playground-variant-stale-${label}`"
        />
        <OIcon v-if="compact" name="edit" size="xs" class="text-text-secondary shrink-0" />
      </component>

      <div class="grow" />

      <OButton
        v-if="!compact"
        variant="outline"
        size="xs"
        :icon-left="running ? undefined : 'play-arrow'"
        :loading="running"
        :disabled="runDisabled"
        :title="t('aiObservability.playground.runVariant')"
        :data-test="`ai-playground-variant-run-${label}`"
        @click="emit('run')"
      >
        {{ t("aiObservability.playground.runVariant") }}
      </OButton>

      <ODropdown align="end">
        <template #trigger>
          <OButton
            variant="ghost-muted"
            size="icon-xs"
            icon-left="more-vert"
            :data-test="`ai-playground-variant-menu-${label}`"
          />
        </template>
        <ODropdownItem
          icon-left="play-arrow"
          :disabled="runDisabled"
          :data-test="`ai-playground-variant-menu-run-${label}`"
          @select="emit('run')"
        >
          {{ t("aiObservability.playground.runVariant") }}
        </ODropdownItem>
        <ODropdownItem
          icon-left="content-copy"
          :disabled="!canDuplicate"
          :title="
            canDuplicate
              ? undefined
              : t('aiObservability.playground.variantLimit', { max: maxVariants })
          "
          :data-test="`ai-playground-variant-menu-duplicate-${label}`"
          @select="canDuplicate && emit('duplicate')"
        >
          {{ t("aiObservability.playground.duplicateVariant") }}
        </ODropdownItem>
        <ODropdownItem
          icon-left="science"
          :data-test="`ai-playground-variant-menu-experiment-${label}`"
          @select="emit('create-experiment')"
        >
          {{ t("aiObservability.playground.createExperiment") }}
        </ODropdownItem>
        <ODropdownSeparator />
        <ODropdownItem
          variant="destructive"
          icon-left="delete"
          :disabled="!canRemove"
          :data-test="`ai-playground-variant-menu-remove-${label}`"
          @select="canRemove && emit('remove')"
        >
          {{ t("aiObservability.playground.removeVariant") }}
        </ODropdownItem>
      </ODropdown>
    </div>

    <!-- Two variants can share a model; the opening prompt line is what tells
         them apart at a glance. -->
    <span
      v-if="compact && summary.promptLine"
      class="text-text-secondary text-2xs w-full truncate font-mono"
      :title="summary.promptLine"
      :data-test="`ai-playground-variant-prompt-${label}`"
    >
      {{ summary.promptLine }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import {
  MAX_VARIANTS,
  variantSummary,
  type PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const props = withDefaults(
  defineProps<{
    variant: PlaygroundVariant;
    label: string;
    running?: boolean;
    runDisabled?: boolean;
    canRemove?: boolean;
    canDuplicate?: boolean;
    /** Table-header rendering: the strip itself opens the config dialog. */
    compact?: boolean;
  }>(),
  { running: false, runDisabled: false, canRemove: true, canDuplicate: true, compact: false },
);

const emit = defineEmits<{
  run: [];
  duplicate: [];
  remove: [];
  "create-experiment": [];
  "open-config": [];
}>();

const { t } = useI18nTyped();

const maxVariants = MAX_VARIANTS;

const temperatureLabel = computed(() => raw(`t=${props.variant.temperature}`));

const summary = computed(() => variantSummary(props.variant));
</script>
