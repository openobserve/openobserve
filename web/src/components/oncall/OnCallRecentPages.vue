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
  The last few pages this team was woken by.

  A short list, not a table: the team page is opened to learn whether the team is
  answering, and five sortable columns made a reader parse a grid to find out.
  Each row keeps the two facts that carry that answer — who picked it up and how
  long it took — and says nothing when the answer is the unremarkable one. The
  full history, with its columns and its filters, is one click away in On-Call.
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

    <div v-if="loading" class="flex flex-col" data-test="oncall-recent-pages-loading">
      <div v-for="row in limit" :key="row" class="border-border-subtle border-t px-4 py-3">
        <OSkeleton type="text" class="w-1/3" />
      </div>
    </div>

    <div
      v-else-if="!rows.length"
      class="border-border-subtle border-t"
      data-test="oncall-recent-pages-empty"
    >
      <OEmptyState preset="no-oncall-responses" hide-action />
    </div>

    <button
      v-for="row in rows"
      v-else
      :key="row.page.id"
      type="button"
      class="border-border-subtle hover:bg-surface-subtle flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 text-start"
      :data-test="`oncall-recent-pages-row-${row.page.id}`"
      @click="emit('open', row.page)"
    >
      <span class="flex min-w-0 shrink items-center gap-2">
        <OCodeCell :value="row.title" :copy="false" />
        <!-- Only the two outcomes worth a second look are labelled: a page
             answered by the first person it woke is the norm, and tagging the
             norm is what made this list unreadable. -->
        <OTag v-if="row.neverAcked" variant="error-soft" size="sm">
          {{ t("oncall.teamNeverAcked") }}
        </OTag>
        <OTag v-else-if="row.escalated" variant="amber-soft" size="sm">
          {{ t("oncall.escalate") }}
        </OTag>
      </span>

      <span class="ms-auto flex shrink-0 items-center gap-3">
        <span v-if="row.answered" class="text-text-secondary text-xs">{{ row.answered }}</span>
        <OTimeCell :value="row.page.opened_at" unit="us" />
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OCodeCell from "@/lib/core/Table/cells/OCodeCell.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
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

interface Row {
  page: OnCallResponse;
  title: string;
  neverAcked: boolean;
  escalated: boolean;
  /** "acked by mei.tanaka · 7m", or empty when nobody answered. */
  answered: I18nText | "";
}

const rows = computed<Row[]>(() =>
  [...props.pages]
    .sort((a, b) => b.opened_at - a.opened_at)
    .slice(0, props.limit)
    .map((page) => {
      const took = page.acked_at ? page.acked_at - page.opened_at : null;
      const after = secondRungDelay(page);
      return {
        page,
        title: page.title || page.subject.source_id,
        neverAcked: !page.acked_by,
        escalated: took !== null && after !== null && took >= after,
        answered:
          page.acked_by && took !== null
            ? t("oncall.teamAckedByIn", {
                who: raw(page.acked_by),
                took: raw(formatMicrosDuration(took)),
              })
            : "",
      };
    }),
);

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
