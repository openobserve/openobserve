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
  <ODrawer
    data-test="semantic-field-groups-config-import-drawer"
    v-model:open="internalOpen"
    :width="40"
    title="Import Semantic Groups"
    sub-title="Upload JSON file to import semantic field groups"
    secondary-button-label="Cancel"
    primary-button-label="Apply Changes"
    :primary-button-disabled="!hasSelectedChanges"
    :primary-button-loading="isApplying"
    @click:secondary="handleClose"
    @click:primary="handleApply"
    @update:open="handleOpenChange"
  >
  <div class="tw:p-3">
      <!-- File Upload -->
      <div class="tw:mb-3">
        <OFile
          v-model="jsonFile"
          label="Select JSON file"
          accept=".json"
          @update:model-value="loadFile"
          data-test="semantic-groups-import-file-drawer"
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

      <!-- Loading State -->
      <div v-if="isLoading" class="tw:text-center tw:p-4">
        <OSpinner variant="dots" size="lg" />
        <div class="tw:text-sm tw:text-gray-400 tw:mt-3">Analyzing file...</div>
      </div>

      <!-- Diff Preview -->
      <div v-else-if="diffData" class="diff-preview">
        <!-- Summary -->
        <div class="summary-bar tw:mb-3">
          <div class="tw:flex tw:gap-2 tw:items-center">
            <div class="col-auto">
              <OBadge variant="success">
                <strong>{{ diffData.additions.length }}</strong
                >&nbsp;New
              </OBadge>
            </div>
            <div class="col-auto">
              <OBadge variant="warning">
                <strong>{{ diffData.modifications.length }}</strong
                >&nbsp;Modified
              </OBadge>
            </div>
            <div class="col-auto">
              <OBadge variant="default">
                {{ diffData.unchanged.length }} Unchanged
              </OBadge>
            </div>
          </div>
        </div>

        <!-- Selection Actions -->
        <div class="selection-actions tw:mb-3">
          <OButtonGroup>
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

        <!-- Groups List -->
        <div class="groups-list">
          <!-- Additions -->
          <div v-if="diffData.additions.length > 0" class="tw:mb-3">
            <div class="section-header tw:text-green-500 tw:p-2">
              <OIcon name="add-circle" size="sm" />
              New ({{ selectedAdditions.length }}/{{
                diffData.additions.length
              }})
            </div>
            <ul class="tw:flex tw:flex-col tw:divide-y tw:divide-border tw:border tw:rounded-md">
              <li
                v-for="group in diffData.additions"
                :key="group.id"
                data-test="semantic-groups-drawer-addition-item"
                class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:cursor-pointer hover:tw:bg-muted/50"
                @click="toggleAddition(group.id)"
              >
                <div class="tw:flex tw:items-center tw:shrink-0">
                  <OCheckbox
                    :model-value="selectedAdditions.includes(group.id)"
                    @update:model-value="toggleAddition(group.id)"
                  />
                </div>
                <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
                  <span class="tw:text-sm tw:font-medium">{{
                    group.display
                  }}</span>
                  <span class="tw:block tw:text-xs tw:text-muted-foreground">
                    {{ group.id }} • {{ group.fields.length }} fields
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
          <div v-if="diffData.modifications.length > 0" class="tw:mb-3">
            <div class="section-header tw:text-amber-500 tw:p-2">
              <OIcon name="edit" size="sm" />
              Modified ({{ selectedModifications.length }}/{{
                diffData.modifications.length
              }})
            </div>
            <ul class="tw:flex tw:flex-col tw:divide-y tw:divide-border tw:border tw:rounded-md">
              <li
                v-for="mod in diffData.modifications"
                :key="mod.proposed.id"
                data-test="semantic-groups-drawer-modification-item"
                class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:cursor-pointer hover:tw:bg-muted/50"
                @click="toggleModification(mod.proposed.id)"
              >
                <div class="tw:flex tw:items-center tw:shrink-0">
                  <OCheckbox
                    :model-value="
                      selectedModifications.includes(mod.proposed.id)
                    "
                    @update:model-value="toggleModification(mod.proposed.id)"
                  />
                </div>
                <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
                  <span class="tw:text-sm tw:font-medium">{{
                    mod.proposed.display
                  }}</span>
                  <span class="tw:block tw:text-xs tw:text-muted-foreground">
                    {{ mod.proposed.id }} • {{ mod.current.fields.length }} →
                    {{ mod.proposed.fields.length }} fields
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
              <ul class="tw:flex tw:flex-col tw:divide-y tw:divide-border tw:border tw:rounded-md">
                <li
                  v-for="group in diffData.unchanged"
                  :key="group.id"
                  class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2"
                >
                  <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
                    <span class="tw:text-sm">{{ group.display }}</span>
                    <span class="tw:block tw:text-xs tw:text-muted-foreground"
                      >{{ group.id }} •
                      {{ group.fields.length }} fields</span
                    >
                  </div>
                </li>
              </ul>
            </OCollapsible>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="empty-state tw:text-center tw:p-4">
        <OIcon name="cloud-upload" class="tw:mb-3" style="width: 64px; height: 64px;" />
        <div class="tw:text-xl tw:font-semibold tw:text-gray-400 tw:mb-2">Upload a JSON file</div>
        <div class="tw:text-sm tw:text-gray-400">
          The system will analyze the file and show you what will change
        </div>
      </div>
    </div>
  </ODrawer>

  <!-- Group Details Dialog -->
  <ODialog
    data-test="import-semantic-groups-drawer-group-dialog"
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
        variant="primary"
        class="tw:m-1"
      >
        {{ field }}
      </OBadge>
    </div>
  </ODialog>

  <!-- Modification Comparison Dialog -->
  <ODialog
    data-test="import-semantic-groups-drawer-modification-dialog"
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
            variant="default"
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
import { ref, computed, watch } from "vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import alertsService from "@/services/alerts";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import { toast } from "@/lib/feedback/Toast/useToast";


interface SemanticGroup {
  id: string;
  display: string;
  group?: string;
  fields: string[];
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

interface Props {
  currentGroups: SemanticGroup[];
  orgId: string;
  open?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "apply", groups: SemanticGroup[]): void;
}>();

const internalOpen = ref(props.open ?? false);

watch(
  () => props.open,
  (v) => {
    if (v !== undefined) internalOpen.value = v;
  },
);

function handleOpenChange(v: boolean) {
  internalOpen.value = v;
  emit("update:open", v);
}


const jsonFile = ref<File | null>(null);
const diffData = ref<SemanticGroupDiff | null>(null);
const selectedAdditions = ref<string[]>([]);
const selectedModifications = ref<string[]>([]);
const unchangedOpen = ref(false);
const isLoading = ref(false);
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

  isLoading.value = true;
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

    await previewDiff(groups);
  } catch (error: any) {
    toast({
      message: `Failed to parse JSON: ${error.message}`,
      variant: "error",
    });
    clearFile();
  } finally {
    isLoading.value = false;
  }
};

const clearFile = () => {
  jsonFile.value = null;
  diffData.value = null;
  selectedAdditions.value = [];
  selectedModifications.value = [];
};

const previewDiff = async (groups: SemanticGroup[]) => {
  try {
    const response = await alertsService.previewSemanticGroupsDiff(
      props.orgId,
      groups,
    );
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

const handleApply = () => {
  if (!diffData.value || !hasSelectedChanges.value) return;

  isApplying.value = true;

  // Build the merged groups list
  const mergedGroups: SemanticGroup[] = [];

  // Add selected additions
  const selectedAdditionGroups = diffData.value.additions.filter((g) =>
    selectedAdditions.value.includes(g.id),
  );
  mergedGroups.push(...selectedAdditionGroups);

  // Add selected modifications
  const selectedModificationGroups = diffData.value.modifications
    .filter((m) => selectedModifications.value.includes(m.proposed.id))
    .map((m) => m.proposed);
  mergedGroups.push(...selectedModificationGroups);

  // Capture count before clearing state
  const changeCount =
    selectedAdditions.value.length + selectedModifications.value.length;

  // Emit the merged groups to parent
  emit("apply", mergedGroups);

  // Reset and close
  clearFile();
  isApplying.value = false;
  handleOpenChange(false);

  toast({
    message: `Applied ${changeCount} changes`,
    variant: "success",
  });
};

const handleClose = () => {
  clearFile();
  handleOpenChange(false);
};
</script>

<style lang="scss" scoped>
.section-header {
  font-size: 14px;
  font-weight: 600;
  border-bottom: 1px solid var(--color-separator);
}

.groups-list {
  max-height: calc(100vh - 400px);
  overflow-y: auto;
}

.field-chips-container {
  max-height: 250px;
  overflow-y: auto;
  padding: 8px;
  background: var(--q-dark);
  border-radius: 4px;
}
</style>
