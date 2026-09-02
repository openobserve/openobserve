<!-- Copyright 2026 OpenObserve Inc.

  The `{{variable}}` control for the bench: which variables exist, which of them
  any message actually references, and what each one is bound to.

  ONE control, above the bench, because the state behind it is one map shared by
  every column. Drawn per column it implied the values were per column, which
  they never were.
-->
<template>
  <ODropdown align="start" side="bottom">
    <template #trigger>
      <OButton
        variant="outline"
        size="xs"
        icon-left="data-array"
        data-test="ai-playground-variables-btn"
      >
        {{
          varNames.length
            ? t("aiObservability.playground.variablesCount", { count: varNames.length })
            : t("aiObservability.playground.variables")
        }}
        <!-- A value can sit here (e.g. just sampled) with no message
             referencing it yet — the toast on sample says so once; this dot
             is what still says so on the next glance, without opening the
             dropdown to find out. -->
        <span
          v-if="unusedWithValue.length"
          class="bg-accent ml-1 inline-block size-1.5 rounded-full"
          data-test="ai-playground-variables-unused-dot"
        />
      </OButton>
    </template>

    <div class="flex w-96 flex-col gap-2 p-2">
      <p v-if="!varNames.length" class="text-text-secondary m-0 text-xs leading-relaxed">
        {{ t("aiObservability.playground.noVariables", { token: variableToken }) }}
      </p>
      <p
        v-else-if="unusedWithValue.length"
        class="text-accent bg-accent/8 rounded-default m-0 px-2 py-1.5 text-xs leading-relaxed"
        data-test="ai-playground-var-unused-hint"
      >
        {{ t("aiObservability.playground.unusedSampledValue", { tokens: unusedTokensText }) }}
      </p>

      <div v-for="name in varNames" :key="name" class="flex flex-col gap-1">
        <div class="flex items-center gap-1.5">
          <!-- A variable can be declared and referenced by no message at all,
               which renders empty at run time. The tick is what separates the
               two. -->
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
          <!-- Text, not a button: typing `{{` in a message offers the same
               variables as completions, at the caret, which is where the token
               is wanted. A second way to insert only split the habit. -->
          <span
            class="text-accent text-2xs truncate font-mono font-semibold"
            :data-test="`ai-playground-var-chip-${name}`"
          >
            {{ tokenFor(name) }}
          </span>
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
          data-test="ai-playground-var-new"
        />
        <OTextarea
          v-model="newValue"
          :placeholder="t('aiObservability.playground.variableValuePlaceholder')"
          :rows="1"
          :max-rows="5"
          size="sm"
          autogrow
          data-test="ai-playground-var-new-value"
        />
        <OButton
          variant="outline"
          size="sm"
          type="submit"
          class="self-end"
          :disabled="!sanitized"
          data-test="ai-playground-var-add"
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
import { EXPECTED_OUTPUT_TOKEN } from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{
  /** Every variable on the bench: declared, or referenced by any variant. */
  varNames: string[];
  vars: Record<string, string>;
  /** Referenced by at least one variant — the rest are declared but unused. */
  used: string[];
}>();

const emit = defineEmits<{
  "set-var": [name: string, value: string];
  "remove-var": [name: string];
}>();

const { t } = useI18nTyped();

const newName = ref("");
const newValue = ref("");

const variableToken = raw("{{variables}}");
const expectedToken = raw(`{{${EXPECTED_OUTPUT_TOKEN}}}`);

const used = computed(() => props.used);

/** Declared, has a real value, but no message references it yet — the state
 *  a fresh sample leaves behind. Distinct from "declared, no value" (a
 *  manually-added variable someone hasn't filled in), which has nothing
 *  urgent to surface. */
const unusedWithValue = computed(() =>
  props.varNames.filter((name) => !used.value.includes(name) && (props.vars[name] ?? "").trim()),
);
const unusedTokensText = computed(() =>
  unusedWithValue.value.map((name) => tokenFor(name)).join(", "),
);

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
