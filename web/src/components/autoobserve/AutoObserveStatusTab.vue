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
  <OContent y class="min-h-0 flex-1 overflow-auto" data-test="autoobserve-status">
    <div class="flex flex-col gap-4">
      <OCard variant="outlined" data-test="autoobserve-status-hero">
        <OCardSection role="body" class="flex items-start gap-4">
          <div
            class="flex size-12 shrink-0 items-center justify-center rounded-full"
            :class="HERO[heroState].chip"
          >
            <OIcon :name="HERO[heroState].icon" size="lg" />
          </div>
          <div class="flex min-w-0 flex-col gap-1">
            <OText
              as="h2"
              variant="body-strong"
              class="text-text-heading text-2xl!"
              data-test="autoobserve-headline"
            >
              {{ headline }}
            </OText>
            <p class="text-text-secondary text-sm">
              {{ sub }}
            </p>
            <p
              class="text-text-secondary flex items-center gap-1 text-xs"
              data-test="autoobserve-self-check"
            >
              <OIcon name="check-circle" size="xs" class="text-icon-chip-success-text" />
              {{
                t(
                  "autoobserve.status.selfCheck",
                  { count: LAST_CHECKED_MINUTES },
                  LAST_CHECKED_MINUTES,
                )
              }}
            </p>
          </div>
          <OButton
            variant="ghost-primary"
            size="sm"
            class="ms-auto shrink-0"
            data-test="autoobserve-status-how-it-works"
            @click="emit('go', 'howItWorks')"
          >
            {{ t("autoobserve.howItWorks.statusLink") }}
          </OButton>
        </OCardSection>
      </OCard>

      <OBanner
        v-if="deferred.length"
        variant="info"
        icon="schedule"
        data-test="autoobserve-status-deferred"
      >
        <p class="text-sm font-medium">
          {{ t("autoobserve.status.deferred", { count: deferred.length }, deferred.length) }}
        </p>
        <p class="text-xs">{{ t("autoobserve.status.p1NeverDeferred") }}</p>
      </OBanner>

      <OStatStrip :items="stats" data-test="autoobserve-status-stats" />

      <OCard variant="outlined" data-test="autoobserve-status-noise">
        <OCardSection role="header">
          <OText variant="panel-title">{{ t("autoobserve.status.noiseTitle") }}</OText>
        </OCardSection>
        <OCardSection role="body" class="flex flex-col gap-3 pt-0">
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div v-for="(step, i) in funnel" :key="step.key" class="flex items-center gap-6">
              <div class="flex flex-col">
                <span class="text-3xl font-semibold" :class="step.tone">{{ step.value }}</span>
                <span class="text-text-secondary text-xs">{{ step.label }}</span>
              </div>
              <OIcon
                v-if="i < funnel.length - 1"
                name="arrow-forward"
                size="md"
                class="text-text-muted"
              />
            </div>
          </div>
          <p class="text-text-secondary text-xs">{{ t("autoobserve.status.noiseHint") }}</p>
        </OCardSection>
      </OCard>

      <div class="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <OCard variant="outlined" data-test="autoobserve-status-open">
          <OCardSection role="header">
            <OText variant="panel-title">{{ t("autoobserve.status.openProblems") }}</OText>
            <OButton
              variant="ghost-primary"
              size="xs"
              class="ms-auto"
              data-test="autoobserve-status-open-all"
              @click="emit('go', 'issues')"
            >
              {{ t("autoobserve.status.viewAll") }}
            </OButton>
          </OCardSection>
          <OCardSection role="body" class="pt-0">
            <p v-if="!openIssues.length" class="text-text-secondary text-sm">
              {{ nothingOpen }}
            </p>
            <ul v-else class="flex flex-col">
              <li
                v-for="issue in openIssues"
                :key="issue.id"
                class="border-border-subtle flex flex-col gap-1 border-b py-2 last:border-b-0"
              >
                <div class="flex items-center gap-2">
                  <OTag type="severity" :value="issue.severity" size="sm" />
                  <OButton
                    variant="ghost"
                    size="sm"
                    class="min-w-0 justify-start"
                    :data-test="`autoobserve-status-issue-${issue.id}`"
                    @click="emit('open-issue', issue)"
                  >
                    <span class="truncate">{{ issue.title }}</span>
                  </OButton>
                  <span class="text-text-secondary ms-auto shrink-0 text-xs">{{
                    issue.started
                  }}</span>
                </div>
                <p class="text-text-secondary ps-1 text-xs">{{ issue.cause }}</p>
              </li>
            </ul>
          </OCardSection>
        </OCard>

        <OCard variant="outlined" data-test="autoobserve-status-routing">
          <OCardSection role="header">
            <OText variant="panel-title">{{ t("autoobserve.status.routingTitle") }}</OText>
          </OCardSection>
          <OCardSection role="body" class="flex flex-col gap-3 pt-0">
            <ul class="flex flex-col gap-1.5">
              <li
                v-for="row in routing"
                :key="row.key"
                class="flex items-center gap-2 text-sm"
                :data-test="`autoobserve-status-routing-${row.key}`"
              >
                <span class="text-text-body">{{ row.label }}</span>
                <span class="text-text-secondary ms-auto text-xs tabular-nums">{{
                  row.count
                }}</span>
              </li>
            </ul>
            <p class="text-text-secondary text-xs">{{ t("autoobserve.status.routingHint") }}</p>
          </OCardSection>
        </OCard>

        <OCard variant="outlined" data-test="autoobserve-status-activity">
          <OCardSection role="header">
            <OText variant="panel-title">{{ t("autoobserve.status.recentActivity") }}</OText>
            <OButton
              variant="ghost-primary"
              size="xs"
              class="ms-auto"
              data-test="autoobserve-status-activity-all"
              @click="emit('go', 'activity')"
            >
              {{ t("autoobserve.status.viewAll") }}
            </OButton>
          </OCardSection>
          <OCardSection role="body" class="pt-0">
            <ul class="flex flex-col">
              <li
                v-for="entry in recentActivity"
                :key="entry.id"
                class="border-border-subtle flex items-center gap-2 border-b py-2 text-sm last:border-b-0"
              >
                <OText variant="mono" class="shrink-0">{{ entry.actionClass }}</OText>
                <span class="text-text-body min-w-0 flex-1 truncate">{{ entry.target }}</span>
                <OTag
                  :variant="LEDGER_STATUS[entry.status].variant"
                  size="xs"
                  :label="t(LEDGER_STATUS[entry.status].key)"
                />
              </li>
            </ul>
          </OCardSection>
        </OCard>

        <OCard variant="outlined" data-test="autoobserve-status-gaps">
          <OCardSection role="header">
            <OText variant="panel-title">{{ t("autoobserve.status.coverageGaps") }}</OText>
            <OButton
              variant="ghost-primary"
              size="xs"
              class="ms-auto"
              data-test="autoobserve-status-gaps-all"
              @click="emit('go', 'coverage')"
            >
              {{ t("autoobserve.status.viewAll") }}
            </OButton>
          </OCardSection>
          <OCardSection role="body" class="pt-0">
            <ul class="flex flex-col">
              <li
                v-for="g in gaps"
                :key="g.key"
                class="border-border-subtle flex items-start gap-2 border-b py-2 text-sm last:border-b-0"
              >
                <OIcon name="warning-amber" size="sm" class="text-icon-chip-warning-text mt-0.5" />
                <div class="flex min-w-0 flex-col">
                  <span class="text-text-body">{{ g.title }}</span>
                  <span class="text-text-secondary text-xs">{{ g.reason }}</span>
                </div>
              </li>
            </ul>
          </OCardSection>
        </OCard>
      </div>
    </div>
  </OContent>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OContent from "@/lib/core/Content/OContent.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { LAST_CHECKED_MINUTES, problemsIn, scenarioFacts } from "./data/facts";
import {
  FUNNEL,
  PAGES_BY_DESTINATION,
  LEDGER_STATUS,
  SIGNAL_LABEL,
  SIGNALS,
  THIS_WEEK_LEDGER,
  coverageFor,
  coverageStats,
  lastResolved,
  streamsFor,
  type Issue,
  type LedgerEntry,
  type Scenario,
} from "./fixtures";

const props = defineProps<{
  scenario: Scenario;
  issues: Issue[];
  ledger: LedgerEntry[];
}>();

const emit = defineEmits<{
  "open-issue": [issue: Issue];
  go: [tab: string];
}>();

const { t } = useI18nTyped();

const HERO: Record<"incident" | "blind" | "quiet", { chip: string; icon: IconName }> = {
  incident: { chip: "bg-icon-chip-error-bg text-icon-chip-error-text", icon: "report-problem" },
  blind: { chip: "bg-icon-chip-warning-bg text-icon-chip-warning-text", icon: "visibility-off" },
  quiet: { chip: "bg-icon-chip-success-bg text-icon-chip-success-text", icon: "check-circle" },
};

const thisWeek = new Set(THIS_WEEK_LEDGER);
const funnelNumbers = computed(() => FUNNEL[props.scenario]);
const coverage = computed(() => coverageStats(props.scenario));
const streams = computed(() => streamsFor(props.scenario, t));
const gapServiceCount = computed(() => coverage.value.gaps);
const unscannedCount = computed(() => streams.value.filter((s) => !s.lastScanned).length);
const stalled = computed(() =>
  scenarioFacts(props.scenario).gaps.find((g) => g.kind === "stalled"),
);
const proposalCount = computed(() => props.ledger.filter((e) => e.status === "awaiting").length);
const heroState = computed(() => {
  if (openIssues.value.length) return "incident";
  return stalled.value ? "blind" : "quiet";
});
const headline = computed(() => {
  if (heroState.value === "incident") {
    const count = openIssues.value.length;
    return t("autoobserve.status.incidentHeadline", { count }, count);
  }
  if (heroState.value === "blind") {
    return t(
      "autoobserve.status.blindHeadline",
      { count: gapServiceCount.value },
      gapServiceCount.value,
    );
  }
  return t("autoobserve.status.quietHeadline");
});
const sub = computed(() => {
  if (heroState.value === "incident") return t("autoobserve.status.incidentSub");
  if (!gapServiceCount.value && !unscannedCount.value && !proposalCount.value) {
    return t("autoobserve.status.quietSubClear");
  }
  const gaps = gapServiceCount.value;
  const streamCount = unscannedCount.value;
  const items = [
    ...(gaps ? [t("autoobserve.status.subGaps", { count: gaps }, gaps)] : []),
    ...(streamCount
      ? [t("autoobserve.status.subStreams", { count: streamCount }, streamCount)]
      : []),
  ];
  const parts = items.length
    ? [
        t(
          "autoobserve.status.subNeedLook",
          { items: items.join(t("autoobserve.status.subAnd")) },
          gaps + streamCount,
        ),
      ]
    : [];
  if (proposalCount.value) {
    parts.push(
      t("autoobserve.status.subProposals", { count: proposalCount.value }, proposalCount.value),
    );
  }
  return parts.join(" ");
});
const nothingOpen = computed(() => {
  const when = lastResolved(props.scenario, t);
  return when
    ? t("autoobserve.status.nothingOpen", { when })
    : t("autoobserve.status.nothingOpenEver");
});
const routing = computed(() => [
  ...PAGES_BY_DESTINATION.map((d) => {
    const pages = d.pages[props.scenario];
    const asks = d.asks[props.scenario];
    const parts = [t("autoobserve.status.pagesCount", { count: pages }, pages)];
    if (asks) parts.push(t("autoobserve.status.asksCount", { count: asks }, asks));
    return { key: d.id, label: d.destination, count: parts.join(", ") };
  }),
  {
    key: "messages",
    label: t("autoobserve.status.messagesNoPage"),
    count: (() => {
      const n = problemsIn(props.scenario, "week").filter((p) => p.severity === "p3").length;
      return t("autoobserve.status.messagesCount", { count: n }, n);
    })(),
  },
  {
    key: "summary",
    label: t("autoobserve.status.fridaySummary"),
    count: t(
      "autoobserve.status.problemsCount",
      { count: funnelNumbers.value.heldForDigest },
      funnelNumbers.value.heldForDigest,
    ),
  },
]);
const openIssues = computed(() =>
  props.issues.filter((i) => i.status !== "resolved" && !i.deferred),
);
const deferred = computed(() => props.issues.filter((i) => i.deferred));
const changesThisWeek = computed(
  () =>
    props.ledger.filter(
      (e) => thisWeek.has(e.id) && ["auto_applied", "kept", "approved"].includes(e.status),
    ).length,
);
const recentActivity = computed(() => props.ledger.slice(0, 5));

const stats = computed<StatItem[]>(() => [
  {
    key: "watched",
    label: t("autoobserve.status.servicesWatched"),
    value: coverage.value.fullyWatched,
    sub: t("autoobserve.status.ofTotal", { total: coverage.value.total }),
    icon: "visibility",
    tone: "success",
  },
  {
    key: "learning",
    label: t("autoobserve.status.learning"),
    value: coverage.value.learning,
    icon: "hourglass-empty",
    tone: "info",
  },
  {
    key: "gaps",
    label: t("autoobserve.status.gaps"),
    value: gapServiceCount.value,
    icon: "warning-amber",
    tone: "warning",
  },
  {
    key: "notifications",
    label: t("autoobserve.status.pagesThisWeek"),
    sub: t("autoobserve.status.thisWeek"),
    value: funnelNumbers.value.pages,
    icon: "notifications",
    tone: "primary",
  },
  {
    key: "changes",
    label: t("autoobserve.status.changesThisWeek"),
    sub: t("autoobserve.status.thisWeek"),
    value: changesThisWeek.value,
    icon: "auto-awesome",
    tone: "purple",
  },
]);

const funnel = computed(() => [
  {
    key: "firings",
    value: funnelNumbers.value.firings.toLocaleString(),
    label: t(
      "autoobserve.status.firings",
      { count: funnelNumbers.value.firings },
      funnelNumbers.value.firings,
    ),
    tone: "text-text-secondary",
  },
  {
    key: "incidents",
    value: funnelNumbers.value.incidents.toLocaleString(),
    label: t(
      "autoobserve.status.incidents",
      { count: funnelNumbers.value.incidents },
      funnelNumbers.value.incidents,
    ),
    tone: "text-text-body",
  },
  {
    key: "notifications",
    value: funnelNumbers.value.pages.toLocaleString(),
    label: t(
      "autoobserve.status.notifications",
      { count: funnelNumbers.value.pages },
      funnelNumbers.value.pages,
    ),
    tone: "text-text-heading",
  },
]);

const gaps = computed(() => {
  const rows = coverageFor(props.scenario, t).flatMap((row) => {
    const signals = SIGNALS.filter((s) => row.cells[s].state === "gap");
    if (!signals.length) return [];
    return [
      {
        key: row.service,
        title: t("autoobserve.status.gapTitle", {
          service: raw(row.service),
          signal: raw(signals.map((s) => t(SIGNAL_LABEL[s])).join(", ")),
        }),
        reason: row.cells[signals[0]].reason ?? "",
      },
    ];
  });
  const unscanned = streams.value
    .filter((s) => !s.lastScanned)
    .map((s) => ({
      key: s.stream,
      title: t("autoobserve.status.streamTitle", { stream: raw(s.stream) }),
      reason: t("autoobserve.coverage.notScanned"),
    }));
  return [...unscanned, ...rows];
});
</script>
