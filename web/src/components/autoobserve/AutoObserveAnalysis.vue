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
      <span class="absolute inset-y-0 start-0 w-1" :class="tone.bar" />
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
        <div class="flex flex-wrap items-center gap-2" data-test="autoobserve-analysis-confidence">
          <span class="text-text-label text-xs font-medium">{{
            t("autoobserve.drawer.confidence")
          }}</span>
          <span
            class="flex items-center gap-0.5"
            role="meter"
            aria-valuemin="1"
            aria-valuemax="3"
            :aria-valuenow="level"
            :aria-label="t('autoobserve.drawer.confidence')"
          >
            <span
              v-for="i in 3"
              :key="i"
              class="h-1.5 w-6 rounded-full"
              :class="i <= level ? 'bg-accent' : 'bg-surface-tint-neutral'"
            />
          </span>
          <span class="text-text-heading text-xs font-semibold">{{
            t(CONFIDENCE_LABEL[issue.confidence])
          }}</span>
          <span class="text-text-secondary text-xs">{{
            t("autoobserve.confidence.uncalibrated")
          }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5" data-test="autoobserve-analysis-impact">
          <OTag
            v-for="(chip, i) in issue.analysis.impact"
            :key="i"
            :variant="tone.tag"
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
      </DrawerSection>
    </section>

    <div
      class="grid grid-cols-1 gap-4"
      :class="
        issue.analysis.comparison ? '@min-[52rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''
      "
    >
      <section :class="CARD" data-test="autoobserve-analysis-checked">
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

      <section
        v-if="issue.analysis.comparison"
        :class="CARD"
        data-test="autoobserve-analysis-comparison"
      >
        <DrawerSection :title="t('autoobserve.analysis.comparison')">
          <span class="text-text-label -mt-1 text-xs font-medium">{{
            issue.analysis.comparison.metric
          }}</span>
          <ul class="flex flex-col gap-3">
            <li
              v-for="(row, i) in issue.analysis.comparison.rows"
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
          <ul class="flex flex-wrap gap-x-3 gap-y-1" :aria-label="t('autoobserve.unfold.legend')">
            <li
              v-for="kind in legend"
              :key="kind"
              class="text-text-secondary flex items-center gap-1.5 text-xs"
            >
              <span class="size-2 rounded-full" :class="barClass(kind)" />
              {{ t(`autoobserve.analysis.kinds.${kind}`) }}
            </li>
          </ul>
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
              <div v-if="step.points" class="w-full shrink-0 md:w-48">
                <OSparkline
                  :points="sparkPoints(step)"
                  :shape="step.projected ? 'bar' : 'area'"
                  size="sm"
                  :tone="step.projected ? 'warning' : 'danger'"
                  :aria-label="step.detail"
                />
              </div>
            </div>
          </li>
        </ol>
      </DrawerSection>
    </section>

    <section :class="CARD" data-test="autoobserve-analysis-next">
      <DrawerSection :title="t('autoobserve.analysis.nextStep')">
        <template #aside>
          <div class="ms-auto flex items-center gap-1">
            <OButton
              variant="ghost-muted"
              size="sm"
              icon-left="content-copy"
              data-test="autoobserve-analysis-copy"
              @click="notInDemo"
            >
              {{ t("alerts.incidents.rcaCopy") }}
            </OButton>
            <OButton
              variant="ghost-muted"
              size="sm"
              icon-left="download"
              data-test="autoobserve-analysis-download"
              @click="notInDemo"
            >
              {{ t("alerts.incidents.rcaDownload") }}
            </OButton>
          </div>
        </template>
        <p class="text-text-heading text-sm">{{ issue.nextStep }}</p>
        <div
          v-if="issue.proposal && entry"
          class="bg-surface-subtle rounded-surface flex flex-wrap items-center gap-3 p-3"
          data-test="autoobserve-analysis-proposal"
        >
          <span
            class="bg-surface-tint-accent text-accent flex size-8 shrink-0 items-center justify-center rounded-full"
          >
            <OIcon
              :name="issue.proposal.kind === 'fix' ? 'build' : 'lightbulb-outline'"
              size="sm"
            />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span v-if="proposalLabel" class="text-text-label text-xs font-medium">{{
              proposalLabel
            }}</span>
            <span class="text-text-heading text-sm font-medium">{{ issue.proposal.title }}</span>
            <span v-if="entry.note" class="text-text-secondary text-xs">{{ entry.note }}</span>
          </div>
          <div v-if="entry.status === 'awaiting'" class="flex items-center gap-2">
            <OButton
              variant="outline"
              size="sm"
              data-test="autoobserve-analysis-reject"
              @click="emit('reject')"
            >
              {{ t("autoobserve.activity.reject") }}
            </OButton>
            <OButton
              variant="primary"
              size="sm"
              data-test="autoobserve-analysis-approve"
              @click="emit('approve')"
            >
              {{ t("autoobserve.activity.approve") }}
            </OButton>
          </div>
          <OTag
            v-else
            :variant="LEDGER_STATUS[entry.status].variant"
            size="sm"
            :label="t(LEDGER_STATUS[entry.status].key)"
          />
        </div>
      </DrawerSection>
    </section>

    <section
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
import OSparkline from "@/lib/data/Sparkline/OSparkline.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import DrawerSection from "./v2/DrawerSection.vue";
import {
  CONFIDENCE_LABEL,
  LEDGER_STATUS,
  sparkPoints,
  type Analysis,
  type Issue,
  type LedgerEntry,
  type Severity,
  type UnfoldKind,
} from "./fixtures";
import type { HypothesisVerdict } from "./data/facts";

type BarKind = NonNullable<Analysis["comparison"]>["rows"][number]["kind"];
type StepKind = Exclude<UnfoldKind, "outcome" | "forecast">;

interface TrailStep {
  key: string;
  kind: StepKind;
  title: I18nText;
  detail?: I18nText;
  at?: string;
  card?: string;
  points?: number[];
  projected?: number;
}

const props = defineProps<{ issue: Issue; entry?: LedgerEntry }>();

const emit = defineEmits<{
  approve: [];
  reject: [];
  "open-unfold": [cardId: string];
}>();

defineSlots<{ report(): unknown }>();

const { t } = useI18nTyped();

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

const LEVEL = { low: 1, medium: 2, high: 3 } as const;

const tone = computed(() => SEVERITY_TONE[props.issue.severity]);
const level = computed(() => LEVEL[props.issue.confidence]);
const unconfirmed = computed(() => props.issue.confidence === "low");

const proposalLabel = computed(() => {
  if (props.issue.proposal?.kind === "detection") return t("autoobserve.drawer.caughtEarlier");
  return props.entry?.status === "awaiting" ? t("autoobserve.drawer.waitingForOk") : undefined;
});

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
    points: ev.points,
    projected: ev.projected,
  }));
  const fromCards = cards
    .filter((c) => TRAIL_KINDS.includes(c.kind) && !claimed.has(c.id))
    .map((c): TrailStep => ({
      key: c.id,
      kind: c.kind as StepKind,
      title: c.title,
      detail: c.peak ? raw(c.threshold ? `${c.peak} · ${c.threshold}` : c.peak) : c.detail,
      at: c.at,
      card: c.id,
      points: c.points,
      projected: c.projected,
    }));
  return [...fromEvidence, ...fromCards].sort((a, b) => order(a.card) - order(b.card));
});

const trailEl = ref<HTMLElement>();
defineExpose({ scrollToTrail: () => trailEl.value?.scrollIntoView({ block: "start" }) });

const reportOpen = ref(false);
watch(
  () => props.issue.id,
  () => (reportOpen.value = false),
);

const notInDemo = () => toast({ variant: "info", message: t("autoobserve.notInDemo") });
</script>
