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
      <div
        class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-4 tw:border-b-[1px]"
        style="border-color: var(--color-dialog-header-border, var(--o2-border));"
      >
        <div>
          <div
            class="tw:text-xl tw:tracking-[0.005em] tw:font-[600]"
            data-test="llm-providers-settings-title"
          >
            {{ t("llmProviders.title") }}
          </div>
          <div
            class="tw:text-xs tw:mt-1"
            style="color: var(--color-text-secondary, var(--o2-text-secondary));"
          >
            {{ t("llmProviders.subtitle") }}
          </div>
        </div>
        <div class="tw:flex tw:items-center">
          <OInput
            v-model="searchQuery"
            class="tw:mr-2 tw:w-[200px]"
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
        </div>
      </div>

      <div v-if="isLoading" class="tw:flex tw:flex-1 tw:items-center tw:justify-center">
        <OSpinner size="md" />
      </div>

      <div
        v-else-if="!providers.length"
        class="tw:flex tw:flex-1 tw:items-center tw:justify-center"
      >
        <LlmProvidersEmptyState @create="openCreate" />
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
          :page-size="20"
          :page-size-options="[20, 50, 100]"
          width="100%"
          class="tw:w-full tw:h-full"
          @row-click="(row: any) => openEdit(row)"
        >
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
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, ref } from "vue";
import { useI18n } from "vue-i18n";
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
import LlmProvidersEmptyState from "./LlmProvidersEmptyState.vue";

const { t } = useI18n();
const store = useStore();

const providers = ref<Provider[]>([]);
const isLoading = ref(false);
const searchQuery = ref("");
const formPage = ref<{ mode: "create" | "edit"; row: Provider | null } | null>(null);

const orgId = computed(() => store.state.selectedOrganization?.identifier);

const columns = computed(() => [
  {
    id: "#",
    header: "#",
    accessorKey: "#",
    sortable: false,
    size: 56,
    meta: { align: "left" },
  },
  {
    id: "name",
    header: t("llmProviders.columns.name"),
    accessorKey: "name",
    sortable: true,
    size: "auto",
    meta: { align: "left" },
  },
  {
    id: "type",
    header: t("llmProviders.columns.type"),
    accessorFn: (row: Provider) => providerTypeOf(row),
    sortable: true,
    size: 140,
    meta: { align: "left" },
  },
  {
    id: "endpoint",
    header: t("llmProviders.columns.endpoint"),
    accessorFn: (row: Provider) => row.endpoint || endpointFallback(row),
    sortable: false,
    size: 240,
    meta: { align: "left" },
  },
  {
    id: "defaultModel",
    header: t("llmProviders.columns.defaultModel"),
    accessorFn: (row: Provider) => defaultModelOf(row),
    sortable: false,
    size: 180,
    meta: { align: "left" },
  },
  {
    id: "isDefault",
    header: t("llmProviders.columns.default"),
    accessorFn: (row: Provider) => booleanOf(row, "isDefault", "is_default"),
    sortable: true,
    size: 110,
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

onBeforeMount(() => {
  void loadProviders();
});

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

function endpointFallback(provider: Provider) {
  const type = providerTypeOf(provider).toLowerCase();
  if (type === "openai") return "api.openai.com";
  if (type === "anthropic") return "api.anthropic.com";
  return "—";
}

function openCreate() {
  formPage.value = { mode: "create", row: null };
}

function openEdit(row: Provider) {
  formPage.value = { mode: "edit", row };
}

function closeForm() {
  formPage.value = null;
}

async function handleSaved() {
  closeForm();
  await loadProviders();
}

async function confirmDelete(row: Provider) {
  if (!window.confirm(t("onlineEvals.deletePrompt", { name: row.name }))) return;
  try {
    await onlineEvalsService.providers.delete(orgId.value, row.id);
    toast({
      variant: "success",
      message: t("onlineEvals.deleted", { label: t("onlineEvals.singular.providers") }),
    });
    await loadProviders();
  } catch (err: any) {
    showError(err, t("onlineEvals.deleteError", { label: t("onlineEvals.singular.providers").toLowerCase() }));
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
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.llmp-muted {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}
</style>
