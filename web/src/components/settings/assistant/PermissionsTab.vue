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
  <section class="flex flex-col gap-3" data-test="settings-assistant-permissions-tab">
    <h2 class="text-text-heading text-sm font-semibold">{{ heading }}</h2>
    <p
      v-if="unsupported && page.isAdmin.value"
      class="text-text-body text-sm"
      data-test="settings-assistant-grants-unsupported"
    >
      {{ t("assistant.grants.unsupported") }}
    </p>
    <OEmptyState
      v-else-if="unsupported"
      size="compact"
      :title="t('assistant.grants.browserEmpty')"
      hide-action
      data-test="settings-assistant-grants-browser"
    />
    <OTable
      v-else
      :data="rows"
      :columns="columns"
      row-key="id"
      :loading="grants.isPending.value"
      :forbidden="state === 'forbidden'"
      :error="state === 'error' ? t('assistant.grants.loadFailed') : null"
      :row-class="(row: AssistantGrant) => (pending.has(row.id) ? 'opacity-60' : '')"
      pagination="client"
      :page-size="50"
      :default-columns="false"
      :show-global-filter="false"
      data-test="settings-assistant-grants-table"
    >
      <template #error>
        <div class="flex flex-col items-center gap-3 p-6">
          <p class="text-text-body text-sm">{{ t("assistant.grants.loadFailed") }}</p>
          <OButton
            variant="outline"
            size="sm-action"
            data-test="settings-assistant-grants-retry"
            @click="refresh"
          >
            {{ t("common.retry") }}
          </OButton>
        </div>
      </template>
      <template #empty>
        <OEmptyState size="compact" :title="t('assistant.grants.empty')" hide-action />
      </template>
      <template #cell-tool="{ row }">
        <OTruncatedText class="block">{{ raw(toolLabel(row)) }}</OTruncatedText>
      </template>
      <template #cell-scope="{ row }">
        <div class="flex flex-wrap items-center gap-1">
          <OTag
            variant="default-soft"
            :label="
              row.scope === 'always' ? t('assistant.grants.always') : t('assistant.grants.thisChat')
            "
          />
          <router-link
            v-if="row.scope === 'chat' && row.chat_id"
            class="text-text-link-hover text-xs underline hover:no-underline"
            :to="{ name: 'assistant', params: { chatId: row.chat_id } }"
            :data-test="`settings-assistant-grant-${row.id}-chat`"
            >{{ t("assistant.grants.openChat") }}</router-link
          >
        </div>
      </template>
      <template #cell-granted_by="{ row }">
        <OUserCell :value="row.granted_by" />
      </template>
      <template #cell-granted_at="{ row }">
        <OTimeCell :value="row.granted_at" mode="relative" />
      </template>
      <template #cell-actions="{ row }">
        <OButton
          variant="ghost"
          size="sm"
          class="max-md:min-h-11"
          :loading="pending.has(row.id)"
          :disabled="pending.has(row.id)"
          :aria-label="t('assistant.grants.revokeNamed', { tool: toolLabel(row) })"
          :data-test="`settings-assistant-grant-${row.id}-revoke`"
          @click="revoke(row)"
          >{{ t("assistant.grants.revoke") }}</OButton
        >
      </template>
      <template #footer-note>
        <span class="text-xs">{{ t("assistant.grants.alwaysAsk") }}</span>
      </template>
    </OTable>
  </section>
</template>

<script setup lang="ts">
import { useMutation, useQuery } from "@tanstack/vue-query";
import { computed, reactive } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { AssistantGrant } from "@/services/assistant_settings";
import { assistantGrantsQuery, revokeGrantMutation } from "@/services/assistant_settings.queries";
import { raw, useI18nTyped } from "@/types/i18n";

import { readStateOf, useAssistantSettingsPage } from "./useAssistantSettingsPage";

const { t } = useI18nTyped();
const page = useAssistantSettingsPage();

const grants = useQuery(computed(() => assistantGrantsQuery(page.org.value)));
const revokeMutation = useMutation(() => revokeGrantMutation(page.org.value));
const pending = reactive(new Set<string>());

const state = computed(() => readStateOf(grants));
const unsupported = computed(() => state.value === "ready" && grants.data.value === null);
const heading = computed(() => {
  if (page.isAdmin.value) return t("assistant.grants.title");
  return unsupported.value ? t("assistant.grants.yoursInBrowser") : t("assistant.grants.yours");
});
const rows = computed(() => grants.data.value ?? []);

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "tool",
    header: t("assistant.grants.columns.tool"),
    size: COL.name,
    meta: { align: "left", flex: true },
  },
  {
    id: "scope",
    header: t("assistant.grants.columns.scope"),
    size: COL.type,
    meta: { align: "left" },
  },
  {
    id: "granted_by",
    header: t("assistant.grants.columns.grantedBy"),
    size: COL.owner,
    meta: { align: "left" },
  },
  {
    id: "granted_at",
    header: t("assistant.grants.columns.grantedAt"),
    size: COL.date,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("assistant.grants.columns.actions"),
    isAction: true,
    pinned: "right",
    size: 120,
    meta: { align: "right" },
  },
]);

function toolLabel(row: AssistantGrant): string {
  return row.operation ? `${row.tool} · ${row.operation}` : row.tool;
}

function refresh() {
  return grants.refetch();
}

async function revoke(row: AssistantGrant) {
  if (pending.has(row.id)) return;
  pending.add(row.id);
  try {
    await revokeMutation.mutateAsync(row.id);
    toast({ variant: "success", message: t("assistant.grants.revoked") });
  } catch {
    // The mutation layer already toasted the server's reason.
  } finally {
    pending.delete(row.id);
  }
}

defineExpose({ refresh });
</script>
