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

<!-- What has been sent to the reader: the open pages that still need them, then the history grouped by alert. -->
<template>
  <div class="flex flex-col gap-5" data-test="oncall-my-deliveries">
    <OEmptyState
      v-if="loadError !== null"
      size="inline"
      variant="error"
      :title="t('oncall.myDeliveriesLoadFailed')"
      :description="raw(loadError)"
      :action-label="t('oncall.retry')"
      data-test="oncall-my-deliveries-error"
      @action="refresh"
    />

    <template v-else>
      <section v-if="openRows.length" class="flex flex-col gap-2" data-test="oncall-my-needs-you">
        <OText variant="panel-title">{{ t("oncall.myNeedsYouTitle") }}</OText>
        <OTable
          :data="openRows"
          :columns="openColumns"
          row-key="response_id"
          :frame="false"
          :show-global-filter="false"
          pagination="none"
          table-id="oncall-my-needs-you"
          data-test="oncall-my-needs-you-table"
          @row-click="openPage"
        >
          <template #cell-priority="{ row }">
            <OTag type="alertPriority" :value="`p${row.priority}`" size="sm" />
          </template>
          <template #cell-name="{ row }">
            <OTruncatedText class="text-text-body">
              {{ raw(row.title || row.subject_id) }}
            </OTruncatedText>
          </template>
          <template #cell-state="{ row }">
            <OTag type="oncallResponseState" :value="row.response_state" size="sm" />
          </template>
          <template #cell-team="{ row }">
            <OTruncatedText class="text-text-secondary">
              {{ raw(teamName(row.team_id)) }}
            </OTruncatedText>
          </template>
          <template #cell-at="{ row }">
            <OTimeCell
              :value="row.at"
              unit="us"
              mode="relative"
              :timezone="store.state.timezone"
              :empty-label="raw('—')"
            />
          </template>
          <template #cell-actions="{ row }">
            <div class="flex items-center justify-end">
              <OButton
                v-if="isEscalating(row.response_state)"
                variant="ghost-warning"
                size="icon-sm"
                :loading="ackingId === row.response_id"
                :aria-label="t('oncall.acknowledge')"
                :data-test="`oncall-my-needs-you-ack-${row.response_id}`"
                @click.stop="acknowledge(row)"
              >
                <OIcon name="check-circle" size="sm" aria-hidden="true" />
                <OTooltip :content="t('oncall.acknowledge')" />
              </OButton>
              <span v-else class="size-8 shrink-0" aria-hidden="true" />
            </div>
          </template>
        </OTable>
      </section>

      <section class="flex flex-col gap-2" data-test="oncall-my-history">
        <div class="flex flex-wrap items-center gap-2">
          <OText variant="panel-title">{{ t("oncall.myHistoryTitle") }}</OText>
          <OTag
            v-if="unread"
            variant="primary-soft"
            size="sm"
            data-test="oncall-my-deliveries-unread"
          >
            {{ t("oncall.myDeliveriesUnread", { count: unread }, unread) }}
          </OTag>

          <span v-if="unread || unreadOnly" class="ms-auto flex flex-wrap items-center gap-2">
            <OCheckbox
              :model-value="unreadOnly"
              :label="t('oncall.myDeliveriesUnreadOnly')"
              data-test="oncall-my-deliveries-unread-toggle"
              @update:model-value="(v: CheckboxModelValue) => setUnreadOnly(!!v)"
            />
            <OButton
              v-if="unread"
              variant="outline"
              size="sm"
              :loading="marking"
              data-test="oncall-my-deliveries-read-all"
              @click="markAll"
            >
              <OIcon name="check" size="sm" />{{ t("oncall.myDeliveriesMarkAll") }}
            </OButton>
          </span>
        </div>

        <OTable
          v-if="historyRows.length || loading"
          ref="oTableRef"
          :data="historyRows"
          :columns="historyColumns"
          row-key="key"
          :frame="false"
          :loading="loading"
          pagination="client"
          :page-size="pageSize"
          :current-page="currentPage"
          :show-global-filter="false"
          table-id="oncall-my-deliveries"
          data-test="oncall-my-deliveries-table"
          @row-click="(row: HistoryRow) => openPage(row.latest)"
          @update:current-page="currentPage = $event"
          @update:page-size="pageSize = $event"
        >
          <template #cell-unread="{ row }">
            <span
              v-if="row.unread"
              class="bg-accent block size-2 rounded-full"
              :aria-label="t('oncall.myDeliveriesNew')"
              :data-test="`oncall-my-delivery-unread-${row.latest.event_id}`"
            />
          </template>
          <template #cell-page="{ row }">
            <span class="flex min-w-0 items-center gap-1.5">
              <OTruncatedText class="text-text-body min-w-0">
                {{ raw(row.latest.title || row.latest.subject_id) }}
              </OTruncatedText>
              <OTag v-if="row.pages > 1" variant="default-soft" size="sm">
                {{ raw(`×${row.pages}`) }}
              </OTag>
              <OTruncatedText class="text-text-secondary min-w-0 text-xs">
                {{ raw(row.teams.map(teamName).join(", ")) }}
              </OTruncatedText>
            </span>
          </template>
          <template #cell-state="{ row }">
            <OTag type="oncallResponseState" :value="row.latest.response_state" size="sm" />
          </template>
          <!-- Only channels that were tried: one never attempted is not a failure. -->
          <template #cell-channels="{ row }">
            <span class="flex items-center gap-1.5">
              <span
                v-for="attempt in row.channels"
                :key="attempt.channel"
                class="inline-flex"
                :data-test="`oncall-my-delivery-channel-${row.latest.event_id}-${attempt.channel}`"
              >
                <OIcon
                  :name="CHANNEL_ICON[attempt.channel]"
                  size="sm"
                  :class="attempt.delivered ? 'text-status-success-text' : 'text-status-error-text'"
                />
                <OTooltip
                  :content="
                    attempt.delivered
                      ? t('oncall.myDeliveriesLanded', {
                          channel: t(`oncall.channel_${attempt.channel}`),
                        })
                      : t('oncall.myDeliveriesFailed', {
                          channel: t(`oncall.channel_${attempt.channel}`),
                        })
                  "
                />
              </span>
            </span>
          </template>
          <template #cell-at="{ row }">
            <OTimeCell
              :value="row.latest.at"
              unit="us"
              mode="relative"
              :timezone="store.state.timezone"
              :empty-label="raw('—')"
            />
          </template>
          <template #cell-actions="{ row }">
            <div class="flex items-center justify-end">
              <!-- A resolved page never counts as unread, so there is nothing to mark on one. -->
              <ODropdown v-if="canMark(row)" side="bottom" align="end">
                <template #trigger>
                  <OButton
                    variant="ghost"
                    size="icon-sm"
                    icon-left="more-vert"
                    :loading="marking"
                    :aria-label="t('oncall.moreActions')"
                    :data-test="`oncall-my-delivery-more-${row.latest.event_id}`"
                    @click.stop
                  >
                    <OTooltip side="bottom" :content="t('oncall.moreActions')" />
                  </OButton>
                </template>
                <ODropdownItem
                  :icon-left="row.unread ? 'check-circle' : 'mail'"
                  :data-test="`oncall-my-delivery-toggle-${row.latest.event_id}`"
                  @select="toggleRead(row)"
                >
                  {{
                    row.unread
                      ? t("oncall.myDeliveriesMarkRead")
                      : t("oncall.myDeliveriesMarkUnread")
                  }}
                </ODropdownItem>
              </ODropdown>
            </div>
          </template>
        </OTable>

        <OEmptyState
          v-else
          size="block"
          icon="notifications-active"
          :title="unreadOnly ? t('oncall.myDeliveriesNoUnread') : t('oncall.myDeliveriesNone')"
          :action-label="!unreadOnly && canTest ? t('oncall.mineTestTeamPage') : undefined"
          data-test="oncall-my-deliveries-empty"
          @action="emit('test-page')"
        />
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import { useMutation } from "@tanstack/vue-query";
import { queryClient } from "@/composables/query/queryClient";
import { useListViewState } from "@/composables/useListViewState";
import {
  acknowledgeResponseMutation,
  markDeliveriesReadMutation,
  myDeliveriesQuery,
} from "@/services/oncall.queries";
import type { Channel, MyDeliveries, MyDelivery } from "@/ts/interfaces/oncall";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import { raw, useI18nTyped } from "@/types/i18n";
import { isEscalating } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    /** Team names, so a row reads as a team rather than an id. */
    teamNames?: Record<string, string>;
    /** Whether the empty history offers the team test page as its next step. */
    canTest?: boolean;
  }>(),
  { teamNames: () => ({}), canTest: false },
);

const emit = defineEmits<{ unread: [count: number]; "test-page": [] }>();

const CHANNEL_ICON: Record<Channel, IconName> = {
  email: "mail",
  slack: "chat",
  sms: "smartphone",
  voice: "call",
  webhook: "webhook",
};

/** One alert's pages to the reader, newest first; a resolved page is never unread. */
interface HistoryRow {
  key: string;
  latest: MyDelivery;
  /** Distinct pages, not sends: one page can reach the reader on three channels. */
  pages: number;
  teams: string[];
  channels: { channel: Channel; delivered: boolean }[];
  unread: boolean;
  eventIds: string[];
}

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization.identifier);

const rows = ref<MyDelivery[]>([]);
const unread = ref(0);
const loading = ref(false);
const marking = ref(false);
const savedView = useListViewState("oncall-my-deliveries", {
  unreadOnly: false,
  currentPage: 1,
  pageSize: 20,
});
const unreadOnly = ref(savedView.unreadOnly);
const currentPage = ref(savedView.currentPage);
const pageSize = ref(savedView.pageSize);
const oTableRef = ref<any>(null);

watch(unreadOnly, () => {
  currentPage.value = 1;
});
watch([unreadOnly, currentPage, pageSize], () => {
  Object.assign(savedView, {
    unreadOnly: unreadOnly.value,
    currentPage: currentPage.value,
    pageSize: pageSize.value,
  });
});
// The inbox loads after mount and TanStack resets to page 0 on its own deferred queue; setTimeout(0) runs after it so the restored page wins.
let pageRestored = false;
watch(loading, (isLoading) => {
  if (isLoading || pageRestored) return;
  pageRestored = true;
  setTimeout(() => oTableRef.value?.restorePage?.(currentPage.value), 0);
});

const teamName = (id: string) => props.teamNames[id] ?? id;

const countsAsUnread = (row: MyDelivery) => !row.read && row.response_state !== "resolved";

const canMark = (row: HistoryRow) => row.unread || row.latest.response_state !== "resolved";

/// The open pages, one row per page with its newest send.
const openRows = computed<MyDelivery[]>(() => {
  const byPage = new Map<string, MyDelivery>();
  for (const row of rows.value) {
    if (row.response_state === "resolved") continue;
    const seen = byPage.get(row.response_id);
    if (!seen || seen.at < row.at) byPage.set(row.response_id, row);
  }
  return [...byPage.values()].sort((a, b) => b.at - a.at);
});

const historyRows = computed<HistoryRow[]>(() => {
  const groups = new Map<string, MyDelivery[]>();
  for (const row of rows.value) {
    const key = `${row.subject_type}:${row.subject_id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => b.at - a.at);
      const channels = new Map<Channel, boolean>();
      for (const send of sorted.filter((one) => one.response_id === sorted[0].response_id)) {
        channels.set(send.channel, (channels.get(send.channel) ?? false) || send.delivered);
      }
      return {
        key,
        latest: sorted[0],
        pages: new Set(sorted.map((one) => one.response_id)).size,
        teams: [...new Set(sorted.map((one) => one.team_id))],
        channels: [...channels.entries()].map(([channel, delivered]) => ({ channel, delivered })),
        unread: sorted.some(countsAsUnread),
        eventIds: sorted.map((one) => one.event_id),
      };
    })
    .sort((a, b) => b.latest.at - a.latest.at);
});

const openColumns = computed<OTableColumnDef<MyDelivery>[]>(() => [
  { id: "priority", header: t("oncall.priority"), size: 72, sortable: false },
  {
    id: "name",
    header: t("oncall.myDeliveriesPage"),
    accessorFn: (row: MyDelivery) => row.title ?? row.subject_id,
    sortable: false,
    meta: { isName: true, flex: true },
  },
  { id: "state", header: t("oncall.myDeliveriesStatus"), size: 128, sortable: false },
  { id: "team", header: t("oncall.team"), size: 160, sortable: false },
  { id: "at", header: t("oncall.myDeliveriesSent"), size: 120, sortable: false },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    pinned: "right",
    sortable: false,
    size: 64,
    meta: { align: "center", actionCount: 1 },
  },
]);

const historyColumns = computed<OTableColumnDef<HistoryRow>[]>(() => [
  { id: "unread", header: raw(""), size: 32, sortable: false },
  {
    id: "page",
    header: t("oncall.myDeliveriesPage"),
    accessorFn: (row: HistoryRow) => row.latest.title ?? row.latest.subject_id,
    sortable: false,
    meta: { isName: true, flex: true },
  },
  { id: "state", header: t("oncall.myDeliveriesStatus"), size: 120, sortable: false },
  { id: "channels", header: t("oncall.myDeliveriesChannels"), size: 96, sortable: false },
  { id: "at", header: t("oncall.myDeliveriesLast"), size: 120, sortable: false },
  // An all-resolved history has nothing to mark, so an empty Actions column would only take width.
  ...(historyRows.value.some(canMark)
    ? [
        {
          id: "actions",
          header: t("oncall.actions"),
          isAction: true,
          pinned: "right" as const,
          sortable: false,
          size: 64,
          meta: { align: "center" as const, actionCount: 1 },
        },
      ]
    : []),
]);

const markWrite = useMutation(() => markDeliveriesReadMutation(orgId.value));

/// Expiring the entry before the fetch keeps a forced read at one request rather than two.
async function read<T>(
  options: { queryKey: readonly unknown[]; [k: string]: any },
  force: boolean,
): Promise<T> {
  if (force) {
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
  }
  return queryClient.fetchQuery(options as any) as Promise<T>;
}

// The newest read: a slower answer for a filter the reader has already left must not overwrite the inbox.
let latestDeliveriesRead = 0;
let loadedOnce = false;
/// Set only when the first load fails, so "nothing was sent" is never said for a read that did not happen.
const loadError = ref<string | null>(null);

async function fetchDeliveries(force = false) {
  loading.value = true;
  const readId = ++latestDeliveriesRead;
  try {
    const data = await read<MyDeliveries | null>(
      myDeliveriesQuery(orgId.value, unreadOnly.value ? { unread_only: true } : {}),
      force,
    );
    if (readId !== latestDeliveriesRead) return;
    rows.value = data?.deliveries ?? [];
    // Counted here, not from the server's figure: a resolved page has nothing left to read.
    setUnread(new Set(rows.value.filter(countsAsUnread).map((row) => row.response_id)).size);
    loadedOnce = true;
    loadError.value = null;
  } catch (err: any) {
    if (readId !== latestDeliveriesRead) return;
    // A failed refresh keeps the inbox on screen rather than emptying it and zeroing the badge.
    if (loadedOnce) {
      toast({
        variant: "error",
        message: raw(err?.response?.data?.message) || t("oncall.refreshFailed"),
      });
      return;
    }
    rows.value = [];
    setUnread(0);
    loadError.value = String(err?.response?.data?.message ?? err?.message ?? "");
  } finally {
    if (readId === latestDeliveriesRead) loading.value = false;
  }
}

function setUnread(count: number) {
  unread.value = count;
  emit("unread", count);
}

function setUnreadOnly(on: boolean) {
  unreadOnly.value = on;
  void fetchDeliveries();
}

/// The count travels back on the write, so the badge is right without a second
/// request — and right even when some ids named rows already read.
async function mark(data: { event_ids?: string[]; all?: boolean; read?: boolean }) {
  marking.value = true;
  try {
    await markWrite.mutateAsync(data);
    // Unforced: the write already expired this scope, so the re-read that repaints the rows costs one request.
    await fetchDeliveries();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.myDeliveriesMarkFailed"),
    });
  } finally {
    marking.value = false;
  }
}

const markAll = () => mark({ all: true, read: true });

/// Both directions: an unread group reads in full, a read one puts back only its newest send.
const toggleRead = (row: HistoryRow) =>
  row.unread
    ? mark({ event_ids: row.eventIds, read: true })
    : mark({ event_ids: [row.latest.event_id], read: false });

const ackWrite = useMutation(() => acknowledgeResponseMutation(orgId.value));
const ackingId = ref("");

async function acknowledge(row: MyDelivery) {
  ackingId.value = row.response_id;
  try {
    await ackWrite.mutateAsync(row.response_id);
    toast({ variant: "success", message: t("oncall.myAcknowledged") });
    await fetchDeliveries(true);
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.acknowledgeFailed"),
    });
  } finally {
    ackingId.value = "";
  }
}

function openPage(row: MyDelivery) {
  router.push({
    name: "onCallResponseDetail",
    params: { responseId: row.response_id },
    query: { org_identifier: orgId.value },
  });
}

/// A caller reaching for this has written something the cache cannot know about, so it forces.
const refresh = () => fetchDeliveries(true);

onMounted(fetchDeliveries);

defineExpose({ refresh });
</script>
