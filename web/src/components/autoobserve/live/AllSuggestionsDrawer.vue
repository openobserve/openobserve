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
    </template>
    <div class="flex h-full min-h-0 flex-col gap-3">
      <span class="sr-only" role="status" data-test="autoobserve2-suggestions-drawer-announce">{{
        loadText
      }}</span>
      <p class="text-text-secondary text-sm">{{ t("autoobserveLive.suggestions.drawerLine") }}</p>
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
        :loading="skeleton || paging || clampTotal !== null"
        :frame="false"
        row-key="id"
        :pagination="total > 0 ? 'server' : 'none'"
        :page-size="DRAWER_PAGE"
        :page-size-options="[]"
        :current-page="page"
        :total-count="total"
        expansion="single"
        expand-on-row-click
        :show-global-filter="false"
        :cell-overflow-tooltip="false"
        class="min-h-0 flex-1"
        data-test="autoobserve2-suggestions-table"
        @pagination-change="(p) => (page = p.page)"
      >
        <template #cell-headline="{ row }">
          <span class="text-text-heading text-pretty">{{ row.headline }}</span>
          <span
            v-if="row.note"
            class="text-text-secondary mt-0.5 block text-xs leading-snug text-pretty"
            :data-test="`autoobserve2-suggestions-note-${row.id}`"
            >{{ row.note }}</span
          >
        </template>
        <template #cell-kind="{ row }">
          <OTag
            :variant="row.kindVariant"
            size="xs"
            :label="row.kind"
            :data-test="`autoobserve2-suggestions-kind-${row.id}`"
          />
        </template>
        <template #cell-severity="{ row }">
          <OTag
            v-if="row.severity"
            :variant="row.severity.variant"
            size="xs"
            :label="row.severity.label"
          />
          <span v-else class="text-text-muted">—</span>
        </template>
        <template #expansion="{ row }">
          <p class="text-text-body px-4 py-3 text-sm leading-relaxed text-pretty">
            {{ say(t, row.detail) }}
          </p>
        </template>
        <template #empty>
          <div
            v-if="state.status === 'loading' || pastEnd"
            aria-hidden="true"
            data-test="autoobserve2-suggestions-drawer-pending"
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
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { autoobserveSuggestionsPageQuery } from "@/services/autoobserve.queries";
import { say } from "../v2/fixtures";
import LiveNoticeState from "./LiveNoticeState.vue";
import LiveRefreshFailed from "./LiveRefreshFailed.vue";
import { toSuggestionRows, type SuggestionRow } from "./liveAdapter";
import { DRAWER_PAGE, liveLoadText, liveNotice } from "./liveCopy";
import {
  keepSameOrg,
  stateOf,
  useHeldSkeleton,
  useKeptFailure,
  useLiveZone,
  useLoadPhase,
} from "./liveModel";

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t, locale } = useI18nTyped();
const store = useStore();
const zone = useLiveZone();
const page = ref(1);

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const query = useQuery(() => ({
  ...autoobserveSuggestionsPageQuery(org.value, DRAWER_PAGE, (page.value - 1) * DRAWER_PAGE),
  enabled: props.open && !!org.value,
  placeholderData: keepSameOrg(org.value),
}));
const refetch = () => void query.refetch();

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
  toSuggestionRows(t, zone.value, query.data.value?.suggestions ?? []),
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
    if (isOpen) page.value = 1;
  },
);

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
  { id: "severity", header: t("autoobserveLive.suggestions.columns.severity"), size: 100 },
]);
</script>
