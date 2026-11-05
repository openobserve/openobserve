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
  <li
    :id="`overview-now-row-${row.key}`"
    class="border-b-border-default @container/row flex min-w-0 flex-col gap-1 border-b-[0.0625em] px-3 py-2.5 last:border-b-0"
    :class="selected ? 'bg-surface-tint-accent' : ''"
    :aria-current="selected ? 'true' : undefined"
    :data-test="`overview-now-row-${row.key}`"
    :data-bucket="row.bucket"
  >
    <div class="flex min-w-0 items-center gap-2">
      <OverviewStateMark :bucket="row.bucket" />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <div class="flex min-w-0 items-baseline gap-1 text-sm">
          <OButton
            v-if="row.kind === 'service'"
            variant="ghost-primary"
            size="chip"
            class="min-w-0 shrink px-0!"
            data-test="overview-now-row-service"
            @click="emit('service', row)"
          >
            <OTruncatedText class="min-w-0">{{ sentence }}</OTruncatedText>
          </OButton>
          <OTruncatedText
            v-else
            class="text-text-heading min-w-0"
            data-test="overview-now-row-sentence"
            >{{ sentence }}</OTruncatedText
          >
        </div>
        <div
          class="text-text-secondary flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
        >
          <template v-if="row.kind === 'incident'">
            <OTag type="severity" :value="row.severity.toLowerCase()" />
            <span>{{ row.status }}</span>
            <span>{{ t("alerts.incidents.alertCount") }} {{ row.alertCount }}</span>
          </template>
          <OTag
            v-else-if="row.kind === 'alert' && row.state === 'firing' && row.count > 1"
            type="countChip"
            value="error"
            data-test="overview-now-row-count"
            >{{ t("overview.now.firingCount", { count: row.count }) }}</OTag
          >
          <span v-else-if="row.kind === 'alert' && row.state === 'recovered'">{{
            t("overview.now.recovered")
          }}</span>
          <span v-else-if="row.kind === 'anomaly'">{{ row.stream }}</span>
          <template v-if="row.kind === 'service'">
            <span
              v-if="row.coverage === 'none'"
              class="text-status-warning-text"
              data-test="overview-now-row-no-alert"
              >{{ t("overview.now.noAlert") }}</span
            >
            <span
              v-else-if="row.coverage === 'unknown'"
              data-test="overview-now-row-coverage-unknown"
              >{{ t("overview.now.coverageUnknown") }}</span
            >
            <span v-if="row.partial" data-test="overview-now-row-partial">{{
              t("overview.now.partialRow")
            }}</span>
          </template>
          <span :title="changedTitle" data-test="overview-now-row-changed">{{
            t("overview.now.changedAt", { time: changedTime })
          }}</span>
        </div>
      </div>
      <div
        v-if="row.kind === 'service'"
        class="hidden shrink-0 items-center gap-2 @[32rem]/row:flex"
      >
        <OText
          :variant="noBaseline ? 'meta' : 'mono'"
          class="whitespace-nowrap"
          :class="noBaseline ? 'text-text-secondary' : 'text-text-body'"
          data-test="overview-now-row-figure"
          >{{ figure }}</OText
        >
        <OSparkline
          v-if="points && !noBaseline"
          :points="points.points"
          :baseline="points.baseline ?? undefined"
          size="xs"
          :tone="row.signal === 'errors' ? 'danger' : 'warning'"
          :aria-label="sentence"
          class="w-20"
          data-test="overview-now-row"
        />
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <OTooltip :content="fallbackText ?? undefined" :disabled="!fallbackText">
          <OButton
            variant="outline"
            size="sm"
            :aria-label="t('overview.now.investigateName', { row: sentence })"
            :aria-describedby="fallbackText ? `${rowId}-fallback` : undefined"
            :loading="busy"
            data-test="overview-now-row-investigate"
            @click="emit('investigate', row)"
          >
            {{ t("overview.now.investigate") }}
          </OButton>
        </OTooltip>
        <span v-if="fallbackText" :id="`${rowId}-fallback`" class="sr-only">{{
          fallbackText
        }}</span>
        <OButton
          variant="ghost-primary"
          size="sm"
          :disabled="linkLocked"
          data-test="overview-now-row-open"
          @click="emit('open', row)"
        >
          {{ linkLabel }}
        </OButton>
      </div>
    </div>
    <div
      v-if="row.kind === 'service'"
      class="text-text-secondary flex items-center gap-2 ps-6 text-xs @[32rem]/row:hidden"
    >
      <OText
        :variant="noBaseline ? 'meta' : 'mono'"
        :class="noBaseline ? 'text-text-secondary' : 'text-text-body'"
        data-test="overview-now-row-figure-narrow"
        >{{ figure }}</OText
      >
    </div>
    <div
      v-if="note"
      class="flex flex-wrap items-center gap-2 ps-6"
      role="status"
      data-test="overview-now-row-note"
    >
      <OText variant="meta" class="text-status-warning-text">{{ note.text }}</OText>
      <OButton
        v-if="note.showRuns"
        variant="ghost-primary"
        size="chip"
        data-test="overview-now-row-show-runs"
        @click="emit('showRuns')"
      >
        {{ t("assistant.error.run_limit_member.action") }}
      </OButton>
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { OverviewNowRow, OverviewNowSnapshot } from "@/composables/contextProviders/types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSparkline from "@/lib/data/Sparkline/OSparkline.vue";
import type { SparklinePoint } from "@/lib/data/Sparkline/OSparkline.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";

import OverviewStateMark from "./OverviewStateMark.vue";
import { rowSentence, serviceFigure } from "./overviewInvestigate";

const props = withDefaults(
  defineProps<{
    row: OverviewNowRow;
    snapshot: OverviewNowSnapshot;
    timezone: string;
    selected?: boolean;
    busy?: boolean;
    /** The sparkline and its dashed baseline; null without a trend. */
    points?: { points: SparklinePoint[]; baseline: number | null } | null;
    /** Set while Investigate does the row's own page action, so its description says what opens. */
    fallbackText?: I18nText | null;
    note?: { text: I18nText; showRuns: boolean } | null;
    linkLocked?: boolean;
  }>(),
  {
    selected: false,
    busy: false,
    points: null,
    fallbackText: null,
    note: null,
    linkLocked: false,
  },
);

const emit = defineEmits<{
  investigate: [row: OverviewNowRow];
  open: [row: OverviewNowRow];
  service: [row: OverviewNowRow];
  showRuns: [];
}>();

const { t } = useI18nTyped();

const rowId = computed(() => `overview-now-${props.row.key.replace(/[^\w-]/g, "_")}`);
const sentence = computed(() => rowSentence(props.row, props.snapshot, t, true));
const noBaseline = computed(
  () =>
    props.row.kind === "service" &&
    props.snapshot.services.available &&
    props.row.baselineErrorRate === null &&
    props.row.signal === "errors",
);
const figure = computed<I18nText>(() => {
  const row = props.row;
  if (row.kind !== "service") return raw("");
  if (noBaseline.value) return t("overview.now.noBaseline");
  return serviceFigure(row, t);
});
const changedTime = computed(() =>
  formatTimestampInTimezone(props.row.changedAt, "HH:mm", props.timezone),
);
const changedTitle = computed(() =>
  raw(
    `${formatTimestampInTimezone(props.row.changedAt, "YYYY-MM-DD HH:mm", props.timezone)} (${props.timezone})`,
  ),
);
const linkLabel = computed<I18nText>(() => {
  if (props.row.kind === "service") return t("traces.servicesCatalog.viewTraces");
  if (props.row.kind === "incident") return t("overview.goTo.open");
  return t("alerts.history");
});
</script>
