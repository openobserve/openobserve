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
    :title="t('correlation.importSemanticGroupsTitle')"
    :sub-title="t('correlation.importSemanticGroupsSubtitle')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('correlation.applyChanges')"
    :primary-button-disabled="!hasSelectedChanges"
    :primary-button-loading="isApplying"
    @click:secondary="handleClose"
    @click:primary="handleApply"
    @update:open="handleOpenChange"
  >
  <div>
      <!-- File Upload -->
      <div class="mb-3">
        <OFile
          v-model="jsonFile"
          :label="t('correlation.selectJsonFile')"
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
      <div v-if="isLoading" class="text-center p-4">
        <OSpinner variant="dots" size="lg" />
        <div class="text-sm text-text-muted mt-3">{{ t('correlation.analyzingFile') }}</div>
      </div>

      <!-- Diff Preview -->
      <div v-else-if="diffData" class="diff-preview">
        <!-- Summary -->
        <div class="summary-bar mb-3">
          <div class="flex gap-2 items-center">
            <div class="col-auto">
              <OTag type="diffCategory" value="new">
                <strong>{{ diffData.additions.length }}</strong
                >&nbsp;{{ t('correlation.new') }}
              </OTag>
            </div>
            <div class="col-auto">
              <OTag type="diffCategory" value="modified">
                <strong>{{ diffData.modifications.length }}</strong
                >&nbsp;{{ t('correlation.modified') }}
              </OTag>
            </div>
            <div class="col-auto">
              <OTag type="diffCategory" value="unchanged">
                {{ diffData.unchanged.length }} {{ t('correlation.unchanged') }}
              </OTag>
            </div>
          </div>
        </div>

        <!-- Selection Actions -->
        <div class="selection-actions mb-3">
          <OButtonGroup>
            <OButton
              variant="ghost-primary"
              size="xs"
              @click="selectAllAdditions"
              >{{ t('correlation.selectAllNew') }}</OButton
            >
            <OButton
              variant="ghost-warning"
              size="xs"
              @click="selectAllModifications"
              >{{ t('correlation.selectAllModified') }}</OButton
            >
            <OButton variant="ghost-muted" size="xs" @click="deselectAll"
              >{{ t('correlation.clearAll') }}</OButton
            >
          </OButtonGroup>
        </div>

        <!-- Groups List -->
        <div class="max-h-[calc(100vh-400px)] overflow-y-auto">
          <!-- Additions -->
          <div v-if="diffData.additions.length > 0" class="mb-3">
            <div class="text-sm font-semibold border-b border-separator text-status-positive p-2">
              <OIcon name="add-circle" size="sm" />
              {{ t('correlation.new') }} ({{ selectedAdditions.length }}/{{
                diffData.additions.length
              }})
            </div>
            <ul class="flex flex-col divide-y divide-border border rounded-default">
              <li
                v-for="group in diffData.additions"
                :key="group.id"
                data-test="semantic-groups-drawer-addition-item"
                class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50"
                @click="toggleAddition(group.id)"
              >
                <div class="flex items-center shrink-0">
                  <OCheckbox
                    :model-value="selectedAdditions.includes(group.id)"
                    @update:model-value="toggleAddition(group.id)"
                  />
                </div>
                <div class="flex flex-col flex-1 min-w-0">
                  <span class="text-sm font-medium">{{
                    group.display
                  }}</span>
                  <span class="block text-xs text-muted-foreground">
                    {{ group.id }} • {{ group.fields.length }} {{ t('correlation.fieldsCount') }}
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
          <div v-if="diffData.modifications.length > 0" class="mb-3">
            <div class="text-sm font-semibold border-b border-separator text-status-warning-text p-2">
              <OIcon name="edit" size="sm" />
              {{ t('correlation.modified') }} ({{ selectedModifications.length }}/{{
                diffData.modifications.length
              }})
            </div>
            <ul class="flex flex-col divide-y divide-border border rounded-default">
              <li
                v-for="mod in diffData.modifications"
                :key="mod.proposed.id"
                data-test="semantic-groups-drawer-modification-item"
                class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50"
                @click="toggleModification(mod.proposed.id)"
              >
                <div class="flex items-center shrink-0">
                  <OCheckbox
                    :model-value="
                      selectedModifications.includes(mod.proposed.id)
                    "
                    @update:model-value="toggleModification(mod.proposed.id)"
                  />
                </div>
                <div class="flex flex-col flex-1 min-w-0">
                  <span class="text-sm font-medium">{{
                    mod.proposed.display
                  }}</span>
                  <span class="block text-xs text-muted-foreground">
                    {{ mod.proposed.id }} • {{ mod.current.fields.length }} →
                    {{ mod.proposed.fields.length }} {{ t('correlation.fieldsCount') }}
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
              <ul class="flex flex-col divide-y divide-border border rounded-default">
                <li
                  v-for="group in diffData.unchanged"
                  :key="group.id"
                  class="flex items-center gap-2 px-3 py-2"
                >
                  <div class="flex flex-col flex-1 min-w-0">
                    <span class="text-sm">{{ group.display }}</span>
                    <span class="block text-xs text-muted-foreground"
                      >{{ group.id }} •
                      {{ group.fields.length }} {{ t('correlation.fieldsCount') }}</span
                    >
                  </div>
                </li>
              </ul>
            </OCollapsible>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="empty-state text-center p-4">
        <OIcon name="cloud-upload" class="mb-3 size-16!" />
        <div class="text-xl font-semibold text-text-muted mb-2">{{ t('correlation.uploadAJsonFile') }}</div>
        <div class="text-sm text-text-secondary">
          {{ t('correlation.analyzeFilePrompt') }}
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
    :primary-button-label="t('common.close')"
    @click:primary="showGroupDialog = false"
  >
    <div>
      <div class="text-sm font-medium mb-2">
        {{ t('correlation.fieldsLabel') }} ({{ selectedGroup?.fields.length }})
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
    </div>
  </ODialog>

  <!-- Modification Comparison Dialog -->
  <ODialog
    data-test="import-semantic-groups-drawer-modification-dialog"
    v-model:open="showModificationDialog"
    size="lg"
    :title="selectedModification?.proposed.display"
    :sub-title="t('correlation.compareChanges')"
    :primary-button-label="t('common.close')"
    @click:primary="showModificationDialog = false"
  >
    <div class="flex gap-3">
      <div class="w-1/2">
        <div class="text-sm font-medium text-status-error-text mb-2">{{ t('correlation.current') }}</div>
        <div class="text-xs mb-1">
          {{ selectedModification?.current.fields.length }} {{ t('correlation.fieldsCount') }}
        </div>
        <div class="max-h-62.5 overflow-y-auto p-2 bg-surface-subtle rounded-default">
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
        <div class="text-sm font-medium text-status-positive mb-2">{{ t('correlation.proposed') }}</div>
        <div class="text-xs mb-1">
          {{ selectedModification?.proposed.fields.length }} {{ t('correlation.fieldsCount') }}
        </div>
        <div class="max-h-62.5 overflow-y-auto p-2 bg-surface-subtle rounded-default">
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
import { ref, computed, watch } from "vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import { type FileValue } from "@/lib/forms/File/OFile.types";
import alertsService from "@/services/alerts";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

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

const loadFile = async (value: FileValue) => {
  // OFile single-mode emits File | null
  const file = value as File | null;
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
