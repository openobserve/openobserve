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
  <OPageLayout
    bleed
    :title="header.title"
    :icon="page ? undefined : 'navigation'"
    :back="header.back"
    :subtitle="header.subtitle"
    :title-data-test="header.titleTest"
  >
    <template v-if="!page" #subtitle>
      <TopBarStatus :live="live" :date="liveData.today.value" :checked="liveData.checked.value" />
    </template>
    <template v-if="!page" #actions>
      <TopBar @open="openNamed" @search="searchIssues" />
    </template>
    <template v-else-if="page === 'issues'" #actions>
      <ODropdown align="end">
        <template #trigger>
          <OButton
            variant="outline"
            size="sm"
            icon-right="expand-more"
            data-test="autoobserve2-issues-range"
          >
            {{ t(ISSUES_RANGE_LABEL[issuesRange]) }}
          </OButton>
        </template>
        <ODropdownItem
          v-for="option in ISSUES_RANGES"
          :key="option"
          role="menuitemradio"
          :aria-checked="option === issuesRange"
          :data-test="`autoobserve2-issues-range-${option}`"
          @select="setIssuesRange(option)"
        >
          <span class="flex-1">{{ t(ISSUES_RANGE_LABEL[option]) }}</span>
          <template #icon-right>
            <OIcon
              name="check"
              size="sm"
              :class="option === issuesRange ? 'text-text-heading' : 'invisible'"
            />
          </template>
        </ODropdownItem>
      </ODropdown>
    </template>
    <div
      class="bg-surface-subtle [container-type:size] h-full overflow-auto"
      data-test="autoobserve2-page"
    >
      <!-- A size container, so the pinned rail can be capped to the visible panel rather than the viewport. -->
      <div
        v-if="!page"
        class="mx-auto flex max-w-[47.5rem] flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8"
        :class="railShown ? '@min-[60rem]:max-w-[68rem] @min-[60rem]:px-6' : ''"
      >
        <!-- Below the breakpoint both columns dissolve into one ordered list, so suggestions follow the problems. -->
        <div
          class="grid grid-cols-1 gap-6 @min-[60rem]:items-start @min-[60rem]:justify-center @min-[60rem]:gap-8"
          :class="railShown ? '@min-[60rem]:grid-cols-[minmax(0,44rem)_20rem]' : ''"
        >
          <div
            class="contents @min-[60rem]:flex @min-[60rem]:min-w-0 @min-[60rem]:flex-col @min-[60rem]:gap-6"
          >
            <LivePaged
              v-if="live"
              :cap="MAIN_PAGED_CAP"
              class="order-1"
              @settled="pagedSettled = true"
            />
            <ThisWeek
              v-else
              v-model:range="range"
              v-model:priority="priority"
              v-model:shown="shown"
              class="order-1"
              :problems="problems"
              :requests="data.requests"
              :service-count="data.serviceCount"
              @open-problem="openProblem"
              @open-issues="openIssuesPage"
            />
            <PageFooter
              v-if="!live || pagedSettled"
              class="order-3 pt-2"
              @open-coverage="openCoverage()"
              @open-activity="openActivity()"
            />
            <div
              v-if="!live"
              class="border-border-default rounded-surface order-4 mt-6 flex flex-wrap items-center justify-center gap-2 border border-dashed px-4 py-3"
              data-test="autoobserve2-scenario"
            >
              <OTag variant="purple-soft" size="xs" :label="t('autoobserve2.demoTag')" />
              <!-- OSelect drops its id on the popover trigger, so a wrapping label names it; prevent stops a second toggle. -->
              <label class="flex items-center gap-2" @click.prevent>
                <span class="text-text-body text-xs">{{ t("autoobserve2.scenarioLabel") }}</span>
                <OSelect
                  :model-value="scenario"
                  :options="scenarioOptions"
                  size="sm"
                  width="sm"
                  data-test="autoobserve2-scenario-select"
                  @update:model-value="(v) => setScenario(v as Scenario)"
                />
              </label>
            </div>
          </div>
          <aside
            v-if="railShown"
            class="contents @min-[60rem]:sticky @min-[60rem]:top-6 @min-[60rem]:block"
            data-test="autoobserve2-rail"
          >
            <div
              ref="railEl"
              class="contents [scrollbar-width:thin] @min-[60rem]:flex @min-[60rem]:max-h-[calc(100cqh-3rem)] @min-[60rem]:flex-col @min-[60rem]:gap-6 @min-[60rem]:overflow-y-auto @min-[60rem]:overscroll-contain @min-[60rem]:p-px"
              data-test="autoobserve2-rail-scroll"
              @scroll="measureRail"
            >
              <LiveSuggestions
                v-if="live"
                class="order-2 shrink-0"
                :rail="liveData.rail.value"
                :skeleton="liveData.railSkeleton.value"
                @see-all="allOpen = true"
              />
              <Suggestions v-else class="order-2 shrink-0" :requests="suggestions" />
            </div>
            <div
              v-if="railMore && !live"
              class="from-surface-subtle pointer-events-none absolute inset-x-0 bottom-0 hidden h-16 bg-linear-to-t to-transparent @min-[60rem]:block"
            />
            <button
              v-if="railMore && !live"
              type="button"
              class="bg-surface-base border-border-default text-text-secondary hover:text-text-heading focus-visible:ring-focus-ring-accent absolute bottom-2 left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border px-3 py-1 text-xs shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none @min-[60rem]:flex"
              data-test="autoobserve2-rail-more"
              @click="scrollRail"
            >
              {{ t("autoobserve2.rail.more") }}
              <OIcon name="arrow-downward" size="xs" />
            </button>
          </aside>
        </div>
      </div>
      <div
        v-else-if="page === 'coverage'"
        class="mx-auto flex h-full max-w-[100rem] flex-col gap-5 px-4 pt-6 pb-6 @min-[60rem]:px-6"
        data-test="autoobserve2-coverage-page"
      >
        <header class="flex flex-col gap-3">
          <div
            class="flex flex-col gap-4 @min-[60rem]:flex-row @min-[60rem]:items-end @min-[60rem]:justify-between @min-[60rem]:gap-8"
          >
            <div class="flex min-w-0 flex-col gap-1.5">
              <p
                class="text-text-body max-w-[70ch] text-sm leading-relaxed text-pretty"
                :class="live ? 'min-h-11.5' : ''"
                data-test="autoobserve2-coverage-sentence"
              >
                <template v-if="live && liveData.coverageSkeleton.value">
                  <OSkeleton
                    v-for="w in ['w-full', 'w-3/5']"
                    :key="w"
                    animation="none"
                    class="my-1 h-4 max-w-full"
                    :class="w"
                    data-test="autoobserve2-coverage-sentence-skeleton"
                  />
                </template>
                <template v-else>{{ coverageSentence }}</template>
              </p>
            </div>
            <div
              v-if="live"
              class="flex min-h-10 w-full shrink-0 items-end @min-[60rem]:max-w-[26rem]"
            >
              <div
                v-if="liveData.coverageSkeleton.value"
                class="flex w-full flex-col gap-2"
                aria-hidden="true"
              >
                <OSkeleton animation="none" class="h-2 w-full" />
                <div class="flex gap-4">
                  <OSkeleton animation="none" class="h-3 w-20" />
                  <OSkeleton animation="none" class="h-3 w-26" />
                </div>
              </div>
              <CoverageBar
                v-else-if="coverageSegments.watching + coverageSegments.gaps > 0"
                class="w-full"
                :watching="coverageSegments.watching"
                :learning="0"
                :gaps="coverageSegments.gaps"
                live
                @select="(f) => openCoverage({ filter: f }, false)"
              />
            </div>
            <CoverageBar
              v-else
              class="w-full shrink-0 @min-[60rem]:max-w-[26rem]"
              :watching="coverageSegments.watching"
              :learning="coverageSegments.learning"
              :gaps="coverageSegments.gaps"
              @select="(f) => openCoverage({ filter: f }, false)"
            />
          </div>
        </header>
        <div
          class="bg-surface-base border-border-subtle rounded-surface flex min-h-0 flex-1 overflow-hidden border shadow-xs"
        >
          <AutoObserveCoverageTab
            :key="coverageKey"
            :ledger="ledger"
            :scenario="scenario"
            :initial="coverageInitial"
            :source="live ? liveData.source.value : undefined"
            :skeleton="live && liveData.coverageSkeleton.value"
            explain
            header-bar
            @how-it-works="howOpen = true"
          />
        </div>
      </div>
      <div
        v-else-if="page === 'issues'"
        class="mx-auto flex h-full max-w-[100rem] flex-col gap-5 px-4 pt-6 pb-6 @min-[60rem]:px-6"
        data-test="autoobserve2-issues-page"
      >
        <div
          class="bg-surface-base border-border-subtle rounded-surface flex min-h-0 overflow-hidden border shadow-xs"
          :class="live ? 'flex-1' : ''"
        >
          <LiveIssues v-if="live" :range="issuesRange" initial-filter="all" />
          <AutoObserveIssuesTab
            v-else
            :issues="issues"
            :scenario="scenario"
            initial-filter="all"
            @open-issue="openIssue"
          />
        </div>
      </div>
      <ChangesPage
        v-else
        :key="activityKey"
        :ledger="live ? [] : ledger"
        :scenario="scenario"
        :highlight-id="changeId"
        @update-entry="updateEntry"
      >
        <template v-if="live" #empty>
          <AppliedChangesList>
            <div class="bg-surface-base border-border-subtle rounded-surface border py-6 shadow-xs">
              <LiveSurfaceEmpty surface="changes" @action="allOpen = true" />
            </div>
          </AppliedChangesList>
        </template>
      </ChangesPage>

      <AutoObserveIssueDrawer
        v-model:open="problemOpen"
        :issue="selectedIssue"
        :ledger="ledger"
        @update-entry="updateEntry"
      />
      <HistoryDrawer
        v-model:open="historyOpen"
        :entries="live ? [] : history"
        :change-ids="changeIds"
        @open-change="openChange"
      >
        <template v-if="live" #empty>
          <LiveHistory @see-issues="historyToIssues" />
        </template>
      </HistoryDrawer>
      <SettingsDrawer v-model:open="settingsOpen">
        <template v-if="live" #empty>
          <LiveSettingsPanel @action="settingsToHowItWorks" />
        </template>
      </SettingsDrawer>
      <HowItWorksDrawer v-model:open="howOpen" />
      <AllSuggestionsDrawer
        v-if="live"
        v-model:open="allOpen"
        :focus-id="linkedSuggestion"
        :kind="linkedKind"
        @update:kind="clearLinkedKind"
      />
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import TopBar from "@/components/autoobserve/v2/TopBar.vue";
import TopBarStatus from "@/components/autoobserve/v2/TopBarStatus.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ThisWeek from "@/components/autoobserve/v2/ThisWeek.vue";
import Suggestions from "@/components/autoobserve/v2/Suggestions.vue";
import PageFooter from "@/components/autoobserve/v2/PageFooter.vue";
import AutoObserveIssueDrawer from "@/components/autoobserve/AutoObserveIssueDrawer.vue";
import { useIssueLedger } from "@/components/autoobserve/useIssueLedger";
import CoverageBar from "@/components/autoobserve/v2/CoverageBar.vue";
import AutoObserveCoverageTab from "@/components/autoobserve/AutoObserveCoverageTab.vue";
import AutoObserveIssuesTab from "@/components/autoobserve/AutoObserveIssuesTab.vue";
import ChangesPage from "@/components/autoobserve/v2/ChangesPage.vue";
import { useLiveAutoObserve, useLiveMode } from "@/components/autoobserve/live/liveModel";
import { coverageSentence as liveSentence } from "@/components/autoobserve/live/liveCopy";
import LivePaged from "@/components/autoobserve/live/LivePaged.vue";
import LiveIssues from "@/components/autoobserve/live/LiveIssues.vue";
import LiveSurfaceEmpty from "@/components/autoobserve/live/LiveSurfaceEmpty.vue";
import LiveSettingsPanel from "@/components/autoobserve/live/LiveSettingsPanel.vue";
import AppliedChangesList from "@/components/autoobserve/decisions/AppliedChangesList.vue";
import { MAIN_PAGED_CAP } from "@/components/autoobserve/live/incidentsCopy";
import LiveSuggestions from "@/components/autoobserve/live/LiveSuggestions.vue";
import AllSuggestionsDrawer from "@/components/autoobserve/live/AllSuggestionsDrawer.vue";
import LiveHistory from "@/components/autoobserve/live/LiveHistory.vue";
import {
  SIGNALS,
  coverageFor,
  issuesFor,
  type CellState,
  type Issue,
  type Signal,
} from "@/components/autoobserve/fixtures";
import HistoryDrawer from "@/components/autoobserve/v2/HistoryDrawer.vue";
import { isChange } from "@/components/autoobserve/v2/changes";
import SettingsDrawer from "@/components/autoobserve/v2/SettingsDrawer.vue";
import HowItWorksDrawer from "@/components/autoobserve/v2/HowItWorksDrawer.vue";
import { useScenario } from "@/components/autoobserve/data/useScenario";
import { PROBLEMS, problemsIn } from "@/components/autoobserve/data/facts";
import { useDecisions } from "@/components/autoobserve/v2/useDecisions";
import {
  ISSUES_RANGES,
  SCENARIOS,
  PRIORITY_FILTERS,
  PROBLEM_RANGES,
  SCENARIO_LABEL,
  byPriority,
  coverageSummary,
  historyFor,
  inRange,
  logEntries,
  overridesFor,
  problemsFor,
  say,
  scenarioData,
  type IssuesRange,
  type PriorityFilter,
  type Problem,
  type ProblemRange,
  type Scenario,
} from "@/components/autoobserve/v2/fixtures";

const HOW_IT_WORKS_SEEN = "autoobserve2.howItWorksSeen";

const ISSUES_RANGE_LABEL: Record<IssuesRange, I18nKey> = {
  "7d": "autoobserve2.issuesPage.ranges.week",
  "30d": "autoobserve2.issuesPage.ranges.month",
  "90d": "autoobserve2.issuesPage.ranges.quarter",
};

const ISSUES_RANGE_WITHIN: Record<IssuesRange, I18nKey> = {
  "7d": "autoobserve2.issuesPage.within.week",
  "30d": "autoobserve2.issuesPage.within.month",
  "90d": "autoobserve2.issuesPage.within.quarter",
};

const { t, locale } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const { scenario, setScenario } = useScenario();
const store = useDecisions();

// Decisions and fix phases live in one shared store, so leaving for the Nerd view and back never resets them.
const overrides = computed(() => overridesFor(scenario.value, store.decisions, store.phases));

const data = computed(() => scenarioData(scenario.value));
const byId = computed(() => problemsFor(overrides.value));
// Fix asks sit on their problem row, so only the rest are suggestions.
const suggestions = computed(() => data.value.requests.filter((r) => r.kind !== "fixNow"));
const live = useLiveMode();
const liveData = useLiveAutoObserve({ active: () => route.query.page !== "activity" });
const railShown = computed(() => live.value || suggestions.value.length > 0);
const pagedSettled = ref(false);
const allOpen = ref(false);

const problems = computed(() => data.value.problems.map((id) => byId.value[id]).sort(byPriority));
const issuesRange = computed<IssuesRange>(() => {
  const value = route.query.issuesRange as IssuesRange;
  return ISSUES_RANGES.includes(value) ? value : "30d";
});
const issues = computed(() =>
  issuesFor(scenario.value, t, overrides.value.fixed, "quarter").filter((issue) => {
    const problem = Object.values(byId.value).find((p) => p.incidentId === issue.id);
    return problem ? inRange(problem, issuesRange.value) : false;
  }),
);
const history = computed(() => [
  ...logEntries(scenario.value, store.log),
  ...historyFor(scenario.value),
]);

const scenarioOptions = computed(() =>
  SCENARIOS.map((value) => ({ value, label: t(SCENARIO_LABEL[value]) })),
);

const problemOpen = ref(false);
const selectedId = ref<string | null>(null);
const { ledger, updateEntry, issueByIncident } = useIssueLedger(scenario, t);
const changeIds = computed(() => new Set(ledger.value.filter(isChange).map((e) => e.id)));
// Both views open the same issue panel; a problem id maps to its incident in the shared data.
const selectedIssue = computed(() => {
  const fact = selectedId.value ? PROBLEMS[selectedId.value] : undefined;
  return fact ? (issueByIncident(fact.incidentId) ?? null) : null;
});
const priorityParam = String(route.query.priority ?? "").toLowerCase() as PriorityFilter;
const priority = ref<PriorityFilter>(
  PRIORITY_FILTERS.includes(priorityParam) ? priorityParam : "all",
);
const rangeParam = String(route.query.range ?? "") as ProblemRange;
const range = ref<ProblemRange>(PROBLEM_RANGES.includes(rangeParam) ? rangeParam : "7d");
const shownParam = Number(route.query.shown);
const shown = ref(Number.isInteger(shownParam) && shownParam > 0 ? shownParam : 0);
const historyOpen = ref(false);
const settingsOpen = ref(false);
const howOpen = ref(false);

watch(scenario, () => {
  problemOpen.value = false;
  const left = problems.value.filter((p) => inRange(p, range.value));
  if (!left.some((p) => p.severity === priority.value)) priority.value = "all";
});

// The open panel is recorded in the URL, so browser Back from the Nerd view reopens it.
const openProblem = (problem: Problem) => {
  selectedId.value = problem.id;
  problemOpen.value = true;
  void router.replace({
    query: { ...route.query, drawer: "problem", problem: problem.id },
  });
};

// The issues table lists incidents; each maps back to the problem the drawer opens.
const openIssue = (issue: Issue) => {
  const fact = Object.values(PROBLEMS).find((p) => p.incidentId === issue.id);
  if (fact) openProblem(byId.value[fact.id]);
};

const summary = computed(() => coverageSummary(scenario.value));

// The engine has no learning state, and a gap is a missing scoped monitor, not an unseen service.
const coverageSegments = computed(() => {
  if (!live.value) {
    const { watching, learning, unseen } = summary.value.segments;
    return { watching, learning, gaps: unseen };
  }
  const { total, gaps } = liveData.source.value.totals;
  return { watching: total - gaps, learning: 0, gaps };
});

const coverageSentence = computed(() => {
  if (live.value) {
    const parts = [
      liveSentence(t, locale.value, liveData.source.value.totals),
      liveData.learning.value,
    ];
    return raw(parts.filter(Boolean).join(" "));
  }
  const head = say(t, summary.value.head);
  const clauses = summary.value.clauses.map((m) => say(t, m));
  if (!clauses.length) return head;
  const joined = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(clauses);
  const capitalised = joined.charAt(0).toLocaleUpperCase(locale.value) + joined.slice(1);
  return t("autoobserve2.coverageDrawer.summaryWithClauses", { head, clauses: raw(capitalised) });
});

// A full page lives in the URL, so reload and browser Back/Forward land on it.
const PAGES = ["coverage", "activity", "issues"] as const;
const PAGE_QUERY = {
  page: undefined,
  focus: undefined,
  filter: undefined,
  change: undefined,
  q: undefined,
  issuesRange: undefined,
};
const COVERAGE_FILTER_STATES: Record<string, CellState[]> = {
  watching: ["watched"],
  learning: ["learning"],
  attention: ["gap"],
};

const queryString = (key: string) =>
  typeof route.query[key] === "string" ? (route.query[key] as string) : undefined;

// Slack links name one suggestion or one kind; the drawer decides what a stale value shows.
const linkedSuggestion = computed(() => queryString("suggestion") ?? null);
const linkedKind = computed(() => queryString("suggestions") ?? null);
const SUGGESTION_LINK_QUERY = { suggestion: undefined, suggestions: undefined };

const clearLinkedKind = () =>
  void router.replace({ query: { ...route.query, suggestions: undefined } });

const clearSuggestionLink = (isOpen: boolean) => {
  if (isOpen || (!route.query.suggestion && !route.query.suggestions)) return;
  void router.replace({ query: { ...route.query, ...SUGGESTION_LINK_QUERY } });
};

const page = computed(() => PAGES.find((p) => p === route.query.page));
const onCoveragePage = computed(() => page.value === "coverage");
const coverageKey = computed(() => `${queryString("focus") ?? ""}:${queryString("filter") ?? ""}`);

// A focused service opens on its first cell that still needs something; a filter on the first cell in that state.
const coverageInitial = computed<{ service: string; signal: Signal } | undefined>(() => {
  const focus = queryString("focus");
  const filter = queryString("filter");
  const states: CellState[] | undefined = focus
    ? ["gap", "learning"]
    : filter
      ? COVERAGE_FILTER_STATES[filter]
      : undefined;
  if (!states) return undefined;
  const rows = coverageFor(scenario.value, t).filter((r) => !focus || r.service === focus);
  for (const row of rows) {
    const signal = SIGNALS.find((sig) => states.includes(row.cells[sig].state));
    if (signal) return { service: row.service, signal };
  }
  return rows[0] ? { service: rows[0].service, signal: SIGNALS[0] } : undefined;
});

const openCoverage = (target: { focus?: string; filter?: string } = {}, push = true) => {
  const query = { ...route.query, ...DRAWER_QUERY, ...PAGE_QUERY, page: "coverage", ...target };
  void (push ? router.push({ query }) : router.replace({ query }));
};

const changeId = computed(() => queryString("change"));
const activityKey = computed(() => `${scenario.value}:${changeId.value ?? ""}`);

const openActivity = (change?: string) => {
  void router.push({
    query: { ...route.query, ...DRAWER_QUERY, ...PAGE_QUERY, page: "activity", change },
  });
};

const openIssuesPage = () => {
  void router.push({ query: { ...route.query, ...DRAWER_QUERY, ...PAGE_QUERY, page: "issues" } });
};

const searchIssues = (q: string) => {
  void router.push({
    query: { ...route.query, ...DRAWER_QUERY, ...PAGE_QUERY, page: "issues", q },
  });
};

const setIssuesRange = (value: IssuesRange) => {
  void router.replace({
    query: { ...route.query, issuesRange: value === "30d" ? undefined : value },
  });
};

const historyToIssues = () => {
  historyOpen.value = false;
  openIssuesPage();
};

const settingsToHowItWorks = () => {
  settingsOpen.value = false;
  howOpen.value = true;
};

const openChange = (ledgerId: string) => {
  historyOpen.value = false;
  openActivity(ledgerId);
};

// Back pops history when the page was opened from here, so browser Forward still returns to it.
const closePage = () => {
  if (window.history.state?.back) router.back();
  else void router.replace({ query: { ...route.query, ...PAGE_QUERY } });
};

const PAGE_TITLE: Record<(typeof PAGES)[number], { title: I18nKey; test: string }> = {
  coverage: { title: "autoobserve2.coveragePage.title", test: "autoobserve2-coverage-title" },
  issues: { title: "autoobserve2.issuesPage.title", test: "autoobserve2-issues-title" },
  activity: { title: "autoobserve2.activityPage.title", test: "autoobserve2-activity-title" },
};

// Every page shares one header, so the title keeps its place from home to a sub-page.
const header = computed<{
  title: I18nText;
  titleTest: string;
  subtitle?: I18nText;
  back?: { label: I18nText; onClick: () => void; dataTest: string };
}>(() => {
  if (!page.value) return { title: t("autoobserve.title"), titleTest: "autoobserve2-title" };
  return {
    title: t(PAGE_TITLE[page.value].title),
    titleTest: PAGE_TITLE[page.value].test,
    subtitle:
      page.value === "issues"
        ? t("autoobserve2.issuesPage.sentence", {
            within: t(ISSUES_RANGE_WITHIN[issuesRange.value]),
          })
        : undefined,
    back: {
      label: t("autoobserve.title"),
      onClick: closePage,
      dataTest: `autoobserve2-${page.value}-back`,
    },
  };
});

const scrollToInitialCell = async () => {
  const cell = coverageInitial.value;
  if (!onCoveragePage.value || !cell) return;
  await nextTick();
  document
    .querySelector(`[data-test="autoobserve-coverage-cell-${cell.service}-${cell.signal}"]`)
    ?.scrollIntoView({ block: "nearest" });
};
watch(() => [onCoveragePage.value, coverageKey.value], scrollToInitialCell);

const openNamed = (name: "history" | "settings" | "howItWorks") => {
  if (name === "history") historyOpen.value = true;
  else if (name === "settings") settingsOpen.value = true;
  else howOpen.value = true;
};

// A drawer named in the URL reopens, so browser Back from a Nerd deep link lands where the viewer left.
const DRAWER_QUERY = { drawer: undefined, problem: undefined };

const clearDrawerQuery = (isOpen: boolean) => {
  if (isOpen || !route.query.drawer) return;
  void router.replace({ query: { ...route.query, ...DRAWER_QUERY } });
};

// One watcher, so a range change and the filter and expansion resets it causes land in a single URL write.
watch([range, priority, shown], ([r, filter, rows]) => {
  const next = {
    range: r === "7d" ? undefined : r,
    priority: filter === "all" ? undefined : filter.toUpperCase(),
    shown: rows ? String(rows) : undefined,
  };
  const same = (Object.keys(next) as (keyof typeof next)[]).every(
    (k) => next[k] === route.query[k],
  );
  if (!same) void router.replace({ query: { ...route.query, ...next } });
});
watch(problemOpen, clearDrawerQuery);
watch(allOpen, clearSuggestionLink);

const railEl = ref<HTMLElement | null>(null);
const railMore = ref(false);

const measureRail = () => {
  const el = railEl.value;
  if (!el || getComputedStyle(el).display === "contents") {
    railMore.value = false;
    return;
  }
  railMore.value = el.scrollHeight - el.scrollTop - el.clientHeight > 8;
};

const scrollRail = () => {
  const el = railEl.value;
  if (el) el.scrollBy({ top: el.clientHeight * 0.75, behavior: "smooth" });
};

let railObserver: ResizeObserver | undefined;

const observeRail = (el: HTMLElement | null) => {
  railObserver?.disconnect();
  if (!el) return;
  railObserver = new ResizeObserver(measureRail);
  railObserver.observe(el);
  Array.from(el.children).forEach((child) => railObserver?.observe(child));
  measureRail();
};
watch(railEl, observeRail, { flush: "post" });

// Marked seen on close, not open, so a remount before the viewer reads it shows it again.
const markHowItWorksSeen = (isOpen: boolean) => {
  if (isOpen) return;
  try {
    localStorage.setItem(HOW_IT_WORKS_SEEN, "1");
  } catch {
    // Blocked storage: there is nowhere to remember it.
  }
};
watch(howOpen, markHowItWorksSeen);

onMounted(async () => {
  try {
    howOpen.value = !localStorage.getItem(HOW_IT_WORKS_SEEN);
  } catch {
    // Blocked storage: skip the auto-open rather than showing it on every visit.
  }
  const drawer = route.query.drawer;
  const problemId = typeof route.query.problem === "string" ? route.query.problem : "";
  const knownProblem = problemsIn(scenario.value, "quarter").some((p) => p.id === problemId);
  if (page.value) howOpen.value = false;
  // Only a drawer the current scenario can show reopens; live mode has no fixture problems to open.
  if (drawer === "problem" && knownProblem && !live.value) {
    howOpen.value = false;
    selectedId.value = problemId;
    // Focus the row first, so closing a deep-linked drawer lands on it rather than the page body.
    await nextTick();
    document.querySelector<HTMLElement>(`[data-test="autoobserve2-problem-${problemId}"]`)?.focus();
    problemOpen.value = true;
  } else if (drawer || route.query.problem) {
    void router.replace({ query: { ...route.query, ...DRAWER_QUERY } });
  }
  if (live.value && !page.value && (linkedSuggestion.value || linkedKind.value)) {
    howOpen.value = false;
    allOpen.value = true;
  }
  await nextTick();
  observeRail(railEl.value);
  await scrollToInitialCell();
});

onBeforeUnmount(() => {
  railObserver?.disconnect();
});
</script>
