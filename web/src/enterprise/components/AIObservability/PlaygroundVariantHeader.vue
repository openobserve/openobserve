<!-- Copyright 2026 OpenObserve Inc.

  The identity strip for one variant: which model it runs, its parameters, and
  the actions that operate on the column.

  Provider and model are ONE control. Picking a model is how the work actually
  starts — you know you want gemini-3.6-flash, not which of your providers
  happens to carry it — so the list is model-first and each row names its
  provider. Two selects made that two decisions and two clicks.
-->
<template>
  <div
    class="flex min-w-0 items-center gap-1.5"
    :data-test="`ai-playground-variant-header-${label}`"
  >
    <!-- One grower, not two. A bare spacer beside a `flex-1` select splits the
         free space between them, which stalled the select at half the room it
         could have used and showed the other half as a gap. -->
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <!-- Flexible with a ceiling, not a fixed width: four benches share the
           strip, and a rigid 12.5rem plus the actions overflows a column at its
           min-width. It grows to the same size when there is room. -->
      <!-- `<connection> : <model>` on one line. `option-tooltip` gives the row and
           the trigger a native tooltip carrying the untruncated pair, which is
           what a narrow bench column needs. -->
      <OSelect
        class="max-w-50 min-w-0 flex-1"
        :model-value="selectedKey"
        :options="modelOptions"
        :placeholder="t('aiObservability.playground.modelPlaceholder')"
        size="sm"
        searchable
        creatable
        option-tooltip
        :data-test="`ai-playground-model-${variant.id}`"
        @update:model-value="onPick"
        @create="onCreate"
      />

      <!-- Parameters live behind the gear, not in the column: they are set once
           and read never, while the messages below are edited constantly. -->
      <!-- Down and to the RIGHT of the gear: aligned to its end it grew leftward
           over the messages, covering the prompt the parameter is being set for. -->
      <ODropdown align="start" side="bottom">
        <template #trigger>
          <OButton
            variant="ghost-muted"
            size="icon-xs"
            icon-left="settings"
            class="shrink-0"
            :title="t('aiObservability.playground.variantSettings')"
            :data-test="`ai-playground-variant-settings-${label}`"
          />
        </template>
        <div class="flex w-56 flex-col gap-1 p-2">
          <span class="text-text-heading text-xs font-semibold">
            {{ t("aiObservability.playground.variantSettings") }}
          </span>
          <OInput
            :model-value="variant.temperature"
            type="number"
            min="0"
            max="2"
            step="0.1"
            :label="t('aiObservability.playground.temperature')"
            size="sm"
            :data-test="`ai-playground-temperature-${variant.id}`"
            @update:model-value="(value: string | number) => patch({ temperature: String(value) })"
          />
        </div>
      </ODropdown>
    </div>

    <!-- Icon only, and next to the gear rather than above the messages: like the
         parameters behind it, a response schema is set once and read never. The
         tinted background is the only thing that says one is in force, since
         there is no label left to qualify. -->
    <!-- The VARIANT carries the icon colour and the `!` carries the tint: every
         ghost variant hardcodes `bg-transparent`, and two utilities for one
         property resolve by stylesheet order, so an unmarked background loses
         to it silently. -->
    <OButton
      :variant="variant.responseSchema ? 'ghost-primary' : 'ghost-muted'"
      size="icon-xs"
      icon-left="data-object"
      class="shrink-0"
      :class="variant.responseSchema ? 'bg-accent/12!' : ''"
      :title="
        variant.responseSchema
          ? t('aiObservability.playground.schemaOn')
          : t('aiObservability.playground.schema')
      "
      :data-test="`ai-playground-schema-btn-${variant.id}`"
      @click="schemaOpen = true"
    />

    <!-- One button, not two: a blank column is almost never what someone wants
         next to a variant they have just tuned, so plus clones this one. -->
    <OButton
      variant="ghost-muted"
      size="icon-xs"
      class="shrink-0"
      icon-left="add"
      :disabled="!canDuplicate"
      :title="
        canDuplicate
          ? t('aiObservability.playground.duplicateVariant')
          : t('aiObservability.playground.variantLimit', { max: maxVariants })
      "
      :data-test="`ai-playground-variant-split-${label}`"
      @click="canDuplicate && emit('duplicate')"
    />
    <OButton
      variant="ghost-muted"
      size="icon-xs"
      class="shrink-0"
      icon-left="science"
      :title="t('aiObservability.playground.createExperiment')"
      :data-test="`ai-playground-variant-experiment-${label}`"
      @click="emit('create-experiment')"
    />
    <OButton
      variant="ghost-muted"
      size="icon-xs"
      class="shrink-0"
      icon-left="close"
      :disabled="!canRemove"
      :title="t('aiObservability.playground.removeVariant')"
      :data-test="`ai-playground-variant-close-${label}`"
      @click="canRemove && emit('remove')"
    />

    <PlaygroundSchemaDialog
      v-model:open="schemaOpen"
      :schema="variant.responseSchema"
      @apply="(responseSchema) => patch({ responseSchema })"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import PlaygroundSchemaDialog from "./PlaygroundSchemaDialog.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import {
  MAX_VARIANTS,
  type PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";
import type { Provider } from "@/services/online-evals.service";

/** Provider id and model travel as one select value but stay two fields on the
 *  variant — the run request, the experiment handoff and the draft titles all
 *  read them separately. */
const KEY_SEPARATOR = "::";

const props = withDefaults(
  defineProps<{
    variant: PlaygroundVariant;
    label: string;
    providers: Provider[];
    canRemove?: boolean;
    canDuplicate?: boolean;
  }>(),
  {
    canRemove: true,
    canDuplicate: true,
  },
);

const emit = defineEmits<{
  change: [variant: PlaygroundVariant];
  duplicate: [];
  remove: [];
  "create-experiment": [];
}>();

const { t } = useI18nTyped();

const maxVariants = MAX_VARIANTS;

const schemaOpen = ref(false);

/** Both halves or nothing: a key with an empty model matches no option, and an
 *  unmatched value is rendered by the select as the raw key — which reads as an
 *  id where a model name belongs. Empty shows the placeholder instead. */
const selectedKey = computed(() =>
  props.variant.providerId && props.variant.model
    ? keyFor(props.variant.providerId, props.variant.model)
    : "",
);

/** A provider with no list still offers its default, or it cannot be picked. */
function modelsOf(provider: Provider): string[] {
  const listed = provider.availableModels ?? provider.available_models ?? [];
  if (listed.length) return listed;
  const fallback = provider.defaultModel ?? provider.default_model ?? "";
  return fallback ? [fallback] : [];
}

const modelOptions = computed<SelectOption[]>(() => {
  const typed = props.variant.model;
  const options: SelectOption[] = [];
  for (const provider of props.providers) {
    const models = modelsOf(provider);
    // A hand-typed model belongs to the provider it was typed against.
    if (typed && provider.id === props.variant.providerId && !models.includes(typed)) {
      models.unshift(typed);
    }
    if (!models.length) {
      options.push({
        label: raw(provider.name),
        value: keyFor(provider.id, ""),
        disabled: true,
      });
      continue;
    }
    for (const model of models) {
      options.push({
        label: raw(`${provider.name} : ${model}`),
        value: keyFor(provider.id, model),
      });
    }
  }
  // A model whose provider is gone — deleted, or a draft restored from another
  // org — still has to render, or the trigger reads as "nothing selected".
  if (typed && !options.some((option) => option.value === selectedKey.value)) {
    const name = providerName.value || t("aiObservability.playground.providerUnknown");
    options.unshift({ label: raw(`${name} : ${typed}`), value: selectedKey.value });
  }
  return options;
});

const providerName = computed(
  () => props.providers.find((candidate) => candidate.id === props.variant.providerId)?.name ?? "",
);

function keyFor(providerId: string, model: string): string {
  return `${providerId}${KEY_SEPARATOR}${model}`;
}

function patch(changes: Partial<PlaygroundVariant>) {
  emit("change", { ...props.variant, ...changes });
}

function onPick(value: unknown) {
  const key = String(value ?? "");
  const at = key.indexOf(KEY_SEPARATOR);
  if (at === -1) return;
  patch({ providerId: key.slice(0, at), model: key.slice(at + KEY_SEPARATOR.length) });
}

/**
 * A typed model has no provider of its own, so it inherits one: the variant's
 * current provider first, then the org default. Without a fallback the name
 * would be unrunnable, and the failure would only surface at run time.
 */
function onCreate(model: string) {
  const fallback =
    props.providers.find((candidate) => candidate.isDefault ?? candidate.is_default) ??
    props.providers[0];
  const providerId = props.variant.providerId || fallback?.id || "";
  if (!providerId) return;
  patch({ providerId, model });
}
</script>
