<!-- Copyright 2026 OpenObserve Inc.

  The `{{token}}` chips above a variant's message list. Three states, and the
  state IS the information: referenced (the template uses it), available (the
  rows offer it, the template ignores it), missing (the template asks for a
  field no row provides, so it renders empty).

  Clicking a chip inserts at the caret, so the reference and the input method
  are the same control.
-->
<template>
  <div
    v-if="referenced.length || available.length || missing.length"
    class="flex flex-wrap items-center gap-1.5"
  >
    <span class="text-text-secondary text-2xs shrink-0">
      {{
        fields
          ? t("aiObservability.playground.rowFields")
          : t("aiObservability.playground.variables")
      }}
    </span>

    <OButton
      v-for="name in insertable"
      :key="name"
      type="button"
      variant="outline"
      size="chip"
      :title="
        referenced.includes(name)
          ? t('aiObservability.playground.chipReferenced')
          : t('aiObservability.playground.chipInsert')
      "
      :data-test="`ai-playground-var-chip-${name}`"
      @mousedown.prevent
      @click="emit('insert', name)"
    >
      <span class="font-mono">{{ tokenFor(name) }}</span>
    </OButton>

    <OTag
      v-for="name in missing"
      :key="`missing-${name}`"
      variant="warning"
      size="sm"
      :label="raw(tokenFor(name))"
      :title="t('aiObservability.playground.chipMissing')"
      :data-test="`ai-playground-var-chip-missing-${name}`"
    />

    <!-- Shown, not hidden: the rule is discoverable at the moment someone
         would otherwise reach for it. -->
    <OTag
      variant="default"
      size="sm"
      disabled
      :label="raw(expectedToken)"
      :title="t('aiObservability.playground.expectedLeakWarning', { token: expectedToken })"
      data-test="ai-playground-var-chip-expected"
    />
    <span class="text-text-secondary text-2xs">
      {{ t("aiObservability.playground.chipScorersOnly") }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import {
  EXPECTED_OUTPUT_TOKEN,
  extractVariantVars,
  type PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{
  variant: PlaygroundVariant;
  /** Row fields in table mode. Null in editor-bench mode, where the template's
   *  own variables are the whole vocabulary. */
  fields: string[] | null;
}>();

const emit = defineEmits<{ insert: [name: string] }>();

const { t } = useI18nTyped();

const expectedToken = `{{${EXPECTED_OUTPUT_TOKEN}}}`;

function tokenFor(name: string) {
  return `{{${name}}}`;
}

const used = computed(() =>
  extractVariantVars(props.variant).filter((name) => name !== EXPECTED_OUTPUT_TOKEN),
);

/** In table mode the rows define what exists; in bench mode the template does. */
const available = computed(() =>
  props.fields ? props.fields.filter((name) => !used.value.includes(name)) : [],
);

const referenced = computed(() =>
  props.fields ? used.value.filter((name) => props.fields!.includes(name)) : used.value,
);

/** Asked for by the template, offered by no row — it will render empty. */
const missing = computed(() =>
  props.fields ? used.value.filter((name) => !props.fields!.includes(name)) : [],
);

const insertable = computed(() => [...referenced.value, ...available.value]);
</script>
