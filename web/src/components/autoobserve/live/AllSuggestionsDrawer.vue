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
  <ODrawer
    :open="open"
    size="xl"
    :title="t('autoobserveLive.suggestions.drawerTitle')"
    data-test="autoobserve2-suggestions-drawer"
    @update:open="(v) => emit('update:open', v)"
  >
    <template #header-left>
      <span
        v-if="query.data.value"
        class="bg-surface-subtle text-text-body rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
        data-test="autoobserve2-suggestions-drawer-count"
      >
        {{ formatCount(total) }}
      </span>
      <OSkeleton
        v-else-if="!notice"
        animation="none"
        class="h-5 w-8 rounded-full"
        data-test="autoobserve2-suggestions-drawer-count-skeleton"
      />
      <OTag
        v-if="kindLabel"
        variant="default-soft"
        size="sm"
        removable
        :label="kindLabel"
        :remove-label="t('autoobserveLive.suggestions.clearKind')"
        data-test="autoobserve2-suggestions-drawer-kind"
        @remove="emit('update:kind', null)"
      />
    </template>
    <div class="flex h-full min-h-0 flex-col gap-3">
      <span class="sr-only" role="status" data-test="autoobserve2-suggestions-drawer-announce">{{
        loadText
      }}</span>
      <p
        class="text-text-secondary text-sm"
        :role="focusGone ? 'status' : undefined"
        data-test="autoobserve2-suggestions-drawer-line"
      >
        {{
          focusGone
            ? t("autoobserveLive.suggestions.focusGone")
            : t("autoobserveLive.suggestions.drawerLine")
        }}
      </p>
      <LiveNoticeState
        v-if="notice"
        :notice="notice"
        size="block"
        :detail="state.detail"
        :busy="state.busy"
        data-test="autoobserve2-suggestions-drawer-error"
        retry-test="autoobserve2-suggestions-drawer-retry"
        @retry="refetch()"
      />
      <LiveRefreshFailed
        v-if="state.stale"
        surface="suggestions"
        :stale="state.stale"
        :busy="state.busy"
        data-test="autoobserve2-suggestions-drawer-refresh-failed"
        @retry="refetch()"
      />
      <OTable
        v-if="!notice"
        :data="rows"
        :columns="columns"
        :loading="skeleton || paging || clampTotal !== null || locating"
        :frame="false"
        row-key="id"
        :pagination="total > 0 ? 'server' : 'none'"
        :page-size="DRAWER_PAGE"
        :page-size-options="[]"
        :current-page="page"
        :total-count="total"
        :active-row-index="focusRowIndex"
        v-model:expanded-ids="expandedIds"
        expansion="single"
        expand-on-row-click
        :show-global-filter="false"
        :cell-overflow-tooltip="false"
        class="min-h-0 flex-1"
        data-test="autoobserve2-suggestions-table"
        @pagination-change="(p) => (page = p.page)"
      >
        <template #cell-headline="{ row }">
          <div class="py-1.5" :data-test="`autoobserve2-suggestions-row-${row.id}`">
            <span class="text-text-heading block text-pretty">{{ row.headline }}</span>
            <span
              v-if="row.note"
              class="text-text-secondary mt-0.5 block text-xs leading-snug text-pretty"
              :data-test="`autoobserve2-suggestions-note-${row.id}`"
              >{{ row.note }}</span
            >
          </div>
        </template>
        <template #cell-kind="{ row }">
          <OTag
            :variant="row.kindVariant"
            size="sm"
            :label="row.kind"
            :data-test="`autoobserve2-suggestions-kind-${row.id}`"
          />
        </template>
        <template #cell-next="{ row }">
          <OButton
            v-if="row.insight.cta"
            variant="outline"
            size="xs"
            class="max-w-full"
            :title="row.insight.cta.label"
            :loading="pendingId === row.id"
            :data-test="`autoobserve2-suggestions-next-${row.id}`"
            @click.stop="run(row.id, row.insight.cta)"
          >
            {{ row.insight.cta.label }}
          </OButton>
          <span v-else class="text-text-muted">—</span>
        </template>
        <template #expansion="{ row }">
          <div class="max-md:sticky max-md:start-0 max-md:max-w-[calc(100vw-2rem)]">
            <InsightBlock
              :parts="row.insight"
              variant="details"
              hide-cta
              :pending="pendingId === row.id"
              @cta="(cta) => run(row.id, cta)"
              @secondary="(cta) => run(row.id, cta)"
              @dismiss="dismiss(row.insight)"
            />
          </div>
        </template>
        <template #empty>
          <div
            v-if="state.status === 'loading' || pastEnd || locating"
            aria-hidden="true"
            data-test="autoobserve2-suggestions-drawer-pending"
          />
          <OEmptyState
            v-else-if="kindLabel && othersOpen"
            size="inline"
            icon="filter-alt"
            :title="t('autoobserveLive.suggestions.kindEmptyTitle', { kind: kindLabel })"
            :description="
              t('autoobserveLive.suggestions.kindEmptyDesc', { count: othersOpen }, othersOpen)
            "
            :action-label="t('autoobserveLive.suggestions.clearKind')"
            data-test="autoobserve2-suggestions-drawer-empty"
            @action="emit('update:kind', null)"
          />
          <OEmptyState
            v-else
            size="inline"
            icon="task-alt"
            :title="t('autoobserveLive.notice.suggestions.emptyTitle')"
            :description="t('autoobserveLive.notice.suggestions.emptyDesc')"
            data-test="autoobserve2-suggestions-drawer-empty"
          />
        </template>
      </OTable>
    </div>
    <AlertCalibrationDismissDialog
      v-if="dismissTarget"
      v-model:open="dismissOpen"
      :finding="dismissTarget"
    />
    <ReviewChangeDialog v-if="reviewTarget" v-model:open="reviewOpen" :target="reviewTarget" />
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import {
  autoobserveCoverageQuery,
  autoobserveSuggestionRankQuery,
  autoobserveSuggestionsPageQuery,
} from "@/services/autoobserve.queries";
import InsightBlock from "../insight/InsightBlock.vue";
import { useInsightActions } from "../insight/useInsightActions";
import ReviewChangeDialog from "../decisions/ReviewChangeDialog.vue";
import AlertCalibrationDismissDialog from "@/components/alert_calibration/AlertCalibrationDismissDialog.vue";
import LiveNoticeState from "./LiveNoticeState.vue";
import LiveRefreshFailed from "./LiveRefreshFailed.vue";
import { suggestionKindLabel, toSuggestionRows, type SuggestionRow } from "./liveAdapter";
import { DRAWER_PAGE, liveLoadText, liveNotice } from "./liveCopy";
import {
  keepSameOrg,
  stateOf,
  useHeldSkeleton,
  useKeptFailure,
  useLiveZone,
  useLoadPhase,
} from "./liveModel";

// focusId and kind come from a Slack link; either may be stale, which only changes what is shown.
const props = withDefaults(
  defineProps<{ open: boolean; focusId?: string | null; kind?: string | null }>(),
  { focusId: null, kind: null },
);

const emit = defineEmits<{
  "update:open": [value: boolean];
  "update:kind": [value: null];
}>();

const { t, locale } = useI18nTyped();
const store = useStore();
const zone = useLiveZone();
const { run, dismiss, pendingId, dismissTarget, dismissOpen, reviewTarget, reviewOpen } =
  useInsightActions();
const page = ref(1);

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const kindLabel = computed(() => (props.kind ? suggestionKindLabel(t, props.kind) : null));
const kindFilter = computed(() => (kindLabel.value ? (props.kind ?? undefined) : undefined));
const rank = useQuery(() => ({
  ...autoobserveSuggestionRankQuery(org.value, props.focusId ?? "", kindFilter.value),
  enabled: props.open && !!org.value && !!props.focusId,
}));
const locating = computed(() => !!props.focusId && rank.isPending.value && !rank.isError.value);
const focusRank = computed(() =>
  props.focusId && rank.data.value !== undefined && rank.data.value >= 0 ? rank.data.value : null,
);
const focusPage = computed(() =>
  focusRank.value === null ? null : Math.floor(focusRank.value / DRAWER_PAGE) + 1,
);
const focusGone = computed(() => !!props.focusId && rank.data.value === -1);
// Holds the page read until it has moved to the linked row's page, so page 1 is never fetched on the way.
const focusMoved = ref(false);
const query = useQuery(() => ({
  ...autoobserveSuggestionsPageQuery(
    org.value,
    DRAWER_PAGE,
    (page.value - 1) * DRAWER_PAGE,
    kindFilter.value,
  ),
  enabled:
    props.open && !!org.value && !locating.value && (focusPage.value === null || focusMoved.value),
  placeholderData: keepSameOrg(org.value),
}));
const refetch = () => void query.refetch();
// A kind with nothing open still says what else is open, read from the unfiltered first page.
const unfiltered = useQuery(() => ({
  ...autoobserveSuggestionsPageQuery(org.value, DRAWER_PAGE, 0),
  enabled: props.open && !!org.value && !!kindFilter.value && query.data.value?.total === 0,
}));
const othersOpen = computed(() => (kindFilter.value ? (unfiltered.data.value?.total ?? 0) : 0));
// The same cached coverage the page shows, so a row's fix can prefill from its service's streams.
const coverage = useQuery(() => ({
  ...autoobserveCoverageQuery(org.value, "strict"),
  enabled: props.open && !!org.value,
}));

const state = useKeptFailure(
  () => stateOf(query, refetch),
  () => `${org.value}\u0000${page.value}`,
  () => query.isPlaceholderData.value,
);
const notice = computed(() =>
  state.value.status === "error" && state.value.failure
    ? liveNotice(t, "suggestions", state.value.failure)
    : null,
);
const rows = computed<SuggestionRow[]>(() =>
  toSuggestionRows(t, zone.value, query.data.value?.suggestions ?? [], Date.now(), {
    rows: coverage.data.value?.rows,
  }),
);
const clampTotal = ref<number | null>(null);
// An org switch voids the hold, so an older org's clamp can never set or clear the newer org's total.
let clampRun = 0;
const total = computed(() => clampTotal.value ?? query.data.value?.total ?? 0);
const skeleton = useHeldSkeleton(() => props.open && state.value.status === "loading");
const paging = computed(() => query.isPlaceholderData.value && query.isFetching.value);
// The total can shrink while a later page is open, leaving its offset past the end.
const pastEnd = computed(
  () =>
    !!query.data.value &&
    !query.isPlaceholderData.value &&
    page.value > 1 &&
    (page.value - 1) * DRAWER_PAGE >= total.value,
);
const loadPhase = useLoadPhase(() => state.value.status, skeleton);
const loadText = computed(() => liveLoadText(t, "suggestions", loadPhase.value));

const formatCount = (n: number) => raw(new Intl.NumberFormat(locale.value).format(n));

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) page.value = focusPage.value ?? 1;
  },
);

const expandedIds = ref<string[]>([]);
const focusRowIndex = computed(() =>
  focusRank.value !== null && page.value === focusPage.value ? focusRank.value % DRAWER_PAGE : null,
);
const focusShown = computed(
  () =>
    focusPage.value !== null &&
    page.value === focusPage.value &&
    rows.value.some((r) => r.id === props.focusId),
);

watch(
  focusPage,
  (p) => {
    if (p === null) return;
    page.value = p;
    focusMoved.value = true;
    expandedIds.value = props.focusId ? [props.focusId] : [];
  },
  { immediate: true },
);

const FOCUS_WAIT_FRAMES = 90;
const FOCUS_SETTLE_MS = 250;

const outOfView = (el: Element) => {
  const box = el.getBoundingClientRect();
  return box.top < 0 || box.bottom > window.innerHeight;
};

// The drawer mounts its body and slides in after the data arrives, so wait for the row, then check again once it settles.
const scrollToFocus = (id: string, framesLeft = FOCUS_WAIT_FRAMES) => {
  if (props.focusId !== id || !props.open) return;
  const el = document.querySelector(`[data-test="autoobserve2-suggestions-row-${id}"]`);
  if (!el) {
    if (framesLeft > 0) requestAnimationFrame(() => scrollToFocus(id, framesLeft - 1));
    return;
  }
  el.scrollIntoView?.({ block: "center" });
  setTimeout(() => {
    if (props.focusId === id && el.isConnected && outOfView(el))
      el.scrollIntoView?.({ block: "center" });
  }, FOCUS_SETTLE_MS);
};

watch(focusShown, async (shown) => {
  if (!shown || !props.focusId) return;
  await nextTick();
  scrollToFocus(props.focusId);
});

watch(org, () => {
  page.value = 1;
  clampRun += 1;
  clampTotal.value = null;
});

// The page it lands on may be cached from before the total shrank, so it is fetched again under the new total.
watch(pastEnd, async (past) => {
  if (!past) return;
  const run = ++clampRun;
  clampTotal.value = total.value;
  page.value = Math.max(1, Math.ceil(clampTotal.value / DRAWER_PAGE));
  await nextTick();
  if (!query.isPlaceholderData.value) await query.refetch();
  if (run === clampRun) clampTotal.value = null;
});

const columns = computed<OTableColumnDef<SuggestionRow>[]>(() => [
  { id: "headline", header: t("autoobserveLive.suggestions.columns.suggestion"), size: 360 },
  {
    id: "where",
    header: t("autoobserveLive.suggestions.columns.where"),
    accessorKey: "where",
    size: 150,
  },
  { id: "kind", header: t("autoobserveLive.suggestions.columns.kind"), size: 150 },
  { id: "next", header: t("insight.labels.nextStep"), size: 190 },
]);
</script>
