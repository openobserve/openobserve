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
    :id="`home-now-row-${row.key}`"
    class="border-b-border-default @container/row flex min-w-0 flex-col gap-1 border-b-[0.0625em] px-3 py-2.5 last:border-b-0"
    :class="selected ? 'bg-surface-tint-accent' : ''"
    :aria-current="selected ? 'true' : undefined"
    :data-test="`home-now-row-${row.key}`"
    :data-bucket="row.bucket"
  >
    <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @[40rem]/row:flex-nowrap">
      <HomeStateMark :bucket="row.bucket" :flapping="!!meta?.flapping" />
      <div class="flex min-w-0 flex-1 basis-0 flex-col gap-0.5">
        <div class="flex min-w-0 items-baseline gap-1 text-sm">
          <OButton
            v-if="row.kind === 'service'"
            variant="ghost-primary"
            size="chip"
            class="min-w-0 shrink px-0!"
            data-test="home-now-row-service"
            @click="emit('service', row)"
          >
            <OTruncatedText class="min-w-0">{{ sentence }}</OTruncatedText>
          </OButton>
          <OTruncatedText
            v-else
            class="text-text-heading min-w-0 font-medium"
            data-test="home-now-row-sentence"
            >{{ sentence }}</OTruncatedText
          >
        </div>
        <div
          v-if="detail.length"
          class="text-text-secondary flex min-w-0 flex-wrap items-center gap-x-1 text-xs"
          data-test="home-now-row-detail"
        >
          <template v-for="(part, index) in detail" :key="part.id">
            <span v-if="index > 0" aria-hidden="true">·</span>
            <span :class="part.tone" :data-test="`home-now-row-${part.id}`">{{ part.text }}</span>
          </template>
        </div>
      </div>
      <div
        class="flex shrink-0 items-center justify-end gap-2 @[40rem]/row:w-36"
        data-test="home-now-row-state"
      >
        <template v-if="row.kind === 'service'">
          <OText
            :variant="noBaseline ? 'meta' : 'mono'"
            class="hidden whitespace-nowrap @[40rem]/row:inline"
            :class="noBaseline ? 'text-text-secondary' : 'text-text-body'"
            data-test="home-now-row-figure"
            >{{ figure }}</OText
          >
          <OSparkline
            v-if="points && !noBaseline"
            :points="points.points"
            :baseline="points.baseline ?? undefined"
            size="xs"
            :tone="row.signal === 'errors' ? 'danger' : 'warning'"
            :aria-label="sentence"
            class="hidden w-16 @[40rem]/row:block"
            data-test="home-now-row"
          />
        </template>
        <OTag
          v-else-if="meta?.flapping"
          variant="warning-soft"
          dot
          size="xs"
          :label="t('home.agent.flapping', { count: flapCount })"
          data-test="home-now-row-flapping"
        />
        <OTag
          v-else-if="row.kind === 'incident'"
          type="severity"
          :value="severityValue"
          size="xs"
          data-test="home-now-row-severity"
        />
        <OTag
          v-else-if="row.kind === 'alert' && row.state === 'recovered'"
          variant="default-outline"
          size="xs"
          :label="t('overview.now.recovered')"
          data-test="home-now-row-recovered"
        />
        <OTag
          v-else-if="row.kind === 'alert' && row.count > 1"
          type="countChip"
          value="error"
          data-test="home-now-row-count"
          >{{ t("overview.now.firingCount", { count: row.count }) }}</OTag
        >
      </div>
      <span
        class="text-text-secondary shrink-0 basis-full ps-7 text-xs tabular-nums @[40rem]/row:w-12 @[40rem]/row:basis-auto @[40rem]/row:ps-0"
        :title="changedTitle"
        data-test="home-now-row-changed"
        >{{ changedTime }}</span
      >
      <!-- A narrow row keeps the pill beside the name and starts the time and actions under the name -->
      <div
        class="flex shrink-0 basis-full flex-wrap items-center justify-start gap-1 ps-7 @[40rem]/row:w-64 @[40rem]/row:basis-auto @[40rem]/row:flex-nowrap @[40rem]/row:justify-end @[40rem]/row:ps-0"
        data-test="home-now-row-actions"
      >
        <OTooltip :content="fallbackText ?? undefined" :disabled="!fallbackText">
          <OButton
            variant="outline"
            size="sm"
            :aria-label="t('overview.now.investigateName', { row: sentence })"
            :aria-describedby="fallbackText ? `${rowId}-fallback` : undefined"
            :loading="busy"
            :icon-left="askable ? assistantGlyph.scan : undefined"
            class="max-md:min-h-11"
            data-test="home-now-row-investigate"
            :data-askable="askable ? 'true' : 'false'"
            @click="emit('investigate', row)"
          >
            {{ investigateLabel }}
          </OButton>
        </OTooltip>
        <span v-if="fallbackText" :id="`${rowId}-fallback`" class="sr-only">{{
          fallbackText
        }}</span>
        <OTooltip
          v-if="createAlert"
          :content="t('home.agent.problems.askEditor')"
          :disabled="createAlert.enabled"
        >
          <OButton
            variant="outline"
            size="sm"
            :aria-disabled="!createAlert.enabled || undefined"
            :class="createAlert.enabled ? '' : 'cursor-not-allowed opacity-60'"
            data-test="home-now-row-create-alert"
            @click="createAlert.enabled && emit('createAlert', row)"
          >
            {{ t("home.agent.problems.createAlert") }}
          </OButton>
        </OTooltip>
        <OButton
          v-if="showOpenLink"
          variant="ghost-primary"
          size="sm"
          :disabled="linkLocked"
          class="max-md:min-h-11"
          data-test="home-now-row-open"
          @click="emit('open', row)"
        >
          {{ linkLabel }}
        </OButton>
      </div>
    </div>
    <div
      v-if="row.kind === 'service'"
      class="text-text-secondary flex items-center gap-2 ps-6 text-xs @[40rem]/row:hidden"
    >
      <OText
        :variant="noBaseline ? 'meta' : 'mono'"
        :class="noBaseline ? 'text-text-secondary' : 'text-text-body'"
        data-test="home-now-row-figure-narrow"
        >{{ figure }}</OText
      >
    </div>
    <div
      v-if="note"
      class="flex flex-wrap items-center gap-2 ps-6"
      role="status"
      data-test="home-now-row-note"
    >
      <OText variant="meta" class="text-status-warning-text">{{ note.text }}</OText>
      <OButton
        v-if="note.showRuns"
        variant="ghost-primary"
        size="chip"
        data-test="home-now-row-show-runs"
        @click="emit('showRuns')"
      >
        {{ t("assistant.error.run_limit_member.action") }}
      </OButton>
    </div>
  </li>
</template>

<script lang="ts">
/** What Home's grouping learned about a row. */
export interface NowRowMeta {
  service: string | null;
  repeats: number;
  flapping: boolean;
}
</script>

<script setup lang="ts">
import { computed } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
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

import HomeStateMark from "./HomeStateMark.vue";
import { rowSentence, serviceFigure } from "./homeInvestigate";

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
    /** False when no chat can take the row; the button then names the page it opens. */
    askable?: boolean;
    meta?: NowRowMeta | null;
    /** Shown on Problems with no alert; a read-only role sees it disabled. */
    createAlert?: { enabled: boolean } | null;
  }>(),
  {
    selected: false,
    busy: false,
    points: null,
    fallbackText: null,
    note: null,
    linkLocked: false,
    askable: true,
    meta: null,
    createAlert: null,
  },
);

const emit = defineEmits<{
  investigate: [row: OverviewNowRow];
  open: [row: OverviewNowRow];
  service: [row: OverviewNowRow];
  showRuns: [];
  createAlert: [row: OverviewNowRow];
}>();

const { t } = useI18nTyped();

const rowId = computed(() => `home-now-${props.row.key.replace(/[^\w-]/g, "_")}`);
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
  raw(formatTimestampInTimezone(props.row.changedAt, "HH:mm", props.timezone)),
);
const changedTitle = computed(() =>
  raw(
    `${formatTimestampInTimezone(props.row.changedAt, "YYYY-MM-DD HH:mm", props.timezone)} (${props.timezone})`,
  ),
);
const investigateLabel = computed<I18nText>(() => {
  if (props.askable) return t("overview.now.investigate");
  if (props.row.kind === "incident") return t("home.agent.openIncident");
  if (props.row.kind === "service") return t("home.agent.openService");
  return t("home.agent.openAlert");
});
// The fallback of every row but a service is the same page its link opens, so only one button shows.
const showOpenLink = computed(() => props.askable || props.row.kind === "service");
const flapCount = computed(() => {
  const row = props.row;
  return row.kind === "alert" ? row.count : (props.meta?.repeats ?? 1);
});
const linkLabel = computed<I18nText>(() => {
  if (props.row.kind === "service") return t("traces.servicesCatalog.viewTraces");
  if (props.row.kind === "incident") return t("home.agent.openIncident");
  return t("home.agent.openAlert");
});
const severityValue = computed(() =>
  props.row.kind === "incident" ? props.row.severity.toLowerCase() : "",
);
// The muted line carries only what the title and pill do not: the service, or what is off about a service row.
const detail = computed(() => {
  const row = props.row;
  const parts: { id: string; text: I18nText; tone?: string }[] = [];
  if (props.meta?.service && row.kind !== "service")
    parts.push({ id: "service-name", text: raw(props.meta.service) });
  if (row.kind === "alert" && row.state === "recovered" && props.meta?.flapping)
    parts.push({ id: "recovered-note", text: t("overview.now.recovered") });
  if (row.kind === "anomaly") parts.push({ id: "stream", text: raw(row.stream) });
  if (row.kind === "service") {
    if (row.coverage === "none")
      parts.push({
        id: "no-alert",
        text: props.createAlert ? t("home.agent.problems.noAlert") : t("overview.now.noAlert"),
        tone: "text-status-warning-text",
      });
    else if (row.coverage === "unknown")
      parts.push({ id: "coverage-unknown", text: t("overview.now.coverageUnknown") });
    if (row.partial) parts.push({ id: "partial", text: t("overview.now.partialRow") });
  }
  return parts;
});
</script>
