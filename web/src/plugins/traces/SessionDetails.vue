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
  <div
    class="session-details-page tw:h-[calc(100vh-2.6rem)] tw:px-[0.625rem] tw:py-[0.375rem]"
  >
  <div
    class="session-details card-container tw:h-full tw:flex tw:flex-col tw:px-[1rem] tw:py-[0.625rem] tw:overflow-y-auto"
  >
    <!-- Back nav -->
    <div class="tw:flex tw:items-center tw:gap-[0.5rem] tw:mb-[0.625rem]">
      <OButton variant="ghost-muted" size="icon" @click="goBack">
        <q-icon name="arrow_back" size="20px" />
        <q-tooltip>Back to Sessions</q-tooltip>
      </OButton>
      <span class="tw:text-[1rem] tw:font-semibold">Session Detail</span>
    </div>

    <!-- Loading -->
    <div
      v-if="loading"
      class="tw:flex tw:items-center tw:justify-center tw:flex-1"
    >
      <q-spinner-hourglass color="primary" size="2rem" />
    </div>

    <!-- Error -->
    <div
      v-else-if="error"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:flex-1 tw:text-center"
    >
      <q-icon
        name="error_outline"
        size="3rem"
        class="tw:mb-3 tw:text-[var(--o2-status-error-text)]"
      />
      <div class="tw:text-base tw:text-[var(--o2-text-primary)] tw:mb-2">
        Failed to load session
      </div>
      <div
        class="tw:text-sm tw:text-[var(--o2-text-muted)] tw:mb-3 tw:max-w-[30rem]"
      >
        {{ error }}
      </div>
      <OButton variant="outline" size="sm" @click="load">Retry</OButton>
    </div>

    <!-- Not found -->
    <div
      v-else-if="!detail"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:flex-1 tw:text-center"
    >
      <q-icon
        name="search_off"
        size="3rem"
        class="tw:mb-3 tw:text-[var(--o2-text-muted)]"
      />
      <div class="tw:text-base tw:text-[var(--o2-text-primary)] tw:mb-2">
        Session not found
      </div>
      <div class="tw:text-sm tw:text-[var(--o2-text-muted)] tw:max-w-[30rem]">
        No spans found for <code>{{ sessionId }}</code> in the current time
        range.
      </div>
    </div>

    <!-- Content -->
    <template v-else>
      <!-- Toolbar: search + filters + count text -->
      <div
        class="tw:flex tw:items-center tw:gap-[0.5rem] tw:mb-[0.625rem] tw:flex-wrap"
      >
        <q-input
          v-model="searchText"
          placeholder="Search traces in this session…"
          borderless
          dense
          clearable
          debounce="200"
          class="no-border tw:w-[18rem]! tw:h-[36px]"
        >
          <template #prepend>
            <q-icon class="o2-search-input-icon" size="1rem" name="search" />
          </template>
        </q-input>
        <q-select
          v-model="statusFilter"
          :options="statusOptions"
          dense
          borderless
          emit-value
          map-options
          class="tw:w-[10rem] "
        />
        <q-select
          v-model="modelFilter"
          :options="modelOptions"
          dense
          borderless
          emit-value
          map-options
          class="tw:w-[14rem]"
        />
        <span
          class="tw:ml-auto tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]"
        >
          {{ filteredTraces.length }} of {{ traces.length }}
          {{ traces.length === 1 ? "turn" : "turns" }} shown
        </span>
      </div>

      <!-- User + session id header -->
      <div
        class="tw:flex tw:items-center tw:justify-between tw:px-[1rem] tw:py-[0.75rem] tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:mb-[0.625rem]"
      >
        <div class="tw:flex tw:items-center tw:gap-[0.75rem]">
          <span
            v-if="detail.userId"
            class="tw:inline-flex tw:items-center tw:justify-center tw:w-[36px] tw:h-[36px] tw:rounded-full tw:text-[12px] tw:font-semibold tw:text-white"
            :style="{ background: userAvatarColor(detail.userId) }"
          >
            {{ userInitials(detail.userId) }}
          </span>
          <div class="tw:flex tw:flex-col">
            <span
              class="tw:text-[0.95rem] tw:font-semibold tw:text-[var(--o2-text-primary)] tw:flex tw:items-center tw:gap-[0.5rem]"
            >
              {{ detail.userId || "Unknown user" }}
              <span
                class="tw:text-[0.6rem] tw:font-semibold tw:px-[0.375rem] tw:py-[0.05rem] tw:rounded tw:bg-[var(--o2-tag-grey-1)] tw:text-[var(--o2-text-4)]"
              >
                User
              </span>
            </span>
            <span
              class="tw:text-[0.75rem] tw:font-mono tw:text-[var(--o2-text-muted)] tw:flex tw:items-center tw:gap-[0.375rem]"
            >
              session {{ detail.sessionId }}
              <q-icon
                name="content_copy"
                size="12px"
                class="tw:cursor-pointer tw:hover:text-[var(--o2-text-primary)]"
                @click="copySessionId"
              >
                <q-tooltip>Copy session id</q-tooltip>
              </q-icon>
            </span>
          </div>
        </div>
        <OButton variant="outline" size="sm" @click="openInTraceExplorer">
          <q-icon name="open_in_new" size="14px" class="tw:mr-[0.25rem]" />
          Open in trace explorer
        </OButton>
      </div>

      <!-- KPI strip (5 columns) -->
      <div class="kpi-strip tw:mb-[0.625rem]">
        <div class="kpi-cell">
          <div class="kpi-label">Turns</div>
          <div class="kpi-value">{{ detail.turns }}</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-label">Duration</div>
          <div class="kpi-value">
            {{ formatDuration(detail.durationNanos) }}
          </div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-label">Tokens</div>
          <div class="kpi-value">{{ formatTokens(detail.tokens) }}</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-label">Cost</div>
          <div class="kpi-value">${{ detail.cost.toFixed(2) }}</div>
        </div>
      </div>

      <!-- Conversation header -->
      <div class="tw:flex tw:items-center tw:gap-[0.5rem] tw:mb-[0.5rem]">
        <span
          class="tw:text-[0.85rem] tw:font-semibold tw:text-[var(--o2-text-primary)]"
        >
          Conversation
        </span>
        <span class="tw:text-[0.7rem] tw:text-[var(--o2-text-muted)]">
          · {{ filteredTraces.length }} of {{ traces.length }} turns shown
        </span>
      </div>

      <!-- Turns list -->
      <div class="tw:flex tw:flex-col tw:gap-[0.5rem] tw:pb-[1rem]">
        <div
          v-for="(t, i) in filteredTraces"
          :key="t.traceId"
          class="turn-card"
          :class="{ 'turn-card--error': t.status === 'error' }"
        >
          <!-- Row header (always visible, click to expand) -->
          <div
            class="turn-header"
            :data-test="`session-turn-row-${t.traceId}`"
            @click="toggleTurn(t.traceId)"
          >
            <q-icon
              :name="isExpanded(t.traceId) ? 'expand_more' : 'chevron_right'"
              size="18px"
              class="tw:text-[var(--o2-text-muted)] tw:flex-shrink-0"
            />
            <span
              class="tw:text-[0.85rem] tw:font-semibold tw:text-[var(--o2-text-primary)]"
            >
              Turn {{ originalTurnIndex(t.traceId) + 1 }}
            </span>
            <span
              class="tw:text-[0.75rem] tw:font-mono tw:text-[var(--o2-text-muted)]"
            >
              {{ formatTimestamp(t.startTimeMicros) }}
            </span>
            <span class="tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]">
              · {{ formatDuration(t.durationNanos) }}
            </span>
            <span class="tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]">
              · ${{ t.cost.toFixed(4) }}
            </span>
            <span
              class="tw:rounded tw:px-[0.375rem] tw:py-[0.05rem] tw:text-[0.65rem] tw:font-semibold tw:capitalize tw:inline-flex tw:items-center tw:gap-[0.25rem]"
              :class="statusBadgeClass(t.status)"
            >
              <q-icon
                :name="t.status === 'error' ? 'close' : 'check'"
                size="10px"
              />
              {{ t.status }}
            </span>
            <span
              v-if="t.tokens"
              class="tw:text-[0.7rem] tw:text-[var(--o2-text-muted)] tw:tabular-nums"
            >
              {{ formatTokens(t.tokens) }}
            </span>
            <span class="tw:ml-auto tw:flex tw:items-center tw:gap-[0.25rem]">
              <span
                class="tw:text-[0.7rem] tw:font-mono tw:text-[var(--o2-text-muted)]"
              >
                {{ shortId(t.traceId) }}
              </span>
              <q-icon
                name="open_in_new"
                size="14px"
                class="tw:text-[var(--o2-text-muted)] tw:cursor-pointer tw:hover:text-[var(--o2-text-primary)]"
                @click.stop="openTrace(t.traceId)"
              >
                <q-tooltip>Open trace</q-tooltip>
              </q-icon>
            </span>
          </div>

          <!-- Expanded body -->
          <div v-if="isExpanded(t.traceId)" class="turn-body">
            <!-- Loading state for lazy-loaded turn detail -->
            <div
              v-if="turnDetailLoading[t.traceId]"
              class="tw:flex tw:items-center tw:justify-center tw:py-[1rem]"
            >
              <q-spinner color="primary" size="1.25rem" />
            </div>

            <div v-else class="turn-grid">
              <!-- Messages column -->
              <div class="turn-messages">
                <!-- USER block -->
                <div class="msg-block msg-block--user">
                  <div class="msg-block__header">
                    <span class="msg-block__role">User</span>
                    <q-icon
                      v-if="turnDetail(t.traceId)?.userMessage"
                      name="content_copy"
                      size="13px"
                      class="tw:cursor-pointer tw:opacity-60 tw:hover:opacity-100"
                      @click="
                        copyText(turnDetail(t.traceId)?.userMessage?.content)
                      "
                    />
                  </div>
                  <div class="msg-block__body">
                    {{
                      turnDetail(t.traceId)?.userMessage?.content ||
                      "No user message captured for this turn."
                    }}
                  </div>
                </div>

                <!-- ASSISTANT block -->
                <div class="msg-block msg-block--assistant">
                  <div class="msg-block__header">
                    <span class="msg-block__role">
                      Assistant
                      <span
                        v-if="turnDetail(t.traceId)?.model"
                        class="tw:text-[var(--o2-text-muted)] tw:ml-[0.25rem] tw:normal-case tw:font-normal"
                      >
                        · {{ turnDetail(t.traceId)?.model }}
                      </span>
                    </span>
                    <q-icon
                      v-if="turnDetail(t.traceId)?.assistantMessage"
                      name="content_copy"
                      size="13px"
                      class="tw:cursor-pointer tw:opacity-60 tw:hover:opacity-100"
                      @click="
                        copyText(
                          turnDetail(t.traceId)?.assistantMessage?.content,
                        )
                      "
                    />
                  </div>
                  <div class="msg-block__body">
                    {{
                      turnDetail(t.traceId)?.assistantMessage?.content ||
                      "No assistant response captured for this turn."
                    }}
                  </div>
                </div>
              </div>

              <!-- Right-side stats column -->
              <div class="turn-stats">
                <div class="stat-section">
                  <div class="stat-label">Status</div>
                  <div
                    class="stat-value"
                    :class="
                      t.status === 'error'
                        ? 'tw:text-[var(--o2-status-error-text)]'
                        : ''
                    "
                  >
                    <q-icon
                      :name="t.status === 'error' ? 'close' : 'check'"
                      size="14px"
                      class="tw:mr-[0.25rem]"
                    />
                    {{ t.status }}
                  </div>
                </div>
                <div v-if="t.model" class="stat-section">
                  <div class="stat-label">Model</div>
                  <div class="stat-value tw:font-mono tw:text-[0.75rem]!">
                    {{ t.model }}
                  </div>
                </div>
                <div class="stat-section">
                  <div class="stat-label">Tokens</div>
                  <div class="stat-rows">
                    <div class="stat-row">
                      <span>Input</span>
                      <span class="tw:tabular-nums">{{
                        t.inputTokens.toLocaleString()
                      }}</span>
                    </div>
                    <div class="stat-row">
                      <span>Output</span>
                      <span class="tw:tabular-nums">{{
                        t.outputTokens.toLocaleString()
                      }}</span>
                    </div>
                    <div class="stat-row stat-row--total">
                      <span>Total</span>
                      <span class="tw:tabular-nums">{{
                        t.tokens.toLocaleString()
                      }}</span>
                    </div>
                  </div>
                </div>
                <div class="stat-section">
                  <div class="stat-label">Cost</div>
                  <div class="stat-value">${{ t.cost.toFixed(4) }}</div>
                </div>
                <div class="stat-section">
                  <div class="stat-label">Spans</div>
                  <div class="stat-rows">
                    <div class="stat-row">
                      <span>Total</span>
                      <span class="tw:tabular-nums">{{ t.spanCount }}</span>
                    </div>
                    <div class="stat-row">
                      <span>LLM calls</span>
                      <span class="tw:tabular-nums">{{ t.llmCallCount }}</span>
                    </div>
                    <div class="stat-row">
                      <span>Tool calls</span>
                      <span class="tw:tabular-nums">{{ t.toolCallCount }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, computed, reactive } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { date, copyToClipboard, useQuasar } from "quasar";
import {
  useSessions,
  type SessionDetail,
  type SessionTraceRow,
  type TurnDetail,
} from "./composables/useSessions";
import OButton from "@/lib/core/Button/OButton.vue";
import { b64EncodeUnicode } from "@/utils/zincutils";
import useTraces from "@/composables/useTraces";
import {
  splitNumberWithUnit,
  splitDuration,
} from "./llmInsightsDashboard.utils";

const route = useRoute();
const router = useRouter();
const store = useStore();
const $q = useQuasar();
const { fetchSession, fetchTurnDetail } = useSessions();
const { searchObj } = useTraces();

const detail = ref<SessionDetail | null>(null);
const traces = ref<SessionTraceRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// Turn-detail lazy state — populated on first expand of a given turn.
const turnDetails = reactive<Record<string, TurnDetail>>({});
const turnDetailLoading = reactive<Record<string, boolean>>({});
const expandedTurns = reactive<Record<string, boolean>>({});

// Toolbar filters (all client-side over the in-memory turn list).
const searchText = ref("");
const statusFilter = ref<"all" | "ok" | "warn" | "error">("all");
const modelFilter = ref<string>("all");

const sessionId = computed(() =>
  typeof route.query.session_id === "string" ? route.query.session_id : "",
);
const streamName = computed(() =>
  typeof route.query.stream === "string" ? route.query.stream : "",
);
const startTime = computed(() =>
  typeof route.query.from === "string" ? Number(route.query.from) : 0,
);
const endTime = computed(() =>
  typeof route.query.to === "string" ? Number(route.query.to) : 0,
);

const statusOptions = [
  { label: "All statuses", value: "all" },
  { label: "OK", value: "ok" },
  { label: "Warn", value: "warn" },
  { label: "Error", value: "error" },
];

const modelOptions = computed(() => {
  const models = new Set<string>();
  traces.value.forEach((t) => t.model && models.add(t.model));
  return [
    { label: "All models", value: "all" },
    ...Array.from(models).map((m) => ({ label: m, value: m })),
  ];
});

const filteredTraces = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  return traces.value.filter((t) => {
    if (statusFilter.value !== "all" && t.status !== statusFilter.value)
      return false;
    if (modelFilter.value !== "all" && t.model !== modelFilter.value)
      return false;
    if (q) {
      const hay = [t.traceId, t.model || ""].join(" ").toLowerCase();
      if (!hay.includes(q)) {
        // Also search inside loaded turn detail messages, if any.
        const td = turnDetails[t.traceId];
        const msgHay = [
          td?.userMessage?.content || "",
          td?.assistantMessage?.content || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!msgHay.includes(q)) return false;
      }
    }
    return true;
  });
});

function originalTurnIndex(traceId: string): number {
  return traces.value.findIndex((t) => t.traceId === traceId);
}

function isExpanded(traceId: string): boolean {
  return !!expandedTurns[traceId];
}

function turnDetail(traceId: string): TurnDetail | undefined {
  return turnDetails[traceId];
}

async function toggleTurn(traceId: string) {
  if (expandedTurns[traceId]) {
    expandedTurns[traceId] = false;
    return;
  }
  expandedTurns[traceId] = true;
  if (turnDetails[traceId]) return;
  turnDetailLoading[traceId] = true;
  try {
    const td = await fetchTurnDetail(
      streamName.value,
      traceId,
      startTime.value,
      endTime.value,
    );
    turnDetails[traceId] = td;
  } catch (e: any) {
    console.error("Turn detail fetch error:", e?.raw ?? e);
    // Surface as an empty turn so the user sees the block instead of a
    // forever-spinning loader — they can still inspect the trace.
    turnDetails[traceId] = {
      traceId,
      userMessage: null,
      assistantMessage: null,
      model: null,
    };
  } finally {
    turnDetailLoading[traceId] = false;
  }
}

async function load() {
  if (!sessionId.value || !streamName.value) {
    error.value = "Missing session id or stream in URL";
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const result = await fetchSession(
      streamName.value,
      sessionId.value,
      startTime.value,
      endTime.value,
    );
    detail.value = result.detail;
    traces.value = result.traces;
  } catch (e: any) {
    error.value = e?.message || "Failed to load session";
    // Log both the parsed message and the raw envelope so we can see
    // DataFusion's actual complaint (e.g. unknown column, bad GROUP BY)
    // instead of the generic wrapper.
    console.error(
      "Session details fetch error:",
      e?.message,
      e?.raw?.content ?? e?.raw ?? e,
    );
  } finally {
    loading.value = false;
  }
}

function goBack() {
  router.push({
    name: "traces",
    query: {
      tab: "sessions",
      stream: streamName.value,
      org_identifier: store.state.selectedOrganization?.identifier,
    },
  });
}

function openTrace(traceId: string) {
  router.push({
    name: "traceDetails",
    query: {
      stream: streamName.value,
      trace_id: traceId,
      from: startTime.value,
      to: endTime.value,
      org_identifier: store.state.selectedOrganization?.identifier,
    },
  });
}

function openInTraceExplorer() {
  // The traces page is kept-alive — its onMounted/query-param parser
  // doesn't re-run on a regular route change, so a `tab=traces`
  // query param alone wouldn't update `searchMode` (it'd stay on
  // `"sessions"`, where we came from). Set it directly here so the
  // page picks up the Traces sub-tab synchronously.
  searchObj.meta.searchMode = "traces";

  // Match the traces page's URL contract:
  //   query → base64-encoded `session_id='<id>'` (no spaces, single
  //           quotes). `b64EncodeUnicode` produces the `.`-padded
  //           URL-safe form the traces page expects.
  //   from / to → absolute window we were navigated with — preserves
  //           the exact time scope of the session.
  const encodedQuery =
    b64EncodeUnicode(`session_id='${sessionId.value}'`) ?? "";
  router.push({
    name: "traces",
    query: {
      stream: streamName.value,
      from: startTime.value,
      to: endTime.value,
      query: encodedQuery,
      org_identifier: store.state.selectedOrganization?.identifier,
    },
  });
}

function copySessionId() {
  if (!detail.value) return;
  copyText(detail.value.sessionId);
}

function copyText(text: string | null | undefined) {
  if (!text) return;
  copyToClipboard(text).then(() => {
    $q.notify({ message: "Copied", position: "top", timeout: 1000 });
  });
}

function formatTimestamp(micros: number): string {
  if (!micros) return "—";
  return date.formatDate(Math.floor(micros / 1000), "YYYY-MM-DD HH:mm:ss");
}

function shortId(id: string): string {
  if (!id) return "—";
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-5)}`;
}

function formatDuration(nanos: number): string {
  if (!nanos) return "—";
  const d = splitDuration(nanos / 1000);
  return `${d.value}${d.unit}`;
}

function formatTokens(n: number): string {
  if (!n) return "0";
  const t = splitNumberWithUnit(n);
  return `${t.value}${t.unit}`;
}

function userInitials(userId: string): string {
  const name = userId.split("@")[0] || userId;
  const parts = name.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name[0] + (name[1] || "")).toUpperCase();
}

function userAvatarColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h << 5) - h + userId.charCodeAt(i);
    h |= 0;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

function statusBadgeClass(s: SessionTraceRow["status"]): string {
  switch (s) {
    case "error":
      return "tw:bg-[color-mix(in_srgb,var(--o2-service-health-critical)_12%,transparent)] tw:text-[var(--o2-service-health-critical)]";
    case "warn":
      return "tw:bg-[color-mix(in_srgb,var(--o2-service-health-warning)_12%,transparent)] tw:text-[var(--o2-service-health-warning)]";
    default:
      return "tw:bg-[color-mix(in_srgb,var(--o2-service-health-healthy,#16a34a)_12%,transparent)] tw:text-[var(--o2-service-health-healthy,#16a34a)]";
  }
}

onMounted(load);
</script>

<style lang="scss" scoped>
.session-details {
  background: var(--o2-card-bg-solid);
}

.kpi-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.kpi-cell {
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
  padding: 0.625rem 0.75rem;
}

.kpi-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--o2-text-muted);
  margin-bottom: 0.25rem;
}

.kpi-value {
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--o2-text-primary);
}

.turn-card {
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
  background: var(--o2-card-bg);
  overflow: hidden;
  transition: border-color 0.15s ease;

  &--error {
    border-color: var(--o2-service-health-critical);
  }
}

.turn-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;

  &:hover {
    background: var(--o2-row-hover-bg, rgba(0, 0, 0, 0.03));
  }
}

.turn-body {
  border-top: 1px solid var(--o2-border-color);
  padding: 0.75rem;
  background: var(--o2-card-bg-solid);
}

// Two-column grid: messages on the left, stats on the right.
// `align-items: stretch` (flex default) makes the messages column
// match the stats column's natural height so the user-25 / assistant-75
// split has a real height to divide. `min-height: 0` on flex children
// is required for nested overflow scrolling to actually clip.
.turn-grid {
  display: flex;
  gap: 0.75rem;
  align-items: stretch;
  // Fixed cap so the expanded body doesn't push the next turn off
  // screen on very long messages — the stats column is short and the
  // messages column would otherwise grow with content.
  max-height: 28rem;
}

.turn-messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
}

.msg-block {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
  background: var(--o2-card-bg);
  overflow: hidden;
  min-height: 0;

  &--user {
    border-color: color-mix(in srgb, #0ea5e9 35%, transparent);
    flex: 25 1 0;
  }

  &--assistant {
    border-color: color-mix(in srgb, #16a34a 35%, transparent);
    flex: 75 1 0;
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.375rem 0.625rem;
    border-bottom: 1px solid var(--o2-border-color);
    background: var(--o2-card-bg-solid);
    flex-shrink: 0;
  }

  &__role {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--o2-text-primary);
  }

  &__body {
    padding: 0.625rem 0.75rem;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--o2-text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
}

.turn-stats {
  width: 13rem;
  flex-shrink: 0;
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
  background: var(--o2-card-bg);
  padding: 0.5rem 0.625rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.stat-section + .stat-section {
  padding-top: 0.5rem;
  border-top: 1px solid var(--o2-border-color);
}

.stat-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--o2-text-muted);
  margin-bottom: 0.25rem;
}

.stat-value {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--o2-text-primary);
  display: flex;
  align-items: center;
}

.stat-rows {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--o2-text-muted);

  &--total {
    color: var(--o2-text-primary);
    font-weight: 600;
    border-top: 1px dashed var(--o2-border-color);
    padding-top: 0.125rem;
    margin-top: 0.125rem;
  }
}
</style>
