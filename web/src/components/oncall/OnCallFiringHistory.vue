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
  The individual past firings of this subject. Prior causes above answers what
  this usually turns out to be; this answers how often it fires and whether
  anybody answered — the two facts that separate a real problem from a rule
  that needs its threshold tuned.
-->
<template>
  <OCard variant="glass" data-test="oncall-firing-history">
    <OCardSection role="header" dense>
      <OText variant="card-title">{{ t("oncall.firingHistory") }}</OText>
    </OCardSection>

    <OCardSection role="body" dense>
      <p class="text-text-secondary mb-3 text-xs">{{ t("oncall.firingHistoryHint") }}</p>

      <OTable
        :data="firings"
        :columns="columns"
        row-key="id"
        :frame="false"
        :loading="loading"
        pagination="client"
        :show-global-filter="false"
        table-id="oncall-firing-history"
        data-test="oncall-firing-history-table"
        @row-click="(row: OnCallResponse) => emit('open', row.id)"
      >
        <template #cell-opened_at="{ row }">
          <OTimeCell :value="row.opened_at" unit="us" />
        </template>

        <template #cell-state="{ row }">
          <OTag type="oncallResponseState" :value="row.state" size="sm" />
        </template>

        <template #cell-acked_by="{ row }">
          <OUserCell v-if="row.acked_by" :value="row.acked_by" />
          <span v-else class="text-text-secondary text-sm">{{
            t("oncall.neverAcknowledged")
          }}</span>
        </template>

        <template #cell-cause="{ row }">
          <OTag v-if="row.cause" variant="amber-soft" size="sm">
            {{ t(`oncall.cause_${row.cause}`) }}
          </OTag>
          <span v-else class="text-text-secondary text-sm">{{ ABSENT }}</span>
        </template>

        <!-- A subject firing for the first time is the normal case, not an
             error, so it says so rather than showing an empty frame. -->
        <template #empty>
          <OEmptyState
            size="inline"
            preset="no-data"
            :description="t('oncall.firingHistoryEmpty')"
            data-test="oncall-firing-history-empty"
          />
        </template>
      </OTable>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { OnCallResponse } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

defineProps<{ firings: OnCallResponse[]; loading?: boolean }>();
const emit = defineEmits<{ open: [responseId: string] }>();

const { t } = useI18nTyped();

const ABSENT = raw("—");

const columns = computed<OTableColumnDef<OnCallResponse>[]>(() => [
  {
    id: "opened_at",
    header: t("oncall.openedAt"),
    accessorKey: "opened_at",
    sortable: true,
    size: 160,
  },
  {
    id: "state",
    header: t("oncall.state"),
    accessorKey: "state",
    size: 130,
  },
  {
    id: "acked_by",
    header: t("oncall.ackedBy"),
    accessorFn: (row: OnCallResponse) => row.acked_by ?? "",
  },
  {
    id: "cause",
    header: t("oncall.resolveCause"),
    accessorFn: (row: OnCallResponse) => row.cause ?? "",
  },
]);
</script>
