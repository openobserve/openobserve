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
      <TopBarStatus :date="liveData.today.value" :checked="liveData.checked.value" />
    </template>
    <template v-if="!page" #actions>
      <TopBar @open="openDrawer" @search="searchIssues" />
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
        class="mx-auto flex max-w-[47.5rem] flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8 @min-[60rem]:max-w-[68rem] @min-[60rem]:px-6"
      >
        <!-- Below the breakpoint both columns dissolve into one ordered list, so suggestions follow the problems. -->
        <div
          class="grid grid-cols-1 gap-6 @min-[60rem]:grid-cols-[minmax(0,44rem)_20rem] @min-[60rem]:items-start @min-[60rem]:justify-center @min-[60rem]:gap-8"
        >
          <div
            class="contents @min-[60rem]:flex @min-[60rem]:min-w-0 @min-[60rem]:flex-col @min-[60rem]:gap-6"
          >
            <LivePaged
              :cap="MAIN_PAGED_CAP"
              class="order-1"
              @settled="pagedSettled = true"
              @open-incident="openIncident"
              @open-coverage="(filter) => openCoverage({ filter })"
            />
            <PageFooter
              v-if="pagedSettled"
              class="order-3 pt-2"
              @open-coverage="openCoverage()"
              @open-activity="openActivity()"
            />
          </div>
          <aside
            class="contents @min-[60rem]:sticky @min-[60rem]:top-6 @min-[60rem]:block"
            data-test="autoobserve2-rail"
          >
            <div
              class="contents [scrollbar-width:thin] @min-[60rem]:flex @min-[60rem]:max-h-[calc(100cqh-3rem)] @min-[60rem]:flex-col @min-[60rem]:gap-6 @min-[60rem]:overflow-y-auto @min-[60rem]:overscroll-contain @min-[60rem]:p-px"
              data-test="autoobserve2-rail-scroll"
            >
              <LiveSuggestions
                class="order-2 shrink-0"
                :rail="liveData.rail.value"
                :skeleton="liveData.railSkeleton.value"
                @see-all="openSuggestions"
              />
            </div>
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
                class="text-text-body min-h-11.5 max-w-[70ch] text-sm leading-relaxed text-pretty"
                data-test="autoobserve2-coverage-sentence"
              >
                <template v-if="liveData.coverageSkeleton.value">
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
            <div class="flex min-h-10 w-full shrink-0 items-end @min-[60rem]:max-w-[26rem]">
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
                v-else-if="coverageTotals.total > 0"
                class="w-full"
                :watching="coverageTotals.fullyWatched"
                :learning="coverageTotals.learning"
                :partial="coverageTotals.partial"
                :gaps="coverageTotals.gaps"
                @select="(f) => openCoverage({ filter: f }, false)"
              />
            </div>
          </div>
        </header>
        <div
          class="bg-surface-base border-border-subtle rounded-surface flex min-h-0 flex-1 overflow-hidden border shadow-xs"
        >
          <AutoObserveCoverageTab
            :key="coverageKey"
            :source="liveData.source.value"
            :skeleton="liveData.coverageSkeleton.value"
            explain
            header-bar
            @how-it-works="openDrawer('howItWorks')"
          />
        </div>
      </div>
      <div
        v-else-if="page === 'issues'"
        class="mx-auto flex h-full max-w-[100rem] flex-col gap-5 px-4 pt-6 pb-6 @min-[60rem]:px-6"
        data-test="autoobserve2-issues-page"
      >
        <div
          class="bg-surface-base border-border-subtle rounded-surface flex min-h-0 flex-1 overflow-hidden border shadow-xs"
        >
          <LiveIssues :range="issuesRange" initial-filter="all" />
        </div>
      </div>
      <ChangesPage
        v-else
        :key="activityKey"
        :highlight-id="changeId"
        @see-suggestions="openSuggestions"
      />

      <HistoryDrawer
        :open="drawer === 'history'"
        :filter="historyFilter"
        @update:open="(v) => setDrawer(v ? 'history' : null)"
        @update:filter="setHistoryFilter"
        @see-issues="historyToIssues"
        @open-issue="openIssuesPage"
        @see-change="openActivity"
      />
      <SettingsDrawer
        :open="drawer === 'settings'"
        @update:open="(v) => setDrawer(v ? 'settings' : null)"
        @how-it-works="openDrawer('howItWorks')"
      />
      <HowItWorksDrawer
        :open="drawer === 'howItWorks'"
        @update:open="(v) => setDrawer(v ? 'howItWorks' : null)"
      />
      <AllSuggestionsDrawer
        :open="allOpen"
        @update:open="setAllOpen"
        :focus-id="linkedSuggestion"
        :kind="linkedKind"
        @update:kind="clearLinkedKind"
      />
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { AutoObserveIncidentItem } from "@/services/autoobserve";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import TopBar from "@/components/autoobserve/v2/TopBar.vue";
import TopBarStatus from "@/components/autoobserve/v2/TopBarStatus.vue";
import PageFooter from "@/components/autoobserve/v2/PageFooter.vue";
import CoverageBar from "@/components/autoobserve/v2/CoverageBar.vue";
import ChangesPage from "@/components/autoobserve/v2/ChangesPage.vue";
import HistoryDrawer, { type HistoryFilter } from "@/components/autoobserve/v2/HistoryDrawer.vue";
import SettingsDrawer from "@/components/autoobserve/v2/SettingsDrawer.vue";
import HowItWorksDrawer from "@/components/autoobserve/v2/HowItWorksDrawer.vue";
import AutoObserveCoverageTab from "@/components/autoobserve/AutoObserveCoverageTab.vue";
import { useLiveAutoObserve } from "@/components/autoobserve/live/liveModel";
import { coverageStateSentence } from "@/components/autoobserve/live/LiveCoverageSentence";
import LivePaged from "@/components/autoobserve/live/LivePaged.vue";
import LiveIssues from "@/components/autoobserve/live/LiveIssues.vue";
import { MAIN_PAGED_CAP } from "@/components/autoobserve/live/incidentsCopy";
import LiveSuggestions from "@/components/autoobserve/live/LiveSuggestions.vue";
import AllSuggestionsDrawer from "@/components/autoobserve/live/AllSuggestionsDrawer.vue";
import {
  AUTOOBSERVE_DRAWERS,
  ISSUES_RANGES,
  type AutoObserveDrawer,
  type IssuesRange,
} from "@/components/autoobserve/v2/autoobserveRoute";

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

const HISTORY_FILTERS: HistoryFilter[] = ["all", "incident", "change", "decision"];

const { t, locale } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const liveData = useLiveAutoObserve({ active: () => route.query.page !== "activity" });
const pagedSettled = ref(false);

const queryString = (key: string) =>
  typeof route.query[key] === "string" ? (route.query[key] as string) : undefined;

const issuesRange = computed<IssuesRange>(() => {
  const value = route.query.issuesRange as IssuesRange;
  return ISSUES_RANGES.includes(value) ? value : "30d";
});

// Each drawer lives in the URL, so browser Back closes it and a shared link opens it.
const drawer = computed<AutoObserveDrawer | null>(
  () => AUTOOBSERVE_DRAWERS.find((d) => d === route.query.drawer) ?? null,
);
const historyFilter = computed<HistoryFilter>(
  () => HISTORY_FILTERS.find((f) => f === route.query.history) ?? "all",
);

const setDrawer = (next: AutoObserveDrawer | null) => {
  if (next === drawer.value) return;
  const query = { ...route.query, drawer: next ?? undefined, history: undefined };
  void (next ? router.push({ query }) : router.replace({ query }));
};

const openDrawer = (name: AutoObserveDrawer) => setDrawer(name);

const setHistoryFilter = (value: HistoryFilter) =>
  void router.replace({ query: { ...route.query, history: value === "all" ? undefined : value } });

const coverageTotals = computed(() => liveData.source.value.totals);

const coverageSentence = computed(() => {
  const parts = [
    coverageStateSentence(t, locale.value, coverageTotals.value),
    liveData.learning.value,
  ];
  return raw(parts.filter(Boolean).join(" "));
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
  incident: undefined,
};

// Slack links name one suggestion or one kind; the drawer decides what a stale value shows.
const linkedSuggestion = computed(() => queryString("suggestion") ?? null);
const linkedKind = computed(() => queryString("suggestions") ?? null);
const SUGGESTION_LINK_QUERY = { suggestion: undefined, suggestions: undefined };

const clearLinkedKind = () =>
  void router.replace({ query: { ...route.query, suggestions: undefined } });

const page = computed(() => PAGES.find((p) => p === route.query.page));

// A Slack link opens the drawer on the home by itself, so the link alone restores it on reload.
const allOpen = computed(
  () =>
    drawer.value === "suggestions" ||
    (!page.value && !!(linkedSuggestion.value || linkedKind.value)),
);

const setAllOpen = (open: boolean) => {
  if (open) return setDrawer("suggestions");
  void router.replace({
    query: { ...route.query, ...SUGGESTION_LINK_QUERY, drawer: undefined, history: undefined },
  });
};

const openSuggestions = () => setAllOpen(true);
const coverageKey = computed(() => `${queryString("focus") ?? ""}:${queryString("filter") ?? ""}`);

const DRAWER_QUERY = { drawer: undefined, history: undefined };

const openCoverage = (target: { focus?: string; filter?: string } = {}, push = true) => {
  const query = { ...route.query, ...DRAWER_QUERY, ...PAGE_QUERY, page: "coverage", ...target };
  void (push ? router.push({ query }) : router.replace({ query }));
};

const changeId = computed(() => queryString("change"));
const activityKey = computed(() => changeId.value ?? "");

const openActivity = (change?: string) => {
  void router.push({
    query: { ...route.query, ...DRAWER_QUERY, ...PAGE_QUERY, page: "activity", change },
  });
};

const openIssuesPage = (incident?: string) => {
  void router.push({
    query: { ...route.query, ...DRAWER_QUERY, ...PAGE_QUERY, page: "issues", incident },
  });
};

// The issues page owns the issue drawer, so a home row opens it there over the list.
const openIncident = (item: AutoObserveIncidentItem) => openIssuesPage(item.incident.id);

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

const historyToIssues = () => openIssuesPage();

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

// Marked seen on close, not open, so a remount before the viewer reads it shows it again.
watch(
  () => drawer.value === "howItWorks",
  (isOpen, wasOpen) => {
    if (isOpen || !wasOpen) return;
    try {
      localStorage.setItem(HOW_IT_WORKS_SEEN, "1");
    } catch {
      // Blocked storage: there is nowhere to remember it.
    }
  },
);

onMounted(() => {
  let seen = true;
  try {
    seen = !!localStorage.getItem(HOW_IT_WORKS_SEEN);
  } catch {
    // Blocked storage: skip the auto-open rather than showing it on every visit.
  }
  if (!seen && !page.value && !drawer.value && !allOpen.value)
    void router.replace({ query: { ...route.query, drawer: "howItWorks" } });
});
</script>
