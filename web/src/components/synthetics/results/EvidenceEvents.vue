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
  EvidenceEvents — Thin OTable wrapper for evidence bundle rows.

  Two modes:
    inline — a step's own evidence, inside its step expansion: no step column
             (the step IS the context), and a shorter page
    panel  — the run-level Evidence tab: every step's events, so the step is a
             column, and a longer page

  Everything else — header, sorting, row expansion, wrap, pagination — is the
  same on both. It was not, and the difference was a cap the inline surface no
  longer has: five ranked rows needed no header and had nothing to page.

  One row definition for both surfaces, so a change to a row is a change to
  both. This component owns the OTable configuration and renders cell content
  through OTable cell slots; ranking, capping, fetching and filtering stay with
  the callers.

  Panel mode pages CLIENT-side rather than virtual-scrolling. The whole bundle is
  already in memory — it arrives as one NDJSON fetch, so there is no page to ask
  the backend for — and a group section can hold 136 rows inside a panel that is
  itself scrolling. Nesting a virtual scroller in that made the section's own
  scrollbar fight the page's; pages bound the section's height instead.
-->

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";

import OTable from "@/lib/core/Table/OTable.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EvidenceEventDetail from "./EvidenceEventDetail.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import {
  evidenceGroupKind,
  evidenceOriginTs,
  evidenceSeverity,
  type EvidenceEvent,
  type EvidenceGroup,
} from "@/composables/synthetics/syntheticResultsSchema";

const props = withDefaults(
  defineProps<{
    events: EvidenceEvent[];
    mode: "inline" | "panel";
    /** Panel only — the list HAS events but the current filter matched none. */
    filtered?: boolean;
    /**
     * Epoch ms the elapsed column counts from — normally the attempt's first
     * event, so every section of the panel shares one zero.
     *
     * Omitted, each table zeroes on its OWN earliest row. That is right for a
     * step expansion, where the question is "what happened during this step",
     * and wrong for the panel, where two sections zeroed independently would
     * put a 200 at +0ms next to the 503 that preceded it.
     */
    originTs?: number | null;
    /**
     * Long URLs and console messages wrap instead of truncating. Available on
     * both surfaces — the panel and the step card — now that the card renders
     * this same paged table rather than five short rows.
     */
    wrap?: boolean;
  }>(),
  { filtered: false, originTs: null, wrap: false },
);

const emit = defineEmits<{ (e: "clear-filters"): void }>();

const { t } = useI18nTyped();

/** OTable needs a stable row key; a bundle line has no id of its own. */
interface EvidenceRow extends EvidenceEvent {
  id: string;
}

const rows = computed<EvidenceRow[]>(() =>
  props.events.map((e, i) => ({ ...e, id: `${e.kind}-${e.initiatedTs ?? e.ts}-${i}` })),
);

const isPanel = computed(() => props.mode === "panel");

/**
 * Multiple, not single: the question an expanded row answers is usually
 * comparative — did the 503 that opened here carry the same step id as the
 * page error below it — and single-expansion closes the first answer to show
 * the second.
 */
const expandedIds = ref<string[]>([]);

/**
 * `accessorFn` on elapsed/type because neither is a field on the row — without
 * it the sorter reads `row.elapsed`, finds undefined, and silently orders by
 * nothing.
 */
const columns = computed<OTableColumnDef<EvidenceRow>[]>(() => [
  {
    id: "elapsed",
    header: t("synthetics.evidence.colTime"),
    size: 80,
    sortable: true,
    accessorFn: (row: EvidenceRow) => eventTs(row),
  },
  {
    id: "type",
    header: t("synthetics.evidence.colType"),
    size: 96,
    sortable: true,
    accessorFn: (row: EvidenceRow) => kindLabel(row),
  },
  { id: "status", header: t("synthetics.evidence.colStatus"), size: 80, sortable: true },
  { id: "method", header: t("synthetics.evidence.colMethod"), size: 64 },
  {
    id: "message",
    header: t("synthetics.evidence.colMessage"),
    size: 200,
    // Bounded elastic: absorbs the leftover and ellipsises, so the table fits
    // its container and only the FIXED columns can force a horizontal scroll.
    meta: { autoWidth: true, fillRemaining: true },
  },
  ...(isPanel.value
    ? [
        {
          id: "step",
          header: t("synthetics.evidence.colStep"),
          size: 240,
          sortable: true,
          accessorFn: (row: EvidenceRow) => row.stepName ?? "",
        },
      ]
    : []),
  {
    id: "duration",
    header: t("synthetics.evidence.colDuration"),
    size: 80,
    sortable: true,
    accessorKey: "durationMs",
    // Right-aligned on the COLUMN: a `text-right` class on the cell's inline
    // span does nothing, which is why these read ragged.
    meta: { align: "right" },
  },
]);

/**
 * What kind of thing this row is — category, never severity.
 *
 * Deliberately NOT coloured: `network` holds both a 503 and a healthy 200, so
 * the kind cannot carry how bad a row is without being wrong on one of them.
 * Severity is the left rail and the coloured status, which every row already
 * has (design §4 D3).
 */
const KIND_LABEL: Record<EvidenceGroup["kind"], string> = {
  pageErrors: "synthetics.evidence.kindPageError",
  requestsFailed: "synthetics.evidence.kindRequestFailed",
  console: "synthetics.evidence.kindConsole",
  network: "synthetics.evidence.kindNetwork",
};

function kindLabel(e: EvidenceEvent): string {
  return t(KIND_LABEL[evidenceGroupKind(e)]);
}

function eventTs(e: EvidenceEvent): number {
  return e.initiatedTs ?? e.ts;
}

const origin = computed(() => props.originTs ?? evidenceOriginTs(props.events) ?? 0);

/**
 * How far into the attempt this happened — the reading DevTools' waterfall
 * gives, and the one that answers "did the 503 land before the click timed out".
 * A wall-clock time would say the same thing on every row of a run that took
 * four seconds, and "2 months ago" says it about the whole bundle at once.
 */
function elapsedText(e: EvidenceEvent): string {
  const ms = Math.max(0, eventTs(e) - origin.value);
  return ms >= 1000 ? `+${(ms / 1000).toFixed(1)}s` : `+${ms}ms`;
}

/** The absolute instant is kept, one hover away, rather than traded for the offset. */
function elapsedTitle(e: EvidenceEvent): string {
  return new Date(eventTs(e)).toLocaleString();
}

/**
 * A 4px rail on rows that deserve one, and none on the rest.
 *
 * Drawn from the shared severity ladder rather than a fourth local classifier,
 * so the rail can never disagree with the ordering the fold already applied.
 * Only exceptions get colour — a rail on every row of an all-200 bundle is
 * decoration, and the point is that the two anomalies are findable at a glance.
 */
function rowStatusColor(row: EvidenceRow): string | undefined {
  const rank = evidenceSeverity(row);
  if (rank <= 4) return "var(--color-status-error-text)";
  if (rank === 5) return "var(--color-status-warning-text)";
  return undefined;
}

/** Truncate from the LEFT: the host repeats on every row, the path is what differs. */
function shortUrl(url: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? u.search : "");
  } catch {
    return url.length > 70 ? `…${url.slice(-70)}` : url;
  }
}

function statusClass(e: EvidenceEvent): string {
  if (e.kind === "requestfailed" || e.kind === "crash" || e.kind === "pageerror")
    return "text-status-error-text";
  if (e.kind === "console")
    return e.level === "error" ? "text-status-error-text" : "text-text-secondary";
  const s = e.status ?? 0;
  if (s >= 500) return "text-status-error-text";
  if (s >= 400) return "text-status-warning-text";
  if (s >= 300) return "text-text-secondary";
  return "text-text-body";
}

function statusText(e: EvidenceEvent): string {
  if (e.kind === "response") return String(e.status ?? "—");
  if (e.kind === "requestfailed") return "—";
  return "";
}

/** Both timestamps, so bucketing ambiguity is visible rather than silently wrong. */
function rowTitle(e: EvidenceEvent): string {
  const label = e.url ?? e.text ?? e.message ?? e.kind;
  return e.initiatedTs != null && e.initiatedTs !== e.ts
    ? t("synthetics.evidence.rowTitleWithTimestamps", {
        label,
        initiated: e.initiatedTs,
        observed: e.ts,
      })
    : label;
}
</script>

<template>
  <OTable
    :data="rows"
    :columns="columns"
    row-key="id"
    show-header
    pagination="client"
    :page-size="isPanel ? 20 : 10"
    sorting="client"
    :show-global-filter="false"
    :dense="true"
    :wrap="wrap"
    :bordered="true"
    :default-columns="false"
    :fill-height="false"
    :frame="false"
    :get-row-status-color="rowStatusColor"
    expansion="multiple"
    horizontal-scroll
    :expanded-ids="expandedIds"
    @update:expandedIds="(ids: string[]) => (expandedIds = ids)"
    :footer-title="t('synthetics.evidence.footerEvents')"
    data-test="synthetics-evidence-events"
  >
    <!-- First column, because it is the axis every other cell is read against:
         the reader is reconstructing an order of events, not looking up a
         timestamp. -->
    <template #cell-elapsed="{ row }">
      <span
        class="text-text-secondary font-mono text-xs"
        :title="elapsedTitle(row)"
        data-test="synthetics-evidence-events-elapsed"
      >
        {{ elapsedText(row) }}
      </span>
    </template>

    <!-- Category, not severity — see KIND_LABEL. One neutral variant for all four
         kinds, so the badge never contradicts the rail beside it. -->
    <template #cell-type="{ row }">
      <OBadge variant="default-soft" size="sm" data-test="synthetics-evidence-events-type">
        {{ kindLabel(row) }}
      </OBadge>
    </template>

    <template #cell-status="{ row }">
      <span
        class="font-mono text-xs"
        :class="statusClass(row)"
        data-test="synthetics-evidence-events-status"
      >
        {{ statusText(row) }}
      </span>
    </template>

    <template #cell-method="{ row }">
      <span class="text-text-secondary font-mono text-xs">
        {{ row.method ?? row.level ?? "" }}
      </span>
    </template>

    <template #cell-message="{ row }">
      <div
        class="flex min-w-0 items-center gap-2"
        :class="row.firstParty ? '' : 'opacity-60'"
        :title="rowTitle(row)"
        data-test="synthetics-evidence-events-row"
      >
        <OIcon
          v-if="row.kind === 'pageerror' || row.kind === 'crash'"
          name="error"
          size="xs"
          class="text-status-error-text shrink-0"
          aria-hidden="true"
        />
        <span
          class="text-text-body min-w-0 flex-1 font-mono text-xs"
          :class="wrap ? 'break-all whitespace-normal' : 'truncate'"
          data-test="synthetics-evidence-events-message"
        >
          {{ shortUrl(row.url) || row.text || row.message || row.kind }}
        </span>
      </div>
    </template>

    <template v-if="isPanel" #cell-step="{ row }">
      <span
        class="text-text-secondary text-xs"
        :class="wrap ? 'break-all whitespace-normal' : 'truncate'"
        :title="row.stepName ?? ''"
        data-test="synthetics-evidence-events-step"
      >
        {{ row.stepName ?? t("synthetics.evidence.unattributed") }}
      </span>
    </template>

    <template #cell-duration="{ row }">
      <span class="text-text-secondary font-mono text-xs">
        {{ row.durationMs != null ? `${row.durationMs}ms` : "" }}
      </span>
    </template>

    <template #expansion="{ row }">
      <EvidenceEventDetail :event="row" />
    </template>

    <template #empty>
      <OEmptyState
        size="inline"
        icon="search"
        :filtered="filtered"
        :title="t('synthetics.evidence.noEvents')"
        data-test="synthetics-evidence-events-empty"
        @action="(id?: string) => id === 'clear-filters' && emit('clear-filters')"
      />
    </template>
  </OTable>
</template>
