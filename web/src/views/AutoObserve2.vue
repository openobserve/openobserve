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
    class="bg-surface-subtle [container-type:size] h-full overflow-auto"
    data-test="autoobserve2-page"
  >
    <!-- A size container, so the pinned rail can be capped to the visible panel rather than the viewport. -->
    <div
      v-if="!page"
      class="mx-auto flex max-w-[47.5rem] flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8 @min-[60rem]:max-w-[68rem] @min-[60rem]:px-6"
    >
      <TopBar @open="openNamed" />
      <!-- Below the breakpoint both columns dissolve into one ordered list, so the rail's requests come first. -->
      <div
        class="grid grid-cols-1 gap-6 @min-[60rem]:grid-cols-[minmax(0,44rem)_20rem] @min-[60rem]:items-start @min-[60rem]:justify-center @min-[60rem]:gap-8"
      >
        <div
          class="contents @min-[60rem]:flex @min-[60rem]:min-w-0 @min-[60rem]:flex-col @min-[60rem]:gap-6"
        >
          <ThisWeek
            v-model:expanded="weekExpanded"
            v-model:priority="priority"
            class="order-2"
            :data="data.recent"
            :problems="problems"
            @open-problem="openProblem"
          />
          <PageFooter
            class="order-3 pt-2"
            @open-coverage="openCoverage()"
            @open-activity="openActivity()"
          />
          <div
            class="border-border-default rounded-surface order-4 mt-6 flex flex-wrap items-center justify-center gap-2 border border-dashed px-4 py-3"
            data-test="autoobserve2-scenario"
          >
            <OTag variant="purple-soft" size="xs" :label="t('autoobserve2.demoTag')" />
            <span class="text-text-secondary text-xs">{{ t("autoobserve2.scenarioLabel") }}</span>
            <OSelect
              :model-value="scenario"
              :options="scenarioOptions"
              size="sm"
              width="sm"
              data-test="autoobserve2-scenario-select"
              @update:model-value="(v) => setScenario(v as Scenario)"
            />
          </div>
        </div>
        <aside
          class="contents @min-[60rem]:sticky @min-[60rem]:top-6 @min-[60rem]:block"
          data-test="autoobserve2-rail"
        >
          <div
            ref="railEl"
            class="contents [scrollbar-width:thin] @min-[60rem]:flex @min-[60rem]:max-h-[calc(100cqh-7.5rem)] @min-[60rem]:flex-col @min-[60rem]:gap-6 @min-[60rem]:overflow-y-auto @min-[60rem]:overscroll-contain @min-[60rem]:p-px"
            data-test="autoobserve2-rail-scroll"
            @scroll="measureRail"
          >
            <NeedsYou
              class="order-1 shrink-0"
              :requests="data.requests"
              :all-visible="data.allVisible"
              :learning="learningCount"
            />
          </div>
          <div
            v-if="railMore"
            class="from-surface-subtle pointer-events-none absolute inset-x-0 bottom-0 hidden h-16 bg-linear-to-t to-transparent @min-[60rem]:block"
          />
          <button
            v-if="railMore"
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
        <OButton
          variant="ghost"
          size="xs"
          icon-left="arrow-back"
          class="self-start"
          data-test="autoobserve2-coverage-back"
          @click="closePage"
        >
          {{ t("autoobserve2.coveragePage.back") }}
        </OButton>
        <div
          class="flex flex-col gap-4 @min-[60rem]:flex-row @min-[60rem]:items-end @min-[60rem]:justify-between @min-[60rem]:gap-8"
        >
          <div class="flex min-w-0 flex-col gap-1.5">
            <h1
              class="text-text-heading text-2xl leading-tight font-semibold tracking-tight"
              data-test="autoobserve2-coverage-title"
            >
              {{ t("autoobserve2.coveragePage.title") }}
            </h1>
            <p
              class="text-text-secondary max-w-[70ch] text-sm leading-relaxed text-pretty"
              data-test="autoobserve2-coverage-sentence"
            >
              {{ coverageSentence }}
            </p>
          </div>
          <CoverageBar
            class="w-full shrink-0 @min-[60rem]:max-w-[26rem]"
            :watching="coverageSegments.watching"
            :learning="coverageSegments.learning"
            :unseen="coverageSegments.unseen"
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
        />
      </div>
    </div>
    <ChangesPage
      v-else
      :key="activityKey"
      :ledger="ledger"
      :scenario="scenario"
      :highlight-id="changeId"
      @back="closePage"
      @update-entry="updateEntry"
    />

    <AutoObserveIssueDrawer
      v-model:open="problemOpen"
      :issue="selectedIssue"
      :ledger="ledger"
      @update-entry="updateEntry"
    />
    <HistoryDrawer
      v-model:open="historyOpen"
      :entries="history"
      :change-ids="changeIds"
      @open-change="openChange"
    />
    <SettingsDrawer v-model:open="settingsOpen" />
    <HowItWorksDrawer v-model:open="howOpen" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import TopBar from "@/components/autoobserve/v2/TopBar.vue";
import ThisWeek from "@/components/autoobserve/v2/ThisWeek.vue";
import NeedsYou from "@/components/autoobserve/v2/NeedsYou.vue";
import PageFooter from "@/components/autoobserve/v2/PageFooter.vue";
import AutoObserveIssueDrawer from "@/components/autoobserve/AutoObserveIssueDrawer.vue";
import { useIssueLedger } from "@/components/autoobserve/useIssueLedger";
import CoverageBar from "@/components/autoobserve/v2/CoverageBar.vue";
import AutoObserveCoverageTab from "@/components/autoobserve/AutoObserveCoverageTab.vue";
import ChangesPage from "@/components/autoobserve/v2/ChangesPage.vue";
import {
  SIGNALS,
  coverageFor,
  type CellState,
  type Signal,
} from "@/components/autoobserve/fixtures";
import HistoryDrawer from "@/components/autoobserve/v2/HistoryDrawer.vue";
import { isChange } from "@/components/autoobserve/v2/changes";
import SettingsDrawer from "@/components/autoobserve/v2/SettingsDrawer.vue";
import HowItWorksDrawer from "@/components/autoobserve/v2/HowItWorksDrawer.vue";
import { useScenario } from "@/components/autoobserve/data/useScenario";
import { PROBLEMS, serviceStats } from "@/components/autoobserve/data/facts";
import { useDecisions } from "@/components/autoobserve/v2/useDecisions";
import {
  SCENARIOS,
  PRIORITY_FILTERS,
  SCENARIO_LABEL,
  byPriority,
  coverageSummary,
  historyFor,
  logEntries,
  overridesFor,
  problemsFor,
  say,
  scenarioData,
  type PriorityFilter,
  type Problem,
  type Scenario,
} from "@/components/autoobserve/v2/fixtures";

const HOW_IT_WORKS_SEEN = "autoobserve2.howItWorksSeen";

const { t, locale } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const { scenario, setScenario } = useScenario();
const store = useDecisions();

// Decisions and fix phases live in one shared store, so leaving for the Nerd view and back never resets them.
const overrides = computed(() => overridesFor(scenario.value, store.decisions, store.phases));

const data = computed(() => scenarioData(scenario.value));
const byId = computed(() => problemsFor(overrides.value));
const learningCount = computed(() => serviceStats(scenario.value).learning);

const problems = computed(() =>
  data.value.recent.problems.map((id) => byId.value[id]).sort(byPriority),
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
const weekExpanded = ref(false);
const priorityParam = String(route.query.priority ?? "").toLowerCase() as PriorityFilter;
const priority = ref<PriorityFilter>(
  PRIORITY_FILTERS.includes(priorityParam) ? priorityParam : "all",
);
const historyOpen = ref(false);
const settingsOpen = ref(false);
const howOpen = ref(false);

watch(scenario, () => {
  problemOpen.value = false;
  if (!problems.value.some((p) => p.severity === priority.value)) priority.value = "all";
});

// The open panel is recorded in the URL, so browser Back from the Nerd view reopens it.
const openProblem = (problem: Problem) => {
  selectedId.value = problem.id;
  problemOpen.value = true;
  void router.replace({
    query: {
      ...route.query,
      drawer: "problem",
      problem: problem.id,
      all: weekExpanded.value ? "1" : undefined,
    },
  });
};

const summary = computed(() => coverageSummary(scenario.value));
const coverageSegments = computed(() => summary.value.segments);

const coverageSentence = computed(() => {
  const head = say(t, summary.value.head);
  const clauses = summary.value.clauses.map((m) => say(t, m));
  if (!clauses.length) return head;
  const joined = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(clauses);
  const capitalised = joined.charAt(0).toLocaleUpperCase(locale.value) + joined.slice(1);
  return t("autoobserve2.coverageDrawer.summaryWithClauses", { head, clauses: raw(capitalised) });
});

// A full page lives in the URL, so reload and browser Back/Forward land on it.
const PAGES = ["coverage", "activity"] as const;
const PAGE_QUERY = { page: undefined, focus: undefined, filter: undefined, change: undefined };
const COVERAGE_FILTER_STATES: Record<string, CellState[]> = {
  watching: ["watched"],
  learning: ["learning"],
  attention: ["gap"],
};

const queryString = (key: string) =>
  typeof route.query[key] === "string" ? (route.query[key] as string) : undefined;

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

const openChange = (ledgerId: string) => {
  historyOpen.value = false;
  openActivity(ledgerId);
};

// Back pops history when the page was opened from here, so browser Forward still returns to it.
const closePage = () => {
  if (window.history.state?.back) router.back();
  else void router.replace({ query: { ...route.query, ...PAGE_QUERY } });
};

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

// One watcher, so a filter change and the expansion reset it causes land in a single URL write.
watch([weekExpanded, priority], ([isExpanded, filter]) => {
  const next = {
    all: isExpanded ? route.query.all : undefined,
    priority: filter === "all" ? undefined : filter.toUpperCase(),
  };
  if (next.all === route.query.all && next.priority === route.query.priority) return;
  void router.replace({ query: { ...route.query, ...next } });
});
watch(problemOpen, clearDrawerQuery);

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
  weekExpanded.value = route.query.all === "1";
  const drawer = route.query.drawer;
  const problemId = typeof route.query.problem === "string" ? route.query.problem : "";
  const knownProblem = data.value.recent.problems.includes(problemId);
  if (page.value) howOpen.value = false;
  // Only a drawer the current scenario can show reopens; anything else is dropped from the URL.
  if (drawer === "problem" && knownProblem) {
    howOpen.value = false;
    selectedId.value = problemId;
    problemOpen.value = true;
  } else if (drawer || route.query.problem) {
    void router.replace({ query: { ...route.query, ...DRAWER_QUERY } });
  }
  await nextTick();
  observeRail(railEl.value);
  await scrollToInitialCell();
});

onBeforeUnmount(() => {
  railObserver?.disconnect();
});
</script>
