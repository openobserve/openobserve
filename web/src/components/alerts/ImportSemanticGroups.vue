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
    container-class="h-[calc(100vh-var(--navbar-height))]!"
    @back="handleBack"
    @cancel="handleBack"
    @import="handleImport"
    @update:jsonArray="handleJsonUpdate"
  >
    <!-- Full-width content for diff view -->
    <template #full-width-content>
      <div class="w-full p-2 h-full flex-1 min-h-0 flex flex-col overflow-hidden">
        <!-- Compact Header with File Upload -->
        <div class="bg-card-glass-bg p-2 mb-2">
          <div class="flex items-center">
            <div class="w-full col-md-8">
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
                    class="cursor-pointer"
                  />
                </template>
              </OFile>
            </div>
            <div class="w-full col-md-4 text-right pl-2">
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
        <div v-if="diffData" class="flex flex-col h-full overflow-hidden">
          <!-- Compact Summary Bar -->
          <div class="bg-card-glass-bg p-2 mb-2">
            <div class="flex items-center gap-2">
              <div class="col-auto">
                <OTag type="diffCategory" value="new" class="text-sm!">
                  <strong class="text-sm">{{ diffData.additions.length }}</strong
                  >&nbsp;New
                </OTag>
              </div>
              <div class="col-auto">
                <OTag type="diffCategory" value="modified" class="text-sm!">
                  <strong class="text-sm">{{ diffData.modifications.length }}</strong
                  >&nbsp;Modified
                </OTag>
              </div>
              <div class="col-auto">
                <OTag type="diffCategory" value="unchanged" class="text-sm!">
                  {{ diffData.unchanged.length }} Unchanged
                </OTag>
              </div>
              <div class="flex flex-col">
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
          <div class="bg-card-glass-bg groups-scroll-container flex-1 overflow-y-auto overflow-x-hidden p-2">
            <!-- Additions -->
            <div v-if="diffData.additions.length > 0" class="mb-2">
              <div class="text-sm font-semibold border-b border-separator mb-1 text-status-positive p-1">
                <OIcon name="add-circle" size="sm" />
                New ({{ selectedAdditions.length }}/{{
                  diffData.additions.length
                }})
              </div>
              <ul class="flex flex-col divide-y divide-border border rounded-default mb-0">
                <li
                  v-for="group in diffData.additions"
                  :key="group.id"
                  data-test="semantic-groups-addition-item"
                  class="compact-item flex items-start gap-2 px-2 py-1 min-h-11 cursor-pointer hover:bg-muted/50"
                  @click="toggleAddition(group.id)"
                >
                  <div class="flex items-start shrink-0 pt-1">
                    <OCheckbox
                      :model-value="selectedAdditions.includes(group.id)"
                      @update:model-value="toggleAddition(group.id)"
                    />
                  </div>
                  <div class="flex flex-col flex-1 min-w-0 px-2">
                    <span class="text-compact font-medium">{{ group.display }}</span>
                    <span class="block text-2xs text-muted-foreground truncate">
                      {{ group.id }} • {{ group.fields.length }} fields
                      <OTag v-if="group.normalize" type="normalizeState" value="true" class="ml-1" />
                    </span>
                  </div>
                  <div class="flex items-center shrink-0 ms-auto">
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
            <div v-if="diffData.modifications.length > 0" class="mb-2">
              <div class="text-sm font-semibold border-b border-separator mb-1 text-status-warning-text p-1">
                <OIcon name="edit" size="sm" />
                Modified ({{ selectedModifications.length }}/{{
                  diffData.modifications.length
                }})
              </div>
              <ul class="flex flex-col divide-y divide-border border rounded-default mb-0">
                <li
                  v-for="mod in diffData.modifications"
                  :key="mod.proposed.id"
                  data-test="semantic-groups-modification-item"
                  class="compact-item flex items-start gap-2 px-2 py-1 min-h-11 cursor-pointer hover:bg-muted/50"
                  @click="toggleModification(mod.proposed.id)"
                >
                  <div class="flex items-start shrink-0 pt-1">
                    <OCheckbox
                      :model-value="
                        selectedModifications.includes(mod.proposed.id)
                      "
                      @update:model-value="toggleModification(mod.proposed.id)"
                    />
                  </div>
                  <div class="flex flex-col flex-1 min-w-0 px-2">
                    <span class="text-compact font-medium">{{ mod.proposed.display }}</span>
                    <span class="block text-2xs text-muted-foreground truncate">
                      {{ mod.proposed.id }} • {{ mod.current.fields.length }} → {{ mod.proposed.fields.length }} fields
                    </span>
                  </div>
                  <div class="flex items-center shrink-0 ms-auto">
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
                <ul class="flex flex-col divide-y divide-border border rounded-default mb-0">
                  <li
                    v-for="group in diffData.unchanged"
                    :key="group.id"
                    class="compact-item flex items-center gap-2 px-2 py-1 min-h-11"
                  >
                    <div class="flex flex-col flex-1 min-w-0 px-2">
                      <span class="text-compact">{{ group.display }}</span>
                      <span class="block text-2xs text-muted-foreground">{{ group.id }} • {{ group.fields.length }} fields</span>
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
          class="bg-card-glass-bg p-4 text-center"
        >
          <OIcon name="cloud-upload" class="mb-3 size-16!" />
          <div class="text-xl font-semibold text-text-muted mb-2">
            Upload a JSON file to get started
          </div>
          <div class="text-sm text-text-secondary">
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
      <div class="text-sm font-medium mb-2">
        Fields ({{ selectedGroup?.fields.length }})
      </div>
      <OTag
        v-for="field in selectedGroup?.fields"
        :key="field"
        type="fieldNameChip"
        value="highlight"
        class="m-1"
      >
        {{ field }}
      </OTag>
      <div class="mt-3">
        <OTag type="normalizeState" :value="!!selectedGroup?.normalize" />
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
    <div class="flex gap-3">
      <div class="w-1/2">
        <div class="text-sm font-medium text-status-error-text mb-2">Current</div>
        <div class="text-xs mb-1">
          {{ selectedModification?.current.fields.length }} fields
        </div>
        <div class="field-chips-container max-h-62.5 overflow-y-auto p-2 bg-surface-base rounded-default">
          <OTag
            v-for="field in selectedModification?.current.fields"
            :key="`current-${field}`"
            type="fieldNameChip"
            value="muted"
            class="m-1"
          >
            {{ field }}
          </OTag>
        </div>
      </div>
      <div class="w-1/2">
        <div class="text-sm font-medium text-status-positive mb-2">Proposed</div>
        <div class="text-xs mb-1">
          {{ selectedModification?.proposed.fields.length }} fields
        </div>
        <div class="field-chips-container max-h-62.5 overflow-y-auto p-2 bg-surface-base rounded-default">
          <OTag
            v-for="field in selectedModification?.proposed.fields"
            :key="`proposed-${field}`"
            type="fieldDiffStatus"
            :value="isNewField(field) ? 'new' : 'existing'"
            class="m-1"
          >
            {{ field }}
            <template #trailing>
              <OIcon
                v-if="isNewField(field)"
                name="add"
                size="xs"
                class="ml-1"
              />
            </template>
          </OTag>
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts" setup>
import { ref, computed } from "vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import type { FileValue } from "@/lib/forms/File/OFile.types";
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

const loadFile = async (value: FileValue) => {
  // Single-file input; take the first file when the model yields an array.
  const file = Array.isArray(value) ? value[0] : value;
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

<style scoped>
/* keep(scrollbar): ::-webkit-scrollbar pseudo-elements aren't expressible as utilities */
.groups-scroll-container::-webkit-scrollbar {
  width: 0.5rem;
}

.groups-scroll-container::-webkit-scrollbar-track {
  background: var(--color-surface-base);
}

.groups-scroll-container::-webkit-scrollbar-thumb {
  background: var(--color-accent);
  border-radius: 0.25rem;
}

.groups-scroll-container::-webkit-scrollbar-thumb:hover {
  background: var(--color-accent);
}

.field-chips-container::-webkit-scrollbar {
  width: 0.375rem;
}

.field-chips-container::-webkit-scrollbar-track {
  background: var(--color-surface-base);
}

.field-chips-container::-webkit-scrollbar-thumb {
  background: var(--color-accent);
  border-radius: 0.1875rem;
}
</style>
