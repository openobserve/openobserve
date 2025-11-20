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
  <q-card flat bordered
class="semantic-group-item q-pa-md q-mb-sm">
    <div class="group-layout">
      <!-- Left Column: ID and Display Name stacked -->
      <div class="left-column">
        <div class="q-mb-sm">
          <q-input
            v-model="localGroup.id"
            label="Name *"
            hint="e.g., k8s-cluster"
            :rules="[validateId]"
            dense
            filled
            color="input-border"
            bg-color="input-bg"
            @update:model-value="emitUpdate"
          />
        </div>
        <div>
          <q-input
            v-model="localGroup.display_name"
            label="Display *"
            hint="Human-readable"
            :rules="[(val) => !!val || 'Display name is required']"
            dense
            filled
            color="input-border"
            bg-color="input-bg"
            @update:model-value="emitUpdate"
          />
        </div>
      </div>

      <!-- Right Column: Field Names spanning both rows -->
      <div class="right-column">
        <div class="field-names-input">
          <TagInput
            v-model="localGroup.field_names"
            placeholder=""
            label="Field names (comma-separated) *"
            @update:model-value="emitUpdate"
          />
        </div>
      </div>

      <!-- Actions Column: Normalize and Delete -->
      <div class="actions-column">
        <div class="q-mb-sm">
          <q-checkbox
            v-model="localGroup.normalize"
            label="Normalize"
            @update:model-value="emitUpdate"
          >
            <q-tooltip>Lowercase and trim values for matching</q-tooltip>
          </q-checkbox>
        </div>
        <div class="flex justify-end">
          <q-btn
            flat
            round
            dense
            color="negative"
            icon="delete"
            @click="emit('delete')"
          >
            <q-tooltip>Remove this semantic group</q-tooltip>
          </q-btn>
        </div>
      </div>
    </div>
  </q-card>
</template>

<script lang="ts" setup>
import { ref, watch } from "vue";
import TagInput from "./TagInput.vue";

interface SemanticGroup {
  id: string;
  display_name: string;
  field_names: string[];
  normalize: boolean;
}

interface Props {
  group: SemanticGroup;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "update", group: SemanticGroup): void;
  (e: "delete"): void;
}>();

const localGroup = ref<SemanticGroup>({ ...props.group });

watch(
  () => props.group,
  (newGroup) => {
    localGroup.value = { ...newGroup };
  },
  { deep: true },
);

const validateId = (val: string) => {
  if (!val) return "ID is required";
  if (!/^[a-z0-9-]+$/.test(val)) {
    return "ID must be lowercase letters, numbers, and dashes only";
  }
  return true;
};

const emitUpdate = () => {
  emit("update", { ...localGroup.value });
};
</script>

<style lang="scss" scoped>
.semantic-group-item {
  border-radius: 8px;
  transition: all 0.2s ease;
  width: 100%;
  max-width: 100%;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
}

.group-layout {
  display: grid;
  grid-template-columns: 200px 1fr auto;
  gap: 16px;
  align-items: start;
  width: 100%;
  overflow: hidden;
}

.left-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.right-column {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.field-names-input {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;

  :deep(.tag-input-container) {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  :deep(.tag-input-wrapper) {
    flex: 1;
    min-height: 100px;
    min-width: 0;
  }
}

.actions-column {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 100%;
}

.text-subtitle2 {
  font-size: 12px;
  font-weight: 500;
  color: var(--q-color-text-secondary);
}

@media (max-width: 768px) {
  .group-layout {
    grid-template-columns: 1fr;
  }
}
</style>
