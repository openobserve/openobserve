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
    class="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-2"
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
      class="border-border-default rounded-surface bg-surface-panel border border-[0.0625em] px-3 py-3"
      data-test="home-attention-loading"
    >
      <OSkeleton type="text" class="h-3.5 w-1/2" />
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
        <div class="flex min-w-0 max-w-[60ch] flex-col gap-0.5">
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
    <ul v-if="snapshot.rows.length" class="flex min-w-0 flex-col gap-2" data-test="home-attention-rows">
      <li
        v-for="row in snapshot.rows"
        :key="row.key"
        class="border-border-default rounded-surface bg-surface-panel flex min-w-0 cursor-pointer items-center gap-3 border border-[0.0625em] px-3 py-2 transition-[translate,box-shadow] duration-200 hover:shadow-sm motion-safe:hover:-translate-y-0.5"
        :data-test="`home-attention-row-${row.key}`"
        :data-kind="row.kind"
        @click="emit('open', row)"
      >
        <HomeStateMark :bucket="row.bucket" :flapping="!!rowMeta[row.key]?.flapping" />
        <OTruncatedText
          class="text-text-heading min-w-0 flex-1 text-sm"
          data-test="home-attention-sentence"
          >{{ sentenceOf(row) }}</OTruncatedText
        >
        <template v-if="row.kind === 'incident'">
          <OTag
            type="severity"
            :value="row.severity.toLowerCase()"
            size="xs"
            data-test="home-attention-severity"
          />
          <OText variant="meta" class="shrink-0 tabular-nums" data-test="home-attention-age">{{
            raw(formatRelativeCompact(row.changedAt / 1000))
          }}</OText>
        </template>
        <OButton
          variant="outline"
          size="sm"
          :aria-label="t('home.agent.attention.openName', { row: sentenceOf(row) })"
          class="shrink-0 max-md:min-h-11"
          data-test="home-attention-open"
          @click.stop="emit('open', row)"
        >
          {{ t("home.agent.attention.open") }}
        </OButton>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { useId } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import type { OverviewNowRow, OverviewNowSnapshot } from "@/composables/contextProviders/types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatRelativeCompact } from "@/utils/formatters";

import HomeStateMark from "./HomeStateMark.vue";
import type { NowRowMeta } from "./HomeNowRow.vue";
import { rowSentence } from "./homeInvestigate";

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

const props = withDefaults(
  defineProps<{
    /** The rows to show, most urgent first; none shows the card for `empty`. */
    snapshot: OverviewNowSnapshot;
    /** What Home's grouping learned per row key, for the flapping mark. */
    rowMeta?: Record<string, NowRowMeta>;
    /** Why there are no rows; null draws only the heading. */
    empty?: EmptyState | null;
    /** The first load has not finished, so no message is safe to show yet. */
    loading?: boolean;
  }>(),
  { rowMeta: () => ({}), empty: null, loading: false },
);

const emit = defineEmits<{
  open: [row: OverviewNowRow];
  viewAll: [];
  retry: [];
  sendData: [];
}>();

const { t } = useI18nTyped();
const headingId = `home-attention-${useId()}`;

function sentenceOf(row: OverviewNowRow) {
  return rowSentence(row, props.snapshot, t, true);
}
</script>
