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
  <OverviewSectionCard
    section="data-freshness"
    :title="t('overview.sections.dataHealth')"
    :subtitle="state === 'ok' ? t('overview.health.subtitle') : undefined"
    :link-label="state === 'ok' ? t('overview.streams.allStreams') : undefined"
    view="ok"
    @view-all="router.push({ name: 'logstreams', query: { org_identifier: org } })"
  >
    <div class="flex flex-col lg:min-h-37" :data-test="`overview-data-freshness-${state}`">
      <ul v-if="state === 'loading'" class="divide-border-subtle flex flex-col divide-y">
        <li v-for="i in 3" :key="i" class="flex h-9 items-center gap-2.5">
          <OSkeleton shape="circle" class="size-2 shrink-0" />
          <OSkeleton shape="block" class="h-4 w-16" />
          <OSkeleton shape="block" class="ms-auto h-3 w-28 shrink-0" />
        </li>
      </ul>
      <OEmptyState
        v-else-if="state === 'error'"
        size="compact"
        kind="error"
        :title="t('overview.health.loadError')"
      >
        <template #actions>
          <OButton size="sm" data-test="overview-data-freshness-retry" @click="emit('retry')">
            {{ t("emptyState.loadError.action") }}
          </OButton>
        </template>
      </OEmptyState>
      <ul v-else class="divide-border-subtle flex flex-col divide-y">
        <li v-for="row in rows" :key="row.type" class="py-0.5">
          <div class="-mx-3">
            <OverviewRowButton
              :to="routeOf(row)"
              :data-test="`overview-data-freshness-row-${row.type}`"
            >
              <span class="flex min-w-0 flex-1 items-center gap-2.5 text-start">
                <span :class="['size-2 shrink-0 rounded-full', DOT[row.tone]]" aria-hidden="true" />
                <span class="text-text-body text-compact shrink-0 font-normal">{{
                  typeLabel(row)
                }}</span>
                <OTruncatedText
                  v-if="row.stream && row.tone !== 'none'"
                  class="text-text-secondary min-w-0 text-xs font-normal max-sm:hidden"
                  >{{ raw(row.stream) }}</OTruncatedText
                >
              </span>
              <span class="flex shrink-0 items-baseline gap-2 text-xs font-normal">
                <span
                  :class="WORD[row.tone]"
                  :data-test="`overview-data-freshness-status-${row.type}`"
                  >{{ statusOf(row) }}</span
                >
                <span v-if="row.tone === 'quiet' && row.lastSeenUs" class="text-text-secondary">
                  {{ lastData(row.lastSeenUs) }}
                  <OTooltip :content="absolute(row.lastSeenUs)" />
                </span>
              </span>
            </OverviewRowButton>
          </div>
        </li>
      </ul>
    </div>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import { safeTimezone } from "@/utils/dashboard/calendarPeriods";
import { resolveBrowserTimezone } from "@/utils/timezone";
import { rangeRoute, recordRange } from "@/composables/firstEvent/confirmQuery";
import OverviewRowButton from "./OverviewRowButton.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import type { FreshnessRow, FreshnessTone } from "./overviewFreshness";
import { useOverviewTime } from "./useOverviewTime";

export type DataFreshnessState = "loading" | "error" | "ok";

// grey is never or unknown, amber is data that stopped (C5); arriving data stays calm
const DOT: Record<FreshnessTone, string> = {
  fresh: "bg-status-positive",
  quiet: "bg-status-warning-text",
  empty: "bg-border-strong",
  none: "bg-border-strong",
};

const WORD: Record<FreshnessTone, string> = {
  fresh: "text-text-secondary",
  quiet: "text-status-warning-text font-medium",
  empty: "text-text-muted",
  none: "text-text-muted",
};

const props = defineProps<{
  state: DataFreshnessState;
  rows: FreshnessRow[];
  /** The selected range, in microseconds. */
  range: { startTime: number; endTime: number };
  /** The same range spoken as words, e.g. "24 hours". */
  rangeWords: I18nText;
  /** The clock the ages are read against, in milliseconds. */
  now: number;
}>();

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { formatElapsed } = useOverviewTime();

const org = computed(() => store.state.selectedOrganization?.identifier ?? "");

const typeLabel = (row: FreshnessRow): I18nText =>
  row.type === "profiles" ? t("menu.profiles") : t(`overview.signals.${row.type}`);

const lastData = (lastSeenUs: number): I18nText => {
  const ms = props.now - Math.floor(lastSeenUs / 1000);
  if (ms < 60_000) return t("overview.health.justNow");
  return t("overview.health.lastData", { age: formatElapsed(ms) });
};

const statusOf = (row: FreshnessRow): I18nText => {
  if (row.tone === "none") return t("overview.dataHealth.status.notSetUp");
  if (row.tone === "empty" || !row.lastSeenUs) return t("overview.health.noRecords");
  if (row.tone === "quiet") return t("overview.health.noDataIn", { range: props.rangeWords });
  return lastData(row.lastSeenUs);
};

const absolute = (us: number): I18nText => {
  const zone = safeTimezone(resolveBrowserTimezone(store.state.timezone || "UTC"));
  return raw(formatTimestampInTimezone(us, "YYYY-MM-DD HH:mm", zone));
};

// a quiet type opens on its last records, so the link never lands on an empty range
const routeOf = (row: FreshnessRow) => {
  if (row.tone === "none" || !row.stream) {
    return { name: "ingestion", query: { org_identifier: org.value } };
  }
  const window =
    row.tone === "quiet" && row.lastSeenUs
      ? recordRange(row.lastSeenUs)
      : { startUs: props.range.startTime, endUs: props.range.endTime };
  return rangeRoute(org.value, row.type, row.stream, row.tone === "empty" ? undefined : window);
};
</script>
