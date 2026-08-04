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
  Queue Workbench — the review surface, opened directly by "Review" (no
  intermediate item-list page). Three regions: a left item navigator (the pool +
  progress), the content pane (the reviewed object), and the scoring pane (one
  control per bound Score Config). Per the Phase-2.5 spec: submit is N/N
  all-or-nothing, items are pending|reviewed only, and reviews are append-only
  (a re-review appends; nothing is overwritten). Mock content until the trace
  backend is wired.
-->
<template>
  <OPageLayout
    data-test="ai-queue-workbench-page"
    :title="queue?.name || t('aiObservability.queues.detail.fallbackTitle')"
    :subtitle="t('aiObservability.queues.workbench.subtitle', { reviewed: reviewedCount, total: items.length })"
    :back="backTarget"
    bleed
    :scroll="false"
  >
    <template #actions>
      <template v-if="currentItem">
        <span class="text-text-secondary mr-1 text-sm">
          <i18n-t keypath="aiObservability.queues.workbench.itemCounter" tag="span">
            <template #index>
              <span class="text-text-body font-semibold">{{ currentIndex + 1 }}</span>
            </template>
            <template #total>{{ items.length }}</template>
          </i18n-t>
        </span>
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="chevron-left"
          :disabled="currentIndex <= 0"
          :aria-label="t('aiObservability.queues.workbench.prev')"
          data-test="ai-queue-workbench-prev"
          @click="selectItem(currentIndex - 1)"
        />
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="chevron-right"
          :disabled="currentIndex >= items.length - 1"
          :aria-label="t('aiObservability.queues.workbench.next')"
          data-test="ai-queue-workbench-next"
          @click="selectItem(currentIndex + 1)"
        />
      </template>
    </template>

    <div class="flex h-full min-h-0" data-test="ai-queue-workbench-body">
      <!-- Item navigator (collapsible) -->
      <aside v-if="!navCollapsed" class="border-border-default flex w-64 shrink-0 flex-col border-r">
        <div class="border-table-row-divider flex flex-col gap-1.5 border-b px-3 py-2.5">
          <div class="flex items-center justify-between gap-2 text-xs tabular-nums">
            <span class="text-text-secondary">
              {{ t("aiObservability.queues.reviewedCount", { reviewed: reviewedCount, total: items.length }) }}
            </span>
            <span
              :class="cleared ? 'text-status-success-text font-semibold' : 'text-text-body font-semibold'"
            >
              {{ percent }}%
            </span>
          </div>
          <OProgressBar :value="fraction" :variant="cleared ? 'success' : 'default'" size="sm" />
        </div>
        <OTabs
          :model-value="String(currentIndex)"
          orientation="vertical"
          dense
          class="min-h-0 flex-1 overflow-y-auto px-1.5 py-1"
          data-test="ai-queue-workbench-nav"
        >
          <OTab
            v-for="(item, i) in items"
            :key="item.id"
            :name="String(i)"
            class="min-h-6"
            :data-test="`ai-queue-workbench-nav-item-${i}`"
            @click="selectItem(i)"
          >
            <div class="flex w-full min-w-0 items-center gap-1.5 text-xs">
              <OIcon
                :name="item.status === 'reviewed' ? 'check-circle' : 'fiber-manual-record'"
                size="sm"
                class="shrink-0"
                :class="item.status === 'reviewed' ? 'text-status-success-text' : 'text-text-disabled'"
              />
              <span class="min-w-0 flex-1 truncate text-left font-mono">{{ item.refId }}</span>
            </div>
          </OTab>
        </OTabs>
      </aside>

      <!-- Review pane -->
      <section class="flex min-w-0 flex-1 flex-col">
        <div
          v-if="loading"
          class="flex flex-1 items-center justify-center"
          data-test="ai-queue-workbench-loading"
        >
          <OSpinner size="lg" />
        </div>

        <div
          v-else-if="!currentItem"
          class="text-text-secondary flex flex-1 flex-col items-center justify-center gap-2 p-8"
          data-test="ai-queue-workbench-empty"
        >
          <OIcon name="check-circle" class="text-status-success-text h-10 w-10" />
          <span class="text-text-heading text-sm font-semibold">
            {{ t("aiObservability.queues.workbench.allReviewedTitle") }}
          </span>
          <span class="text-center text-xs">
            {{ t("aiObservability.queues.workbench.allReviewedBody") }}
          </span>
        </div>

        <template v-else>
          <div class="flex min-h-0 flex-1">
            <!-- content -->
            <div
              class="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4"
              data-test="ai-queue-workbench-content"
            >
              <!-- item header — refId · workflow · model already name the trace,
                   so "Open full trace" lives here as the row action (no separate
                   lineage strip). -->
              <div class="flex shrink-0 flex-col gap-1.5">
                <div class="flex items-center gap-2">
                  <OButton
                    variant="outline"
                    size="icon-chip"
                    class="shrink-0"
                    data-test="ai-queue-workbench-nav-toggle"
                    @click="navCollapsed = !navCollapsed"
                  >
                    <OIcon
                      :name="navCollapsed ? 'keyboard-double-arrow-right' : 'keyboard-double-arrow-left'"
                      size="sm"
                    />
                    <OTooltip
                      :content="
                        navCollapsed
                          ? t('aiObservability.queues.workbench.expandNav')
                          : t('aiObservability.queues.workbench.collapseNav')
                      "
                      side="bottom"
                    />
                  </OButton>
                  <OTag variant="blue-soft" shape="rounded" class="shrink-0">{{
                    currentItem.refType
                  }}</OTag>
                  <h2 class="text-text-heading min-w-0 flex-1 truncate text-lg font-semibold">
                    {{ itemTitle }}
                  </h2>
                  <OButton
                    variant="outline"
                    size="sm"
                    icon-left="open-in-new"
                    class="shrink-0"
                    data-test="ai-queue-workbench-open-trace"
                    @click="openTrace"
                  >
                    {{ t("aiObservability.queues.workbench.openTrace") }}
                  </OButton>
                </div>
                <div class="text-text-secondary flex flex-wrap items-center gap-x-2 font-mono text-xs">
                  <span class="truncate">{{ currentItem.refId }}</span>
                  <span>·</span><span>{{ currentCase.workflow }}</span>
                  <span>·</span><span>{{ currentCase.model }}</span>
                </div>
              </div>

              <!-- System scores — how the automated evaluators graded this item,
                   surfaced up front for reference. Compact chips that wrap and
                   scroll, so any number of scores stays contained. -->
              <div
                v-if="currentCase.machineScores.length"
                class="flex shrink-0 flex-col gap-1.5"
                data-test="ai-queue-workbench-system-scores"
              >
                <span class="inline-flex items-center gap-2">
                  <span class="text-text-heading text-sm font-bold">
                    {{ t("aiObservability.queues.workbench.systemScores") }}
                  </span>
                  <span class="text-text-disabled text-sm font-normal">
                    ({{ currentCase.machineScores.length }})
                  </span>
                  <span class="text-text-secondary text-2xs">
                    {{ t("aiObservability.queues.workbench.systemScoresHint") }}
                  </span>
                </span>
                <div class="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1">
                  <span
                    v-for="ms in currentCase.machineScores"
                    :key="ms.name"
                    class="border-border-default bg-surface-subtle rounded-default flex shrink-0 items-center gap-1.5 border px-2 py-1"
                  >
                    <span class="text-text-secondary font-mono text-2xs">{{ ms.name }}</span>
                    <span class="font-mono text-xs font-semibold">{{ ms.value }}</span>
                    <OTooltip side="bottom" :content="ms.source" />
                  </span>
                </div>
              </div>

              <!-- Input / Output side-by-side (like the TraceDetailsSidebar
                   preview), filling the remaining height with internal scroll.
                   Retrieved Context is full-width below. -->
              <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 md:flex-row md:gap-3">
                <ReviewContentBox
                  class="min-w-0 md:flex-1"
                  fill
                  :label="t('aiObservability.queues.workbench.input')"
                  :content="currentCase.input"
                  content-type="input"
                  :instance-id="`${currentItem.id}-input`"
                />
                <ReviewContentBox
                  class="min-w-0 md:flex-1"
                  fill
                  :label="t('aiObservability.queues.workbench.output')"
                  :content="currentCase.output"
                  content-type="output"
                  :instance-id="`${currentItem.id}-output`"
                />
              </div>
              <div v-if="currentCase.retrievedContext" class="flex shrink-0 flex-col gap-1.5">
                <button
                  type="button"
                  class="text-text-secondary hover:text-text-heading flex w-fit items-center gap-1 text-xs"
                  data-test="ai-queue-workbench-context-toggle"
                  @click="contextExpanded = !contextExpanded"
                >
                  <OIcon :name="contextExpanded ? 'expand-more' : 'chevron-right'" size="sm" />
                  {{
                    contextExpanded
                      ? t("aiObservability.queues.workbench.hideContext")
                      : t("aiObservability.queues.workbench.showContext")
                  }}
                </button>
                <ReviewContentBox
                  v-if="contextExpanded"
                  :label="t('aiObservability.queues.workbench.retrievedContext')"
                  :content="currentCase.retrievedContext"
                  content-type="input"
                  :instance-id="`${currentItem.id}-context`"
                />
              </div>
            </div>

            <!-- scoring — on a distinct elevated surface so it reads as THE work
                 panel (the reviewer's eye should land here). -->
            <aside
              class="border-border-default bg-surface-subtle flex w-96 shrink-0 flex-col border-l"
              data-test="ai-queue-workbench-scoring"
            >
              <div class="min-h-0 flex-1 overflow-y-auto p-4">
                <div class="mb-4 flex flex-col gap-1">
                  <span class="inline-flex items-center gap-2">
                    <span class="text-text-heading text-base font-semibold">
                      {{ t("aiObservability.queues.workbench.scoreTitle") }}
                    </span>
                    <span class="text-text-secondary text-xs">
                      {{ t("aiObservability.queues.workbench.dimensionsBound", { count: boundConfigs.length }) }}
                    </span>
                  </span>
                  <span class="text-text-secondary text-2xs">
                    {{ t("aiObservability.queues.workbench.appendOnlyNote") }}
                  </span>
                </div>
                <div class="flex flex-col gap-4">
                  <div
                    v-for="cfg in boundConfigs"
                    :key="cfg.scoreConfigId"
                    class="bg-surface-panel border-border-default rounded-surface flex flex-col gap-2.5 border p-3"
                    :data-test="`ai-queue-workbench-score-${cfg.scoreConfigId}`"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span
                        class="o-input-label text-compact text-input-label-text leading-tight font-medium"
                      >
                        {{ cfg.name }}
                      </span>
                      <OIcon
                        v-if="draft[cfg.scoreConfigId] !== undefined"
                        name="check-circle"
                        size="sm"
                        class="text-status-success-text shrink-0"
                        :data-test="`ai-queue-workbench-scored-${cfg.scoreConfigId}`"
                      />
                    </div>

                    <!-- numeric → slider -->
                    <div v-if="cfg.dataType === 'numeric'" class="flex flex-col gap-1">
                      <div class="flex items-center gap-3">
                        <OSlider
                          :model-value="numericValue(cfg.scoreConfigId)"
                          :min="0"
                          :max="1"
                          :step="0.05"
                          class="min-w-0 flex-1"
                          :data-test="`ai-queue-workbench-slider-${cfg.scoreConfigId}`"
                          @update:model-value="(v: number) => (draft[cfg.scoreConfigId] = v)"
                        />
                        <span
                          class="shrink-0 text-right tabular-nums"
                          :class="
                            draft[cfg.scoreConfigId] === undefined
                              ? 'text-text-disabled text-2xs'
                              : 'text-text-body text-sm font-semibold'
                          "
                        >
                          {{
                            draft[cfg.scoreConfigId] === undefined
                              ? t("aiObservability.queues.workbench.notScored")
                              : Number(draft[cfg.scoreConfigId]).toFixed(2)
                          }}
                        </span>
                      </div>
                      <span class="text-text-secondary text-2xs">
                        {{ t("aiObservability.queues.workbench.numericScale") }} ·
                        {{ t("aiObservability.queues.workbench.healthyLabel", { threshold: NUMERIC_HEALTHY }) }}
                      </span>
                    </div>

                    <!-- categorical → radios -->
                    <ORadioGroup
                      v-else-if="cfg.dataType === 'categorical'"
                      :model-value="(draft[cfg.scoreConfigId] as string) ?? ''"
                      orientation="horizontal"
                      @update:model-value="(v: unknown) => (draft[cfg.scoreConfigId] = String(v))"
                    >
                      <ORadio
                        v-for="c in cfg.categories || []"
                        :key="c"
                        :value="c"
                        :label="c"
                      />
                    </ORadioGroup>

                    <!-- boolean → radios -->
                    <ORadioGroup
                      v-else
                      :model-value="(draft[cfg.scoreConfigId] as string) ?? ''"
                      orientation="horizontal"
                      @update:model-value="(v: unknown) => (draft[cfg.scoreConfigId] = String(v))"
                    >
                      <ORadio value="true" :label="t('aiObservability.queues.workbench.true')" />
                      <ORadio value="false" :label="t('aiObservability.queues.workbench.false')" />
                    </ORadioGroup>
                  </div>

                  <!-- Comment (optional) -->
                  <div class="flex flex-col gap-1.5">
                    <span class="inline-flex items-center gap-1">
                      <span
                        class="o-input-label text-compact text-input-label-text leading-tight font-medium"
                      >
                        {{ t("aiObservability.queues.workbench.commentLabel") }}
                      </span>
                      <span class="text-text-secondary text-2xs font-normal">{{ t("common.optional") }}</span>
                    </span>
                    <OTextarea
                      v-model="comment"
                      :placeholder="t('aiObservability.queues.workbench.commentPlaceholder')"
                      :rows="3"
                      data-test="ai-queue-workbench-comment"
                    />
                  </div>

                  <!-- Other reviewers' scores — collapsed by default so the
                       reviewer forms their own view first (peer scores anchor).
                       The system's automated scores live above Input/Output. -->
                  <div
                    v-if="currentCase.priorAnnotations.length"
                    class="flex flex-col gap-2"
                    data-test="ai-queue-workbench-prior"
                  >
                    <button
                      type="button"
                      class="text-text-secondary hover:text-text-heading flex items-center gap-1 text-xs font-semibold"
                      data-test="ai-queue-workbench-prior-toggle"
                      @click="priorExpanded = !priorExpanded"
                    >
                      <OIcon :name="priorExpanded ? 'expand-more' : 'chevron-right'" size="sm" />
                      {{ t("aiObservability.queues.workbench.priorScores") }}
                      <span class="text-text-disabled font-normal"
                        >({{ currentCase.priorAnnotations.length }})</span
                      >
                    </button>
                    <span v-if="!priorExpanded" class="text-text-secondary pl-5 text-2xs">
                      {{ t("aiObservability.queues.workbench.priorScoresHint") }}
                    </span>

                    <div
                      v-for="(a, ai) in currentCase.priorAnnotations"
                      v-show="priorExpanded"
                      :key="ai"
                      class="border-border-default bg-surface-base rounded-surface flex flex-col gap-1.5 border px-3 py-2.5"
                    >
                      <div class="flex items-center gap-2">
                        <span
                          class="bg-primary/15 text-text-body text-2xs flex h-5 w-5 items-center justify-center rounded-full font-bold"
                        >
                          {{ a.initials }}
                        </span>
                        <span class="text-sm font-medium">{{ a.reviewer }}</span>
                        <span class="text-text-secondary ml-auto text-2xs">{{ a.time }}</span>
                      </div>
                      <div class="flex flex-wrap items-center gap-1.5">
                        <OTag
                          v-for="s in a.scores"
                          :key="s.name"
                          variant="default-soft"
                          class="font-mono text-2xs"
                        >
                          {{ s.name }} {{ s.value }}
                        </OTag>
                      </div>
                      <span class="text-text-secondary text-xs italic">“{{ a.comment }}”</span>
                    </div>
                  </div>
                </div>
              </div>

              <div
                class="border-table-row-divider bg-surface-panel flex flex-col gap-2 border-t px-4 py-3"
              >
                <span class="text-text-secondary text-2xs" data-test="ai-queue-workbench-scored-count">
                  {{ t("aiObservability.queues.workbench.dimensionsScored", { scored: scoredCount, total: boundConfigs.length }) }}
                </span>
                <OProgressBar
                  :value="boundConfigs.length ? scoredCount / boundConfigs.length : 0"
                  :variant="scoredCount === boundConfigs.length ? 'success' : 'default'"
                  size="sm"
                />
                <div class="flex items-center gap-2">
                  <OButton
                    variant="outline"
                    size="sm"
                    class="flex-1"
                    data-test="ai-queue-workbench-skip"
                    @click="skip"
                  >
                    {{ t("aiObservability.queues.workbench.skip") }}
                  </OButton>
                  <OButton
                    variant="primary"
                    size="sm"
                    icon-right="arrow-forward"
                    class="flex-1"
                    :disabled="!canSubmit"
                    data-test="ai-queue-workbench-submit"
                    @click="submit"
                  >
                    {{ t("aiObservability.queues.workbench.submit") }}
                  </OButton>
                </div>
              </div>
            </aside>
          </div>
        </template>
      </section>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSlider from "@/lib/forms/Slider/OSlider.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import ReviewContentBox from "./ReviewContentBox.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmQueuesService, {
  type LlmQueue,
  type LlmQueueItem,
  type LlmScoreConfigOption,
  type ScoreConfigDataType,
} from "@/services/llm-queues.service";

defineOptions({ name: "AIQueueWorkbenchPage" });

const { t } = useI18n();
const store = useStore();
const route = useRoute();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const queueId = computed<string>(() => String(route.params.id ?? ""));

// Standard detail-page back button (start of the header) — returns to the list.
const backTarget = computed(() => ({
  label: t("aiObservability.nav.queues"),
  to: { name: "aiQueues", query: { org_identifier: orgId.value } },
}));

const queue = ref<LlmQueue | null>(null);
const items = ref<LlmQueueItem[]>([]);
const configOptions = ref<LlmScoreConfigOption[]>([]);
const loading = ref(false);
const currentIndex = ref(0);
const navCollapsed = ref(false);
const priorExpanded = ref(false);
const contextExpanded = ref(false);

// The current item's in-progress scores (one entry per bound dimension).
type ScoreValue = number | string;
const draft = reactive<Record<string, ScoreValue | undefined>>({});
const comment = ref("");

const currentItem = computed<LlmQueueItem | null>(() => items.value[currentIndex.value] ?? null);

const reviewedCount = computed(() => items.value.filter((i) => i.status === "reviewed").length);
const fraction = computed(() => (items.value.length ? reviewedCount.value / items.value.length : 0));
const percent = computed(() => Math.round(fraction.value * 100));
const cleared = computed(() => items.value.length > 0 && reviewedCount.value >= items.value.length);

// The queue's bindings joined with the Score Config catalog → the controls to
// render (name + data type + categories) per bound dimension.
interface BoundScoreConfig {
  scoreConfigId: string;
  name: string;
  dataType: ScoreConfigDataType;
  categories?: string[];
}
const boundConfigs = computed<BoundScoreConfig[]>(() =>
  (queue.value?.scoreConfigs ?? []).map((b) => {
    const cat = configOptions.value.find((o) => o.id === b.scoreConfigId);
    return {
      scoreConfigId: b.scoreConfigId,
      name: b.name,
      dataType: cat?.dataType ?? "numeric",
      categories: cat?.categories,
    };
  }),
);

// N/N all-or-nothing: every bound dimension must have a value to submit.
const canSubmit = computed(
  () =>
    boundConfigs.value.length > 0 &&
    boundConfigs.value.every((c) => draft[c.scoreConfigId] !== undefined),
);

const NUMERIC_HEALTHY = 0.7; // TODO(BE): comes from the Score Config's healthy_threshold.

function numericValue(id: string): number {
  const v = draft[id];
  // Unscored → neutral middle (not the "healthy" 0.7, which read as already-set).
  return typeof v === "number" ? v : 0.5;
}

// How many of the bound dimensions the reviewer has scored so far.
const scoredCount = computed(
  () => boundConfigs.value.filter((c) => draft[c.scoreConfigId] !== undefined).length,
);

// Mock review content until the trace backend is wired. Mirrors the shape the
// Workbench needs: the reviewed object + the machine's pre-judgment (for
// reference) + prior append-only annotations.
interface MachineScore {
  name: string;
  value: string;
  source: string;
}
interface PriorAnnotation {
  reviewer: string;
  initials: string;
  time: string;
  scores: { name: string; value: string }[];
  comment: string;
}
interface MockCase {
  model: string;
  workflow: string;
  input: string;
  output: string;
  retrievedContext: string;
  machineScores: MachineScore[];
  priorAnnotations: PriorAnnotation[];
}

const MOCK_CASES: MockCase[] = [
  {
    model: "claude-sonnet-4-5",
    workflow: "agent.workflow.o2-ai",
    input: "User asks whether a 35-day-old order qualifies for a refund under the standard policy.",
    output:
      "Yes, absolutely — you can return it any time, no questions asked. I've processed a full refund to your card.",
    retrievedContext:
      "Retrieved (policy_v3.md): standard refund window is 30 days; beyond that requires manual review and is not auto-approved.",
    machineScores: [
      { name: "faithfulness", value: "0.31", source: "LLM Judge" },
      { name: "toxicity", value: "0.02", source: "Code" },
      { name: "hallucination", value: "0.74", source: "LLM Judge" },
      { name: "grounded", value: "false", source: "Code" },
      { name: "relevance", value: "0.88", source: "LLM Judge" },
      { name: "coherence", value: "0.91", source: "LLM Judge" },
      { name: "pii_leak", value: "none", source: "Code" },
      { name: "policy_violation", value: "0.12", source: "LLM Judge" },
      { name: "answer_length", value: "142", source: "Code" },
      { name: "sentiment", value: "0.05", source: "Code" },
    ],
    priorAnnotations: [
      {
        reviewer: "alice",
        initials: "AL",
        time: "1h ago",
        scores: [
          { name: "faithfulness", value: "0.3" },
          { name: "halluc_severity", value: "major" },
          { name: "grounded", value: "false" },
        ],
        comment: "Invents an auto-approval that contradicts the 30-day policy.",
      },
    ],
  },
  {
    model: "claude-sonnet-4-5",
    workflow: "agent.workflow.o2-ai",
    input: "What's the warranty period for the X200 laptop?",
    output: "The X200 laptop comes with a 2-year limited warranty covering manufacturing defects.",
    retrievedContext: "Retrieved (warranty.md): X200 — 24-month limited warranty on manufacturing defects.",
    machineScores: [
      { name: "faithfulness", value: "0.94", source: "LLM Judge" },
      { name: "toxicity", value: "0.00", source: "Code" },
    ],
    priorAnnotations: [],
  },
  {
    model: "claude-sonnet-4-5",
    workflow: "agent.workflow.o2-ai",
    input: "Does the subscription auto-renew?",
    output: "Yes — plans renew automatically each month unless cancelled before the renewal date.",
    retrievedContext: "Retrieved (billing.md): monthly plans auto-renew; cancel any time before the cycle ends.",
    machineScores: [
      { name: "faithfulness", value: "0.88", source: "LLM Judge" },
      { name: "toxicity", value: "0.01", source: "Code" },
    ],
    priorAnnotations: [],
  },
];
const currentCase = computed<MockCase>(() => {
  const item = currentItem.value;
  if (!item) return MOCK_CASES[0];
  const n = item.refId.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return MOCK_CASES[n % MOCK_CASES.length];
});

// The queue item is only a pointer (refType/refId) — the backend gives us no
// title, so we derive the heading from the reviewed input (fall back to the
// operation name, then the ref id). Mirrors what we can actually show once the
// trace-content fetch is wired.
const itemTitle = computed(() => {
  const preview = (currentCase.value.input || "").replace(/\s+/g, " ").trim();
  if (preview) return preview.length > 72 ? `${preview.slice(0, 72).trimEnd()}…` : preview;
  return currentCase.value.workflow || currentItem.value?.refId || "";
});


function resetDraft() {
  for (const k of Object.keys(draft)) delete draft[k];
  comment.value = "";
  priorExpanded.value = false;
  contextExpanded.value = false;
}

function selectItem(index: number) {
  if (index < 0 || index >= items.value.length) return;
  currentIndex.value = index;
  resetDraft();
}

function firstPendingIndex(): number {
  const i = items.value.findIndex((it) => it.status === "pending");
  return i === -1 ? 0 : i;
}

function advance() {
  const next = items.value.findIndex((it, i) => i > currentIndex.value && it.status === "pending");
  selectItem(next === -1 ? Math.min(currentIndex.value + 1, items.value.length - 1) : next);
}

function skip() {
  advance();
}

// Append-only in production; here the mock flips the item to reviewed and moves on.
function submit() {
  const item = currentItem.value;
  if (!canSubmit.value || !item) return;
  item.status = "reviewed";
  item.reviewedAt = Date.now();
  toast({ variant: "success", message: t("aiObservability.queues.workbench.submitted") });
  advance();
}

async function refresh() {
  if (!orgId.value || !queueId.value) return;
  loading.value = true;
  try {
    const [q, its, configs] = await Promise.all([
      llmQueuesService.get(orgId.value, queueId.value),
      llmQueuesService.listItems(orgId.value, queueId.value),
      llmQueuesService.listScoreConfigOptions(orgId.value),
    ]);
    queue.value = q;
    items.value = its;
    configOptions.value = configs;
    currentIndex.value = firstPendingIndex();
    resetDraft();
  } catch {
    toast({ variant: "error", message: t("aiObservability.queues.detail.loadError") });
  } finally {
    loading.value = false;
  }
}

// TODO(BE): deep-link to the full trace detail once trace refs are wired.
function openTrace() {
  toast({ variant: "info", message: t("aiObservability.queues.workbench.openTraceSoon") });
}

// Keyboard: ←/→ move between items, Enter submits when complete.
function onKeydown(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
  if (e.key === "ArrowLeft") selectItem(currentIndex.value - 1);
  else if (e.key === "ArrowRight") selectItem(currentIndex.value + 1);
  else if (e.key === "Enter" && canSubmit.value) submit();
}

watch(currentItem, () => resetDraft());

onMounted(() => {
  refresh();
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>
