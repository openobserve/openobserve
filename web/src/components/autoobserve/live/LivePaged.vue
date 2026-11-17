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
  <SectionCard
    :count="settled && view.ranged.length ? view.ranged.length : undefined"
    :aria-busy="state.status === 'loading'"
    data-test="autoobserve2-paged"
  >
    <template #title>
      <h2 class="text-text-heading text-base font-semibold whitespace-nowrap">
        <ODropdown align="start">
          <template #trigger>
            <button
              type="button"
              class="hover:bg-surface-subtle-hover focus-visible:ring-focus-ring-accent rounded-default -ms-2 inline-flex items-center gap-1 px-2 py-0.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              data-test="autoobserve2-paged-range"
            >
              {{ t(RANGE_LABEL[range]) }}
              <OIcon name="expand-more" size="sm" class="text-text-secondary" />
            </button>
          </template>
          <ODropdownItem
            v-for="option in HOME_RANGES"
            :key="option"
            role="menuitemradio"
            :aria-checked="option === range"
            :data-test="`autoobserve2-paged-range-${option}`"
            @select="selectRange(option)"
          >
            <span class="flex-1">{{ t(RANGE_LABEL[option]) }}</span>
            <template #icon-right>
              <OIcon
                name="check"
                size="sm"
                :class="option === range ? 'text-text-heading' : 'invisible'"
              />
            </template>
          </ODropdownItem>
        </ODropdown>
      </h2>
    </template>
    <template v-if="settled && view.ranged.length" #actions>
      <OToggleGroup
        :model-value="priority"
        :aria-label="t('autoobserve2.recent.priorityLabel')"
        data-test="autoobserve2-paged-priority"
        @update:model-value="(v) => v && selectPriority(v as HomePriority)"
      >
        <OToggleGroupItem
          v-for="option in HOME_PRIORITIES"
          :key="option"
          :value="option"
          size="xs"
          :disabled="!view.counts[option]"
          :data-test="`autoobserve2-paged-priority-${option}`"
        >
          {{ option === "all" ? t("autoobserve2.recent.all") : option.toUpperCase() }}
          <span class="ms-1 tabular-nums">{{ view.counts[option] }}</span>
        </OToggleGroupItem>
      </OToggleGroup>
    </template>
    <span class="sr-only" role="status" data-test="autoobserve2-paged-announce">{{
      loadText
    }}</span>
    <div
      ref="slotEl"
      class="text-text-secondary mx-5 -mt-2 mb-3 h-[2lh] text-sm leading-relaxed sm:mx-6"
      data-test="autoobserve2-paged-subtitle-slot"
    >
      <LiveRefreshFailed
        v-if="slotKind === 'stale' && state.stale"
        surface="incidents"
        dense
        :lines="3"
        class="-mx-2"
        :stale="state.stale"
        :busy="state.busy"
        data-test="autoobserve2-paged-refresh-failed"
        @retry="state.retry()"
      />
      <p
        v-else-if="slotKind === 'new'"
        class="flex min-w-0 items-center gap-1.5"
        data-test="autoobserve2-paged-new"
      >
        <span class="text-text-body min-w-0 truncate">{{ newText }}</span>
        <span aria-hidden="true">·</span>
        <OButton
          variant="ghost-primary"
          size="xs"
          class="-my-1 shrink-0"
          data-test="autoobserve2-paged-show-new"
          @click="paged.showNew()"
        >
          {{ copy.showNew }}
        </OButton>
      </p>
      <OTruncatedText
        v-else-if="slotKind === 'learning'"
        as="p"
        :lines="2"
        class="leading-relaxed"
        data-test="autoobserve2-paged-learning"
        >{{ learningText }}</OTruncatedText
      >
      <OTruncatedText
        v-else-if="slotKind === 'pagingOff'"
        as="p"
        :lines="2"
        class="leading-relaxed"
        data-test="autoobserve2-paged-paging-note"
        >{{ pagingNote(t) }}</OTruncatedText
      >
      <div
        v-else-if="slotKind === 'skeleton'"
        class="flex flex-col gap-2 pt-1.5"
        aria-hidden="true"
        data-test="autoobserve2-paged-subtitle-skeleton"
      >
        <OSkeleton animation="none" class="h-3 w-full" />
        <OSkeleton animation="none" class="h-3 w-[70%]" />
      </div>
      <OTruncatedText
        v-else-if="slotKind === 'subtitle'"
        as="p"
        :lines="2"
        class="leading-relaxed"
        data-test="autoobserve2-paged-subtitle"
        >{{ copy.subtitle }}</OTruncatedText
      >
    </div>
    <div
      ref="bodyEl"
      tabindex="-1"
      class="min-h-35 outline-none"
      data-test="autoobserve2-paged-body"
    >
      <ul
        v-if="skeleton"
        class="border-border-subtle divide-border-subtle divide-y border-t"
        aria-hidden="true"
        data-test="autoobserve2-paged-skeleton"
      >
        <li v-for="n in skeletonRows(cap)" :key="n" class="flex gap-4 px-5 py-4 sm:px-6">
          <OSkeleton animation="none" class="w-1 rounded-full" />
          <div class="flex flex-1 flex-col gap-2">
            <OSkeleton animation="none" class="h-4 w-[70%]" />
            <div class="flex items-center gap-1.5">
              <OSkeleton animation="none" class="h-3 w-24" />
              <OSkeleton animation="none" class="h-4 w-8" />
              <OSkeleton animation="none" class="h-4 w-14" />
            </div>
            <OSkeleton animation="none" class="h-3 w-[85%]" />
          </div>
          <OSkeleton animation="none" class="hidden h-9 w-40 self-center sm:block" />
        </li>
      </ul>
      <div v-else-if="notice" class="px-3 pb-3 sm:px-4">
        <LiveNoticeState
          :notice="notice"
          size="inline"
          :detail="state.detail"
          :busy="state.busy"
          :data-test="NOTICE_TEST[notice.failure]"
          retry-test="autoobserve2-paged-retry"
          @retry="state.retry()"
        />
      </div>
      <OEmptyState
        v-else-if="settled && !rows.length && waiting"
        size="inline"
        variant="neutral"
        icon="hourglass-empty"
        :title="waiting.title"
        :description="waiting.desc"
        data-test="autoobserve2-paged-empty-learning"
      />
      <OEmptyState
        v-else-if="settled && !rows.length && !paging"
        size="inline"
        variant="neutral"
        icon="toggle-off"
        :title="copy.offTitle"
        :description="copy.offDesc"
        data-test="autoobserve2-paged-empty-off"
      />
      <OEmptyState
        v-else-if="settled && !view.ranged.length"
        size="inline"
        icon="task-alt"
        :title="allClear.title"
        :description="allClear.desc"
        data-test="autoobserve2-paged-empty"
      />
      <ul
        v-else-if="settled"
        class="border-border-subtle divide-border-subtle divide-y border-t"
        data-test="autoobserve2-paged-list"
      >
        <li v-for="(entry, index) in shownRows" :key="entry.row.id">
          <p
            v-if="entry.group !== undefined"
            class="bg-surface-subtle text-text-body px-5 py-1.5 text-xs font-medium sm:px-6"
            :data-test="`autoobserve2-paged-group-${entry.group}`"
          >
            {{ weekLabel(t, entry.group) }}
          </p>
          <LivePagedRow
            :row="entry.row"
            :index="index"
            :shared-analysis="!!shared?.covers(entry.row.analysis)"
            @open="openRow(entry.item)"
          >
            <template #actions>
              <OButton
                variant="ghost-primary"
                size="xs"
                data-test="autoobserve2-paged-open"
                @click="router.push(incidentLink(org, entry.item.incident.id))"
              >
                {{ copy.openIncident }}
              </OButton>
              <OButton
                v-if="entry.row.analysis.hasRun"
                variant="ghost-primary"
                size="xs"
                data-test="autoobserve2-paged-view-analysis"
                @click="router.push(analysisLink(org, entry.item.incident.id))"
              >
                {{ copy.viewAnalysis }}
              </OButton>
              <OButton
                v-if="entry.logs"
                variant="ghost-primary"
                size="xs"
                data-test="autoobserve2-paged-logs"
                @click="router.push(entry.logs)"
              >
                {{ insightCtaLabel(t, "openInLogs") }}
              </OButton>
              <OButton
                v-if="entry.row.copy.page?.routing"
                variant="outline"
                size="xs"
                data-test="autoobserve2-paged-routing"
                @click="router.push({ name: 'onCallRouting', query: { org_identifier: org } })"
              >
                {{ copy.routing }}
              </OButton>
              <OButton
                v-if="canAsk && entry.ai"
                variant="ghost-primary"
                size="xs"
                icon-left="auto-awesome"
                data-test="autoobserve2-paged-ask-ai"
                @click="ask(entry.ai)"
              >
                {{ insightCtaLabel(t, "askAi") }}
              </OButton>
            </template>
          </LivePagedRow>
        </li>
      </ul>
      <p
        v-if="settled && cantSee"
        class="text-text-secondary border-border-subtle flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-5 py-3 text-sm sm:px-6"
        data-test="autoobserve2-paged-cantsee"
      >
        <OIcon name="visibility-off" size="sm" class="shrink-0" />
        <span class="min-w-0">{{ cantSee }}</span>
        <OButton
          variant="ghost-primary"
          size="xs"
          icon-right="arrow-forward"
          data-test="autoobserve2-paged-cantsee-open"
          @click="emit('open-coverage', 'attention')"
        >
          {{ t("autoobserve.homeLive.cantSeeAction") }}
        </OButton>
      </p>
    </div>
    <template v-if="settled && rows.length" #footer>
      <div ref="footerEl" class="flex min-w-0 flex-wrap items-center gap-2">
        <OButton
          v-if="view.remaining"
          variant="ghost-primary"
          size="sm"
          icon-right="expand-more"
          data-test="autoobserve2-paged-show-more"
          @click="expand(view.visible.length + Math.min(view.remaining, HOME_STEP))"
        >
          {{ t("autoobserve2.showMore", { count: Math.min(view.remaining, HOME_STEP) }) }}
        </OButton>
        <OButton
          v-else-if="view.filtered.length > view.base"
          variant="ghost-primary"
          size="sm"
          icon-right="expand-less"
          data-test="autoobserve2-paged-show-fewer"
          @click="expand(0)"
        >
          {{ t("autoobserve2.showFewer") }}
        </OButton>
        <span
          v-if="hasMore"
          class="text-text-secondary shrink-0 text-xs"
          data-test="autoobserve2-paged-more"
          >{{ moreText(t, locale, fetchCap) }}</span
        >
        <OTruncatedText
          v-if="shared"
          as="span"
          :lines="1"
          class="text-text-secondary min-w-0 flex-1 text-xs"
          data-test="autoobserve2-paged-shared-analysis"
          >{{ shared.text }}</OTruncatedText
        >
        <OButton
          variant="ghost-primary"
          size="sm"
          icon-right="arrow-forward"
          class="ms-auto shrink-0"
          data-test="autoobserve2-paged-see-all"
          @click="router.push({ query: { ...route.query, org_identifier: org, page: 'issues' } })"
        >
          {{ t("autoobserve2.recent.allIssues") }}
        </OButton>
      </div>
    </template>
  </SectionCard>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { routingConfigQuery } from "@/services/oncall.queries";
import { autoobserveCoverageQuery } from "@/services/autoobserve.queries";
import type { AutoObserveIncidentItem } from "@/services/autoobserve";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import {
  ASK_AI_KEY,
  aiEnabled,
  askAiPayload,
  insightCtaLabel,
  type AiFinding,
} from "../insight/insightCta";
import { pagedFindingCopy } from "../insight/kindCopy";
import SectionCard from "../v2/SectionCard.vue";
import LiveNoticeState from "./LiveNoticeState.vue";
import LiveRefreshFailed from "./LiveRefreshFailed.vue";
import LivePagedRow, { type LivePagedRowView } from "./LivePagedRow.vue";
import {
  analysisLine,
  analysisLink,
  findingAi,
  findingLogs,
  findingSentence,
  incidentLink,
  moreText,
  newFindingsText,
  openedText,
  PAGED_CAP,
  pagedCopy,
  pagingNote,
  sharedAnalysis,
  skeletonRows,
  statusLabel,
} from "./incidentsCopy";
import { formatWhen, liveLoadText, liveNotice, type LiveFailure } from "./liveCopy";
import { toCoverageSource } from "./liveAdapter";
import { useLivePaged, useLoadPhase } from "./liveModel";
import { learningSummary, learningWaiting, type LearningStream } from "./LiveCoverageLearning";
import {
  HOME_FETCH,
  HOME_PRIORITIES,
  HOME_RANGES,
  HOME_STEP,
  RANGE_LABEL,
  allClearText,
  cantSeeText,
  homeView,
  isHomePriority,
  isHomeRange,
  outcomeOf,
  weekLabel,
  type HomePriority,
  type HomeRange,
} from "./LivePagedModel";
import { issueStreams } from "./issueModel";

const NOTICE_TEST: Record<LiveFailure, string> = {
  denied: "autoobserve2-paged-denied",
  off: "autoobserve2-paged-off",
  unavailable: "autoobserve2-paged-unavailable",
  failed: "autoobserve2-paged-error",
};

const props = withDefaults(defineProps<{ cap?: number }>(), { cap: PAGED_CAP });
const emit = defineEmits<{
  settled: [];
  "open-incident": [item: AutoObserveIncidentItem];
  "open-coverage": [filter: string];
}>();

const { t, locale } = useI18nTyped();
const router = useRouter();
const route = useRoute();
const store = useStore();
// The range picker filters what was read, so the home reads enough rows for a month.
const fetchCap = Math.max(props.cap, HOME_FETCH);
const paged = useLivePaged(fetchCap);
const askAi = inject(ASK_AI_KEY, null);

const slotEl = ref<HTMLElement | null>(null);
const bodyEl = ref<HTMLElement | null>(null);
const footerEl = ref<HTMLElement | null>(null);

const copy = computed(() => pagedCopy(t));

const state = computed(() => paged.state.value);
const skeleton = computed(() => paged.skeleton.value);
const org = computed(() => paged.org.value);
const rows = computed(() => paged.rows.value);
const now = computed(() => paged.now.value);
// Read only while a card would offer routing setup; a failed read keeps the offer.
const anyUnrouted = computed(() => rows.value.some((item) => item.page?.outcome === "unrouted"));
const routing = useQuery(() => ({ ...routingConfigQuery(org.value), enabled: anyUnrouted.value }));
const routingSet = computed(() => !!routing.data.value?.default_team_id);
// The same cached read the learning line uses, so naming the gaps costs no request.
const coverage = useQuery(() => ({
  ...autoobserveCoverageQuery(org.value, "strict"),
  enabled: !!org.value,
}));
const paging = computed(() => paged.paging.value);
const hasMore = computed(() => paged.hasMore.value);
const settled = computed(() => !skeleton.value && state.value.status === "ready");
// The page footer below waits for this, so it is never painted and then pushed down by the rows.
watch(
  () => !skeleton.value && state.value.status !== "loading",
  (done) => done && emit("settled"),
  { immediate: true },
);
const notice = computed(() =>
  !skeleton.value && state.value.status === "error" && state.value.failure
    ? liveNotice(t, "incidents", state.value.failure)
    : null,
);

const queryText = (key: string) =>
  typeof route.query[key] === "string" ? (route.query[key] as string) : "";
const range = ref<HomeRange>(
  isHomeRange(queryText("range")) ? (queryText("range") as HomeRange) : "7d",
);
const priorityParam = queryText("priority").toLowerCase();
const priority = ref<HomePriority>(isHomePriority(priorityParam) ? priorityParam : "all");
const shownParam = Number(route.query.shown);
const shown = ref(Number.isInteger(shownParam) && shownParam > 0 ? shownParam : 0);

const view = computed(() =>
  homeView(rows.value, range.value, priority.value, shown.value, now.value),
);

const streams = computed<LearningStream[]>(
  () => coverage.data.value?.rows.flatMap((row) => row.streams as LearningStream[]) ?? [],
);
const learningText = computed(() =>
  learningSummary(t, paged.zone.value, paged.learning.value, streams.value, now.value),
);
const waiting = computed(() =>
  learningWaiting(t, paged.zone.value, paged.learning.value, streams.value, now.value),
);
const newText = computed(() => newFindingsText(t, locale.value, paged.newCount.value));

const coverageSource = computed(() =>
  toCoverageSource(
    t,
    coverage.data.value,
    { status: "ready", retry: () => undefined },
    locale.value,
    now.value,
  ),
);
const cantSee = computed(() =>
  cantSeeText(
    t,
    locale.value,
    coverageSource.value.rows.filter((r) => r.status?.state === "gap").map((r) => r.service),
  ),
);
const allClear = computed(() =>
  allClearText(
    t,
    locale.value,
    range.value,
    coverageSource.value.totals.fullyWatched + coverageSource.value.totals.partial,
  ),
);

// One message at a time, so the slot never grows a second line of notices.
const slotKind = computed(() => {
  if (settled.value && state.value.stale) return "stale";
  if (settled.value && paged.newCount.value > 0) return "new";
  if (settled.value && learningText.value && !(waiting.value && !rows.value.length))
    return "learning";
  // With no rows the off empty state says it, unless the learning empty state holds that place.
  if (settled.value && !paging.value && (rows.value.length || waiting.value)) return "pagingOff";
  if (state.value.status === "loading") return skeleton.value ? "skeleton" : "none";
  return "subtitle";
});

const rowView = (item: AutoObserveIncidentItem): LivePagedRowView => {
  const pageCopy = pagedFindingCopy(t, paged.zone.value, item, now.value, routingSet.value);
  return {
    id: item.finding.id,
    title: pageCopy.headline ?? findingSentence(t, item),
    opened: openedText(t, locale.value, item, now.value),
    openedAt: formatWhen(
      item.incident.created_at / 1000,
      paged.zone.value.locale,
      paged.zone.value.timeZone,
      now.value,
    ),
    stream: item.finding.stream_name,
    severity: item.incident.severity,
    status: item.incident.status,
    statusText: statusLabel(t, item.incident.status),
    outcome: outcomeOf(item.incident.status),
    analysis: analysisLine(t, item, paged.rcaEnabled.value),
    copy: pageCopy,
    signal: issueStreams(item).find((s) => s.lead) ?? null,
  };
};

const shownRows = computed(() =>
  view.value.visible.map(({ item, group }) => ({
    item,
    group,
    row: rowView(item),
    logs: findingLogs(item, now.value),
    ai: findingAi(t, item, paged.zone.value, now.value),
  })),
);

const canAsk = computed(() => !!askAi && aiEnabled(store.state.zoConfig));
const ask = (finding: AiFinding) => askAi?.(askAiPayload(t, finding, org.value));

const openRow = (item: AutoObserveIncidentItem) => emit("open-incident", item);

// The footer sits outside the subtitle slot, so a stale or new-findings notice never hides the reason the rows dropped.
const shared = computed(() =>
  settled.value
    ? sharedAnalysis(
        t,
        shownRows.value.map((entry) => entry.row.analysis),
      )
    : null,
);

const loadPhase = useLoadPhase(() => state.value.status, skeleton);
const loadText = computed(() => liveLoadText(t, "incidents", loadPhase.value));

// The choice lives in the URL, so reload and browser Back keep the range and filter.
watch([range, priority, shown], ([r, p, s]) => {
  const next = {
    range: r === "7d" ? undefined : r,
    priority: p === "all" ? undefined : p.toUpperCase(),
    shown: s ? String(s) : undefined,
  };
  const same = (Object.keys(next) as (keyof typeof next)[]).every(
    (k) => next[k] === route.query[k],
  );
  if (!same) void router.replace({ query: { ...route.query, ...next } });
});

const selectPriority = (value: HomePriority) => {
  priority.value = value;
  shown.value = 0;
};

const selectRange = (value: HomeRange) => {
  range.value = value;
  shown.value = 0;
  const left = homeView(rows.value, value, priority.value, 0, now.value);
  if (!left.filtered.length) priority.value = "all";
};

// Show more and Show fewer replace each other, so focus follows to whichever is left.
const expand = async (count: number) => {
  shown.value = count;
  await nextTick();
  footerEl.value
    ?.querySelector<HTMLElement>(
      '[data-test="autoobserve2-paged-show-more"], [data-test="autoobserve2-paged-show-fewer"]',
    )
    ?.focus();
};

const viewKey = computed(
  () => `${slotKind.value}|${notice.value?.failure ?? ""}|${rows.value.map((r) => r.finding.id)}`,
);

// A swap that removes the focused Show or Retry moves focus to the card body, never to the page.
watch(
  viewKey,
  () => {
    const active = document.activeElement;
    const inside = !!active && (slotEl.value?.contains(active) || bodyEl.value?.contains(active));
    if (!inside) return;
    void nextTick(() => {
      const current = document.activeElement;
      if (!current || current === document.body) bodyEl.value?.focus();
    });
  },
  { flush: "pre" },
);
</script>
