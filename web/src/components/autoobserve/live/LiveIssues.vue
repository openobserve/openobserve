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
    ref="tableEl"
    :data="shown"
    :columns="columns"
    :frame="false"
    row-key="id"
    :pagination="notice ? 'none' : 'client'"
    keep-page-on-data-change
    :page-size="PAGE_SIZE"
    :show-global-filter="false"
    :loading="loading"
    :row-section="(row: IssueRow) => row.day"
    :row-rail-tone="(row: IssueRow) => row.tone"
    :aria-busy="!settled"
    class="min-h-0 w-full flex-1"
    data-test="autoobserve-live-issues"
    @row-click="(row: IssueRow) => openIncident(row)"
  >
    <template #toolbar>
      <div
        class="flex min-w-0 flex-1 flex-wrap items-center gap-2"
        :class="{ invisible: !!notice }"
        :inert="notice ? true : undefined"
        :aria-hidden="notice ? 'true' : undefined"
        data-test="autoobserve-live-issues-controls"
      >
        <div class="flex min-w-[12rem] flex-1 items-center sm:max-w-[22rem]">
          <label :for="SEARCH_ID" class="sr-only">{{ copy.searchLabel }}</label>
          <OInput
            :id="SEARCH_ID"
            v-model="query"
            size="sm"
            clearable
            class="w-full"
            :placeholder="copy.searchPlaceholder"
            data-test="autoobserve-live-issues-search"
            @keydown.esc="clearSearch"
          >
            <template #icon-left>
              <OIcon name="search" size="sm" class="text-text-secondary" />
            </template>
          </OInput>
          <span class="sr-only" role="status" data-test="autoobserve-live-issues-search-status">{{
            announcement
          }}</span>
        </div>
        <OToggleGroup
          :model-value="priority"
          :aria-label="copy.priorityLabel"
          data-test="autoobserve-live-issues-priority"
          @update:model-value="(v) => v && (priority = v as PriorityFilter)"
        >
          <OToggleGroupItem
            v-for="option in PRIORITY_FILTERS"
            :key="option"
            :value="option"
            size="xs"
            :disabled="!settled || (!counts[option] && option !== priority)"
            :data-test="`autoobserve-live-issues-priority-${option}`"
          >
            {{ option === "all" ? copy.allPriorities : option.toUpperCase() }}
            <span v-if="settled" class="ms-1 tabular-nums">{{ counts[option] }}</span>
          </OToggleGroupItem>
        </OToggleGroup>
        <OToggleGroup
          mobile-dropdown
          :model-value="filter"
          class="ms-auto"
          data-test="autoobserve-live-issues-filter"
          @update:model-value="(v) => (filter = v as StatusFilter)"
        >
          <OToggleGroupItem
            value="open"
            size="sm"
            data-test="autoobserve-live-issues-filter-open"
            >{{ copy.open }}</OToggleGroupItem
          >
          <OToggleGroupItem
            value="resolved"
            size="sm"
            data-test="autoobserve-live-issues-filter-resolved"
            >{{ copy.resolved }}</OToggleGroupItem
          >
          <OToggleGroupItem value="all" size="sm" data-test="autoobserve-live-issues-filter-all">{{
            copy.allStatuses
          }}</OToggleGroupItem>
        </OToggleGroup>
      </div>
    </template>
    <template #subheader>
      <!-- A notice keeps this row's space, so loading turning into a failure moves nothing. -->
      <div
        class="px-page-edge border-table-row-divider flex h-9 items-center gap-2 border-b"
        :class="{ invisible: !!notice }"
        :inert="notice ? true : undefined"
        :aria-hidden="notice ? 'true' : undefined"
        data-test="autoobserve-live-issues-summary"
      >
        <LiveRefreshFailed
          v-if="settled && state.stale"
          surface="issues"
          dense
          :lines="1"
          class="min-w-0"
          :class="shared ? 'max-w-[60%]' : 'flex-1'"
          :stale="state.stale"
          :busy="state.busy"
          data-test="autoobserve-live-issues-refresh-failed"
          @retry="state.retry()"
        />
        <OSkeleton
          v-else-if="loading"
          animation="none"
          class="h-3 w-40"
          data-test="autoobserve-live-issues-count-skeleton"
        />
        <template v-else-if="shown.length">
          <OIcon name="notifications-active" size="sm" class="text-text-secondary shrink-0" />
          <span class="text-text-secondary text-xs" data-test="autoobserve-live-issues-count">{{
            countText
          }}</span>
        </template>
        <template v-if="shared">
          <span class="text-text-secondary text-xs" aria-hidden="true">·</span>
          <OTruncatedText
            as="span"
            :lines="1"
            class="text-text-secondary min-w-0 flex-1 text-xs"
            data-test="autoobserve-live-issues-shared-analysis"
            >{{ shared.text }}</OTruncatedText
          >
        </template>
      </div>
    </template>
    <template #group-header="{ sectionKey, rows: sectionRows }">
      <p
        class="text-text-body flex items-center gap-1.5 px-2 py-1 text-xs font-medium"
        :data-test="`autoobserve-live-issues-day-${sectionKey}`"
      >
        {{ dayLabels.get(sectionKey) }}
        <span class="text-text-secondary tabular-nums">· {{ sectionRows.length }}</span>
      </p>
    </template>
    <template #cell-incident="{ row }">
      <!-- The padding sits outside the clamp, which would otherwise show the top of line three in it. -->
      <div class="py-1.5">
        <OTruncatedText
          as="p"
          :lines="2"
          class="text-text-heading leading-snug font-medium wrap-anywhere whitespace-normal"
          data-test="autoobserve-live-issues-sentence"
          >{{ row.sentence }}</OTruncatedText
        >
      </div>
    </template>
    <template #cell-severity="{ row }">
      <OTag type="severity" :value="row.severity" size="sm" />
    </template>
    <template #cell-status="{ row }">
      <OTag type="incidentStatus" :value="row.status" :label="row.statusText" size="sm" />
    </template>
    <template #cell-stream="{ row }">
      <OTag
        v-if="row.stream"
        variant="default-soft"
        shape="rounded"
        size="sm"
        class="max-w-full"
        :title="row.streamTitle"
        data-test="autoobserve-live-issues-stream"
      >
        <OTruncatedText as="span" data-test="autoobserve-live-issues-stream-text">{{
          row.stream
        }}</OTruncatedText>
      </OTag>
    </template>
    <template #cell-page="{ row }">
      <OTag
        v-if="row.page"
        :variant="PAGE_VARIANT[row.page.tone]"
        size="sm"
        class="max-w-full"
        :data-tone="row.page.tone"
        data-test="autoobserve-live-issues-page"
      >
        <OTruncatedText as="span" data-test="autoobserve-live-issues-page-text">{{
          row.page.text
        }}</OTruncatedText>
      </OTag>
      <span v-else class="text-text-secondary">—</span>
    </template>
    <template #cell-opened="{ row }">
      <span class="text-text-secondary text-xs whitespace-nowrap" :title="row.openedAt">{{
        row.opened
      }}</span>
    </template>
    <template #cell-analysis="{ row }">
      <div class="flex min-w-0 flex-col items-start gap-0.5 py-1.5 whitespace-normal">
        <button
          v-if="row.analysis.hasRun"
          type="button"
          class="focus-visible:ring-focus-ring-accent rounded-full focus-visible:ring-2 focus-visible:outline-none"
          data-test="autoobserve-live-issues-analysis-link"
          @click="openAnalysis(row)"
        >
          <OBadge
            :variant="RCA_BADGE_VARIANT[row.analysis.tone]"
            size="sm"
            :data-tone="row.analysis.tone"
            data-test="autoobserve-live-issues-analysis"
          >
            <template v-if="row.analysis.spinner" #icon>
              <OSpinner size="xs" />
            </template>
            {{ row.analysis.label }}
          </OBadge>
        </button>
        <OBadge
          v-else
          :variant="RCA_BADGE_VARIANT[row.analysis.tone]"
          size="sm"
          :data-tone="row.analysis.tone"
          data-test="autoobserve-live-issues-analysis"
        >
          {{ row.analysis.label }}
        </OBadge>
        <OTruncatedText
          v-if="row.analysis.detail && !shared?.covers(row.analysis)"
          as="p"
          :lines="2"
          class="text-text-secondary text-xs leading-snug"
          data-test="autoobserve-live-issues-analysis-detail"
          >{{ row.analysis.detail }}</OTruncatedText
        >
      </div>
    </template>
    <template v-if="settled && issues.capped.value" #footer-note>
      <span class="text-text-secondary text-xs" data-test="autoobserve-live-issues-cap-note">{{
        capNote(t, locale)
      }}</span>
    </template>
    <template #empty>
      <LiveNoticeState
        v-if="notice"
        :notice="notice"
        size="block"
        :detail="state.detail"
        :busy="state.busy"
        :data-test="NOTICE_TEST[notice.failure]"
        retry-test="autoobserve-live-issues-retry"
        @retry="state.retry()"
      />
      <div v-else-if="!settled" aria-hidden="true" data-test="autoobserve-live-issues-pending" />
      <OEmptyState
        v-else-if="term"
        size="block"
        illustration="no-results"
        :title="issuesNoMatch(t, term)"
        :action-label="copy.clearSearch"
        data-test="autoobserve-live-issues-no-match"
        @action="clearSearch"
      />
      <LiveNoticeState
        v-else-if="!rows.length && !issues.paging.value"
        :notice="pagingOffNotice"
        size="block"
        data-test="autoobserve-live-issues-empty-off"
      />
      <OEmptyState
        v-else-if="!rows.length"
        size="block"
        illustration="check"
        :title="issuesEmptyTitle(t, range)"
        :description="copy.emptyDesc"
        data-test="autoobserve-live-issues-empty"
      />
      <OEmptyState
        v-else
        size="block"
        illustration="check"
        :title="copy.filterEmptyTitle"
        :description="copy.filterEmptyDesc"
        data-test="autoobserve-live-issues-filter-empty"
      />
    </template>
  </OTable>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { OTableColumnDef, OTableExposed } from "@/lib/core/Table/OTable.types";
import type { RowRailTone } from "@/lib/core/Table/OTable.types";
import type { Incident } from "@/services/incidents";
import { RCA_BADGE_VARIANT } from "@/utils/incidents/rcaCell";
import { PRIORITY_FILTERS, type IssuesRange, type PriorityFilter } from "../v2/fixtures";
import LiveNoticeState from "./LiveNoticeState.vue";
import LiveRefreshFailed from "./LiveRefreshFailed.vue";
import {
  analysisLine,
  analysisLink,
  capNote,
  findingSentence,
  incidentLink,
  issuesCopy,
  issuesCountText,
  issuesDayKey,
  issuesDayLabel,
  issuesEmptyTitle,
  issuesMatchText,
  issuesNoMatch,
  issuesOpenedText,
  issuesPageCell,
  issuesStreamLabel,
  issuesStreamNames,
  issuesStreamType,
  sharedAnalysis,
  type PageCell,
  statusLabel,
  type AnalysisLine,
} from "./incidentsCopy";
import { formatWhen, liveNotice, type LiveFailure, type LiveNoticeView } from "./liveCopy";
import { useLiveZone } from "./liveModel";
import { useLiveIssues } from "./useLiveIssues";

type StatusFilter = "open" | "resolved" | "all";

interface IssueRow {
  id: string;
  sentence: I18nText;
  severity: Incident["severity"];
  tone: RowRailTone;
  status: Incident["status"];
  statusText: I18nText;
  stream: I18nText | null;
  streamTitle: string | undefined;
  page: PageCell | null;
  opened: I18nText;
  openedAt: string;
  analysis: AnalysisLine;
  day: string;
  haystack: string;
}

const PAGE_VARIANT: Record<PageCell["tone"], "default-soft" | "amber-soft" | "error-soft"> = {
  neutral: "default-soft",
  warning: "amber-soft",
  error: "error-soft",
};

const NOTICE_TEST: Record<LiveFailure, string> = {
  denied: "autoobserve-live-issues-denied",
  off: "autoobserve-live-issues-off",
  unavailable: "autoobserve-live-issues-unavailable",
  failed: "autoobserve-live-issues-error",
};

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_ID = "autoobserve-live-issues-search";

const props = withDefaults(defineProps<{ range: IssuesRange; initialFilter?: StatusFilter }>(), {
  initialFilter: "open",
});

const { t, locale } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const zone = useLiveZone();
const issues = useLiveIssues(toRef(props, "range"));

const copy = computed(() => issuesCopy(t));
const pagingOffNotice = computed<LiveNoticeView>(() => ({
  title: copy.value.offTitle,
  description: copy.value.offDesc,
  severity: "neutral",
  retry: false,
  details: false,
  icon: "toggle-off",
}));
const state = computed(() => issues.state.value);
const skeleton = computed(() => issues.skeleton.value);
const rows = computed(() => issues.rows.value);
const loading = computed(() => skeleton.value || issues.placeholder.value);
const settled = computed(
  () => !skeleton.value && state.value.status === "ready" && !issues.placeholder.value,
);
const notice = computed(() =>
  !skeleton.value && state.value.status === "error" && state.value.failure
    ? liveNotice(t, "issues", state.value.failure)
    : null,
);

const STATUS_FILTERS: StatusFilter[] = ["open", "resolved", "all"];
const statusParam = route.query.status as StatusFilter;
const filter = ref<StatusFilter>(
  STATUS_FILTERS.includes(statusParam) ? statusParam : props.initialFilter,
);
// The status filter lives in the URL like the search, so reload and Back keep it.
watch(filter, (next) => {
  const status = next === props.initialFilter ? undefined : next;
  if (status !== (route.query.status ?? undefined))
    void router.replace({ query: { ...route.query, status } });
});
const priority = ref<PriorityFilter>("all");
const urlQuery = () => (typeof route.query.q === "string" ? route.query.q : "");
const query = ref(urlQuery());
const term = computed(() => query.value.trim());
// Announced only once typing settles, so a screen reader isn't interrupted on every key.
const announced = ref(term.value);

let timer: ReturnType<typeof setTimeout> | undefined;

const writeUrl = () => {
  announced.value = term.value;
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

const all = computed<IssueRow[]>(() =>
  rows.value.map((item) => {
    const sentence = findingSentence(t, item);
    const created = item.incident.created_at / 1000;
    return {
      id: item.incident.id,
      sentence,
      severity: item.incident.severity,
      tone: String(item.incident.severity).toLowerCase() as RowRailTone,
      status: item.incident.status,
      statusText: statusLabel(t, item.incident.status),
      stream: issuesStreamLabel(t, item),
      streamTitle:
        (item.members?.length ?? 0) > 1
          ? issuesStreamNames(item).slice(1).join(", ")
          : issuesStreamType(t, item.finding.stream_type),
      page: issuesPageCell(t, item),
      opened: issuesOpenedText(t, locale.value, created, issues.now.value),
      openedAt: formatWhen(created, locale.value, zone.value.timeZone, issues.now.value),
      analysis: analysisLine(t, item, issues.rcaEnabled.value),
      day: issuesDayKey(item.finding.first_seen_at, zone.value.timeZone),
      haystack: [sentence, ...issuesStreamNames(item)].join("\n").toLowerCase(),
    };
  }),
);

const inFilter = (row: IssueRow) => {
  if (filter.value === "open") return row.status !== "resolved";
  if (filter.value === "resolved") return row.status === "resolved";
  return true;
};

const unprioritised = (text: string) => {
  const needle = text.toLowerCase();
  return all.value.filter((row) => inFilter(row) && (!needle || row.haystack.includes(needle)));
};

const rowsFor = (text: string) =>
  unprioritised(text).filter((row) => priority.value === "all" || row.tone === priority.value);

const shown = computed(() => rowsFor(term.value));

const counts = computed(() => {
  const base = unprioritised(term.value);
  return Object.fromEntries(
    PRIORITY_FILTERS.map((f) => [
      f,
      f === "all" ? base.length : base.filter((row) => row.tone === f).length,
    ]),
  ) as Record<PriorityFilter, number>;
});

const countText = computed(() => issuesCountText(t, locale.value, shown.value.length));

// Rows drop their reason only while this line shows it, so no summary state (stale, count) may hide it.
const shared = computed(() =>
  loading.value
    ? null
    : sharedAnalysis(
        t,
        shown.value.map((row) => row.analysis),
      ),
);

const tableEl = ref<OTableExposed<IssueRow> | null>(null);

// A new search, filter, range or org is a new list, so it starts on page one.
watch([term, priority, filter, () => props.range, () => issues.org.value], () =>
  tableEl.value?.table.setPageIndex(0),
);

// A clock tick or a refetch keeps the reader's page; one that shrinks the list past it lands on the last page.
watch(
  () => shown.value.length,
  () => {
    const table = tableEl.value?.table;
    if (!table) return;
    const last = Math.max(0, table.getPageCount() - 1);
    if (table.getState().pagination.pageIndex > last) table.setPageIndex(last);
  },
  { flush: "post" },
);

const announcement = computed(() =>
  announced.value ? issuesMatchText(t, rowsFor(announced.value).length) : "",
);

const dayLabels = computed(
  () =>
    new Map(
      rows.value.map((item) => [
        issuesDayKey(item.finding.first_seen_at, zone.value.timeZone),
        issuesDayLabel(
          t,
          locale.value,
          zone.value.timeZone,
          item.finding.first_seen_at,
          issues.now.value,
        ),
      ]),
    ),
);

const openIncident = (row: IssueRow) => void router.push(incidentLink(issues.org.value, row.id));

const openAnalysis = (row: IssueRow) => void router.push(analysisLink(issues.org.value, row.id));

const columns = computed<OTableColumnDef<IssueRow>[]>(() => [
  {
    id: "incident",
    header: copy.value.colIncident,
    accessorKey: "sentence",
    size: 420,
    meta: { flex: true },
  },
  { id: "severity", header: copy.value.colSeverity, accessorKey: "severity", size: 92 },
  { id: "status", header: copy.value.colStatus, accessorKey: "status", size: 140 },
  { id: "stream", header: copy.value.colStream, accessorKey: "stream", size: 168 },
  { id: "page", header: copy.value.colPage, accessorKey: "page", size: 168 },
  { id: "opened", header: copy.value.colOpened, accessorKey: "opened", size: 140 },
  { id: "analysis", header: copy.value.colAnalysis, accessorKey: "analysis", size: 240 },
]);
</script>
