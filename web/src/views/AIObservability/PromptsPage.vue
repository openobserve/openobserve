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
    <template #actions>
      <OButton
        v-if="canManageSettings"
        variant="outline"
        size="sm"
        icon-left="settings"
        data-test="prompts-settings"
        @click="settingsOpen = true"
        >{{ t("aiObservability.promptManagement.settings") }}</OButton
      >
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
          :loading="loading"
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
          @row-click="openDetail"
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
                class="w-36"
                data-test="prompt-status-filter"
              />
              <OInput
                v-model="tagFilter"
                class="w-40"
                :placeholder="t('aiObservability.promptManagement.filterTag')"
                clearable
              />
              <OToggleGroup v-model="folderScope" type="single">
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
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              :title="t('aiObservability.promptManagement.refreshPrompts')"
              @click="loadPrompts"
            />
          </template>

          <template #cell-name="{ row }">
            <div class="flex min-w-0 flex-col">
              <span class="text-text-heading truncate font-medium">{{ row.name }}</span>
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
            <div class="flex flex-wrap gap-1">
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
            </div>
          </template>
          <template #cell-latestVersion="{ row }">
            <span class="tabular-nums">{{
              t("aiObservability.promptManagement.versionNumber", { version: row.latestVersion })
            }}</span>
          </template>
          <template #cell-status="{ row }">
            <OTag :variant="row.status === 'active' ? 'success-soft' : 'default-soft'">{{
              row.status
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
                  :title="raw('Prompt actions')"
                />
              </template>
              <ODropdownItem @select="openEdit(row)">{{
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
      @updated="protectedLabels = $event.protectedLabels"
    />

    <ODialog
      :open="moveOpen"
      :title="t('aiObservability.promptManagement.movePrompt')"
      :primary-button-label="t('aiObservability.promptManagement.move')"
      :secondary-button-label="t('aiObservability.promptManagement.cancel')"
      :primary-button-disabled="!moveDestination || moveDestination === movingPrompt?.folderId"
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
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import config from "@/aws-exports";
import FolderList from "@/components/common/sidebar/FolderList.vue";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
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
const prompts = ref<Prompt[]>([]);
const loading = ref(false);
const activeFolderId = ref(String(route.query.folder ?? "default"));
const folderScope = ref<"current" | "all">("current");
const search = ref("");
const tagFilter = ref("");
const statusFilter = ref<"active" | "archived" | "all">("active");
const selectedPrompt = ref<Prompt | null>(null);
const drawerOpen = ref(false);
const editorOpen = ref(false);
const editingPrompt = ref<Prompt | null>(null);
const editingVersion = ref<PromptVersion | null>(null);
const settingsOpen = ref(false);
const protectedLabels = ref<string[]>(["production"]);
const moveOpen = ref(false);
const movingPrompt = ref<Prompt | null>(null);
const moveDestination = ref("");

const orgId = computed(() =>
  String(store.state.selectedOrganization?.identifier ?? route.query.org_identifier ?? ""),
);
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
  const tag = tagFilter.value.trim().toLowerCase();
  return prompts.value.filter((prompt) => {
    if (folderScope.value === "current" && prompt.folderId !== activeFolderId.value) return false;
    if (statusFilter.value !== "all" && prompt.status !== statusFilter.value) return false;
    if (
      needle &&
      !prompt.name.toLowerCase().includes(needle) &&
      !prompt.tags.some((value) => value.toLowerCase().includes(needle))
    )
      return false;
    return !tag || prompt.tags.some((value) => value.toLowerCase() === tag);
  });
});

const statusOptions = [
  { label: raw("Active"), value: "active" },
  { label: raw("Archived"), value: "archived" },
  { label: raw("All statuses"), value: "all" },
];
const columns: OTableColumnDef[] = [
  { id: "name", header: raw("Name"), accessorKey: "name", sortable: true },
  { id: "tags", header: raw("Tags"), accessorKey: "tags" },
  { id: "labels", header: raw("Labels"), accessorKey: "labels" },
  { id: "latestVersion", header: raw("Latest"), accessorKey: "latestVersion", sortable: true },
  { id: "status", header: raw("Status"), accessorKey: "status", sortable: true },
  { id: "updatedAt", header: raw("Updated"), accessorKey: "updatedAt", sortable: true },
  { id: "actions", header: raw(""), accessorKey: "entityId", size: 48 },
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

async function loadPrompts() {
  if (!orgId.value) return;
  loading.value = true;
  try {
    prompts.value = await llmPromptsService.list(orgId.value, { includeArchived: true });
    const selected = String(route.query.selected ?? "");
    if (selected) {
      selectedPrompt.value = prompts.value.find((prompt) => prompt.entityId === selected) ?? null;
      if (!selectedPrompt.value)
        selectedPrompt.value = await llmPromptsService.get(orgId.value, selected);
      drawerOpen.value = true;
    }
  } catch (error: unknown) {
    toast({ variant: "error", message: raw(errorText(error, "Failed to load prompts.")) });
  } finally {
    loading.value = false;
  }
}

async function loadSettings() {
  try {
    protectedLabels.value = (await llmPromptsService.getSettings(orgId.value)).protectedLabels;
  } catch (error: unknown) {
    if (errorStatus(error) !== 403) {
      toast({
        variant: "error",
        message: raw(errorText(error, "Failed to load prompt settings.")),
      });
    }
  }
}

function selectFolder(folderId: string) {
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

function openDetail(prompt: Prompt) {
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
  try {
    editingPrompt.value = prompt;
    editingVersion.value = await llmPromptsService.getVersion(
      orgId.value,
      prompt.entityId,
      prompt.latestVersion,
    );
    editorOpen.value = true;
  } catch (error: unknown) {
    toast({ variant: "error", message: raw(errorText(error, "Failed to load prompt version.")) });
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
  const index = prompts.value.findIndex((entry) => entry.entityId === prompt.entityId);
  if (index < 0) prompts.value.unshift(prompt);
  else prompts.value.splice(index, 1, prompt);
  if (selectedPrompt.value?.entityId === prompt.entityId) selectedPrompt.value = prompt;
}

function openMove(prompt: Prompt) {
  movingPrompt.value = prompt;
  moveDestination.value = "";
  moveOpen.value = true;
}

async function movePrompt() {
  if (!movingPrompt.value || !moveDestination.value) return;
  const versionCount = movingPrompt.value.latestVersion;
  try {
    const updated = await llmPromptsService.update(orgId.value, movingPrompt.value.entityId, {
      folderId: moveDestination.value,
    });
    replacePrompt(updated);
    moveOpen.value = false;
    toast({
      variant: "success",
      message: raw(`Prompt moved. ${versionCount} versions unchanged.`),
    });
  } catch (error: unknown) {
    toast({ variant: "error", message: raw(errorText(error, "Failed to move prompt.")) });
  }
}

async function archive(prompt: Prompt) {
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
  try {
    const updated = await llmPromptsService.archive(orgId.value, prompt.entityId);
    replacePrompt(updated);
    toast({ variant: "success", message: raw("Prompt archived.") });
  } catch (error: unknown) {
    toast({ variant: "error", message: raw(errorText(error, "Failed to archive prompt.")) });
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
    toast({ variant: "info", message: raw("Playground is available in the Enterprise edition.") });
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

onMounted(async () => {
  await getFoldersListByType(store, "prompts").catch(() => null);
  await Promise.all([loadPrompts(), loadSettings()]);
});
watch(orgId, loadPrompts);
watch(() => route.query.selected, loadPrompts);
</script>
