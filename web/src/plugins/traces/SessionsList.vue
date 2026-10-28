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
  <div class="sessions-list bg-card-glass-bg flex h-full! flex-col">
    <!-- No LLM streams exist in the org at all — nothing to select, so show
         the rich first-run empty state on its own (no table chrome). -->
    <div
      v-if="streamsLoaded && availableStreams.length === 0"
      class="flex min-h-0 flex-1 items-center justify-center"
      data-test="sessions-empty-no-streams"
    >
      <OEmptyState size="hero" preset="no-llm-sessions" @action="onEmptyAction" />
    </div>

    <!-- Scope control — left-aligned Stream/Agent bar directly under the page
         header, matching Agent Graph / Agent Behavior / LLM Insights so every
         AI page places its scope selector identically. Sits above the table
         rather than inside the OTable toolbar. -->
    <!-- Shared scope control. The outer guard (no bar until we know there ARE
         streams) stays here, wrapping the component. Sessions' original bar mixed
         its data-test prefix — `sessions-list-*` for the toggle/pickers but
         `sessions-*` for the count/badges — so those two are passed explicitly to
         stay byte-identical. solidAgentTrigger keeps the "All Agents" empty state
         in solid text (Sessions never dimmed it). -->
    <AiScopeBar
      v-if="!(streamsLoaded && availableStreams.length === 0)"
      :filter-mode="filterMode"
      v-model:active-stream="activeStream"
      v-model:selected-env="selectedEnv"
      v-model:selected-agent-name="selectedAgentName"
      v-model:selected-version="selectedVersion"
      data-test="sessions-list"
      count-data-test="sessions-stream-count"
      all-agents
      show-stream-skeleton
      :show-agent-toggle="genAiAgentMappingAccess.allowed"
      :agent-toggle-locked-message="
        !genAiAgentMappingAccess.allowed ? genAiAgentMappingAccess.message : undefined
      "
      :labels="{
        agent: t('traces.sessionsList.agent'),
        stream: t('traces.sessionsList.stream'),
        streamLabel: t('traces.sessionsList.streamLabel'),
        allAgents: t('traces.allAgents'),
      }"
      :stream-select-options="streamSelectOptions"
      :envs="envs"
      :agent-names="agentNames"
      :versions="versions"
      :selected-stream-count="selectedStreamCount"
      :streams-loaded="streamsLoaded"
      :agents-loaded="agentsLoaded"
      @filter-mode-change="onFilterModeChange"
      @stream-change="onStreamChange"
    >
      <!-- List search — one box, matched against the user id OR the
           conversation text server-side (whichever the stream has). Live,
           debounced (300ms — same as the Streams list's search), same
           pattern as LogStream.vue: no Enter/run-query affordance, a settled
           value just re-fetches. The applied term lives in useSessions'
           singleton next to the page/size so back-navigation restores the
           filtered page. -->
      <template #trailing>
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <label :for="SEARCH_INPUT_ID" class="sr-only">
            {{ t("traces.sessionsList.search.placeholder") }}
          </label>
          <OSearchInput
            :id="SEARCH_INPUT_ID"
            v-model="searchKeyword"
            :placeholder="t('traces.sessionsList.search.placeholder')"
            :title="t('traces.sessionsList.search.title')"
            size="sm"
            clearable
            :debounce="300"
            class="w-full"
            data-test="sessions-list-search"
          />
        </div>
      </template>
    </AiScopeBar>

    <!-- Stream mode because these LLM spans carry no agent identity. -->
    <AiNoAgentIdentityBanner v-if="noAgentIdentity" data-test="sessions-list" class="pb-2" />

    <!-- Streams exist: OTable owns the data surface (column chooser, server-side
         pagination footer, column resize, empty/error body). The scope control
         lives in the page-level bar above; the header owns refresh + date.
         NOTE: explicit v-if (not v-else) — the scope bar above carries its own
         v-if, so a v-else here would chain to the bar and hide the table
         whenever streams exist. -->
    <OTable
      v-if="!(streamsLoaded && availableStreams.length === 0)"
      :data="sessions"
      :columns="tableColumns"
      :loading="loading"
      row-key="sessionId"
      show-index
      pagination="server"
      sorting="server"
      :sort-by="sortBy"
      :sort-order="sortOrder"
      :sort-field-map="sessionSortFieldMap"
      :current-page="currentPage"
      :total-count="total"
      :total-count-exact="!hasMore"
      :page-size="rowsPerPage"
      :page-size-options="rowsPerPageOptions"
      :enable-column-resize="true"
      :persist-columns="true"
      table-id="ai-sessions-list"
      :default-columns="false"
      :show-global-filter="false"
      :frame="false"
      width="100%"
      class="h-full w-full"
      data-test="sessions-list-table"
      @row-click="(row: any) => handleRowClick(row)"
      @pagination-change="onPaginationChange"
      @sort-change="onSortChange"
    >
      <!-- Empty / error body — rendered inside the frame so the toolbar (and
           thus the stream selector) stays visible. -->
      <template #empty>
        <OEmptyState
          v-if="error && hasLoadedOnce"
          size="hero"
          illustration="broken-panel"
          variant="error"
          data-test="sessions-empty-error"
          :title="t('traces.sessionsList.failedToLoad')"
          :description="raw(error || '')"
          :action-label="t('traces.sessionsList.retry')"
          action-id="retry"
          action-icon="refresh"
          @action="loadSessions()"
        />
        <!-- Agent mode whose agents list failed to load: not "no agents". -->
        <AiAgentsLoadError
          v-else-if="agentsLoadFailed"
          :error="agentsError ?? 'failed'"
          data-test="sessions-empty"
          @retry="refresh()"
        />
        <OEmptyState
          v-else-if="agentEmpty"
          size="hero"
          illustration="constellation"
          data-test="sessions-empty-no-agents"
          :title="t('traces.sessionsList.noAgentsTitle')"
          :description="t('traces.sessionsList.noAgentsDescription')"
          :action-label="t('traces.sessionsList.viewByStream')"
          action-id="view-by-stream"
          @action="onFilterModeChange('stream')"
        />
        <!-- A search that matched nothing is NOT a first-run situation — the
             stream has sessions, just none for this term — so never show the
             "instrument your app" screen here; offer to clear the search. -->
        <OEmptyState
          v-else-if="searchActive"
          size="hero"
          illustration="no-results"
          data-test="sessions-empty-search"
          :title="t('traces.sessionsList.search.noResultsTitle')"
          :description="t('traces.sessionsList.search.noResultsDescription')"
          :action-label="t('traces.sessionsList.search.clear')"
          action-id="clear-search"
          @action="clearSearch"
        />
        <div v-else class="flex items-center justify-center py-12" data-test="sessions-empty">
          <OEmptyState size="hero" preset="no-llm-sessions" @action="onEmptyAction" />
        </div>
      </template>
      <!-- Last activity -->
      <template #cell-lastSeenNanos="{ row }">
        <span class="text-xs tabular-nums">
          {{ formatTimestamp(row.lastSeenNanos) }}
        </span>
      </template>

      <!-- Session ID -->
      <template #cell-sessionId="{ row }">
        <span class="text-xs">{{ row.sessionId }}</span>
      </template>

      <!-- User -->
      <template #cell-userId="{ row }">
        <OUserCell :value="row.userId" :empty-label="t('traces.sessionsList.unknownUser')" />
      </template>

      <!-- First user message -->
      <template #cell-firstUserMessage="{ row }">
        <span v-if="row.firstUserMessage" class="text-text-secondary text-xs">
          {{ row.firstUserMessage }}
        </span>
        <span v-else class="text-text-muted text-xs">—</span>
      </template>

      <!-- Turns -->
      <template #cell-turns="{ row }">
        <span class="text-xs">{{ row.turns }}</span>
      </template>

      <!-- Duration -->
      <template #cell-durationNanos="{ row }">
        <span class="text-xs">
          {{ formatDuration(row.durationNanos) }}
          <OTooltip
            :content="
              raw(`${row.durationNanos.toLocaleString()} ${t('traces.sessionsList.durationNs')}`)
            "
          />
        </span>
      </template>

      <!-- Tokens -->
      <template #cell-tokens="{ row }">
        <span class="text-xs tabular-nums">
          {{ formatTokens(row.inputTokens) }} {{ t("traces.sessionDetail.tokensArrow") }}
          {{ formatTokens(row.outputTokens) }} = {{ formatTokens(row.tokens) }}
          <OTooltip
            :content="
              t('traces.sessionsList.tokenTooltip', {
                input: row.inputTokens.toLocaleString(),
                output: row.outputTokens.toLocaleString(),
                total: row.tokens.toLocaleString(),
              })
            "
          />
        </span>
      </template>

      <!-- Cost -->
      <template #cell-cost="{ row }">
        <LLMCostCell
          class="text-xs"
          scope="session"
          :cost="row.cost"
          :tokens="row.tokens"
          :unpriced-tokens="row.unpricedTokens"
          :unpriced-models="row.unpricedModels"
          :stream="effectiveStream"
          :format="(c: number) => `${t('traces.sessionDetail.currencySymbol')}${c.toFixed(4)}`"
        />
      </template>

      <!-- Status (derived from error_count) -->
      <template #cell-status="{ row }">
        <OTag
          type="sessionStatus"
          :value="row.status"
          :data-test="`sessions-list-status-${row.sessionId}`"
        />
      </template>
    </OTable>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { formatDate } from "@/utils/date";
import { raw, useI18nTyped } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import { useLlmTraceStreams } from "@/enterprise/composables/useLlmTraceStreams";
import {
  useAgentScope,
  readUrlScope,
  explicitScopeMode,
  resolveScopeMode,
  rememberModeChoice,
  scopeUrlQuery,
  agentIdentityKey,
  type ScopeMode,
} from "@/enterprise/composables/useAgentScope";
import AiNoAgentIdentityBanner from "@/enterprise/components/AIObservability/AiNoAgentIdentityBanner.vue";
import AiAgentsLoadError from "@/enterprise/components/AIObservability/AiAgentsLoadError.vue";
import {
  useSessions,
  normalizeSearchTerm,
  type SessionRow,
  type SessionSearch,
} from "./composables/useSessions";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import type { AcceptableValue } from "reka-ui";
import type { SessionSortField, SessionSortOrder } from "@/services/sessions";
import { buildAgentSessionFilter } from "./llmAgentFilter";
import { splitNumberWithUnit, splitDuration } from "./llmInsightsDashboard.utils";
import LLMCostCell from "./LLMCostCell.vue";
import AiScopeBar from "@/enterprise/components/AIObservability/AiScopeBar.vue";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";

interface Props {
  streamName: string;
  startTime: number; // microseconds
  endTime: number; // microseconds
  // Route to open on row click. Defaults to the Traces session-details route;
  // the AI/LLM Sessions page passes its own route so it stays in the AI menu.
  detailRouteName?: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "sessionSelected", session: SessionRow): void;
}>();

const STREAM_LS_KEY = "sessionsList_streamFilter";

const { t } = useI18nTyped();
const router = useRouter();
const route = useRoute();
const store = useStore();
const {
  sessions,
  total,
  hasMore,
  loading,
  error,
  hasLoadedOnce,
  lastRunAt,
  loadedOrg,
  currentPage,
  rowsPerPage,
  searchKeyword,
  sortBy,
  sortOrder,
  agents,
  agentsLoaded,
  agentsError,
  agentsOrg,
  fetchPage,
  cancelAll,
} = useSessions();

const urlScope = readUrlScope(route.query);
// Search deep-link: `?keyword=<term>`. Read once at setup, like the scope.
const urlKeyword = normalizeSearchTerm(
  typeof route.query.keyword === "string" ? route.query.keyword : "",
);

// ── List search ─────────────────────────────────────────────────────────────
// `searchKeyword` is module-scoped in useSessions so back-navigation restores
// the filtered page with its term, and it's the search box's own v-model —
// there's no separate draft/applied split. The input's own `:debounce="300"`
// (same as the Streams list's search) settles typing into one value; the
// watch below re-fetches whenever it changes, live, same as LogStream.vue.
// Matched server-side against the user id OR the conversation text,
// whichever the stream has.
const SEARCH_INPUT_ID = "sessions-list-search";
// A term in the URL overrides whatever the singleton holds: a pasted link
// must reproduce its filtered view. When it differs from what the cached rows
// were fetched with, the cache guard in `loadSessions` is bypassed once so the
// mount fetch runs with the URL's term instead of restoring the stale page.
let searchChangedByUrl = false;
if (urlKeyword && urlKeyword !== searchKeyword.value) {
  searchKeyword.value = urlKeyword;
  searchChangedByUrl = true;
}
const searchActive = computed(() => searchKeyword.value.length > 0);
const activeSearch = computed<SessionSearch | undefined>(() =>
  searchActive.value ? { keyword: searchKeyword.value || undefined } : undefined,
);

const activeStream = ref<string>(
  urlScope.stream || localStorage.getItem(STREAM_LS_KEY) || props.streamName || "",
);
// Trace-stream loading is shared with the other AI pages via
// useLlmTraceStreams. availableStreams/streamsLoaded/ensureStreamsLoaded are
// byte-identical to the previous inline versions.
const { availableStreams, streamsLoaded, ensureStreamsLoaded } = useLlmTraceStreams(
  activeStream,
  t,
);
// Persists the RESOLVED agent NAME/env/version of the cascade selection. On
// reload we re-seed the cascade from them (see `pendingScope` +
// `selectAgentByScope`), so the last-picked agent is remembered exactly.
const AGENT_LS_KEY = "sessionsList_agentFilter";
const ENV_LS_KEY = "sessionsList_envFilter";
const VERSION_LS_KEY = "sessionsList_versionFilter";
// Cloud registers the SAME enterprise route tree and backend as an enterprise
// build (see router/index.ts's userCloudRoutes() picked for isCloud too) — only
// a true OSS build lacks the agent-mapping API this gates. Goes through the
// shared `genAiAgentMapping` registry entry (also used by
// LLMInsightsDashboard.vue and the Settings Gen AI Agent Mapping tab) so a
// future backend flag only has to change in one place (see enterpriseFeatures.ts).
const genAiAgentMappingAccess = checkFeatureAccess(
  "genAiAgentMapping",
  buildFeatureGateContext(store.state.zoConfig),
);
// The mode the user asked for (URL `type`/`agent`, else the remembered toggle),
// or null when the agents list decides: Agent when the window has agents,
// Stream when it has none (see loadSessions). OSS has no agent-mapping API, so
// it is pinned to Stream. `agents` / `agentsLoaded` are module-scoped (see
// useSessions), so a back-navigation remount decides from the list it already
// has — but only if that list belongs to this org.
function currentOrg(): string {
  return store.state.selectedOrganization?.identifier || "default";
}
// Drops a module-scoped agents list that belongs to another org: it must not
// decide this org's mode or fill its picker.
function claimAgentsForOrg(org: string) {
  if (agentsOrg.value === org) return;
  agents.value = [];
  agentsLoaded.value = false;
  agentsError.value = null;
  agentsOrg.value = org;
}
claimAgentsForOrg(currentOrg());
const explicitMode = genAiAgentMappingAccess.allowed ? explicitScopeMode(urlScope) : "stream";
const agentsDecided = agentsLoaded.value && !agentsError.value;
const filterMode = ref<ScopeMode>(
  explicitMode ?? (agentsDecided ? resolveScopeMode(null, agents.value.length) : "stream"),
);
const modeExplicit = ref(explicitMode !== null);
// The org whose agents list decided the mode. A load for another org, or after
// a failed agents load, decides again (unless the user chose a mode).
let modeSettledOrg: string | null = agentsDecided ? currentOrg() : null;
// Env/name/version to seed the cascade with once the list is available: the
// URL deep-link first (any of agent/env/version), else the persisted last
// selection, never a mix of the two. Resolved via `selectAgentByScope`, then
// cleared.
const pendingScope = ref<{ env: string; name: string; version: string } | null>(
  urlScope.agent || urlScope.env || urlScope.version
    ? { env: urlScope.env, name: urlScope.agent, version: urlScope.version }
    : localStorage.getItem(AGENT_LS_KEY)
      ? {
          env: localStorage.getItem(ENV_LS_KEY) || "",
          name: localStorage.getItem(AGENT_LS_KEY) || "",
          version: localStorage.getItem(VERSION_LS_KEY) || "",
        }
      : null,
);

// Server-side pagination (1-indexed). OTable owns the footer controls in
// `pagination="server"` mode and emits `pagination-change`; `currentPage` /
// `rowsPerPage` come from useSessions (module-scoped) so the page/size survives
// the unmount/remount cycle and stays in sync with the restored rows.
// Page-size options match the dashboards' table pagination
// (TablePaginationControls) so the AI module stays consistent.
const rowsPerPageOptions = [20, 50, 100, 250, 500];
const sessionSortFieldMap: Record<string, SessionSortField> = {
  userId: "user_id",
  turns: "trace_count",
  durationNanos: "duration",
  tokens: "gen_ai_usage_total_tokens",
  cost: "gen_ai_usage_cost",
  status: "status",
  lastSeenNanos: "end_time",
};

// Shared derived scope computeds come from useAgentScope. Sessions injects its
// OWN refs so the composable only produces the derived outputs: `agents`/
// `agentsLoaded` are module-scoped (from useSessions, survive remount);
// `availableStreams` is Sessions' trace-stream list. Agent selection now flows
// through the Env→Agent→Version cascade (selectedEnv/AgentName/Version →
// selectedAgent), so the old single `activeAgent` ref is gone. The `?agent=`
// deep-link and last-selection restore seed the cascade via `selectAgentByName`
// (see loadSessions). `agentFilterClause` stays page-local (Sessions' session-
// filter builder). Injected refs are the SAME instances the page owns, so
// module scoping is unchanged.
const {
  loadAgents,
  agentsLoadFailed,
  noAgentIdentity,
  streamSelectOptions,
  selectedStreamCount,
  selectedAgent,
  effectiveStream,
  effectiveAgent,
  agentEmpty,
  envs,
  agentNames,
  versions,
  selectedEnv,
  selectedAgentName,
  selectedVersion,
  selectAgentByName,
  selectAgentByScope,
} = useAgentScope({
  filterMode,
  activeStream,
  agents,
  agentsLoaded,
  agentsError,
  availableStreams,
  orgId: () => store.state.selectedOrganization?.identifier,
  getWindow: () => ({ start: props.startTime, end: props.endTime }),
  allAgents: true,
  cascade: true,
  t,
});

// Pins the cascade from the carried-over env/name/version (URL deep-link,
// else the persisted last selection) when a match is possible. One-shot —
// cleared once `agents` was ready to resolve it.
function seedPendingCascade() {
  if (!pendingScope.value || agents.value.length === 0) return;
  const { env, name, version } = pendingScope.value;
  selectAgentByScope(env, name, version);
  pendingScope.value = null;
}

// `agents` can already be populated here on a back-navigation remount (it's
// module-scoped and survives the unmount) — seed the cascade NOW,
// synchronously at setup, before the `selectedAgent`-identity watch below
// exists to react to it, and before `loadSessions()`'s cache-hit guard would
// otherwise skip this same seed call entirely. A fresh mount has no agents
// yet, so this is a no-op here; `loadSessions()` calls it again once
// `loadAgents()` populates the list for the first time.
seedPendingCascade();

// Identity of the agent loadSessions last resolved, and whether a loadSessions
// is between loading the agents and settling the selection. The selected-agent
// watcher skips both, so the selection loadSessions itself seeds (the cascade's
// first-agent default, then the URL / remembered agent) is not fetched twice.
let loadedAgentKey = agentIdentityKey(selectedAgent.value);
let resolvingScope = 0;

const agentFilterClause = computed(() =>
  buildAgentSessionFilter(effectiveAgent.value, effectiveStream.value),
);

// `instrument` is the only action id the preset emits. Send the user to
// the in-app AI integrations page (the closest "set this up" surface) so
// they don't have to leave the product to find the OpenTelemetry guide.
function onEmptyAction(id?: string) {
  if (id !== "instrument") return;
  router.push({
    name: "ai-integrations",
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
    },
  });
}

// Clamp the page when the total shrinks (e.g. a re-fetch returns fewer
// matches than the current page offset).
watch(total, () => {
  const pages = Math.max(1, Math.ceil((total.value || 0) / rowsPerPage.value));
  if (currentPage.value > pages) currentPage.value = pages;
});

// `hideable` exposes a column in OTable's auto-injected column chooser;
// `sessionId` stays mandatory (it's the row identity). `firstUserMessage` is
// the flex column — it fills leftover width on load and freezes on first
// resize. All widths are user-resizable + persisted via `table-id`.
const tableColumns = computed(() =>
  [
    {
      id: "userId",
      header: t("traces.sessionsList.columns.user"),
      accessorKey: "userId",
      // Email-identity width preset; OUserCell truncates + tooltips beyond it.
      size: COL.email,
      sortable: true,
      hideable: true,
      meta: { align: "left" },
    },
    {
      id: "firstUserMessage",
      header: t("traces.sessionsList.columns.firstMessage"),
      accessorKey: "firstUserMessage",
      size: 360,
      // Flex columns collapse to `minSize` when the table overflows horizontally;
      // pin a floor so the message stays readable instead of clipping to "Han…".
      // The user drives how much they want to see via resize, capped by maxSize.
      minSize: 200,
      maxSize: 600,
      sortable: false,
      hideable: true,
      meta: { align: "left", flex: true },
    },
    {
      id: "turns",
      header: t("traces.sessionsList.columns.turns"),
      accessorKey: "turns",
      size: 70,
      sortable: true,
      hideable: true,
      meta: { align: "right" },
    },
    {
      id: "durationNanos",
      header: t("traces.sessionsList.columns.duration"),
      accessorKey: "durationNanos",
      size: 90,
      sortable: true,
      hideable: true,
      meta: { align: "left" },
    },
    {
      id: "tokens",
      header: t("traces.sessionsList.columns.tokens"),
      accessorKey: "tokens",
      size: 150,
      minSize: 150,
      sortable: true,
      hideable: true,
      meta: { align: "right" },
    },
    {
      id: "cost",
      header: t("traces.sessionsList.columns.cost"),
      accessorKey: "cost",
      // Fits "≥ $0.0000 partial" and "cost unknown" (unpriced tokens, AIO-16).
      size: 150,
      sortable: true,
      hideable: true,
      meta: { align: "right" },
    },
    {
      id: "status",
      header: t("traces.sessionsList.columns.status"),
      accessorKey: "status",
      size: 100,
      sortable: true,
      hideable: true,
      meta: { align: "left", disableCellAction: true },
    },
    {
      id: "lastSeenNanos",
      header: t("traces.sessionsList.columns.lastActivity"),
      accessorKey: "lastSeenNanos",
      size: COL.dateAbsolute,
      sortable: true,
      hideable: true,
      meta: { align: "left" },
    },
    {
      id: "sessionId",
      header: t("traces.sessionsList.columns.sessionId"),
      accessorKey: "sessionId",
      size: 250,
      sortable: false,
      meta: { align: "left" },
    },
  ].map((c: any) => ({
    ...c,
    // Offer every column except the session id (row identity) in OTable's
    // "Manage columns" chooser.
    hideable: c.id !== "sessionId",
  })),
);

function formatTimestamp(nanos: number): string {
  if (!nanos) return "—";
  // Backend ships timestamps as nanoseconds — formatDate wants ms.
  return formatDate(Math.floor(nanos / 1_000_000), "YYYY-MM-DD HH:mm:ss");
}

function formatDuration(nanos: number): string {
  if (!nanos) return "—";
  // splitDuration expects microseconds.
  const d = splitDuration(nanos / 1000);
  return `${d.value}${d.unit}`;
}

function formatTokens(n: number): string {
  if (!n) return "0";
  const t = splitNumberWithUnit(n);
  return `${t.value}${t.unit}`;
}

function syncFilterUrl() {
  const query = scopeUrlQuery(route.query, {
    mode: filterMode.value,
    explicit: modeExplicit.value,
    stream: activeStream.value,
    agent: selectedAgent.value
      ? { name: selectedAgent.value.name, env: selectedEnv.value, version: selectedVersion.value }
      : null,
  });
  // Only the applied term — so the filtered view has a link and survives a
  // reload, and a cleared box leaves no stale param behind.
  if (searchKeyword.value) query.keyword = searchKeyword.value;
  else delete query.keyword;
  router.replace({ query }).catch(() => {});
}

function clearSessionRows() {
  sessions.value = [];
  total.value = 0;
  hasMore.value = false;
}

// `forceAgents` is separate from `force`: search, paging and sorting force the rows but not the agent list.
async function loadSessions(
  startTime?: number,
  endTime?: number,
  force = false,
  forceAgents = false,
) {
  const start = startTime ?? props.startTime;
  const end = endTime ?? props.endTime;
  if (!start || !end) return;

  // Serve the already-loaded list from memory. This is the back-navigation
  // case (SessionsList remounts, the parent's DateTime replays its window
  // programmatically) — we keep the previous page instead of re-fetching. Only
  // an explicit refresh or a real date change passes `force`. A prior error or
  // an org switch invalidates the cache so those still re-fetch.
  const orgId = currentOrg();
  if (
    !force &&
    !searchChangedByUrl &&
    hasLoadedOnce.value &&
    !error.value &&
    loadedOrg.value === orgId
  ) {
    return;
  }
  searchChangedByUrl = false;
  // An org switch invalidates the list (see the guard above); the search
  // belonged to the previous org's data, so it goes with it.
  if (loadedOrg.value && loadedOrg.value !== orgId && searchActive.value) {
    searchKeyword.value = "";
  }

  // Hold the table skeleton across the whole load. We await the stream list and
  // the agents API before `fetchPage`, which is the only thing that flips
  // `loading`. Setting it true up front means the table shows one continuous
  // skeleton instead of flashing its empty body between phases.
  loading.value = true;

  // Stream-mode reads `effectiveStream` from `activeStream`, which is only set
  // once the stream list loads — so make sure that's done before we fetch,
  // regardless of whether this call raced ahead of the mount's stream load.
  await ensureStreamsLoaded();

  // The agents list decides the mode (when the user didn't choose one), fills
  // the Agent cascade and the stream agent counts, and drives the "No agent
  // identity found" banner. Served from the query cache within a window.
  claimAgentsForOrg(orgId);
  resolvingScope++;
  try {
    if (genAiAgentMappingAccess.allowed && availableStreams.value.length > 0) {
      await loadAgents(start, end, forceAgents);
    }
  } finally {
    resolvingScope--;
  }
  if (modeSettledOrg !== orgId && !modeExplicit.value) {
    filterMode.value = resolveScopeMode(null, agents.value.length, agentsError.value);
  }
  // A failed load decided nothing about agent identity: the next load decides.
  if (!agentsError.value) modeSettledOrg = orgId;

  if (filterMode.value === "agent") {
    // Seeds the cascade now that the list exists (a no-op if the setup-time
    // call above already resolved it — see seedPendingCascade's own comment).
    seedPendingCascade();
    // Fall back to the first agent when nothing valid is selected (fresh entry,
    // or the previously-picked agent is gone for this window). Seeding by name
    // resolves the whole cascade.
    if (!selectedAgent.value && agents.value.length > 0) {
      selectAgentByName(agents.value[0].name);
    }
    // Persist the resolved agent NAME + env + version so a reload restores
    // the exact same selection, not just a same-named agent under a
    // different env/version.
    if (selectedAgent.value?.name) {
      localStorage.setItem(AGENT_LS_KEY, selectedAgent.value.name);
      localStorage.setItem(ENV_LS_KEY, selectedEnv.value);
      localStorage.setItem(VERSION_LS_KEY, selectedVersion.value);
    }
  } else {
    localStorage.setItem(STREAM_LS_KEY, activeStream.value);
  }
  loadedAgentKey = agentIdentityKey(selectedAgent.value);

  syncFilterUrl();

  const stream = effectiveStream.value;
  if (!stream) {
    clearSessionRows();
    loading.value = false; // nothing to fetch — release the held skeleton
    return;
  }
  await fetchPage(
    stream,
    start,
    end,
    currentPage.value - 1,
    rowsPerPage.value,
    agentFilterClause.value,
    activeSearch.value,
  );
}

// ── Search handlers ─────────────────────────────────────────────────────────
// Live search, same pattern as LogStream.vue: the box's own `:debounce="300"`
// settles typing into one value on `searchKeyword` (its v-model); this watch
// is the ONLY re-fetch trigger — typing, the built-in clear (x) button, and
// clearSearch() below all just change the ref and let this fire. No Enter /
// Escape handling needed. `fetchPage` drops the response of any run a later
// change supersedes.
watch(searchKeyword, () => {
  currentPage.value = 1;
  loadSessions(undefined, undefined, true);
});

function clearSearch() {
  searchKeyword.value = "";
}

// Filter / pagination changes are deliberate user actions — force a re-fetch
// so they bypass the "already loaded" cache guard.
function onStreamChange() {
  currentPage.value = 1;
  loadSessions(undefined, undefined, true);
}

// A toggle click is an explicit choice: kept in the URL and remembered for the
// other Monitor pages, so the agents list no longer picks the mode.
function onFilterModeChange(mode?: AcceptableValue | AcceptableValue[] | boolean) {
  const next = mode === "agent" ? "agent" : "stream";
  if (next === filterMode.value) return;
  filterMode.value = next;
  modeExplicit.value = true;
  rememberModeChoice(next);
  currentPage.value = 1;
  clearSessionRows();
  loadSessions(undefined, undefined, true);
}

// Agent selection now flows through the Env→Agent→Version cascade: changing any
// dropdown re-resolves `selectedAgent` (via useAgentScope's reconciler). Re-fetch
// whenever that resolved agent changes while in Agent mode, mirroring the former
// @agent-change handler. Keyed on the agent's stream-scoped identity + version so
// a same-named agent in a different stream/version still triggers a reload.
watch(
  () => agentIdentityKey(selectedAgent.value),
  (key) => {
    if (filterMode.value !== "agent" || resolvingScope > 0 || key === loadedAgentKey) return;
    currentPage.value = 1;
    loadSessions(undefined, undefined, true);
  },
);

// Single handler for OTable's server pagination footer. A page-size change
// resets to the first page (the old offset may be out of range under the new
// size); a page click just moves to that page. Either way we re-fetch.
function onPaginationChange({ page, size }: { page: number; size: number }) {
  if (size !== rowsPerPage.value) {
    rowsPerPage.value = size;
    currentPage.value = 1;
  } else {
    currentPage.value = page;
  }
  loadSessions(undefined, undefined, true);
}

function onSortChange({ column, order }: { column: string; order: SessionSortOrder }) {
  // OTable's third click clears the column (column === ""). This list is
  // always ordered, so that state resets to the default sort instead of
  // leaving the previous field's icon stuck showing a stale order.
  sortBy.value = (column || "end_time") as SessionSortField;
  sortOrder.value = column ? order : "desc";
  currentPage.value = 1;
  loadSessions(undefined, undefined, true);
}

function handleRowClick(row: SessionRow) {
  emit("sessionSelected", row);
  router.push({
    name: props.detailRouteName || "sessionDetails",
    query: {
      stream: effectiveStream.value,
      session_id: row.sessionId,
      from: props.startTime,
      to: props.endTime,
      org_identifier: store.state.selectedOrganization?.identifier,
      user_id: row.userId || undefined,
    },
  });
}

// Explicit refresh (header button) / real date change — always re-fetches,
// bypassing the cache guard. `lastRunAt` is stamped inside `fetchPage`, so it
// only advances on an actual load, never on a cache hit.
async function refresh(startTime?: number, endTime?: number, force = true) {
  // Only snap back to page 1 when we're actually going to fetch. On the
  // non-forced mount replay we skip the fetch and keep the restored page.
  if (force) currentPage.value = 1;
  await loadSessions(startTime, endTime, force, force);
}

defineExpose({ refresh, lastRunAt, loading });

onMounted(() => {
  // Only kick off the stream-list load here. The session fetch is driven by the
  // parent (its DateTime fires an initial `on:date-change` on mount, plus the
  // refresh button) — a single owner, so we don't double-fetch on load.
  ensureStreamsLoaded();
});

onUnmounted(() => {
  cancelAll();
});

useShortcuts([
  {
    id: "sessionsRefresh",
    handler: () => {
      if (!isInputFocused()) refresh();
    },
  },
]);
</script>
