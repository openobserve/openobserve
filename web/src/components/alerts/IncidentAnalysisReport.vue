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
  <div class="flex min-w-0 gap-4 max-lg:flex-col" data-test="rca-report-area">
    <OSelect
      v-if="sections.length > 1"
      :model-value="jumped"
      :options="sections"
      :label="t('assistant.rca.jumpTo')"
      :searchable="false"
      width="full"
      class="bg-surface-base sticky top-0 z-1 lg:hidden"
      data-test="rca-jump-to"
      @update:model-value="(value) => jump(String(value))"
    />
    <nav
      v-if="sections.length > 1"
      :aria-label="t('assistant.rca.jumpTo')"
      class="sticky top-0 flex max-h-[70vh] w-56 shrink-0 flex-col gap-0.5 self-start overflow-y-auto max-lg:hidden"
      data-test="rca-jump-list"
    >
      <OButton
        v-for="section in sections"
        :key="section.value"
        variant="ghost"
        size="sm"
        :class="['justify-start text-start whitespace-normal', section.depth === 3 && 'ps-5']"
        @click="jump(section.value)"
      >
        {{ section.label }}
      </OButton>
    </nav>
    <article
      ref="article"
      :aria-label="t('assistant.rca.reportRegion')"
      :aria-busy="live"
      class="min-w-0 flex-1 [&_h2]:scroll-mt-14 [&_h3]:scroll-mt-14"
      data-test="rca-report"
    >
      <OText
        v-if="partial"
        variant="meta"
        as="p"
        class="pb-2 break-words"
        data-test="rca-partial-label"
        >{{ partial }}</OText
      >
      <AssistantAgentOutput
        kind="incident_report"
        :title="t('alerts.incidents.byAssistant', { product })"
        :findings="split.findings"
        :report="split.narrative"
        :live="live"
        :report-id="reportKey"
        data-test="rca-report-output"
      />
    </article>
  </div>
</template>

<script lang="ts">
import type { I18nText } from "@/types/i18n";

export interface IncidentAnalysisReportProps {
  /** The report's Markdown, streaming or saved. */
  report: string;
  live: boolean;
  reportKey: string;
  /** "Partial" caption for a stopped or failed run's text. */
  partial?: I18nText | null;
}

/** Headings past this count stay out of "Jump to". */
export const MAX_SECTIONS = 40;

const REPORT_HEADINGS =
  '[data-test="agent-output-report"] h2, [data-test="agent-output-report"] h3';
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import AssistantAgentOutput from "@/components/ai-assistant/blocks/AssistantAgentOutput.vue";
import { splitReportFindings, useAssistantName } from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<IncidentAnalysisReportProps>(), { partial: null });

const { t } = useI18nTyped();
const { product } = useAssistantName();
const article = ref<HTMLElement | null>(null);
const sections = ref<{ label: I18nText; value: string; depth: 2 | 3 }[]>([]);
const jumped = ref<string | undefined>(undefined);
let observer: MutationObserver | null = null;
let scheduled = false;

// A streaming report keeps its verdict as text until the stream ends, so a half block never parses.
const split = computed(() =>
  props.live ? { findings: null, narrative: props.report } : splitReportFindings(props.report),
);

watch(
  () => props.report,
  () => void nextTick(collect),
);

onMounted(() => {
  void nextTick(collect);
  // The shared renderer may paint after this component's own update.
  if (article.value && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(scheduleCollect);
    observer.observe(article.value, { childList: true, subtree: true });
  }
});

onBeforeUnmount(() => observer?.disconnect());

function scheduleCollect(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    collect();
  });
}

function collect(): void {
  const root = article.value;
  if (!root) return;
  // Only the report's own headings; the block's title is not a section.
  const headings = [...root.querySelectorAll<HTMLElement>(REPORT_HEADINGS)].slice(0, MAX_SECTIONS);
  const next = headings.map((heading, index) => {
    const id = `rca-section-${index}`;
    if (heading.id !== id) heading.id = id;
    // A heading reports tabIndex -1 without being focusable; only the attribute makes it a focus target.
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    return {
      label: raw(heading.textContent?.trim() || id),
      value: id,
      depth: heading.tagName === "H3" ? (3 as const) : (2 as const),
    };
  });
  const same =
    next.length === sections.value.length &&
    next.every((entry, i) => entry.label === sections.value[i].label);
  if (!same) sections.value = next;
}

function jump(id: string): void {
  jumped.value = id;
  const heading = article.value?.querySelector<HTMLElement>(`[id="${id}"]`);
  if (!heading) return;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  heading.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  heading.focus({ preventScroll: true });
}
</script>
