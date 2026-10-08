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
    ref="rootRef"
    class="bg-surface-base border-border-default rounded-surface flex flex-col gap-4 overflow-auto border p-6"
    data-test="autoobserve-how-machine"
    @keydown.left="onArrow($event, -1)"
    @keydown.right="onArrow($event, 1)"
  >
    <div class="flex flex-wrap items-start gap-4">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="flex flex-wrap items-center gap-2">
          <OText as="h3" variant="body-strong" class="text-text-heading text-xl!">{{
            t("autoobserve.howItWorks.machine.title")
          }}</OText>
          <OTag
            variant="blue-soft"
            size="sm"
            :label="t('autoobserve.howItWorks.exampleWeek')"
            data-test="autoobserve-how-example-tag"
          />
        </div>
        <OText variant="meta">{{ t("autoobserve.howItWorks.machine.subtitle", story) }}</OText>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <OButton
          variant="outline"
          size="sm"
          icon-left="chevron-left"
          :disabled="overview || step === 0"
          data-test="autoobserve-how-prev"
          @click="manual(step - 1)"
        >
          {{ t("autoobserve.howItWorks.machine.prev") }}
        </OButton>
        <OButton
          variant="outline"
          size="sm"
          :icon-left="playing ? 'pause' : 'play-arrow'"
          :disabled="overview"
          data-test="autoobserve-how-play"
          @click="togglePlay"
        >
          {{
            playing
              ? t("autoobserve.howItWorks.machine.pause")
              : t("autoobserve.howItWorks.machine.play")
          }}
        </OButton>
        <OButton
          variant="outline"
          size="sm"
          icon-right="chevron-right"
          :disabled="overview || step === LAST"
          data-test="autoobserve-how-next"
          @click="manual(step + 1)"
        >
          {{ t("autoobserve.howItWorks.machine.next") }}
        </OButton>
        <OButton
          variant="outline"
          size="sm"
          :active="overview"
          icon-left="dashboard"
          data-test="autoobserve-how-overview"
          @click="toggleOverview"
        >
          {{ t("autoobserve.howItWorks.machine.overview") }}
        </OButton>
        <OButton
          variant="ghost"
          size="sm"
          :icon-left="fullscreen ? 'fullscreen-exit' : 'fullscreen'"
          data-test="autoobserve-how-fullscreen"
          @click="toggleFullscreen"
        >
          {{
            fullscreen
              ? t("autoobserve.howItWorks.machine.exitPresent")
              : t("autoobserve.howItWorks.machine.present")
          }}
        </OButton>
      </div>
    </div>

    <div
      class="mx-auto grid w-fit grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2"
      data-test="autoobserve-how-counter"
    >
      <template v-for="row in counterRows" :key="row.key">
        <OText variant="label" class="text-end">{{ row.label }}</OText>
        <div
          class="flex flex-wrap items-center gap-x-4 gap-y-1"
          :data-test="`autoobserve-how-counter-${row.key}`"
        >
          <template v-for="(c, i) in row.items" :key="c.key">
            <div
              class="flex items-baseline gap-2 transition-opacity duration-500"
              :class="overview || isLit(c.lit) ? 'opacity-100' : 'opacity-40'"
            >
              <span
                class="font-semibold transition-colors duration-500"
                :class="
                  isLit(c.lit) && !overview ? 'text-accent text-2xl' : 'text-text-heading text-xl'
                "
                >{{ c.value }}</span
              >
              <OText variant="meta">{{ c.label }}</OText>
            </div>
            <OIcon
              v-if="i < row.items.length - 1"
              name="arrow-forward"
              size="sm"
              class="text-text-muted"
            />
          </template>
        </div>
      </template>
    </div>

    <div class="overflow-x-auto">
      <svg
        viewBox="0 14 1300 388"
        class="w-full min-w-200"
        role="group"
        :aria-label="t('autoobserve.howItWorks.machine.diagramLabel')"
        data-test="autoobserve-how-diagram"
      >
        <defs>
          <marker
            id="ao-how-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" class="fill-text-muted" />
          </marker>
          <marker
            id="ao-how-arrow-accent"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" class="fill-accent" />
          </marker>
        </defs>

        <g class="opacity-60" data-test="autoobserve-how-phase2">
          <path
            :d="`M${cx(LAST) + HALF} ${NODE_MID} C 1340 380, ${LEDGER_CX + 200} 380, ${LEDGER_CX} ${LEDGER_BOTTOM + 4}`"
            class="stroke-border-strong fill-none"
            stroke-width="2"
            stroke-dasharray="8 8"
            marker-end="url(#ao-how-arrow)"
          />
          <text x="1290" y="378" text-anchor="end" class="fill-text-secondary text-sm">
            {{ t("autoobserve.howItWorks.machine.phase2Action") }}
          </text>
          <text x="990" y="378" text-anchor="end" class="fill-text-secondary text-sm">
            {{ t("autoobserve.howItWorks.machine.phase2Outcome") }}
          </text>
          <rect
            :x="COMING_X - 38"
            y="328"
            width="76"
            height="24"
            rx="12"
            class="fill-surface-subtle stroke-border-default"
          />
          <text
            :x="COMING_X"
            y="345"
            text-anchor="middle"
            class="fill-text-secondary text-xs font-semibold"
          >
            {{ t("autoobserve.howItWorks.coming") }}
          </text>
        </g>

        <g
          class="transition-opacity duration-500"
          :class="overview || step >= 3 ? 'opacity-100' : 'opacity-60'"
          data-test="autoobserve-how-p1-bypass"
        >
          <path
            :d="`M${cx(3)} ${NODE_TOP} C ${cx(3)} 30, ${cx(6)} 30, ${cx(6)} ${NODE_TOP}`"
            class="stroke-status-negative fill-none"
            stroke-width="2"
            marker-end="url(#ao-how-arrow)"
          />
          <text :x="BYPASS_MID" y="32" text-anchor="middle" class="fill-text-heading text-compact">
            {{ t("autoobserve.howItWorks.machine.p1Path") }}
          </text>
          <text
            :x="P2_X"
            :y="NODE_BOTTOM + 22"
            text-anchor="start"
            class="fill-text-secondary text-xs"
          >
            {{ t("autoobserve.howItWorks.machine.p2Path") }}
          </text>
          <text
            :x="P2_X"
            :y="NODE_BOTTOM + 38"
            text-anchor="start"
            class="fill-text-secondary text-xs"
          >
            {{ t("autoobserve.howItWorks.machine.p2PathExtra") }}
          </text>
          <text
            :x="cx(LAST) - 55"
            :y="NODE_TOP - 4"
            text-anchor="end"
            class="fill-text-secondary text-xs"
          >
            {{ t("autoobserve.howItWorks.machine.investigateToYou") }}
          </text>
        </g>

        <g
          class="transition-opacity duration-500"
          :class="overview || LEDGER_STEPS.includes(step) ? 'opacity-100' : 'opacity-60'"
          data-test="autoobserve-how-ledger"
        >
          <line
            :x1="cx(1)"
            :y1="NODE_BOTTOM + 2"
            :x2="LEDGER_X + 40"
            :y2="LEDGER_TOP - 2"
            class="stroke-text-muted"
            stroke-width="2"
            marker-end="url(#ao-how-arrow)"
          />
          <line
            :x1="cx(4)"
            :y1="NODE_BOTTOM + 2"
            :x2="LEDGER_X + LEDGER_W - 40"
            :y2="LEDGER_TOP - 2"
            class="stroke-text-muted"
            stroke-width="2"
            marker-end="url(#ao-how-arrow)"
          />
          <line
            :x1="cx(2)"
            :y1="LEDGER_TOP"
            :x2="cx(2)"
            :y2="NODE_BOTTOM + 4"
            class="stroke-accent"
            stroke-width="2"
            marker-end="url(#ao-how-arrow-accent)"
          />
          <rect
            :x="LEDGER_X"
            :y="LEDGER_TOP"
            :width="LEDGER_W"
            height="54"
            rx="12"
            stroke-width="2"
            class="transition-colors duration-500"
            :class="
              LEDGER_STEPS.includes(step) && !overview
                ? 'fill-surface-accent stroke-accent'
                : 'fill-surface-base stroke-border-strong'
            "
          />
          <text
            :x="LEDGER_CX"
            :y="LEDGER_TOP + 22"
            text-anchor="middle"
            class="fill-text-heading text-sm font-semibold"
          >
            {{ t("autoobserve.howItWorks.machine.ledger.name") }}
          </text>
          <text
            :x="LEDGER_CX"
            :y="LEDGER_TOP + 42"
            text-anchor="middle"
            class="fill-text-secondary text-xs"
          >
            {{ t("autoobserve.howItWorks.machine.ledger.short") }}
          </text>
          <text
            :x="cx(2) + 10"
            :y="NODE_BOTTOM + 34"
            text-anchor="start"
            class="fill-text-secondary text-xs"
          >
            {{ t("autoobserve.howItWorks.machine.ledger.applied") }}
          </text>
        </g>

        <g v-if="overview || step === LAST" data-test="autoobserve-how-learnback">
          <path
            :d="`M${cx(LAST)} ${NODE_BOTTOM + 2} C ${cx(LAST)} 330, 900 ${LEDGER_TOP + 27}, ${LEDGER_X + LEDGER_W + 4} ${LEDGER_TOP + 27}`"
            class="stroke-accent fill-none"
            stroke-width="2.5"
            marker-end="url(#ao-how-arrow-accent)"
          />
          <text
            x="1010"
            y="240"
            text-anchor="middle"
            class="fill-text-heading text-sm font-semibold"
          >
            {{ t("autoobserve.howItWorks.machine.learnBack") }}
          </text>
          <text x="1010" y="258" text-anchor="middle" class="fill-accent text-xs">
            {{ t("autoobserve.howItWorks.machine.learnBackProposal", story) }}
          </text>
        </g>

        <g v-for="(stage, i) in stages" :key="stage.key">
          <line
            v-if="i < stages.length - 1"
            :x1="cx(i) + HALF"
            :y1="NODE_MID"
            :x2="cx(i + 1) - HALF - 2"
            :y2="NODE_MID"
            class="stroke-text-muted"
            stroke-width="2"
            marker-end="url(#ao-how-arrow)"
          />
          <g
            :ref="(el) => (stageEls[i] = el as SVGGElement | null)"
            role="button"
            :tabindex="i === step ? 0 : -1"
            class="group/stage cursor-pointer transition-opacity duration-500 focus:outline-none"
            :class="overview || i === step ? 'opacity-100' : 'opacity-60'"
            :aria-label="stage.name"
            :aria-current="i === step && !overview ? 'step' : undefined"
            :data-test="`autoobserve-how-stage-${stage.key}`"
            @click="manual(i)"
            @keydown.enter.prevent="manual(i)"
            @keydown.space.prevent="manual(i)"
          >
            <rect
              :x="cx(i) - HALF - 5"
              :y="NODE_TOP - 5"
              :width="HALF * 2 + 10"
              :height="NODE_BOTTOM - NODE_TOP + 10"
              rx="16"
              stroke-width="2.5"
              class="stroke-accent fill-none opacity-0 group-focus-visible/stage:opacity-100"
            />
            <rect
              :x="cx(i) - HALF"
              :y="NODE_TOP"
              :width="HALF * 2"
              :height="NODE_BOTTOM - NODE_TOP"
              rx="12"
              stroke-width="2"
              class="transition-colors duration-500"
              :class="
                i === step && !overview
                  ? 'fill-surface-accent stroke-accent'
                  : 'fill-surface-base stroke-border-strong'
              "
            />
            <text
              :x="cx(i)"
              :y="NODE_TOP + 22"
              text-anchor="middle"
              class="fill-text-secondary text-xs"
            >
              {{ stage.number }}
            </text>
            <text
              :x="cx(i)"
              :y="NODE_TOP + 47"
              text-anchor="middle"
              class="fill-text-heading text-lg font-semibold"
            >
              {{ stage.name }}
            </text>
            <text
              :x="cx(i)"
              :y="NODE_TOP + 70"
              text-anchor="middle"
              class="fill-text-secondary text-xs"
            >
              {{ stage.short }}
            </text>
          </g>
        </g>
      </svg>
    </div>
    <div class="sr-only" aria-live="polite" data-test="autoobserve-how-live">
      {{ announcement }}
    </div>

    <div
      v-if="!overview"
      class="bg-surface-subtle rounded-surface flex flex-col gap-2 p-5"
      data-test="autoobserve-how-caption"
    >
      <OText variant="label">{{
        t("autoobserve.howItWorks.machine.stepOf", { n: step + 1, total: stages.length })
      }}</OText>
      <OText as="h4" variant="body-strong" class="text-text-heading text-lg!">{{
        current.name
      }}</OText>
      <OText variant="body" class="max-w-4xl leading-relaxed">{{ current.caption }}</OText>
      <OButton
        v-if="current.tab"
        variant="ghost-primary"
        size="sm"
        class="self-start"
        data-test="autoobserve-how-caption-link"
        @click="emit('go', current.tab, current.focus)"
      >
        {{ t("autoobserve.howItWorks.seeIn", { tab: t(TAB_LABEL[current.tab]) }) }}
      </OButton>
    </div>
    <div
      v-else
      class="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1"
      data-test="autoobserve-how-overview-captions"
    >
      <OCard
        v-for="card in overviewCards"
        :key="card.key"
        variant="panel"
        :data-test="`autoobserve-how-overview-card-${card.key}`"
      >
        <OCardSection role="body" class="flex h-full flex-col gap-1">
          <OText variant="card-title">{{ card.number }} · {{ card.name }}</OText>
          <OText variant="meta" class="flex-1 leading-relaxed">{{ card.caption }}</OText>
          <OButton
            v-if="card.tab"
            variant="ghost-primary"
            size="xs"
            class="self-start"
            :data-test="`autoobserve-how-overview-link-${card.key}`"
            @click="emit('go', card.tab, card.focus)"
          >
            {{ t("autoobserve.howItWorks.seeIn", { tab: t(TAB_LABEL[card.tab]) }) }}
          </OButton>
        </OCardSection>
      </OCard>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OText from "@/lib/core/Typography/OText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { BUDGETS, FUNNEL, issuesFor } from "./fixtures";

const emit = defineEmits<{ go: [tab: string, focusId?: string] }>();

const { t } = useI18nTyped();

const LAST = 6;
const STEP_MS = 4000;
const LEDGER_STEPS = [1, 4, 6];
const TAB_LABEL: Record<string, I18nKey> = {
  coverage: "autoobserve.tabs.coverage",
  activity: "autoobserve.tabs.activity",
  issues: "autoobserve.tabs.issues",
  policy: "autoobserve.tabs.policy",
};
// Arrow keys must not also move focus inside these composite widgets.
const ROVING_FOCUS =
  '[role="tablist"],[role="group"]:not(svg),[role="radiogroup"],[role="toolbar"],[role="listbox"],[role="menu"],[role="menubar"],[role="grid"],[role="tree"]';

const cx = (i: number) => 95 + i * 185;
const HALF = 78;
const NODE_TOP = 96;
const NODE_BOTTOM = 180;
const NODE_MID = (NODE_TOP + NODE_BOTTOM) / 2;
const BYPASS_MID = (cx(3) + cx(LAST)) / 2;
const P2_X = cx(4) + 12;
const LEDGER_W = 300;
const LEDGER_CX = (cx(1) + cx(4)) / 2;
const LEDGER_X = LEDGER_CX - LEDGER_W / 2;
const LEDGER_TOP = 248;
const LEDGER_BOTTOM = LEDGER_TOP + 54;
const COMING_X = 1016;

const incident = issuesFor("incident").find((i) => i.id === "INC-1042");
const facts = incident?.facts;
const problemIncidents = issuesFor("incident").filter((i) => i.id === incident?.id).length;
// One message per notification thread: follow-ups land in the same thread, not as new messages.
const problemMessages = new Set(incident?.thread.length ? [incident.channel] : []).size;
const problemFirings = incident?.firings.reduce((n, f) => n + f.count, 0) ?? 0;
const notifications =
  BUDGETS.reduce((sum, b) => sum + b.used.incident, 0) + FUNNEL.incident.exemptDeliveries;
const story = {
  id: raw(incident?.id),
  count: problemFirings,
  confidence: incident?.confidence ?? 0,
  firstAt: raw(incident?.firings[0]?.sampleTimes[0]),
  firstDetector: raw(incident?.firings[0]?.detector),
  services: raw([...new Set(incident?.firings.map((f) => f.service))].join(", ")),
  openedAt: raw(incident?.thread[0]?.at),
  rcaAt: raw(incident?.thread[1]?.at),
  groupedAt: raw(incident?.timeline[incident.timeline.length - 1]?.at),
  service: raw(facts?.deployService),
  version: raw(facts?.version),
  pods: facts?.pods ?? 0,
  alert: raw(facts?.alert),
  from: facts?.thresholdFrom ?? 0,
  to: facts?.thresholdTo ?? 0,
  firings: FUNNEL.incident.firings.toLocaleString(),
  held: FUNNEL.incident.heldForDigest,
};

const step = defineModel<number>("step", { default: 0 });
const overview = defineModel<boolean>("overview", { default: false });
const stageEls: (SVGGElement | null)[] = [];
const playing = ref(false);
const fullscreen = ref(false);
const rootRef = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

interface Stage {
  key: string;
  number: I18nText;
  name: I18nText;
  short: I18nText;
  caption: I18nText;
  tab?: string;
  focus?: string;
}

const stageNumber = (i: number) => t("autoobserve.howItWorks.machine.stageNumber", { n: i });

const stages = computed<Stage[]>(() => [
  {
    key: "data",
    number: stageNumber(1),
    name: t("autoobserve.howItWorks.machine.data.name"),
    short: t("autoobserve.howItWorks.machine.data.short"),
    caption: t("autoobserve.howItWorks.machine.data.caption"),
  },
  {
    key: "coverage",
    number: stageNumber(2),
    name: t("autoobserve.howItWorks.machine.coverage.name"),
    short: t("autoobserve.howItWorks.machine.coverage.short"),
    caption: t("autoobserve.howItWorks.machine.coverage.caption"),
    tab: "coverage",
  },
  {
    key: "detect",
    number: stageNumber(3),
    name: t("autoobserve.howItWorks.machine.detect.name"),
    short: t("autoobserve.howItWorks.machine.detect.short", story),
    caption: t("autoobserve.howItWorks.machine.detect.caption", story),
  },
  {
    key: "incident",
    number: stageNumber(4),
    name: t("autoobserve.howItWorks.machine.incident.name"),
    short: t("autoobserve.howItWorks.machine.incident.short", story),
    caption: t("autoobserve.howItWorks.machine.incident.caption", story),
    tab: "issues",
    focus: incident?.id,
  },
  {
    key: "calibrate",
    number: stageNumber(5),
    name: t("autoobserve.howItWorks.machine.calibrate.name"),
    short: t("autoobserve.howItWorks.machine.calibrate.short"),
    caption: t("autoobserve.howItWorks.machine.calibrate.caption", story),
    tab: "activity",
    focus: "L-313",
  },
  {
    key: "investigate",
    number: stageNumber(6),
    name: t("autoobserve.howItWorks.machine.investigate.name"),
    short: t("autoobserve.howItWorks.machine.investigate.short", story),
    caption: t("autoobserve.howItWorks.machine.investigate.caption", story),
    tab: "issues",
    focus: incident?.id,
  },
  {
    key: "you",
    number: stageNumber(7),
    name: t("autoobserve.howItWorks.machine.you.name"),
    short: t("autoobserve.howItWorks.machine.you.short"),
    caption: t("autoobserve.howItWorks.machine.you.caption", story),
    tab: "activity",
    focus: incident?.proposal?.ledgerId,
  },
]);

const overviewCards = computed(() => [
  ...stages.value,
  {
    key: "ledger",
    number: t("autoobserve.howItWorks.machine.ledger.number"),
    name: t("autoobserve.howItWorks.machine.ledger.name"),
    caption: t("autoobserve.howItWorks.machine.ledger.caption"),
    tab: "activity",
    focus: undefined,
  },
]);

const current = computed(() => stages.value[step.value]);

const announcement = computed(() =>
  overview.value
    ? t("autoobserve.howItWorks.machine.overview")
    : t("autoobserve.howItWorks.machine.announce", {
        n: step.value + 1,
        total: stages.value.length,
        stage: current.value.name,
      }),
);

const counterRows = computed(() => [
  {
    key: "problem",
    label: t("autoobserve.howItWorks.machine.rowProblem"),
    items: [
      {
        key: "firings",
        value: problemFirings.toLocaleString(),
        label: t("autoobserve.howItWorks.machine.counterFirings"),
        lit: [2],
      },
      {
        key: "incident",
        value: problemIncidents.toLocaleString(),
        label: t("autoobserve.howItWorks.machine.counterIncident"),
        lit: [3],
      },
      {
        key: "message",
        value: problemMessages.toLocaleString(),
        label: t("autoobserve.howItWorks.machine.counterMessage"),
        lit: [LAST],
      },
    ],
  },
  {
    key: "week",
    label: t("autoobserve.howItWorks.machine.rowWeek"),
    items: [
      {
        key: "firings",
        value: story.firings,
        label: t("autoobserve.howItWorks.machine.counterFirings"),
        lit: [2],
      },
      {
        key: "incidents",
        value: FUNNEL.incident.incidents.toLocaleString(),
        label: t("autoobserve.howItWorks.machine.counterIncidents"),
        lit: [3],
      },
      {
        key: "held",
        value: story.held.toLocaleString(),
        label: t("autoobserve.howItWorks.machine.counterHeld"),
        lit: [4],
      },
      {
        key: "notifications",
        value: notifications.toLocaleString(),
        label: t("autoobserve.howItWorks.machine.counterNotifications"),
        lit: [LAST],
      },
    ],
  },
]);

const isLit = (lit: number[]) => lit.includes(step.value);

const stop = () => {
  if (timer) clearInterval(timer);
  timer = undefined;
  playing.value = false;
};

const manual = (next: number) => {
  stop();
  overview.value = false;
  step.value = Math.min(LAST, Math.max(0, next));
};

const togglePlay = () => {
  if (playing.value) return stop();
  if (step.value === LAST) step.value = 0;
  playing.value = true;
  timer = setInterval(() => {
    if (step.value >= LAST) return stop();
    step.value += 1;
    if (step.value >= LAST) stop();
  }, STEP_MS);
};

const toggleOverview = () => {
  stop();
  overview.value = !overview.value;
};

const syncFullscreen = () => {
  fullscreen.value = document.fullscreenElement === rootRef.value;
};

const toggleFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen?.();
  else void rootRef.value?.requestFullscreen?.();
};

const onArrow = (event: KeyboardEvent, delta: number) => {
  const target = event.target as Element | null;
  if (overview.value || target?.closest(ROVING_FOCUS) || target?.closest("input,textarea")) return;
  event.preventDefault();
  manual(step.value + delta);
};

watch(step, async () => {
  const hadStageFocus = stageEls.includes(document.activeElement as SVGGElement);
  await nextTick();
  const el = stageEls[step.value];
  el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (hadStageFocus) el?.focus();
});

onMounted(() => document.addEventListener("fullscreenchange", syncFullscreen));
onBeforeUnmount(() => {
  stop();
  document.removeEventListener("fullscreenchange", syncFullscreen);
});
</script>
