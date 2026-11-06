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

<!--
  Users (AIO-27) — who uses the agents and what they cost: one row per
  `user.id`, with its tenant, sessions, tokens, spend, error rate (traces with
  an errored span) and last activity, most expensive first. "Sessions" opens the Sessions
  list filtered to that user.
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

      <OTable
        :data="rows"
        :columns="columns"
        row-key="user_id"
        :loading="loading"
        :show-global-filter="false"
        pagination="client"
        class="min-h-0 flex-1"
        :empty-message="failed ? t('llmAttribution.loadFailed') : t('llmAttribution.users.empty')"
        data-test="ai-users-table"
      >
        <template #cell-cost="{ row }">{{ `$${Number(row.cost).toFixed(2)}` }}</template>
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
            :data-test="`ai-users-sessions-${row.user_id}`"
            @click="openSessions(row.user_id)"
          >
            {{ t("llmAttribution.users.sessions") }}
          </OButton>
        </template>
      </OTable>
      <span class="text-2xs text-text-secondary" data-test="ai-users-count">
        {{ t("llmAttribution.users.count", { n: rows.length }) }}
      </span>
    </div>
  </AiPageShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
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
import { ATTRIBUTION_COLUMNS, usersSql } from "@/plugins/traces/llmAttribution";
import { formatTokens } from "@/utils/llmUtils";
import { timestampToTimezoneDate } from "@/utils/timezone";

defineOptions({ name: "AIUsersPage" });

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
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

const timezone = computed(() => store.state.timezone || "UTC");
const rows = ref<any[]>([]);
const loading = ref(false);
const failed = ref(false);
const lastRunAt = ref<number | null>(null);
const hasTenant = ref(false);
const tenant = ref<string | null>(null);
const search = ref("");
let seq = 0;

const tenantOptions = computed(() =>
  [...new Set(rows.value.map((r) => r.tenant).filter(Boolean))].map((v) => ({
    value: v,
    label: raw(v),
  })),
);

const columns: OTableColumnDef[] = [
  {
    id: "user_id",
    header: t("llmAttribution.dims.user"),
    accessorKey: "user_id",
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
    size: COL.count,
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
  { id: "actions", header: raw(""), size: COL.count, meta: { align: "right" } },
];

async function reload() {
  const { startTime, endTime } = timeRange.value;
  await loadScope(startTime, endTime);
  if (!stream.value) return;
  const mine = ++seq;
  loading.value = true;
  failed.value = false;
  try {
    const schema = await getStream(stream.value, "traces", true).catch(() => null);
    const names = new Set((schema?.schema ?? []).map((f: any) => f.name));
    if (!names.has(ATTRIBUTION_COLUMNS.user)) {
      rows.value = [];
      return;
    }
    hasTenant.value = names.has(ATTRIBUTION_COLUMNS.tenant);
    const hits = (await executeQuery(
      usersSql(stream.value, {
        scope: scope.value,
        tenantColumn: hasTenant.value ? ATTRIBUTION_COLUMNS.tenant : null,
        tenant: tenant.value ?? undefined,
        search: search.value.trim() || undefined,
      }),
      startTime,
      endTime,
    )) as any[];
    if (mine === seq) rows.value = hits;
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

/** Refresh re-anchors a relative window to now, as the other AI pages do. */
function refresh() {
  if (dateState.value.valueType === "relative") {
    applyRelative(dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
  }
  reload();
}

function openSessions(user: string) {
  router.push({
    name: "aiSessions",
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
      type: "stream",
      stream: stream.value,
      user,
    },
  });
}

async function onDateChange(value: any) {
  onDateStateChange(value);
  await nextTick();
  reload();
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(reload, 300);
});
// A tenant was picked from the previous stream's rows; it does not carry over.
watch(stream, () => (tenant.value = null));
watch([stream, agentName, tenant], reload);

onMounted(reload);
</script>
