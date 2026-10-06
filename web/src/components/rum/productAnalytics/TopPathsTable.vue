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
  <OTable
    :data="tableRows"
    :columns="columns"
    :default-columns="false"
    row-key="id"
    pagination="none"
    sorting="none"
    :show-global-filter="false"
    :frame="false"
    data-test="rum-analytics-paths-top-table"
  >
    <template #cell-path="{ row, index }">
      <span :data-test="`rum-analytics-paths-top-row-${index}`">
        <KeySequence :keys="row.keys" :events="events" :max="8" />
      </span>
    </template>
    <template #cell-sessions="{ row, index }">
      <OButton
        variant="ghost-primary"
        size="xs"
        icon-right="chevron-right"
        aria-haspopup="dialog"
        class="tabular-nums"
        :aria-label="
          t(
            'rum.analytics.pathsView.openSessionsAria',
            { count: formatCount(row.sessions, sampled) },
            row.sessions,
          )
        "
        :data-test="`rum-analytics-paths-top-row-${index}-sessions-btn`"
        @click="emit('select', { type: 'tuple', tuple: row.tuple })"
        >{{
          t(
            "rum.analytics.paths.linkSessions",
            { count: formatCount(row.sessions, sampled) },
            row.sessions,
          )
        }}<OTooltip :content="t('rum.analytics.pathsView.openSessions')"
      /></OButton>
    </template>
    <template #cell-share="{ row }">
      <ODataBarCell
        :value="row.share * 100"
        :max="100"
        :display="`${(row.share * 100).toFixed(1)}%`"
      />
    </template>
  </OTable>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import KeySequence from "@/components/rum/productAnalytics/KeySequence.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { useI18nTyped } from "@/types/i18n";
import { formatCount, pathKeyLabel, type NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { SampleRatio, StepKind } from "@/utils/rum/productAnalyticsQueries";

interface TopRow {
  id: string;
  keys: { kind: StepKind | "exit" | "start" | "other"; key: string }[];
  tuple: (string | null)[];
  sessions: number;
  share: number;
}

const TOP_PATHS = 10;

const props = withDefaults(
  defineProps<{
    rows: Record<string, unknown>[];
    anchorSessions: number;
    depth: number;
    anchorKey: string;
    direction: "next" | "prev";
    events?: NamedEvent[];
    sampled?: SampleRatio;
  }>(),
  { events: () => [], sampled: 1 },
);
const emit = defineEmits<{ select: [{ type: "tuple"; tuple: (string | null)[] }] }>();
const { t } = useI18nTyped();

const asKey = (k: string) => ({
  kind: (k.startsWith("c:") ? "c" : k.startsWith("e:") ? "e" : "p") as StepKind,
  key: k.replace(/^[pce]:/, ""),
});

const tableRows = computed<TopRow[]>(() =>
  props.rows.slice(0, TOP_PATHS).map((r, i) => {
    const tuple = Array.from(
      { length: props.depth },
      (_, j) => (r[`s${j + 1}`] as string | null) ?? null,
    );
    const firstNull = tuple.indexOf(null);
    const steps = (firstNull === -1 ? tuple : tuple.slice(0, firstNull)) as string[];
    const endKind = props.direction === "next" ? ("exit" as const) : ("start" as const);
    const end =
      firstNull === -1 ? [] : [{ kind: endKind, key: pathKeyLabel({ kind: endKind, key: "" }) }];
    const path = [...(props.anchorKey ? [props.anchorKey] : []), ...steps].map(asKey);
    const keys = props.direction === "next" ? [...path, ...end] : [...end, ...path.reverse()];
    const sessions = Number(r.sessions) || 0;
    return {
      id: String(i),
      keys,
      tuple,
      sessions,
      share: props.anchorSessions > 0 ? sessions / props.anchorSessions : 0,
    };
  }),
);

const columns = computed<OTableColumnDef<TopRow>[]>(() => [
  {
    id: "path",
    header: t("rum.analytics.pathsView.fullPath"),
    size: 480,
    meta: { fillRemaining: true },
  },
  {
    id: "sessions",
    header: t("rum.analytics.columns.sessions"),
    accessorKey: "sessions",
    size: 150,
    meta: { align: "right" },
  },
  {
    id: "share",
    header: t("rum.analytics.pathsView.shareOfAnchor"),
    accessorKey: "share",
    size: 150,
    meta: { align: "right" },
  },
]);
</script>
