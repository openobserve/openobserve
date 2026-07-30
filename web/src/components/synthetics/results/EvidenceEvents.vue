<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  EvidenceEvents — Thin OTable wrapper for evidence bundle rows.

  Two modes:
    inline — inside a step expansion: no step column (the step IS the context),
             no pagination, shrink to content
    panel  — the run-level Evidence tab: step column, virtual scroll

  One row definition for both surfaces, so a change to a row is a change to
  both. This component owns the OTable configuration and renders cell content
  through OTable cell slots; ranking, capping, fetching and filtering stay with
  the callers.
-->

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import OTable from "@/lib/core/Table/OTable.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { EvidenceEvent } from "@/composables/synthetics/syntheticResultsSchema";

const props = withDefaults(
  defineProps<{
    events: EvidenceEvent[];
    mode: "inline" | "panel";
    /** Panel only — the list HAS events but the current filter matched none. */
    filtered?: boolean;
  }>(),
  { filtered: false },
);

const emit = defineEmits<{ (e: "clear-filters"): void }>();

const { t } = useI18n();

/** OTable needs a stable row key; a bundle line has no id of its own. */
interface EvidenceRow extends EvidenceEvent {
  id: string;
}

const rows = computed<EvidenceRow[]>(() =>
  props.events.map((e, i) => ({ ...e, id: `${e.kind}-${e.initiatedTs ?? e.ts}-${i}` })),
);

const isPanel = computed(() => props.mode === "panel");

const columns = computed<OTableColumnDef<EvidenceRow>[]>(() => [
  { id: "status", header: "", size: 48 },
  { id: "method", header: "", size: 64 },
  { id: "message", header: "", size: 200, meta: { autoWidth: true } },
  ...(isPanel.value ? [{ id: "step", header: "", size: 160 }] : []),
  { id: "duration", header: "", size: 64 },
]);

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
    ? `${label}\ninitiated ${e.initiatedTs} · observed ${e.ts}`
    : label;
}
</script>

<template>
  <OTable
    :data="rows"
    :columns="columns"
    row-key="id"
    :show-header="false"
    :pagination="'none'"
    :sorting="'none'"
    :show-global-filter="false"
    :dense="true"
    :bordered="true"
    :default-columns="false"
    :fill-height="false"
    :frame="false"
    :virtual-scroll="isPanel"
    data-test="synthetics-evidence-events"
  >
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
        <span class="text-text-body min-w-0 flex-1 truncate font-mono text-xs">
          {{ shortUrl(row.url) || row.text || row.message || row.kind }}
        </span>
      </div>
    </template>

    <template v-if="isPanel" #cell-step="{ row }">
      <span
        class="text-text-secondary truncate text-xs"
        :title="row.stepName ?? ''"
        data-test="synthetics-evidence-events-step"
      >
        {{ row.stepName ?? t("synthetics.evidence.unattributed") }}
      </span>
    </template>

    <template #cell-duration="{ row }">
      <span class="text-text-secondary text-right font-mono text-xs">
        {{ row.durationMs != null ? `${row.durationMs}ms` : "" }}
      </span>
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
