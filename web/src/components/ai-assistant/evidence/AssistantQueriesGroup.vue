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
  <section
    v-if="queries.length"
    ref="root"
    role="group"
    :aria-labelledby="headingId"
    class="flex min-w-0 flex-col gap-1"
    data-test="assistant-queries-group"
  >
    <div class="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
      <OText :id="headingId" variant="label" as="h3" class="leading-5">
        {{ t("assistant.evidence.queriesHeading") }}
      </OText>
      <OText v-if="cited.length" variant="meta" data-test="assistant-queries-cited">
        · {{ t("assistant.evidence.queriesCited", { count: cited.length }, cited.length) }}
      </OText>
    </div>
    <ul class="flex min-w-0 flex-col gap-0.5">
      <li v-for="step in shown" :key="step.callId" class="flex min-w-0 flex-col">
        <OButton
          variant="ghost"
          size="sm"
          :aria-expanded="opened.includes(step.callId) ? 'true' : 'false'"
          :class="['w-full min-w-0 justify-start', TOUCH_TARGET_CLASS]"
          :data-test="`assistant-queries-row-${step.callId}`"
          @click="toggle(step.callId)"
        >
          <OIcon
            :name="opened.includes(step.callId) ? assistantGlyph.collapse : assistantGlyph.expand"
            size="sm"
            aria-hidden="true"
          />
          <OTag
            v-if="numbers.get(step.callId)"
            type="assistantClaim"
            value="available"
            :label="raw(String(numbers.get(step.callId)))"
            :aria-label="t('assistant.claim.peekTitle', { n: numbers.get(step.callId)! })"
          />
          <OTruncatedText class="text-text-body min-w-0 flex-1 text-start text-xs">{{
            stepLine(step, t)
          }}</OTruncatedText>
        </OButton>
        <div v-if="opened.includes(step.callId)" class="min-w-0 ps-7 pe-1 pt-1 pb-2">
          <AssistantStepEvidence
            :step="step"
            surface="query"
            :sid="turn?.sid ?? null"
            :readonly="readonly"
            :openable="turn?.openable ?? true"
            @show-in-steps="actions.showInSteps(step, root)"
          />
        </div>
      </li>
    </ul>
    <OButton
      v-if="hidden.length && !showMore"
      variant="ghost"
      size="sm"
      :class="['self-start', TOUCH_TARGET_CLASS]"
      data-test="assistant-queries-more"
      @click="showMore = true"
    >
      {{ t("assistant.evidence.showMore", { count: hidden.length }, hidden.length) }}
    </OButton>
  </section>
</template>

<script lang="ts">
import type { StepFacts } from "@/composables/assistant/pure";

/** The answer's executed queries in reading order: cited ones first by claim number, then the rest as they ran (D3-h). */
export function orderedQueries(
  steps: StepFacts[],
  numbers: Map<string, number>,
): { cited: StepFacts[]; rest: StepFacts[] } {
  const ran = steps.filter((step) => !!step.query && step.state === "done");
  const cited = ran
    .filter((step) => numbers.has(step.callId))
    .sort((a, b) => numbers.get(a.callId)! - numbers.get(b.callId)!);
  return { cited, rest: ran.filter((step) => !numbers.has(step.callId)) };
}
</script>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import { stepsOf, type AssistantTurnView } from "@/composables/assistant/pure";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw, useI18nTyped } from "@/types/i18n";

import AssistantStepEvidence from "./AssistantStepEvidence.vue";
import { stepLine } from "./evidenceText";
import { useStepActions } from "./useStepActions";

const props = withDefaults(
  defineProps<{
    message: ChatMessage;
    /** Claim numbers by call id, shared with the prose chips. */
    numbers: Map<string, number>;
    readonly?: boolean;
    turn?: AssistantTurnView | null;
  }>(),
  { readonly: false, turn: null },
);

const { t } = useI18nTyped();
const headingId = `assistant-queries-${useId()}`;
const root = ref<HTMLElement | null>(null);
const showMore = ref(false);
const actions = useStepActions(
  () => props.turn?.sid ?? null,
  () => props.readonly,
  "query",
);

const steps = computed(() =>
  props.turn?.hiddenByOwner ? [] : stepsOf(props.message, props.turn?.org ?? ""),
);
const ordered = computed(() => orderedQueries(steps.value, props.numbers));
const cited = computed(() => ordered.value.cited);
const queries = computed(() => [...ordered.value.cited, ...ordered.value.rest]);
// With no citation the first query still shows, so the group never opens on a lone "Show more".
const lead = computed(() => (cited.value.length ? cited.value : ordered.value.rest.slice(0, 1)));
const hidden = computed(() => queries.value.slice(lead.value.length));
const shown = computed(() => (showMore.value ? queries.value : lead.value));

const opened = ref<string[]>([]);

function toggle(callId: string): void {
  opened.value = opened.value.includes(callId)
    ? opened.value.filter((id) => id !== callId)
    : [...opened.value, callId];
}

// The lead opens once, when cited or alone; the reader's own toggles are kept after that.
watch(
  () => lead.value[0]?.callId,
  (first, before) => {
    if (first && !before && (cited.value.length > 0 || queries.value.length === 1))
      opened.value = [first];
  },
  { immediate: true },
);
</script>
