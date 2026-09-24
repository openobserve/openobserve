<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <OPageLayout
    overflow-first
    bleed
    :title="t('aiObservability.nav.prompts')"
    icon="edit"
    :subtitle="t('aiObservability.promptManagement.subtitle')"
    :main-panel="false"
    data-test="prompts-page"
  >
    <template #actions-overflow>
      <OButton
        v-if="canManageSettings"
        variant="outline"
        size="sm"
        icon-left="settings"
        data-test="prompts-settings"
        @click="settingsOpen = true"
        >{{ t("aiObservability.promptManagement.settings") }}</OButton
      >
    </template>
    <template #actions>
      <OButton variant="primary" size="sm" data-test="prompt-new" @click="openCreate">
        {{ t("aiObservability.promptManagement.newPrompt") }}
      </OButton>
    </template>

    <div class="flex min-h-0 flex-1 max-md:flex-col">
      <aside
        class="w-rail max-md:border-border-default h-full shrink-0 max-md:h-auto max-md:w-full max-md:border-b"
      >
        <FolderList type="prompts" @update:active-folder-id="selectFolder" />
      </aside>

      <main class="h-full min-w-0 flex-1 max-md:h-auto max-md:min-h-0">
        <OTable
          :data="filteredPrompts"
          :columns="columns"
          row-key="entityId"
          :loading="promptQuery.isPending.value"
          :error="listError"
          :forbidden="errorStatus(promptQuery.error.value) === 403"
          :frame="false"
          :default-columns="false"
          :show-global-filter="false"
          :page-size="20"
          :page-size-options="[20, 50, 100]"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="ai-prompt-list"
          :footer-title="t('aiObservability.nav.prompts')"
          data-test="prompt-table"
          @row-click="(row) => openDetail(row)"
        >
          <template #toolbar>
            <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <OInput
                v-model="search"
                class="min-w-56 flex-1"
                :placeholder="t('aiObservability.promptManagement.searchNameOrTag')"
                clearable
                data-test="prompt-search"
              >
                <template #icon-left><OIcon name="search" size="sm" /></template>
              </OInput>
              <OSelect
                v-model="statusFilter"
                :options="statusOptions"
                label-key="label"
                value-key="value"
                width="xs"
                data-test="prompt-status-filter"
              />
              <OSelect
                v-model="tagFilter"
                :options="tagOptions"
                :placeholder="t('aiObservability.promptManagement.allTags')"
                :aria-label="t('aiObservability.promptManagement.tags')"
                width="sm"
                searchable
                clearable
                data-test="prompt-tag-filter"
              />
              <OSelect
                v-model="labelFilter"
                :options="labelOptions"
                :placeholder="t('aiObservability.promptManagement.allLabels')"
                :aria-label="t('aiObservability.promptManagement.labels')"
                width="sm"
                searchable
                clearable
                data-test="prompt-label-filter"
              />
              <OToggleGroup v-model="folderScope" type="single" mobile-dropdown>
                <OToggleGroupItem value="current" size="xs">{{
                  t("aiObservability.promptManagement.thisFolder")
                }}</OToggleGroupItem>
                <OToggleGroupItem value="all" size="xs">{{
                  t("aiObservability.promptManagement.allFolders")
                }}</OToggleGroupItem>
              </OToggleGroup>
            </div>
          </template>
          <template #toolbar-trailing>
            <ORefreshButton
              :loading="refreshing || promptQuery.isFetching.value"
              :last-run-at="promptQuery.dataUpdatedAt.value"
              data-test="prompt-refresh"
              @click="refresh"
            />
          </template>

          <template #error="{ message }">
            <OEmptyState preset="load-error" :description="raw(message)" @action="refresh" />
          </template>
          <template #empty>
            <OEmptyState
              :title="
                hasFilters
                  ? t('aiObservability.promptManagement.noMatchingPrompts')
                  : t('aiObservability.promptManagement.noPrompts')
              "
              :description="
                hasFilters
                  ? t('aiObservability.promptManagement.noMatchingPromptsHelp')
                  : t('aiObservability.promptManagement.noPromptsHelp')
              "
              :action-label="
                hasFilters
                  ? t('aiObservability.promptManagement.clearFilters')
                  : t('aiObservability.promptManagement.newPrompt')
              "
              @action="hasFilters ? clearFilters() : openCreate()"
            />
          </template>
          <template #cell-name="{ row }">
            <div class="flex min-w-0 flex-col">
              <OButton variant="ghost" size="xs" @click.stop="openDetail(row)">{{
                row.name
              }}</OButton>
              <span v-if="row.description" class="text-text-secondary text-2xs truncate">{{
                row.description
              }}</span>
            </div>
          </template>
          <template #cell-tags="{ row }">
            <div class="flex max-w-64 flex-wrap gap-1">
              <OTag v-for="tag in row.tags" :key="tag" variant="default-soft" shape="rounded">{{
                tag
              }}</OTag>
              <span v-if="!row.tags.length" class="text-text-secondary">{{ raw("—") }}</span>
            </div>
          </template>
          <template #cell-labels="{ row }">
            <div class="flex flex-wrap items-center gap-1">
              <OTag
                v-for="label in activeLabels(row)"
                :key="label.name"
                :variant="protectedLabels.includes(label.name) ? 'amber-soft' : 'blue-soft'"
                shape="rounded"
              >
                <OIcon v-if="protectedLabels.includes(label.name)" name="lock" size="xs" />
                {{
                  t("aiObservability.promptManagement.labelVersion", {
                    name: label.name,
                    version: label.version,
                  })
                }}
              </OTag>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="edit"
                :title="t('aiObservability.promptManagement.manageLabels')"
                data-test="prompt-row-manage-labels"
                @click.stop="openDetail(row, 'labels')"
              />
            </div>
          </template>
          <template #cell-latestVersion="{ row }">
            <span class="tabular-nums">{{
              t("aiObservability.promptManagement.versionNumber", { version: row.latestVersion })
            }}</span>
          </template>
          <template #cell-status="{ row }">
            <OTag :variant="row.status === 'active' ? 'success-soft' : 'default-soft'">{{
              statusLabel(row.status)
            }}</OTag>
          </template>
          <template #cell-updatedAt="{ row }">
            <OTimeCell :value="row.updatedAt" unit="ms" mode="relative" :empty-label="raw('—')" />
          </template>
          <template #cell-actions="{ row }">
            <ODropdown side="bottom" align="end" @click.stop>
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  icon-left="more-vert"
                  :title="t('aiObservability.promptManagement.promptActions')"
                />
              </template>
              <ODropdownItem v-if="row.status === 'active'" @select="openEdit(row)">{{
                t("aiObservability.promptManagement.createNewVersion")
              }}</ODropdownItem>
              <ODropdownItem @select="openMove(row)">{{
                t("aiObservability.promptManagement.moveToFolder")
              }}</ODropdownItem>
              <ODropdownItem v-if="row.status === 'active'" @select="archive(row)">{{
                t("aiObservability.promptManagement.archive")
              }}</ODropdownItem>
            </ODropdown>
          </template>
        </OTable>
      </main>
    </div>

    <PromptDetailDrawer
      :open="drawerOpen"
      :org-id="orgId"
      :prompt="selectedPrompt"
      :initial-version="routeVersion"
      :initial-tab="detailTab"
      :protected-labels="protectedLabels"
      @update:open="closeDetail"
      @updated="replacePrompt"
      @edit="openEditorForVersion"
      @archive="selectedPrompt && archive(selectedPrompt)"
      @open-playground="openPlayground"
    >
      <template #traffic="{ version }">
        <PromptTrafficPanel
          v-if="version"
          :org-id="orgId"
          :prompt="selectedPrompt!"
          :version="version"
        />
      </template>
    </PromptDetailDrawer>

    <PromptEditorDialog
      :open="editorOpen"
      :org-id="orgId"
      :folder-id="activeFolderId || 'default'"
      :prompt="editingPrompt"
      :base-version="editingVersion"
      @update:open="editorOpen = $event"
      @saved="afterSave"
      @test="openPlayground"
    />

    <PromptSettingsDialog
      v-if="canManageSettings"
      :open="settingsOpen"
      :org-id="orgId"
      @update:open="settingsOpen = $event"
      @updated="updateCachedSettings"
    />

    <ODialog
      :open="moveOpen"
      :title="t('aiObservability.promptManagement.movePrompt')"
      :primary-button-label="t('aiObservability.promptManagement.move')"
      :secondary-button-label="t('aiObservability.promptManagement.cancel')"
      :primary-button-disabled="!moveDestination || moveDestination === movingPrompt?.folderId"
      :primary-button-loading="updateMutation.isPending.value"
      @update:open="moveOpen = $event"
      @click:secondary="moveOpen = false"
      @click:primary="movePrompt"
    >
      <SelectFolderDropDown
        type="prompts"
        :active-folder-id="movingPrompt?.folderId ?? activeFolderId"
        :exclude-folder-id="movingPrompt?.folderId"
        @folder-selected="moveDestination = $event.value"
      />
      <p v-if="movingPrompt" class="text-text-secondary mt-3 text-xs">
        {{
          t("aiObservability.promptManagement.moveKeepsVersions", {
            count: movingPrompt.latestVersion,
          })
        }}
      </p>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  llmPromptsQuery,
  promptSettingsQuery,
  updatePromptMutation,
  archivePromptMutation,
} from "@/services/llm-prompts.service.queries";
import { llmPromptKeys } from "@/services/llm-prompts.service.querykeys";
import { folderKeys } from "@/services/common.querykeys";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import config from "@/aws-exports";
import FolderList from "@/components/common/sidebar/FolderList.vue";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { getFoldersListByType } from "@/utils/commons";
import llmPromptsService, {
  type Prompt,
  type PromptLabel,
  type PromptSettings,
  type PromptVersion,
} from "@/services/llm-prompts.service";
import { aiPromptsRoute } from "./promptRoutes";
import PromptDetailDrawer from "./PromptDetailDrawer.vue";
import PromptEditorDialog from "./PromptEditorDialog.vue";
import PromptSettingsDialog from "./PromptSettingsDialog.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import PromptTrafficPanel from "./PromptTrafficPanel.vue";
import { storePromptPlaygroundHandoff } from "./promptPlaygroundHandoff";

const store = useStore();
const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();
const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const refreshing = ref(false);
const activeFolderId = ref(String(route.query.folder ?? "default"));
const folderScope = ref<"current" | "all">("current");
const search = ref("");
const tagFilter = ref<string | null>(null);
const labelFilter = ref<string | null>(null);
const detailTab = ref("configuration");
const statusFilter = ref<"active" | "archived" | "all">("active");
const selectedPrompt = ref<Prompt | null>(null);
const drawerOpen = ref(false);
const editorOpen = ref(false);
const editingPrompt = ref<Prompt | null>(null);
const editingVersion = ref<PromptVersion | null>(null);
const settingsOpen = ref(false);
const moveOpen = ref(false);
const movingPrompt = ref<Prompt | null>(null);
const moveDestination = ref("");

const orgId = computed(() =>
  String(store.state.selectedOrganization?.identifier ?? route.query.org_identifier ?? ""),
);
const promptQuery = useQuery(() => ({
  ...llmPromptsQuery(orgId.value),
  enabled: Boolean(orgId.value),
}));
const settingsQuery = useQuery(() => ({
  ...promptSettingsQuery(orgId.value),
  enabled: Boolean(orgId.value),
}));
const prompts = computed(() => promptQuery.data.value ?? []);
const protectedLabels = computed(() => settingsQuery.data.value?.protectedLabels ?? ["production"]);
const listError = computed(() =>
  promptQuery.isError.value
    ? errorText(promptQuery.error.value, t("aiObservability.promptManagement.loadError"))
    : null,
);
const updateMutation = useMutation(() => updatePromptMutation(orgId.value));
const archiveMutation = useMutation(() => archivePromptMutation(orgId.value));
const routeVersion = computed(() => {
  const parsed = Number(route.query.version);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
});
const canManageSettings = computed(() => {
  if (config.isEnterprise !== "true" && config.isCloud !== "true") return true;
  const role = String(store.state.userInfo?.role ?? "").toLowerCase();
  return !role || role === "root" || role === "admin";
});
const filteredPrompts = computed(() => {
  const needle = search.value.trim().toLowerCase();
  const tag = tagFilter.value?.toLowerCase();
  return prompts.value.filter((prompt) => {
    if (folderScope.value === "current" && prompt.folderId !== activeFolderId.value) return false;
    if (statusFilter.value !== "all" && prompt.status !== statusFilter.value) return false;
    if (
      needle &&
      !prompt.name.toLowerCase().includes(needle) &&
      !prompt.description?.toLowerCase().includes(needle) &&
      !activeLabels(prompt).some((label) => label.name.toLowerCase().includes(needle)) &&
      !prompt.tags.some((value) => value.toLowerCase().includes(needle))
    )
      return false;
    if (
      labelFilter.value &&
      !activeLabels(prompt).some((label) => label.name === labelFilter.value)
    )
      return false;
    return !tag || prompt.tags.some((value) => value.toLowerCase() === tag);
  });
});

const tagOptions = computed(() =>
  [...new Set(prompts.value.flatMap((prompt) => prompt.tags))]
    .sort()
    .map((value) => ({ label: raw(value), value })),
);
const labelOptions = computed(() =>
  [...new Set(prompts.value.flatMap((prompt) => activeLabels(prompt).map((label) => label.name)))]
    .sort()
    .map((value) => ({ label: raw(value), value })),
);
const hasFilters = computed(() =>
  Boolean(search.value || tagFilter.value || labelFilter.value || statusFilter.value !== "active"),
);
function clearFilters() {
  search.value = "";
  tagFilter.value = null;
  labelFilter.value = null;
  statusFilter.value = "active";
}
const statusOptions = computed(() => [
  { label: t("aiObservability.promptManagement.active"), value: "active" },
  { label: t("aiObservability.promptManagement.archived"), value: "archived" },
  { label: t("aiObservability.promptManagement.allStatuses"), value: "all" },
]);
const statusLabel = (status: Prompt["status"]) =>
  status === "active"
    ? t("aiObservability.promptManagement.active")
    : t("aiObservability.promptManagement.archived");
const columns: OTableColumnDef[] = [
  {
    id: "name",
    header: t("aiObservability.promptManagement.name"),
    accessorKey: "name",
    sortable: true,
  },
  {
    id: "tags",
    hideable: true,
    header: t("aiObservability.promptManagement.tags"),
    accessorKey: "tags",
  },
  {
    id: "labels",
    hideable: true,
    header: t("aiObservability.promptManagement.labels"),
    accessorKey: "labels",
  },
  {
    id: "latestVersion",
    hideable: true,
    header: t("aiObservability.promptManagement.latest"),
    accessorKey: "latestVersion",
    sortable: true,
  },
  {
    id: "status",
    hideable: true,
    header: t("aiObservability.promptManagement.status"),
    accessorKey: "status",
    sortable: true,
  },
  {
    id: "updatedAt",
    hideable: true,
    header: t("aiObservability.promptManagement.updated"),
    accessorKey: "updatedAt",
    sortable: true,
  },
  { id: "actions", isAction: true, header: raw(""), accessorKey: "entityId", size: 48 },
];

function activeLabels(prompt: Prompt): PromptLabel[] {
  return prompt.labels.filter((label) => label.version != null);
}
function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("response" in error)) return null;
  const response = error.response;
  if (!response || typeof response !== "object" || !("status" in response)) return null;
  return typeof response.status === "number" ? response.status : null;
}

function errorText(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "response" in error) {
    const response = error.response;
    if (response && typeof response === "object" && "data" in response) {
      const data = response.data;
      if (
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
      ) {
        return data.message;
      }
    }
  }
  return error instanceof Error ? error.message : fallback;
}

async function refresh() {
  refreshing.value = true;
  try {
    await queryClient.invalidateQueries({ queryKey: folderKeys.list(orgId.value, "prompts") });
    await Promise.all([
      promptQuery.refetch(),
      settingsQuery.refetch(),
      getFoldersListByType(store, "prompts"),
    ]);
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: raw(errorText(error, t("aiObservability.promptManagement.loadError"))),
    });
  } finally {
    refreshing.value = false;
  }
}

function updateCachedSettings(settings: PromptSettings) {
  queryClient.setQueryData(llmPromptKeys.settings(orgId.value), settings);
}

let selectionGeneration = 0;
async function syncSelection() {
  const generation = ++selectionGeneration;
  const selected = String(route.query.selected ?? "");
  if (!selected) {
    selectedPrompt.value = null;
    drawerOpen.value = false;
    return;
  }
  const cached = prompts.value.find((prompt) => prompt.entityId === selected);
  if (cached) {
    selectedPrompt.value = cached;
    drawerOpen.value = true;
    return;
  }
  if (promptQuery.isPending.value) return;
  try {
    // A deep link can point to a prompt missing from the cached list.
    const prompt = await llmPromptsService.get(orgId.value, selected);
    if (generation !== selectionGeneration) return;
    selectedPrompt.value = prompt;
    drawerOpen.value = true;
  } catch (error: unknown) {
    if (generation !== selectionGeneration) return;
    selectedPrompt.value = null;
    drawerOpen.value = false;
    toast({
      variant: "error",
      message: raw(errorText(error, t("aiObservability.promptManagement.loadError"))),
    });
  }
}

function selectFolder(folderId: string) {
  if (activeFolderId.value === (folderId || "default")) return;
  activeFolderId.value = folderId || "default";
  router.replace(
    aiPromptsRoute(orgId.value, {
      query: {
        ...route.query,
        folder: activeFolderId.value,
        selected: undefined,
        version: undefined,
      },
    }),
  );
}

function openDetail(prompt: Prompt, tab = "configuration") {
  detailTab.value = tab;
  selectedPrompt.value = prompt;
  drawerOpen.value = true;
  router.replace(
    aiPromptsRoute(orgId.value, {
      entityId: prompt.entityId,
      query: { ...route.query },
    }),
  );
}

function closeDetail(open: boolean) {
  drawerOpen.value = open;
  if (!open) {
    selectedPrompt.value = null;
    router.replace(
      aiPromptsRoute(orgId.value, {
        query: { ...route.query, selected: undefined, version: undefined },
      }),
    );
  }
}

function openCreate() {
  editingPrompt.value = null;
  editingVersion.value = null;
  editorOpen.value = true;
}

async function openEdit(prompt: Prompt) {
  const requestedOrg = orgId.value;
  try {
    editingPrompt.value = prompt;
    const version = await llmPromptsService.getVersion(
      requestedOrg,
      prompt.entityId,
      prompt.latestVersion,
    );
    if (requestedOrg !== orgId.value || editingPrompt.value?.entityId !== prompt.entityId) return;
    editingVersion.value = version;
    editorOpen.value = true;
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: raw(errorText(error, t("aiObservability.promptManagement.versionLoadError"))),
    });
  }
}

function openEditorForVersion(version: PromptVersion | null) {
  editingPrompt.value = selectedPrompt.value;
  editingVersion.value = version;
  editorOpen.value = true;
}

function afterSave(prompt: Prompt) {
  replacePrompt(prompt);
  selectedPrompt.value = prompt;
  drawerOpen.value = true;
  openDetail(prompt);
}

function replacePrompt(prompt: Prompt) {
  queryClient.setQueryData<Prompt[]>(llmPromptKeys.list(orgId.value), (entries = []) =>
    entries.some((entry) => entry.entityId === prompt.entityId)
      ? entries.map((entry) => (entry.entityId === prompt.entityId ? prompt : entry))
      : [prompt, ...entries],
  );
  if (selectedPrompt.value?.entityId === prompt.entityId) selectedPrompt.value = prompt;
}

function openMove(prompt: Prompt) {
  movingPrompt.value = prompt;
  moveDestination.value = "";
  moveOpen.value = true;
}

async function movePrompt() {
  if (!movingPrompt.value || !moveDestination.value || updateMutation.isPending.value) return;
  const versionCount = movingPrompt.value.latestVersion;
  const requestedOrg = orgId.value;
  try {
    const updated = await updateMutation.mutateAsync({
      entityId: movingPrompt.value.entityId,
      input: { folderId: moveDestination.value },
    });
    if (requestedOrg !== orgId.value) return;
    replacePrompt(updated);
    moveOpen.value = false;
    toast({
      variant: "success",
      message: t("aiObservability.promptManagement.moveSuccess", { count: versionCount }),
    });
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: raw(errorText(error, t("aiObservability.promptManagement.moveError"))),
    });
  }
}

async function archive(prompt: Prompt) {
  const requestedOrg = orgId.value;
  if (
    !(await confirm({
      title: t("aiObservability.promptManagement.archivePrompt"),
      message: t("aiObservability.promptManagement.archivePromptConfirmMessage", {
        name: raw(prompt.name),
      }),
      confirmLabel: t("aiObservability.promptManagement.archive"),
    }))
  )
    return;
  if (requestedOrg !== orgId.value) return;
  try {
    const updated = await archiveMutation.mutateAsync(prompt.entityId);
    if (requestedOrg !== orgId.value) return;
    replacePrompt(updated);
    toast({ variant: "success", message: t("aiObservability.promptManagement.archiveSuccess") });
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: raw(errorText(error, t("aiObservability.promptManagement.archiveError"))),
    });
  }
}

function openPlayground(version: PromptVersion, draftName = "") {
  const persistedPrompt = selectedPrompt.value ?? editingPrompt.value;
  const prompt =
    version.entityId === "draft"
      ? { entityId: "draft", name: draftName.trim() || "draft" }
      : persistedPrompt;
  if (!prompt) return;
  if (!router.hasRoute("aiPlayground")) {
    toast({
      variant: "info",
      message: t("aiObservability.promptManagement.enterprisePlaygroundOnly"),
    });
    return;
  }
  storePromptPlaygroundHandoff({
    entityId: prompt.entityId,
    id: version.id,
    name: prompt.name,
    version: version.version,
    payload: version.payload,
    config: version.config,
    provenance: { type: "prompt", label: `${prompt.name}@v${version.version}` },
  });
  router.push({ name: "aiPlayground", query: { org_identifier: orgId.value, from: "prompt" } });
}

watch(
  orgId,
  () => {
    selectionGeneration++;
    selectedPrompt.value = null;
    drawerOpen.value = false;
    editorOpen.value = false;
    moveOpen.value = false;
    settingsOpen.value = false;
    clearFilters();
    void getFoldersListByType(store, "prompts").catch(() => null);
  },
  { immediate: true },
);
watch([() => route.query.selected, prompts], syncSelection, { immediate: true });
watch(
  () => settingsQuery.error.value,
  (error) => {
    if (error && errorStatus(error) !== 403)
      toast({
        variant: "error",
        message: raw(errorText(error, t("aiObservability.promptManagement.settingsLoadError"))),
      });
  },
);
</script>
