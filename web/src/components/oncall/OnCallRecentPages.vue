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
  The last few pages this team was woken by, in the same OTable every other
  on-call list uses — capped to `limit` and static (no sort/filter/pagination
  chrome), since the full sortable history is one click away in On-Call.
-->
<template>
  <div
    class="card-container rounded-surface bg-surface-base border-border-default overflow-hidden border"
    data-test="oncall-recent-pages"
  >
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3">
      <OText variant="panel-title">{{ t("oncall.teamRecentPages") }}</OText>
      <!-- Suppressed mid-fetch: "0 in the last 7 days" under a skeleton is an
           answer, and it is the wrong one. -->
      <OText v-if="!loading" variant="meta" data-test="oncall-recent-pages-window">
        {{ windowLabel }}
      </OText>
      <OButton
        variant="ghost-primary"
        size="xs"
        class="ms-auto"
        data-test="oncall-recent-pages-view-all"
        @click="emit('view-all')"
      >
        {{ t("oncall.teamOpenInOnCall") }}
      </OButton>
    </div>

    <OTable
      :data="rows"
      :columns="columns"
      row-key="id"
      :frame="false"
      :loading="loading"
      pagination="none"
      :show-global-filter="false"
      table-id="oncall-recent-pages"
      data-test="oncall-recent-pages-table"
      @row-click="(row: OnCallResponse) => emit('open', row)"
    >
      <template #cell-subject="{ row }">
        <span class="flex min-w-0 items-center gap-2">
          <OCodeCell :value="row.title || row.subject.source_id" :copy="false" />
          <!-- Only the two outcomes worth a second look are labelled: a page
               answered by the first person it woke is the norm, and tagging the
               norm is what made this list unreadable. -->
          <OTag v-if="!row.acked_by" variant="error-soft" size="sm">
            {{ t("oncall.teamNeverAcked") }}
          </OTag>
          <OTag v-else-if="isEscalated(row)" variant="amber-soft" size="sm">
            {{ t("oncall.escalate") }}
          </OTag>
        </span>
      </template>

      <template #cell-responder="{ row }">
        <span v-if="row.acked_by && row.acked_at" class="text-text-secondary text-sm">
          {{
            t("oncall.teamAckedByIn", {
              who: raw(row.acked_by),
              took: raw(formatMicrosDuration(row.acked_at - row.opened_at)),
            })
          }}
        </span>
        <span v-else class="text-text-secondary text-sm">{{ t("oncall.neverAcknowledged") }}</span>
      </template>

      <template #cell-opened_at="{ value }">
        <OTimeCell :value="value" unit="us" />
      </template>

      <template #empty>
        <OEmptyState preset="no-oncall-responses" size="inline" hide-action />
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OCodeCell from "@/lib/core/Table/cells/OCodeCell.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { OnCallPolicy, OnCallResponse } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    /** Pages inside the window, newest first is not assumed — this sorts. */
    pages?: OnCallResponse[];
    /**
     * The ladder, so a row can say whether a page ran past its first responder.
     * Read from the policy rather than per-record, which needs no extra request.
     */
    policy?: OnCallPolicy | null;
    /** How many days the window covers — the header states it. */
    windowDays?: number;
    /** How many rows to show before deferring to the full list. */
    limit?: number;
    loading?: boolean;
  }>(),
  { pages: () => [], policy: null, windowDays: 7, limit: 3, loading: false },
);

const emit = defineEmits<{ open: [page: OnCallResponse]; "view-all": [] }>();

const { t } = useI18nTyped();

/// The delay before this record's ladder would have woken a SECOND person.
function secondRungDelay(page: OnCallResponse): number | null {
  const steps = props.policy?.rungs.find((rung) => rung.priority === page.priority)?.steps;
  if (!steps || steps.length < 2) return null;
  return [...steps].sort((a, b) => a.after_micros - b.after_micros)[1].after_micros;
}

function isEscalated(page: OnCallResponse): boolean {
  if (!page.acked_by || !page.acked_at) return false;
  const after = secondRungDelay(page);
  return after !== null && page.acked_at - page.opened_at >= after;
}

const rows = computed<OnCallResponse[]>(() =>
  [...props.pages].sort((a, b) => b.opened_at - a.opened_at).slice(0, props.limit),
);

const columns = computed<OTableColumnDef<OnCallResponse>[]>(() => [
  {
    id: "subject",
    header: t("oncall.subjectColumn"),
    accessorFn: (page: OnCallResponse) => page.title || page.subject.source_id,
    meta: { isName: true, flex: true },
  },
  {
    id: "responder",
    header: t("oncall.responder"),
    accessorFn: (page: OnCallResponse) => page.acked_by ?? "",
    size: 260,
  },
  {
    id: "opened_at",
    header: t("oncall.openedAt"),
    accessorKey: "opened_at",
    size: 160,
  },
]);

/// "3 of 6 in the last 7 days" — a truncated list that does not say it is
/// truncated reads as the whole history of the team.
const windowLabel = computed<I18nText>(() =>
  props.pages.length > rows.value.length
    ? t("oncall.teamRecentPagesWindowOf", {
        shown: rows.value.length,
        total: props.pages.length,
        days: props.windowDays,
      })
    : t("oncall.teamRecentPagesWindow", { count: props.pages.length, days: props.windowDays }),
);
</script>
