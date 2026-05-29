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
  <base-import
    ref="baseImportRef"
    title="Import Semantic Groups"
    test-prefix="semantic-groups"
    :is-importing="isImporting"
    :show-splitter="false"
    :editor-heights="{
      urlEditor: 'calc(100vh - 286px)',
      fileEditor: 'calc(100vh - 308px)',
    }"
    @back="handleBack"
    @cancel="handleBack"
    @import="handleImport"
    @update:jsonArray="handleJsonUpdate"
  >
    <!-- Full-width content for diff view -->
    <template #full-width-content>
      <div class="import-semantic-groups-container">
        <!-- Compact Header with File Upload -->
        <div class="card-container tw:p-2 tw:mb-2">
          <div class="tw:flex tw:items-center">
            <div class="tw:w-full col-md-8">
              <OFile
                v-model="jsonFile"
                label="Select JSON file"
                accept=".json"
                @update:model-value="loadFile"
                data-test="semantic-groups-import-file"
                class="compact-file-input"
              >
                <template v-slot:prepend>
                  <OIcon name="cloud-upload" size="sm" />
                </template>
                <template v-slot:append>
                  <OIcon
                    v-if="jsonFile"
                    name="close"
                    size="sm"
                    @click.stop="clearFile"
                    class="tw:cursor-pointer"
                  />
                </template>
              </OFile>
            </div>
            <div class="tw:w-full col-md-4 tw:text-right tw:pl-2">
              <OButton
                v-if="diffData"
                variant="primary"
                size="sm"
                @click="applyChanges"
                :disable="!hasSelectedChanges"
                :loading="isApplying"
                >Apply Changes</OButton
              >
            </div>
          </div>
        </div>

        <!-- Diff Preview Section with Scrollable Content -->
        <div v-if="diffData" class="diff-container">
          <!-- Compact Summary Bar -->
          <div class="card-container tw:p-2 tw:mb-2">
            <div class="tw:flex tw:items-center tw:gap-2">
              <div class="col-auto">
                <OBadge variant="success" class="summary-chip">
                  <strong>{{ diffData.additions.length }}</strong
                  >&nbsp;New
                </OBadge>
              </div>
              <div class="col-auto">
                <OBadge variant="warning" class="summary-chip">
                  <strong>{{ diffData.modifications.length }}</strong
                  >&nbsp;Modified
                </OBadge>
              </div>
              <div class="col-auto">
                <OBadge variant="default" class="summary-chip">
                  {{ diffData.unchanged.length }} Unchanged
                </OBadge>
              </div>
              <div class="tw:flex tw:flex-col">
                <OButtonGroup class="float-right">
                  <OButton
                    variant="ghost-primary"
                    size="xs"
                    @click="selectAllAdditions"
                    >Select All New</OButton
                  >
                  <OButton
                    variant="ghost-warning"
                    size="xs"
                    @click="selectAllModifications"
                    >Select All Modified</OButton
                  >
                  <OButton variant="ghost-muted" size="xs" @click="deselectAll"
                    >Clear All</OButton
                  >
                </OButtonGroup>
              </div>
            </div>
          </div>

          <!-- Scrollable Groups Container -->
          <div class="card-container groups-scroll-container">
            <!-- Additions -->
            <div v-if="diffData.additions.length > 0" class="tw:mb-2">
              <div class="section-header tw:text-green-500 tw:p-1">
                <OIcon name="add-circle" size="sm" />
                New ({{ selectedAdditions.length }}/{{
                  diffData.additions.length
                }})
              </div>
              <ul class="compact-list tw:flex tw:flex-col tw:divide-y tw:divide-border tw:border tw:rounded-md">
                <li
                  v-for="group in diffData.additions"
                  :key="group.id"
                  data-test="semantic-groups-addition-item"
                  class="compact-item tw:flex tw:items-start tw:gap-2 tw:px-2 tw:py-1 tw:min-h-[44px] tw:cursor-pointer hover:tw:bg-muted/50"
                  @click="toggleAddition(group.id)"
                >
                  <div class="tw:flex tw:items-start tw:shrink-0 tw:pt-1">
                    <OCheckbox
                      :model-value="selectedAdditions.includes(group.id)"
                      @update:model-value="toggleAddition(group.id)"
                    />
                  </div>
                  <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:px-2">
                    <span class="tw:text-[13px] tw:font-medium">{{ group.display }}</span>
                    <span class="tw:block tw:text-[11px] tw:text-muted-foreground tw:truncate">
                      {{ group.id }} • {{ group.fields.length }} fields
                      <OBadge v-if="group.normalize" variant="primary" class="tw:ml-1">norm</OBadge>
                    </span>
                  </div>
                  <div class="tw:flex tw:items-center tw:shrink-0 tw:ms-auto">
                    <OButton
                      variant="ghost"
                      size="icon-circle-sm"
                      @click.stop="viewGroup(group)"
                    >
                      <OIcon name="visibility" size="sm" />
                    </OButton>
                  </div>
                </li>
              </ul>
            </div>

            <!-- Modifications -->
            <div v-if="diffData.modifications.length > 0" class="tw:mb-2">
              <div class="section-header tw:text-amber-500 tw:p-1">
                <OIcon name="edit" size="sm" />
                Modified ({{ selectedModifications.length }}/{{
                  diffData.modifications.length
                }})
              </div>
              <ul class="compact-list tw:flex tw:flex-col tw:divide-y tw:divide-border tw:border tw:rounded-md">
                <li
                  v-for="mod in diffData.modifications"
                  :key="mod.proposed.id"
                  data-test="semantic-groups-modification-item"
                  class="compact-item tw:flex tw:items-start tw:gap-2 tw:px-2 tw:py-1 tw:min-h-[44px] tw:cursor-pointer hover:tw:bg-muted/50"
                  @click="toggleModification(mod.proposed.id)"
                >
                  <div class="tw:flex tw:items-start tw:shrink-0 tw:pt-1">
                    <OCheckbox
                      :model-value="
                        selectedModifications.includes(mod.proposed.id)
                      "
                      @update:model-value="toggleModification(mod.proposed.id)"
                    />
                  </div>
                  <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:px-2">
                    <span class="tw:text-[13px] tw:font-medium">{{ mod.proposed.display }}</span>
                    <span class="tw:block tw:text-[11px] tw:text-muted-foreground tw:truncate">
                      {{ mod.proposed.id }} • {{ mod.current.fields.length }} → {{ mod.proposed.fields.length }} fields
                    </span>
                  </div>
                  <div class="tw:flex tw:items-center tw:shrink-0 tw:ms-auto">
                    <OButton
                      variant="ghost"
                      size="icon-circle-sm"
                      @click.stop="viewModification(mod)"
                    >
                      <OIcon name="compare" size="sm" />
                    </OButton>
                  </div>
                </li>
              </ul>
            </div>

            <!-- Unchanged (Collapsed) -->
            <div v-if="diffData.unchanged.length > 0">
              <OCollapsible
                v-model="unchangedOpen"
                :label="`Unchanged (${diffData.unchanged.length})`"
                icon="check-circle"
              >
                <ul class="compact-list tw:flex tw:flex-col tw:divide-y tw:divide-border tw:border tw:rounded-md">
                  <li
                    v-for="group in diffData.unchanged"
                    :key="group.id"
                    class="compact-item tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-1 tw:min-h-[44px]"
                  >
                    <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:px-2">
                      <span class="tw:text-[13px]">{{ group.display }}</span>
                      <span class="tw:block tw:text-[11px] tw:text-muted-foreground">{{ group.id }} • {{ group.fields.length }} fields</span>
                    </div>
                  </li>
                </ul>
              </OCollapsible>
            </div>
          </div>
        </div>

        <!-- No Diff State -->
        <div
          v-else-if="!isImporting && !diffData"
          class="card-container tw:p-4 tw:text-center"
        >
          <OIcon name="cloud-upload" class="tw:mb-3" style="width: 64px; height: 64px;" />
          <div class="tw:text-xl tw:font-semibold tw:text-gray-400 tw:mb-2">
            Upload a JSON file to get started
          </div>
          <div class="tw:text-sm tw:text-gray-400">
            The system will analyze the file and show you what will change
          </div>
        </div>
      </div>
    </template>
  </base-import>

  <!-- Group Details Dialog -->
  <ODialog
    data-test="import-semantic-groups-group-dialog"
    v-model:open="showGroupDialog"
    size="md"
    :title="selectedGroup?.display"
    :sub-title="`ID: ${selectedGroup?.id}`"
    primary-button-label="Close"
    @click:primary="showGroupDialog = false"
  >
    <div>
      <div class="tw:text-sm tw:font-medium tw:mb-2">
        Fields ({{ selectedGroup?.fields.length }})
      </div>
      <OBadge
        v-for="field in selectedGroup?.fields"
        :key="field"
        color="primary"
        text-color="white"
        class="tw:m-1"
      >
        {{ field }}
      </OBadge>
      <div class="tw:mt-3">
        <OBadge v-if="selectedGroup?.normalize" variant="primary"
          >Normalized</OBadge
        >
        <OBadge v-else variant="default">Not Normalized</OBadge>
      </div>
    </div>
  </ODialog>

  <!-- Modification Comparison Dialog -->
  <ODialog
    data-test="import-semantic-groups-modification-dialog"
    v-model:open="showModificationDialog"
    size="lg"
    :title="selectedModification?.proposed.display"
    sub-title="Compare Changes"
    primary-button-label="Close"
    @click:primary="showModificationDialog = false"
  >
    <div class="tw:flex tw:gap-3">
      <div class="tw:w-1/2">
        <div class="tw:text-sm tw:font-medium tw:text-red-500 tw:mb-2">Current</div>
        <div class="tw:text-xs tw:mb-1">
          {{ selectedModification?.current.fields.length }} fields
        </div>
        <div class="field-chips-container">
          <OBadge
            v-for="field in selectedModification?.current.fields"
            :key="`current-${field}`"
            color="grey-4"
            size="sm"
            class="tw:m-1"
          >
            {{ field }}
          </OBadge>
        </div>
      </div>
      <div class="tw:w-1/2">
        <div class="tw:text-sm tw:font-medium tw:text-green-500 tw:mb-2">Proposed</div>
        <div class="tw:text-xs tw:mb-1">
          {{ selectedModification?.proposed.fields.length }} fields
        </div>
        <div class="field-chips-container">
          <OBadge
            v-for="field in selectedModification?.proposed.fields"
            :key="`proposed-${field}`"
            :variant="isNewField(field) ? 'success' : 'default'"
            size="sm"
            class="tw:m-1"
          >
            {{ field }}
            <OIcon
              v-if="isNewField(field)"
              name="add"
              size="xs"
              class="tw:ml-1"
            />
          </OBadge>
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts" setup>
import { ref, computed } from "vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import BaseImport from "@/components/common/BaseImport.vue";
import alertsService from "@/services/alerts";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

interface SemanticGroup {
  id: string;
  display: string;
  fields: string[];
  normalize: boolean;
}

interface SemanticGroupModification {
  current: SemanticGroup;
  proposed: SemanticGroup;
}

interface SemanticGroupDiff {
  additions: SemanticGroup[];
  modifications: SemanticGroupModification[];
  unchanged: SemanticGroup[];
}

const router = useRouter();
const store = useStore();

const jsonFile = ref<File | null>(null);
const importedGroups = ref<SemanticGroup[]>([]);
const diffData = ref<SemanticGroupDiff | null>(null);
const selectedAdditions = ref<string[]>([]);
const selectedModifications = ref<string[]>([]);
const isImporting = ref(false);
const unchangedOpen = ref(false);
const isApplying = ref(false);
const showGroupDialog = ref(false);
const showModificationDialog = ref(false);
const selectedGroup = ref<SemanticGroup | null>(null);
const selectedModification = ref<SemanticGroupModification | null>(null);

const hasSelectedChanges = computed(() => {
  return (
    selectedAdditions.value.length > 0 || selectedModifications.value.length > 0
  );
});

const loadFile = async (file: File | null) => {
  if (!file) return;

  isImporting.value = true;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const groups = Array.isArray(parsed) ? parsed : [parsed];

    // Validate groups
    for (const group of groups) {
      if (!group.id || !group.display || !Array.isArray(group.fields)) {
        throw new Error("Invalid semantic group format");
      }
    }

    importedGroups.value = groups;
    await previewDiff(groups);
  } catch (error: any) {
    toast({
      message: `Failed to parse JSON: ${error.message}`,
      variant: "error",
    });
    clearFile();
  } finally {
    isImporting.value = false;
  }
};

const clearFile = () => {
  jsonFile.value = null;
  importedGroups.value = [];
  diffData.value = null;
  selectedAdditions.value = [];
  selectedModifications.value = [];
};

const previewDiff = async (groups: SemanticGroup[]) => {
  try {
    const org = store.state.selectedOrganization.identifier;
    const response = await alertsService.previewSemanticGroupsDiff(org, groups);
    diffData.value = response.data;

    // Auto-select all additions and modifications
    selectedAdditions.value = response.data.additions.map(
      (g: SemanticGroup) => g.id,
    );
    selectedModifications.value = response.data.modifications.map(
      (m: SemanticGroupModification) => m.proposed.id,
    );
  } catch (error: any) {
    toast({
      message: `Failed to preview changes: ${error.response?.data?.error || error.message}`,
      variant: "error",
    });
  }
};

const selectAllAdditions = () => {
  if (!diffData.value) return;
  selectedAdditions.value = diffData.value.additions.map((g) => g.id);
};

const selectAllModifications = () => {
  if (!diffData.value) return;
  selectedModifications.value = diffData.value.modifications.map(
    (m) => m.proposed.id,
  );
};

const deselectAll = () => {
  selectedAdditions.value = [];
  selectedModifications.value = [];
};

const toggleAddition = (id: string) => {
  const index = selectedAdditions.value.indexOf(id);
  if (index > -1) {
    selectedAdditions.value.splice(index, 1);
  } else {
    selectedAdditions.value.push(id);
  }
};

const toggleModification = (id: string) => {
  const index = selectedModifications.value.indexOf(id);
  if (index > -1) {
    selectedModifications.value.splice(index, 1);
  } else {
    selectedModifications.value.push(id);
  }
};

const viewGroup = (group: SemanticGroup) => {
  selectedGroup.value = group;
  showGroupDialog.value = true;
};

const viewModification = (mod: SemanticGroupModification) => {
  selectedModification.value = mod;
  showModificationDialog.value = true;
};

const isNewField = (field: string) => {
  if (!selectedModification.value) return false;
  return !selectedModification.value.current.fields.includes(field);
};

const applyChanges = async () => {
  if (!diffData.value || !hasSelectedChanges.value) return;

  isApplying.value = true;
  try {
    // Build the final groups list
    const finalGroups: SemanticGroup[] = [];

    // Add selected additions
    const selectedAdditionGroups = diffData.value.additions.filter((g) =>
      selectedAdditions.value.includes(g.id),
    );
    finalGroups.push(...selectedAdditionGroups);

    // Add selected modifications
    const selectedModificationGroups = diffData.value.modifications
      .filter((m) => selectedModifications.value.includes(m.proposed.id))
      .map((m) => m.proposed);
    finalGroups.push(...selectedModificationGroups);

    // Add unchanged groups
    finalGroups.push(...diffData.value.unchanged);

    // Add unselected current groups (keep them as-is)
    const unselectedModifications = diffData.value.modifications
      .filter((m) => !selectedModifications.value.includes(m.proposed.id))
      .map((m) => m.current);
    finalGroups.push(...unselectedModifications);

    // Save to backend
    const org = store.state.selectedOrganization.identifier;
    await alertsService.saveSemanticGroups(org, finalGroups);

    toast({
      message: `Successfully applied ${selectedAdditions.value.length + selectedModifications.value.length} changes`,
      variant: "success",
    });

    // Go back
    handleBack();
  } catch (error: any) {
    toast({
      message: `Failed to save changes: ${error.response?.data?.error || error.message}`,
      variant: "error",
    });
  } finally {
    isApplying.value = false;
  }
};

const handleBack = () => {
  router.back();
};

const handleImport = () => {
  // This is handled by the file upload
};

const handleJsonUpdate = async (jsonArray: any[]) => {
  if (!jsonArray || jsonArray.length === 0) return;

  isImporting.value = true;
  try {
    // Validate groups
    for (const group of jsonArray) {
      if (!group.id || !group.display || !Array.isArray(group.fields)) {
        throw new Error("Invalid semantic group format");
      }
    }

    importedGroups.value = jsonArray;
    await previewDiff(jsonArray);
  } catch (error: any) {
    toast({
      message: `Invalid JSON: ${error.message}`,
      variant: "error",
    });
  } finally {
    isImporting.value = false;
  }
};
</script>

<style lang="scss" scoped>
.import-semantic-groups-container {
  width: 100%;
  padding: 8px;
  height: calc(100vh - 140px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.compact-file-input {
  :deep(.q-field__control) {
    min-height: 40px;
  }
}

.diff-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.groups-scroll-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px;

  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: var(--q-dark-page);
  }

  &::-webkit-scrollbar-thumb {
    background: var(--q-primary);
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--q-primary-dark);
  }
}

.section-header {
  font-size: 14px;
  font-weight: 600;
  border-bottom: 1px solid var(--color-separator);
  margin-bottom: 4px;
}

.compact-list {
  margin-bottom: 0;
}

.compact-item {
  min-height: 44px;
  padding: 4px 8px;
}

.field-chips-container {
  max-height: 250px;
  overflow-y: auto;
  padding: 8px;
  background: var(--q-dark);
  border-radius: 4px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: var(--q-dark-page);
  }

  &::-webkit-scrollbar-thumb {
    background: var(--q-primary);
    border-radius: 3px;
  }
}

.summary-chip {
  font-size: 14px !important;

  :deep(strong) {
    font-size: 15px;
  }
}

.action-btn {
  font-size: 13px !important;
  min-height: 34px;
  padding: 6px 14px;
  font-weight: 500;
}
</style>
