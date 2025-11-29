<!-- Copyright 2025 OpenObserve Inc.

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
        <div class="card-container q-pa-sm q-mb-sm">
          <div class="row items-center">
            <div class="col-12 col-md-8">
              <q-file
                v-model="jsonFile"
                dense
                filled
                label="Select JSON file"
                accept=".json"
                @update:model-value="loadFile"
                data-test="semantic-groups-import-file"
                class="compact-file-input"
              >
                <template v-slot:prepend>
                  <q-icon name="cloud_upload" size="sm" />
                </template>
                <template v-slot:append>
                  <q-icon
                    v-if="jsonFile"
                    name="close"
                    size="sm"
                    @click.stop="clearFile"
                    class="cursor-pointer"
                  />
                </template>
              </q-file>
            </div>
            <div class="col-12 col-md-4 text-right q-pl-sm">
              <q-btn
                v-if="diffData"
                label="Apply Changes"
                color="primary"
                @click="applyChanges"
                :disable="!hasSelectedChanges"
                :loading="isApplying"
                size="sm"
                no-caps
              />
            </div>
          </div>
        </div>

        <!-- Diff Preview Section with Scrollable Content -->
        <div v-if="diffData" class="diff-container">
          <!-- Compact Summary Bar -->
          <div class="card-container q-pa-sm q-mb-sm">
            <div class="row items-center q-col-gutter-sm">
              <div class="col-auto">
                <q-chip dense color="positive" text-color="white" class="summary-chip">
                  <strong>{{ diffData.additions.length }}</strong>&nbsp;New
                </q-chip>
              </div>
              <div class="col-auto">
                <q-chip dense color="warning" text-color="white" class="summary-chip">
                  <strong>{{ diffData.modifications.length }}</strong>&nbsp;Modified
                </q-chip>
              </div>
              <div class="col-auto">
                <q-chip dense color="grey-6" text-color="white" class="summary-chip">
                  {{ diffData.unchanged.length }} Unchanged
                </q-chip>
              </div>
              <div class="col">
                <q-btn-group flat class="float-right">
                  <q-btn
                    flat
                    dense
                    label="Select All New"
                    @click="selectAllAdditions"
                    color="positive"
                    size="sm"
                    class="action-btn"
                  />
                  <q-btn
                    flat
                    dense
                    label="Select All Modified"
                    @click="selectAllModifications"
                    color="warning"
                    size="sm"
                    class="action-btn"
                  />
                  <q-btn
                    flat
                    dense
                    label="Clear All"
                    @click="deselectAll"
                    color="grey-7"
                    size="sm"
                    class="action-btn"
                  />
                </q-btn-group>
              </div>
            </div>
          </div>

          <!-- Scrollable Groups Container -->
          <div class="card-container groups-scroll-container">
            <!-- Additions -->
            <div v-if="diffData.additions.length > 0" class="q-mb-sm">
              <div class="section-header text-positive q-pa-xs">
                <q-icon name="add_circle" size="sm" />
                New ({{ selectedAdditions.length }}/{{ diffData.additions.length }})
              </div>
              <q-list dense bordered separator class="compact-list">
                <q-item
                  v-for="group in diffData.additions"
                  :key="group.id"
                  dense
                  clickable
                  @click="toggleAddition(group.id)"
                  class="compact-item"
                >
                  <q-item-section side top>
                    <q-checkbox
                      dense
                      :model-value="selectedAdditions.includes(group.id)"
                      @update:model-value="toggleAddition(group.id)"
                      color="positive"
                      size="xs"
                    />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="text-weight-medium">{{ group.display }}</q-item-label>
                    <q-item-label caption lines="1">
                      {{ group.id }} • {{ group.fields.length }} fields
                      <q-badge v-if="group.normalize" color="blue" label="norm" class="q-ml-xs" />
                    </q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <q-btn
                      flat
                      dense
                      round
                      icon="visibility"
                      size="xs"
                      @click.stop="viewGroup(group)"
                    />
                  </q-item-section>
                </q-item>
              </q-list>
            </div>

            <!-- Modifications -->
            <div v-if="diffData.modifications.length > 0" class="q-mb-sm">
              <div class="section-header text-warning q-pa-xs">
                <q-icon name="edit" size="sm" />
                Modified ({{ selectedModifications.length }}/{{ diffData.modifications.length }})
              </div>
              <q-list dense bordered separator class="compact-list">
                <q-item
                  v-for="mod in diffData.modifications"
                  :key="mod.proposed.id"
                  dense
                  clickable
                  @click="toggleModification(mod.proposed.id)"
                  class="compact-item"
                >
                  <q-item-section side top>
                    <q-checkbox
                      dense
                      :model-value="selectedModifications.includes(mod.proposed.id)"
                      @update:model-value="toggleModification(mod.proposed.id)"
                      color="warning"
                      size="xs"
                    />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="text-weight-medium">{{ mod.proposed.display }}</q-item-label>
                    <q-item-label caption lines="1">
                      {{ mod.proposed.id }} • {{ mod.current.fields.length }} → {{ mod.proposed.fields.length }} fields
                    </q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <q-btn
                      flat
                      dense
                      round
                      icon="compare"
                      size="xs"
                      @click.stop="viewModification(mod)"
                    />
                  </q-item-section>
                </q-item>
              </q-list>
            </div>

            <!-- Unchanged (Collapsed) -->
            <div v-if="diffData.unchanged.length > 0">
              <q-expansion-item
                dense
                :label="`Unchanged (${diffData.unchanged.length})`"
                icon="check_circle"
                header-class="text-grey-7 q-pa-xs"
              >
                <q-list dense bordered separator class="compact-list">
                  <q-item
                    v-for="group in diffData.unchanged"
                    :key="group.id"
                    dense
                    class="compact-item"
                  >
                    <q-item-section>
                      <q-item-label>{{ group.display }}</q-item-label>
                      <q-item-label caption>{{ group.id }} • {{ group.fields.length }} fields</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-expansion-item>
            </div>
          </div>
        </div>

        <!-- No Diff State -->
        <div v-else-if="!isImporting && !diffData" class="card-container q-pa-lg text-center">
          <q-icon name="cloud_upload" size="64px" color="grey-5" class="q-mb-md" />
          <div class="text-h6 text-grey-7 q-mb-sm">Upload a JSON file to get started</div>
          <div class="text-body2 text-grey-6">
            The system will analyze the file and show you what will change
          </div>
        </div>
      </div>
    </template>
  </base-import>

  <!-- Group Details Dialog -->
  <q-dialog v-model="showGroupDialog">
    <q-card style="min-width: 500px">
      <q-card-section>
        <div class="text-h6">{{ selectedGroup?.display }}</div>
        <div class="text-caption text-grey-7">ID: {{ selectedGroup?.id }}</div>
      </q-card-section>

      <q-separator />

      <q-card-section>
        <div class="text-subtitle2 q-mb-sm">Fields ({{ selectedGroup?.fields.length }})</div>
        <q-chip
          v-for="field in selectedGroup?.fields"
          :key="field"
          dense
          color="primary"
          text-color="white"
          class="q-ma-xs"
        >
          {{ field }}
        </q-chip>
        <div class="q-mt-md">
          <q-badge v-if="selectedGroup?.normalize" color="blue" label="Normalized" />
          <q-badge v-else color="grey" label="Not Normalized" />
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Close" color="primary" v-close-popup />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <!-- Modification Comparison Dialog -->
  <q-dialog v-model="showModificationDialog">
    <q-card style="min-width: 700px">
      <q-card-section>
        <div class="text-h6">{{ selectedModification?.proposed.display }}</div>
        <div class="text-caption text-grey-7">Compare Changes</div>
      </q-card-section>

      <q-separator />

      <q-card-section>
        <div class="row q-col-gutter-md">
          <div class="col-6">
            <div class="text-subtitle2 text-negative q-mb-sm">Current</div>
            <div class="text-caption q-mb-xs">{{ selectedModification?.current.fields.length }} fields</div>
            <div class="field-chips-container">
              <q-chip
                v-for="field in selectedModification?.current.fields"
                :key="`current-${field}`"
                dense
                color="grey-4"
                size="sm"
                class="q-ma-xs"
              >
                {{ field }}
              </q-chip>
            </div>
          </div>
          <div class="col-6">
            <div class="text-subtitle2 text-positive q-mb-sm">Proposed</div>
            <div class="text-caption q-mb-xs">{{ selectedModification?.proposed.fields.length }} fields</div>
            <div class="field-chips-container">
              <q-chip
                v-for="field in selectedModification?.proposed.fields"
                :key="`proposed-${field}`"
                dense
                :color="isNewField(field) ? 'positive' : 'grey-4'"
                :text-color="isNewField(field) ? 'white' : 'black'"
                size="sm"
                class="q-ma-xs"
              >
                {{ field }}
                <q-icon v-if="isNewField(field)" name="add" size="xs" class="q-ml-xs" />
              </q-chip>
            </div>
          </div>
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Close" color="primary" v-close-popup />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts" setup>
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import BaseImport from "@/components/common/BaseImport.vue";
import alertsService from "@/services/alerts";

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
const q = useQuasar();
const store = useStore();

const jsonFile = ref<File | null>(null);
const importedGroups = ref<SemanticGroup[]>([]);
const diffData = ref<SemanticGroupDiff | null>(null);
const selectedAdditions = ref<string[]>([]);
const selectedModifications = ref<string[]>([]);
const isImporting = ref(false);
const isApplying = ref(false);
const showGroupDialog = ref(false);
const showModificationDialog = ref(false);
const selectedGroup = ref<SemanticGroup | null>(null);
const selectedModification = ref<SemanticGroupModification | null>(null);

const hasSelectedChanges = computed(() => {
  return selectedAdditions.value.length > 0 || selectedModifications.value.length > 0;
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
    q.notify({
      message: `Failed to parse JSON: ${error.message}`,
      color: "negative",
      position: "bottom",
      timeout: 3000,
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
    selectedAdditions.value = response.data.additions.map((g: SemanticGroup) => g.id);
    selectedModifications.value = response.data.modifications.map((m: SemanticGroupModification) => m.proposed.id);
  } catch (error: any) {
    q.notify({
      message: `Failed to preview changes: ${error.response?.data?.error || error.message}`,
      color: "negative",
      position: "bottom",
      timeout: 3000,
    });
  }
};

const selectAllAdditions = () => {
  if (!diffData.value) return;
  selectedAdditions.value = diffData.value.additions.map(g => g.id);
};

const selectAllModifications = () => {
  if (!diffData.value) return;
  selectedModifications.value = diffData.value.modifications.map(m => m.proposed.id);
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
    const selectedAdditionGroups = diffData.value.additions.filter(g =>
      selectedAdditions.value.includes(g.id)
    );
    finalGroups.push(...selectedAdditionGroups);

    // Add selected modifications
    const selectedModificationGroups = diffData.value.modifications
      .filter(m => selectedModifications.value.includes(m.proposed.id))
      .map(m => m.proposed);
    finalGroups.push(...selectedModificationGroups);

    // Add unchanged groups
    finalGroups.push(...diffData.value.unchanged);

    // Add unselected current groups (keep them as-is)
    const unselectedModifications = diffData.value.modifications
      .filter(m => !selectedModifications.value.includes(m.proposed.id))
      .map(m => m.current);
    finalGroups.push(...unselectedModifications);

    // Save to backend
    const org = store.state.selectedOrganization.identifier;
    await alertsService.saveSemanticGroups(org, finalGroups);

    q.notify({
      message: `Successfully applied ${selectedAdditions.value.length + selectedModifications.value.length} changes`,
      color: "positive",
      position: "bottom",
      timeout: 3000,
    });

    // Go back
    handleBack();
  } catch (error: any) {
    q.notify({
      message: `Failed to save changes: ${error.response?.data?.error || error.message}`,
      color: "negative",
      position: "bottom",
      timeout: 3000,
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

const handleJsonUpdate = (jsonArray: any[]) => {
  // Not used in this component since we handle file upload directly
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
  border-bottom: 1px solid var(--q-separator-color);
  margin-bottom: 4px;
}

.compact-list {
  margin-bottom: 0;
}

.compact-item {
  min-height: 44px;
  padding: 4px 8px;

  :deep(.q-item__section--main) {
    padding: 0 8px;
  }

  :deep(.q-item__label) {
    font-size: 13px;
  }

  :deep(.q-item__label--caption) {
    font-size: 11px;
  }
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

  :deep(.q-chip__content) {
    padding: 6px 12px;
    font-weight: 500;
  }

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
