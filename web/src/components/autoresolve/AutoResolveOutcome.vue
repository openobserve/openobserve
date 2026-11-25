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
    class="rounded-surface flex flex-col gap-2 border px-4 py-3"
    :class="TONE_CLASS[tone]"
    :data-verdict="outcome.verdict"
    :data-tone="tone"
    data-test="autoresolve-outcome"
  >
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 class="m-0 text-lg font-semibold" :class="TITLE_CLASS[tone]">{{ verdictLabel }}</h2>
      <span v-if="checkedAtUs" class="text-text-secondary text-xs">
        {{ t("autoresolve.run.outcome.checkedAt", { time: autoresolveWhen(checkedAtUs).text }) }}
      </span>
    </div>
    <p
      class="text-text-body m-0 text-sm wrap-anywhere whitespace-pre-wrap"
      data-test="autoresolve-outcome-summary"
    >
      {{ outcome.system_summary }}
    </p>
    <template v-if="outcome.explanation && !hideExplanation">
      <OText
        v-if="needs"
        variant="body"
        wrap
        class="text-text-body wrap-anywhere"
        data-test="autoresolve-outcome-explanation"
        >{{ needs }}</OText
      >
      <AutoResolveModelText
        v-else
        :text="outcome.explanation"
        class="text-sm"
        data-test="autoresolve-outcome-explanation"
      />
    </template>
    <OInlineNotice
      v-if="error"
      variant="error"
      wrap
      class="self-start"
      :text="t('autoresolve.run.outcome.error', { reason: raw(error) })"
      data-test="autoresolve-outcome-error"
    />
    <slot />
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OText from "@/lib/core/Typography/OText.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import AutoResolveModelText from "@/components/autoresolve/AutoResolveModelText.vue";
import type { AutoResolveOutcome } from "@/services/autoresolve";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  autoresolveWhen,
  needsText,
  OUTCOME_TITLE_CLASS as TITLE_CLASS,
  OUTCOME_TONE_CLASS as TONE_CLASS,
  type OutcomeTone,
} from "@/utils/autoresolve/autoresolveText";

const props = withDefaults(
  defineProps<{
    outcome: AutoResolveOutcome;
    /** When the check finished; null when the run has no check time. */
    checkedAtUs: number | null;
    /** The run's own error, shown apart from the model's explanation; null when the page shows it elsewhere. */
    error?: string | null;
    /** The missing-connection card already says what the fix needs. */
    hideExplanation?: boolean;
  }>(),
  { error: null, hideExplanation: false },
);

const { t } = useI18nTyped();

// The summary already says an earlier attempt made things worse; the tone is the only other mark.
const tone = computed<OutcomeTone>(() => {
  const { verdict, prior_verdict } = props.outcome;
  if (verdict === "worse") return "negative";
  if (prior_verdict === "worse") return "warning";
  return verdict === "worked" ? "positive" : "neutral";
});

const needs = computed(() => needsText(props.outcome.explanation, t));

const verdictLabel = computed(() => {
  switch (props.outcome.verdict) {
    case "worked":
      return t("autoresolve.state.worked");
    case "worse":
      return t("autoresolve.state.worse");
    default:
      return t("autoresolve.state.noChange");
  }
});
</script>
