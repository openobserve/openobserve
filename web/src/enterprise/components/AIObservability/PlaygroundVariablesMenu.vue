<!-- Copyright 2026 OpenObserve Inc.

  The `{{variable}}` control for one variant: which variables exist, which of
  them THIS variant actually references, and what each one is bound to.

  It lives beside Tools and Schema rather than in a strip above the bench.
  Variables are shared by every column, so a row of inputs at the top spent the
  full page width on something only some variants use — and pushed the outputs
  it exists to feed off the screen.
-->
<template>
  <ODropdown align="start" side="bottom">
    <template #trigger>
      <OButton
        variant="outline"
        size="xs"
        icon-left="data-array"
        :data-test="`ai-playground-variables-btn-${variant.id}`"
      >
        {{
          varNames.length
            ? t("aiObservability.playground.variablesCount", { count: varNames.length })
            : t("aiObservability.playground.variables")
        }}
      </OButton>
    </template>

    <div class="flex w-96 flex-col gap-2 p-2">
      <p v-if="!varNames.length" class="text-text-secondary m-0 text-xs leading-relaxed">
        {{ t("aiObservability.playground.noVariables", { token: variableToken }) }}
      </p>

      <div v-for="name in varNames" :key="name" class="flex flex-col gap-1">
        <div class="flex items-center gap-1.5">
          <!-- The tick is the whole point of listing them per variant: a
               variable can exist on the bench and be referenced by none of the
               messages in THIS column, which renders empty at run time. -->
          <OIcon
            :name="used.includes(name) ? 'check-circle' : 'radio-button-unchecked'"
            size="xs"
            class="shrink-0"
            :class="used.includes(name) ? 'text-status-success-text' : 'text-text-muted'"
            :title="
              used.includes(name)
                ? t('aiObservability.playground.variableUsed')
                : t('aiObservability.playground.variableUnused')
            "
          />
          <button
            type="button"
            class="text-accent text-2xs cursor-pointer truncate font-mono font-semibold"
            :title="t('aiObservability.playground.chipInsert')"
            :data-test="`ai-playground-var-chip-${name}`"
            @mousedown.prevent
            @click="emit('insert', name)"
          >
            {{ tokenFor(name) }}
          </button>
          <div class="grow" />
          <OButton
            v-if="!used.includes(name)"
            variant="ghost-muted"
            size="icon-xs-sq"
            icon-left="close"
            :title="t('aiObservability.playground.removeVariable')"
            :data-test="`ai-playground-var-remove-${name}`"
            @click="emit('remove-var', name)"
          />
        </div>
        <OTextarea
          :model-value="vars[name] ?? ''"
          :placeholder="t('aiObservability.playground.variablePlaceholder', { name })"
          :rows="1"
          :max-rows="5"
          size="sm"
          autogrow
          :data-test="`ai-playground-var-input-${name}`"
          @update:model-value="(value: string) => emit('set-var', name, value)"
        />
      </div>

      <OSeparator v-if="varNames.length" />

      <!-- Name AND value together: a variable is only useful once it is bound,
           and adding the token then hunting for its field is two steps for one
           intent. Adding only DECLARES it — writing `{{name}}` into a prompt is
           a separate click on the token, because where it goes is a decision
           the form cannot make. -->
      <form class="flex flex-col gap-1.5" @submit.prevent="submitNew">
        <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
          {{ t("aiObservability.playground.addVariable") }}
        </span>
        <OInput
          v-model="newName"
          :placeholder="t('aiObservability.playground.variableNamePlaceholder')"
          size="sm"
          :data-test="`ai-playground-var-new-${variant.id}`"
        />
        <OTextarea
          v-model="newValue"
          :placeholder="t('aiObservability.playground.variableValuePlaceholder')"
          :rows="1"
          :max-rows="5"
          size="sm"
          autogrow
          :data-test="`ai-playground-var-new-value-${variant.id}`"
        />
        <OButton
          variant="outline"
          size="sm"
          type="submit"
          class="self-end"
          :disabled="!sanitized"
          :data-test="`ai-playground-var-add-${variant.id}`"
        >
          {{ t("common.add") }}
        </OButton>
      </form>

      <p class="text-text-secondary text-2xs m-0 leading-relaxed">
        {{ t("aiObservability.playground.expectedLeakWarning", { token: expectedToken }) }}
      </p>
    </div>
  </ODropdown>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import {
  EXPECTED_OUTPUT_TOKEN,
  extractVariantVars,
  type PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{
  variant: PlaygroundVariant;
  /** Every variable on the bench, not just this variant's. */
  varNames: string[];
  vars: Record<string, string>;
}>();

const emit = defineEmits<{
  "set-var": [name: string, value: string];
  "remove-var": [name: string];
  insert: [name: string];
}>();

const { t } = useI18nTyped();

const newName = ref("");
const newValue = ref("");

const variableToken = raw("{{variables}}");
const expectedToken = raw(`{{${EXPECTED_OUTPUT_TOKEN}}}`);

const used = computed(() => extractVariantVars(props.variant));

/** A token is `{{name}}`, so anything that would not survive the braces is not
 *  a name. Trimmed to the identifier characters rather than rejected, so a
 *  pasted `{{foo}}` still resolves to `foo`. */
const sanitized = computed(() =>
  props.varNames.includes(clean(newName.value)) ? "" : clean(newName.value),
);

function clean(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "");
}

function tokenFor(name: string) {
  return raw(`{{${name}}}`);
}

/** Declares the variable and its value. It does NOT touch the messages —
 *  inserting the token is a separate, deliberate click on the token itself. */
function submitNew() {
  const name = sanitized.value;
  if (!name) return;
  emit("set-var", name, newValue.value);
  newName.value = "";
  newValue.value = "";
}
</script>
