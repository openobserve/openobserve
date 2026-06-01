<template>
  <aside class="eval-form-page__side eval-form-page__side--test">
    <section class="eval-test-panel">
      <h3>
        <OIcon name="play-arrow" size="xs" />
        {{ t("onlineEvals.scorer.testPanel.title") }}
      </h3>
      <p>{{ t("onlineEvals.scorer.testPanel.hint") }}</p>

      <div v-if="variables.length" class="eval-test-panel__fields">
        <label v-for="variable in variables" :key="variable">
          <code v-text="formatTemplateVariable(variable)" />
          <textarea
            :value="inputs[variable]"
            :rows="variable === 'metadata' ? 2 : 3"
            :placeholder="t('onlineEvals.scorer.testPanel.valuePlaceholder', { variable })"
            @input="updateInput(variable, ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
      </div>

      <div v-else class="eval-test-panel__empty">
        {{ t("onlineEvals.scorer.testPanel.emptyPrefix") }}<code v-text="'{{ input }}'" />{{ t("onlineEvals.scorer.testPanel.emptySuffix") }}
      </div>

      <div class="eval-test-panel__actions">
        <OButton
          type="button"
          icon-left="play-arrow"
          :loading="state === 'running'"
          :disabled="variables.length === 0"
          @click="$emit('run')"
        >
          {{ t("onlineEvals.scorer.testPanel.runButton") }}
        </OButton>
      </div>

      <div class="eval-test-panel__result" :class="`is-${state}`">
        <template v-if="state === 'idle'">{{ t("onlineEvals.scorer.testPanel.stateIdle") }}</template>
        <template v-else-if="state === 'running'">{{ t("onlineEvals.scorer.testPanel.stateRunning") }}</template>
        <template v-else-if="state === 'success'">
          <strong>{{ t("onlineEvals.scorer.testPanel.successHeader") }}</strong>
          <span>{{ t("onlineEvals.scorer.testPanel.successScore") }}</span>
          <small>{{ t("onlineEvals.scorer.testPanel.successReasoning") }}</small>
        </template>
        <template v-else>
          <strong>{{ t("onlineEvals.scorer.testPanel.schemaHeader") }}</strong>
          <small>{{ t("onlineEvals.scorer.testPanel.schemaHint") }}</small>
        </template>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { formatTemplateVariable } from "../../utils/evalFormat";

type TestState = "idle" | "running" | "success" | "error";

const props = defineProps<{
  variables: string[];
  inputs: Record<string, string>;
  state: TestState;
}>();

const emit = defineEmits<{
  (e: "run"): void;
  (e: "update:inputs", value: Record<string, string>): void;
}>();

const { t } = useI18n();

function updateInput(variable: string, value: string) {
  emit("update:inputs", { ...props.inputs, [variable]: value });
}
</script>
