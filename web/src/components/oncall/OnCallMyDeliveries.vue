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
  "What was I sent last night, and did any of it arrive?"

  The delivery ledger answers that per RECORD — open the page, read who it
  reached. Nobody paged at 3am opens twenty records to find out whether their
  own phone was one of them, and until now that was the only way: the endpoint
  returned `total: 19, unread: 19` on the audit instance and the string appeared
  nowhere in the product.

  A failed row is the one that matters, so it says so on the row rather than
  making the reader compare a tick column. `response_state` is the state NOW,
  not when the page went out — an inbox row for something already resolved
  should say so, or somebody chases a fire that is already out.
-->
<template>
  <div class="flex flex-col gap-3" data-test="oncall-my-deliveries">
    <div class="flex flex-wrap items-center gap-2">
      <OText variant="panel-title">{{ t("oncall.myDeliveriesTitle") }}</OText>
      <OTag v-if="unread" variant="primary-soft" size="sm" data-test="oncall-my-deliveries-unread">
        {{ t("oncall.myDeliveriesUnread", { count: unread }, unread) }}
      </OTag>

      <span class="ms-auto flex flex-wrap items-center gap-2">
        <OCheckbox
          :model-value="unreadOnly"
          :label="t('oncall.myDeliveriesUnreadOnly')"
          data-test="oncall-my-deliveries-unread-toggle"
          @update:model-value="(v: CheckboxModelValue) => setUnreadOnly(!!v)"
        />
        <!-- Clearing the inbox is the whole point of a badge, so it is one
             click and it is not hidden behind a selection. -->
        <OButton
          v-if="unread"
          variant="outline"
          size="sm-action"
          :loading="marking"
          data-test="oncall-my-deliveries-read-all"
          @click="markAll"
        >
          {{ t("oncall.myDeliveriesMarkAll") }}
        </OButton>
      </span>
    </div>

    <OTable
      v-if="rows.length || loading"
      :data="rows"
      :columns="columns"
      row-key="event_id"
      :frame="false"
      :loading="loading"
      pagination="client"
      :show-global-filter="false"
      table-id="oncall-my-deliveries"
      data-test="oncall-my-deliveries-table"
      @row-click="openPage"
    >
      <template #cell-page="{ row }">
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="flex items-center gap-1.5">
            <!-- Unread is a dot, not a bold row: a list where most rows shout
                 is a list where none of them do. -->
            <OTag
              v-if="!row.read"
              variant="primary-soft"
              size="xs"
              :data-test="`oncall-my-delivery-unread-${row.event_id}`"
            >
              {{ t("oncall.myDeliveriesNew") }}
            </OTag>
            <OText variant="body-strong" as="span" truncate>
              {{ raw(row.title || row.subject_id) }}
            </OText>
          </span>
          <span class="flex flex-wrap items-center gap-1">
            <OTag type="alertPriority" :value="`p${row.priority}`" size="xs" />
            <OTag type="oncallResponseState" :value="row.response_state" size="xs" />
            <OText variant="meta">{{ raw(teamName(row.team_id)) }}</OText>
          </span>
        </span>
      </template>

      <!-- Whether it landed, said as the answer rather than as a tick: an
           attempt that failed is the row this screen exists for. -->
      <template #cell-landed="{ row }">
        <OTag
          :variant="row.delivered ? 'success-soft' : 'error-soft'"
          size="sm"
          :data-test="`oncall-my-delivery-landed-${row.event_id}`"
        >
          {{
            row.delivered
              ? t("oncall.myDeliveriesLanded", { channel: t(`oncall.channel_${row.channel}`) })
              : t("oncall.myDeliveriesFailed", { channel: t(`oncall.channel_${row.channel}`) })
          }}
        </OTag>
      </template>

      <template #cell-at="{ row }">
        <OText variant="meta">{{ raw(formatInZone(row.at, browserZone)) }}</OText>
      </template>

      <template #cell-actions="{ row }">
        <OButton
          variant="ghost"
          size="xs"
          :data-test="`oncall-my-delivery-toggle-${row.event_id}`"
          @click.stop="toggleRead(row)"
        >
          {{ row.read ? t("oncall.myDeliveriesMarkUnread") : t("oncall.myDeliveriesMarkRead") }}
        </OButton>
      </template>
    </OTable>

    <OEmptyState
      v-else
      size="inline"
      preset="no-data"
      :description="unreadOnly ? t('oncall.myDeliveriesNoUnread') : t('oncall.myDeliveriesNone')"
      data-test="oncall-my-deliveries-empty"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import oncallService from "@/services/oncall";
import type { MyDelivery } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatInZone } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    /** Team names, so a row reads as a team rather than an id. */
    teamNames?: Record<string, string>;
  }>(),
  { teamNames: () => ({}) },
);

const emit = defineEmits<{ unread: [count: number] }>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization.identifier);

const rows = ref<MyDelivery[]>([]);
const unread = ref(0);
const loading = ref(false);
const marking = ref(false);
const unreadOnly = ref(false);

/// This is the reader's own inbox, so it is rendered in the reader's own clock
/// — unlike a schedule, which belongs to its team's zone.
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const teamName = (id: string) => props.teamNames[id] ?? id;

const columns = computed<OTableColumnDef<MyDelivery>[]>(() => [
  {
    id: "page",
    header: t("oncall.myDeliveriesPage"),
    accessorFn: (row: MyDelivery) => row.title ?? row.subject_id,
    meta: { isName: true },
  },
  {
    id: "landed",
    header: t("oncall.myDeliveriesLandedColumn"),
    accessorFn: (row: MyDelivery) => (row.delivered ? 1 : 0),
  },
  {
    id: "at",
    header: t("oncall.myDeliveriesSent"),
    accessorFn: (row: MyDelivery) => row.at,
  },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    sortable: false,
    size: 110,
    meta: { align: "center", cellClass: "actions-column", actionCount: 1 },
  },
]);

async function fetchDeliveries() {
  loading.value = true;
  try {
    const res = await oncallService.myDeliveries({
      org_identifier: orgId.value,
      ...(unreadOnly.value ? { unread_only: true } : {}),
    });
    rows.value = res.data?.deliveries ?? [];
    // `unread` ignores the filter on purpose — it is the badge, and it must not
    // change because somebody ticked "unread only".
    setUnread(res.data?.unread ?? 0);
  } catch {
    rows.value = [];
    setUnread(0);
  } finally {
    loading.value = false;
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
    const res = await oncallService.markDeliveriesRead({ org_identifier: orgId.value, data });
    setUnread(res.data?.unread ?? unread.value);
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

/// Both directions. Somebody who dismissed a page by accident at 3am has to be
/// able to put it back, and the server takes `read: false` for exactly that.
const toggleRead = (row: MyDelivery) => mark({ event_ids: [row.event_id], read: !row.read });

function openPage(row: MyDelivery) {
  router.push({
    name: "onCallResponseDetail",
    params: { responseId: row.response_id },
    query: { org_identifier: orgId.value },
  });
}

onMounted(fetchDeliveries);

defineExpose({ refresh: fetchDeliveries });
</script>
