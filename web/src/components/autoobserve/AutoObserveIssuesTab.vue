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
  <OTable
    :data="rows"
    :columns="columns"
    :frame="false"
    :fill-height="false"
    row-key="id"
    pagination="client"
    :page-size="20"
    :show-global-filter="false"
    :row-section="(row: Issue) => row.day"
    class="min-h-0 w-full"
    data-test="autoobserve-issues-table"
    :row-rail-tone="(row: Issue) => row.severity"
    @row-click="(row: Issue) => emit('open-issue', row)"
  >
    <template #toolbar>
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <div class="flex min-w-[12rem] flex-1 items-center sm:max-w-[22rem]">
          <label :for="SEARCH_ID" class="sr-only">{{ t("autoobserve.issues.searchLabel") }}</label>
          <OInput
            :id="SEARCH_ID"
            v-model="query"
            size="sm"
            clearable
            class="w-full"
            :placeholder="t('autoobserve.issues.searchPlaceholder')"
            data-test="autoobserve-issues-search"
            @keydown.esc="clearSearch"
          >
            <template #icon-left>
              <OIcon name="search" size="sm" class="text-text-secondary" />
            </template>
          </OInput>
          <span class="sr-only" role="status" data-test="autoobserve-issues-search-status">{{
            announcement
          }}</span>
        </div>
        <OToggleGroup
          :model-value="priority"
          :aria-label="t('autoobserve2.recent.priorityLabel')"
          data-test="autoobserve-issues-priority"
          @update:model-value="(v) => v && (priority = v as PriorityFilter)"
        >
          <OToggleGroupItem
            v-for="option in PRIORITY_FILTERS"
            :key="option"
            :value="option"
            size="xs"
            :disabled="!counts[option] && option !== priority"
            :data-test="`autoobserve-issues-priority-${option}`"
          >
            {{ option === "all" ? t("autoobserve2.recent.all") : option.toUpperCase() }}
            <span class="ms-1 tabular-nums">{{ counts[option] }}</span>
          </OToggleGroupItem>
        </OToggleGroup>
        <OToggleGroup
          mobile-dropdown
          :model-value="filter"
          class="ms-auto"
          data-test="autoobserve-issues-filter"
          @update:model-value="(v) => (filter = v as typeof filter)"
        >
          <OToggleGroupItem value="open" size="sm">{{
            t("autoobserve.issues.open")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="resolved" size="sm">{{
            t("autoobserve.issues.recent")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="all" size="sm">{{
            t("autoobserve.issues.all")
          }}</OToggleGroupItem>
        </OToggleGroup>
      </div>
    </template>
    <template #subheader>
      <div
        class="px-page-edge border-table-row-divider flex items-center gap-2 border-b py-1.5"
        data-test="autoobserve-issues-summary"
      >
        <OIcon name="notifications-active" size="sm" class="text-text-secondary shrink-0" />
        <span class="text-text-secondary text-xs">{{ t("autoobserve.issues.subtitle") }}</span>
      </div>
    </template>
    <template #group-header="{ sectionKey, rows: sectionRows }">
      <p
        class="text-text-body flex items-center gap-1.5 px-2 py-1 text-xs font-medium"
        :data-test="`autoobserve-issues-day-${sectionKey}`"
      >
        {{ t(DAY_LABEL[sectionKey as DayKey]) }}
        <span class="text-text-secondary tabular-nums">· {{ sectionRows.length }}</span>
      </p>
    </template>
    <template #cell-id="{ row }">
      <span class="text-text-body font-mono text-xs whitespace-nowrap tabular-nums">{{
        row.id
      }}</span>
    </template>
    <template #cell-title="{ row }">
      <div class="flex min-w-0 flex-col gap-1 py-1.5 whitespace-normal">
        <span class="text-text-heading line-clamp-2 leading-snug font-medium text-pretty">
          {{ row.title }}
        </span>
        <span
          class="text-text-secondary text-2xs flex flex-wrap gap-x-1.5 font-mono leading-4 tabular-nums"
          :data-test="`autoobserve-issue-meta-${row.id}`"
        >
          <!-- The separator trails its part, so a wrapped line never starts with a dot. -->
          <span v-for="(part, i) in metaFor(row)" :key="i" class="whitespace-nowrap"
            >{{ part
            }}<span
              v-if="i < metaFor(row).length - 1"
              aria-hidden="true"
              class="text-text-muted ms-1.5"
              >·</span
            ></span
          >
        </span>
        <IssueAskStrip
          v-if="askFor(row)"
          :request="askFor(row)!"
          :title="row.title"
          class="mt-0.5"
        />
      </div>
    </template>
    <template #cell-severity="{ row }">
      <OTag type="severity" :value="row.severity" size="sm" />
    </template>
    <template #cell-services="{ row }">
      <div class="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
        <OTag
          v-for="svc in row.services"
          :key="svc"
          variant="default-soft"
          shape="rounded"
          size="xs"
          :label="raw(svc)"
        />
      </div>
    </template>
    <template #cell-status="{ row }">
      <OTag
        v-if="row.deferred"
        variant="default-soft"
        size="sm"
        icon="schedule"
        :label="t('autoobserve.issues.heldForDigest')"
      />
      <OTag v-else type="incidentStatus" :value="row.status" size="sm" />
    </template>
    <template #cell-cause="{ row }">
      <span class="text-text-secondary line-clamp-2 text-xs leading-snug whitespace-normal">
        {{ row.cause }}
      </span>
    </template>
    <template #cell-signal="{ row }">
      <ProblemSpark
        v-if="problems[row.problemId]"
        :chart="problems[row.problemId].chart"
        :outcome="problems[row.problemId].outcome"
        class="flex py-1.5"
      />
    </template>
    <template v-if="FUNNEL[scenario].incidents > issues.length" #footer-note>
      <span class="text-text-secondary text-xs" data-test="autoobserve-issues-subset-note">
        {{
          t("autoobserve.issues.subsetNote", {
            shown: rows.length,
            total: FUNNEL[scenario].incidents,
          })
        }}
      </span>
    </template>
    <template #empty>
      <OEmptyState
        v-if="term"
        size="block"
        illustration="no-results"
        :title="t('autoobserve.issues.noMatch', { query: raw(term) })"
        :action-label="t('autoobserve.issues.clearSearch')"
        data-test="autoobserve-issues-no-match"
        @action="clearSearch"
      />
      <OEmptyState
        v-else
        size="block"
        illustration="check"
        :title="t('autoobserve.issues.emptyTitle')"
        :description="t('autoobserve.issues.emptyDescription')"
      />
    </template>
  </OTable>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { CONFIDENCE_LABEL, FUNNEL, type Issue, type Scenario } from "./fixtures";
import { DAY_DATE, type DayKey } from "./data/facts";
import {
  DAY_LABEL,
  PRIORITY_FILTERS,
  overridesFor,
  problemsFor,
  scenarioData,
  type PriorityFilter,
} from "./v2/fixtures";
import { useDecisions } from "./v2/useDecisions";
import ProblemSpark from "./v2/ProblemSpark.vue";
import IssueAskStrip from "./IssueAskStrip.vue";

const props = withDefaults(
  defineProps<{
    issues: Issue[];
    scenario: Scenario;
    initialFilter?: "open" | "resolved" | "all";
  }>(),
  { initialFilter: "open" },
);
const emit = defineEmits<{ "open-issue": [issue: Issue] }>();

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useDecisions();

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_ID = "autoobserve-issues-search";

const filter = ref(props.initialFilter);
const priority = ref<PriorityFilter>("all");
const urlQuery = () => (typeof route.query.q === "string" ? route.query.q : "");
const query = ref(urlQuery());
const term = computed(() => query.value.trim());
// Announced only once typing settles, so a screen reader isn't interrupted on every key.
const settled = ref(term.value);

const matches = (issue: Issue, needle: string) =>
  [issue.title, issue.id, issue.cause, ...issue.services].some((text) =>
    text.toLowerCase().includes(needle),
  );

const inFilter = (issue: Issue) => {
  if (filter.value === "open") return issue.status !== "resolved";
  if (filter.value === "resolved") return issue.status === "resolved";
  return true;
};

const startOf = (issue: Issue) => `${DAY_DATE[issue.day]} ${issue.time}`;

// Day sections follow row order, so rows must already run newest first.
const unprioritised = (text: string) => {
  const needle = text.toLowerCase();
  return props.issues
    .filter((i) => inFilter(i) && (!needle || matches(i, needle)))
    .sort((a, b) => startOf(b).localeCompare(startOf(a)));
};

const rowsFor = (text: string) =>
  unprioritised(text).filter((i) => priority.value === "all" || i.severity === priority.value);

let timer: ReturnType<typeof setTimeout> | undefined;

const writeUrl = () => {
  settled.value = term.value;
  const q = term.value || undefined;
  if (q !== (route.query.q ?? undefined)) void router.replace({ query: { ...route.query, q } });
};

watch(query, () => {
  clearTimeout(timer);
  timer = setTimeout(writeUrl, SEARCH_DEBOUNCE_MS);
});

// Browser Back and Forward change q without typing, so the box follows the URL.
watch(urlQuery, (next) => {
  if (next !== term.value) query.value = next;
});

onBeforeUnmount(() => clearTimeout(timer));

// The Clear search button leaves with the empty state, so focus returns to the field.
const clearSearch = () => {
  query.value = "";
  clearTimeout(timer);
  writeUrl();
  document.getElementById(SEARCH_ID)?.focus();
};

const rows = computed(() => rowsFor(term.value));

const counts = computed(() => {
  const base = unprioritised(term.value);
  return Object.fromEntries(
    PRIORITY_FILTERS.map((f) => [
      f,
      f === "all" ? base.length : base.filter((i) => i.severity === f).length,
    ]),
  ) as Record<PriorityFilter, number>;
});

const announcement = computed(() => {
  if (!settled.value) return "";
  const count = rowsFor(settled.value).length;
  return t("autoobserve.issues.matchCount", { count }, count);
});

// Sparklines and fix asks come from the shared decision store, so an approval anywhere shows here.
const problems = computed(() =>
  problemsFor(overridesFor(props.scenario, store.decisions, store.phases)),
);

const asks = computed(
  () =>
    new Map(
      scenarioData(props.scenario)
        .requests.filter((r) => r.kind === "fixNow" && r.problem)
        .map((r) => [r.problem as string, r]),
    ),
);

const askFor = (issue: Issue) => asks.value.get(issue.problemId);

const spanFor = (issue: Issue): I18nText => {
  const start = raw(issue.time);
  if (issue.endedAt) return t("autoobserve.issues.span", { start, end: raw(issue.endedAt) });
  return issue.status === "open" ? t("autoobserve.issues.spanOpen", { start }) : start;
};

const metaFor = (issue: Issue): I18nText[] => [
  spanFor(issue),
  ...(issue.minutes === undefined
    ? []
    : [t("autoobserve.issues.minutes", { count: issue.minutes })]),
  t("autoobserve.issues.grouped", { count: issue.alerts }, issue.alerts),
  t("autoobserve.issues.confidence", { level: t(CONFIDENCE_LABEL[issue.confidence]) }),
];

const columns: OTableColumnDef<Issue>[] = [
  { id: "id", header: t("autoobserve.issues.colId"), accessorKey: "id", size: 92 },
  {
    id: "title",
    header: t("autoobserve.issues.colTitle"),
    accessorKey: "title",
    size: 420,
    meta: { flex: true },
  },
  {
    id: "severity",
    header: t("autoobserve.issues.colSeverity"),
    accessorKey: "severity",
    size: 84,
  },
  {
    id: "signal",
    header: t("autoobserve.issues.colSignal"),
    accessorKey: "problemId",
    size: 180,
  },
  {
    id: "services",
    header: t("autoobserve.issues.colServices"),
    accessorKey: "services",
    size: 168,
  },
  {
    id: "started",
    header: t("autoobserve.issues.colStarted"),
    accessorKey: "started",
    size: 120,
  },
  { id: "status", header: t("autoobserve.issues.colStatus"), accessorKey: "status", size: 184 },
  { id: "cause", header: t("autoobserve.issues.colCause"), accessorKey: "cause", size: 260 },
];
</script>
