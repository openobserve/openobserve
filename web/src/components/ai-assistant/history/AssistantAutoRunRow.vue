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
  <li class="min-w-0" data-test="assistant-auto-run" :data-run="run.run_id" :data-mark="mark">
    <OButton
      variant="ghost"
      size="sm"
      block
      :aria-label="t('assistant.history.autoRuns.openName', { title, state })"
      class="h-auto! min-h-8 min-w-0 justify-start! gap-2 py-1.5 text-start max-md:min-h-11 pointer-coarse:min-h-11"
      data-test="assistant-auto-run-open"
      @click="emit('open', run)"
    >
      <span class="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        <AssistantStatusDot v-if="mark === 'working'" state="working" />
        <OIcon v-else :name="MARK_GLYPH[mark]" size="xs" :class="MARK_CLASS[mark]" />
      </span>
      <span class="flex min-w-0 flex-1 flex-col">
        <OTruncatedText class="text-text-heading min-w-0 text-sm">{{ title }}</OTruncatedText>
        <span class="text-text-secondary text-xs" data-test="assistant-auto-run-state">{{
          state
        }}</span>
      </span>
      <span class="text-text-secondary shrink-0 text-xs tabular-nums">{{ time }}</span>
    </OButton>
  </li>
</template>

<script lang="ts">
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { OrgRcaRun } from "@/services/rca_runs_org";

/** How a run's state reads in a list: a working dot, a check, a plain stop, or the error glyph (never red text). */
export type RunMark = "working" | "done" | "stopped" | "failed";

const MARK_GLYPH: Record<Exclude<RunMark, "working">, IconName> = {
  done: assistantGlyph.done,
  stopped: assistantGlyph.stopped,
  failed: assistantGlyph.failed,
};

// A failed auto-run is an error glyph beside neutral text, never a severity colour (H4).
const MARK_CLASS: Record<Exclude<RunMark, "working">, string> = {
  done: "text-text-secondary",
  stopped: "text-text-secondary",
  failed: "text-status-error-text",
};
</script>

<script setup lang="ts">
import { computed } from "vue";

import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

/** The mark a run shows in its status slot. */
function runMark(run: Pick<OrgRcaRun, "state">): RunMark {
  switch (run.state) {
    case "running":
    case "waiting_input":
      return "working";
    case "completed":
      return "done";
    case "cancelled":
      return "stopped";
    default:
      return "failed";
  }
}

/** The run's state in the words the incident page already uses. */
function runStateLabel(run: Pick<OrgRcaRun, "state">, t: TranslateFn): I18nText {
  switch (run.state) {
    case "running":
      return t("alerts.incidents.rcaRun.state.investigating");
    case "waiting_input":
      return t("alerts.incidents.rcaRun.state.waitingInput");
    case "completed":
      return t("alerts.incidents.rcaRun.state.analyzed");
    case "cancelled":
      return t("alerts.incidents.rcaRun.state.cancelled");
    default:
      return t("alerts.incidents.rcaRun.state.failed");
  }
}

/** The run's title: the incident's own, else its id. */
function runTitle(run: Pick<OrgRcaRun, "incident_title" | "incident_id">): I18nText {
  return raw(run.incident_title?.trim() || run.incident_id);
}

const props = defineProps<{ run: OrgRcaRun }>();

const emit = defineEmits<{ open: [run: OrgRcaRun] }>();

const { t } = useI18nTyped();

const mark = computed(() => runMark(props.run));
const title = computed(() => runTitle(props.run));
const state = computed(() => runStateLabel(props.run, t));
const time = computed(() => raw(formatOrgTime(Math.floor(props.run.started_at / 1000))));
</script>
