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
    :title="copy.title"
    :aria-busy="state.status === 'loading'"
    data-test="autoobserve2-paged"
  >
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
      class="min-h-35 px-3 pb-3 outline-none sm:px-4"
      data-test="autoobserve2-paged-body"
    >
      <ul
        v-if="skeleton"
        class="flex flex-col gap-2.5"
        aria-hidden="true"
        data-test="autoobserve2-paged-skeleton"
      >
        <li
          v-for="n in skeletonRows(cap)"
          :key="n"
          class="border-border-subtle rounded-default flex flex-col gap-1.5 border px-3 py-2.5"
        >
          <div class="flex h-5 items-center">
            <OSkeleton animation="none" class="h-3 w-[85%]" />
          </div>
          <div class="flex h-5 items-center gap-1.5">
            <OSkeleton animation="none" class="h-4 w-8" />
            <OSkeleton animation="none" class="h-4 w-14" />
            <OSkeleton animation="none" class="h-3 w-24" />
          </div>
          <div class="flex h-5 items-center gap-1.5">
            <OSkeleton animation="none" class="h-4 w-20" />
            <OSkeleton animation="none" class="h-3 w-28" />
          </div>
          <div class="flex h-7 items-center"><OSkeleton animation="none" class="h-4 w-24" /></div>
        </li>
      </ul>
      <LiveNoticeState
        v-else-if="notice"
        :notice="notice"
        size="inline"
        :detail="state.detail"
        :busy="state.busy"
        :data-test="NOTICE_TEST[notice.failure]"
        retry-test="autoobserve2-paged-retry"
        @retry="state.retry()"
      />
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
        v-else-if="settled && !rows.length"
        size="inline"
        icon="task-alt"
        :title="copy.emptyTitle"
        :description="copy.emptyDesc"
        data-test="autoobserve2-paged-empty"
      />
      <ul v-else-if="settled" class="flex flex-col gap-2.5" data-test="autoobserve2-paged-list">
        <li v-for="(row, index) in shown" :key="row.id">
          <article
            class="border-border-subtle bg-surface-base rounded-default flex flex-col gap-1.5 border py-3.5 ps-4 pe-3.5"
            :data-test="`autoobserve2-paged-row-${index}`"
          >
            <OTruncatedText
              as="p"
              class="text-text-heading text-sm leading-5 font-medium"
              data-test="autoobserve2-paged-sentence"
              >{{ row.copy.headline ?? row.sentence }}</OTruncatedText
            >
            <div class="flex h-5 min-w-0 items-center gap-1.5">
              <OTag
                type="severity"
                :value="row.severity"
                size="sm"
                class="shrink-0"
                data-test="autoobserve2-paged-severity"
              />
              <OTag
                type="incidentStatus"
                :value="row.status"
                :label="row.statusText"
                size="sm"
                class="shrink-0"
                data-test="autoobserve2-paged-status"
              />
              <OTruncatedText
                class="text-text-secondary text-xs"
                data-test="autoobserve2-paged-opened"
                >{{ row.opened }}</OTruncatedText
              >
            </div>
            <div class="flex h-5 min-w-0 items-center gap-1.5">
              <OBadge
                :variant="RCA_BADGE_VARIANT[row.analysis.tone]"
                size="sm"
                class="shrink-0"
                :data-tone="row.analysis.tone"
                data-test="autoobserve2-paged-analysis"
              >
                <template v-if="row.analysis.spinner" #icon>
                  <OSpinner size="xs" />
                </template>
                {{ row.analysis.label }}
              </OBadge>
              <OTruncatedText
                v-if="row.analysis.detail && !shared?.covers(row.analysis)"
                class="text-text-secondary text-xs"
                data-test="autoobserve2-paged-analysis-detail"
                >{{ row.analysis.detail }}</OTruncatedText
              >
            </div>
            <p
              v-if="row.copy.page"
              class="flex items-start gap-1.5 text-xs leading-5"
              :class="PAGE_TONE[row.copy.page.tone].text"
              :data-tone="row.copy.page.tone"
              data-test="autoobserve2-paged-page"
            >
              <OIcon :name="PAGE_TONE[row.copy.page.tone].icon" size="xs" class="mt-1 shrink-0" />
              <span>{{ row.copy.page.text }}</span>
            </p>
            <p
              v-if="row.copy.why"
              class="text-text-body text-xs leading-5"
              data-test="autoobserve2-paged-why"
            >
              {{ row.copy.why }}
            </p>
            <p
              v-if="row.copy.next"
              class="text-text-secondary text-xs leading-5"
              data-test="autoobserve2-paged-next"
            >
              {{ row.copy.next }}
            </p>
            <div
              class="-ms-2.5 flex flex-wrap items-center gap-1"
              data-test="autoobserve2-paged-actions"
            >
              <OButton
                variant="ghost-primary"
                size="xs"
                data-test="autoobserve2-paged-open"
                @click="router.push(incidentLink(org, row.incidentId))"
              >
                {{ copy.openIncident }}
              </OButton>
              <OButton
                v-if="row.analysis.hasRun"
                variant="ghost-primary"
                size="xs"
                data-test="autoobserve2-paged-view-analysis"
                @click="router.push(analysisLink(org, row.incidentId))"
              >
                {{ copy.viewAnalysis }}
              </OButton>
              <OButton
                v-if="row.logs"
                variant="ghost-primary"
                size="xs"
                data-test="autoobserve2-paged-logs"
                @click="router.push(row.logs)"
              >
                {{ insightCtaLabel(t, "openInLogs") }}
              </OButton>
              <OButton
                v-if="row.copy.page?.routing"
                variant="outline"
                size="xs"
                data-test="autoobserve2-paged-routing"
                @click="router.push({ name: 'onCallRouting', query: { org_identifier: org } })"
              >
                {{ copy.routing }}
              </OButton>
              <OButton
                v-if="canAsk && row.ai"
                variant="ghost-primary"
                size="xs"
                icon-left="auto-awesome"
                data-test="autoobserve2-paged-ask-ai"
                @click="ask(row.ai)"
              >
                {{ insightCtaLabel(t, "askAi") }}
              </OButton>
            </div>
          </article>
        </li>
      </ul>
    </div>
    <template v-if="settled && rows.length && (hasMore || shared)" #footer>
      <div class="flex min-w-0 items-center gap-2">
        <span
          v-if="hasMore"
          class="text-text-secondary shrink-0 text-xs"
          data-test="autoobserve2-paged-more"
          >{{ moreText(t, locale, cap) }}</span
        >
        <span v-if="hasMore && shared" class="text-text-secondary text-xs" aria-hidden="true"
          >·</span
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
          v-if="hasMore"
          variant="ghost-primary"
          size="xs"
          icon-right="arrow-forward"
          class="ms-auto shrink-0"
          data-test="autoobserve2-paged-see-all"
          @click="router.push({ query: { ...route.query, org_identifier: org, page: 'issues' } })"
        >
          {{ copy.seeAllIssues }}
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
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { RCA_BADGE_VARIANT } from "@/utils/incidents/rcaCell";
import {
  ASK_AI_KEY,
  aiEnabled,
  askAiPayload,
  insightCtaLabel,
  type AiFinding,
} from "../insight/insightCta";
import { pagedFindingCopy, type PageLine } from "../insight/kindCopy";
import SectionCard from "../v2/SectionCard.vue";
import LiveNoticeState from "./LiveNoticeState.vue";
import LiveRefreshFailed from "./LiveRefreshFailed.vue";
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
import {
  learningEmpty,
  learningLine,
  liveLoadText,
  liveNotice,
  type LiveFailure,
} from "./liveCopy";
import { useLivePaged, useLoadPhase } from "./liveModel";

const NOTICE_TEST: Record<LiveFailure, string> = {
  denied: "autoobserve2-paged-denied",
  off: "autoobserve2-paged-off",
  unavailable: "autoobserve2-paged-unavailable",
  failed: "autoobserve2-paged-error",
};

const PAGE_TONE: Record<PageLine["tone"], { icon: string; text: string }> = {
  neutral: { icon: "check", text: "text-text-secondary" },
  pending: { icon: "schedule", text: "text-text-secondary" },
  warning: { icon: "warning", text: "text-badge-amber-soft-text" },
  error: { icon: "warning", text: "text-status-error-text" },
};

const props = withDefaults(defineProps<{ cap?: number }>(), { cap: PAGED_CAP });
const emit = defineEmits<{ settled: [] }>();

const { t, locale } = useI18nTyped();
const router = useRouter();
const store = useStore();
const paged = useLivePaged(props.cap);
const askAi = inject(ASK_AI_KEY, null);

const slotEl = ref<HTMLElement | null>(null);
const bodyEl = ref<HTMLElement | null>(null);

const copy = computed(() => pagedCopy(t));

const state = computed(() => paged.state.value);
const skeleton = computed(() => paged.skeleton.value);
const org = computed(() => paged.org.value);
const rows = computed(() => paged.rows.value);
const route = useRoute();
// Read only while a card would offer routing setup; a failed read keeps the offer.
const anyUnrouted = computed(() => rows.value.some((item) => item.page?.outcome === "unrouted"));
const routing = useQuery(() => ({ ...routingConfigQuery(org.value), enabled: anyUnrouted.value }));
const routingSet = computed(() => !!routing.data.value?.default_team_id);
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
const learningText = computed(() => learningLine(t, paged.zone.value, paged.learning.value));
const waiting = computed(() => learningEmpty(t, paged.zone.value, paged.learning.value));
const newText = computed(() => newFindingsText(t, locale.value, paged.newCount.value));

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

const shown = computed(() =>
  rows.value.map((item) => ({
    id: item.finding.id,
    incidentId: item.incident.id,
    severity: item.incident.severity,
    status: item.incident.status,
    statusText: statusLabel(t, item.incident.status),
    sentence: findingSentence(t, item),
    opened: openedText(t, locale.value, item, paged.now.value),
    analysis: analysisLine(t, item, paged.rcaEnabled.value),
    logs: findingLogs(item, paged.now.value),
    ai: findingAi(t, item, paged.zone.value, paged.now.value),
    copy: pagedFindingCopy(t, paged.zone.value, item, paged.now.value, routingSet.value),
  })),
);

const canAsk = computed(() => !!askAi && aiEnabled(store.state.zoConfig));
const ask = (finding: AiFinding) => askAi?.(askAiPayload(t, finding, org.value));

// The footer sits outside the subtitle slot, so a stale or new-findings notice never hides the reason the rows dropped.
const shared = computed(() =>
  settled.value
    ? sharedAnalysis(
        t,
        shown.value.map((row) => row.analysis),
      )
    : null,
);

const loadPhase = useLoadPhase(() => state.value.status, skeleton);
const loadText = computed(() => liveLoadText(t, "incidents", loadPhase.value));

const view = computed(
  () => `${slotKind.value}|${notice.value?.failure ?? ""}|${rows.value.map((r) => r.finding.id)}`,
);

// A swap that removes the focused Show or Retry moves focus to the card body, never to the page.
watch(
  view,
  () => {
    const active = document.activeElement;
    const inside = !!active && (slotEl.value?.contains(active) || bodyEl.value?.contains(active));
    if (!inside) return;
    void nextTick(() => {
      const now = document.activeElement;
      if (!now || now === document.body) bodyEl.value?.focus();
    });
  },
  { flush: "pre" },
);
</script>
