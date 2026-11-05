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
  <div
    v-if="formMode && capabilities.isLoading.value"
    class="flex max-w-2xl flex-col gap-3"
    data-test="ai-toolset-form-capabilities-loading"
  >
    <OSkeleton v-for="n in 5" :key="n" type="rect" class="h-9 w-full" />
  </div>
  <AssistantToolsetForm
    v-else-if="formMode"
    :key="`${formMode}:${editId}`"
    :mode="formMode"
    :edit-id="formMode === 'edit' ? editId : undefined"
    :existing="rows"
    :merge-secrets="capabilities.data.value?.toolset_secret_merge === true"
    @done="closeForm"
    @forbidden="writeForbidden = true"
  />
  <section v-else class="flex flex-col gap-3" data-test="settings-assistant-toolsets-tab">
    <h2 class="sr-only">{{ t("assistant.settings.tabs.toolsets") }}</h2>
    <p v-if="writeForbidden" class="text-text-body text-sm" data-test="ai-toolsets-view-only">
      {{ t("assistant.toolsets.viewOnly") }}
    </p>
    <p
      v-else-if="!page.aiEnabled.value"
      class="text-text-secondary text-sm"
      data-test="ai-toolsets-not-set-up"
    >
      {{ t("assistant.toolsets.notSetUp") }}
    </p>
    <OTable
      :data="visibleRows"
      :columns="columns"
      row-key="id"
      :loading="list.isPending.value"
      :forbidden="state === 'forbidden'"
      :error="state === 'error' ? t('assistant.toolsets.loadFailed') : null"
      :row-class="(row: ToolsetRow) => (row.enabled === false ? 'text-text-secondary' : '')"
      pagination="client"
      :page-size="view.pageSize"
      :page-size-options="[20, 50, 100]"
      sorting="client"
      :default-columns="false"
      :persist-columns="true"
      :table-id="health ? 'settings-assistant-toolsets-health' : 'settings-assistant-toolsets'"
      :show-global-filter="false"
      data-test="settings-assistant-toolsets-table"
      @update:page-size="view.pageSize = $event"
    >
      <template #toolbar>
        <OSearchInput
          v-model="view.filterQuery"
          class="w-64 max-md:w-auto max-md:flex-1"
          :placeholder="t('assistant.toolsets.search')"
          data-test="ai-toolsets-search"
        />
      </template>
      <template #toolbar-trailing>
        <ORefreshButton
          layout="inline"
          variant="outline"
          :last-run-at="list.dataUpdatedAt.value"
          :loading="list.isFetching.value"
          :aria-label="mdUp ? undefined : t('shortcuts.actions.assistantToolsetsRefresh')"
          shortcut-id="assistantToolsetsRefresh"
          data-test="ai-toolsets-list-refresh-btn"
          @click="refresh"
        />
        <OButton
          v-if="canEdit"
          variant="primary"
          size="sm-action"
          class="max-md:min-h-11"
          data-test="ai-toolsets-add-btn"
          @click="openForm('add')"
          >{{ t("assistant.toolsets.add") }}</OButton
        >
      </template>
      <template #error>
        <div class="flex flex-col items-center gap-3 p-6" data-test="ai-toolsets-load-error">
          <p class="text-text-body text-sm">{{ t("assistant.toolsets.loadFailed") }}</p>
          <OButton
            variant="outline"
            size="sm-action"
            data-test="ai-toolsets-retry"
            @click="refresh"
          >
            {{ t("common.retry") }}
          </OButton>
        </div>
      </template>
      <template #empty>
        <OEmptyState
          preset="no-ai-toolsets"
          :title="view.filterQuery ? undefined : t('assistant.toolsets.emptyTitle')"
          :description="view.filterQuery ? undefined : t('assistant.toolsets.empty')"
          :filtered="!!view.filterQuery"
          :hide-action="!canEdit && !view.filterQuery"
          @action="(id) => (id === 'clear-filters' ? (view.filterQuery = '') : openForm('add'))"
        />
      </template>
      <template #cell-name="{ row }">
        <OTruncatedText class="block">{{ raw(row.name) }}</OTruncatedText>
      </template>
      <template #cell-kind="{ row }">
        <OTag
          type="aiToolsetKind"
          :value="row.kind"
          variant="default-soft"
          :label="t(KIND_LABEL_KEYS[row.kind as ToolsetKindId])"
        />
      </template>
      <template #cell-status="{ row }">
        <AssistantToolsetStatus
          :row="row"
          :testing="tests[row.id] === 'running'"
          :result="
            typeof tests[row.id] === 'object' ? (tests[row.id] as ToolsetTestOutcome) : undefined
          "
          :clash="clashes.has(row.agentName)"
        />
      </template>
      <template #cell-last_used="{ row }">
        <OTimeCell :value="row.lastUsedAt" mode="relative" />
      </template>
      <template #cell-enabled="{ row }">
        <OSwitch
          :model-value="enabledOf(row)"
          :disabled="!canEdit || pendingEnable.has(row.id)"
          class="max-md:min-h-11"
          :data-test="`ai-toolset-${row.name}-enabled`"
          @update:model-value="(value) => setEnabled(row, value === true)"
        >
          <template #label>
            <span class="sr-only">{{
              t("assistant.toolsets.enabledFor", { name: row.name })
            }}</span>
          </template>
        </OSwitch>
      </template>
      <template #cell-actions="{ row }">
        <div class="flex items-center justify-end gap-1">
          <template v-if="!health">
            <AssistantToolsetStatus :row="row" :clash="clashes.has(row.agentName)" tags-only />
          </template>
          <template v-if="canEdit">
            <OButton
              v-if="health"
              variant="ghost"
              size="sm"
              class="max-md:hidden"
              :disabled="tests[row.id] === 'running'"
              :aria-label="t('assistant.toolsets.testNamed', { name: row.name })"
              :data-test="`ai-toolset-${row.name}-test`"
              @click="runTest(row)"
              >{{ t("assistant.toolsets.test") }}</OButton
            >
            <OButton
              variant="ghost"
              size="sm"
              class="max-md:hidden"
              :aria-label="t('assistant.toolsets.editNamed', { name: row.name })"
              :data-test="`ai-toolset-${row.name}-edit`"
              @click="openForm('edit', row.id)"
              >{{ t("common.edit") }}</OButton
            >
            <OButton
              variant="ghost-destructive"
              size="sm"
              class="max-md:hidden"
              :aria-label="t('assistant.toolsets.deleteNamed', { name: row.name })"
              :data-test="`ai-toolset-${row.name}-delete`"
              @click="remove(row)"
              >{{ t("common.delete") }}</OButton
            >
            <ODropdown side="bottom" align="end">
              <template #trigger>
                <OButton
                  :icon-left="assistantGlyph.more"
                  variant="ghost"
                  size="icon-sm"
                  class="min-h-11 min-w-11 md:hidden"
                  :aria-label="t('assistant.toolsets.moreFor', { name: row.name })"
                  data-test="ai-toolsets-row-more-actions"
                  @click.stop
                />
              </template>
              <ODropdownItem
                v-if="health"
                :data-test="`ai-toolset-${row.name}-test-menu`"
                @select="runTest(row)"
                >{{ t("assistant.toolsets.test") }}</ODropdownItem
              >
              <ODropdownItem
                :data-test="`ai-toolset-${row.name}-edit-menu`"
                @select="openForm('edit', row.id)"
                >{{ t("common.edit") }}</ODropdownItem
              >
              <ODropdownItem
                variant="destructive"
                :data-test="`ai-toolset-${row.name}-delete-menu`"
                @select="remove(row)"
                >{{ t("common.delete") }}</ODropdownItem
              >
            </ODropdown>
          </template>
        </div>
      </template>
      <template #footer-note>
        <div class="flex flex-col gap-1 text-xs" data-test="ai-toolsets-footer-note">
          <span v-if="!health && rows.length" data-test="ai-toolsets-health-unsupported">{{
            t("assistant.toolsets.healthUnsupported")
          }}</span>
          <span>{{ t("assistant.toolsets.runtimeRule", name) }}</span>
          <i18n-t keypath="assistant.toolsets.mcpLine" tag="span">
            <template #link>
              <router-link
                class="text-text-link-hover underline hover:no-underline"
                data-test="settings-assistant-mcp-link"
                :to="{ name: 'mcpServer', query: { org_identifier: page.org.value } }"
                >{{ t("assistant.toolsets.mcpLink") }}</router-link
              >
            </template>
          </i18n-t>
        </div>
      </template>
    </OTable>
    <p role="status" class="sr-only" data-test="ai-toolsets-announce">{{ announcement }}</p>
  </section>
</template>

<script setup lang="ts">
import { useMutation, useQuery } from "@tanstack/vue-query";
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { useAssistantName } from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useListViewState } from "@/composables/useListViewState";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { aiToolsetsQuery } from "@/services/ai_toolsets.queries";
import { capabilitiesQuery } from "@/services/assistant.queries";
import {
  setToolsetEnabledMutation,
  testToolsetMutation,
} from "@/services/assistant_settings.queries";
import { deleteToolsetMutation } from "@/services/assistant_toolsets.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { isInputFocused } from "@/utils/keyboardShortcuts";

import AssistantToolsetForm from "./AssistantToolsetForm.vue";
import AssistantToolsetStatus, { type ToolsetTestOutcome } from "./AssistantToolsetStatus.vue";
import {
  KIND_LABEL_KEYS,
  clashingNames,
  hasToolsetHealth,
  matchesToolset,
  parseToolsetRows,
  type ToolsetKindId,
  type ToolsetRow,
} from "./assistantToolsets";
import { readStateOf, useAssistantSettingsPage } from "./useAssistantSettingsPage";

const { t } = useI18nTyped();
const name = useAssistantName();
const router = useRouter();
const page = useAssistantSettingsPage();
const { confirm } = useConfirmDialog();
// Below md the button shows only its icon; above it the visible age is its name, so a label there would contradict it.
const { mdUp } = useBreakpoint();

const list = useQuery(
  computed(() => ({ ...aiToolsetsQuery(page.org.value), enabled: !!page.org.value })),
);
const capabilities = useQuery(
  computed(() => capabilitiesQuery(page.org.value, page.aiEnabled.value)),
);
const enableMutation = useMutation(() => setToolsetEnabledMutation(page.org.value));
const testMutation = useMutation(() => testToolsetMutation(page.org.value));
const deleteMutation = useMutation(() => deleteToolsetMutation(page.org.value));

const view = reactive(useListViewState("ai-toolsets", { filterQuery: "", pageSize: 20 }));
const state = computed(() => readStateOf(list));
const rows = computed(() => parseToolsetRows(list.data.value));
const health = computed(() => hasToolsetHealth(rows.value));
const clashes = computed(() => clashingNames(rows.value));
// The server enforces the Toolsets permission; a refused write turns the page read-only, as on the legacy page.
const writeForbidden = ref(false);
const canEdit = computed(() => !writeForbidden.value && state.value !== "forbidden");
const visibleRows = computed(() =>
  rows.value.filter((row) => matchesToolset(row, view.filterQuery, t(KIND_LABEL_KEYS[row.kind]))),
);

const formMode = computed(() => {
  const action = router.currentRoute.value.query.action;
  return canEdit.value && (action === "add" || action === "edit") ? action : null;
});
const editId = computed(() => String(router.currentRoute.value.query.id ?? ""));

const overrides = reactive(new Map<string, boolean>());
const pendingEnable = reactive(new Set<string>());
const tests = reactive<Record<string, "running" | ToolsetTestOutcome>>({});
const announcement = ref("");

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "name",
    header: t("assistant.toolsets.columns.name"),
    accessorKey: "name",
    sortable: true,
    size: COL.name,
    meta: { align: "left", flex: true },
  },
  {
    id: "kind",
    header: t("assistant.toolsets.columns.kind"),
    accessorKey: "kind",
    sortable: true,
    hideable: true,
    size: COL.streamType,
    meta: { align: "left" },
  },
  ...(health.value
    ? [
        {
          id: "status",
          header: t("assistant.toolsets.columns.status"),
          hideable: true,
          size: COL.history,
          meta: { align: "left" },
        },
        {
          id: "last_used",
          header: t("assistant.toolsets.columns.lastUsed"),
          accessorKey: "lastUsedAt",
          sortable: true,
          hideable: true,
          size: COL.lastCheck + 20,
          meta: { align: "left" },
        },
        {
          id: "enabled",
          header: t("assistant.toolsets.columns.enabled"),
          size: COL.toggle,
          meta: { align: "center" },
        },
      ]
    : []),
  {
    id: "actions",
    header: t("assistant.toolsets.columns.actions"),
    isAction: true,
    pinned: "right",
    size: 184,
    meta: { align: "right" },
  },
]);

watch(
  () => page.org.value,
  () => {
    writeForbidden.value = false;
    overrides.clear();
    for (const key of Object.keys(tests)) delete tests[key];
  },
);

useShortcuts([
  { id: "assistantToolsetsRefresh", handler: () => !isInputFocused() && void refresh() },
]);

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

function enabledOf(row: ToolsetRow): boolean {
  return overrides.get(row.id) ?? row.enabled ?? true;
}

function refresh() {
  return list.refetch();
}

function openForm(action: "add" | "edit", id?: string) {
  void router.push({
    query: { ...router.currentRoute.value.query, action, ...(id ? { id } : {}) },
  });
}

function closeForm() {
  const { action: _action, id: _id, ...query } = router.currentRoute.value.query;
  void router.push({ query });
}

async function setEnabled(row: ToolsetRow, enabled: boolean) {
  if (pendingEnable.has(row.id)) return;
  const org = page.org.value;
  overrides.set(row.id, enabled);
  pendingEnable.add(row.id);
  try {
    await enableMutation.mutateAsync({ id: row.id, enabled });
  } catch (err) {
    if (org !== page.org.value) return;
    overrides.delete(row.id);
    // The transport already toasts a 403.
    if (statusOf(err) === 403) writeForbidden.value = true;
    else
      toast({
        variant: "error",
        message: t("assistant.toolsets.enableFailed", { name: row.name }),
      });
  } finally {
    pendingEnable.delete(row.id);
  }
}

async function runTest(row: ToolsetRow) {
  if (tests[row.id] === "running") return;
  tests[row.id] = "running";
  let outcome: ToolsetTestOutcome;
  try {
    const result = await testMutation.mutateAsync(row.id);
    outcome = result
      ? { ok: result.ok, durationMs: result.duration_ms, cause: result.error }
      : { ok: false, cause: t("assistant.toolsets.testUnsupported") };
  } catch {
    outcome = { ok: false, cause: t("assistant.toolsets.testFailedRequest") };
  }
  tests[row.id] = outcome;
  if (outcome.ok)
    announcement.value = t("assistant.toolsets.testPassed", {
      name: row.name,
      ms: outcome.durationMs ?? 0,
    });
  else
    announcement.value = outcome.cause
      ? t("assistant.toolsets.testFailed", { name: row.name, cause: outcome.cause })
      : t("assistant.toolsets.testFailedPlain", { name: row.name });
}

async function remove(row: ToolsetRow) {
  const ok = await confirm({
    title: t("assistant.toolsets.deleteTitle", { name: row.name }),
    message: t("assistant.toolsets.deleteMessage", { ...name, name: row.name }),
    confirmLabel: t("common.delete"),
    confirmVariant: "destructive",
    focusCancel: true,
  });
  if (!ok) return;
  try {
    await deleteMutation.mutateAsync(row.id);
    toast({ variant: "success", message: t("assistant.toolsets.deleted", { name: row.name }) });
  } catch (err) {
    if (statusOf(err) === 403) {
      writeForbidden.value = true;
      return;
    }
    toast({ variant: "error", message: t("assistant.toolsets.deleteFailed", { name: row.name }) });
  }
}

defineExpose({ refresh });
</script>
