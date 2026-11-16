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
  <div
    class="@container flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 [&>*]:shrink-0"
    data-test="autoobserve-analysis"
  >
    <section
      class="bg-surface-base border-border-default rounded-surface relative flex flex-col gap-3 overflow-hidden border p-4 ps-5 shadow-xs"
      data-test="autoobserve-analysis-verdict"
    >
      <span class="absolute inset-y-0 start-0 w-1" :class="verdictTone.bar" />
      <DrawerSection :title="t('autoobserve.analysis.verdict')">
        <template v-if="unconfirmed" #aside>
          <OTag
            variant="warning-soft"
            size="sm"
            icon="hourglass-empty"
            :label="t('autoobserve.analysis.unconfirmed')"
          />
        </template>
        <p class="text-text-heading text-lg leading-snug font-semibold">
          {{ issue.analysis.verdict }}
        </p>
        <AoConfidenceMeter
          v-if="issue.confidence !== undefined"
          :band="issue.confidence"
          :reason="issue.confidence ? confidenceReason : (unscoredReason ?? confidenceReason)"
          data-test="autoobserve-analysis-confidence"
        />
        <div class="flex flex-wrap items-center gap-1.5" data-test="autoobserve-analysis-impact">
          <OTag
            v-for="(chip, i) in issue.analysis.impact"
            :key="i"
            :variant="verdictTone.tag"
            size="sm"
            :label="chip"
          />
          <OTag
            v-if="issue.analysis.duration"
            variant="default-soft"
            size="sm"
            icon="schedule"
            :label="issue.analysis.duration"
          />
          <OTag
            v-for="svc in issue.services"
            :key="svc"
            variant="default-soft"
            shape="rounded"
            size="sm"
            :label="raw(svc)"
          />
        </div>
        <slot name="verdict-actions" />
      </DrawerSection>
    </section>

    <div
      v-if="issue.analysis.hypotheses.length || showComparison"
      class="grid grid-cols-1 gap-4"
      :class="
        showComparison && issue.analysis.hypotheses.length
          ? '@min-[52rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
          : ''
      "
    >
      <section
        v-if="issue.analysis.hypotheses.length"
        :class="CARD"
        data-test="autoobserve-analysis-checked"
      >
        <DrawerSection :title="t('autoobserve.analysis.checked')">
          <ul class="flex flex-col gap-1">
            <li
              v-for="(h, i) in issue.analysis.hypotheses"
              :key="i"
              class="rounded-default flex items-start gap-3 px-2.5 py-2"
              :class="h.verdict === 'confirmed' ? 'bg-status-success-bg' : ''"
              :data-test="`autoobserve-analysis-hypothesis-${h.verdict}`"
            >
              <span
                class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
                :class="VERDICT[h.verdict].circle"
              >
                <OIcon :name="VERDICT[h.verdict].icon" size="xs" />
              </span>
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <span class="text-text-heading text-sm font-medium">{{ h.name }}</span>
                  <span class="text-xs font-medium" :class="VERDICT[h.verdict].ink">{{
                    t(`autoobserve.analysis.verdicts.${h.verdict}`)
                  }}</span>
                </div>
                <p class="text-text-secondary text-xs">{{ h.reason }}</p>
              </div>
            </li>
          </ul>
        </DrawerSection>
      </section>

      <section v-if="showComparison" :class="CARD" data-test="autoobserve-analysis-comparison">
        <DrawerSection :title="t('autoobserve.analysis.comparison')">
          <span class="text-text-secondary -mt-1 text-xs font-medium">{{
            issue.analysis.comparison?.metric ?? comparisonMetric
          }}</span>
          <ul
            v-if="comparisonStatus === 'loading'"
            class="flex flex-col gap-3"
            data-test="autoobserve-analysis-comparison-loading"
          >
            <li v-for="i in comparisonSlots" :key="i" class="flex flex-col gap-1">
              <OSkeleton animation="pulse" class="h-4 w-1/2" />
              <OSkeleton animation="pulse" class="h-2 w-full" />
            </li>
          </ul>
          <!-- The error keeps the bars' height, so the evidence trail below never jumps. -->
          <div
            v-else-if="comparisonStatus === 'failed'"
            :style="{ minHeight: reservedHeight }"
            data-test="autoobserve-analysis-comparison-error"
          >
            <p role="alert" class="text-status-error-text flex items-center gap-1.5 text-xs">
              <OIcon name="error-outline" size="xs" />
              {{ comparisonMissing ?? t("autoobserve.issueLive.compare.failed") }}
              <OButton
                v-if="!comparisonMissing || comparisonCanRetry"
                variant="ghost-primary"
                size="xs"
                data-test="autoobserve-analysis-comparison-retry"
                @click="emit('retry-comparison')"
                >{{ t("autoobserve.issueLive.spark.retry") }}</OButton
              >
            </p>
          </div>
          <p
            v-else-if="!issue.analysis.comparison?.rows.length"
            class="text-text-secondary text-xs"
            data-test="autoobserve-analysis-comparison-empty"
          >
            {{ t("autoobserve.issueLive.compare.empty") }}
          </p>
          <ul v-else class="flex flex-col gap-3">
            <li
              v-for="(row, i) in issue.analysis.comparison?.rows ?? []"
              :key="i"
              class="flex flex-col gap-1"
            >
              <div class="flex items-baseline gap-3">
                <span
                  class="min-w-0 flex-1 truncate text-xs"
                  :class="
                    row.kind === 'affected'
                      ? 'text-text-heading font-medium'
                      : 'text-text-secondary'
                  "
                  >{{ row.label }}</span
                >
                <span
                  class="shrink-0 text-xs font-semibold tabular-nums"
                  :class="row.kind === 'affected' ? tone.ink : 'text-text-heading'"
                  >{{ row.shown }}</span
                >
              </div>
              <div class="bg-surface-subtle h-2 overflow-hidden rounded-full">
                <div
                  class="h-full rounded-full"
                  :class="barClass(row.kind)"
                  :style="{ width: barWidth(row.value) }"
                />
              </div>
            </li>
          </ul>
          <p
            v-if="comparisonMissing && comparisonStatus === 'ready'"
            role="alert"
            class="text-status-error-text flex flex-wrap items-center gap-1.5 text-xs"
            data-test="autoobserve-analysis-comparison-missing"
          >
            <OIcon name="error-outline" size="xs" />
            {{ comparisonMissing }}
            <OButton
              v-if="comparisonCanRetry"
              variant="ghost-primary"
              size="xs"
              data-test="autoobserve-analysis-comparison-missing-retry"
              @click="emit('retry-comparison')"
              >{{ t("autoobserve.issueLive.spark.retry") }}</OButton
            >
          </p>
          <ul
            class="flex min-h-4 flex-wrap gap-x-3 gap-y-1"
            :aria-label="t('autoobserve.unfold.legend')"
          >
            <li
              v-for="kind in legend"
              :key="kind"
              class="text-text-secondary flex items-center gap-1.5 text-xs"
            >
              <span class="size-2 rounded-full" :class="barClass(kind)" />
              {{ legendLabels?.[kind] ?? t(`autoobserve.analysis.kinds.${kind}`) }}
            </li>
          </ul>
          <p
            v-if="comparisonMore"
            class="text-text-secondary text-xs"
            data-test="autoobserve-analysis-comparison-more"
          >
            {{ comparisonMore }}
          </p>
          <p
            v-if="comparisonNote && comparisonStatus === 'ready'"
            class="text-text-secondary text-xs"
            data-test="autoobserve-analysis-comparison-note"
          >
            {{ comparisonNote }}
          </p>
        </DrawerSection>
      </section>
    </div>

    <section ref="trailEl" :class="CARD" data-test="autoobserve-analysis-trail">
      <DrawerSection :title="t('autoobserve.analysis.trail')">
        <ol class="flex flex-col">
          <li v-for="(step, i) in trail" :key="step.key" class="group/step flex gap-3">
            <div class="flex flex-col items-center">
              <span
                class="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
                :class="
                  step.kind === 'change'
                    ? 'bg-surface-tint-accent text-accent'
                    : 'bg-surface-tint-neutral text-text-secondary'
                "
                >{{ i + 1 }}</span
              >
              <span
                class="bg-border-subtle my-1 w-px flex-1 group-last/step:hidden"
                aria-hidden="true"
              />
            </div>
            <div
              class="flex min-w-0 flex-1 items-center gap-6 pb-4 group-last/step:pb-0 max-md:flex-col max-md:items-start"
            >
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <div class="flex min-h-6 items-center gap-2">
                  <OIcon :name="KIND_ICON[step.kind]" size="xs" class="text-text-secondary" />
                  <span class="text-text-heading text-sm font-medium">{{ step.title }}</span>
                  <span v-if="step.at" class="text-text-secondary text-xs tabular-nums">{{
                    step.at
                  }}</span>
                </div>
                <p class="text-text-body truncate text-xs" :title="step.detail">
                  {{ step.detail }}
                </p>
                <button
                  v-if="step.card"
                  type="button"
                  class="text-text-link hover:text-text-link-hover focus-visible:outline-accent rounded-default inline-flex w-fit items-center gap-1 text-xs font-medium focus-visible:outline-2"
                  :data-test="`autoobserve-analysis-unfold-${step.card}`"
                  @click="emit('open-unfold', step.card)"
                >
                  {{ t("autoobserve.analysis.seeInUnfold") }}
                  <OIcon name="arrow-forward" size="xs" />
                </button>
              </div>
            </div>
          </li>
        </ol>
      </DrawerSection>
    </section>

    <section :class="CARD" data-test="autoobserve-analysis-next">
      <DrawerSection :title="t('autoobserve.analysis.nextStep')">
        <template #aside>
          <div v-if="report" class="ms-auto flex items-center gap-1">
            <OButton
              variant="ghost-muted"
              size="sm"
              icon-left="content-copy"
              data-test="autoobserve-analysis-copy"
              @click="copyReport()"
            >
              {{ t("alerts.incidents.rcaCopy") }}
            </OButton>
            <OButton
              variant="ghost-muted"
              size="sm"
              icon-left="download"
              data-test="autoobserve-analysis-download"
              @click="downloadReport()"
            >
              {{ t("alerts.incidents.rcaDownload") }}
            </OButton>
          </div>
        </template>
        <p class="text-text-heading text-sm">{{ issue.nextStep }}</p>
      </DrawerSection>
    </section>

    <section
      v-if="report"
      class="bg-surface-base border-border-default rounded-surface overflow-hidden border shadow-xs"
      data-test="autoobserve-analysis-report"
    >
      <OCollapsible
        v-model="reportOpen"
        icon="description"
        :label="t('autoobserve.analysis.fullReport')"
        :caption="t('autoobserve.analysis.fullReportHint')"
        trigger-class="px-4 py-3 rounded-none"
      >
        <div class="flex flex-col p-4 pt-0">
          <slot name="report" />
        </div>
      </OCollapsible>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { copyToClipboard } from "@/utils/clipboard";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import DrawerSection from "./v2/DrawerSection.vue";
import AoConfidenceMeter from "./live/AoConfidenceMeter.vue";
import type { AnalysisSubject } from "./live/issueModel";
import type { Analysis, HypothesisVerdict, Severity, UnfoldKind } from "./aoTypes";

type BarKind = NonNullable<Analysis["comparison"]>["rows"][number]["kind"];
type StepKind = Exclude<UnfoldKind, "outcome" | "forecast" | "alert" | "fold">;

interface TrailStep {
  key: string;
  kind: StepKind;
  title: I18nText;
  detail?: I18nText;
  at?: string;
  card?: string;
}

const props = withDefaults(
  defineProps<{
    issue: AnalysisSubject;
    report?: string | null;
    confidenceReason?: string | null;
    comparisonStatus?: "loading" | "ready" | "failed" | null;
    comparisonMetric?: I18nText;
    comparisonMore?: I18nText | null;
    comparisonNote?: I18nText | null;
    // Compared streams whose bars are missing because their counts failed or were denied.
    comparisonMissing?: I18nText | null;
    comparisonCanRetry?: boolean;
    // Bar rows the loading and failed states hold room for, so the cards below never move.
    comparisonSlots?: number;
    unscoredReason?: I18nText | null;
    legendLabels?: Partial<Record<BarKind, I18nText>>;
    // A resolved incident's verdict reads as settled, not as a live failure.
    resolved?: boolean;
  }>(),
  {
    report: null,
    confidenceReason: null,
    comparisonStatus: null,
    comparisonMetric: undefined,
    comparisonMore: null,
    comparisonNote: null,
    comparisonMissing: null,
    comparisonCanRetry: false,
    comparisonSlots: 3,
    unscoredReason: null,
    legendLabels: undefined,
    resolved: false,
  },
);

const emit = defineEmits<{
  "open-unfold": [cardId: string];
  "retry-comparison": [];
}>();

defineSlots<{ report(): unknown; "verdict-actions"(): unknown }>();

const { t, locale } = useI18nTyped();

const CARD =
  "bg-surface-base border-border-default rounded-surface flex flex-col border p-4 shadow-xs";

const SEVERITY_TONE: Record<Severity, { bar: string; ink: string; tag: BadgeVariant }> = {
  p1: { bar: "bg-status-error-text", ink: "text-status-error-text", tag: "error-soft" },
  p2: { bar: "bg-status-error-text", ink: "text-status-error-text", tag: "error-soft" },
  p3: { bar: "bg-status-warning-text", ink: "text-status-warning-text", tag: "warning-soft" },
  p4: { bar: "bg-border-strong", ink: "text-text-heading", tag: "default-soft" },
};

const VERDICT: Record<HypothesisVerdict, { icon: IconName; circle: string; ink: string }> = {
  confirmed: {
    icon: "check",
    circle: "bg-status-positive text-text-inverse",
    ink: "text-status-success-text",
  },
  ruled_out: {
    icon: "close",
    circle: "bg-surface-tint-neutral text-text-secondary",
    ink: "text-text-secondary",
  },
  open: {
    icon: "help-outline",
    circle: "bg-status-warning-bg text-status-warning-text",
    ink: "text-status-warning-text",
  },
};

const KIND_ICON: Record<StepKind, IconName> = {
  metric: "show-chart",
  log: "article",
  trace: "account-tree",
  change: "tune",
  unwatched: "visibility-off",
};

const RESOLVED_TONE = {
  bar: "bg-status-positive",
  ink: "text-text-heading",
  tag: "default-soft",
} as const;

const tone = computed(() => SEVERITY_TONE[props.issue.severity]);
const verdictTone = computed(() => (props.resolved ? RESOLVED_TONE : tone.value));
const unconfirmed = computed(() => props.issue.confidence === "low");
const showComparison = computed(
  () => !!props.issue.analysis.comparison || !!props.comparisonStatus,
);

// One bar row is a label line, a gap and the bar; rows sit a gap apart.
const reservedHeight = computed(() => `${Math.max(1, props.comparisonSlots) * 2.5 - 0.75}rem`);

const scaleMax = computed(() =>
  Math.max(...(props.issue.analysis.comparison?.rows.map((r) => r.value) ?? [1]), 1),
);

// A zero still gets a sliver, so an empty bar reads as a measured zero rather than a missing row.
const barWidth = (value: number) => `max(${(value / scaleMax.value) * 100}%, 0.25rem)`;

const barClass = (kind: BarKind) =>
  kind === "affected"
    ? tone.value.bar
    : kind === "healthy"
      ? "bg-status-positive"
      : "bg-border-strong";

const legend = computed(() => [
  ...new Set(props.issue.analysis.comparison?.rows.map((r) => r.kind) ?? []),
]);

const TRAIL_KINDS: UnfoldKind[] = ["metric", "log", "trace", "change", "unwatched"];

// Lane names a merged step lists before folding the rest into a count.
const TRAIL_NAMES = 3;

// Steps that say the same thing at the same time become one step naming every lane, so many streams read as one line.
const groupSame = (steps: TrailStep[]): TrailStep[] => {
  const out: (TrailStep & { lanes: string[]; rest?: I18nText })[] = [];
  for (const step of steps) {
    const card = props.issue.unfold.find((c) => c.id === step.card);
    const last = out[out.length - 1];
    const same =
      card?.lane &&
      last?.lanes.length &&
      !step.key.startsWith("evidence-") &&
      last.kind === step.kind &&
      String(last.title) === String(step.title) &&
      last.at === step.at &&
      String(last.rest) === String(card.detail);
    if (same) last.lanes.push(card.lane as string);
    else
      out.push({
        ...step,
        lanes: card?.lane && !step.key.startsWith("evidence-") ? [card.lane] : [],
        rest: card?.detail,
      });
  }
  return out.map(({ lanes, rest, ...step }) => {
    if (lanes.length < 2) return step;
    const shown = lanes.slice(0, TRAIL_NAMES);
    const more = lanes.length - shown.length;
    const names = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(
      more ? [...shown, String(t("autoobserve.issueLive.andMore", { count: more }, more))] : shown,
    );
    return { ...step, detail: raw(rest ? `${names} · ${rest}` : names) };
  });
};

// Evidence rows first claim their card; signals no row mentions join them, all in the order they unfolded.
const trail = computed<TrailStep[]>(() => {
  const cards = props.issue.unfold;
  const order = (id?: string) => {
    const i = cards.findIndex((c) => c.id === id);
    return i < 0 ? cards.length : i;
  };
  const claimed = new Set(props.issue.evidence.map((ev) => ev.card));
  const fromEvidence = props.issue.evidence.map((ev, i): TrailStep => ({
    key: `evidence-${i}`,
    kind: ev.kind,
    title: ev.title,
    detail: ev.detail,
    at: cards.find((c) => c.id === ev.card)?.at,
    card: ev.card,
  }));
  const fromCards = cards
    .filter((c) => TRAIL_KINDS.includes(c.kind) && !claimed.has(c.id))
    .map((c): TrailStep => ({
      key: c.id,
      kind: c.kind as StepKind,
      title: c.title,
      detail: c.peak
        ? raw(c.threshold ? `${c.peak} · ${c.threshold}` : c.peak)
        : c.lane && c.detail
          ? raw(`${c.lane} · ${c.detail}`)
          : c.detail,
      at: c.at,
      card: c.id,
    }));
  return groupSame([...fromEvidence, ...fromCards].sort((a, b) => order(a.card) - order(b.card)));
});

const trailEl = ref<HTMLElement>();
defineExpose({ scrollToTrail: () => trailEl.value?.scrollIntoView({ block: "start" }) });

const reportOpen = ref(false);
watch(
  () => props.issue.id,
  () => (reportOpen.value = false),
);

const copyReport = () => {
  if (props.report) void copyToClipboard(props.report, t);
};

const downloadReport = () => {
  if (!props.report) return;
  const url = URL.createObjectURL(new Blob([props.report], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `incident-${props.issue.id}.md`;
  a.click();
  URL.revokeObjectURL(url);
};
</script>
