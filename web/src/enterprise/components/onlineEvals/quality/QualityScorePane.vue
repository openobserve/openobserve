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
  <section class="flex min-h-0 min-w-0 flex-1 flex-col" data-test="quality-score-pane">
    <div
      v-if="!score && !loading"
      class="text-text-secondary flex flex-1 items-center justify-center p-6 text-sm"
      data-test="quality-score-pane-empty"
    >
      {{ t("onlineEvals.quality.pane.noneSelected") }}
    </div>
    <template v-else>
      <!-- While the scores page loads there is no score yet: the frame stays and each part shows a skeleton. -->
      <!-- The selected row shows the value, input and time, and the footer opens the target, so the header shows only the health and rule. -->
      <header
        class="border-border-default flex shrink-0 items-center gap-3 border-b px-3 py-2"
        data-test="quality-score-pane-header"
      >
        <div v-if="score" class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <OTag
            v-if="score.unhealthy != null"
            type="qualityStatus"
            :value="score.unhealthy ? 'attention' : 'healthy'"
            :label="
              score.unhealthy
                ? t('onlineEvals.quality.pane.unhealthy')
                : t('onlineEvals.quality.pane.healthy')
            "
            data-test="quality-score-pane-health"
          />
          <span class="text-text-secondary text-xs" data-test="quality-score-pane-rule">{{
            thresholdLabel
              ? t("onlineEvals.quality.healthyIf", { rule: thresholdLabel })
              : t("onlineEvals.quality.pane.noThreshold")
          }}</span>
        </div>
        <div
          v-else
          class="flex min-w-0 flex-1 items-center gap-2"
          data-test="quality-score-pane-header-skeleton"
        >
          <OSkeleton type="text" class="h-5 w-20" />
          <OSkeleton type="text" class="h-3 w-32" />
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="chevron-left"
            :disabled="!canPrev"
            :title="t('onlineEvals.quality.pane.previous')"
            data-test="quality-score-pane-prev"
            @click="emit('prev')"
          />
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="chevron-right"
            :disabled="!canNext"
            :title="t('onlineEvals.quality.pane.next')"
            data-test="quality-score-pane-next"
            @click="emit('next')"
          />
        </div>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <!-- Input and Output side by side, filling the pane; fullscreen takes both, as on the queue workbench. -->
        <div
          ref="ioContainer"
          class="[&:fullscreen]:bg-surface-base flex min-h-48 min-w-0 flex-1 flex-col gap-4 md:flex-row md:gap-3 [&:fullscreen]:p-4"
          data-test="quality-score-pane-io"
        >
          <ReviewContentBox
            class="min-w-0 md:flex-1"
            fill
            :label="t('aiObservability.queues.workbench.input')"
            :content="inputText"
            :loading="contentLoading"
            content-type="input"
            :instance-id="`quality-${score?.id}-input`"
            :empty-text="t('onlineEvals.quality.review.inputNotCaptured')"
            :fullscreen="fullscreenEl === ioContainer"
            @toggle-fullscreen="toggleIoFullscreen"
          />
          <ReviewContentBox
            class="min-w-0 md:flex-1"
            fill
            :label="t('aiObservability.queues.workbench.output')"
            :content="outputText"
            :loading="contentLoading"
            content-type="output"
            :instance-id="`quality-${score?.id}-output`"
            :empty-text="t('onlineEvals.quality.review.outputNotCaptured')"
            :fullscreen="fullscreenEl === ioContainer"
            @toggle-fullscreen="toggleIoFullscreen"
          />
        </div>
        <p
          v-if="fullTextUnavailable"
          class="text-text-secondary m-0 -mt-1.5 shrink-0 text-xs"
          data-test="quality-score-pane-full-unavailable"
        >
          {{ t("onlineEvals.quality.pane.fullTextUnavailable") }}
        </p>
        <OCollapsible
          v-model="reasoningOpen"
          variant="sidebar"
          class="border-border-default rounded-default shrink-0 overflow-hidden border"
          data-test="quality-score-pane-reasoning"
        >
          <template #trigger>
            <OIcon name="lightbulb-outline" size="xs" class="text-text-secondary shrink-0" />
            <span class="text-text-secondary text-xs font-semibold">{{
              t("onlineEvals.quality.pane.reasoning")
            }}</span>
          </template>
          <div
            v-if="loading"
            class="flex flex-col gap-2 px-3 pb-2"
            data-test="quality-score-pane-reasoning-skeleton"
          >
            <OSkeleton type="text" class="h-3 w-full" />
            <OSkeleton type="text" class="h-3 w-3/4" />
          </div>
          <p
            v-else-if="score?.reasoning"
            class="text-text-body m-0 max-h-40 overflow-y-auto px-3 pb-2 text-xs leading-relaxed whitespace-pre-wrap"
            data-test="quality-score-pane-reasoning-text"
          >
            {{ score.reasoning }}
          </p>
          <p
            v-else
            class="text-text-secondary m-0 px-3 pb-2 text-xs italic"
            data-test="quality-score-pane-no-reasoning"
          >
            {{ t("onlineEvals.quality.pane.noReasoning") }}
          </p>
        </OCollapsible>
      </div>

      <footer
        class="border-border-default flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-2"
        data-test="quality-score-pane-actions"
      >
        <template v-if="loading">
          <OSkeleton type="text" class="h-6 w-24" />
          <OSkeleton type="text" class="h-6 w-28" />
        </template>
        <OButton
          v-if="targetLocation"
          variant="outline"
          size="xs"
          data-test="quality-score-pane-open-target"
          @click="navigate(targetLocation)"
        >
          {{ t(`onlineEvals.quality.pane.open.${score?.targetScope}`) }}
        </OButton>
        <OButton
          v-if="evaluatorLocation"
          variant="outline"
          size="xs"
          data-test="quality-score-pane-open-evaluator"
          @click="navigate(evaluatorLocation)"
        >
          {{ t("onlineEvals.quality.pane.evaluatorTrace") }}
        </OButton>
        <OButton
          v-if="score"
          variant="outline"
          size="xs"
          :disabled="!datasetTarget"
          data-test="quality-score-pane-add-to-dataset"
          @click="openDataset"
        >
          {{ t("onlineEvals.quality.pane.addToDataset") }}
          <OTooltip v-if="datasetBlockedReason" :content="datasetBlockedReason" />
        </OButton>
      </footer>
    </template>
    <AddToDatasetDrawer
      v-if="drawerTarget"
      :open="drawerOpen"
      :org-id="orgId"
      :ref-type="drawerTarget.refType"
      :ref-id="drawerTarget.refId"
      :source-stream="drawerTarget.sourceStream"
      :ref-trace-start-time="drawerTarget.refTraceStartTime"
      @update:open="updateDrawerOpen"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import { toggleFullscreen } from "@/utils/dom";
import { toast } from "@/lib/feedback/Toast/useToast";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ReviewContentBox from "@/enterprise/views/AIObservability/ReviewContentBox.vue";
import AddToDatasetDrawer from "@/enterprise/components/AIObservability/AddToDatasetDrawer.vue";
import type { QualityScore } from "@/services/online-evals.service";
import { traceDetailsQuery } from "@/services/search.queries";
import { extractLLMData } from "@/utils/llmUtils";
import {
  contentSpan,
  evaluatorTraceLink,
  targetLink,
  targetTraceId,
  targetWindow,
} from "../utils/qualityFormat";

const props = defineProps<{
  score: QualityScore | null;
  /** Threshold rule such as "≥ 0.7"; empty without a threshold. */
  thresholdLabel: string;
  canPrev: boolean;
  canNext: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: "prev"): void;
  (e: "next"): void;
}>();

const { t } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();
// Survives score changes, so a folded reasoning stays folded while reading on.
const reasoningOpen = ref(true);

const targetLocation = computed(() => (props.score ? targetLink(props.score, orgId.value) : null));
const evaluatorLocation = computed(() =>
  props.score ? evaluatorTraceLink(props.score, orgId.value) : null,
);

interface DatasetTarget {
  refType: "trace" | "span";
  refId: string;
  sourceStream: string;
  refTraceStartTime: number;
}

// A dataset item is one trace or span read back from its stream, so sessions and scores without a stream cannot be added.
const datasetTarget = computed<DatasetTarget | null>(() => {
  const score = props.score;
  if (!score || score.targetScope === "session" || !score.sourceStream) return null;
  const refId =
    score.targetScope === "span"
      ? (score.spanId ?? score.targetId)
      : (score.traceId ?? score.targetId);
  if (!refId) return null;
  return {
    refType: score.targetScope,
    refId,
    sourceStream: score.sourceStream,
    refTraceStartTime: score.refTimestamp,
  };
});
const datasetBlockedReason = computed(() => {
  if (props.score?.targetScope === "session") return t("onlineEvals.quality.pane.datasetSession");
  if (props.score && !props.score.sourceStream)
    return t("onlineEvals.quality.pane.datasetNoStream");
  return "";
});

// Held from the click, so moving to another score while the drawer is open cannot change what is added.
const drawerTarget = ref<DatasetTarget | null>(null);
const drawerOpen = ref(false);

function openDataset() {
  if (!datasetTarget.value) return;
  drawerTarget.value = datasetTarget.value;
  drawerOpen.value = true;
}

function updateDrawerOpen(open: boolean) {
  drawerOpen.value = open;
  if (!open) drawerTarget.value = null;
}

// The preview shows at once; the scored span's full text replaces it once its trace loads. Sessions and scores without a stream keep the preview.
const traceRef = computed(() => {
  const score = props.score;
  if (!score?.sourceStream) return null;
  const traceId = targetTraceId(score);
  return traceId ? { stream: score.sourceStream, traceId, ...targetWindow(score) } : null;
});
const traceQuery = useQuery(() => {
  const target = traceRef.value;
  return Object.assign(
    traceDetailsQuery(
      orgId.value,
      target?.stream ?? "",
      target?.traceId ?? "",
      target?.startTime ?? 0,
      target?.endTime ?? 0,
    ),
    { enabled: !!target },
  );
});

function asText(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

const fullText = computed(() => {
  const spans = traceQuery.data.value;
  if (!traceRef.value || !props.score || !spans) return null;
  const data = extractLLMData(contentSpan(props.score, spans));
  const input = asText(data?.input);
  const output = asText(data?.output);
  return input || output ? { input, output } : null;
});
// Skeletons while the scores page or the selected score's trace loads; scores that never fetch show their preview at once.
const contentLoading = computed(
  () => props.loading || (!!traceRef.value && traceQuery.isPending.value),
);
const inputText = computed(() => fullText.value?.input || props.score?.inputPreview || "");
const outputText = computed(() => fullText.value?.output || props.score?.outputPreview || "");
const fullTextUnavailable = computed(
  () =>
    !!traceRef.value &&
    (traceQuery.isError.value || (traceQuery.isSuccess.value && !fullText.value)),
);

// Same tab: browser Back returns to this score through the page and score in the URL.
function navigate(location: RouteLocationRaw) {
  router.push(location).catch(() => {});
}

const ioContainer = ref<HTMLElement | null>(null);
const fullscreenEl = ref<Element | null>(null);
const syncFullscreen = () => (fullscreenEl.value = document.fullscreenElement);

function toggleIoFullscreen() {
  if (!ioContainer.value) return;
  void toggleFullscreen(ioContainer.value).catch(() => {
    toast({ variant: "error", message: t("aiObservability.queues.workbench.fullscreenError") });
  });
}

onMounted(() => document.addEventListener("fullscreenchange", syncFullscreen));
onBeforeUnmount(() => document.removeEventListener("fullscreenchange", syncFullscreen));
</script>
