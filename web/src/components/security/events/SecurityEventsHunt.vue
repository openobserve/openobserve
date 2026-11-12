<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import securityInvestigate, { type HuntRow } from "@/services/securityInvestigate";
import { useSecurityStreamPlans } from "@/composables/security/useSecurityStreamPlans";
import SecurityAccessLock from "@/components/security/SecurityAccessLock.vue";
import { forbiddenReason, isForbiddenError } from "@/composables/security/useSecurityAccess";
import { failedRequests, viewDenial } from "@/composables/useAccessStore";
import {
  HUNT_COLUMNS,
  HUNT_KINDS,
  type HuntColumn,
  type HuntKind,
  type HuntQuery,
  type HuntSort,
} from "@/utils/security/huntLink";
import { formatEventCount } from "@/utils/formatters";

const props = defineProps<{
  orgId: string;
  /** Window, µs. */
  start: number;
  end: number;
  initial: HuntQuery;
}>();
const emit = defineEmits<{
  "update:query": [query: HuntQuery];
  "open-event": [stream: string, timestampUs: number];
  loading: [busy: boolean];
}>();
const { t } = useI18nTyped();

const kind = ref<HuntKind>(props.initial.kind);
const value = ref(props.initial.value);
const aliases = ref<string[]>(props.initial.aliases ?? []);
const page = ref(1);
const pageSize = ref(50);
const sort = ref<HuntSort>({ column: "time", order: "desc" });

const rows = ref<HuntRow[]>([]);
const perSource = ref<{ stream: string; n: number }[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref("");
const searched = ref(false);
/** Streams that could not be counted; their rows may still be in the page. */
const uncounted = ref<string[]>([]);

const {
  plans,
  load: loadPlans,
  loading: plansLoading,
  failure: plansFailure,
} = useSecurityStreamPlans();
/** A refused plan or search; the server's 403 names the streams it could not read. */
const refusal = shallowRef<unknown>(null);
const accessDenials = computed(() =>
  refusal.value ? [viewDenial("streams", "list", failedRequests(refusal.value))] : [],
);
let plansFor = "";
let seq = 0;
let controller: AbortController | null = null;
onBeforeUnmount(() => controller?.abort());

const query = computed<HuntQuery>(() => ({
  kind: kind.value,
  value: value.value.trim(),
  aliases: kind.value === "user" ? aliases.value : [],
}));

/** Runs the hunt; a page or sort change keeps the per-source counts. */
async function run({ recount = true } = {}) {
  const q = query.value;
  emit("update:query", q);
  if (!props.orgId || !q.value) {
    rows.value = [];
    perSource.value = [];
    total.value = 0;
    searched.value = false;
    return;
  }
  const mine = ++seq;
  controller?.abort();
  const ctrl = (controller = new AbortController());
  loading.value = true;
  emit("loading", true);
  error.value = "";
  refusal.value = null;
  if (recount) page.value = 1;
  try {
    // Plans hold each source's columns; they change with the source list, not the query.
    if (plansFor !== props.orgId || !plans.value.length) {
      await loadPlans(props.orgId, props.start, props.end, { signal: ctrl.signal });
      plansFor = props.orgId;
    }
    if (mine !== seq) return;
    if (isForbiddenError(plansFailure.value)) throw plansFailure.value;
    const res = await securityInvestigate.searchEvents(
      props.orgId,
      {
        startTime: props.start,
        endTime: props.end,
        plans: plans.value,
        query: q,
        sort: sort.value,
        from: (page.value - 1) * pageSize.value,
        size: pageSize.value,
        count: recount,
      },
      ctrl.signal,
    );
    if (mine !== seq) return;
    rows.value = res.data.rows;
    if (!res.data.searchable) {
      perSource.value = [];
      total.value = 0;
    } else if (recount) {
      uncounted.value = res.data.uncounted;
      perSource.value = res.data.perSource;
      total.value = res.data.total ?? 0;
    }
    searched.value = true;
  } catch (e: any) {
    if (mine !== seq || ctrl.signal.aborted) return;
    rows.value = [];
    if (isForbiddenError(e)) refusal.value = e;
    else
      error.value =
        e?.response?.data?.message ?? e?.message ?? String(t("siem.events.searchFailed"));
  } finally {
    if (mine === seq) {
      loading.value = false;
      emit("loading", false);
    }
  }
}

function onPage({ page: p, size }: { page: number; size: number }) {
  if (p === page.value && size === pageSize.value) return;
  if (size !== pageSize.value) {
    pageSize.value = size;
    page.value = 1;
  } else page.value = p;
  void run({ recount: false });
}

function onSort({ column, order }: { column: string; order: "asc" | "desc" }) {
  sort.value = { column: column as HuntColumn, order };
  page.value = 1;
  void run({ recount: false });
}

watch(kind, () => {
  if (value.value.trim()) void run();
});

function clearAliases() {
  aliases.value = [];
  void run();
}

function cancel() {
  seq += 1;
  controller?.abort();
  loading.value = false;
  emit("loading", false);
}
defineExpose({ run, cancel });

const kindOptions = computed(() =>
  HUNT_KINDS.map((k) => ({ label: t(`siem.events.hunt.kind.${k}`), value: k })),
);

const COLUMN_SIZE: Partial<Record<HuntColumn, number>> = {
  time: 170,
  source: 160,
  ip: 140,
  outcome: 100,
  message: 360,
};
const columns = computed<OTableColumnDef<HuntRow>[]>(() =>
  HUNT_COLUMNS.map((col) => ({
    id: col,
    header: t(`siem.events.hunt.column.${col}`),
    accessorKey: col,
    size: COLUMN_SIZE[col] ?? 170,
    sortable: true,
    meta: { isName: col === "source" },
  })),
);

function fmtTs(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function onRow(row: HuntRow) {
  emit("open-event", row.source, row.ts);
}
</script>

<template>
  <OTable
    :data="rows"
    :columns="columns"
    row-key="_key"
    pagination="server"
    :current-page="page"
    :page-size="pageSize"
    :page-size-options="[50, 100, 250]"
    :total-count="total"
    sorting="server"
    :sort-by="sort.column"
    :sort-order="sort.order"
    :loading="loading || plansLoading"
    :error="error || null"
    :show-global-filter="false"
    class="min-h-0 flex-1"
    data-test="security-events-hunt-table"
    @pagination-change="onPage"
    @sort-change="onSort"
    @row-click="onRow"
  >
    <template #toolbar>
      <div class="flex w-full flex-wrap items-center gap-2">
        <div class="w-40 shrink-0">
          <OSelect
            :aria-label="t('siem.aria.huntKind')"
            v-model="kind"
            :options="kindOptions"
            data-test="security-events-hunt-kind"
          />
        </div>
        <OSearchInput
          v-model="value"
          :placeholder="t(`siem.events.hunt.placeholder.${kind}`)"
          class="max-w-md min-w-0 flex-1 max-md:min-w-40"
          data-test="security-events-hunt-value"
          @keydown.enter="run()"
          @clear="run()"
        />
        <OButton
          variant="outline"
          size="sm"
          icon-left="manage-search"
          :disabled="!value.trim()"
          data-test="security-events-hunt-run"
          @click="run()"
        >
          {{ t("siem.events.hunt.search") }}
        </OButton>
        <OTag
          v-if="kind === 'user' && aliases.length"
          variant="default-soft"
          size="sm"
          data-test="security-events-hunt-aliases"
          >{{ t("siem.events.hunt.aliases", aliases.length)
          }}<OTooltip :content="raw(aliases.join(', '))" />
          <template #trailing>
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="close"
              data-test="security-events-hunt-aliases-clear"
              @click="clearAliases"
            >
              <OTooltip :content="t('siem.events.hunt.clearAliases')" />
            </OButton>
          </template>
        </OTag>
      </div>
    </template>

    <template v-if="perSource.length || uncounted.length" #subheader>
      <div
        class="px-page-edge border-table-row-divider flex flex-wrap items-center gap-1 border-b py-1.5"
        data-test="security-events-hunt-sources"
      >
        <OTag
          v-for="s in perSource"
          :key="s.stream"
          variant="default-soft"
          size="xs"
          class="font-mono"
          :data-test="`security-events-hunt-source-${s.stream}`"
          >{{ s.stream }} · {{ formatEventCount(s.n) }}</OTag
        >
        <OTag
          v-if="uncounted.length"
          variant="warning-soft"
          size="xs"
          data-test="security-events-hunt-uncounted"
          >{{ t("siem.events.hunt.uncounted", { streams: uncounted.join(", ") }) }}</OTag
        >
      </div>
    </template>

    <template #cell-time="{ row }">
      <span class="text-text-secondary font-mono text-xs whitespace-nowrap">{{
        fmtTs(row.time)
      }}</span>
    </template>
    <template #cell-source="{ row }">
      <OTag variant="default-soft" size="xs" class="font-mono">{{ row.source }}</OTag>
    </template>
    <template #cell-outcome="{ row }">
      <OTag v-if="row.outcome === 'failure'" variant="error-soft" size="xs">{{
        t("siem.outcome.failure")
      }}</OTag>
      <span v-else class="text-text-secondary">—</span>
    </template>
    <template #cell-ip="{ row }">
      <span class="truncate font-mono text-xs">{{ row.ip || "—" }}</span>
    </template>

    <template #empty>
      <SecurityAccessLock
        v-if="accessDenials.length"
        :denials="accessDenials"
        :reason="raw(forbiddenReason(refusal))"
        data-test="security-events-hunt-lock"
      />
      <OEmptyState
        v-else-if="!loading"
        size="block"
        icon="manage-search"
        :title="searched ? t('siem.events.hunt.noMatches') : t('siem.events.hunt.title')"
        :description="searched ? t('siem.events.hunt.noMatchesHint') : t('siem.events.hunt.hint')"
        data-test="security-events-hunt-empty"
      />
    </template>
  </OTable>
</template>
