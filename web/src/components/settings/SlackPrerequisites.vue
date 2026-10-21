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

<script setup lang="ts">
import { computed, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw, useI18nTyped } from "@/types/i18n";
import type { SlackPrerequisiteCheck } from "@/types/slack";
import { checkIcon, checkIconClass } from "./slackCheckStatus";

const props = defineProps<{
  checks: SlackPrerequisiteCheck[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  recheck: [];
  /** True while a check fails; a warning never blocks (AC-7.1). */
  blocking: [blocked: boolean];
}>();

const { t } = useI18nTyped();

const failed = computed(() => props.checks.filter((c) => c.status === "fail").length);

watch(failed, (n) => emit("blocking", n > 0), { immediate: true });

const columns = computed<OTableColumnDef<SlackPrerequisiteCheck>[]>(() => [
  { id: "setting", header: t("slackApp.prereq.columnSetting"), size: 260 },
  { id: "result", header: t("slackApp.prereq.columnResult"), meta: { flex: true } },
]);
</script>

<template>
  <div class="flex flex-col gap-3" data-test="slack-prereq">
    <OTable
      :data="checks"
      :columns="columns"
      row-key="id"
      pagination="none"
      :show-global-filter="false"
      :loading="loading"
      :cell-overflow-tooltip="false"
      wrap
      dense
    >
      <template #cell-setting="{ row }">
        <span class="flex items-center gap-2">
          <OIcon
            :name="checkIcon(row.status)"
            size="sm"
            :class="checkIconClass(row.status)"
            :label="t(`slackApp.status.${row.status}`)"
          />
          <code v-if="row.variable" class="text-compact">{{ raw(row.variable) }}</code>
          <span v-else>{{ t(`slackApp.prereq.names.${row.id}`) }}</span>
        </span>
      </template>
      <template #cell-result="{ row }">
        <div
          class="flex flex-col gap-1"
          data-test="slack-prereq-result"
          :data-status="row.status"
          :class="row.status === 'fail' ? 'text-status-error-text' : undefined"
        >
          <span>{{ raw(row.detail) }}</span>
          <OCode
            v-if="row.fix && row.status !== 'pass'"
            block
            copyable
            data-test="slack-prereq-fix"
            >{{ raw(row.fix) }}</OCode
          >
        </div>
      </template>
    </OTable>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <span
        class="text-sm"
        :class="failed > 0 ? 'text-status-error-text' : 'text-text-secondary'"
        data-test="slack-prereq-summary"
      >
        {{
          failed > 0
            ? t("slackApp.prereq.failedSummary", { failed, total: checks.length })
            : t("slackApp.prereq.allPassed")
        }}
      </span>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="refresh"
        :loading="loading"
        data-test="slack-prereq-recheck"
        @click="emit('recheck')"
      >
        {{ t("slackApp.prereq.recheck") }}
      </OButton>
    </div>
  </div>
</template>
