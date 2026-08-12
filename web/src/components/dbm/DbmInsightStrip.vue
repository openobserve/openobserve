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
  DbmInsightStrip — cross-row framing on ONE horizontal line.

  The geometry IS the design. Cards cost ~40% of the viewport and pushed the
  table below the fold; a vertical stack of rows was better but still grew with
  the number of findings. This is one 34px row that SCROLLS SIDEWAYS instead of
  growing, so five insights cost exactly what three do — and the table keeps its
  space no matter how eventful the window was.

  What is NOT here is as load-bearing as what is:

    • No insight whose entire evidence is one row. That claim belongs ON the
      row, as a chip (NEW TO THIS LIST, 3× SLOWER THAN USUAL). Restating it
      here is the duplication that made the old cards read as noise — the
      screenshot review found the top card and the first table row carrying the
      same share, the same "new", the same call count.

    • No cause. Each insight carries its own arithmetic — `380 of 380`,
      `98ms → 304ms`, `#23 → #1` — because an insight without its evidence gets
      ignored, and one that claims to know WHY gets distrusted the first time
      it is wrong.

  Clicking one filters the table in place and drops an `insight:` chip in the
  toolbar, so the scope is always visible and always removable. An insight is
  never a dead end.
-->
<template>
  <div
    v-if="ranked.length"
    class="border-border-subtle bg-surface-base px-page-edge flex min-h-[2.125rem] items-stretch overflow-x-auto border-b"
    data-test="dbm-queries-insight-strip"
  >
    <button
      v-for="(insight, index) in ranked"
      :key="insight.id"
      type="button"
      class="border-border-subtle hover:bg-surface-subtle group flex shrink-0 cursor-pointer items-center gap-2 border-r px-2.5 py-1 text-left whitespace-nowrap"
      :class="[
        index === 0 ? 'pl-0' : '',
        activeId === insight.id ? 'bg-surface-accent-active' : '',
      ]"
      :data-test="`dbm-insight-${insight.id}`"
      @click="emit('filter', insight)"
    >
      <span
        class="rounded-default grid size-4.5 shrink-0 place-items-center"
        :class="TONES[insight.tone].chip"
      >
        <OIcon :name="TONES[insight.tone].icon" size="xs" />
      </span>

      <span class="flex items-baseline gap-1.5 leading-tight">
        <span class="text-text-heading text-xs font-semibold">{{ titleOf(insight) }}</span>
        <span class="text-text-secondary text-2xs">{{ sentenceOf(insight) }}</span>
      </span>

      <!-- The affordance appears on hover rather than standing permanently, so
           a strip of five does not read as five buttons. -->
      <span
        class="text-text-link text-2xs font-semibold opacity-0 transition-opacity group-hover:opacity-100"
        :class="activeId === insight.id ? 'opacity-100' : ''"
      >
        {{ affordanceOf(insight) }}
      </span>

      <!-- The rule, verbatim, one hover away. Provenance out of the primary
           reading path but never out of reach: an insight you cannot audit is
           one users learn to scroll past. -->
      <OTooltip side="bottom" :content="ruleOf(insight)" />
    </button>

    <div class="flex-1"></div>

    <div class="flex shrink-0 items-center pl-2">
      <OButton
        variant="ghost-muted"
        size="xs"
        data-test="dbm-queries-insight-hide"
        @click="emit('dismissAll')"
      >
        {{ t("dbm.insights.hide") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  insightRuleText,
  type DbmInsight,
  type DbmInsightBaseline,
  type DbmInsightId,
  type DbmInsightTone,
} from "@/utils/dbm/insights";
import { formatCount, formatNs, formatPercent, oneLine } from "@/utils/dbm/format";

const props = withDefaults(
  defineProps<{
    insights: DbmInsight[];
    /** The insight the table is currently filtered to. */
    activeId?: DbmInsightId | null;
    /**
     * The window these insights were computed AGAINST (W5). Named in every rule
     * line, because the same "3x slower" means different things against the
     * previous period and against yesterday.
     */
    baseline?: DbmInsightBaseline;
  }>(),
  { activeId: null, baseline: "previous" },
);

const emit = defineEmits<{
  (e: "filter", insight: DbmInsight): void;
  (e: "dismissAll"): void;
}>();

const { t } = useI18nTyped();

const TONES: Record<DbmInsightTone, { chip: string; icon: IconName }> = {
  error: { chip: "bg-badge-error-soft-bg text-badge-error-soft-text", icon: "error" },
  warning: { chip: "bg-badge-warning-soft-bg text-badge-warning-soft-text", icon: "trending-up" },
  info: { chip: "bg-badge-blue-soft-bg text-badge-blue-soft-text", icon: "insights" },
};

/**
 * Severity first, then impact. Share of database time is the number the page is
 * ranked by, so an insight about a 31%-of-database query outranks one about a
 * query that merely loops — the urgency hierarchy the card stack never had.
 */
const TONE_RANK: Record<DbmInsightTone, number> = { error: 0, warning: 1, info: 2 };

const ranked = computed(() =>
  [...props.insights].sort((a, b) => {
    const tone = TONE_RANK[a.tone] - TONE_RANK[b.tone];
    if (tone !== 0) return tone;
    return (b.evidence.share ?? 0) - (a.evidence.share ?? 0);
  }),
);

/** The service the claim is about — more useful in a strip than the SQL. */
const contextOf = (insight: DbmInsight) => {
  const row = insight.evidence.row;
  return row.service_name ?? row.services?.[0] ?? row.db_instance ?? "";
};

/** The offending statement, short enough to sit inside a one-line sentence. */
const QUERY_PREVIEW_LENGTH = 30;
const queryLabel = (insight: DbmInsight) => {
  const row = insight.evidence.row;
  const text = oneLine(row.query_norm);
  if (!text) return contextOf(insight);
  return text.length > QUERY_PREVIEW_LENGTH ? `${text.slice(0, QUERY_PREVIEW_LENGTH)}…` : text;
};

const titleOf = (insight: DbmInsight): I18nText => {
  const e = insight.evidence;
  switch (insight.id) {
    case "regression":
      return t("dbm.insights.regression.title", { ratio: (e.ratio ?? 0).toFixed(0) });
    case "n-plus-one":
      return t("dbm.insights.n-plus-one.title", {
        multiplier: Math.round(e.callsPerTrace ?? 0),
      });
    default:
      return t(`dbm.insights.${insight.id}.title`);
  }
};

const sentenceOf = (insight: DbmInsight): I18nText => {
  const e = insight.evidence;
  switch (insight.id) {
    case "regression":
      return t("dbm.insights.regression.body", {
        before: formatNs(e.baseline),
        after: formatNs(e.current),
      });
    // I2's evidence is a SHARE, not a rank move — it never sets fromRank/toRank
    // (only I8 does), so rendering it as "moved #x → #y" printed a rank the rule
    // never measured and made this card indistinguishable from rank-churn.
    case "new-expensive":
      return t("dbm.insights.new-expensive.body", {
        share: formatPercent(e.share, 0),
      });
    case "n-plus-one":
      return t("dbm.insights.n-plus-one.body", {
        share: formatPercent(e.share, 0),
        service: contextOf(insight),
      });
    case "volume-shift":
      return t("dbm.insights.volume-shift.body", {
        ratio: (e.ratio ?? 0).toFixed(0),
        service: contextOf(insight),
      });
    case "rank-churn":
      return t("dbm.insights.rank-churn.body", {
        from: e.fromRank ?? t("dbm.insights.rank-churn.unranked"),
        // Ranks are 1-based; `?? 0` printed "#0", which is not a rank.
        to: e.toRank ?? 1,
      });
    case "all-failing":
      return t("dbm.insights.all-failing.body", {
        failed: formatCount(e.current),
        total: formatCount(e.baseline),
        query: queryLabel(insight),
      });
    default:
      return raw("");
  }
};

/**
 * The affordance names what the click DOES, and it does two different things:
 * an insight about one row takes you to that row, one about several narrows the
 * table to them. "Show" for both was the vaguest possible word for a strip whose
 * whole job is pointing at rows the reader cannot currently see.
 */
const affordanceOf = (insight: DbmInsight): I18nText => {
  if (insight.evidence.count === 1) return t("dbm.insights.findRow");
  return props.activeId === insight.id ? t("dbm.insights.clearFilter") : t("dbm.insights.show");
};

const ruleOf = (insight: DbmInsight): I18nText =>
  raw(
    insightRuleText(insight.id, props.baseline, (key, params) =>
      t(key as Parameters<typeof t>[0], params ?? {}),
    ),
  );
</script>
