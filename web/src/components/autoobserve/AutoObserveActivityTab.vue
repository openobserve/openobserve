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
  <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-test="autoobserve-activity">
    <div
      class="border-border-default px-page-edge flex shrink-0 flex-wrap items-center gap-2 border-b py-2"
      data-test="autoobserve-activity-toolbar"
    >
      <OToggleGroup
        :model-value="filter"
        :aria-label="t('autoobserve.activity.outcomeFilter')"
        mobile-dropdown
        data-test="autoobserve-activity-status"
        @update:model-value="(v) => v && (filter = v as LedgerFilter)"
      >
        <OToggleGroupItem
          v-for="f in FILTERS"
          :key="f"
          :value="f"
          size="sm"
          :disabled="!counts[f] && f !== filter"
          :data-test="`autoobserve-activity-chip-${f}`"
        >
          {{ t(FILTER_KEY[f]) }}
          <span class="font-semibold tabular-nums">{{ counts[f] }}</span>
        </OToggleGroupItem>
      </OToggleGroup>
    </div>
    <div
      class="px-page-edge border-table-row-divider flex shrink-0 items-center gap-2 border-b py-1.5"
    >
      <OIcon name="history" size="sm" class="text-text-secondary shrink-0" />
      <span class="text-text-secondary text-xs">{{
        t("autoobserve.activityLive.ledgerHint")
      }}</span>
    </div>

    <OContent y class="min-h-0 min-w-0 flex-1 overflow-auto">
      <div
        v-if="live.skeleton.value || requestsLoading"
        class="flex flex-col gap-2"
        aria-hidden="true"
        data-test="autoobserve-activity-skeleton"
      >
        <OSkeleton v-for="n in 4" :key="n" animation="none" class="h-9 w-full" />
      </div>
      <LiveNoticeState
        v-else-if="live.notice.value"
        :notice="live.notice.value"
        size="block"
        :busy="live.busy.value"
        data-test="autoobserve-activity-error"
        retry-test="autoobserve-activity-retry"
        @retry="live.retry()"
      />
      <div
        v-else-if="groups.length"
        class="border-border-subtle rounded-surface bg-surface-base relative overflow-x-auto border"
      >
        <table class="w-full min-w-[52rem] border-collapse text-sm" data-test="autoobserve-ledger">
          <caption class="sr-only">
            {{
              t("autoobserve.activityLive.ledgerHint")
            }}
          </caption>
          <thead>
            <tr class="border-table-row-divider bg-table-header-bg border-b">
              <th
                v-for="col in COLUMNS"
                :key="col"
                scope="col"
                class="text-table-header-text text-2xs px-1.5 py-1.5 text-start font-medium tracking-wide whitespace-nowrap uppercase first:ps-3"
              >
                <span :class="col === 'actions' ? 'sr-only' : ''">{{ t(COLUMN_KEY[col]) }}</span>
              </th>
            </tr>
          </thead>
          <tbody
            v-if="(filter === 'all' || filter === 'pending') && approvals.length"
            data-test="autoobserve-activity-pending"
          >
            <tr>
              <th
                :colspan="COLUMNS.length"
                scope="colgroup"
                class="bg-surface-panel border-table-row-divider text-status-warning-text border-b px-3 py-1 text-start text-xs font-medium"
                data-test="autoobserve-activity-group-pending"
              >
                <span class="inline-flex items-center gap-1.5">
                  <OIcon name="schedule" size="xs" aria-hidden="true" />
                  {{ t("autoobserve.activityLive.approvals") }}
                  <span class="text-text-secondary tabular-nums">· {{ approvals.length }}</span>
                </span>
              </th>
            </tr>
            <tr
              v-for="request in approvals"
              :key="request.id"
              class="border-table-row-divider border-b"
              :data-test="`autoobserve-ledger-pending-${request.id}`"
            >
              <td
                class="border-s-status-warning-text border-s-4 py-2 ps-2.5 pe-2 text-xs whitespace-nowrap"
              >
                <span class="text-text-secondary">{{ t("autoobserve.activityLive.waiting") }}</span>
              </td>
              <td class="px-1.5 py-2">
                <span class="text-text-heading font-medium">{{ request.insight.headline }}</span>
                <span v-if="request.insight.why" class="text-text-secondary block text-xs">{{
                  request.insight.why
                }}</span>
              </td>
              <td class="text-text-body max-w-[16rem] truncate px-1.5 py-2 text-xs">
                {{ alertOf(request) }}
              </td>
              <td class="text-text-secondary px-1.5 py-2 text-xs">
                {{ t("autoobserve.activityLive.proposedBy") }}
              </td>
              <td class="px-1.5 py-2">
                <OTag
                  variant="warning-soft"
                  size="xs"
                  :label="t('autoobserve.activityLive.needsOk')"
                />
              </td>
              <td class="px-1.5 py-2 pe-3">
                <span class="flex justify-end gap-1">
                  <OButton
                    v-if="request.insight.dismissable"
                    variant="ghost-muted"
                    size="xs"
                    :data-test="`autoobserve-ledger-pending-${request.id}-dismiss`"
                    @click="dismiss(request.insight)"
                  >
                    {{ t("autoobserve.activityLive.reject") }}
                  </OButton>
                  <OButton
                    variant="outline"
                    size="xs"
                    :disabled="!!request.insight.cta?.locked"
                    :title="request.insight.cta?.locked ?? undefined"
                    :data-test="`autoobserve-ledger-pending-${request.id}-review`"
                    @click="request.insight.cta && run(request.id, request.insight.cta)"
                  >
                    {{ t("autoobserve.activityLive.reviewEdit") }}
                  </OButton>
                </span>
              </td>
            </tr>
          </tbody>
          <tbody v-if="shown.length" data-test="autoobserve-activity-changes">
            <tr>
              <th
                :colspan="COLUMNS.length"
                scope="colgroup"
                class="bg-surface-panel border-table-row-divider text-text-body border-b px-3 py-1 text-start text-xs font-medium"
                data-test="autoobserve-activity-group-changes"
              >
                {{ t("autoobserve.activityLive.changes") }}
                <span class="text-text-secondary tabular-nums">· {{ filtered.length }}</span>
              </th>
            </tr>
            <template v-for="change in shown" :key="change.id">
              <tr
                class="border-table-row-divider hover:bg-table-row-hover-bg cursor-pointer border-b"
                :class="expanded[change.id] ? 'bg-table-row-expanded-bg' : ''"
                :data-test="`autoobserve-ledger-${change.id}`"
                @click="toggle(change.id)"
              >
                <td
                  class="border-s-ingest-accent-amber border-s-4 py-2 ps-2.5 pe-2 whitespace-nowrap"
                >
                  <span class="text-text-body text-xs tabular-nums">{{
                    timeText(live.zone.value, change.at, live.now.value)
                  }}</span>
                </td>
                <td class="text-text-heading px-1.5 py-2">
                  <span v-for="(shift, i) in change.shifts" :key="i" class="block text-xs">
                    <span class="text-text-secondary line-through">{{ shift.from }}</span>
                    →
                    <span class="font-semibold">{{ shift.to }}</span>
                    <span class="text-text-secondary"> · {{ shift.setting }}</span>
                  </span>
                </td>
                <td class="text-text-body max-w-[16rem] truncate px-1.5 py-2 text-xs">
                  {{ change.entry.title }}
                </td>
                <td class="text-text-secondary px-1.5 py-2 text-xs">
                  {{ whoText(t, change.entry, live.me.value) }}
                </td>
                <td class="px-1.5 py-2">
                  <OTag
                    :variant="STATE_LOOK[change.state].variant"
                    size="xs"
                    :label="t(STATE_LOOK[change.state].key)"
                  />
                </td>
                <td class="px-1.5 py-2 pe-3" @click.stop>
                  <span class="flex justify-end gap-1">
                    <OButton
                      v-if="change.state === 'done'"
                      variant="ghost-muted"
                      size="xs"
                      icon-left="undo"
                      :loading="live.isUndoing(change)"
                      :data-test="`autoobserve-ledger-${change.id}-undo`"
                      @click="void live.undo(change)"
                    >
                      {{ t("autoobserve2.activityPage.actions.undo") }}
                    </OButton>
                    <OButton
                      variant="ghost-muted"
                      size="xs"
                      :icon-left="expanded[change.id] ? 'expand-less' : 'expand-more'"
                      :aria-expanded="!!expanded[change.id]"
                      :aria-label="
                        expanded[change.id]
                          ? t('autoobserve2.activityPage.actions.hideDetails')
                          : t('autoobserve2.activityPage.actions.showDetails')
                      "
                      :data-test="`autoobserve-ledger-${change.id}-expand`"
                      @click="toggle(change.id)"
                    />
                  </span>
                </td>
              </tr>
              <tr v-if="expanded[change.id]" class="border-table-row-divider border-b">
                <td :colspan="COLUMNS.length" class="p-3">
                  <ChangeDetails
                    :change="change"
                    :actors="live.actorsOf(change)"
                    :alert-href="live.alertHref(change)"
                  />
                </td>
              </tr>
            </template>
            <tr v-if="capped.more">
              <td :colspan="COLUMNS.length" class="px-1.5 py-1">
                <OButton
                  variant="ghost-primary"
                  size="xs"
                  icon-right="expand-more"
                  data-test="autoobserve-activity-more"
                  @click="showAll = true"
                >
                  {{ t("autoobserve.activityLive.showMore", { count: capped.more }, capped.more) }}
                </OButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p
        v-else-if="changes.length || approvals.length"
        class="text-text-secondary py-6 text-center text-sm"
        data-test="autoobserve-activity-filter-empty"
      >
        {{ t("autoobserve2.activityPage.empty.filter") }}
      </p>
      <LiveSurfaceEmpty v-else surface="changes" @action="emit('see-suggestions')" />
    </OContent>
    <AlertCalibrationDismissDialog
      v-if="dismissTarget"
      v-model:open="dismissOpen"
      :finding="dismissTarget"
    />
    <ReviewChangeDialog v-if="reviewTarget" v-model:open="reviewOpen" :target="reviewTarget" />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import OContent from "@/lib/core/Content/OContent.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import AlertCalibrationDismissDialog from "@/components/alert_calibration/AlertCalibrationDismissDialog.vue";
import ReviewChangeDialog from "./decisions/ReviewChangeDialog.vue";
import LiveNoticeState from "./live/LiveNoticeState.vue";
import LiveSurfaceEmpty from "./live/LiveSurfaceEmpty.vue";
import type { LiveRequest } from "./live/liveAdapter";
import { useInsightActions } from "./insight/useInsightActions";
import ChangeDetails from "./v2/ChangeDetails.vue";
import {
  STATE_LOOK,
  capList,
  changeCounts,
  matches,
  timeText,
  whoText,
  type ChangeFilter,
} from "./v2/changes";
import { useLiveChanges } from "./v2/useLiveChanges";

type LedgerFilter = ChangeFilter | "pending";

const COLUMNS = ["when", "change", "on", "who", "state", "actions"] as const;

const COLUMN_KEY: Record<(typeof COLUMNS)[number], I18nKey> = {
  when: "autoobserve.activityLive.columns.when",
  change: "autoobserve.activityLive.columns.change",
  on: "autoobserve.activityLive.columns.on",
  who: "autoobserve.activityLive.columns.who",
  state: "autoobserve.activityLive.columns.state",
  actions: "autoobserve.activityLive.columns.actions",
};

const FILTERS: LedgerFilter[] = ["all", "pending", "inForce", "undone"];

const FILTER_KEY: Record<LedgerFilter, I18nKey> = {
  all: "autoobserve2.activityPage.filters.all",
  pending: "autoobserve.activityLive.filters.pending",
  inForce: "autoobserve.activityLive.filters.inForce",
  undone: "autoobserve.activityLive.filters.undone",
};

const props = withDefaults(defineProps<{ requests?: LiveRequest[]; requestsLoading?: boolean }>(), {
  requests: () => [],
  requestsLoading: false,
});
const emit = defineEmits<{ "see-suggestions": [] }>();

const { t } = useI18nTyped();
const live = useLiveChanges();
const { run, dismiss, dismissTarget, dismissOpen, reviewTarget, reviewOpen } = useInsightActions();

const filter = ref<LedgerFilter>("all");
const expanded = reactive<Record<string, boolean>>({});

// Only a proposal whose next step is the Review change editor waits for an approval here.
const approvals = computed(() =>
  props.requests.filter((r) => r.insight.cta?.target.type === "review_change"),
);
const changes = computed(() => live.changes.value);
// All counts every row the All filter lists, approvals included.
const counts = computed(() => {
  const listed = changeCounts(changes.value);
  return { ...listed, all: listed.all + approvals.value.length, pending: approvals.value.length };
});
const alertOf = (request: LiveRequest) => {
  const target = request.insight.cta?.target;
  return target?.type === "review_change" ? target.change.alertName : request.insight.meta;
};
const filtered = computed(() =>
  filter.value === "pending"
    ? []
    : changes.value.filter((c) => matches(c, filter.value as ChangeFilter)),
);
const showAll = ref(false);
const capped = computed(() => capList(filtered.value, showAll.value));
const shown = computed(() => capped.value.shown);
const groups = computed(() =>
  [
    filter.value === "all" || filter.value === "pending" ? approvals.value.length : 0,
    filtered.value.length,
  ].filter(Boolean),
);

const toggle = (id: string) => {
  expanded[id] = !expanded[id];
};
</script>
