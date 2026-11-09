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
    v-if="chart"
    role="group"
    :aria-label="groupName"
    class="rounded-surface border-border-default bg-surface-base flex min-w-0 flex-col overflow-hidden border"
    data-test="assistant-chart-card"
  >
    <div class="flex min-w-0 items-center gap-2 px-3 pt-2.5 pb-1">
      <OIcon :name="assistantGlyph.chart" size="sm" class="text-text-secondary shrink-0" />
      <OTruncatedText
        v-if="title"
        class="text-text-heading min-w-0 text-sm font-semibold"
        data-test="assistant-chart-title"
        >{{ title }}</OTruncatedText
      >
      <OText variant="meta" nowrap data-test="assistant-chart-meta">{{ metaLine }}</OText>
    </div>
    <div class="h-48 min-w-0 px-1" data-test="assistant-chart-plot">
      <!-- Static series from the answer: the schema renderer would re-run a query, so the raw renderer is the escape hatch -->
      <ChartRenderer :data="{ options }" :label="groupName" />
    </div>
    <ul
      class="flex min-w-0 flex-wrap gap-x-4 gap-y-1 px-3 pb-2.5 text-xs"
      :aria-label="t('assistant.chart.legend')"
      data-test="assistant-chart-legend"
    >
      <li
        v-for="(entry, index) in legend"
        :key="`${index}:${entry.name}`"
        class="flex min-w-0 items-center gap-1.5"
        data-test="assistant-chart-legend-item"
        :data-lead="index === lead ? '' : undefined"
      >
        <span
          aria-hidden="true"
          :class="['h-0.5 w-3 shrink-0', index === lead ? 'bg-accent' : 'bg-border-strong']"
        />
        <OTruncatedText class="text-text-secondary max-w-60 min-w-0">{{
          raw(entry.name)
        }}</OTruncatedText>
        <span class="text-text-heading font-medium tabular-nums">{{ entry.value }}</span>
      </li>
    </ul>
    <div
      v-if="query"
      class="border-border-subtle bg-surface-subtle flex min-w-0 items-center gap-2 border-t py-1.5 ps-3 pe-1.5"
      data-test="assistant-chart-foot"
    >
      <OText variant="meta" nowrap>{{ languageLabel(query.language) }}</OText>
      <OCode class="min-w-0 flex-1">
        <OTruncatedText class="min-w-0" :tooltip="false">{{ raw(query.text) }}</OTruncatedText>
      </OCode>
      <AssistantIconButton
        :label="t('assistant.chart.copyQuery')"
        :icon="assistantGlyph.copy"
        data-test="assistant-chart-copy"
        @click="copyQuery"
      />
      <ODropdown v-if="live" align="end" side="top" privacy="mask">
        <template #trigger>
          <AssistantIconButton
            :label="t('assistant.query.more')"
            :icon="assistantGlyph.more"
            data-test="assistant-chart-more"
          />
        </template>
        <ODropdownItem
          :icon-left="assistantGlyph.chipPanel"
          data-test="assistant-chart-add-dashboard"
          @select="draft('add_to_dashboard_draft')"
        >
          {{ t("assistant.chart.addToDashboard") }}
        </ODropdownItem>
        <ODropdownItem
          :icon-left="assistantGlyph.chipAlert"
          data-test="assistant-chart-create-alert"
          @select="draft('create_alert_draft')"
        >
          {{ t("assistant.chart.createAlert") }}
        </ODropdownItem>
        <ODropdownItem
          :icon-left="assistantGlyph.copy"
          data-test="assistant-chart-copy-query"
          @select="copyQuery"
        >
          {{ t("assistant.chart.copyQuery") }}
        </ODropdownItem>
      </ODropdown>
      <OButton
        v-if="live"
        variant="outline"
        size="sm"
        :icon-left="assistantGlyph.newTab"
        class="shrink-0 max-md:min-h-11"
        data-test="assistant-chart-open"
        @click="openInExplorer"
      >
        {{ openLabel }}
      </OButton>
    </div>
  </div>
  <OButton
    v-else-if="query && live"
    variant="outline"
    size="sm"
    class="self-start max-md:min-h-11"
    :icon-left="assistantGlyph.chart"
    data-test="assistant-chart-show"
    @click="openInExplorer"
  >
    {{ t("assistant.chart.showChart") }}
  </OButton>
</template>

<script lang="ts">
import type { QueryRef, Sid } from "@/composables/assistant/pure";

import type { ChartSeries } from "./chartSeries";

export interface AssistantChartCardProps {
  /** The turn's series; null on a reloaded turn, where the server kept none and the card offers Show chart. */
  chart: ChartSeries | null;
  /** The query that drew it, for the foot and its actions. */
  query: QueryRef | null;
  sid?: Sid | null;
  turnId?: string;
  readonly?: boolean;
}
</script>

<script setup lang="ts">
import { computed, defineAsyncComponent, inject } from "vue";
import { useStore } from "vuex";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { assistantEvidenceHostKey, type AssistantAction } from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { explorerOf } from "@/utils/assistant/explorerRoutes";
import { copyToClipboard } from "@/utils/clipboard";
import { formatOrgTime } from "@/utils/formatters";

import {
  chartOption,
  latestValues,
  leadSeries,
  metricOf,
  promqlMetric,
  valueText,
} from "./chartSeries";
import { explorerLabel, languageLabel, rangeText } from "./evidenceText";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = withDefaults(defineProps<AssistantChartCardProps>(), {
  sid: null,
  turnId: undefined,
  readonly: false,
});

const { t } = useI18nTyped();
const store = useStore();
const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);

const live = computed(() => !!evidence && !!props.sid && !!props.query);
const explorer = computed(() => (props.query ? explorerOf(props.query) : "logs"));
const openLabel = computed(() =>
  t("assistant.query.open", { explorer: explorerLabel(explorer.value, t) }),
);
const lead = computed(() => (props.chart ? leadSeries(props.chart) : 0));
const legend = computed(() =>
  props.chart
    ? latestValues(props.chart).map((entry) => ({
        name: entry.name,
        value: valueText(entry.value),
      }))
    : [],
);
const title = computed<I18nText | null>(() => {
  const query = props.query;
  const name =
    query?.stream ??
    (props.chart ? metricOf(props.chart) : null) ??
    (query?.language === "promql" ? promqlMetric(query.text) : null);
  return name ? raw(name) : null;
});
const count = computed(() => props.chart?.series.length ?? 0);
const metaLine = computed<I18nText>(() => {
  const series = t("assistant.chart.seriesCount", { count: count.value }, count.value);
  const { from, to } = props.query ?? {};
  return from && to
    ? t("assistant.chart.meta", { range: rangeText({ from, to }), series })
    : series;
});
const groupName = computed<I18nText>(() =>
  title.value
    ? t("assistant.chart.name", { title: title.value, series: metaLine.value })
    : metaLine.value,
);

const options = computed(() => {
  // The theme flips the token values; reading it makes the colours re-resolve.
  void store?.state?.theme;
  if (!props.chart) return {};
  return chartOption(
    props.chart,
    {
      lead: token("--color-accent"),
      rest: token("--color-border-strong"),
      axis: token("--color-text-secondary"),
      grid: token("--color-border-subtle"),
    },
    (ms) => formatOrgTime(ms),
  );
});

function token(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function dispatch(action: AssistantAction) {
  if (!props.sid || !evidence) return Promise.resolve({ ok: false as const });
  return evidence.dispatch(props.sid, action);
}

// Opens the explorer with the query loaded; the explorer runs it only when the reader does.
function openInExplorer(): void {
  if (!props.query) return;
  void dispatch({ kind: "open_in_explorer", query: props.query, explorer: explorer.value });
}

function draft(kind: "add_to_dashboard_draft" | "create_alert_draft"): void {
  if (!props.query) return;
  void dispatch({ kind, query: props.query, ...(props.turnId && { turnId: props.turnId }) });
}

async function copyQuery(): Promise<void> {
  if (!props.query) return;
  if (!props.sid || !evidence) {
    await copyToClipboard(props.query.text, t, { successMessage: t("assistant.evidence.copied") });
    return;
  }
  const result = await dispatch({ kind: "copy", text: props.query.text, what: "query" });
  evidence.announce(
    props.sid,
    result.ok ? t("assistant.evidence.copied") : t("assistant.client.copyManually"),
  );
}
</script>
