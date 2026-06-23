<template>
  <div data-test="llm-providers-settings" class="tw:flex tw:flex-col tw:h-full tw:min-h-0">
    <ProviderFormPage
      v-if="formPage"
      :org-id="orgId"
      :mode="formPage.mode"
      :row="formPage.row"
      @saved="handleSaved"
      @cancel="closeForm"
    />

    <template v-else>
      <AppPageHeader
        icon="smart-toy"
        :subtitle="'LLM providers for online evaluations'"
        class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
      >
        <template #title>
          <span data-test="llm-providers-settings-title">{{ t("llmProviders.title") }}</span>
        </template>
        <template #actions>
          <OInput
            v-model="searchQuery"
            class="tw:w-50"
            :placeholder="t('llmProviders.searchPlaceholder')"
            data-test="llm-providers-search-input"
          >
            <template #icon-left>
              <OIcon name="search" size="sm" />
            </template>
          </OInput>
          <OButton
            data-test="llm-providers-add-btn"
            variant="primary"
            size="sm"
            @click="openCreate"
          >
            {{ t("llmProviders.newButton") }}
          </OButton>
        </template>
      </AppPageHeader>

      <div v-if="isLoading" class="tw:flex tw:flex-1 tw:items-center tw:justify-center">
        <OSpinner size="md" />
      </div>

      <div
        v-else-if="!providers.length"
        class="tw:flex tw:flex-1 tw:items-center tw:justify-center"
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

      <div v-else class="tw:flex-1 tw:min-h-0 tw:p-4">
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
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="settings-llm-providers"
          :page-size="20"
          :page-size-options="[20, 50, 100]"
          width="100%"
          class="tw:w-full tw:h-full"
          @row-click="(row: any) => openEdit(row)"
        >
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
            <span class="llmp-type-chip">{{ providerTypeOf(row) || "—" }}</span>
          </template>

          <template #cell-endpoint="{ row }">
            <span class="llmp-mono">{{ row.endpoint || endpointFallback(row) }}</span>
          </template>

          <template #cell-defaultModel="{ row }">
            <span class="llmp-mono">{{ defaultModelOf(row) || "—" }}</span>
          </template>

          <template #cell-isDefault="{ row }">
            <span
              v-if="booleanOf(row, 'isDefault', 'is_default')"
              class="llmp-default-chip"
            >
              {{ t("llmProviders.defaultBadge") }}
            </span>
            <span v-else class="llmp-muted">—</span>
          </template>

          <template #cell-actions="{ row }">
            <div class="tw:flex tw:items-center actions-container">
              <OButton
                :data-test="`llm-providers-${row.name}-edit-btn`"
                variant="ghost"
                size="icon-sm"
                :title="t('onlineEvals.actions.edit')"
                icon-left="edit"
                @click.stop="openEdit(row)"
              />
              <OButton
                :data-test="`llm-providers-${row.name}-delete-btn`"
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
    </template>

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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
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
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { TABLE_INDEX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";

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
    id: "#",
    header: "#",
    accessorKey: "#",
    sortable: false,
    size: TABLE_INDEX_COL_SIZE,
    meta: { align: "left" },
  },
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
  return filtered.map((row, index) => ({
    ...row,
    "#": index + 1 <= 9 ? `0${index + 1}` : String(index + 1),
  }));
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
</script>

<style lang="scss" scoped>
.llmp-type-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 3px;
  font: 600 11px/1.5 inherit;
  background: color-mix(in srgb, var(--o2-status-info-text) 14%, transparent);
  color: var(--o2-status-info-text);
  text-transform: lowercase;
}

.llmp-default-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 3px;
  font: 600 10px/1.5 inherit;
  background: color-mix(in srgb, var(--o2-status-success-text) 14%, transparent);
  color: var(--o2-status-success-text);
  text-transform: uppercase;
}

.llmp-mono {
  font-size: 12px;
}

.llmp-muted {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}
</style>
