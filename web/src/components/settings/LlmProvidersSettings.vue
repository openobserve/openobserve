<template>
  <div data-test="llm-providers-settings" class="flex flex-col h-full min-h-0">
    <ProviderFormPage
      v-if="formPage"
      :org-id="orgId"
      :mode="formPage.mode"
      :row="formPage.row"
      @saved="handleSaved"
      @cancel="closeForm"
    />

    <OPageLayout
      v-else
      icon="smart-toy"
      :subtitle="t('settings.llmProvidersSettings.subtitle')"
      bleed
      :scroll="false"
    >
        <template #title>
          <span data-test="llm-providers-settings-title">{{ t("llmProviders.title") }}</span>
        </template>
        <template #actions>
          <OButton
            data-test="llm-providers-add-btn"
            variant="primary"
            size="sm"
            @click="openCreate"
          >
            {{ t("llmProviders.newButton") }}
          </OButton>
        </template>

      <div v-if="isLoading" class="flex flex-1 items-center justify-center">
        <OSpinner size="md" />
      </div>

      <div
        v-else-if="!providers.length"
        class="flex flex-1 items-center justify-center"
      >
        <!-- First-run state — uses the same `no-llm-providers` preset the
             OTable's #empty slot uses for the filtered case, so the empty
             surface in this page reads consistently with the rest of the
             app (matches Scorers' "Add a Provider First" treatment). -->
        <OEmptyState
          size="hero"
          preset="no-llm-providers"
          :title="t('llmProviders.empty.title')"
          :description="t('llmProviders.empty.description')"
          data-test="llm-providers-empty-state"
          @action="(id) => id === 'create' && openCreate()"
        />
      </div>

      <div v-else class="flex-1 min-h-0">
        <OTable
          data-test="llm-providers-table"
          :data="filteredProviders"
          :columns="columns"
          row-key="id"
          :loading="isLoading"
          :footer-title="t('llmProviders.title')"
          :global-filter="searchQuery"
          :show-global-filter="false"
          :default-columns="false"
          show-index
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="settings-llm-providers"
          :page-size="20"
          :page-size-options="[20, 50, 100]"
          width="100%"
          class="w-full h-full"
          @row-click="(row: any) => openEdit(row)"
        >
          <template #toolbar>
            <OSearchInput
              v-model="searchQuery"
              class="flex-1"
              :placeholder="t('llmProviders.searchPlaceholder')"
              data-test="llm-providers-search-input"
              />
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="isLoading"
              data-test="llm-providers-list-refresh-btn"
              @click="loadProviders"
            >
              <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="llmProvidersRefresh" />
            </OButton>
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-llm-providers"
              :filtered="!!searchQuery"
              :hide-action="!searchQuery"
              @action="(id) => id === 'clear-filters' && (searchQuery = '')"
            />
          </template>
          <template #cell-type="{ row }">
            <OTag type="providerType" class="lowercase">{{ providerTypeOf(row) || "—" }}</OTag>
          </template>

          <template #cell-endpoint="{ row }">
            <span class="font-mono text-xs">{{ row.endpoint || endpointFallback(row) }}</span>
          </template>

          <template #cell-defaultModel="{ row }">
            <span class="font-mono text-xs">{{ defaultModelOf(row) || "—" }}</span>
          </template>

          <template #cell-isDefault="{ row }">
            <OTag
              v-if="booleanOf(row, 'isDefault', 'is_default')"
              type="providerDefaultFlag"
              value="default"
            />
            <span v-else class="text-text-body">—</span>
          </template>

          <template #cell-actions="{ row }">
            <div class="flex items-center actions-container">
              <OButton
                :data-test="`llm-providers-${row.name}-edit-btn`"
                data-row-action="edit"
                variant="ghost"
                size="icon-sm"
                :title="t('onlineEvals.actions.edit')"
                icon-left="edit"
                @click.stop="openEdit(row)"
              />
              <OButton
                :data-test="`llm-providers-${row.name}-delete-btn`"
                data-row-action="delete"
                variant="ghost-destructive"
                size="icon-sm"
                :title="t('onlineEvals.actions.delete')"
                icon-left="delete"
                @click.stop="confirmDelete(row)"
              />
            </div>
          </template>
        </OTable>
      </div>
    </OPageLayout>

    <ConfirmDialog
      v-model="confirmDeleteOpen"
      :title="t('onlineEvals.deleteTitle', { label: t('onlineEvals.singular.providers') })"
      :message="t('onlineEvals.deleteConfirmMessage', { name: pendingDeleteRow?.name ?? '' })"
      @update:ok="performDelete"
      @update:cancel="cancelDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, {
  type Provider,
} from "@/services/online-evals.service";
import {
  booleanOf,
  defaultModelOf,
  providerTypeOf,
} from "@/enterprise/components/onlineEvals/utils/evalEntity";
import { showError } from "@/enterprise/components/onlineEvals/utils/evalFormat";
import ProviderFormPage from "@/enterprise/components/onlineEvals/forms/ProviderFormPage.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

const { t } = useI18n();
const store = useStore();
const route = useRoute();
const router = useRouter();

const providers = ref<Provider[]>([]);
const isLoading = ref(false);
const searchQuery = ref("");
const formPage = ref<{ mode: "create" | "edit"; row: Provider | null } | null>(null);

const confirmDeleteOpen = ref(false);
const pendingDeleteRow = ref<Provider | null>(null);

const orgId = computed(() => store.state.selectedOrganization?.identifier);

const columns = computed(() => [
  {
    id: "name",
    header: t("llmProviders.columns.name"),
    accessorKey: "name",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.name,
    minSize: 160,
    meta: { align: "left", flex: true },
  },
  {
    id: "type",
    header: t("llmProviders.columns.type"),
    accessorFn: (row: Provider) => providerTypeOf(row),
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.type,
    meta: { align: "left" },
  },
  {
    id: "endpoint",
    header: t("llmProviders.columns.endpoint"),
    accessorFn: (row: Provider) => row.endpoint || endpointFallback(row),
    sortable: false,
    resizable: true,
    hideable: true,
    size: COL.url,
    meta: { align: "left" },
  },
  {
    id: "defaultModel",
    header: t("llmProviders.columns.defaultModel"),
    accessorFn: (row: Provider) => defaultModelOf(row),
    sortable: false,
    resizable: true,
    hideable: true,
    size: COL.defaultModel,
    meta: { align: "left" },
  },
  {
    id: "isDefault",
    header: t("llmProviders.columns.default"),
    accessorFn: (row: Provider) => booleanOf(row, "isDefault", "is_default"),
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.toggle,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("onlineEvals.scoreConfig.columns.actions"),
    sortable: false,
    isAction: true,
    size: 100,
    meta: { align: "center", cellClass: "actions-column", actionCount: 2 },
  },
]);

const filteredProviders = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const filtered = !query
    ? providers.value
    : providers.value.filter((p) =>
        [p.name, providerTypeOf(p), p.endpoint]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query)),
      );
  return filtered;
});

onBeforeMount(async () => {
  await loadProviders();
  syncFromRoute();
});

watch(
  () => [route.query.action, route.query.id],
  () => syncFromRoute(),
);

async function loadProviders() {
  if (!orgId.value) return;
  isLoading.value = true;
  try {
    providers.value = await onlineEvalsService.providers.list(orgId.value);
  } catch (err: any) {
    showError(err, t("llmProviders.loadError"));
  } finally {
    isLoading.value = false;
  }
}

const DEFAULT_ENDPOINTS: Record<string, string> = {
  openai: "api.openai.com",
  deepseek: "api.deepseek.com",
  anthropic: "api.anthropic.com",
};

function endpointFallback(provider: Provider) {
  const type = providerTypeOf(provider).toLowerCase();
  return DEFAULT_ENDPOINTS[type] ?? "—";
}

function pushRouteAction(extra: Record<string, string | undefined>) {
  const query: Record<string, any> = { ...route.query };
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete query[k];
    else query[k] = v;
  }
  router.push({ name: route.name as string, query }).catch(() => {});
}

function clearRouteAction() {
  const query: Record<string, any> = { ...route.query };
  delete query.action;
  delete query.id;
  router.replace({ name: route.name as string, query }).catch(() => {});
}

function openCreate() {
  pushRouteAction({ action: "add", id: undefined });
}

function openEdit(row: Provider) {
  pushRouteAction({ action: "update", id: String(row.id) });
}

function closeForm() {
  formPage.value = null;
  clearRouteAction();
}

async function handleSaved() {
  formPage.value = null;
  clearRouteAction();
  await loadProviders();
}

function syncFromRoute() {
  const action = route.query.action;
  const id = route.query.id;

  formPage.value = null;

  if (action === "add") {
    formPage.value = { mode: "create", row: null };
    return;
  }

  if (action === "update" && typeof id === "string") {
    const row = providers.value.find((p) => String(p.id) === id) ?? null;
    if (row) formPage.value = { mode: "edit", row };
  }
}

function confirmDelete(row: Provider) {
  pendingDeleteRow.value = row;
  confirmDeleteOpen.value = true;
}

function cancelDelete() {
  confirmDeleteOpen.value = false;
  pendingDeleteRow.value = null;
}

async function performDelete() {
  const row = pendingDeleteRow.value;
  if (!row) return;
  try {
    await onlineEvalsService.providers.delete(orgId.value, row.id);
    toast({
      variant: "success",
      message: t("onlineEvals.deleted", { label: t("onlineEvals.singular.providers") }),
    });
    await loadProviders();
  } catch (err: any) {
    showError(err, t("onlineEvals.deleteError", { label: t("onlineEvals.singular.providers").toLowerCase() }));
  } finally {
    pendingDeleteRow.value = null;
  }
}

useShortcuts([
  { id: "llmProvidersRefresh", handler: () => { if (!isInputFocused()) loadProviders(); } },
]);
</script>
