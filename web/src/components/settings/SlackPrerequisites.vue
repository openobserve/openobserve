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
import useBreakpoint from "@/composables/useBreakpoint";
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
const { isMobile } = useBreakpoint();

const failed = computed(() => props.checks.filter((c) => c.status === "fail").length);
const warned = computed(() => props.checks.filter((c) => c.status === "warn").length);

watch(failed, (n) => emit("blocking", n > 0), { immediate: true });

const columns = computed<OTableColumnDef<SlackPrerequisiteCheck>[]>(() => [
  { id: "setting", header: t("slackApp.prereq.columnSetting"), size: 260 },
  { id: "result", header: t("slackApp.prereq.columnResult"), meta: { flex: true } },
]);

const showsHelmHint = (row: SlackPrerequisiteCheck): boolean =>
  row.id === "master_key" && row.status !== "pass";
</script>

<template>
  <div class="flex flex-col gap-3" data-test="slack-prereq">
    <OTable
      v-if="!isMobile"
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
          <code v-if="row.variable" class="text-compact whitespace-nowrap">{{
            raw(row.variable)
          }}</code>
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
            class="[&>code]:pe-9 [&>code]:wrap-anywhere [&>code]:whitespace-pre-wrap"
            data-test="slack-prereq-fix"
            >{{ raw(row.fix) }}</OCode
          >
          <span
            v-if="showsHelmHint(row)"
            class="text-text-secondary text-xs"
            data-test="slack-prereq-helm-hint"
          >
            {{ t("slackApp.prereq.helmHint") }}
          </span>
        </div>
      </template>
    </OTable>

    <div
      v-else
      class="border-border-default text-compact flex flex-col border-t"
      data-test="slack-prereq-list"
    >
      <div
        class="bg-table-header-bg text-text-secondary border-border-default flex justify-between border-b px-1 py-1.5 text-xs"
      >
        <span>{{ t("slackApp.prereq.columnSetting") }}</span>
        <span>{{ t("slackApp.prereq.columnResult") }}</span>
      </div>
      <div
        v-for="row in checks"
        :key="row.id"
        class="border-border-subtle flex flex-col gap-1 border-b px-1 py-2.5"
        :data-test="`slack-prereq-row-${row.id}`"
      >
        <span class="text-text-heading flex items-center gap-2 overflow-x-auto">
          <OIcon
            :name="checkIcon(row.status)"
            size="sm"
            class="shrink-0"
            :class="checkIconClass(row.status)"
            :label="t(`slackApp.status.${row.status}`)"
          />
          <code v-if="row.variable" class="text-compact whitespace-nowrap">{{
            raw(row.variable)
          }}</code>
          <span v-else>{{ t(`slackApp.prereq.names.${row.id}`) }}</span>
        </span>
        <div
          class="flex min-w-0 flex-col gap-1 overflow-x-auto ps-6"
          data-test="slack-prereq-result"
          :data-status="row.status"
          :class="row.status === 'fail' ? 'text-status-error-text' : 'text-text-body'"
        >
          <span>{{ raw(row.detail) }}</span>
          <OCode
            v-if="row.fix && row.status !== 'pass'"
            block
            copyable
            data-test="slack-prereq-fix"
            >{{ raw(row.fix) }}</OCode
          >
          <span
            v-if="showsHelmHint(row)"
            class="text-text-secondary text-xs"
            data-test="slack-prereq-helm-hint"
          >
            {{ t("slackApp.prereq.helmHint") }}
          </span>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="flex flex-wrap items-center gap-1 text-sm" data-test="slack-prereq-summary">
        <template v-if="failed > 0">
          <span class="text-status-error-text">
            {{ t("slackApp.prereq.failedSummary", { failed, total: checks.length }) }}
          </span>
          <template v-if="warned > 0">
            <span class="text-text-secondary">·</span>
            <span class="text-text-heading">
              {{ t("slackApp.prereq.warningCount", { count: warned }, warned) }}
            </span>
          </template>
        </template>
        <template v-else-if="warned > 0">
          <OIcon name="warning-amber" size="sm" class="text-status-warning-text" />
          <span class="text-text-heading">{{ t("slackApp.prereq.requiredPass") }}</span>
          <span class="text-text-secondary">·</span>
          <span class="text-text-heading font-semibold">
            {{ t("slackApp.prereq.warningCount", { count: warned }, warned) }}
          </span>
          <span class="text-text-secondary max-md:hidden">·</span>
          <span class="text-text-secondary max-md:hidden" data-test="slack-prereq-can-continue">
            {{ t("slackApp.prereq.canContinue") }}
          </span>
        </template>
        <span v-else class="text-text-secondary">{{ t("slackApp.prereq.allPassed") }}</span>
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
