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
  <div class="flex flex-col gap-3 pb-8" data-test="autoobserve-live-history">
    <span class="sr-only" role="status" data-test="autoobserve-live-history-announce">{{
      loadText
    }}</span>
    <LiveNoticeState
      v-if="notice"
      :notice="notice"
      size="block"
      :detail="incidentsState.detail"
      :busy="busy"
      data-test="autoobserve-live-history-error"
      retry-test="autoobserve-live-history-retry"
      @retry="retry"
    />
    <ul
      v-else-if="pending"
      class="flex flex-col"
      aria-hidden="true"
      data-test="autoobserve-live-history-skeleton"
    >
      <li
        v-for="i in loading ? SKELETON_ROWS : 0"
        :key="i"
        class="border-border-subtle flex gap-3 border-b py-3 last:border-b-0"
      >
        <span class="flex h-5 w-3 shrink-0 items-center justify-center">
          <OSkeleton animation="none" class="size-2 rounded-full" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <OSkeleton animation="none" class="h-4 w-16" />
          <OSkeleton animation="none" class="h-5 w-3/4" />
        </span>
      </li>
    </ul>
    <LiveSurfaceEmpty v-else-if="!rows.length" surface="history" @action="emit('see-issues')" />
    <p
      v-else-if="!shownRows.length"
      class="text-text-secondary py-3 text-sm"
      data-test="autoobserve-live-history-filter-empty"
    >
      {{ t("autoobserve.activityLive.history.filterEmpty") }}
    </p>
    <template v-else>
      <p
        v-if="partial"
        class="text-status-error-text flex items-center gap-1.5 text-xs"
        data-test="autoobserve-live-history-partial"
      >
        <OIcon name="lock" size="xs" class="shrink-0" />
        {{ partial }}
      </p>
      <div class="flex flex-col gap-4" data-test="autoobserve-live-history-list">
        <section
          v-for="day in days"
          :key="day.key"
          class="flex flex-col"
          :data-test="`autoobserve-live-history-day-${day.key}`"
        >
          <h3 class="text-text-secondary pb-1 text-xs font-semibold">{{ day.label }}</h3>
          <ul class="flex flex-col">
            <li
              v-for="row in day.rows"
              :key="row.id"
              class="border-border-subtle flex gap-3 border-b py-3 last:border-b-0"
              :data-test="`autoobserve-live-history-${row.id}`"
            >
              <span class="flex h-5 w-3 shrink-0 items-center justify-center">
                <OIcon v-if="row.byPerson" name="person" size="xs" class="text-text-secondary" />
                <span v-else class="size-2 rounded-full" :class="dotClass(row)" />
              </span>
              <span class="flex min-w-0 flex-col gap-1">
                <span class="text-text-secondary text-xs tabular-nums">{{ row.time }}</span>
                <p class="text-text-body text-sm leading-relaxed text-pretty">
                  {{ row.text }}
                  <OTag
                    v-if="row.status"
                    type="incidentStatus"
                    :value="row.status.value"
                    :label="row.status.label"
                    size="sm"
                    class="ms-1 align-middle"
                  />
                </p>
                <span
                  v-if="row.reason || row.undone"
                  class="text-text-secondary text-xs"
                  :data-test="`autoobserve-live-history-meta-${row.id}`"
                  >{{ [row.reason, row.undone].filter(Boolean).join(" · ") }}</span
                >
                <OButton
                  v-if="row.incidentId"
                  variant="ghost-primary"
                  size="xs"
                  icon-right="arrow-forward"
                  class="-ms-2 self-start"
                  :data-test="`autoobserve-live-history-open-${row.incidentId}`"
                  @click="emit('open-issue', row.incidentId)"
                >
                  {{ t("autoobserve.activityLive.history.openIssue") }}
                </OButton>
                <OButton
                  v-else-if="row.changeId"
                  variant="ghost-primary"
                  size="xs"
                  icon-right="arrow-forward"
                  class="-ms-2 self-start"
                  :data-test="`autoobserve-live-history-change-${row.changeId}`"
                  @click="emit('see-change', row.changeId)"
                >
                  {{ t("autoobserve.activityLive.history.seeChange") }}
                </OButton>
              </span>
            </li>
          </ul>
        </section>
      </div>
      <p
        v-if="truncated"
        class="text-text-secondary text-xs"
        data-test="autoobserve-live-history-newest"
      >
        {{ t("autoobserveLive.history.newest", { count: HISTORY_PAGE }, HISTORY_PAGE) }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import config from "@/aws-exports";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { isRouteDisabled } from "@/services/autoobserveDecisions";
import { autoobserveIncidentsPageQuery } from "@/services/autoobserve.queries";
import { decisionsPageQuery } from "@/composables/autoobserve/useDecisionRoute";
import LiveNoticeState from "./LiveNoticeState.vue";
import LiveSurfaceEmpty from "./LiveSurfaceEmpty.vue";
import {
  HISTORY_PAGE,
  historyDays,
  toHistoryRows,
  type LiveHistoryKind,
  type LiveHistoryRow,
} from "./historyFeed";
import { liveFailureOf, liveLoadText, liveNotice } from "./liveCopy";
import { useNow } from "@/composables/useNow";
import { stateOf, useHeldSkeleton, useLiveZone, useLoadPhase } from "./liveModel";

const props = withDefaults(defineProps<{ filter?: "all" | LiveHistoryKind }>(), { filter: "all" });
const emit = defineEmits<{
  "see-issues": [];
  "open-issue": [id: string];
  "see-change": [decisionId: string];
}>();

const SKELETON_ROWS = 4;

const { t } = useI18nTyped();
const store = useStore();
const zone = useLiveZone();
const now = useNow();

const me = computed<string | undefined>(() => store.state.userInfo?.email);
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const enterprise = config.isEnterprise === "true";

const incidents = useQuery(() => ({
  ...autoobserveIncidentsPageQuery(org.value, HISTORY_PAGE, 0),
  enabled: !!org.value,
}));
const decisions = useQuery(() => ({
  ...decisionsPageQuery(org.value, null, HISTORY_PAGE, 0, null),
  enabled: enterprise && !!org.value,
  retry: false,
}));

const retry = () => {
  void incidents.refetch();
  if (enterprise) void decisions.refetch();
};

const incidentsState = computed(() => stateOf(incidents, retry));
// A switched-off decisions route lists nothing; any other decisions failure fails the feed like incidents.
const decisionsFailed = computed(
  () => enterprise && decisions.isError.value && !isRouteDisabled(decisions.error.value),
);
const decisionsPending = computed(
  () => enterprise && decisions.isPending.value && !decisions.isError.value,
);

const incidentItems = computed(() => incidents.data.value?.items ?? []);
const decisionItems = computed(() => decisions.data.value?.decisions ?? []);

// One denied source leaves the other listed; a failure, or nothing left to list, fails the whole feed.
const deniedSource = computed<"incidents" | "decisions" | null>(() => {
  const state = incidentsState.value;
  if (state.status === "error" && state.failure === "denied" && decisionItems.value.length)
    return "incidents";
  if (
    decisionsFailed.value &&
    liveFailureOf(decisions.error.value) === "denied" &&
    incidents.isSuccess.value &&
    incidentItems.value.length
  )
    return "decisions";
  return null;
});
const partial = computed(() =>
  deniedSource.value ? t(`autoobserveLive.history.denied.${deniedSource.value}`) : null,
);

const notice = computed(() => {
  if (deniedSource.value) return null;
  const state = incidentsState.value;
  if (state.status === "error" && state.failure) return liveNotice(t, "history", state.failure);
  if (decisionsFailed.value) return liveNotice(t, "history", liveFailureOf(decisions.error.value));
  return null;
});
const busy = computed(() => incidents.isFetching.value || decisions.isFetching.value);
const loading = useHeldSkeleton(
  () => incidentsState.value.status === "loading" || decisionsPending.value,
);
const pending = computed(() => incidentsState.value.status === "loading" || decisionsPending.value);
const loadPhase = useLoadPhase(() => (pending.value ? "loading" : "ready"), loading);
const loadText = computed(() => liveLoadText(t, "history", loadPhase.value));

const rows = computed(() =>
  pending.value
    ? []
    : toHistoryRows(t, zone.value, incidentItems.value, decisionItems.value, me.value, now.value),
);
const shownRows = computed(() =>
  props.filter === "all" ? rows.value : rows.value.filter((row) => row.kind === props.filter),
);
const days = computed(() => historyDays(t, zone.value, shownRows.value, now.value));

// Open problems read red, resolved ones green, the rest neutral, as on the Issues list.
const dotClass = (row: LiveHistoryRow) => {
  if (row.status?.value === "open") return "bg-status-error-text";
  if (row.status?.value === "resolved") return "bg-status-success-text";
  return "bg-border-strong";
};

const truncated = computed(
  () =>
    !!incidents.data.value?.has_more ||
    (decisions.data.value?.total ?? 0) > HISTORY_PAGE ||
    (incidents.data.value?.items.length ?? 0) + (decisions.data.value?.decisions.length ?? 0) >
      HISTORY_PAGE,
);
</script>
