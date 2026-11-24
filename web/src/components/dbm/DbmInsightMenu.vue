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
  DbmInsightMenu — the insights as one filter-row button + popover list.
  Each row does what the old strip item did: emit `filter`, and the active one
  clears itself. Titles and sentences mirror DbmInsightStrip.
-->
<template>
  <!-- Always shown, so switching the comparison never makes the row jump; an empty list says so. -->
  <OPopover align="end">
    <template #trigger>
      <OButton variant="outline" size="sm" class="shrink-0" data-test="dbm-insights">
        {{ t("dbm.insights.title") }}
        <OTag
          :label="raw(String(ranked.length))"
          size="xs"
          class="ms-1"
          data-test="dbm-insights-count"
        />
      </OButton>
    </template>
    <div class="flex w-96 max-w-full flex-col p-1" data-test="dbm-insights-panel">
      <p
        v-if="!ranked.length"
        class="text-text-secondary px-2 py-1.5 text-xs"
        data-test="dbm-insights-empty"
      >
        {{ t("dbm.insights.empty") }}
      </p>
      <button
        v-for="insight in ranked"
        :key="insight.id"
        type="button"
        class="hover:bg-surface-subtle rounded-default flex cursor-pointer items-start gap-2 px-2 py-1.5 text-left"
        :class="activeId === insight.id ? 'bg-surface-accent-active' : ''"
        :data-test="`dbm-insight-item-${insight.id}`"
        @click="emit('filter', insight)"
      >
        <span
          class="rounded-default mt-0.5 grid size-4.5 shrink-0 place-items-center"
          :class="DBM_SOFT_TONES[insight.tone]"
        >
          <OIcon :name="DBM_TONE_ICONS[insight.tone]" size="xs" />
        </span>
        <span class="flex min-w-0 flex-col leading-tight">
          <span class="text-text-heading text-xs font-semibold">{{ titleOf(insight) }}</span>
          <span class="text-text-secondary text-2xs">{{ sentenceOf(insight) }}</span>
          <OTruncatedText class="text-text-secondary text-3xs font-mono">
            {{ subjectOf(insight) }}
          </OTruncatedText>
        </span>
        <OTooltip side="left" :content="ruleOf(insight)" />
      </button>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
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
import { DBM_SOFT_TONES, DBM_TONE_ICONS } from "@/utils/dbm/tones";

const props = withDefaults(
  defineProps<{
    insights: DbmInsight[];
    /** The insight the table is currently filtered to. */
    activeId?: DbmInsightId | null;
    baseline?: DbmInsightBaseline;
  }>(),
  { activeId: null, baseline: "previous" },
);

const emit = defineEmits<{ (e: "filter", insight: DbmInsight): void }>();

const { t } = useI18nTyped();

const TONE_RANK: Record<DbmInsightTone, number> = { error: 0, warning: 1, info: 2 };

const ranked = computed(() =>
  [...props.insights].sort((a, b) => {
    const tone = TONE_RANK[a.tone] - TONE_RANK[b.tone];
    if (tone !== 0) return tone;
    return (b.evidence.share ?? 0) - (a.evidence.share ?? 0);
  }),
);

const contextOf = (insight: DbmInsight) => {
  const row = insight.evidence.row;
  return row.service_name ?? row.services?.[0] ?? row.db_instance ?? "";
};

/** The query (or, when the row has no text, the service) the insight is about. */
const SUBJECT_LENGTH = 90;
const subjectOf = (insight: DbmInsight): I18nText => {
  const text = oneLine(insight.evidence.row.query_norm);
  const base = text || contextOf(insight);
  const clipped = base.length > SUBJECT_LENGTH ? `${base.slice(0, SUBJECT_LENGTH)}…` : base;
  return raw(text && contextOf(insight) ? `${contextOf(insight)} · ${clipped}` : clipped);
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
    case "new-expensive":
      return t("dbm.insights.new-expensive.body", { share: formatPercent(e.share, 0) });
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
        to: e.toRank ?? 1,
      });
    case "all-failing":
      return t("dbm.insights.all-failing.body", {
        failed: formatCount(e.current),
        total: formatCount(e.baseline),
        query: oneLine(insight.evidence.row.query_norm).slice(0, 30),
      });
    default:
      return raw("");
  }
};

const ruleOf = (insight: DbmInsight): I18nText =>
  raw(
    insightRuleText(insight.id, props.baseline, (key, params) =>
      t(key as Parameters<typeof t>[0], params ?? {}),
    ),
  );
</script>
