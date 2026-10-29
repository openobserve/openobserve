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
  <div class="flex min-w-0 flex-col gap-2" :data-test="`assistant-step-evidence-${step.callId}`">
    <OText
      variant="meta"
      as="p"
      class="leading-5 break-words"
      data-test="assistant-step-evidence-line"
    >
      {{ summary }}
    </OText>
    <AssistantQueryText
      v-if="step.query"
      :text="step.query.text"
      :language="step.query.language"
      :label="t('assistant.evidence.resultsOf', { name: stepLine(step, t) })"
      :data-test="`assistant-step-evidence-query-${step.callId}`"
    />
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <OButton
        v-if="runnable"
        variant="secondary"
        size="sm"
        as="a"
        :href="actions.hrefOf(step)"
        :target="actions.opensElsewhere.value ? '_blank' : undefined"
        :rel="actions.opensElsewhere.value ? 'noopener noreferrer' : undefined"
        :icon-left="assistantGlyph.run"
        :icon-right="actions.opensElsewhere.value ? assistantGlyph.newTab : undefined"
        :class="TOUCH_TARGET_CLASS"
        data-test="assistant-step-evidence-run"
        @click="actions.open(step, $event)"
      >
        {{ t("assistant.evidence.runNow") }}
        <OTooltip :content="runHint" />
      </OButton>
      <AssistantIconButton
        v-if="step.query"
        :label="t('assistant.query.copy')"
        :icon="assistantGlyph.copy"
        data-test="assistant-step-evidence-copy"
        @click="actions.copy(step)"
      />
      <OButton
        variant="ghost-primary"
        size="sm"
        :class="TOUCH_TARGET_CLASS"
        data-test="assistant-step-evidence-show"
        @click="emit('show-in-steps')"
      >
        {{ t("assistant.claim.showInSteps") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import type { Sid, StepFacts } from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { explorerOf } from "@/utils/assistant/explorerRoutes";
import { formatCount } from "@/utils/formatters";

import AssistantQueryText from "./AssistantQueryText.vue";
import { explorerLabel, rangeText, stepLine } from "./evidenceText";
import { useStepActions, type StepActionSurface } from "./useStepActions";

const props = withDefaults(
  defineProps<{
    step: StepFacts;
    surface: StepActionSurface;
    sid?: Sid | null;
    readonly?: boolean;
    /** False on a readonly page with no explorer behind it. */
    openable?: boolean;
  }>(),
  { sid: null, readonly: false, openable: true },
);

const emit = defineEmits<{ (e: "show-in-steps"): void }>();

const { t } = useI18nTyped();
const actions = useStepActions(
  () => props.sid,
  () => props.readonly,
  props.surface,
);

// Run now only loads the query into its explorer; a VRL or regex step has none.
const runnable = computed(
  () =>
    props.openable && !!props.step.query && ["sql", "promql"].includes(props.step.query.language),
);

const runHint = computed<I18nText>(() =>
  t("assistant.evidence.runNowHint", {
    explorer: explorerLabel(props.step.query ? explorerOf(props.step.query) : "logs", t),
  }),
);

// What the assistant itself got, never a fresh result: the step's own count and window.
const summary = computed<I18nText>(() => {
  const step = props.step;
  if (!step.query || step.rows === null) return stepLine(step, t);
  const count = formatCount(step.rows);
  return step.range
    ? t("assistant.evidence.sawRowsIn", { count, range: rangeText(step.range) }, step.rows)
    : t("assistant.evidence.sawRows", { count }, step.rows);
});
</script>
