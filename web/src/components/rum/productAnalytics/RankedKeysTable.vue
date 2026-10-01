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
  <AnalyticsPanelState
    :state="state"
    :data-test="dataTest.replace(/-table$/, '')"
    @retry="emit('retry')"
  >
    <OTable
      :data="rows"
      :columns="columns"
      :default-columns="false"
      row-key="key"
      pagination="client"
      :page-size="PAGE_SIZE"
      :current-page="page"
      :keep-page-on-data-change="true"
      sorting="none"
      :show-global-filter="false"
      :frame="false"
      :data-test="dataTest"
      @pagination-change="onPage"
    >
      <template #empty>
        <slot name="empty">
          <OEmptyState preset="no-search-results" size="inline" :hide-action="true" />
        </slot>
      </template>
      <template #cell-key="{ row, index }">
        <span class="flex min-w-0 items-center gap-1.5">
          <OTag
            v-if="kind === 'e'"
            :label="t('rum.analytics.kind.event')"
            variant="purple-soft"
            size="xs"
          />
          <span
            class="text-text-body block max-w-[32rem] truncate font-mono text-xs"
            :data-test="`${dataTest}-row-${index}-key`"
            >{{ displayKey(row) }}<OTooltip :content="raw(labelOf(row))"
          /></span>
        </span>
      </template>
      <template #cell-sessions="{ row, index }">
        <span
          class="tabular-nums"
          :data-test="`${dataTest}-row-${index}-${notUsed ? 'prev-sessions' : 'sessions'}`"
          >{{ formatCount(notUsed ? row.prevSessions : row.sessions, sampled) }}</span
        >
      </template>
      <template #cell-users="{ row, index }">
        <span class="tabular-nums" :data-test="`${dataTest}-row-${index}-users`">{{
          formatCount((notUsed ? row.prevUsers : row.users) ?? 0, sampled)
        }}</span>
      </template>
      <template #cell-events="{ row, index }">
        <span class="tabular-nums" :data-test="`${dataTest}-row-${index}-events`">{{
          formatCount((notUsed ? row.prevEvents : row.events) ?? 0, sampled)
        }}</span>
      </template>
      <template #cell-pages="{ row, index }">
        <span :data-test="`${dataTest}-row-${index}-pages`">
          <OSkeleton v-if="row.pages === null && pagesPending" type="text" class="h-4 w-8" />
          <OTag
            v-else-if="(row.pages ?? 0) >= MULTI_PAGE"
            :label="t('rum.analytics.onPages', { count: row.pages }, row.pages ?? 0)"
            variant="default-soft"
            size="xs"
          />
          <span v-else class="tabular-nums">{{ row.pages ?? dash }}</span>
        </span>
      </template>
      <template #cell-share="{ row, index }">
        <ODataBarCell
          :value="(notUsed ? row.prevShare : row.share) * 100"
          :max="100"
          :display="pct(notUsed ? row.prevShare : row.share)"
          :data-test="`${dataTest}-row-${index}-share`"
        />
      </template>
      <template #cell-delta="{ row, index }">
        <span
          class="flex items-center justify-end gap-1 tabular-nums"
          :data-test="`${dataTest}-row-${index}-delta`"
        >
          <OTag
            v-if="row.delta.kind === 'new'"
            :label="t('rum.analytics.new')"
            variant="info-outline"
            size="xs"
          />
          <template v-else-if="row.delta.kind === 'pct'">
            <OIcon
              v-if="tone(row) === 'up'"
              name="trending-up"
              size="sm"
              class="text-status-success-text"
            />
            <OIcon
              v-else-if="tone(row) === 'down'"
              name="trending-down"
              size="sm"
              class="text-status-error-text"
            />
            <span
              :class="
                tone(row) === 'up'
                  ? 'text-status-success-text'
                  : tone(row) === 'down'
                    ? 'text-status-error-text'
                    : 'text-text-secondary'
              "
              >{{ signedPct(row.delta.value) }}</span
            >
          </template>
          <span v-else class="text-text-secondary">{{ dash }}</span>
        </span>
      </template>
      <template #cell-actions="{ row, index }">
        <span class="flex items-center justify-end gap-1">
          <span class="flex items-center gap-1 max-md:hidden">
            <OButton
              variant="ghost"
              size="sm"
              icon-left="filter-alt"
              :data-test="`${dataTest}-row-${index}-funnel-btn`"
              @click.stop="emit('build-funnel', stepOf(row))"
              >{{ t("rum.analytics.buildFunnel")
              }}<OTooltip :content="t('rum.analytics.buildFunnelTooltip')"
            /></OButton>
            <OButton
              variant="ghost"
              size="sm"
              icon-left="account-tree"
              :data-test="`${dataTest}-row-${index}-paths-btn`"
              @click.stop="emit('paths', stepOf(row))"
              >{{ t("rum.analytics.pathsFromHere")
              }}<OTooltip :content="t('rum.analytics.pathsFromHereTooltip')"
            /></OButton>
            <OTooltip :content="trendTip(row)">
              <OButton
                :variant="isTrended(row) ? 'ghost-primary' : 'ghost'"
                size="sm"
                :icon-left="isTrended(row) ? 'check' : 'show-chart'"
                :disabled="trendBlocked(row)"
                :aria-pressed="isTrended(row)"
                :data-test="`${dataTest}-row-${index}-trend-btn`"
                @click.stop="emit('trend', stepOf(row))"
                >{{ t("rum.analytics.trend") }}</OButton
              >
            </OTooltip>
            <OButton
              v-if="kind === 'c'"
              variant="ghost"
              size="sm"
              icon-left="bookmark-add"
              :data-test="`${dataTest}-row-${index}-define-event-btn`"
              @click.stop="emit('define-event', row)"
              >{{ t("rum.analytics.defineEvent")
              }}<OTooltip :content="t('rum.analytics.defineEventTooltip')"
            /></OButton>
          </span>
          <ODropdown side="bottom" align="end">
            <template #trigger>
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="more-vert"
                class="md:hidden"
                :aria-label="t('rum.analytics.events.moreActions')"
                :data-test="`${dataTest}-row-${index}-menu`"
              />
            </template>
            <ODropdownItem icon-left="filter-alt" @select="emit('build-funnel', stepOf(row))">{{
              t("rum.analytics.buildFunnel")
            }}</ODropdownItem>
            <ODropdownItem icon-left="account-tree" @select="emit('paths', stepOf(row))">{{
              t("rum.analytics.pathsFromHere")
            }}</ODropdownItem>
            <ODropdownItem
              :icon-left="isTrended(row) ? 'check' : 'show-chart'"
              :disabled="trendBlocked(row)"
              :data-test="`${dataTest}-row-${index}-trend-menu-item`"
              @select="emit('trend', stepOf(row))"
              >{{
                isTrended(row) ? t("rum.analytics.trendRemove") : t("rum.analytics.trend")
              }}</ODropdownItem
            >
            <ODropdownItem
              v-if="kind === 'c'"
              icon-left="bookmark-add"
              @select="emit('define-event', row)"
              >{{ t("rum.analytics.defineEvent") }}</ODropdownItem
            >
          </ODropdown>
        </span>
      </template>
    </OTable>
  </AnalyticsPanelState>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import type { OTableColumnDef, OTablePaginationParams } from "@/lib/core/Table/OTable.types";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  CHANGE_THRESHOLD,
  formatCount,
  type ChipFilter,
  type RankedRow,
  type RankedView,
  formatPct as pct,
} from "@/utils/rum/productAnalyticsModel";
import type { SampleRatio, StepKind, StepRef } from "@/utils/rum/productAnalyticsQueries";

const PAGE_SIZE = 10;
const KEY_DISPLAY = 64;
const MULTI_PAGE = 3;

const props = withDefaults(
  defineProps<{
    rows: RankedRow[];
    kind: StepKind;
    view: RankedView;
    chip: ChipFilter;
    showUsers: boolean;
    showPages?: boolean;
    pagesPending?: boolean;
    state: PanelState<unknown>;
    sampled?: SampleRatio;
    dataTest: string;
    keyLabel: I18nText;
    eventsLabel?: I18nText;
    usersLabel?: I18nText;
    usersTooltip?: I18nText;
    compareLabel: I18nText;
    trendFull?: boolean;
    trended?: readonly StepRef[];
    labels?: Record<string, string>;
  }>(),
  {
    showPages: false,
    pagesPending: false,
    sampled: 1,
    eventsLabel: undefined,
    usersLabel: undefined,
    usersTooltip: undefined,
    trendFull: false,
    trended: () => [],
    labels: () => ({}),
  },
);

const emit = defineEmits<{
  "build-funnel": [StepRef];
  paths: [StepRef];
  trend: [StepRef];
  "define-event": [RankedRow];
  retry: [];
  "page-keys": [string[]];
}>();

const { t } = useI18nTyped();
const dash = raw("—");
const page = ref(1);

const notUsed = computed(() => props.chip === "not_used");

const columns = computed<OTableColumnDef<RankedRow>[]>(() => {
  const right = { align: "right" as const };
  const cols: OTableColumnDef<RankedRow>[] = [
    {
      id: "key",
      header: props.keyLabel,
      accessorKey: "key",
      size: 320,
      meta: { fillRemaining: true },
    },
    {
      id: "sessions",
      header: t("rum.analytics.columns.sessions"),
      accessorKey: "sessions",
      size: 100,
      meta: right,
    },
  ];
  if (props.showUsers) {
    cols.push({
      id: "users",
      header: props.usersLabel ?? t("rum.analytics.columns.users"),
      accessorKey: "users",
      size: props.usersLabel && props.usersLabel.length > 8 ? 160 : 90,
      meta: { ...right, headerTooltip: props.usersTooltip },
    });
  }
  if (props.view === "all" && props.eventsLabel) {
    cols.push({
      id: "events",
      header: props.eventsLabel,
      accessorKey: "events",
      size: 90,
      meta: right,
    });
  }
  if (props.showPages && !notUsed.value) {
    cols.push({
      id: "pages",
      header: t("rum.analytics.columns.pages"),
      accessorKey: "pages",
      size: 90,
      meta: { ...right, headerTooltip: t("rum.analytics.columns.pagesTooltip") },
    });
  }
  cols.push({
    id: "share",
    header: t("rum.analytics.columns.share"),
    accessorKey: "share",
    size: 140,
    meta: right,
  });
  if (!notUsed.value) {
    cols.push({
      id: "delta",
      header: props.compareLabel,
      accessorKey: "sessions",
      size: 130,
      meta: right,
    });
    cols.push({ id: "actions", header: raw(""), size: 400, isAction: true, meta: right });
  }
  return cols;
});

const labelOf = (row: RankedRow) => props.labels[row.key] ?? row.key;

const displayKey = (row: RankedRow) => {
  const text = labelOf(row);
  return text.length > KEY_DISPLAY ? `${text.slice(0, KEY_DISPLAY - 1)}…` : text;
};

const stepOf = (row: RankedRow): StepRef => ({ kind: row.kind, key: row.key });

const isTrended = (row: RankedRow) =>
  props.trended.some((s) => s.kind === row.kind && s.key === row.key);

// A plotted key stays enabled at the limit so it can always be removed from its row.
const trendBlocked = (row: RankedRow) => props.trendFull && !isTrended(row);

const trendTip = (row: RankedRow) => {
  if (isTrended(row)) return t("rum.analytics.trendShown");
  return trendBlocked(row) ? t("rum.analytics.trendLimit") : t("rum.analytics.trendAdd");
};

const signedPct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

const tone = (row: RankedRow): "up" | "down" | "flat" => {
  if (row.delta.kind !== "pct") return "flat";
  if (row.delta.value >= CHANGE_THRESHOLD) return "up";
  if (row.delta.value <= -CHANGE_THRESHOLD) return "down";
  return "flat";
};

const emitPageKeys = () => {
  const start = (page.value - 1) * PAGE_SIZE;
  emit(
    "page-keys",
    props.rows.slice(start, start + PAGE_SIZE).map((r) => r.key),
  );
};

const onPage = (p: OTablePaginationParams) => {
  page.value = p.page;
  emitPageKeys();
};

let rowKeys = "";

// Only a different set of rows starts over at page 1; a refill of the same rows keeps the page.
watch(
  () => props.rows,
  (rows) => {
    const next = `${props.state.key}|${rows.map((r) => r.key).join("\u0000")}`;
    if (next === rowKeys) return;
    rowKeys = next;
    page.value = 1;
    emitPageKeys();
  },
);
</script>
