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
  <div class="import-drawer-container tw:w-[45rem]">
    <!-- Header -->
    <div class="drawer-header q-pa-md">
      <div class="row items-center">
        <div class="col">
          <div class="text-h6">Import Semantic Groups</div>
          <div class="text-caption text-grey-7">
            Upload JSON file to import semantic field groups
          </div>
        </div>
        <div class="col-auto">
          <q-btn
            flat
            round
            dense
            icon="close"
            @click="handleClose"
            data-test="import-drawer-close-btn"
          />
        </div>
      </div>
    </div>

    <q-separator />

    <!-- Content -->
    <div class="drawer-content q-pa-md">
      <!-- File Upload -->
      <div class="q-mb-md">
        <q-file
          v-model="jsonFile"
          dense
          filled
          label="Select JSON file"
          accept=".json"
          @update:model-value="loadFile"
          data-test="semantic-groups-import-file-drawer"
        >
          <template v-slot:prepend>
            <q-icon name="cloud_upload" />
          </template>
          <template v-slot:append>
            <q-icon
              v-if="jsonFile"
              name="close"
              @click.stop="clearFile"
              class="cursor-pointer"
            />
          </template>
        </q-file>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" class="text-center q-pa-lg">
        <q-spinner-dots size="50px" color="primary" />
        <div class="text-body2 text-grey-7 q-mt-md">Analyzing file...</div>
      </div>

      <!-- Diff Preview -->
      <div v-else-if="diffData" class="diff-preview">
        <!-- Summary -->
        <div class="summary-bar q-mb-md">
          <div class="row q-col-gutter-sm items-center">
            <div class="col-auto">
              <q-chip dense color="positive" text-color="white">
                <strong>{{ diffData.additions.length }}</strong
                >&nbsp;New
              </q-chip>
            </div>
            <div class="col-auto">
              <q-chip dense color="warning" text-color="white">
                <strong>{{ diffData.modifications.length }}</strong
                >&nbsp;Modified
              </q-chip>
            </div>
            <div class="col-auto">
              <q-chip dense color="grey-6" text-color="white">
                {{ diffData.unchanged.length }} Unchanged
              </q-chip>
            </div>
          </div>
        </div>

        <!-- Selection Actions -->
        <div class="selection-actions q-mb-md">
          <q-btn-group flat>
            <q-btn
              flat
              dense
              label="Select All New"
              @click="selectAllAdditions"
              color="positive"
              size="sm"
            />
            <q-btn
              flat
              dense
              label="Select All Modified"
              @click="selectAllModifications"
              color="warning"
              size="sm"
            />
            <q-btn
              flat
              dense
              label="Clear All"
              @click="deselectAll"
              color="grey-7"
              size="sm"
            />
          </q-btn-group>
        </div>

        <!-- Groups List -->
        <div class="groups-list">
          <!-- Additions -->
          <div v-if="diffData.additions.length > 0" class="q-mb-md">
            <div class="section-header text-positive q-pa-sm">
              <q-icon name="add_circle" size="sm" />
              New ({{ selectedAdditions.length }}/{{
                diffData.additions.length
              }})
            </div>
            <q-list bordered separator>
              <q-item
                v-for="group in diffData.additions"
                :key="group.id"
                clickable
                @click="toggleAddition(group.id)"
              >
                <q-item-section side>
                  <q-checkbox
                    :model-value="selectedAdditions.includes(group.id)"
                    @update:model-value="toggleAddition(group.id)"
                    color="positive"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-medium">{{
                    group.display
                  }}</q-item-label>
                  <q-item-label caption>
                    {{ group.id }} • {{ group.fields.length }} fields
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn
                    flat
                    dense
                    round
                    icon="visibility"
                    size="sm"
                    @click.stop="viewGroup(group)"
                  />
                </q-item-section>
              </q-item>
            </q-list>
          </div>

          <!-- Modifications -->
          <div v-if="diffData.modifications.length > 0" class="q-mb-md">
            <div class="section-header text-warning q-pa-sm">
              <q-icon name="edit" size="sm" />
              Modified ({{ selectedModifications.length }}/{{
                diffData.modifications.length
              }})
            </div>
            <q-list bordered separator>
              <q-item
                v-for="mod in diffData.modifications"
                :key="mod.proposed.id"
                clickable
                @click="toggleModification(mod.proposed.id)"
              >
                <q-item-section side>
                  <q-checkbox
                    :model-value="
                      selectedModifications.includes(mod.proposed.id)
                    "
                    @update:model-value="toggleModification(mod.proposed.id)"
                    color="warning"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-medium">{{
                    mod.proposed.display
                  }}</q-item-label>
                  <q-item-label caption>
                    {{ mod.proposed.id }} • {{ mod.current.fields.length }} →
                    {{ mod.proposed.fields.length }} fields
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn
                    flat
                    dense
                    round
                    icon="compare"
                    size="sm"
                    @click.stop="viewModification(mod)"
                  />
                </q-item-section>
              </q-item>
            </q-list>
          </div>

          <!-- Unchanged (Collapsed) -->
          <div v-if="diffData.unchanged.length > 0">
            <q-expansion-item
              :label="`Unchanged (${diffData.unchanged.length})`"
              icon="check_circle"
              header-class="text-grey-7"
            >
              <q-list bordered separator>
                <q-item v-for="group in diffData.unchanged" :key="group.id">
                  <q-item-section>
                    <q-item-label>{{ group.display }}</q-item-label>
                    <q-item-label caption
                      >{{ group.id }} •
                      {{ group.fields.length }} fields</q-item-label
                    >
                  </q-item-section>
                </q-item>
              </q-list>
            </q-expansion-item>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="empty-state text-center q-pa-lg">
        <q-icon
          name="cloud_upload"
          size="64px"
          color="grey-5"
          class="q-mb-md"
        />
        <div class="text-h6 text-grey-7 q-mb-sm">Upload a JSON file</div>
        <div class="text-body2 text-grey-6">
          The system will analyze the file and show you what will change
        </div>
      </div>
    </div>

    <!-- Footer Actions -->
    <div class="drawer-footer q-pa-md">
      <q-separator class="q-mb-md" />
      <div class="row q-col-gutter-sm justify-end">
        <div class="col-auto">
          <q-btn
            flat
            label="Cancel"
            @click="handleClose"
            data-test="import-drawer-cancel-btn"
          />
        </div>
        <div class="col-auto">
          <q-btn
            unelevated
            color="primary"
            label="Apply Changes"
            @click="handleApply"
            :disable="!hasSelectedChanges"
            :loading="isApplying"
            data-test="import-drawer-apply-btn"
          />
        </div>
      </div>
    </div>
  </div>

  <!-- Group Details Dialog -->
  <q-dialog v-model="showGroupDialog">
    <q-card style="min-width: 500px">
      <q-card-section>
        <div class="text-h6">{{ selectedGroup?.display }}</div>
        <div class="text-caption text-grey-7">ID: {{ selectedGroup?.id }}</div>
      </q-card-section>

      <q-separator />

      <q-card-section>
        <div class="text-subtitle2 q-mb-sm">
          Fields ({{ selectedGroup?.fields.length }})
        </div>
        <q-chip
          v-for="field in selectedGroup?.fields"
          :key="field"
          color="primary"
          text-color="white"
          class="q-ma-xs"
        >
          {{ field }}
        </q-chip>
        <div class="q-mt-md">
          <q-badge
            v-if="selectedGroup?.normalize"
            color="blue"
            label="Normalized"
          />
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
            <div class="text-caption q-mb-xs">
              {{ selectedModification?.current.fields.length }} fields
            </div>
            <div class="field-chips-container">
              <q-chip
                v-for="field in selectedModification?.current.fields"
                :key="`current-${field}`"
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
            <div class="text-caption q-mb-xs">
              {{ selectedModification?.proposed.fields.length }} fields
            </div>
            <div class="field-chips-container">
              <q-chip
                v-for="field in selectedModification?.proposed.fields"
                :key="`proposed-${field}`"
                :color="isNewField(field) ? 'positive' : 'grey-4'"
                :text-color="isNewField(field) ? 'white' : 'black'"
                size="sm"
                class="q-ma-xs"
              >
                {{ field }}
                <q-icon
                  v-if="isNewField(field)"
                  name="add"
                  size="xs"
                  class="q-ml-xs"
                />
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
import { useQuasar } from "quasar";
import alertsService from "@/services/alerts";

interface SemanticGroup {
  id: string;
  display: string;
  group?: string;
  fields: string[];
  normalize: boolean;
  is_stable?: boolean;
  is_scope?: boolean;
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

const q = useQuasar();

const jsonFile = ref<File | null>(null);
const diffData = ref<SemanticGroupDiff | null>(null);
const selectedAdditions = ref<string[]>([]);
const selectedModifications = ref<string[]>([]);
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
    q.notify({
      message: `Failed to parse JSON: ${error.message}`,
      color: "negative",
      position: "bottom",
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

  // Emit the merged groups to parent
  emit("apply", mergedGroups);

  // Reset and close
  clearFile();
  isApplying.value = false;
  emit("close");

  q.notify({
    message: `Applied ${selectedAdditions.value.length + selectedModifications.value.length} changes`,
    color: "positive",
    position: "bottom",
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
  border-bottom: 1px solid var(--q-separator-color);
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
