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
  <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1" data-test="autoresolve-verdicts">
    <section
      class="rounded-surface flex min-w-0 flex-col gap-1 border px-4 py-3"
      :class="OUTCOME_TONE_CLASS[agentTone]"
      data-test="autoresolve-verdicts-agent"
    >
      <span class="text-text-secondary text-xs">{{ t("autoresolve.verdict.agent") }}</span>
      <span class="text-sm font-semibold" :class="OUTCOME_TITLE_CLASS[agentTone]">
        {{ agentLabel }}
      </span>
      <span class="text-text-body text-compact wrap-anywhere">
        <span v-if="verdict.agent_explanation">{{ verdict.agent_explanation }}</span>
        <span v-if="verdict.agent_checked_at_us" class="ms-1">
          {{
            t("autoresolve.run.outcome.checkedAt", {
              time: autoresolveTime(verdict.agent_checked_at_us),
            })
          }}
        </span>
      </span>
    </section>
    <section
      class="rounded-surface flex min-w-0 flex-col gap-1 border px-4 py-3"
      :class="OUTCOME_TONE_CLASS[personTone]"
      :data-verdict="verdict.verdict"
      data-test="autoresolve-verdicts-person"
    >
      <span class="text-text-secondary text-xs wrap-anywhere">{{ verdict.by }}</span>
      <span class="text-sm font-semibold" :class="OUTCOME_TITLE_CLASS[personTone]">
        {{ personLabel }}
      </span>
      <span class="text-text-body text-compact wrap-anywhere">{{ personDetail }}</span>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { resolveBadgeLabel } from "@/lib/core/Badge/badgeGroups";
import type { AutoResolvePersonVerdict } from "@/services/autoresolve";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  autoresolveTime,
  OUTCOME_TITLE_CLASS,
  OUTCOME_TONE_CLASS,
  type OutcomeTone,
} from "@/utils/autoresolve/autoresolveText";

const props = defineProps<{ verdict: AutoResolvePersonVerdict }>();

const { t } = useI18nTyped();

const agentTone = computed<OutcomeTone>(() => {
  if (props.verdict.agent_verdict === "worked") return "positive";
  return props.verdict.agent_verdict === "worse" ? "negative" : "neutral";
});
const personTone = computed<OutcomeTone>(() =>
  props.verdict.verdict === "fixed" ? "positive" : "warning",
);

const agentLabel = computed(() =>
  props.verdict.agent_verdict
    ? resolveBadgeLabel("autoresolveRunState", props.verdict.agent_verdict)
    : t("autoresolve.state.outcomeUnknown"),
);
const personDetail = computed(() => {
  const time = autoresolveTime(props.verdict.at_us);
  const note = props.verdict.note?.trim();
  return note ? t("autoresolve.verdict.noteAt", { note: raw(note), time }) : raw(time);
});
const personLabel = computed(() =>
  props.verdict.verdict === "fixed"
    ? t("autoresolve.verdict.fixed")
    : t("autoresolve.verdict.notFixed"),
);
</script>
