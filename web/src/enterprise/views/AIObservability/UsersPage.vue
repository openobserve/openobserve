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
  <AiPageShell
    data-test="ai-users"
    :title="t('llmAttribution.users.title')"
    :subtitle="t('llmAttribution.users.subtitle')"
    icon="group"
    :date-state="dateState"
    :last-run-at="lastRunAt"
    :is-loading="loading"
    @date-change="onDateChange"
    @refresh="refresh"
  >
    <div class="px-page-edge flex min-h-0 flex-1 flex-col gap-2 py-2">
      <div class="flex flex-wrap items-center gap-2">
        <OSelect
          v-model="stream"
          :options="availableStreams.map((s) => ({ value: s, label: raw(s) }))"
          :label="t('llmAttribution.users.stream')"
          label-position="inside"
          size="sm"
          width="sm"
          data-test="ai-users-stream"
        />
        <OSelect
          v-model="agentName"
          :options="agentNames.map((a) => ({ value: a, label: raw(a) }))"
          :label="t('llmAttribution.users.agent')"
          :placeholder="t('llmInsightsDrill.all')"
          label-position="inside"
          clearable
          size="sm"
          width="sm"
          data-test="ai-users-agent"
        />
        <OSelect
          v-if="hasTenant"
          v-model="tenant"
          :options="tenantOptions"
          :label="t('llmAttribution.dims.tenant')"
          :placeholder="t('llmInsightsDrill.all')"
          label-position="inside"
          clearable
          size="sm"
          width="sm"
          data-test="ai-users-tenant"
        />
        <OSearchInput
          v-model="search"
          :placeholder="t('llmAttribution.users.search')"
          class="w-64"
          data-test="ai-users-search"
        />
      </div>

      <div
        v-if="noStream"
        class="text-compact text-text-secondary flex flex-1 flex-col items-center justify-center gap-1"
        data-test="ai-users-no-stream"
      >
        <span class="text-text-heading font-semibold">{{
          t("llmAttribution.users.noStream")
        }}</span>
        <span>{{ t("llmAttribution.users.noStreamHint") }}</span>
      </div>
      <template v-else>
        <OTable
          :data="rows"
          :columns="columns"
          row-key="user_id"
          :loading="loading"
          :show-global-filter="false"
          pagination="client"
          class="min-h-0 flex-1"
          :empty-message="
            failed ? t('llmAttribution.users.loadFailed') : t('llmAttribution.users.empty')
          "
          data-test="ai-users-table"
        >
          <template #cell-cost="{ row }">
            <LLMCostCell
              :cost="Number(row.cost) || 0"
              :tokens="Number(row.tokens) || 0"
              :unpriced-tokens="Number(row.unpriced) || 0"
              scope="row"
              :stream="stream"
              :time-window="{ start: timeRange.startTime, end: timeRange.endTime }"
              :format="(c: number) => `$${formatCost(c)}`"
            />
          </template>
          <template #cell-tokens="{ row }">{{ formatTokens(Number(row.tokens)) }}</template>
          <template #cell-failure_rate="{ row }">
            {{ Number(row.failure_rate).toFixed(1) }}%
          </template>
          <template #cell-last_seen="{ row }">
            {{ timestampToTimezoneDate(Number(row.last_seen), timezone, "yyyy-MM-dd HH:mm") }}
          </template>
          <template #cell-actions="{ row }">
            <OButton
              variant="outline"
              size="xs"
              :title="tenant ? t('llmAttribution.users.sessionsNoTenant') : undefined"
              :data-test="`ai-users-sessions-${row.user_id}`"
              @click="openSessions(row.user_id)"
            >
              {{ t("llmAttribution.users.sessions") }}
            </OButton>
          </template>
        </OTable>
        <span
          v-if="!failed && !loading"
          class="text-2xs text-text-secondary"
          data-test="ai-users-count"
        >
          {{
            rows.length >= USERS_LIMIT
              ? t("llmAttribution.users.capped", { n: USERS_LIMIT })
              : t("llmAttribution.users.count", { n: rows.length }, rows.length)
          }}
        </span>
      </template>
    </div>
  </AiPageShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import AiPageShell from "@/enterprise/components/AIObservability/AiPageShell.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useAiDateController } from "@/enterprise/composables/useAiDateController";
import { useLlmPageScope } from "@/enterprise/composables/useLlmPageScope";
import useStreams from "@/composables/useStreams";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import { ATTRIBUTION_COLUMNS, USERS_LIMIT, usersSql } from "@/plugins/traces/llmAttribution";
import { PARENT_SPAN_FIELD } from "@/plugins/traces/config/llmInsightsPanels";
import LLMCostCell from "@/plugins/traces/LLMCostCell.vue";
import { formatCost, formatTokens } from "@/utils/llmUtils";
import { timestampToTimezoneDate } from "@/utils/timezone";

defineOptions({ name: "AIUsersPage" });

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const route = useRoute();
const { getStream } = useStreams(t);
const { executeQuery } = useLLMStreamQuery();
const {
  dateState,
  timeRange,
  applyRelative,
  DEFAULT_RELATIVE,
  onDateChange: onDateStateChange,
} = useAiDateController();
const {
  stream,
  agentName,
  availableStreams,
  agentNames,
  scope,
  load: loadScope,
} = useLlmPageScope(t);
// A stream from the URL is kept when the org still has it (the loader checks).
stream.value = typeof route.query.stream === "string" ? route.query.stream : "";

const queryString = (v: unknown) => (typeof v === "string" ? v : "");
const timezone = computed(() => store.state.timezone || "UTC");
const rows = ref<any[]>([]);
const loading = ref(false);
const failed = ref(false);
const lastRunAt = ref<number | null>(null);
const hasTenant = ref(false);
// Filters start from the URL, so a reload or a tab switch keeps them.
const tenant = ref<string | null>(queryString(route.query.tenant) || null);
const search = ref(queryString(route.query.q));
// Set when the scope has loaded; the filter watchers reload only after that.
const ready = ref(false);
let seq = 0;

// The org has no LLM trace stream at all: nothing to instrument with user.id yet.
const noStream = computed(() => ready.value && !availableStreams.value.length);

// Only unnarrowed loads refresh this, so picking one tenant keeps the others on offer.
const knownTenants = ref<string[]>([]);
const tenantOptions = computed(() =>
  [...new Set([...knownTenants.value, ...(tenant.value ? [tenant.value] : [])])].map((v) => ({
    value: v,
    label: raw(v),
  })),
);

const columns: OTableColumnDef[] = [
  {
    id: "user_id",
    header: t("llmAttribution.dims.user"),
    accessorKey: "user_id",
    size: 160,
    minSize: 160,
    meta: { align: "left", flex: true },
    sortable: true,
  },
  {
    id: "tenant",
    header: t("llmAttribution.dims.tenant"),
    accessorKey: "tenant",
    size: COL.name,
    meta: { align: "left" },
    sortable: true,
  },
  {
    id: "sessions",
    header: t("llmAttribution.users.sessionsCol"),
    accessorKey: "sessions",
    size: COL.count,
    meta: { align: "right" },
    sortable: true,
  },
  {
    id: "tokens",
    header: t("llmAttribution.tokens"),
    accessorKey: "tokens",
    size: COL.count,
    meta: { align: "right" },
    sortable: true,
  },
  {
    id: "cost",
    header: t("llmAttribution.cost"),
    accessorKey: "cost",
    size: COL.price,
    meta: { align: "right" },
    sortable: true,
  },
  {
    id: "failure_rate",
    header: t("traces.lLMInsightsDashboard.errorRate"),
    accessorKey: "failure_rate",
    // Fits the "Error Rate" header next to its sort icon.
    size: 120,
    meta: { align: "right" },
    sortable: true,
  },
  {
    id: "last_seen",
    header: t("llmAttribution.users.lastSeen"),
    accessorKey: "last_seen",
    size: COL.dateAbsolute,
    meta: { align: "left" },
    sortable: true,
  },
  // Pinned, so the row's Sessions button stays in reach when a narrow window scrolls the table.
  { id: "actions", header: raw(""), isAction: true, size: 110, meta: { align: "right" } },
];

async function reload() {
  const { startTime, endTime } = timeRange.value;
  if (!stream.value) {
    rows.value = [];
    return;
  }
  const mine = ++seq;
  loading.value = true;
  failed.value = false;
  try {
    const schema = await getStream(stream.value, "traces", true).catch(() => null);
    const names = new Set((schema?.schema ?? []).map((f: any) => f.name));
    if (!names.has(ATTRIBUTION_COLUMNS.user)) {
      if (mine === seq) rows.value = [];
      return;
    }
    hasTenant.value = names.has(ATTRIBUTION_COLUMNS.tenant);
    const narrowed = !!tenant.value || !!search.value.trim();
    const hits = (await executeQuery(
      usersSql(stream.value, {
        scope: scope.value,
        tenantColumn: hasTenant.value ? ATTRIBUTION_COLUMNS.tenant : null,
        tenant: tenant.value ?? undefined,
        search: search.value.trim() || undefined,
        hasCostStatus: names.has("gen_ai_usage_cost_status"),
        hasParentSpan: names.has(PARENT_SPAN_FIELD),
      }),
      startTime,
      endTime,
    )) as any[];
    if (mine !== seq) return;
    rows.value = hits;
    if (!narrowed) {
      knownTenants.value = [...new Set(hits.map((r) => r.tenant).filter(Boolean))] as string[];
    }
  } catch (e) {
    if (mine !== seq) return;
    rows.value = [];
    failed.value = true;
    console.error("[AI users] fetch error", e);
  } finally {
    if (mine === seq) {
      loading.value = false;
      lastRunAt.value = Date.now();
    }
  }
}

/** Filter watchers stay quiet while the scope settles, so one load runs one users query. */
async function loadAll() {
  ready.value = false;
  const { startTime, endTime } = timeRange.value;
  await loadScope(startTime, endTime);
  const urlAgent = queryString(route.query.agent);
  if (urlAgent && agentNames.value.includes(urlAgent)) agentName.value = urlAgent;
  await nextTick();
  ready.value = true;
  syncUrl();
  await reload();
}

/** Refresh re-anchors a relative window to now, as the other AI pages do. */
function refresh() {
  if (dateState.value.valueType === "relative") {
    applyRelative(dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
  }
  loadAll();
}

// The page's filters in the URL, beside the date controller's period.
function syncUrl() {
  const query = { ...route.query };
  const set = (key: string, value: string | null | undefined) => {
    if (value) query[key] = value;
    else delete query[key];
  };
  set("stream", stream.value);
  set("agent", agentName.value);
  set("tenant", tenant.value);
  set("q", search.value.trim());
  if (JSON.stringify(query) !== JSON.stringify(route.query)) router.replace({ query });
}

function openSessions(user: string) {
  router.push({
    name: "aiSessions",
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
      ...(agentName.value
        ? { type: "agent", agent: agentName.value }
        : { type: "stream", stream: stream.value }),
      user,
    },
  });
}

// The picker replays the range in force when it mounts; only a new range reloads.
async function onDateChange(value: any) {
  if (!onDateStateChange(value)) return;
  await nextTick();
  loadAll();
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  if (!ready.value) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    syncUrl();
    reload();
  }, 300);
});
// A tenant was picked from the previous stream's rows; it does not carry over.
watch(stream, () => {
  if (!ready.value) return;
  tenant.value = null;
  knownTenants.value = [];
});
watch([stream, agentName, tenant], () => {
  if (!ready.value) return;
  syncUrl();
  reload();
});

onMounted(loadAll);
</script>
