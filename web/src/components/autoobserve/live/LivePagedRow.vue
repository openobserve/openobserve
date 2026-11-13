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
  <!-- The whole row opens the issue by mouse; the title button is its keyboard and screen-reader target. -->
  <article
    class="group hover:bg-surface-subtle-hover flex w-full cursor-pointer items-stretch gap-4 px-5 py-4 transition-colors sm:px-6"
    :data-test="`autoobserve2-paged-row-${index}`"
    @click="open"
  >
    <span
      class="w-1 shrink-0 rounded-full"
      :class="OUTCOME[row.outcome].marker"
      :data-outcome="row.outcome"
      data-test="autoobserve2-paged-rail"
    />
    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
      <button
        ref="titleEl"
        type="button"
        class="text-text-heading focus-visible:ring-focus-ring-accent rounded-default self-start text-start text-base leading-snug font-semibold text-pretty focus-visible:ring-2 focus-visible:outline-none"
        data-test="autoobserve2-paged-sentence"
        @click.stop="open"
      >
        {{ row.title }}
      </button>
      <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          class="text-text-secondary text-sm tabular-nums"
          data-test="autoobserve2-paged-opened"
        >
          {{ row.opened }}
          <OTooltip :content="row.openedAt" />
        </span>
        <span
          v-if="row.stream"
          class="text-text-secondary max-w-[16rem] truncate text-sm"
          data-test="autoobserve2-paged-stream"
          >· {{ row.stream }}</span
        >
        <OTag
          type="severity"
          :value="row.severity"
          size="sm"
          class="shrink-0"
          data-test="autoobserve2-paged-severity"
        />
        <OTag
          type="incidentStatus"
          :value="row.status"
          :label="row.statusText"
          size="sm"
          class="shrink-0"
          data-test="autoobserve2-paged-status"
        />
      </span>
      <div class="flex h-5 min-w-0 items-center gap-1.5">
        <OBadge
          :variant="RCA_BADGE_VARIANT[row.analysis.tone]"
          size="sm"
          class="shrink-0"
          :data-tone="row.analysis.tone"
          data-test="autoobserve2-paged-analysis"
        >
          <template v-if="row.analysis.spinner" #icon>
            <OSpinner size="xs" />
          </template>
          {{ row.analysis.label }}
        </OBadge>
        <OTruncatedText
          v-if="row.analysis.detail && !sharedAnalysis"
          class="text-text-secondary text-xs"
          data-test="autoobserve2-paged-analysis-detail"
          >{{ row.analysis.detail }}</OTruncatedText
        >
      </div>
      <p
        v-if="row.copy.page"
        class="flex items-start gap-1.5 text-xs leading-5"
        :class="PAGE_TONE[row.copy.page.tone].text"
        :data-tone="row.copy.page.tone"
        data-test="autoobserve2-paged-page"
      >
        <OIcon :name="PAGE_TONE[row.copy.page.tone].icon" size="xs" class="mt-1 shrink-0" />
        <span>{{ row.copy.page.text }}</span>
      </p>
      <p
        v-if="row.copy.why"
        class="text-text-secondary max-w-[70ch] text-sm leading-relaxed text-pretty"
        data-test="autoobserve2-paged-why"
      >
        {{ row.copy.why }}
      </p>
      <p
        v-if="row.copy.next"
        class="text-text-secondary text-xs leading-5"
        data-test="autoobserve2-paged-next"
      >
        {{ row.copy.next }}
      </p>
      <IssueSignal
        class="mt-1 sm:hidden"
        :stream="row.signal"
        :active="row.status !== 'resolved'"
        :anchor-us="row.signal?.firstSeenUs ?? null"
      />
      <div
        class="-ms-2.5 flex cursor-auto flex-wrap items-center gap-1"
        data-test="autoobserve2-paged-actions"
        @click.stop
      >
        <slot name="actions" />
      </div>
    </div>
    <IssueSignal
      class="hidden w-40 shrink-0 self-center sm:flex"
      :stream="row.signal"
      :active="row.status !== 'resolved'"
      :anchor-us="row.signal?.firstSeenUs ?? null"
    />
    <OIcon
      name="chevron-right"
      size="sm"
      class="text-text-muted group-hover:text-text-secondary shrink-0 self-center transition-transform group-hover:translate-x-0.5"
    />
  </article>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { I18nText } from "@/types/i18n";
import type { Incident } from "@/services/incidents";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { RCA_BADGE_VARIANT } from "@/utils/incidents/rcaCell";
import type { PageLine } from "../insight/kindCopy";
import type { ProblemOutcome } from "../v2/outcome";
import { OUTCOME } from "../v2/outcome";
import type { AnalysisLine } from "./incidentsCopy";
import IssueSignal from "./IssueSignal.vue";
import type { IssueStreamInfo } from "./issueModel";

export interface LivePagedRowView {
  id: string;
  title: I18nText;
  opened: I18nText;
  openedAt: I18nText;
  stream: string | null;
  severity: Incident["severity"];
  status: Incident["status"];
  statusText: I18nText;
  outcome: ProblemOutcome;
  analysis: AnalysisLine;
  copy: { page?: PageLine | null; why?: I18nText | null; next?: I18nText | null };
  /** The lead stream the sparkline plots; null when the incident names none. */
  signal: IssueStreamInfo | null;
}

defineProps<{
  row: LivePagedRowView;
  index: number;
  sharedAnalysis?: boolean;
}>();

const emit = defineEmits<{ open: [] }>();

const PAGE_TONE: Record<PageLine["tone"], { icon: string; text: string }> = {
  neutral: { icon: "check", text: "text-text-secondary" },
  pending: { icon: "schedule", text: "text-text-secondary" },
  warning: { icon: "warning", text: "text-badge-amber-soft-text" },
  error: { icon: "warning", text: "text-status-error-text" },
};

const titleEl = ref<HTMLButtonElement | null>(null);

// The drawer hands focus back to whatever held it on open, so a mouse open still returns to this row.
const open = () => {
  titleEl.value?.focus({ preventScroll: true });
  emit("open");
};
</script>
