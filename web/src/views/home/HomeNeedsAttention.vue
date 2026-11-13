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
  <section
    :aria-labelledby="headingId"
    class="mx-auto flex min-h-48 w-full max-w-3xl min-w-0 flex-1 flex-col gap-2"
    data-test="home-attention"
  >
    <div class="flex min-h-8 min-w-0 items-center gap-3 ps-1">
      <h2 :id="headingId" class="text-text-heading min-w-0 flex-1 text-sm font-medium">
        {{ t("home.agent.attention.title") }}
      </h2>
      <OButton
        variant="ghost-primary"
        size="sm"
        :icon-right="assistantGlyph.goTo"
        class="shrink-0 max-md:min-h-11"
        data-test="home-attention-view-all"
        @click="emit('viewAll')"
      >
        {{ t("home.agent.attention.viewAll") }}
      </OButton>
    </div>
    <div
      v-if="loading && !snapshot.rows.length"
      :class="CARD_CLASS"
      aria-busy="true"
      data-test="home-attention-loading"
    >
      <span class="sr-only" role="status">{{ t("common.loadingLabel") }}</span>
      <ul aria-hidden="true" class="flex flex-col">
        <li
          v-for="(widths, index) in SKELETON_WIDTHS"
          :key="index"
          :class="ROW_CLASS"
          data-test="home-attention-skeleton-row"
        >
          <span class="inline-flex size-4 shrink-0 items-center justify-center">
            <OSkeleton type="circle" class="size-2" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="flex h-5 items-center"
              ><OSkeleton type="text" :class="['h-3.5', widths[0]]"
            /></span>
            <span class="flex h-4 items-center"
              ><OSkeleton type="text" :class="['h-3', widths[1]]"
            /></span>
          </div>
          <span :class="['flex shrink-0 items-center justify-center', ACTION_BOX_CLASS]">
            <OSkeleton class="size-4" />
          </span>
        </li>
      </ul>
    </div>
    <div
      v-else-if="!snapshot.rows.length && empty"
      class="border-border-default rounded-surface bg-surface-panel flex min-w-0 items-center gap-4 border border-[0.0625em] px-5 py-4 max-md:flex-col max-md:items-stretch"
      data-test="home-attention-empty"
      :data-empty="empty"
    >
      <div class="flex min-w-0 flex-1 items-center gap-4">
        <div
          class="rounded-default flex size-10 shrink-0 items-center justify-center"
          :class="EMPTY_TILE[empty]"
          data-test="home-attention-empty-tile"
        >
          <OIcon
            :name="EMPTY_ICON[empty]"
            size="md"
            :class="EMPTY_TONE[empty]"
            aria-hidden="true"
            data-test="home-attention-empty-icon"
          />
        </div>
        <div class="flex max-w-[60ch] min-w-0 flex-col gap-0.5">
          <span class="text-text-heading text-sm font-medium">{{
            t(`home.agent.attention.empty.${empty}.title`)
          }}</span>
          <OText variant="meta" class="leading-relaxed">{{
            t(`home.agent.attention.empty.${empty}.body`)
          }}</OText>
        </div>
      </div>
      <div
        v-if="empty !== 'clear'"
        class="flex shrink-0 flex-wrap items-center gap-2"
        data-test="home-attention-empty-actions"
      >
        <OButton
          v-if="empty === 'failed'"
          variant="outline"
          size="sm"
          class="max-md:min-h-11"
          data-test="home-attention-retry"
          @click="emit('retry')"
        >
          {{ t("home.agent.attention.retry") }}
        </OButton>
        <OButton
          v-else
          variant="outline"
          size="sm"
          class="max-md:min-h-11"
          data-test="home-attention-send-data"
          @click="emit('sendData')"
        >
          {{ t("home.agent.attention.sendData") }}
        </OButton>
      </div>
    </div>
    <!-- The row is a mouse shortcut for its Open button, which keyboard and screen reader users reach -->
    <ul
      v-if="snapshot.rows.length"
      :class="[CARD_CLASS, 'min-h-0 overflow-x-hidden overflow-y-auto']"
      data-test="home-attention-rows"
    >
      <li
        v-for="row in snapshot.rows"
        :key="row.key"
        :class="[ROW_CLASS, 'group cursor-pointer', ROW_STATE_CLASS]"
        :data-test="`home-attention-row-${row.key}`"
        :data-kind="row.kind"
        @click="emit('open', row)"
      >
        <HomeStateMark :bucket="row.bucket" :flapping="!!rowMeta[row.key]?.flapping" />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex h-5 min-w-0 items-center gap-2">
            <OTruncatedText
              class="text-text-heading min-w-0 text-sm font-medium"
              data-test="home-attention-sentence"
              >{{ sentenceOf(row) }}</OTruncatedText
            >
            <span class="text-text-secondary shrink-0 text-xs" data-test="home-attention-kind">{{
              t(`home.agent.attention.kind.${row.kind}`)
            }}</span>
            <OTag
              v-if="row.kind === 'incident'"
              type="severity"
              :value="row.severity.toLowerCase()"
              size="xs"
              data-test="home-attention-severity"
            />
          </div>
          <OTruncatedText
            v-if="detailOf(row).length"
            as="div"
            class="text-text-secondary h-4 text-xs"
            data-test="home-attention-detail"
          >
            <template v-for="(part, index) in detailOf(row)" :key="part.id">
              <span v-if="index > 0" aria-hidden="true">{{ SEPARATOR }}</span>
              <span
                :class="part.tone"
                :title="part.title"
                :data-test="`home-attention-${part.id}`"
                >{{ part.text }}</span
              >
            </template>
          </OTruncatedText>
        </div>
        <div class="flex shrink-0 items-center gap-0.5" data-test="home-attention-actions">
          <template v-if="assistant">
            <AssistantIconButton
              :label="addLabel(row)"
              :icon="isAdded(row) ? assistantGlyph.done : assistantGlyph.addContext"
              :pressed="isAdded(row)"
              :class="isAdded(row) ? '' : REVEAL_CLASS"
              data-test="home-attention-add"
              @click.stop="emit('addToChat', row)"
            >
              <template #tooltip>{{
                isAdded(row)
                  ? t("home.agent.attention.removeFromChat")
                  : t("home.agent.attention.addToChat")
              }}</template>
            </AssistantIconButton>
            <AssistantIconButton
              :label="t('overview.now.investigateName', { row: sentenceOf(row) })"
              :icon="assistantGlyph.sparkle"
              :class="REVEAL_CLASS"
              data-test="home-attention-investigate"
              @click.stop="emit('investigate', row)"
            >
              <template #tooltip>{{ t("home.agent.attention.investigate") }}</template>
            </AssistantIconButton>
          </template>
          <AssistantIconButton
            :label="t('home.agent.attention.openName', { row: sentenceOf(row) })"
            :icon="assistantGlyph.next"
            data-test="home-attention-open"
            @click.stop="emit('open', row)"
          >
            <template #tooltip>{{ t(`home.agent.attention.openTo.${row.kind}`) }}</template>
          </AssistantIconButton>
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { useId } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import type { OverviewNowRow, OverviewNowSnapshot } from "@/composables/contextProviders/types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import { formatElapsed, formatRelativeCompact } from "@/utils/formatters";

import HomeStateMark from "./HomeStateMark.vue";
import type { NowRowMeta } from "./HomeNowRow.vue";
import { rowSentence, serviceFigure } from "./homeInvestigate";

export type EmptyState = "clear" | "no-data" | "failed";

const EMPTY_TILE = {
  clear: "bg-status-success-bg",
  "no-data": "bg-status-info-bg",
  failed: "bg-status-warning-bg",
} as const;

const EMPTY_TONE = {
  clear: "text-status-success-text",
  "no-data": "text-status-info-text",
  failed: "text-status-warning-text",
} as const;

const EMPTY_ICON = {
  clear: "check-circle",
  "no-data": "info-outline",
  failed: "error-outline",
} as const;

const CARD_CLASS =
  "border-border-default rounded-surface bg-surface-panel flex min-w-0 flex-col border border-[0.0625em]";

// The skeleton rows share this, so nothing moves when the real rows arrive.
const ROW_CLASS =
  "border-border-default flex min-w-0 items-center gap-3 border-t-[0.0625em] px-3.5 py-3 first:border-t-0";

const ROW_STATE_CLASS =
  "hover:bg-table-row-hover-bg focus-within:bg-table-row-hover-bg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-focus-ring-accent";

// The icon buttons' box: 1.75 rem, 2.75 rem where touch targets grow.
const ACTION_BOX_CLASS = "size-7 max-md:size-11 pointer-coarse:size-11";

// Shown on row hover or focus; always on touch and phones, where there is no hover.
const REVEAL_CLASS =
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 max-md:opacity-100 pointer-coarse:opacity-100 motion-safe:transition-opacity";

const SKELETON_WIDTHS = [
  ["w-11/20", "w-7/20"],
  ["w-7/10", "w-2/5"],
  ["w-9/20", "w-3/10"],
] as const;

const SEPARATOR = raw(" · ");

const props = withDefaults(
  defineProps<{
    /** The rows to show, most urgent first; none shows the card for `empty`. */
    snapshot: OverviewNowSnapshot;
    /** What Home's grouping learned per row key, for the flapping mark and when an incident opened. */
    rowMeta?: Record<string, NowRowMeta>;
    /** Why there are no rows; null draws only the heading. */
    empty?: EmptyState | null;
    /** The first load has not finished, so no message is safe to show yet. */
    loading?: boolean;
    /** Home's timezone, for the time a service row went bad. */
    timezone?: string;
    /** The Ask box is on screen, so each row offers Add to Chat and Investigate. */
    assistant?: boolean;
    /** Row keys whose chip is in the Ask box; Add to Chat on them takes it out. */
    addedKeys?: readonly string[];
  }>(),
  {
    rowMeta: () => ({}),
    empty: null,
    loading: false,
    timezone: "UTC",
    assistant: false,
    addedKeys: () => [],
  },
);

const emit = defineEmits<{
  open: [row: OverviewNowRow];
  investigate: [row: OverviewNowRow];
  addToChat: [row: OverviewNowRow];
  viewAll: [];
  retry: [];
  sendData: [];
}>();

const { t } = useI18nTyped();
const headingId = `home-attention-${useId()}`;

interface DetailPart {
  id: string;
  text: I18nText;
  tone?: string;
  title?: I18nText;
}

function sentenceOf(row: OverviewNowRow) {
  return rowSentence(row, props.snapshot, t, true);
}

function isAdded(row: OverviewNowRow): boolean {
  return props.addedKeys.includes(row.key);
}

function addLabel(row: OverviewNowRow): I18nText {
  const params = { row: sentenceOf(row) };
  return isAdded(row)
    ? t("home.agent.attention.removeFromChatName", params)
    : t("home.agent.attention.addToChatName", params);
}

function ago(us: number): I18nText {
  return raw(formatRelativeCompact(us / 1000));
}

// The quiet second line: only what the sentence does not already say, from what the row carries.
function detailOf(row: OverviewNowRow): DetailPart[] {
  if (row.kind === "alert") {
    const parts: DetailPart[] = [
      { id: "fired", text: t("home.agent.attention.fired", { count: row.count }, row.count) },
    ];
    if (row.lastAt > 0) {
      const age = ago(row.lastAt);
      parts.push(
        row.state === "recovered"
          ? { id: "last", text: t("home.agent.attention.recoveredAgo", { age }) }
          : { id: "last", text: t("home.agent.attention.lastAgo", { age }) },
      );
    }
    return parts;
  }
  if (row.kind === "incident") {
    const parts: DetailPart[] = [];
    if (row.alertCount > 0)
      parts.push({
        id: "alerts",
        text: t("home.agent.attention.alerts", { count: row.alertCount }, row.alertCount),
      });
    const opened = props.rowMeta[row.key]?.openedAt ?? 0;
    if (opened > 0)
      parts.push({ id: "age", text: t("home.agent.attention.openedAgo", { age: ago(opened) }) });
    return parts;
  }
  if (row.kind === "anomaly") {
    const parts: DetailPart[] = [];
    if (row.stream) parts.push({ id: "stream", text: raw(row.stream) });
    if (row.at > 0)
      parts.push({ id: "last", text: t("home.agent.attention.lastAgo", { age: ago(row.at) }) });
    return parts;
  }
  const parts: DetailPart[] = [];
  const figure = serviceDetailFigure(row);
  if (figure) parts.push({ id: "figure", text: figure });
  if (row.changedAt > 0)
    parts.push({
      id: "since",
      text: t("home.agent.attention.since", {
        time: raw(formatTimestampInTimezone(row.changedAt, "HH:mm", props.timezone)),
      }),
      title: raw(
        `${formatTimestampInTimezone(row.changedAt, "YYYY-MM-DD HH:mm", props.timezone)} (${props.timezone})`,
      ),
    });
  if (row.coverage === "none")
    parts.push({
      id: "no-alert",
      text: t("home.agent.problems.noAlert"),
      tone: "text-status-warning-text",
    });
  else if (row.coverage === "unknown")
    parts.push({ id: "coverage-unknown", text: t("overview.now.coverageUnknown") });
  if (row.partial) parts.push({ id: "partial", text: t("overview.now.partialRow") });
  return parts;
}

// The sentence already names the error rate or the p99 multiple, so the line adds the baseline or the p99 time.
function serviceDetailFigure(row: Extract<OverviewNowRow, { kind: "service" }>): I18nText | null {
  if (row.signal === "latency")
    return row.p99Ms === null
      ? null
      : t("home.agent.attention.p99", { value: raw(formatElapsed(row.p99Ms)) });
  if (row.baselineErrorRate !== null && row.baselineHours !== null) return serviceFigure(row, t);
  return props.snapshot.services.available ? t("overview.now.noBaseline") : null;
}
</script>
