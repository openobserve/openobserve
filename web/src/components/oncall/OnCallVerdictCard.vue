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

<!--
  The L0 agent's verdict, surfaced where the responder reads at 3am (C13).

  The timeline renders the same events as rows; this card exists because a
  machine recommendation that decided who got woken must not be buried
  mid-thread. The bodies are the server's own sentences — cause, confidence,
  report reference, recommendation, and what the engine did with the severity
  suggestion — rendered verbatim, never recomposed (the structured verdict
  never reaches the wire; the sentence is the contract).

  §G.7: the default deployment has no agent and emits no event, and it is
  indistinguishable from a broken one. So this card renders NOTHING until a
  verdict event exists — an "analysis" panel that sits empty forever would
  read as a product defect on every deployment without L0.

  C14 rides here too: a promotion is its own line, appended — never an edit
  to anything already shown — and the server's sentence carries both facts
  (asked-for beside applied, including the clamped and refused cases).
-->
<template>
  <div
    v-if="verdict"
    class="card-container rounded-surface bg-surface-base border-border-default flex flex-col gap-2 border px-4 py-3"
    data-test="oncall-verdict-card"
  >
    <span class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <OText variant="panel-title">{{ t("oncall.verdictTitle") }}</OText>
      <span class="text-text-secondary text-xs">
        {{ raw(verdict.actor) }} · <OTimeCell :value="verdict.at" unit="us" />
      </span>
    </span>

    <p class="text-text-body text-sm" data-test="oncall-verdict-body">
      {{ raw(verdict.body) }}
    </p>

    <!-- Two facts, one line, the server's words: what was asked for and what
         was applied. A clamped or refused promotion is the feature working. -->
    <p
      v-if="promotion"
      class="text-status-error-text text-sm"
      data-test="oncall-verdict-promotion"
    >
      {{ raw(promotion.body) }}
    </p>

    <!-- The verdict never edits the page that already went out — it rides as
         one follow-up. Saying so heads off "why didn't my page update". -->
    <span class="text-text-muted text-xs">{{ t("oncall.verdictFollowUpNote") }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { OnCallResponseEvent } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<{ events?: OnCallResponseEvent[] }>(), {
  events: () => [],
});

const { t } = useI18nTyped();

/// The latest of each kind: attach_verdict is idempotent and a second verdict
/// for the same firing overwrites the analysis, so the newest event is the
/// one that stands.
function latest(kind: OnCallResponseEvent["kind"]): OnCallResponseEvent | null {
  const matching = props.events.filter((event) => event.kind === kind);
  return matching.length ? matching.reduce((a, b) => (b.at >= a.at ? b : a)) : null;
}

const verdict = computed(() => latest("ai_verdict"));
const promotion = computed(() => latest("severity_promoted"));
</script>
