<!--
  Copyright 2026 OpenObserve Inc.

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
    side="right"
    :width="55"
    :title="title"
    data-test="agent-signal-detail-panel"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <!-- Signal-type icon in the drawer header, so the drawer's subject reads at
         a glance (⟳ loop / ⚠ failure / $ cost). -->
    <template #header-left>
      <div class="flex items-center justify-center h-7 w-7 rounded-default" :class="signalIconWrap">
        <OIcon :name="signalIcon" size="sm" />
      </div>
    </template>

    <section
      class="flex flex-col gap-3 px-5 pt-4 pb-6 min-h-full overflow-auto"
      data-test="agent-signal-detail-body"
    >
      <!-- Headline: the finding, stated plainly -->
      <div class="flex items-start gap-2" data-test="agent-signal-detail-headline">
        <OIcon :name="signalIcon" size="sm" class="mt-0.5 shrink-0" :class="signalIconColor" />
        <div class="flex flex-col gap-1">
          <p class="m-0 text-compact leading-normal text-text-heading">
            {{ headline }}
          </p>
          <p class="m-0 text-2xs leading-normal text-text-secondary">
            {{ explanation }}
          </p>
        </div>
      </div>

      <!-- FAILURE: the real error messages (the "read it, know the fix" section) -->
      <section
        v-if="signalType === 'failure'"
        class="card-container py-3 px-3.5 pb-3.5 bg-surface-base border border-border-default rounded-surface"
      >
        <header class="mb-1.5 flex items-center gap-1.5">
          <OIcon name="error-outline" size="xs" class="text-badge-error-soft-text" />
          <h4 class="m-0 text-compact font-semibold text-text-heading">
            {{ t("aiObservability.behavior.detail.errorsTitle") }}
          </h4>
        </header>
        <OTable
          data-test="agent-signal-detail-errors"
          :data="errorRows"
          :columns="errorColumns"
          :default-columns="false"
          :frame="false"
          wrap
        >
          <!-- Show the condensed one-liner; reveal the full raw error on demand
               so the table stays scannable but nothing is lost. -->
          <template #cell-message="{ row }">
            <div class="flex flex-col gap-1 py-0.5">
              <span
                class="text-xs leading-normal text-text-heading whitespace-pre-wrap break-words"
              >
                {{ expandedErrors.has(row.full) ? row.full : row.message }}
              </span>
              <OButton
                v-if="row.full && row.full !== row.message"
                variant="ghost-primary"
                size="chip"
                class="self-start"
                data-test="agent-signal-detail-toggle-error-btn"
                @click.stop="toggleError(row.full)"
              >
                {{
                  expandedErrors.has(row.full)
                    ? t("aiObservability.behavior.detail.showLess")
                    : t("aiObservability.behavior.detail.showFull")
                }}
              </OButton>
            </div>
          </template>
        </OTable>
        <OEmptyState
          v-if="!loading && errorRows.length === 0"
          preset="no-data"
          :title="t('aiObservability.behavior.detail.noErrors')"
        />
      </section>

      <!-- LOOP / COST: the worst traces, ranked by what makes them bad -->
      <section
        class="card-container py-3 px-3.5 pb-3.5 bg-surface-base border border-border-default rounded-surface"
      >
        <header class="mb-1.5 flex items-center justify-between gap-2">
          <h4 class="m-0 text-compact font-semibold text-text-heading">
            {{ tracesTitle }}
          </h4>
          <span class="text-2xs text-text-secondary">
            {{ t("aiObservability.behavior.detail.tracesHint") }}
          </span>
        </header>
        <OTable
          data-test="agent-signal-detail-traces"
          :data="traceRows"
          :columns="traceColumns"
          :default-columns="false"
          :frame="false"
          pagination="client"
          :page-size="10"
          @row-click="openTrace"
        >
          <!-- Trace id renders with an "open in new tab" icon so it's clear the
               row opens the trace in a new browser tab, not in place. -->
          <template #cell-trace_id="{ row }">
            <span
              class="inline-flex items-center gap-1 text-text-link hover:underline"
              :title="t('aiObservability.behavior.detail.openInNewTab')"
            >
              <OIcon name="open-in-new" size="xs" class="opacity-70" />
              <span class="font-mono truncate">{{ row.trace_id }}</span>
            </span>
          </template>
        </OTable>
        <OEmptyState
          v-if="!loading && traceRows.length === 0"
          preset="no-data"
          :title="t('aiObservability.behavior.detail.noTraces')"
        />
      </section>
    </section>
  </ODrawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import searchService from "@/services/search";
import { escapeSingleQuotes } from "@/utils/queryUtils";

interface SignalRow {
  signalType: "loop" | "failure" | "cost";
  /** Display name (may be the "(unknown agent)" fallback). */
  agent?: string;
  /** Real agent value to query on; null when unresolved (drop the filter). */
  agentRaw?: string | null;
  tool?: string;
  failClass?: string;
  calls?: number;
  traces?: number;
  ratio?: number;
  count?: number;
  cost?: number;
  tokens?: number;
  errors?: number;
}

const props = defineProps<{
  open: boolean;
  row: SignalRow | null;
  sourceStream?: string;
  startTime?: number;
  endTime?: number;
}>();

const emit = defineEmits<{ (e: "update:open", v: boolean): void }>();

const { t } = useI18n();
const store = useStore();
const router = useRouter();

const errorRows = ref<
  Array<{
    message: string;
    full: string;
    occurrences: number;
    traces: number;
  }>
>([]);
const traceRows = ref<Array<Record<string, any>>>([]);
const loading = ref(false);
// Which error rows are expanded to their full raw text (keyed by the raw
// message — the OTable cell slot doesn't expose a row index).
const expandedErrors = ref<Set<string>>(new Set());
const toggleError = (key: string) => {
  const next = new Set(expandedErrors.value);
  next.has(key) ? next.delete(key) : next.add(key);
  expandedErrors.value = next;
};

const orgId = computed(() => store.state.selectedOrganization?.identifier as string);
const signalType = computed(() => props.row?.signalType);

// Signal-type iconography — a distinct icon + accent per drawer so the subject
// (looping / failing / costly) reads at a glance.
const signalIcon = computed(() => {
  if (signalType.value === "loop") return "autorenew";
  if (signalType.value === "cost") return "attach-money";
  return "warning"; // failure
});
const signalIconColor = computed(() => {
  if (signalType.value === "loop") return "text-badge-warning-soft-text";
  if (signalType.value === "cost") return "text-badge-primary-soft-text";
  return "text-badge-error-soft-text";
});
const signalIconWrap = computed(() => {
  if (signalType.value === "loop") return "bg-badge-warning-soft-bg text-badge-warning-soft-text";
  if (signalType.value === "cost") return "bg-badge-primary-soft-bg text-badge-primary-soft-text";
  return "bg-badge-error-soft-bg text-badge-error-soft-text";
});

const title = computed(() => {
  const r = props.row;
  if (!r) return t("aiObservability.behavior.detail.title");
  const agent = r.agent || t("aiObservability.behavior.unknownAgent");
  if (r.signalType === "loop") return `${agent} · ${r.tool ?? ""}`;
  if (r.signalType === "failure") return `${agent} · ${r.failClass ?? ""}`;
  return agent;
});

/** The finding, stated as a plain sentence a user can act on. */
const headline = computed(() => {
  const r = props.row;
  if (!r) return "";
  const agent = r.agent || t("aiObservability.behavior.unknownAgent");
  if (r.signalType === "loop") {
    return t("aiObservability.behavior.detail.loopHeadline", {
      agent,
      tool: r.tool ?? "",
      ratio: r.ratio ?? "?",
      calls: r.calls ?? "?",
      traces: r.traces ?? "?",
    });
  }
  if (r.signalType === "failure") {
    return t("aiObservability.behavior.detail.failHeadline", {
      agent,
      count: r.count ?? "?",
      cls: r.failClass ?? "",
    });
  }
  return t("aiObservability.behavior.detail.costHeadline", {
    agent,
    cost: r.cost ?? 0,
    tokens: r.tokens ?? 0,
    errors: r.errors ?? 0,
  });
});

const explanation = computed(() => {
  const r = props.row;
  if (!r) return "";
  if (r.signalType === "loop") return t("aiObservability.behavior.detail.loopExplain");
  if (r.signalType === "failure") return t("aiObservability.behavior.detail.failExplain");
  return t("aiObservability.behavior.detail.costExplain");
});

const tracesTitle = computed(() => {
  const r = props.row;
  if (r?.signalType === "loop") return t("aiObservability.behavior.detail.worstLoopTraces");
  if (r?.signalType === "cost") return t("aiObservability.behavior.detail.topCostTraces");
  return t("aiObservability.behavior.detail.tracesTitle");
});

// ── Error-message table (failure signals) ──────────────────────────────
const errorColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "message",
    header: t("aiObservability.behavior.detail.colError"),
    accessorKey: "message",
    // No autoWidth: let the message column take the remaining width and wrap
    // (paired with the table's `wrap`). `break-words` breaks long unbroken
    // strings (JSON blobs, URLs) so nothing is clipped or overflows.
    meta: {
      align: "left",
      cellClass: "whitespace-pre-wrap break-words align-top",
    },
  },
  {
    id: "occurrences",
    header: t("aiObservability.behavior.detail.colOccurrences"),
    accessorKey: "occurrences",
    meta: { align: "right" },
    sortable: true,
  },
  {
    id: "traces",
    header: t("aiObservability.behavior.colTraces"),
    accessorKey: "traces",
    meta: { align: "right" },
    sortable: true,
  },
]);

// ── Trace table — columns adapt to signal type so the value is visible ──
const traceColumns = computed<OTableColumnDef[]>(() => {
  const idCol: OTableColumnDef = {
    id: "trace_id",
    header: t("aiObservability.behavior.detail.colTraceId"),
    accessorKey: "trace_id",
    meta: { align: "left", autoWidth: true },
  };
  if (props.row?.signalType === "loop") {
    return [
      idCol,
      {
        id: "repeats",
        header: t("aiObservability.behavior.detail.colRepeats"),
        accessorKey: "repeats",
        meta: { align: "right" },
        sortable: true,
      },
    ];
  }
  if (props.row?.signalType === "cost") {
    return [
      idCol,
      {
        id: "cost",
        header: t("aiObservability.behavior.colCost"),
        accessorKey: "cost",
        meta: { align: "right" },
        sortable: true,
      },
      {
        id: "tokens",
        header: t("aiObservability.behavior.colTokens"),
        accessorKey: "tokens",
        meta: { align: "right" },
        sortable: true,
      },
    ];
  }
  return [
    idCol,
    {
      id: "spans",
      header: t("aiObservability.behavior.detail.colSpans"),
      accessorKey: "spans",
      meta: { align: "right" },
      sortable: true,
    },
  ];
});

// Depth of the parent-chain climb used to attribute a tool/error span to its
// OWNING agent. MUST match the backend rollup (processor.rs AGENT_INHERIT_DEPTH
// / sql.rs agent_coalesce): the agent name usually lives on an ANCESTOR span,
// not on the tool/error span itself, so a span-local `gen_ai_agent_name = …`
// filter matches NOTHING (this is why the drawer showed "no traces" while the
// rollup — which climbs — counted 394 calls). We must climb the same way.
const AGENT_INHERIT_DEPTH = 4;

/** The nearest-ancestor-agent-or-service expression, resolving `c`'s owning
 *  agent by climbing `reference_parent_span_id` up to AGENT_INHERIT_DEPTH,
 *  falling back to service_name. Mirrors sql.rs::agent_coalesce. */
const callerExpr = () => {
  const parts = ["c.gen_ai_agent_name"];
  for (let k = 1; k <= AGENT_INHERIT_DEPTH; k++) parts.push(`p${k}.gen_ai_agent_name`);
  parts.push("c.service_name");
  return `COALESCE(${parts.join(", ")})`;
};

/** The chained ancestor LEFT JOINs (p1 on c, p2 on p1, …), same trace. */
const ancestorJoins = (stream: string) => {
  const joins: string[] = [];
  for (let k = 1; k <= AGENT_INHERIT_DEPTH; k++) {
    const prev = k === 1 ? "c" : `p${k - 1}`;
    joins.push(
      `LEFT JOIN "${stream}" AS p${k} ON ${prev}.reference_parent_span_id = p${k}.span_id AND ${prev}.trace_id = p${k}.trace_id`,
    );
  }
  return joins.join(" ");
};

/** Agent-scoping predicate on the CLIMBED agent (not the span-local column). */
const agentClimbFilter = (agent?: string) =>
  agent ? `${callerExpr()} = '${escapeSingleQuotes(agent)}'` : "1=1";

/**
 * Condense a raw error string into a scannable one-liner. Framework errors are
 * often a short prefix followed by a large JSON blob (with request_ids etc.) —
 * unreadable in a table. We keep the meaningful gist: if the blob carries a
 * `"message":"…"`, surface that; always collapse whitespace and cap length.
 * The full text stays available via the row's expand toggle.
 */
const MAX_ERR_LEN = 160;
const condenseError = (raw: string): string => {
  if (!raw) return "";
  let s = String(raw).replace(/\s+/g, " ").trim();
  // Pull the human-facing message out of an embedded JSON error payload.
  const m = s.match(/"message"\s*:\s*"([^"]{3,})"/);
  if (m) {
    // Keep the leading error class (before the first "{") + the inner message.
    const prefix = s
      .split("{")[0]
      .replace(/[-:\s]+$/, "")
      .trim();
    s = prefix ? `${prefix} — ${m[1]}` : m[1];
  }
  if (s.length > MAX_ERR_LEN) s = s.slice(0, MAX_ERR_LEN).trimEnd() + "…";
  return s;
};

const runQuery = async (sql: string): Promise<any[]> => {
  if (!orgId.value) return [];
  const now = Date.now() * 1000;
  const start = props.startTime ?? now - 24 * 60 * 60 * 1_000_000;
  const end = props.endTime ?? now;
  try {
    const res = await searchService.search({
      org_identifier: orgId.value,
      query: {
        query: { sql, start_time: start, end_time: end, from: 0, size: 50 },
      },
      page_type: "traces",
    });
    return res.data?.hits ?? [];
  } catch {
    return [];
  }
};

const fetchDetails = async () => {
  const r = props.row;
  expandedErrors.value = new Set();
  if (!r || !props.sourceStream || !orgId.value) {
    errorRows.value = [];
    traceRows.value = [];
    return;
  }
  loading.value = true;
  const s = props.sourceStream;
  // Agent is resolved by climbing the parent chain — same as the rollup that
  // produced these counts. A span-local `gen_ai_agent_name =` filter would
  // match nothing because tool/error spans don't carry the agent name.
  const joins = ancestorJoins(s);
  // Use the RAW agent value (null when the rollup couldn't resolve one) — never
  // the "(unknown agent)" display string, which is not a real column value and
  // would filter everything out. Null → no agent filter (show all of the class).
  const af = agentClimbFilter(r.agentRaw ?? undefined);
  // The error detail can live in status_message OR error_message depending on
  // the framework — COALESCE so the message shows wherever it was populated
  // (mirrors the rollup's configurable error-detail-field coalescing).
  const detail = "COALESCE(NULLIF(c.status_message, ''), NULLIF(c.error_message, ''))";
  try {
    if (r.signalType === "failure") {
      // The real, grouped error messages behind this class — the actionable content.
      errorRows.value = (
        await runQuery(
          `SELECT ${detail} AS message, COUNT(*) AS occurrences, approx_distinct(c.trace_id) AS traces FROM "${s}" AS c ${joins} WHERE c.span_status = 'ERROR' AND ${af} AND ${detail} IS NOT NULL GROUP BY ${detail} ORDER BY occurrences DESC LIMIT 20`,
        )
      ).map((h: any) => ({
        // `message` is the condensed one-line gist (scannable); `full` is the
        // raw text, revealed on demand via the expand toggle.
        message: condenseError(h.message),
        full: h.message,
        occurrences: h.occurrences,
        traces: h.traces,
      }));
      traceRows.value = (
        await runQuery(
          `SELECT c.trace_id AS trace_id, COUNT(*) AS spans FROM "${s}" AS c ${joins} WHERE c.span_status = 'ERROR' AND ${af} GROUP BY c.trace_id ORDER BY spans DESC LIMIT 50`,
        )
      ).map((h: any) => ({ trace_id: h.trace_id, spans: h.spans }));
    } else if (r.signalType === "loop") {
      // Worst traces first — ranked by how many times the tool repeated.
      traceRows.value = (
        await runQuery(
          `SELECT c.trace_id AS trace_id, COUNT(*) AS repeats FROM "${s}" AS c ${joins} WHERE c.gen_ai_tool_name = '${escapeSingleQuotes(r.tool ?? "")}' AND c.gen_ai_operation_name = 'execute_tool' AND ${af} GROUP BY c.trace_id ORDER BY repeats DESC LIMIT 50`,
        )
      ).map((h: any) => ({ trace_id: h.trace_id, repeats: h.repeats }));
    } else {
      // Cost outliers — the traces driving this agent's spend.
      traceRows.value = (
        await runQuery(
          `SELECT c.trace_id AS trace_id, ROUND(SUM(c.gen_ai_usage_cost), 4) AS cost, SUM(c.gen_ai_usage_total_tokens) AS tokens FROM "${s}" AS c ${joins} WHERE ${af} AND c.gen_ai_usage_cost IS NOT NULL GROUP BY c.trace_id ORDER BY cost DESC LIMIT 50`,
        )
      ).map((h: any) => ({
        trace_id: h.trace_id,
        cost: h.cost,
        tokens: h.tokens,
      }));
    }
  } finally {
    loading.value = false;
  }
};

// Open the trace in a NEW tab so the drawer + Agent Behavior page stay put —
// the user is triaging a list and shouldn't lose their place. Same
// resolve → window.open pattern the Trace Details page uses (TraceDetails.vue).
//
// Trace Details looks the trace up within [from, to] (µs). If we forwarded an
// undefined/0 window (which happens when the page's relative window hasn't been
// resolved to absolute bounds yet) the lookup gets `from=NaN` and reports
// "trace not found". So we always send a concrete, containing window: the
// panel's own bounds when present, else a wide fallback (last 30 days). Trace
// Details re-derives the exact trace time from its spans, so a wide window is
// safe — it only needs to contain the trace.
const openTrace = (row: Record<string, any>) => {
  if (!row?.trace_id) return;
  const nowUs = Date.now() * 1000;
  // Guarantee a valid, containing µs window. Trace Details re-derives the exact
  // trace time from its spans, so a wide window is safe — it only needs to
  // contain the trace. (A 0/undefined bound here would reach Trace Details as
  // `from=NaN` and report "trace not found".) Params are sent as STRINGS, the
  // same shape the built-in "expand to full view" navigation uses.
  const fromUs =
    props.startTime && props.startTime > 0
      ? props.startTime
      : nowUs - 30 * 24 * 60 * 60 * 1_000_000;
  const toUs = props.endTime && props.endTime > 0 ? props.endTime : nowUs;
  const resolved = router.resolve({
    name: "traceDetails",
    query: {
      stream: props.sourceStream,
      trace_id: row.trace_id,
      from: String(fromUs),
      to: String(toUs),
      org_identifier: orgId.value,
    },
  });
  window.open(resolved.href, "_blank", "noopener,noreferrer");
};

watch(
  () => [props.open, props.row],
  () => {
    if (props.open && props.row) fetchDetails();
  },
);
</script>
