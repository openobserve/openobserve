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
  <div class="import-drawer-container">
    <!-- Content -->
    <div class="drawer-content q-pa-md">
      <!-- File Upload -->
      <div class="q-mb-md">
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
              class="cursor-pointer"
            />
          </template>
        </OFile>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" class="text-center q-pa-lg">
        <OSpinner variant="dots" size="lg" />
        <div class="text-body2 text-grey-7 q-mt-md">Analyzing file...</div>
      </div>

      <!-- Diff Preview -->
      <div v-else-if="diffData" class="diff-preview">
        <!-- Summary -->
        <div class="summary-bar q-mb-md">
          <div class="row q-col-gutter-sm items-center">
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
        <div class="selection-actions q-mb-md">
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
          <div v-if="diffData.additions.length > 0" class="q-mb-md">
            <div class="section-header text-positive q-pa-sm">
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
          <div v-if="diffData.modifications.length > 0" class="q-mb-md">
            <div class="section-header text-warning q-pa-sm">
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
              icon="check_circle"
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
      <div v-else class="empty-state text-center q-pa-lg">
        <OIcon name="cloud-upload" size="64px" class="q-mb-md" />
        <div class="text-h6 text-grey-7 q-mb-sm">Upload a JSON file</div>
        <div class="text-body2 text-grey-6">
          The system will analyze the file and show you what will change
        </div>
      </div>
    </div>

    <!-- Footer Actions -->
    <div class="drawer-footer q-pa-md">
      <OSeparator class="tw:mb-4" />
      <div class="row q-col-gutter-sm justify-end">
        <div class="col-auto">
          <OButton
            variant="outline"
            size="sm-action"
            @click="handleClose"
            data-test="import-drawer-cancel-btn"
            >Cancel</OButton
          >
        </div>
        <div class="col-auto">
          <OButton
            variant="primary"
            size="sm-action"
            @click="handleApply"
            :disabled="!hasSelectedChanges"
            :loading="isApplying"
            data-test="import-drawer-apply-btn"
            >Apply Changes</OButton
          >
        </div>
      </div>
    </div>
  </div>

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
      <div class="text-subtitle2 q-mb-sm">
        Fields ({{ selectedGroup?.fields.length }})
      </div>
      <OBadge
        v-for="field in selectedGroup?.fields"
        :key="field"
        variant="primary"
        class="q-ma-xs"
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
    <div class="row q-col-gutter-md">
      <div class="col-6">
        <div class="text-subtitle2 text-negative q-mb-sm">Current</div>
        <div class="text-caption q-mb-xs">
          {{ selectedModification?.current.fields.length }} fields
        </div>
        <div class="field-chips-container">
          <OBadge
            v-for="field in selectedModification?.current.fields"
            :key="`current-${field}`"
            variant="default"
            size="sm"
            class="q-ma-xs"
          >
            {{ field }}
          </OBadge>
        </div>
      </div>
      <div class="col-6">
        <div class="text-subtitle2 text-positive q-mb-sm">Proposed</div>
        <div class="text-caption q-mb-xs">
          {{ selectedModification?.proposed.fields.length }} fields
        </div>
        <div class="field-chips-container">
          <OBadge
            v-for="field in selectedModification?.proposed.fields"
            :key="`proposed-${field}`"
            :variant="isNewField(field) ? 'success' : 'default'"
            size="sm"
            class="q-ma-xs"
          >
            {{ field }}
            <OIcon
              v-if="isNewField(field)"
              name="add"
              size="xs"
              class="q-ml-xs"
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
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import alertsService from "@/services/alerts";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

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
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "apply", groups: SemanticGroup[]): void;
}>();


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
      position: "bottom-center",
      timeout: 3000,
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
      position: "bottom-center",
      timeout: 3000,
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
  emit("close");

  toast({
    message: `Applied ${changeCount} changes`,
    position: "bottom-center",
    timeout: 2000,
  });
};

const handleClose = () => {
  clearFile();
  emit("close");
};
</script>

<style lang="scss" scoped>
.import-drawer-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.drawer-header {
  flex-shrink: 0;
}

.drawer-content {
  flex: 1;
  overflow-y: auto;
}

.drawer-footer {
  flex-shrink: 0;
}

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
