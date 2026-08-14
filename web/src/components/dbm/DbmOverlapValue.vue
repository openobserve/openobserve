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
  DbmOverlapValue — one of the two figures BOTH vantages can supply, rendered
  with the qualifier that makes it readable.

  Calls and database time exist in the trace feed and in the database's own
  counters. The database wins (it counts every client, traced or not), so the
  list column now quotes the server — and the moment it does, the generic
  column heading stops being sufficient on its own:

    • `exec_time_s` is EXECUTION time on Postgres and WAIT time on
      MySQL/MariaDB. Under a bare "Database time" heading a MySQL row's
      queueing figure reads as execution work, and the reader optimises a
      query that was only ever waiting.
    • The live list mixes engines in ONE table — postgresql, mysql and redis
      rows sit in the same column — so the distinction cannot be stated once
      in the header. It has to travel with the row.

  Hence a per-row marker rather than a header note. It is deliberately small
  and unobtrusive: it is a unit, not a finding, and a column of loud chips
  would compete with the numbers the reader is actually scanning. The header
  sub-label states the PROVENANCE ("server"/"client", constant per render);
  this marker states what the number IS ("wait"/"exec"/"observed").

  The invariant, enforced here rather than trusted to callers: a value with no
  qualifier does not render. There is no code path that puts an unqualified
  overlap number on screen — if the qualifier is missing the cell shows the
  absent dash, because a figure nobody can interpret is worse than a gap.
-->
<template>
  <span class="flex min-w-0 flex-col items-end leading-tight" :data-test="dataTest">
    <template v-if="renders">
      <span class="text-text-body font-mono text-xs tabular-nums">{{ value }}</span>
      <!-- The marker names the MEASUREMENT, and its tooltip spells the whole
           sentence out — the short form fits the column, the long form is what
           settles an argument about which number is being quoted. -->
      <span
        class="text-text-label text-3xs"
        :title="qualifierTitle"
        data-test="dbm-overlap-qualifier"
      >
        {{ qualifierLabel }}
      </span>
    </template>
    <!-- Absent, or unqualifiable. Never `0`: that is an all-clear nobody
         measured. -->
    <span v-else class="text-text-muted">{{ raw("—") }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { raw, useI18nTyped } from "@/types/i18n";
import type { DbmOverlapSource } from "@/utils/dbm/overlapMetrics";

const props = withDefaults(
  defineProps<{
    /** The already-formatted figure. `null` when neither vantage measured it. */
    value?: string | null;
    /** Which vantage supplied it. */
    source?: DbmOverlapSource | null;
    /**
     * The `dbm.list.overlap.*` key naming what this measurement IS. `null`
     * withholds the value — see the invariant above.
     */
    qualifierKey?: string | null;
    /** The engine that reported it, for the tooltip's attribution sentence. */
    engine?: string | null;
    dataTest?: string;
  }>(),
  {
    value: null,
    source: null,
    qualifierKey: null,
    engine: null,
    dataTest: undefined,
  },
);

const { t } = useI18nTyped();

/**
 * Both conditions, together: a figure AND something true to say about it.
 * Splitting these would let a caller render either half alone, which is the
 * two failure modes this component was built to make impossible.
 */
const renders = computed(() => props.value !== null && props.qualifierKey !== null);

const qualifierLabel = computed(() =>
  props.qualifierKey === null
    ? raw("")
    : t(`dbm.list.overlap.${props.qualifierKey}` as "dbm.list.overlap.serverWait"),
);

/**
 * The long form, on hover. Reuses the DETAIL page's sentences verbatim so the
 * list and the page it opens describe the same number in the same words —
 * which is the contradiction this whole change exists to remove.
 */
const qualifierTitle = computed(() =>
  props.qualifierKey === null
    ? undefined
    : String(
        t(`dbm.detail.overlap.${props.qualifierKey}` as "dbm.detail.overlap.serverWait", {
          engine: props.engine ?? "",
        }),
      ),
);
</script>
